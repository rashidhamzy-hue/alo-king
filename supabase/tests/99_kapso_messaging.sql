-- Session 5b (DECISIONS §3, §18.3, §39.8): the 24-hour window per business number, templates outside it (approved on the
-- sending number's account, or a dry run for simulator numbers), broadcasts only to opted-in customers and never after STOP,
-- switched off until the pilot gate, and the menu model under the daily AI budget.
begin;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
\set sandbox '''597907523413541'''
\set c1 '10000000-0000-0000-0000-000000000001'
\set c2 '10000000-0000-0000-0000-000000000002'

-- 1. The window per business number -------------------------------------------------------------------------------------
select public.whatsapp_seen('+96170000001', :sandbox);
select tests.ok(public.whatsapp_window_open('+96170000001', :sandbox), 'a message to the sandbox opens the window there');
select tests.ok(not public.whatsapp_window_open('+96170000001', '15550001111'), 'but not on another business number');
select tests.ok(not public.whatsapp_window_open('+96170000002', :sandbox), 'nor for someone who never wrote');
reset role;
update app_private.whatsapp_windows set last_inbound_at = now() - interval '23 hours 55 minutes' where phone_e164 = '+96170000001';
set local role service_role;
select tests.ok(not public.whatsapp_window_open('+96170000001', :sandbox), 'ten minutes before the 24 hours end it counts as closed');

-- 2. The US test number goes before the sandbox, for customers and merchants -------------------------------------------
reset role;
insert into public.whatsapp_numbers (phone_number_id, role, waba_id, active) values ('15550001111', 'test', '900000000001', true);
set local role service_role;
select tests.ok(public.whatsapp_sender('customer') = '15550001111' and public.whatsapp_sender('merchant') = '15550001111',
  'the test number sends to both sides');

-- 3. Templates ----------------------------------------------------------------------------------------------------------
select tests.ok(public.whatsapp_template_for('accepted', 'ar', '+96170000001', 'customer') is null,
  'no approved template: nothing can carry the message');
select public.whatsapp_template_sync('900000000001', '[
  {"name": "alo_order_confirmed", "language": "ar", "category": "utility", "status": "APPROVED", "kapso_template_id": "k-ar"},
  {"name": "alo_order_confirmed", "language": "en", "category": "utility", "status": "PENDING"},
  {"name": "alo_offer_nearby", "language": "ar", "category": "marketing", "status": "APPROVED", "kapso_template_id": "k-mkt-ar"}]');
select tests.ok(public.whatsapp_template_for('accepted', 'en', '+96170000001', 'customer') = '{"name": "alo_order_confirmed", "lang": "ar", "dry_run": false}',
  'English not approved yet: the Arabic one carries it');
select tests.ok(public.whatsapp_template_for('near_drop', 'ar', '+96170000001', 'customer') is null, 'a kind without a template has none');
reset role;
select tests.ok(exists (select 1 from public.ops_alerts where kind = 'template_status' and summary like '%alo_order_confirmed (ar): approved%'),
  'an approval is an ops note');
set local role service_role;
select public.whatsapp_template_sync('900000000001', '[{"name": "alo_order_confirmed", "language": "ar", "category": "utility", "status": "PAUSED"}]');
select tests.ok(public.whatsapp_template_for('accepted', 'ar', '+96170000001', 'customer') is null, 'a paused template is never sent');
reset role;
select tests.ok((select kapso_template_id from public.whatsapp_templates where name = 'alo_order_confirmed' and language = 'ar') = 'k-ar',
  'a later sync without the Kapso id keeps it');
set local role service_role;
-- Simulator numbers: a dry run while the sink is on (staging), nothing otherwise.
select tests.ok(public.whatsapp_template_for('accepted', 'ar', '+99996100000009', 'customer') is null, 'sink off: no dry run');
reset role;
insert into public.app_config (key, value, effective_from, note) values ('sim_sink_enabled', 'true', now(), 'test');
set local role service_role;
select tests.ok((public.whatsapp_template_for('delivered', 'fr', '+99996100000009', 'customer') ->> 'dry_run')::boolean
  and public.whatsapp_template_for('delivered', 'fr', '+99996100000009', 'customer') ->> 'lang' = 'fr', 'sink on: a dry run in the customer''s language');

-- 4. Customer messages outside the window ----------------------------------------------------------------------------------
reset role;
update public.whatsapp_numbers set active = false where phone_number_id = '15550001111';
select app_private.customer_notify('30000000-0000-0000-0000-000000000001', 'accepted', '{}', 't-accepted-1') as m1 \gset
select tests.ok((select status = 'skipped' from public.outbound_messages where id = :m1),
  'out of the window with no approved template on the sandbox account: skipped as before');
update public.whatsapp_numbers set active = true where phone_number_id = '15550001111';
select public.whatsapp_template_sync('900000000001', '[{"name": "alo_order_confirmed", "language": "ar", "category": "utility", "status": "APPROVED"}]');
select customer_messages as before_n from public.orders where id = '30000000-0000-0000-0000-000000000001' \gset
select app_private.customer_notify('30000000-0000-0000-0000-000000000001', 'accepted', '{}', 't-accepted-2') as m2 \gset
select tests.ok((select status = 'queued' from public.outbound_messages where id = :m2)
  and (select customer_messages = :before_n + 1 from public.orders where id = '30000000-0000-0000-0000-000000000001'),
  'with the approved template it stays queued (dispatch sends the template) and counts toward the budget');
select app_private.customer_notify('30000000-0000-0000-0000-000000000001', 'rejected', '{}', 't-rejected') as m3 \gset
select tests.ok((select status = 'skipped' from public.outbound_messages where id = :m3), 'a kind with no template is still skipped');

-- 5. Broadcasts -------------------------------------------------------------------------------------------------------------
update public.customers set marketing_opt_in = true, marketing_opt_in_at = now() - interval '1 day', language = 'en' where id = :'c1';
set local role service_role;
select tests.throws($$select public.broadcast_create('00000000-0000-0000-0000-00000000000e', 'Wraps week', 'marketing_offer', '{}', '{}')$$,
  'not allowed', 'a merchant is not an operator');
select tests.throws($$select public.broadcast_create('00000000-0000-0000-0000-00000000000b', 'Wraps week', 'accepted', '{}', '{}')$$,
  'marketing template', 'a broadcast never uses a utility template');
select public.broadcast_create('00000000-0000-0000-0000-00000000000b', 'Wraps week', 'marketing_offer',
  '{"shop": "Vendor A", "offer": "20% off wraps"}', '{}') as b1 \gset
select tests.ok((:'b1'::jsonb ->> 'audience')::int = 1, 'only the opted-in customer is in the audience');
select :'b1'::jsonb ->> 'id' as bid \gset
select tests.throws(format($$select public.broadcast_approve('00000000-0000-0000-0000-00000000000b', %L)$$, :'bid'), 'admin',
  'an operator who is not the admin cannot approve marketing');
select tests.ok(public.broadcast_approve('00000000-0000-0000-0000-00000000000a', :'bid') ->> 'enabled' = 'false', 'approved, but the switch is off');
select tests.ok(public.broadcast_claim() is null, 'nothing is sent while broadcasts_enabled is false');
reset role;
insert into public.app_config (key, value, effective_from, note) values ('broadcasts_enabled', 'true', now() - interval '1 second', 'test');
-- STOP between approval and sending: the audience is taken at send time.
update public.customers set marketing_opt_in = true, marketing_opt_in_at = now() - interval '1 day' where id = :'c2';
select public.customer_marketing_set(:'c2', false);
set local role service_role;
select public.broadcast_claim() as claim \gset
select tests.ok(:'claim'::jsonb -> 'groups' = '{"en": ["+96170000001"]}' and :'claim'::jsonb ->> 'template' = 'alo_offer_nearby',
  'the claim takes the opted-in customer in their language and leaves out the one who sent STOP');
select tests.ok(public.broadcast_template_id('alo_offer_nearby', 'ar') = 'k-mkt-ar' and public.broadcast_template_id('alo_offer_nearby', 'en') is null,
  'the Kapso template id per language, approved marketing only');
select public.broadcast_finish(:'bid', true, array['kb-1'], null, '{}');
reset role;
select tests.ok((select status = 'sent' and recipients = 1 and est_usd > 0 from public.broadcasts where id = :'bid')
  and (select status = 'sent' from public.broadcast_recipients where broadcast_id = :'bid'), 'finished and recorded');
-- At most two promotions a week per customer (§20.4): after two, the customer is out of every audience.
reset role;
insert into public.broadcasts (id, name, template_key, status, sent_at) values
  ('5b000000-0000-0000-0000-000000000001', 'Earlier', 'marketing_offer', 'sent', now() - interval '2 days');
insert into public.broadcast_recipients (broadcast_id, customer_id, phone_e164, language, status) values
  ('5b000000-0000-0000-0000-000000000001', :'c1', '+96170000001', 'en', 'sent');
select tests.ok((select count(*) from app_private.broadcast_audience('{}', 100)) = 0,
  'two promotions this week (this one and the earlier one): no third');
delete from public.broadcast_recipients where broadcast_id = '5b000000-0000-0000-0000-000000000001';
set local role service_role;
-- The daily marketing cap.
insert into public.app_config (key, value, effective_from, note) values ('broadcast_daily_usd', '0.01', now(), 'test');
set local role service_role;
select (public.broadcast_create('00000000-0000-0000-0000-00000000000b', 'Second', 'marketing_new_shop', '{"shop": "A", "village": "B"}', '{}')) ->> 'id' as bid2 \gset
select public.broadcast_approve('00000000-0000-0000-0000-00000000000a', :'bid2');
select tests.ok(public.broadcast_claim() is null, 'over the daily marketing budget: not sent');
reset role;
select tests.ok((select status = 'failed' and last_error like '%budget%' from public.broadcasts where id = :'bid2')
  and exists (select 1 from public.ops_alerts where kind = 'broadcast'), 'it fails with a reason and an ops alert');
set local role service_role;
select public.broadcasts_pause('00000000-0000-0000-0000-00000000000b');
select tests.ok(not (public.config_value('broadcasts_enabled') #>> '{}')::boolean, 'the kill switch turns broadcasts off at once');
-- Meta's own opt-out arrives as an event.
select public.customer_marketing_stop_by_phone('+96170000001', true);
reset role;
select tests.ok((select not marketing_opt_in from public.customers where id = :'c1'), 'a STOP inside WhatsApp opts the customer out');

-- 6. The menu model under the daily AI budget ---------------------------------------------------------------------------------
set local role service_role;
select tests.ok((public.ai_quota_take(null, 'menu', 'claude-sonnet-5-5', 0.05) ->> 'ok')::boolean, 'a menu-model call reserves budget');

-- 7. Grants ----------------------------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws($$select public.broadcast_claim()$$, 'permission denied', 'a signed-in customer cannot send broadcasts');
select tests.throws($$select public.whatsapp_template_sync('1', '[]')$$, 'permission denied', 'nor write template statuses');
select tests.ok(tests.count_of('select 1 from public.whatsapp_templates') = 0, 'nor read them');
set local role anon;
select tests.throws($$select public.whatsapp_seen('+96170000001', '597907523413541')$$, 'permission denied', 'anonymous callers record nothing');

rollback;
