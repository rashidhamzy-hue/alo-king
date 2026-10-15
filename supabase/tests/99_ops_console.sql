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
select tests.ok(exists (select 1 from public.slack_messages where channel_key = 'support' and thread_key is null and text like '%asks for a person again%'),
  'and asking again is said at the channel''s top level');
set local role service_role;
select tests.ok(public.support_inbound(:'c1', 'it''s Bnayet Saad now'), 'a customer message during the handoff joins the thread');
select tests.throws(format($$select public.support_reply(%L, %L, 'hello')$$, :'case_id', :'owner'), 'not allowed', 'a merchant is not support');
select public.support_reply(:'case_id', :'op', 'Done, the driver has the new building', 'slack', 'slack:Ev1') as rp \gset
select tests.ok(public.support_reply(:'case_id', :'op', 'Done, the driver has the new building', 'slack', 'slack:Ev1') ->> 'status' = 'duplicate',
  'a Slack retry of the same event is not sent twice');
reset role;
select tests.ok((select payload ->> 'kind' = 'support_reply' and payload ->> 'name' = 'Operator' and payload ->> 'text' like 'Done%'
                 from public.outbound_messages where dedupe_key = 'support:' || (:'rp'::jsonb ->> 'message_id')),
  'the reply is queued to the customer on WhatsApp, signed by the operator');
select tests.ok((select handoff_until > now() from public.bot_sessions where customer_id = :'c1'), 'the bot stays quiet while a person talks');
set local role service_role;
select public.support_message_status((:'rp'::jsonb ->> 'message_id')::bigint, 'held');
select public.support_pending(:'c1') as pend \gset
select tests.ok(:'pend'::jsonb -> 0 ->> 'text' like 'Done%' and public.support_pending(:'c1') = :'pend'::jsonb,
  'a held reply stays held until it has been sent (a replayed turn finds it again)');
select tests.ok(public.support_shown(:'c1', array[(:'pend'::jsonb -> 0 ->> 'id')::bigint]) = 1, 'once sent it is marked shown');
select tests.ok(public.support_pending(:'c1') = '[]' and public.support_shown(:'c1', array[(:'pend'::jsonb -> 0 ->> 'id')::bigint]) = 0,
  'once');
select tests.ok(public.support_resolve(:'case_id', :'op') ->> 'status' = 'resolved', 'Resolve closes the case');
reset role;
select tests.ok((select handoff_until is null from public.bot_sessions where customer_id = :'c1')
  and exists (select 1 from public.outbound_messages where dedupe_key = 'support-closed:' || :'case_id'), 'and hands the customer back to the assistant');
set local role service_role;
-- The customer leaves the handoff on their own ("menu"): the case closes, and the next handoff is a new case and a new thread.
select (public.customer_handoff(:'c1', 'second time', 'lost the driver') ->> 'case_id') as case2 \gset
select public.customer_handoff_end(:'c1');
reset role;
select tests.ok((select status = 'resolved' and resolved_by is null from public.support_cases where id = :'case2')
  and exists (select 1 from public.slack_messages where thread_key = 'case:' || :'case2' and text like '%went back to the assistant%'),
  'leaving the handoff closes the case, said in its thread');
set local role service_role;
select (public.customer_handoff(:'c1', 'third time', 'still lost') ->> 'case_id') as case3 \gset
reset role;
select tests.ok(:'case3' <> :'case2' and exists (select 1 from public.slack_messages where thread_key = 'case:' || :'case3' and text like '%needs a person%'),
  'the next handoff opens a new case with its own #support post');
-- The handoff runs out with nobody answering: the case stays open, and the morning reply still reaches the customer.
update public.bot_sessions set handoff_until = now() - interval '1 second' where customer_id = :'c1';
select app_private.recovery_tick();
select tests.ok((select status = 'open' from public.support_cases where id = :'case3'), 'a handoff that ran out keeps its case open');
set local role service_role;
select tests.ok(public.support_reply(:'case3', :'op', 'Good morning, sorting it now') ->> 'status' = 'queued', 'so a late reply is still sent (or held behind the template)');
reset role;
-- Nobody writes in it for support_case_idle_hours: it closes; a reply after that is refused with a note in its thread.
update public.support_cases set opened_at = now() - interval '49 hours' where id = :'case3';
update public.support_messages set created_at = now() - interval '49 hours' where case_id = :'case3';
select app_private.recovery_tick();
select tests.ok((select status = 'resolved' from public.support_cases where id = :'case3'), 'an idle case closes after support_case_idle_hours');
set local role service_role;
select tests.ok(public.support_reply(:'case3', :'op', 'late answer') ->> 'status' = 'not_open', 'a reply to a closed case is not sent');
reset role;
select tests.ok(exists (select 1 from public.slack_messages where thread_key = 'case:' || :'case3' and text like '⚠️ Not sent%'),
  'and the operator is told so in the thread');
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
update public.orders set status = 'preparing' where id = :'order1';
select app_private.recovery_tick();
select tests.ok((select count(*) = 1 from public.order_exceptions where order_id = :'order1' and kind = 'late_ready' and status = 'open'),
  'preparing is still not ready: the exception stays open (verified close covers every state)');
