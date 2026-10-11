-- Phase 2 part 2: order_channel router, four-layer escalation, acknowledgement, auto-pause, outbox,
-- ops alerts, monitoring tick, merchant proposals, number quality and the portal queue (§13, §23, §27.5,
-- §29.4, §29.6, §30.2).
begin;

update public.vendor_private set owner_mobile = '+96171000001', kitchen_whatsapp = '+96171000005'
where vendor_id = '20000000-0000-0000-0000-00000000000a';
update public.vendors set pickup_enabled = true where id = '20000000-0000-0000-0000-00000000000a';

-- Orders straight into the table (placement is tested in 90_orders.sql).
create function pg_temp.new_order(p_key text) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.orders (code, idempotency_key, customer_id, vendor_id, status, fulfilment, payment_method,
    menu_version, usd_lbp_rate, food_subtotal_usd, total_usd, order_fee_usd, placed_at)
  values (app_private.new_order_code(), 'tests:dispatch:' || p_key, '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-00000000000a', 'placed', 'pickup', 'cod', 1, 89500, 10, 10, 1, now())
  returning id into v_id;
  return v_id;
end;
$$;
create function pg_temp.age(p_order uuid, p_seconds integer) returns jsonb
language sql as $$
  update public.order_dispatch set started_at = now() - make_interval(secs => p_seconds) where order_id = p_order;
  select app_private.order_escalation_tick();
$$;

-- Defaults: primary portal, backup WhatsApp to the kitchen number, call to the owner mobile.
select tests.ok((select (primary_channel, backup_channel, backup_target, call_target)
                 = ('portal'::public.order_channel_kind, 'whatsapp'::public.order_channel_kind, '+96171000005', '+96171000001')
                 from app_private.vendor_channels('20000000-0000-0000-0000-00000000000a')), 'default channels: portal, then WhatsApp, then call');

-- Escalation, layer by layer ---------------------------------------------------------------------------
select pg_temp.new_order('e1') as e1 \gset
select tests.ok((select stage from public.order_dispatch where order_id = :'e1') = 'primary', 'a placed order starts its dispatch on the primary');
select tests.ok(not exists (select 1 from public.outbound_messages where order_id = :'e1'), 'a portal primary needs no message (the queue alarms)');
select pg_temp.age(:'e1', 10);
select tests.ok((select stage from public.order_dispatch where order_id = :'e1') = 'primary', 'nothing moves before 15 s');
select pg_temp.age(:'e1', 16);
select tests.ok((select stage from public.order_dispatch where order_id = :'e1') = 'backup'
  and exists (select 1 from public.outbound_messages where order_id = :'e1' and channel = 'whatsapp' and purpose = 'new_order' and target = '+96171000005'),
  'at 15 s the backup fires: WhatsApp card to the kitchen');
select pg_temp.age(:'e1', 17);
select tests.ok((select count(*) from public.outbound_messages where order_id = :'e1') = 1, 'a second tick sends nothing twice');

-- The dispatch function claims the card with the order summary built now.
set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select id as m1, card from public.outbox_claim(10) where order_id = :'e1' \gset
select tests.ok((:'card'::jsonb ->> 'code') = (select code from public.orders where id = :'e1')
  and (:'card'::jsonb ->> 'total_lbp')::numeric = 895000 and not (:'card'::jsonb ? 'customer_phone'),
  'the card carries code and totals (USD and LBP), never the customer phone');
select public.outbox_finish(:'m1', 'sent', 'wamid.TEST1');
reset role;

select pg_temp.age(:'e1', 46);
select tests.ok((select stage from public.order_dispatch where order_id = :'e1') = 'call'
  and not exists (select 1 from public.outbound_messages where order_id = :'e1' and channel = 'call'),
  'at 45 s the call layer is reached; no call is placed while voice_calls_enabled is off');
select pg_temp.age(:'e1', 76);
select tests.ok((select stage from public.order_dispatch where order_id = :'e1') = 'operator'
  and exists (select 1 from public.ops_alerts where order_id = :'e1' and kind = 'merchant_not_answering' and severity = 'urgent'),
  'at 75 s the operator is alerted (urgent)');
select pg_temp.age(:'e1', 301);
select tests.ok((select (status, cancel_reason) = ('cancelled'::public.order_status, 'merchant_unreachable'::public.cancel_reason) from public.orders where id = :'e1'),
  'no acknowledgement through all four layers: the order is cancelled');
