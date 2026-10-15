-- Session 5b (DECISIONS §32.1, §32.5): the Slack console's queue and threads, support cases answered from a Slack thread,
-- the order recovery engine with the 60-second alert, and operator actions (only operators, audited, money limits).
begin;

set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
\set admin '00000000-0000-0000-0000-00000000000a'
\set op '00000000-0000-0000-0000-00000000000b'
\set owner '00000000-0000-0000-0000-00000000000e'
\set order1 '30000000-0000-0000-0000-000000000001'
\set c1 '10000000-0000-0000-0000-000000000001'

-- 1. The queue and its threads --------------------------------------------------------------------------------------------
reset role;
insert into public.ops_alerts (dedupe_key, kind, severity, summary, order_id) values ('t-alert-1', 'sos', 'urgent', 'Driver pressed SOS', :'order1');
select tests.ok((select channel_key = 'urgent' and text like '🚨 Driver pressed SOS · #TESTA2' and actions @> '[{"action_id": "ack_alert"}]'
                 from public.slack_messages where dedupe_key like 'alert:%' and text like '%SOS%'),
  'every ops alert goes to its Slack channel with an Acknowledge button');
select tests.ok((select count(*) from public.slack_messages where thread_key = 'order:' || :'order1') >= 1,
  '#orders-live: a line per status change, threaded per order');
set local role service_role;
select tests.ok((select count(*) from public.slack_claim(50)) = 0, 'nothing is posted before slack-setup records the channel ids');
select public.slack_channel_set(k, 'C0TEST' || upper(k), k) from unnest(array['urgent', 'orders', 'claims', 'money', 'support', 'drivers', 'brief']) k;
select array_agg(id order by id) as claimed from public.slack_claim(50) \gset
reset role;
select tests.ok((select count(*) from public.slack_messages m where m.thread_key = 'order:' || :'order1' and m.id = any (:'claimed'::bigint[])) = 1,
  'a thread''s replies wait until its root is in Slack');
set local role service_role;
select public.slack_finish(m.id, true, 'C0TESTORDERS', '1700000000.000100', null)
from public.slack_messages m where m.thread_key = 'order:' || :'order1' and m.id = any (:'claimed'::bigint[]);
reset role;
insert into public.slack_messages (channel_key, thread_key, text) values ('orders', 'order:' || :'order1', 'a later line');
set local role service_role;
select tests.ok((select thread_ts = '1700000000.000100' from public.slack_claim(50) c where c.text = 'a later line'),
  'then they post in the thread');

-- 2. Support: a handoff opens a case and a thread; a thread reply reaches the customer as Rasheed ----------------------------
select public.customer_handoff(:'c1', 'customer asked for a person', 'wants to change the address after ordering') as h \gset
reset role;
select (:'h'::jsonb ->> 'case_id') as case_id \gset
select tests.ok((select status = 'open' from public.support_cases where id = :'case_id')
  and exists (select 1 from public.slack_messages where thread_key = 'case:' || :'case_id' and channel_key = 'support'
              and text like '%wants to change the address%' and text not like '%+961%' and actions @> '[{"action_id": "case_resolve"}]'),
  'the case thread carries the summary and a Resolve button, never the phone number');
select tests.ok((public.customer_handoff(:'c1', 'again', null) ->> 'case_id') = :'case_id', 'one open case per customer');
set local role service_role;
select tests.ok(public.support_inbound(:'c1', 'it''s Bnayet Saad now'), 'a customer message during the handoff joins the thread');
select tests.throws(format($$select public.support_reply(%L, %L, 'hello')$$, :'case_id', :'owner'), 'not allowed', 'a merchant is not support');
select public.support_reply(:'case_id', :'op', 'Done, the driver has the new building') as rp \gset
reset role;
select tests.ok((select payload ->> 'kind' = 'support_reply' and payload ->> 'name' = 'Operator' and payload ->> 'text' like 'Done%'
                 from public.outbound_messages where dedupe_key = 'support:' || (:'rp'::jsonb ->> 'message_id')),
  'the reply is queued to the customer on WhatsApp, signed by the operator');
select tests.ok((select handoff_until > now() from public.bot_sessions where customer_id = :'c1'), 'the bot stays quiet while a person talks');
set local role service_role;
select public.support_message_status((:'rp'::jsonb ->> 'message_id')::bigint, 'held');
select tests.ok(public.support_pending(:'c1') -> 0 ->> 'text' like 'Done%' and public.support_pending(:'c1') = '[]',
  'a reply held behind the template is shown once, when the customer taps it');
select tests.ok(public.support_resolve(:'case_id', :'op') ->> 'status' = 'resolved', 'Resolve closes the case');
reset role;
select tests.ok((select handoff_until is null from public.bot_sessions where customer_id = :'c1')
  and exists (select 1 from public.outbound_messages where dedupe_key = 'support-closed:' || :'case_id'), 'and hands the customer back to the assistant');
set local role service_role;

