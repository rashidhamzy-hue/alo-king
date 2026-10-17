-- Session 5f part 6 (DECISIONS §39.15.3): testers anywhere in the world. The invite code enrols a number for a while and up
-- to a cap, never a simulator; the owner and Slack remove testers; a tester's pin outside the delivery area is not stored and
-- three demo addresses are offered, quoted from shop_place_routes with no live route call; the demo autopilot plays the shop
-- until someone else acts; demo orders, ratings and ledger rows carry is_demo and never count in a shop's figures.
begin;

select tests.ok(not exists (select 1 from public.app_config where key in ('demo_invite_code', 'demo_autopilot_enabled')),
  'without demo mode the migration makes no invite code and leaves the autopilot off (production)');
select tests.ok(app_private.demo_config_ensure() ->> 'status' = 'off' and not app_private.demo_autopilot_on(),
  'and nothing makes them while demo mode is off');

-- Places: three Shouf villages (switched on by the staging fixture's pilot list) and a Beirut place outside the area -------
insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-DTS', 'CHF', 'Demo testers zone', 'SRID=4326;MULTIPOLYGON(((35.54 33.66,35.60 33.66,35.60 33.71,35.54 33.71,35.54 33.66)))', 'test'),
  ('TZ-DTB', 'BEY', 'Demo testers city zone', 'SRID=4326;MULTIPOLYGON(((35.47 33.88,35.50 33.88,35.50 33.91,35.47 33.91,35.47 33.88)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-DTS', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.563548 33.677392)', 'test'),
  ('LB-CHF-DEIR-AL-QAMAR', 'TZ-DTS', 'دير القمر', 'Deir Al Qamar', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.564743 33.697969)', 'test'),
  ('LB-CHF-BEITEDDINE', 'TZ-DTS', 'بيت الدين', 'Beiteddine', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.581201 33.694184)', 'test'),
  ('LB-BEY-HAMRA-DT', 'TZ-DTB', 'الحمرا', 'Hamra', 'town', 'beirut', 'BEY', 'SRID=4326;POINT(35.4823 33.8966)', 'test');

-- The shop: the staging grill stands in for a real Shouf shop in demo mode, the owner's phone as its merchant -------------
select set_config('app.fixture_owner_phone', '+96170000181', false);
\i supabase/test-fixtures/alo-test-grill.sql
select tests.ok(public.test_side_set('+96170000181', 'merchant') ->> 'status' = 'ok', 'the owner is the shop''s merchant');
select public.test_side_set('+96170000181', 'customer');
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Falafel Sandwich') as falafel \gset
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Pepsi') as pepsi \gset
select (select m.id from public.vendor_members m where m.vendor_id = :'tv' and m.phone_e164 = '+96170000181') as owner_member \gset
update public.vendors set is_test = false, town_id = 'LB-CHF-BAAKLINE', location = 'SRID=4326;POINT(35.5640 33.6770)' where id = :'tv';
insert into public.app_config (key, value, effective_from, note)
values ('demo_shops', jsonb_build_array(jsonb_build_object('id', :'tv', 'name', 'Alo Test Grill')), now() - interval '10 seconds', 'test');
select tests.ok(app_private.vendor_is_demo(:'tv') and (select service_status = 'on' from public.places where id = 'LB-CHF-DEIR-AL-QAMAR')
  and (select service_status = 'off' from public.places where id = 'LB-BEY-HAMRA-DT'), 'demo mode on, the area on, Beirut off');
select public.shop_place_routes_save(jsonb_build_array(
  jsonb_build_object('vendor_id', :'tv', 'place_id', 'LB-CHF-DEIR-AL-QAMAR', 'road_km', 3.1, 'minutes', 8,
    'origin_lat', 33.6770, 'origin_lon', 35.5640, 'dest_lat', 33.697969, 'dest_lon', 35.564743),
  jsonb_build_object('vendor_id', :'tv', 'place_id', 'LB-CHF-BAAKLINE', 'road_km', 0.6, 'minutes', 2,
    'origin_lat', 33.6770, 'origin_lon', 35.5640, 'dest_lat', 33.677392, 'dest_lon', 35.563548)));

-- 1. The invite code ----------------------------------------------------------------------------------------------------
savepoint ensure_first;
select tests.ok(app_private.demo_config_ensure() ->> 'added' = '["demo_invite_code", "demo_autopilot_enabled"]',
  'with demo mode on, the invite code is made in the database and the autopilot switched on');
rollback to savepoint ensure_first;
-- As on staging after the first deploy: the switch already in force (so this test can turn it off later in its transaction).
insert into public.app_config (key, value, effective_from, note) values ('demo_autopilot_enabled', 'true', now() - interval '9500 milliseconds', 'test');
select tests.ok(app_private.demo_config_ensure() ->> 'added' = '["demo_invite_code"]', 'a switch already set is left as it is');
select public.config_value('demo_invite_code') #>> '{}' as code \gset
select tests.ok(:'code' ~ '^ALO[0-9A-F]{8}$', 'the code is ALO and 8 random hex characters');
select tests.ok(app_private.demo_config_ensure() ->> 'added' = '[]' and app_private.demo_autopilot_on(),
  'made once: running it again (every staging deploy) changes nothing');
select tests.ok((select count(*) = 1 from public.app_config where key = 'demo_invite_code'), 'one code row');
select tests.ok(public.config_numeric('demo_tester_days') = 14 and public.config_numeric('demo_tester_max') = 30
  and public.config_numeric('demo_autopilot_after_s') = 60 and public.config_numeric('demo_autopilot_step_s') = 60
  and public.config_numeric('demo_autopilot_prep_min') = 15, 'the dated defaults');

-- 2. Enrolment ------------------------------------------------------------------------------------------------------------
select (public.customer_turn_begin('+447700900001', 'wamid.dt.1', 'text', 'UK tester') #>> '{customer,id}') as t1 \gset
select (public.customer_turn_begin('+33612345678', 'wamid.dt.2', 'text', 'Paris tester') #>> '{customer,id}') as t2 \gset
select (public.customer_turn_begin('+14155550100', 'wamid.dt.3', 'text', 'SF tester') #>> '{customer,id}') as t3 \gset
select (public.customer_turn_begin('+96170000182', 'wamid.dt.4', 'text', 'Local customer') #>> '{customer,id}') as real \gset
select (public.customer_turn_begin('+99996100000183', 'wamid.dt.5', 'text', 'Simulator') #>> '{customer,id}') as sim \gset
select (public.customer_turn_begin('+96170000181', 'wamid.dt.6', 'text', 'Rasheed') #>> '{customer,id}') as owner \gset

select tests.ok(public.demo_tester_enrol(:'t1', 'hello there') ->> 'status' = 'no_code', 'a message without the code: no_code');
select tests.ok(public.demo_tester_enrol(:'t1', 'Hi! ALO00000000') ->> 'status' = 'no_code', 'a wrong code: no_code');
select tests.ok(public.demo_tester_enrol(:'t1', 'hi ' || lower(:'code') || ' :)') ->> 'status' = 'enrolled',
  'the code anywhere in the message, any case: enrolled');
select tests.ok(app_private.is_demo_tester(:'t1') and app_private.demo_player(:'t1'), 'now an active tester');
select tests.ok((select expires_at between now() + interval '13 days 23 hours' and now() + interval '14 days 1 hour'
  and phone_e164 = '+447700900001' from app_private.demo_testers where customer_id = :'t1'), 'for demo_tester_days (14)');
select tests.ok(public.demo_tester_enrol(:'t1', :'code') ->> 'status' = 'already'
  and (select count(*) = 1 from app_private.demo_testers where customer_id = :'t1'), 'sending it again: already, one row');
select tests.ok(public.demo_tester_enrol(:'sim', :'code') ->> 'status' = 'off'
  and not exists (select 1 from app_private.demo_testers where customer_id = :'sim'), 'a simulator number is never enrolled');
select tests.ok(not app_private.is_demo_tester(:'real') and not app_private.demo_player(:'real') and app_private.demo_player(:'owner'),
  'a customer who never sent the code is no tester; the owner plays along anyway');
select set_config('app.actor_kind', '', true);
-- The cap (demo_tester_max): 2 here.
insert into public.app_config (key, value, effective_from, note) values ('demo_tester_max', '2', now() - interval '9 seconds', 'test');
select tests.ok(public.demo_tester_enrol(:'t2', :'code') ->> 'status' = 'enrolled', 'a second tester fits');
select tests.ok(public.demo_tester_enrol(:'t3', :'code') ->> 'status' = 'full' and not app_private.is_demo_tester(:'t3'),
  'a third is told the test is full');
select set_config('app.actor_kind', '', true);
-- Demo mode off: no enrolment.
insert into public.app_config (key, value, effective_from, note) values ('demo_shops', '[]', now() - interval '8 seconds', 'test');
select tests.ok(public.demo_tester_enrol(:'t3', :'code') ->> 'status' = 'off', 'demo mode off: off');
select tests.ok(not app_private.demo_autopilot_on() and not app_private.demo_addresses_for(:'t1'),
  'and neither the autopilot nor the demo addresses act');
insert into public.app_config (key, value, effective_from, note)
values ('demo_shops', jsonb_build_array(jsonb_build_object('id', :'tv', 'name', 'Alo Test Grill')), now() - interval '7 seconds', 'test');

-- Removal and expiry ---------------------------------------------------------------------------------------------------------
select tests.ok(public.demo_tester_remove_by_owner('+96170000182', '+33612345678') ->> 'status' = 'not_owner'
  and app_private.is_demo_tester(:'t2'), 'only an owner''s phone removes a tester');
select tests.ok(public.demo_tester_remove_by_owner('+96170000181', '+33600000000') ->> 'status' = 'not_found',
  'an unknown number: not_found');
select tests.ok(public.demo_tester_remove_by_owner('+96170000181', '+33612345678') ->> 'status' = 'removed',
  '`tester remove +…` from the owner''s phone removes the tester');
select tests.ok(not app_private.is_demo_tester(:'t2'), 'who is no longer a tester');
select tests.ok((select removed_by = 'owner +96170000181' from app_private.demo_testers where customer_id = :'t2'), 'and records who');
select tests.ok(public.demo_tester_enrol(:'t2', :'code') ->> 'status' = 'removed' and not app_private.is_demo_tester(:'t2'),
  'the code does not bring a removed tester back');
select tests.ok(public.demo_tester_enrol(:'t3', :'code') ->> 'status' = 'enrolled', 'a removed tester frees a place under the cap');
select set_config('app.actor_kind', '', true);
update app_private.demo_testers set enrolled_at = now() - interval '15 days', expires_at = now() - interval '1 day' where customer_id = :'t3';
select tests.ok(not app_private.is_demo_tester(:'t3'), 'a tester expires after demo_tester_days');
select tests.ok(public.demo_tester_enrol(:'t3', :'code') ->> 'status' = 'enrolled', 'an expired tester who sends the code again');
select tests.ok(app_private.is_demo_tester(:'t3'), 'starts a new period');
select set_config('app.actor_kind', '', true);
-- Slack: /ak testers lists them, masked; /ak tester remove +… removes one, logged.
select tests.ok(jsonb_array_length(public.ops_demo_testers('00000000-0000-0000-0000-00000000000b') -> 'testers') = 2
  and (public.ops_demo_testers('00000000-0000-0000-0000-00000000000b') #>> '{testers,0,phone}') = '+447••••••001'
  and (public.ops_demo_testers('00000000-0000-0000-0000-00000000000b') #>> '{testers,0,name}') = 'UK',
  '/ak testers lists the active testers, numbers masked and first names only (Slack is not the record)');
select tests.ok(public.ops_demo_tester_remove('00000000-0000-0000-0000-00000000000b', '+14155550100') ->> 'status' = 'removed',
  '/ak tester remove +… removes one');
select tests.ok(not app_private.is_demo_tester(:'t3'), 'gone from the testers');
select tests.ok(exists (select 1 from public.ops_actions where action = 'demo_tester_remove' and args ->> 'phone' = '+141•••••100'),
  'and the operator''s action is logged, masked');
select tests.throws($$select public.ops_demo_testers('00000000-0000-0000-0000-00000000000c')$$, 'not allowed',
  'someone who is not an operator cannot list them');
select set_config('app.actor_kind', '', true);

-- 4. Demo addresses ----------------------------------------------------------------------------------------------------------
select count(*) as addr0 from public.addresses where customer_id = :'t1' \gset
select public.address_save_pin(:'t1', 48.8584, 2.2945) as paris \gset
select tests.ok(:'paris'::jsonb ->> 'status' = 'demo_outside'
  and :'paris'::jsonb -> 'choices' = '[{"key": "baakleen", "name_ar": "بعقلين", "name_en": "Baakleen", "name_fr": "Baakline"},
    {"key": "deir_el_qamar", "name_ar": "دير القمر", "name_en": "Deir el Qamar", "name_fr": "Deir el Qamar"},
    {"key": "beiteddine", "name_ar": "بيت الدين", "name_en": "Beiteddine", "name_fr": "Beiteddine"}]'::jsonb,
  'a tester''s pin in Paris: the three demo addresses');
select public.address_save_pin(:'t1', 33.8966, 35.4823) as hamra \gset
select tests.ok(:'hamra'::jsonb ->> 'status' = 'demo_outside' and :'hamra'::jsonb #>> '{place,name_en}' = 'Hamra',
  'a pin in Lebanon outside the delivery area: the same, naming the place');
select tests.ok((select count(*) from public.addresses where customer_id = :'t1') = :addr0
  and not exists (select 1 from public.route_cache where dest_key in ('48.8584,2.2945', '33.8966,35.4823')),
  'the tester''s real pins are stored nowhere');
select tests.ok(public.address_save_pin(:'owner', 48.8584, 2.2945) ->> 'status' = 'demo_outside', 'an owner gets them too');
select tests.ok(public.address_save_pin(:'real', 48.8584, 2.2945) #>> '{status}' = 'outside_lebanon'
  and public.address_save_pin(:'real', 33.8966, 35.4823) #>> '{address,place_status}' = 'off',
  'a real customer who is not a tester keeps today''s answers (outside Lebanon; a place that is off, saved as before)');
select tests.ok(public.address_save_pin(:'t1', 33.6775, 35.5645) #>> '{address,place_status}' = 'on',
  'a tester''s pin inside the area is saved as usual');
select public.demo_address_pick(:'t1', 'deir_el_qamar') as dq \gset
select (:'dq'::jsonb #>> '{address,address_id}') as daid \gset
select tests.ok(:'dq'::jsonb ->> 'status' = 'saved' and (:'dq'::jsonb ->> 'new')::boolean
  and (select place_id = 'LB-CHF-DEIR-AL-QAMAR' and demo_key = 'deir_el_qamar' and pin is not null from public.addresses where id = :'daid'),
  'picking Deir el Qamar makes the tester''s address at its fixed point, in its place');
select tests.ok(not (public.demo_address_pick(:'t1', 'deir_el_qamar') ->> 'new')::boolean
  and (select count(*) = 1 from public.addresses where customer_id = :'t1' and demo_key = 'deir_el_qamar'), 'picking it again reuses it');
select tests.ok(public.demo_address_pick(:'t1', 'mars') ->> 'status' = 'unknown', 'an unknown key: unknown');
select tests.ok(public.demo_address_pick(:'real', 'baakleen') ->> 'status' = 'not_allowed'
  and not exists (select 1 from public.addresses where customer_id = :'real' and demo_key is not null),
  'a customer who is not a tester cannot pick one');
-- Fees and distances from shop_place_routes, and no live route call at checkout.
select tests.ok(public.basket_add_item(:'t1', :'falafel', 1, '{}', null, true) ->> 'status' = 'added', 'the tester fills a basket');
select public.demo_address_pick(:'t1', 'deir_el_qamar');
select tests.ok((select address_id from public.baskets where customer_id = :'t1' and status = 'open') = :'daid',
  'picking a demo address while ordering confirms it for the basket, as a pin does');
select tests.ok(public.customer_delivery_check(:'t1', array[:'tv'::uuid]) #>> '{vendors,0,route_source}' = 'place_fallback',
  'browse quotes from the shop → place distance');
-- Send Home from a tester: a pretend order is offered only to someone in the test (the reviewer's probe).
savepoint gift_probe;
select (public.customer_turn_begin('+96170999888', 'wamid.dt.mum', 'text', 'Mum') #>> '{customer,id}') as mum \gset
insert into public.whatsapp_numbers (phone_number_id, waba_id, display_phone, role)
select 'pn-dt', 'waba-dt', '+12036602328', 'test' where not exists (select 1 from public.whatsapp_numbers);
insert into app_private.whatsapp_windows (phone_e164, phone_number_id, last_inbound_at)
select p, public.whatsapp_sender_for('customer', p), now() from unnest(array['+96170999888', '+447700900005']) p
on conflict do nothing;
select public.address_set_for_whom(:'t1', :'daid', 'other', false);
select public.address_set_recipient(:'t1', :'daid', 'Mum', '+96170999888');
select public.basket_address_state(:'t1');
select public.basket_quote(:'t1');
select b.id as gbid, b.priced_menu_version as gver from public.baskets b where b.customer_id = :'t1' and b.status = 'open' \gset
select tests.ok(public.gift_request_create(:'t1', :'gbid', :'gver') ->> 'status' = 'demo_recipient',
  'a tester''s gift to someone outside the test is refused (demo_recipient)');
select tests.ok(not exists (select 1 from public.gift_requests where recipient_phone = '+96170999888')
  and not exists (select 1 from public.outbound_messages where target = '+96170999888'),
  'and nothing at all is queued to that number');
select (public.customer_turn_begin('+447700900005', 'wamid.dt.friend', 'text', 'Friend') #>> '{customer,id}') as t5 \gset
select tests.ok(public.demo_tester_enrol(:'t5', :'code') ->> 'status' = 'enrolled', 'a friend joins the test');
select set_config('app.actor_kind', '', true);
select public.address_set_recipient(:'t1', :'daid', 'Friend', '+447700900005');
select public.basket_address_state(:'t1');
select public.basket_quote(:'t1');
select b.priced_menu_version as gver from public.baskets b where b.customer_id = :'t1' and b.status = 'open' \gset
select public.gift_request_create(:'t1', :'gbid', :'gver') as gift \gset
select tests.ok(:'gift'::jsonb ->> 'status' = 'asked'
  and (select status = 'queued' from public.outbound_messages where dedupe_key = 'gift:' || (:'gift'::jsonb ->> 'gift_id')),
  'a tester''s gift to another tester still works (asked, the message queued to them)');
rollback to savepoint gift_probe;
select public.address_set_for_whom(:'t1', :'daid', 'self', true);
select public.basket_quote(:'t1') as q \gset
select tests.ok(:'q'::jsonb ->> 'status' = 'ok' and (:'q'::jsonb ->> 'road_km')::numeric = 3.1
  and :'q'::jsonb ->> 'route_source' = 'place_fallback' and (:'q'::jsonb ->> 'delivery_fee_usd')::numeric > 0,
  'checkout: the real fee for 3.1 road km from shop_place_routes');
select tests.ok(:'q'::jsonb -> 'origin' is null and :'q'::jsonb -> 'dest' is null,
  'and no pins handed back: a demo address never makes the one live ORS call');

-- 6. is_demo on orders, and messages that never reach a real shop -------------------------------------------------------------
select b.id as bid, b.priced_menu_version as ver from public.baskets b where b.customer_id = :'t1' and b.status = 'open' \gset
select public.order_place(:'bid', :'ver', 'test:dt:o1') as o1 \gset
select (:'o1'::jsonb ->> 'order_id') as o1 \gset
select tests.ok(:'o1' is not null and (select is_demo and status = 'placed' and delivery_code_required from public.orders where id = :'o1'),
  'the tester''s order is placed as a demo order (a new customer''s: the delivery code applies)');
create function pg_temp.order_at(p_vendor uuid, p_customer uuid, p_key text, p_status text default 'placed') returns uuid
language plpgsql as $$
declare
  v uuid;
begin
  insert into public.orders (code, idempotency_key, customer_id, vendor_id, status, fulfilment, payment_method, menu_version,
    usd_lbp_rate, food_subtotal_usd, total_usd, order_fee_usd, placed_at)
  values (translate(upper(left(md5(p_key), 6)), '01IO', '2345'), p_key, p_customer, p_vendor, 'placed', 'pickup', 'cod', 1,
    public.usd_lbp_rate(), 2, 2, 0, now())
  returning id into v;
  if p_status = 'delivered' then
    perform app_private.order_accept(v, 10, null, 'test');
    perform app_private.order_progress(v, 'delivered', null, 'test');
  end if;
  return v;
end;
$$;
-- A demo order at a shop that is no longer a demo shop (the fixture puts a shop that leaves demo mode back as a listing,
-- its demo orders stay): made with the flag set, as it was when the order was placed.
create function pg_temp.demo_order_at(p_vendor uuid, p_customer uuid, p_key text, p_status text default 'placed') returns uuid
language plpgsql as $$
declare
  v uuid;
begin
  alter table public.orders disable trigger orders_is_demo;
  v := pg_temp.order_at(p_vendor, p_customer, p_key);
  update public.orders set is_demo = true where id = v;
  alter table public.orders enable trigger orders_is_demo;
  if p_status = 'delivered' then
    perform app_private.order_accept(v, 10, null, 'test');
    perform app_private.order_progress(v, 'delivered', null, 'test');
  end if;
  return v;
end;
$$;
select pg_temp.order_at('20000000-0000-0000-0000-00000000000a', :'real', 'test:dt:real-a') as real_a \gset
select pg_temp.order_at(:'tv', :'real', 'test:dt:real-tv') as real_tv \gset
select tests.ok(not (select is_demo from public.orders where id = :'real_a'), 'a real customer at a real shop: not demo');
select tests.ok((select is_demo from public.orders where id = :'real_tv'), 'anyone at a demo shop: demo');
update public.orders set is_demo = true where id = :'real_a';
update public.orders set is_demo = false where id = :'real_tv';
select tests.ok(not (select is_demo from public.orders where id = :'real_a') and (select is_demo from public.orders where id = :'real_tv'),
  'the flag never changes after the order is placed');

-- 7. Testers order only from the demo shops ------------------------------------------------------------------------------------
insert into public.menu_items (vendor_id, name_en, price_usd) values ('20000000-0000-0000-0000-00000000000a', 'Real Shop Wrap', 3)
returning id as real_item \gset
select tests.ok(not exists (select 1 from public.vendor_search(null, null, null, null, null, 10, :'t1')
                            where vendor_id = '20000000-0000-0000-0000-00000000000a')
  and exists (select 1 from public.vendor_search(null, null, null, null, null, 10, :'t1') where vendor_id = :'tv')
  and exists (select 1 from public.vendor_search(null, null, null, null, null, 10, :'real')
              where vendor_id = '20000000-0000-0000-0000-00000000000a'),
  'a tester sees only the demo shops (a real customer still sees the real shop)');
select tests.ok(public.basket_add_item(:'t1', :'real_item', 1, '{}', null, true) ->> 'status' = 'demo_only'
  and not exists (select 1 from public.baskets where customer_id = :'t1' and vendor_id = '20000000-0000-0000-0000-00000000000a'),
  'a tester''s basket at a shop that is not a demo shop is refused (demo_only): no basket is made');
select public.cart_merge(:'t1', 'wamid.dt.cart', jsonb_build_array(jsonb_build_object('item_id', :'real_item', 'quantity', 1))) as cm \gset
select tests.ok((:'cm'::jsonb ->> 'added')::int = 0 and :'cm'::jsonb #>> '{skipped,0,status}' = 'demo_only',
  'a catalogue cart from that shop adds nothing (each line demo_only)');
select tests.ok(public.basket_add_item(:'real', :'real_item', 1, '{}', null, true) ->> 'status' = 'added', 'a real customer adds it');
select tests.throws(format('select pg_temp.order_at(%L, %L, %L)', '20000000-0000-0000-0000-00000000000a', :'t1', 'test:dt:t1-a'),
  'demo_only', 'and the order itself is refused, whatever made the basket (a reorder, a basket from before the test)');
select pg_temp.order_at('20000000-0000-0000-0000-00000000000a', :'owner', 'test:dt:owner-a') as owner_a \gset
select tests.ok(not (select is_demo from public.orders where id = :'owner_a'), 'an owner still orders anywhere (the test shop is theirs)');
-- A demo order at a shop that is not (any longer) a demo shop never reaches it, its portal included.
select pg_temp.demo_order_at('20000000-0000-0000-0000-00000000000a', :'real', 'test:dt:demo-a') as demo_a \gset
insert into public.outbound_messages (dedupe_key, order_id, vendor_id, channel, purpose, target)
values ('dt:demoa:card', :'demo_a', '20000000-0000-0000-0000-00000000000a', 'whatsapp', 'new_order', '+96171999001'),
       ('dt:demoa:portal', :'demo_a', '20000000-0000-0000-0000-00000000000a', 'portal', 'new_order', null),
       ('dt:reala:card', :'real_a', '20000000-0000-0000-0000-00000000000a', 'whatsapp', 'new_order', '+96171999001'),
       ('dt:realtv:portal', :'real_tv', :'tv', 'portal', 'new_order', null);
select tests.ok((select target from public.outbound_messages where dedupe_key = 'dt:demoa:card') = '+96170000181'
  and (select status from public.outbound_messages where dedupe_key = 'dt:demoa:portal') = 'skipped'
  and (select target from public.outbound_messages where dedupe_key = 'dt:reala:card') = '+96171999001'
  and (select status from public.outbound_messages where dedupe_key = 'dt:realtv:portal') <> 'skipped',
  'a demo order at a real shop: the card goes to the owner and the portal copy is skipped; a demo shop''s portal is unchanged');
-- A gift's recipient hears about a demo order only when they are in the test.
select pg_temp.order_at(:'tv', :'t1', 'test:dt:gift-guard') as gg \gset
update public.orders set recipient_phone = '+96170999888' where id = :'gg';
insert into public.outbound_messages (dedupe_key, order_id, vendor_id, channel, purpose, target)
values ('dt:gg:recipient', :'gg', :'tv', 'whatsapp', 'customer_message', '+96170999888'),
       ('dt:gg:customer', :'gg', :'tv', 'whatsapp', 'customer_message', '+447700900001');
select tests.ok((select status = 'skipped' and last_error = 'demo order: never sent to a recipient outside the test'
                 from public.outbound_messages where dedupe_key = 'dt:gg:recipient')
  and (select status <> 'skipped' and target = '+447700900001' from public.outbound_messages where dedupe_key = 'dt:gg:customer'),
  'the outbound guard skips a demo order''s recipient outside the test; the customer still hears everything');
update public.orders set recipient_phone = '+96170000181' where id = :'gg';
insert into public.outbound_messages (dedupe_key, order_id, vendor_id, channel, purpose, target)
values ('dt:gg:owner-recipient', :'gg', :'tv', 'whatsapp', 'customer_message', '+96170000181');
select tests.ok((select status <> 'skipped' from public.outbound_messages where dedupe_key = 'dt:gg:owner-recipient'),
  'a recipient inside the test (here an owner) hears it');
-- "Same again" of a tester's order from before the test at a shop that is not a demo shop: refused, no basket made.
alter table public.orders disable trigger orders_is_demo;
select pg_temp.order_at('20000000-0000-0000-0000-00000000000a', :'t1', 'test:dt:t1-before') as t1_before \gset
alter table public.orders enable trigger orders_is_demo;
select tests.ok(public.basket_reorder(:'t1', :'t1_before') ->> 'status' = 'demo_only'
  and not exists (select 1 from public.baskets where customer_id = :'t1' and vendor_id = '20000000-0000-0000-0000-00000000000a'),
  'a tester''s "Same again" at a shop that is not a demo shop is refused (demo_only), no basket made');
-- Nobody answered a demo order: cancelled with the apology, but it never counts against the shop.
update public.vendors set missed_orders_streak = 2 where id in (:'tv', '20000000-0000-0000-0000-00000000000a');
select pg_temp.order_at(:'tv', :'real', 'test:dt:gu1') as gu1 \gset
select pg_temp.order_at(:'tv', :'real', 'test:dt:gu2') as gu2 \gset
select app_private.dispatch_give_up(:'gu1');
select tests.ok((select status = 'cancelled' and cancel_reason = 'merchant_unreachable' from public.orders where id = :'gu1')
  and exists (select 1 from public.outbound_messages where dedupe_key = 'cust:' || :'gu1' || ':cancelled'),
  'a demo order nobody answered is cancelled, and the customer hears it');
select tests.ok((select missed_orders_streak = 2 and paused_until is null from public.vendors where id = :'tv')
  and (select status = 'placed' from public.orders where id = :'gu2')
  and not exists (select 1 from public.outbound_messages where purpose = 'reactivate' and vendor_id = :'tv'),
  'but no missed streak, no auto-pause, no reactivation message, and the shop''s other orders stay');
select pg_temp.order_at('20000000-0000-0000-0000-00000000000a', :'real', 'test:dt:gu3') as gu3 \gset
select app_private.dispatch_give_up(:'gu3');
select tests.ok((select missed_orders_streak = 3 and paused_until is not null from public.vendors where id = '20000000-0000-0000-0000-00000000000a'),
  'a real order still counts (the third miss pauses the real shop, as before)');
update public.vendors set missed_orders_streak = 0, paused_until = null where id in (:'tv', '20000000-0000-0000-0000-00000000000a');
select tests.ok(public.basket_reorder(:'real', :'real_a') ->> 'status' = 'ok', 'a real customer''s "Same again" there still works');

-- 5. The demo autopilot -----------------------------------------------------------------------------------------------------
select tests.ok(pg_get_functiondef('app_private.tick_30s()'::regprocedure) ~ 'demo_autopilot_tick.*dispatch_kick',
  'the 30-second tick runs the autopilot, before the dispatch kick');
select tests.ok(app_private.demo_autopilot_tick() ->> 'accepted' = '0' and (select status = 'placed' from public.orders where id = :'o1'),
  'a fresh order waits for a tap (demo_autopilot_after_s)');
-- A tester's demo order at a shop that is no longer a demo shop (made before it left demo mode).
select pg_temp.demo_order_at('20000000-0000-0000-0000-00000000000a', :'t1', 'test:dt:t1-a') as t1_a \gset
update public.orders set placed_at = now() - interval '61 seconds' where id in (:'o1', :'real_tv', :'t1_a');
select app_private.demo_autopilot_tick() as tick1 \gset
select tests.ok(:'tick1'::jsonb ->> 'accepted' = '1', 'after 60 s nobody tapped: the autopilot accepts');
select tests.ok((select status = 'accepted' and prep_minutes = 15 and acknowledged_via = 'autopilot' from public.orders where id = :'o1')
  and exists (select 1 from public.order_events where order_id = :'o1' and event = 'accepted' and channel = 'autopilot'),
  'with a 15-minute prep, through order_accept, marked autopilot');
select tests.ok(exists (select 1 from public.outbound_messages where dedupe_key = 'cust:' || :'o1' || ':accepted' and target = '+447700900001')
  and public.order_track(:'t1', :'o1') ->> 'delivery_code' ~ '^[0-9]{4}$',
  'the tester gets the normal "accepted" message, and the delivery code is there to show');
select tests.ok((select status = 'placed' from public.orders where id = :'real_tv')
  and not exists (select 1 from app_private.demo_autopilot where order_id = :'real_tv'),
  'a customer who is not a tester or an owner: the autopilot never acts, even at a demo shop');
select tests.ok((select status = 'placed' from public.orders where id = :'t1_a'), 'a tester''s order at a shop that is not a demo shop: neither');
select tests.ok(app_private.demo_autopilot_tick() ->> 'steps' = '0', 'the next step waits demo_autopilot_step_s');
update app_private.demo_autopilot set acted_at = now() - interval '61 seconds' where order_id = :'o1';
select app_private.demo_autopilot_tick();
select tests.ok((select status from public.orders where id = :'o1') = 'ready', 'then ready');
update app_private.demo_autopilot set acted_at = now() - interval '61 seconds' where order_id = :'o1';
select app_private.demo_autopilot_tick();
select tests.ok((select status from public.orders where id = :'o1') = 'picked_up'
  and exists (select 1 from public.outbound_messages where dedupe_key = 'cust:' || :'o1' || ':on_the_way'),
  'then out for delivery, with the normal "on the way" message');
update app_private.demo_autopilot set acted_at = now() - interval '61 seconds' where order_id = :'o1';
select app_private.demo_autopilot_tick();
select tests.ok((select status = 'delivered' and delivery_code_confirmed_at is not null from public.orders where id = :'o1')
  and exists (select 1 from public.order_events where order_id = :'o1' and event = 'delivery_code_autopilot'),
  'then delivered, the delivery code confirmed as the driver would');
select tests.ok(exists (select 1 from public.outbound_messages where dedupe_key = 'cust:' || :'o1' || ':delivered')
  and (select stop_reason = 'done' from app_private.demo_autopilot where order_id = :'o1'),
  'the "delivered" message with Received and the rating goes out; the autopilot is done');
-- A human tap takes over, before or after the autopilot's accept.
select pg_temp.order_at(:'tv', :'t1', 'test:dt:o2') as o2 \gset
select pg_temp.order_at(:'tv', :'t1', 'test:dt:o3') as o3 \gset
select pg_temp.order_at(:'tv', :'owner', 'test:dt:o4') as o4 \gset
select public.order_acknowledge(:'o2', 'whatsapp', :'owner_member', 'wamid.tap');
update public.orders set placed_at = now() - interval '61 seconds' where id in (:'o2', :'o3', :'o4');
select app_private.demo_autopilot_tick();
select tests.ok((select status = 'placed' from public.orders where id = :'o2')
  and (select stop_reason = 'taken_over' from app_private.demo_autopilot where order_id = :'o2'),
  'Rasheed opened the order (a tap): the autopilot never acts on it');
select tests.ok((select status = 'accepted' from public.orders where id = :'o3') and (select status = 'accepted' from public.orders where id = :'o4'),
  'the untouched ones are accepted (an owner''s own order too)');
select public.order_progress(:'o3', 'ready', :'owner_member', 'whatsapp');
select public.order_set_ready_eta(:'o4', 20, :'owner_member');
update app_private.demo_autopilot set acted_at = now() - interval '61 seconds' where order_id in (:'o3', :'o4');
select app_private.demo_autopilot_tick();
select tests.ok((select status = 'ready' from public.orders where id = :'o3')
  and (select stop_reason = 'taken_over' from app_private.demo_autopilot where order_id = :'o3'),
  'Rasheed tapped Ready after the autopilot accepted: he has it from there');
select tests.ok((select status = 'accepted' from public.orders where id = :'o4')
  and (select stop_reason = 'taken_over' from app_private.demo_autopilot where order_id = :'o4'),
  'a tap that changes no status (a new ready time) takes over too');
-- A tester removed while the autopilot drives their order: it stops at the next step (not_eligible). Their demo address
-- goes with the test: not their point any more, no basket on it, no order to it.
select (public.customer_turn_begin('+447700900004', 'wamid.dt.7', 'text', 'Leaving tester') #>> '{customer,id}') as t4 \gset
select tests.ok(public.demo_tester_enrol(:'t4', :'code') ->> 'status' = 'enrolled', 'one more tester');
select set_config('app.actor_kind', '', true);
select pg_temp.order_at(:'tv', :'t4', 'test:dt:o6') as o6 \gset
select pg_temp.order_at(:'tv', :'t4', 'test:dt:o7') as o7 \gset
update public.orders set placed_at = now() - interval '61 seconds' where id in (:'o6', :'o7');
select app_private.demo_autopilot_tick();
select tests.ok((select count(*) = 2 from public.orders where id in (:'o6', :'o7') and status = 'accepted'), 'both accepted');
select public.demo_address_pick(:'t4', 'baakleen') as t4a \gset
select (:'t4a'::jsonb #>> '{address,address_id}') as t4aid \gset
select tests.ok((public.customer_search_point(:'t4') ->> 'address_id') = :'t4aid', 'a tester''s demo address is their point');
select public.demo_tester_remove_by_owner('+96170000181', '+447700900004');
update app_private.demo_autopilot set acted_at = now() - interval '61 seconds' where order_id = :'o6';
select app_private.demo_autopilot_tick();
select tests.ok((select status = 'accepted' from public.orders where id = :'o6')
  and (select stop_reason = 'not_eligible' from app_private.demo_autopilot where order_id = :'o6'),
  'the autopilot re-checks at every step: a removed tester''s order is left to a person');
select tests.ok(public.customer_search_point(:'t4') is null, 'out of the test, the demo address is no longer their point');
select tests.ok(public.basket_add_item(:'t4', :'falafel', 1, '{}', null, true) ->> 'status' = 'added', 'a basket (the shop is a demo shop)');
update public.baskets set address_id = :'t4aid', address_confirmed_at = now() where customer_id = :'t4' and status = 'open';
select tests.ok(public.basket_address_state(:'t4') ->> 'status' = 'no_address', 'a basket on it asks for a pin again');
select tests.throws(format($q$insert into public.orders (code, idempotency_key, customer_id, vendor_id, status, fulfilment, payment_method,
    menu_version, usd_lbp_rate, food_subtotal_usd, total_usd, order_fee_usd, address_id)
  values ('DT4AAA', 'test:dt:t4-demo-address', %L, %L, 'placed', 'pickup', 'cod', 1, public.usd_lbp_rate(), 2, 2, 0, %L)$q$,
  :'t4', :'tv', :'t4aid'), 'demo_address', 'and no order goes to it');
select tests.ok(public.demo_address_pick(:'t4', 'baakleen') ->> 'status' = 'not_allowed', 'nor can it be picked again');
-- An error stops the autopilot and tells the operators.
update public.orders set weight_status = 'awaiting_weight' where id = :'o7';
update app_private.demo_autopilot set acted_at = now() - interval '61 seconds' where order_id = :'o7';
-- (o7's customer left the test too: put it back for this check)
update app_private.demo_testers set removed_at = null, removed_by = null where customer_id = :'t4';
select app_private.demo_autopilot_tick();
update app_private.demo_autopilot set acted_at = now() - interval '61 seconds' where order_id = :'o7';
select app_private.demo_autopilot_tick();
select tests.ok((select stop_reason = 'error' and last_error ~ 'final weights' from app_private.demo_autopilot where order_id = :'o7')
  and exists (select 1 from public.ops_alerts where dedupe_key = 'demo_autopilot:' || :'o7' and kind = 'tick_failed'),
  'an autopilot stopped on an error raises an operator alert (the order waits for a person)');
-- Demo address choices are only places delivered to now.
select public.place_set_service_status('LB-CHF-BEITEDDINE', 'off', null);
select tests.ok(app_private.demo_address_choices() @> '[{"key": "baakleen"}, {"key": "deir_el_qamar"}]'
  and jsonb_array_length(app_private.demo_address_choices()) = 2
  and public.demo_address_pick(:'t1', 'beiteddine') ->> 'status' = 'not_delivered',
  'a demo address in a place not delivered to is neither offered nor taken');
select public.place_set_service_status('LB-CHF-BEITEDDINE', 'on', null);

-- Off: a no-op.
select pg_temp.order_at(:'tv', :'t1', 'test:dt:o5') as o5 \gset
update public.orders set placed_at = now() - interval '61 seconds' where id = :'o5';
insert into public.app_config (key, value, effective_from, note) values ('demo_autopilot_enabled', 'false', now() - interval '6 seconds', 'test');
select tests.ok(app_private.demo_autopilot_tick() ->> 'status' = 'off' and (select status = 'placed' from public.orders where id = :'o5'),
  'demo_autopilot_enabled off (the cut-over): the autopilot does nothing');
insert into public.app_config (key, value, effective_from, note) values ('demo_autopilot_enabled', 'true', now() - interval '5 seconds', 'test');
insert into public.app_config (key, value, effective_from, note) values ('demo_shops', '[]', now() - interval '4 seconds', 'test');
select tests.ok(app_private.demo_autopilot_tick() ->> 'status' = 'off' and (select status = 'placed' from public.orders where id = :'o5'),
  'demo mode off (production): the autopilot does nothing either');
insert into public.app_config (key, value, effective_from, note)
values ('demo_shops', jsonb_build_array(jsonb_build_object('id', :'tv', 'name', 'Alo Test Grill')), now() - interval '3 seconds', 'test');

-- 6. Ratings and ledger rows inherit the flag; shop figures leave demo rows out -------------------------------------------
select tests.ok(public.order_rate(:'t1', :'o1', 1, true) ->> 'status' = 'rated', 'the tester rates the order');
select tests.ok((select is_demo from public.order_ratings where order_id = :'o1'), 'a demo order''s rating is a demo rating');
select pg_temp.order_at('20000000-0000-0000-0000-00000000000a', :'real', 'test:dt:real-a2', 'delivered') as ra2 \gset
select pg_temp.demo_order_at('20000000-0000-0000-0000-00000000000a', :'t1', 'test:dt:t1-a2', 'delivered') as ta2 \gset
insert into public.order_ratings (order_id, customer_id, vendor_id, food_score) values
  (:'ra2', :'real', '20000000-0000-0000-0000-00000000000a', 4), (:'ta2', :'t1', '20000000-0000-0000-0000-00000000000a', 1);
select tests.ok(not (select is_demo from public.order_ratings where order_id = :'ra2') and (select is_demo from public.order_ratings where order_id = :'ta2'),
  'ratings carry their order''s flag');
select public.merchant_report('20000000-0000-0000-0000-00000000000a', null, 'day') as rep \gset
select tests.ok((select count(*) filter (where is_demo) >= 2 from public.orders where vendor_id = '20000000-0000-0000-0000-00000000000a')
  and (:'rep'::jsonb ->> 'orders')::int = (select count(*) from public.orders where vendor_id = '20000000-0000-0000-0000-00000000000a'
                                            and not is_demo and placed_at >= now() - interval '1 hour')
  and (:'rep'::jsonb ->> 'delivered')::int = 1 and (:'rep'::jsonb ->> 'ratings')::int = 1 and (:'rep'::jsonb ->> 'rating_avg')::numeric = 4,
  'the merchant report (and weekly summary) count only real orders and ratings');
select tests.ok((public.merchant_report(:'tv', null, 'week') ->> 'orders')::int = 0, 'a demo shop''s report shows no demo order');
select app_private.merchant_facts_refresh(:'tv');
select tests.ok((select value = 'null'::jsonb from public.merchant_facts where vendor_id = :'tv' and key = 'acceptance_median_s'),
  'the autopilot''s fast accepts never become the shop''s acceptance speed');
insert into public.vendor_members (vendor_id, user_id, phone_e164, role, status, display_name)
values (:'tv', app_private.auth_user_for_phone('+96170000184'), '+96170000184', 'cashier', 'active', 'Cashier');
select tests.ok((public.staff_shift_touch('+96170000184') #>> '{0,complaints}')::int = 0,
  'a demo order''s low rating is not a complaint in the shift handover');
select tests.ok((public.catalog_best_sellers(:'tv', 30))[1] <> :'falafel'
  and not exists (select 1 from jsonb_array_elements(public.catalog_shop_menu(:'tv', 'cat-dt') -> 'sections') s where (s ->> 'sold')::numeric > 0),
  'demo sales never rank best sellers or the shop menu');
-- "Goes well with" learns from real orders only: two demo orders with Falafel and Pepsi together suggest nothing.
select pg_temp.order_at(:'tv', :'real', 'test:dt:co1', 'delivered') as co1 \gset
select pg_temp.order_at(:'tv', :'real', 'test:dt:co2', 'delivered') as co2 \gset
insert into public.order_items (order_id, item_id, name_en, quantity, pricing_unit, unit_price_usd, line_total_usd)
select o, i, 'x', 1, 'each', 1, 1 from unnest(array[:'co1', :'co2']::uuid[]) o, unnest(array[:'falafel', :'pepsi']::uuid[]) i;
select tests.ok(public.basket_add_item(:'real', :'falafel', 1, '{}', null, true) ->> 'status' = 'added', 'a real customer''s basket');
select tests.ok(public.basket_upsell(:'real') is null, 'no "goes well with" from demo orders');
-- The ledger: never faked, every row of a demo order marked.
select public.ledger_post('refund', 'test:dt:ledger:demo', jsonb_build_array(
  jsonb_build_object('account_id', public.ledger_account('expense_refunds', 'USD'), 'amount', 1),
  jsonb_build_object('account_id', public.ledger_account('customer_refund_payable', 'USD'), 'amount', -1)), :'o1') as ltx \gset
select public.ledger_post('refund', 'test:dt:ledger:real', jsonb_build_array(
  jsonb_build_object('account_id', public.ledger_account('expense_refunds', 'USD'), 'amount', 1),
  jsonb_build_object('account_id', public.ledger_account('customer_refund_payable', 'USD'), 'amount', -1)), :'ra2') as ltx2 \gset
select tests.ok((select is_demo from public.ledger_transactions where id = :'ltx')
  and (select bool_and(is_demo) and count(*) = 2 from public.ledger_entries where transaction_id = :'ltx'),
  'a demo order''s ledger transaction and its entries carry is_demo');
select tests.ok(not (select is_demo from public.ledger_transactions where id = :'ltx2')
  and not (select bool_or(is_demo) from public.ledger_entries where transaction_id = :'ltx2'), 'a real order''s do not');

-- Access ------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws($$select * from app_private.demo_testers$$, 'permission denied', 'a client cannot read the testers');
select tests.throws($$select * from app_private.demo_autopilot$$, 'permission denied', 'or the autopilot''s orders');
select tests.throws($$select public.demo_tester_enrol('10000000-0000-0000-0000-000000000001', 'x')$$, 'permission denied',
  'or enrol itself');
select tests.throws($$select public.demo_address_pick('10000000-0000-0000-0000-000000000001', 'baakleen')$$, 'permission denied',
  'or pick a demo address');
select tests.throws($$select public.demo_tester_remove_by_owner('+96170000181', '+447700900001')$$, 'permission denied',
  'or remove a tester');
select tests.throws($$select public.ops_demo_testers('00000000-0000-0000-0000-00000000000b')$$, 'permission denied',
  'or list them');
reset role;
set local role anon;
select tests.act_as(null);
select tests.throws($$select app_private.demo_autopilot_tick()$$, 'permission denied', 'anonymous: not the autopilot either');
select tests.throws($$select public.demo_tester_enrol('10000000-0000-0000-0000-000000000001', 'x')$$, 'permission denied',
  'nor enrolment');
reset role;
select tests.ok(not has_function_privilege('authenticated', 'public.demo_tester_enrol(uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.demo_tester_enrol(uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.ops_demo_tester_remove(uuid, text)', 'execute'),
  'the bot and Slack (the service role) may call them');

-- Session 5g part 0f: "Change address" during the test offers the demo addresses at once; nobody else gets any.
select tests.ok(jsonb_array_length(public.demo_address_choices_for(:'t1')) between 1 and 3
  and public.demo_address_choices_for(:'real') is null,
  'a tester gets the demo addresses for Change address; a real customer gets none');

rollback;