select tests.ok((select missed_orders_streak from public.vendors where id = '20000000-0000-0000-0000-00000000000a') = 1, 'the missed streak counts 1');
select tests.ok(exists (select 1 from public.outbound_messages where order_id = :'e1' and purpose = 'order_cancelled' and target = '+96171000005'),
  'the kitchen that got the card hears it was cancelled');
select tests.ok((select count(*) from public.order_events where order_id = :'e1' and event like 'escalation_%') = 3, 'backup, call and operator are in the order history');

-- Auto-pause after 3 missed orders in a row (§30.2.2) -------------------------------------------------
select pg_temp.new_order('e2') as e2 \gset
select pg_temp.age(:'e2', 16); select pg_temp.age(:'e2', 46); select pg_temp.age(:'e2', 76); select pg_temp.age(:'e2', 301);
select pg_temp.new_order('e3') as e3 \gset
select pg_temp.new_order('waiting') as w1 \gset
select pg_temp.age(:'e3', 16); select pg_temp.age(:'e3', 46); select pg_temp.age(:'e3', 76); select pg_temp.age(:'e3', 301);
select tests.ok((select paused_until = 'infinity' and pause_reason = 'missed_orders' from public.vendors where id = '20000000-0000-0000-0000-00000000000a'),
  'three missed orders in a row pause the merchant');
select tests.ok((select (status, cancel_reason) = ('cancelled'::public.order_status, 'merchant_paused'::public.cancel_reason) from public.orders where id = :'w1'),
  'its other waiting orders are cancelled');
select tests.ok(exists (select 1 from public.outbound_messages where vendor_id = '20000000-0000-0000-0000-00000000000a' and purpose = 'reactivate' and target = '+96171000001')
  and exists (select 1 from public.ops_alerts where kind = 'merchant_auto_paused'),
  'the owner gets "Reactivate when ready" and the operator an urgent alert');

set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000e');
select tests.ok(public.vendor_reactivate('20000000-0000-0000-0000-00000000000a') ->> 'status' = 'active', 'the owner reactivates');
reset role;
select tests.act_as(null);
select tests.ok((select paused_until is null and missed_orders_streak = 0 from public.vendors where id = '20000000-0000-0000-0000-00000000000a'),
  'pause and streak cleared');

-- Acknowledgement stops the escalation -----------------------------------------------------------------
select pg_temp.new_order('a1') as a1 \gset
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000f');
select tests.ok(public.order_acknowledge(:'a1', 'portal') ->> 'status' = 'acknowledged', 'the cashier opens the order on the portal');
select tests.ok(public.order_acknowledge(:'a1', 'portal') ->> 'status' = 'already_acknowledged', 'opening it again changes nothing');
select tests.ok(tests.count_of(format($$select id from public.merchant_order_queue where id = %L and not alarm$$, :'a1')) = 1,
  'the portal queue shows it without the alarm');
reset role;
select tests.act_as(null);
select pg_temp.age(:'a1', 100);
select tests.ok((select status from public.orders where id = :'a1') = 'placed'
  and not exists (select 1 from public.outbound_messages where order_id = :'a1')
  and exists (select 1 from public.ops_alerts where order_id = :'a1' and kind = 'acknowledged_not_accepted'),
  'acknowledged: no backup or call, but an alert when it is still not accepted after 90 s');

-- A failing primary fires the backup at once; 3 failures in an hour switch to backup for the day --------
insert into public.vendor_order_channels (vendor_id, channel, role, target) values
  ('20000000-0000-0000-0000-00000000000a', 'whatsapp', 'primary', '+96171000005'),
  ('20000000-0000-0000-0000-00000000000a', 'printer', 'backup', 'printer-1');
set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.new_order('f1') as f1 \gset
select id as fm1 from public.outbox_claim(10) where order_id = :'f1' \gset
select public.outbox_finish(:'fm1', 'failed', null, 'Kapso 500');
reset role;
select tests.ok((select stage from public.order_dispatch where order_id = :'f1') = 'backup'
  and exists (select 1 from public.outbound_messages where order_id = :'f1' and channel = 'printer' and target = 'printer-1'),
  'a failed primary send fires the backup immediately');
set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.new_order('f2') as f2 \gset
select pg_temp.new_order('f3') as f3 \gset
select public.outbox_finish(m.id, 'failed', null, 'Kapso 500') from public.outbox_claim(10) m where m.channel = 'whatsapp' and m.purpose = 'new_order';
reset role;
select tests.ok((select use_backup_until > now() from public.vendor_order_channels where vendor_id = '20000000-0000-0000-0000-00000000000a' and role = 'primary')
  and exists (select 1 from public.ops_alerts where kind = 'channel_down'), 'three failures in an hour: backup for the rest of the day, with an alert');