select tests.ok((select count(*) = 1 from public.outbound_messages where order_id = :'order1' and purpose = 'ready_check')
  and exists (select 1 from public.outbound_messages where dedupe_key = 'ready_check:' || :'order1'),
  'one ready-check card, the same one order_monitor would send');
select tests.ok(not exists (select 1 from public.slack_messages where text ~ '\+961'), 'no phone number is posted to Slack');
set local role service_role;

-- 4. Operator actions ----------------------------------------------------------------------------------------------------------
select tests.ok(public.ops_operator(p_phone_e164 => '+96171000001') is null, 'a merchant''s phone is not an operator');
reset role;
insert into public.operator_phones (phone_e164, operator_user_id) values ('+96170009999', :'op');
insert into public.operator_slack (slack_user_id, operator_user_id) values ('U0TESTADMIN', :'admin');
set local role service_role;
select tests.ok(public.ops_operator(p_phone_e164 => '+96170009999') ->> 'role' = 'operator'
  and public.ops_operator(p_slack_user_id => 'U0TESTADMIN') ->> 'role' = 'admin', 'Slack users and phones map to operators');
reset role;
insert into public.whatsapp_numbers (phone_number_id, display_phone, role) values ('PNID-OPS-C', '+96170888888', 'customer');
set local role service_role;
select tests.ok(public.ops_operator(p_phone_e164 => '+96170009999', p_phone_number_id => 'PNID-OPS-C') is null,
  'on the Customer number an operator''s phone is a customer, not an admin');
select tests.throws(format($$select public.ops_order(%L, 'TESTA2')$$, :'owner'), 'not allowed', 'only operators look orders up');
select tests.ok(public.ops_order(:'op', 'testa2') ->> 'order_status' = 'preparing' and not (public.ops_order(:'op', 'testa2')::text ~ '\+961'),
  'an order card for operators, without the customer''s phone');
-- The fixture order is $12.50, under the $20 limit: the test lowers the dated limit to $5 for this transaction.
reset role;
insert into public.app_config (key, value, effective_from, note)
select 'dispute_rules', public.config_value('dispute_rules') || '{"owner_over_usd": 5}', now() - interval '1 millisecond', 'test';
set local role service_role;
select tests.throws(format($$select public.ops_refund(%L, 'TESTA2', 6)$$, :'op'), 'over the owner limit',
  'above dispute_rules.owner_over_usd only the admin (the same limit as every dispute)');
select tests.throws(format($$select public.ops_refund(%L, 'TESTA2', 999)$$, :'admin'), 'exceed its total', 'never more than the order');
select tests.throws(format($$select public.ops_refund(%L, 'TESTA2', 5, 'slack', 'driver')$$, :'op'), 'the payer', 'Alo King or the shop pays');
select tests.ok(public.ops_refund(:'op', 'TESTA2', 5, 'slack', 'merchant') ->> 'status' = 'credited', 'an operator refunds $5 as a customer credit');
reset role;
select tests.ok((select count(*) = 0 from public.order_disputes d where d.customer_id = (select customer_id from public.orders where id = :'order1')
                 and d.decision in ('auto_credit', 'approved', 'review', 'owner_review') and d.rule not like 'operator %'),
  'an operator refund is not the customer''s dispute (dispute_open leaves rule ''operator …'' out of the rate)');
set local role service_role;
select tests.ok(public.ops_refund(:'op', 'TESTA2', 5) ->> 'status' = 'already', 'a repeated or retried confirm books nothing twice');
reset role;
select tests.ok((select d.payer = 'merchant' and d.decision = 'approved' and d.ledger_tx is not null and c.dispute_id = d.id
                 from public.order_disputes d join public.customer_credits c on c.id = d.credit_id
                 where d.order_id = :'order1' and d.kind = 'other'),
  'booked as a dispute (dispute_book): the shop pays, and the credit expires back through credits_expire');
select tests.ok((select sum(e.amount) = 0 from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
                 where t.idempotency_key like 'dispute:%'), 'a balanced ledger transaction');
set local role service_role;
select tests.ok(public.ops_credit(:'admin', '20000000-0000-0000-0000-00000000000a', 30, 'launch compensation', 'slack', 'V0TEST') ->> 'status' = 'credited'
  and public.ops_credit(:'admin', '20000000-0000-0000-0000-00000000000a', 30, 'launch compensation', 'slack', 'V0TEST') ->> 'status' = 'already',
  'the admin credits a merchant with a reason, once per confirm');
select tests.throws(format($$select public.ops_credit(%L, '20000000-0000-0000-0000-00000000000a', 600, 'too much')$$, :'admin'), 'at most',
  'never above ops_credit_max_usd');
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