-- 3. The recovery engine ---------------------------------------------------------------------------------------------------------
reset role;
update public.orders set placed_at = now() - interval '70 seconds' where id = :'order1';
select app_private.recovery_tick();
select tests.ok((select human_needed and status = 'open' from public.order_exceptions where order_id = :'order1' and kind = 'no_ack')
  and exists (select 1 from public.ops_alerts a join public.order_exceptions x on x.alert_id = a.id where x.order_id = :'order1' and a.severity = 'urgent')
  and exists (select 1 from public.slack_messages where channel_key = 'urgent' and text like '%has not acknowledged after 60 s%'),
  'no acknowledgement after 60 s: an exception and an urgent Slack alert');
select app_private.recovery_tick();
select tests.ok((select count(*) from public.order_exceptions where order_id = :'order1') = 1, 'the same problem is one exception, not one per tick');
update public.orders set status = 'accepted', acknowledged_at = now(), accepted_at = now() - interval '25 minutes', prep_minutes = 10 where id = :'order1';
select app_private.recovery_tick();
select tests.ok((select status = 'closed' and close_reason = 'order accepted' from public.order_exceptions where order_id = :'order1' and kind = 'no_ack'),
  'verified close: the exception closes only once the order moved on');
select tests.ok((select not human_needed from public.order_exceptions where order_id = :'order1' and kind = 'late_ready' and status = 'open'),
  '15 minutes late: the ready-check first, no person yet');
update public.orders set accepted_at = now() - interval '45 minutes' where id = :'order1';
select app_private.recovery_tick();
select tests.ok((select human_needed from public.order_exceptions where order_id = :'order1' and kind = 'late_ready' and status = 'open'),
  'past the grace and the human threshold: now a person is needed');
set local role service_role;

-- 4. Operator actions ----------------------------------------------------------------------------------------------------------
select tests.ok(public.ops_operator(p_phone_e164 => '+96171000001') is null, 'a merchant''s phone is not an operator');
reset role;
insert into public.operator_phones (phone_e164, operator_user_id) values ('+96170009999', :'op');
insert into public.operator_slack (slack_user_id, operator_user_id) values ('U0TESTADMIN', :'admin');
set local role service_role;
select tests.ok(public.ops_operator(p_phone_e164 => '+96170009999') ->> 'role' = 'operator'
  and public.ops_operator(p_slack_user_id => 'U0TESTADMIN') ->> 'role' = 'admin', 'Slack users and phones map to operators');
select tests.throws(format($$select public.ops_order(%L, 'TESTA2')$$, :'owner'), 'not allowed', 'only operators look orders up');
select tests.ok(public.ops_order(:'op', 'testa2') ->> 'order_status' = 'accepted' and not (public.ops_order(:'op', 'testa2')::text ~ '\+961'),
  'an order card for operators, without the customer''s phone');
select tests.ok(public.ops_refund(:'op', 'TESTA2', 5) ->> 'status' = 'credited', 'an operator refunds $5 as a customer credit');
reset role;
select tests.ok((select sum(e.amount) = 0 from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
                 where t.reason = 'operator refund'), 'booked as a balanced ledger transaction');
set local role service_role;
select tests.throws(format($$select public.ops_refund(%L, 'TESTA2', 25)$$, :'op'), 'only the admin', 'above $20 only the admin');
select tests.throws(format($$select public.ops_refund(%L, 'TESTA2', 99)$$, :'admin'), 'at most the order total', 'never more than the order');
select tests.ok(public.ops_credit(:'admin', '20000000-0000-0000-0000-00000000000a', 30, 'launch compensation') ->> 'status' = 'credited',
  'the admin credits a merchant with a reason');
select tests.throws(format($$select public.ops_place(%L, 'Baakline', false)$$, :'op'), 'only the admin', 'places are switched by the admin');
select tests.ok(jsonb_typeof(public.ops_finance(:'op')) = 'object', 'the finance snapshot reads the ledger');
-- WhatsApp admin commands: proposed, then confirmed by the same operator's tap.
select public.ops_action_propose(:'op', 'refund', '{"code": "TESTA2", "amount_usd": 3}') as a1 \gset
select tests.ok(public.ops_action_decide(:'a1', :'admin', true) ->> 'status' = 'unknown', 'another operator cannot confirm it');
select tests.ok(public.ops_action_decide(:'a1', :'op', true) ->> 'status' = 'done', 'the proposer''s tap does it');
select tests.ok(public.ops_action_decide(:'a1', :'op', true) ->> 'status' = 'already_done', 'once');
select public.ops_action_propose(:'admin', 'refund', '{"code": "TESTA2", "amount_usd": 21}') as a2 \gset
select tests.ok(public.ops_action_decide(:'a2', :'admin', true) ->> 'status' = 'refused', 'refunds by WhatsApp are capped at $20');
reset role;
select tests.ok((select count(*) from public.ops_actions where action in ('refund', 'merchant_credit', 'support_reply', 'support_resolve')) >= 4,
  'every action is audited');

-- 5. Grants ----------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws($$select public.ops_refund('00000000-0000-0000-0000-00000000000a', 'TESTA2', 1)$$, 'permission denied',
  'nobody signed in calls operator functions directly');
select tests.ok(tests.count_of('select 1 from public.support_cases') = 0 and tests.count_of('select 1 from public.ops_actions') = 0,
  'and customers read no cases or actions');

rollback;