select tests.ok((select primary_channel from app_private.vendor_channels('20000000-0000-0000-0000-00000000000a')) = 'printer',
  'new orders now go to the backup first');

-- Accepting closes the dispatch and resets the streak.
update public.vendors set missed_orders_streak = 2 where id = '20000000-0000-0000-0000-00000000000a';
select public.order_accept(:'f2', 10);
select tests.ok((select stage from public.order_dispatch where order_id = :'f2') = 'acknowledged'
  and (select missed_orders_streak from public.vendors where id = '20000000-0000-0000-0000-00000000000a') = 0, 'an accept acknowledges and resets the streak');
delete from public.vendor_order_channels where vendor_id = '20000000-0000-0000-0000-00000000000a';

-- Monitoring tick (§27.5, merchant mode) ------------------------------------------------------------------
update public.orders set ready_at = now() - interval '6 minutes' where id = :'f2';
select app_private.order_monitor_tick();
select tests.ok(exists (select 1 from public.outbound_messages where order_id = :'f2' and purpose = 'ready_check')
  and exists (select 1 from public.ops_alerts where order_id = :'f2' and kind = 'not_ready'), 'not ready 5 min after ready_at: "ready in?" to the merchant');
select app_private.order_monitor_tick();
select tests.ok((select count(*) from public.outbound_messages where order_id = :'f2' and purpose = 'ready_check') = 1, 'asked once');

-- Merchant proposals: rules or AI propose, the merchant taps (§18.2, §29.4, §30.2.1) ------------------------
insert into public.menu_items (id, vendor_id, name_en, price_usd) values
  ('46000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Knefe', 3.00);
set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'pause',
  jsonb_build_object('until', now() + interval '30 minutes'), 'rules',
  (select id from public.vendor_members where phone_e164 = '+96171000002')) as p1 \gset
select tests.ok((select paused_until from public.vendors where id = '20000000-0000-0000-0000-00000000000a') is null, 'a proposal alone changes nothing');
select tests.ok(public.merchant_proposal_decide(:'p1', true, (select id from public.vendor_members where phone_e164 = '+96171000002')) ->> 'status' = 'confirmed',
  'the cashier taps confirm');
select tests.ok((select paused_until between now() + interval '29 minutes' and now() + interval '31 minutes' from public.vendors where id = '20000000-0000-0000-0000-00000000000a'),
  '"Mrakad 30 mins": paused for 30 minutes');
select tests.ok(public.merchant_proposal_decide(:'p1', true, (select id from public.vendor_members where phone_e164 = '+96171000002')) ->> 'status' = 'confirmed',
  'a second tap is harmless');
select tests.throws($$select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'price',
  '{"item_id": "46000000-0000-0000-0000-000000000001", "price_usd": 4}', 'rules', (select id from public.vendor_members where phone_e164 = '+96171000002'))$$,
  'not allowed', 'a cashier cannot change prices');
select menu_version as mv from public.vendors where id = '20000000-0000-0000-0000-00000000000a' \gset
select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'price',
  '{"item_id": "46000000-0000-0000-0000-000000000001", "price_usd": 3.5}', 'rules', (select id from public.vendor_members where phone_e164 = '+96171000001')) as p2 \gset
select public.merchant_proposal_decide(:'p2', true, (select id from public.vendor_members where phone_e164 = '+96171000001'));
select tests.ok((select price_usd from public.menu_items where id = '46000000-0000-0000-0000-000000000001') = 3.50
  and (select menu_version from public.vendors where id = '20000000-0000-0000-0000-00000000000a') > :mv, '"price knefe 3.5": the owner confirms, price and menu version change');
select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'sold_out',
  '{"item_id": "46000000-0000-0000-0000-000000000001"}', 'rules', (select id from public.vendor_members where phone_e164 = '+96171000002')) as p3 \gset
select tests.ok(public.merchant_proposal_decide(:'p3', false, (select id from public.vendor_members where phone_e164 = '+96171000002')) ->> 'status' = 'rejected'
  and (select available from public.menu_items where id = '46000000-0000-0000-0000-000000000001'), 'a "no" tap leaves the item available');
select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'stock_add',
  '{"item_id": "46000000-0000-0000-0000-000000000001", "add": 10}', 'button', (select id from public.vendor_members where phone_e164 = '+96171000002')) as p4 \gset
select public.merchant_proposal_decide(:'p4', true, (select id from public.vendor_members where phone_e164 = '+96171000002'));
select tests.ok((select (daily_quantity, daily_remaining, daily_date) = (10, 10, current_date) from public.menu_items where id = '46000000-0000-0000-0000-000000000001'),
  '"+10" sets today''s quantity');
select tests.throws($$select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'pause', '{"until": "2020-01-01"}', 'rules',
  (select id from public.vendor_members where phone_e164 = '+96171000002'))$$, 'next 7 days', 'a pause must end in the future');
select tests.ok((select count(*) from public.merchant_members_by_phone('+96171000002')) = 1, 'a WhatsApp number resolves to its membership');
reset role;
update public.merchant_proposals set expires_at = now() - interval '1 second' where id = :'p3';
select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'back_in_stock',
  '{"item_id": "46000000-0000-0000-0000-000000000001"}', 'rules', (select id from public.vendor_members where phone_e164 = '+96171000002')) as p5 \gset
update public.merchant_proposals set expires_at = now() - interval '1 second' where id = :'p5';
select tests.ok(public.merchant_proposal_decide(:'p5', true, (select id from public.vendor_members where phone_e164 = '+96171000002')) ->> 'status' = 'expired',
  'a late tap on an expired proposal applies nothing');

-- WhatsApp number quality (§29.6) -------------------------------------------------------------------------
insert into public.whatsapp_numbers (phone_number_id, display_phone, role) values ('PNID-A', '+96170999999', 'customer');
select (public.webhook_intake('kapso', jsonb_build_array(jsonb_build_object(
  'event_key', 'quality:test-1', 'event_type', 'whatsapp.phone_number.quality', 'phone_number_id', 'PNID-A',
  'payload', jsonb_build_object('entry', jsonb_build_array(jsonb_build_object('changes', jsonb_build_array(jsonb_build_object(
    'field', 'phone_number_quality_update',
    'value', jsonb_build_object('display_phone_number', '96170999999', 'event', 'FLAGGED', 'current_limit', 'TIER_1K')))))))))).event_id as qe \gset
select tests.ok((select (quality_status, marketing_paused, messaging_limit) = ('RED', true, 'TIER_1K') from public.whatsapp_numbers where phone_number_id = 'PNID-A'),
  'a FLAGGED quality update marks the number RED and pauses its marketing');
select tests.ok(exists (select 1 from public.ops_alerts where kind = 'number_quality' and severity = 'urgent')
  and exists (select 1 from public.whatsapp_number_events where webhook_event_id = :qe and event = 'FLAGGED'), 'the admin is alerted and the event stored');
select tests.ok((select count(*) from public.webhook_intake('kapso', '[{"event_key": "odd:1", "event_type": "x", "payload": {"changes": "not-an-array"}}]')) = 1,
  'an odd payload never breaks intake');

-- Fixes from the review of #101 -------------------------------------------------------------------------
update public.vendors set paused_until = null where id = '20000000-0000-0000-0000-00000000000a';
insert into public.menu_items (id, vendor_id, name_en, price_usd, container_deposit_usd) values
  ('46000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', 'Water gallon', 2.00, 6.00);
insert into public.menu_items (id, vendor_id, name_en, price_usd, pricing_unit, est_weight_kg) values
  ('46000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', 'Beef', 20.00, 'kg', 1.0);
update public.baskets set status = 'abandoned' where status = 'open';
insert into public.baskets (id, customer_id, vendor_id, fulfilment) values
  ('47000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', 'pickup');
insert into public.basket_items (basket_id, item_id, quantity) values
  ('47000000-0000-0000-0000-000000000001', '46000000-0000-0000-0000-000000000002', 1);
set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.order_place('47000000-0000-0000-0000-000000000001',
  (public.basket_price('47000000-0000-0000-0000-000000000001') ->> 'menu_version')::bigint, 'tests:fix:container') ->> 'status' = 'needs_empty_answer',
  'a container line needs the "empty to return?" answer before placing');
select tests.throws($$select public.order_place('47000000-0000-0000-0000-000000000001', 1, 'tests:dispatch:a1')$$,
  'another basket', 'an idempotency key used by another order is refused');
reset role;
update public.basket_items set item_id = '46000000-0000-0000-0000-000000000003', has_empty = null
where basket_id = '47000000-0000-0000-0000-000000000001';
set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select (public.order_place('47000000-0000-0000-0000-000000000001',
  (public.basket_price('47000000-0000-0000-0000-000000000001') ->> 'menu_version')::bigint, 'tests:fix:weight') ->> 'order_id') as wo \gset
select public.order_accept(:'wo', 10, (select id from public.vendor_members where phone_e164 = '+96171000001'));
-- 1 kg estimated ($20); 2.6 kg = $52 is above the $50 first-order cash cap.
select tests.ok(public.order_set_weight((select id from public.order_items where order_id = :'wo'), 2.6,
  (select id from public.vendor_members where phone_e164 = '+96171000001')) ->> 'over_cod_cap' = 'true', 'a final cash total above the COD cap is flagged');
select tests.ok((select weight_status from public.orders where id = :'wo') = 'awaiting_customer', 'and waits for the customer''s tap');
reset role;
insert into public.places (id, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-DISPTEST', 'Disptest', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.58 33.68)', 'test');
insert into public.orders (id, code, idempotency_key, customer_id, vendor_id, status, fulfilment, delivery_mode, delivery_place_id,
  payment_method, menu_version, usd_lbp_rate, food_subtotal_usd, total_usd, order_fee_usd, placed_at) values
  ('48000000-0000-0000-0000-000000000001', 'FLEET2', 'tests:dispatch:fleet', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-00000000000a', 'placed', 'delivery', 'fleet', 'LB-CHF-DISPTEST', 'cod', 1, 89500, 10, 10, 1, now());
select public.order_accept('48000000-0000-0000-0000-000000000001', 10);
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000f');
select tests.ok(public.order_progress('48000000-0000-0000-0000-000000000001', 'ready') ->> 'status' = 'ready', 'the kitchen marks a fleet order ready');
select tests.throws($$select public.order_progress('48000000-0000-0000-0000-000000000001', 'picked_up')$$, 'moves through its adapter',
  'merchant staff cannot move a fleet order past ready');
reset role;
select tests.act_as(null);

-- Dispatch wiring and helpers -------------------------------------------------------------------------------
set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(not public.dispatch_secret_ok('x') and not public.dispatch_secret_ok(repeat('0', 64)), 'a wrong dispatch secret is refused');
select tests.throws($$select public.runtime_setting_set('functions_base_url', 'https://evil.example.com/functions/v1')$$, 'must be https',
  'the functions URL must be a supabase.co project URL');
select tests.ok((select public.merchant_member_for('+96171000002', p_order_id => :'f2')) = (select id from public.vendor_members where phone_e164 = '+96171000002'),
  'a tap resolves to the sender''s membership at the order''s vendor');
select tests.ok(public.merchant_member_for('+96171000003', p_order_id => :'f2') is null, 'another merchant''s phone resolves to nothing');
select tests.ok((select item_id from public.menu_item_match('20000000-0000-0000-0000-00000000000a', 'knefeh') limit 1) = '46000000-0000-0000-0000-000000000001',
  'a merchant''s spelling finds the menu item');
select tests.ok(public.order_set_ready_eta(:'f2', 10, (select id from public.vendor_members where phone_e164 = '+96171000002')) ->> 'status' = 'moved',
  '"ready in 10" moves the ready time');
select tests.ok((public.merchant_balance('20000000-0000-0000-0000-00000000000a', (select id from public.vendor_members where phone_e164 = '+96171000001')) ->> 'credit_usd')::numeric = 0,
  'the owner reads the credit balance');
select tests.throws($$select public.merchant_balance('20000000-0000-0000-0000-00000000000a', (select id from public.vendor_members where phone_e164 = '+96171000002'))$$,
  'not allowed', 'a cashier sees no money');
reset role;
select tests.ok(app_private.dispatch_kick() is null, 'no functions URL recorded: the kick does nothing');

-- Access ----------------------------------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-000000000010');
select tests.ok(tests.count_of('select id from public.merchant_order_queue') = 0, 'another merchant''s owner sees nothing in vendor A''s queue');
select tests.throws($$select * from public.outbox_claim(1)$$, 'permission denied', 'merchants cannot claim the outbox');
select tests.ok(tests.count_of('select id from public.ops_alerts') = 0 and tests.count_of('select id from public.outbound_messages') = 0,
  'merchants read no ops alerts and no outbox');
select tests.act_as('00000000-0000-0000-0000-00000000000b');
select tests.ok(tests.count_of('select id from public.ops_alerts') > 0, 'operators read ops alerts');
reset role;
set local role anon;
select tests.act_as(null);
select tests.throws($$select * from public.merchant_order_queue$$, 'permission denied', 'anon has no portal queue');
reset role;

rollback;
