-- Session T (DECISIONS §34): the staging test merchant, the #merchant / #customer switch, the handoff that
-- ends on its own and tells the owner, the cash currency, menu sections and the rating right after
-- "Received". The fixture file is run exactly as the staging deploy runs it.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-TST', 'CHF', 'Testline', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-TST', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test');
select tests.ok((select service_status = 'off' from public.places where id = 'LB-CHF-BAAKLINE'), 'a test place loads off');

select set_config('app.fixture_owner_phone', '+96170000099', false);
\i supabase/test-fixtures/alo-test-grill.sql

-- The merchant ---------------------------------------------------------------------------------------------
select tests.ok((select service_status = 'on' from public.places where id = 'LB-CHF-BAAKLINE'), 'the fixture switches Baakline on');
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
select tests.ok((select is_test and orderable and claim_status = 'claimed' and listing_status = 'active' and not public_page
  and source = 'admin' and delivery_radius_km = 10.0 and delivery_enabled and pickup_enabled
  from public.vendors where id = :'tv'), 'Alo Test Grill is a claimed, orderable, non-public test vendor with a 10 km radius on record (T3: not checked)');
select tests.ok((select count(*) = 1 from public.vendors where is_test), 'there is exactly one test vendor');
select tests.ok((select count(*) = 15 from public.menu_items where vendor_id = :'tv'), 'the menu has 15 items');
select tests.ok((select count(*) = 4 from public.menu_sections where vendor_id = :'tv'), 'in 4 sections');
select tests.ok(exists (select 1 from public.menu_items where vendor_id = :'tv' and pricing_unit = 'kg' and est_weight_kg is not null), 'one item is weighed');
select tests.ok((select count(*) = 4 from public.menu_option_groups g join public.menu_items i on i.id = g.item_id where i.vendor_id = :'tv' and g.min_select = 1),
  'four items have a required option group');
select tests.ok((public.vendor_sections(:'tv') -> 'sections' -> 0 ->> 'name_en') = 'Sandwiches'
  and jsonb_array_length(public.vendor_sections(:'tv') -> 'sections') = 4 and (public.vendor_sections(:'tv') ->> 'unsectioned')::int = 0,
  'vendor_sections lists the four sections in menu order');
select tests.ok(public.vendor_sections('99999999-0000-0000-0000-000000000000') is null, 'vendor_sections answers nothing for an unknown vendor');
select tests.ok((select not exists (select 1 from public.vendors where is_test and (public_page or public_listing))), 'the test merchant has no public page or listing');
select tests.ok(not exists (select 1 from public.vendor_hours where vendor_id = :'tv'), 'no hours rows: open 24/7');

-- Running the fixture again changes nothing ------------------------------------------------------------------
\i supabase/test-fixtures/alo-test-grill.sql
select tests.ok((select count(*) = 1 from public.vendors where is_test) and (select count(*) = 15 from public.menu_items where vendor_id = :'tv'),
  'the fixture is idempotent');

-- The switch ---------------------------------------------------------------------------------------------------
select tests.ok(public.test_side_get('+96170000099') = 'customer', 'the owner starts as a customer');
select tests.ok(public.test_side_get('+96170000001') is null, 'any other number cannot switch');
select tests.ok(public.test_side_set('+96170000001', 'merchant') ->> 'status' = 'not_allowed', 'another number cannot become the merchant');
select tests.ok(public.test_side_set('+96170000099', 'admin') ->> 'status' = 'bad_side', 'only the two sides exist');
select tests.ok(public.test_side_set('+96170000099', 'merchant') ->> 'status' = 'ok', '#merchant is accepted for the owner');
-- A separate statement: a stable function does not see a write made earlier in the same statement.
select tests.ok(public.test_side_get('+96170000099') = 'merchant', '#merchant switches the owner to the merchant side');
select tests.ok(exists (select 1 from public.merchant_members_by_phone('+96170000099') where vendor_id = :'tv' and role = 'owner'),
  'as merchant the owner is an active owner of the test vendor');
select tests.ok((select primary_channel = 'whatsapp' and primary_target = '+96170000099' and backup_target is null
  from app_private.vendor_channels(:'tv')), 'order cards reach the owner on WhatsApp at once');
select tests.ok(public.test_side_set('+96170000099', 'merchant') ->> 'status' = 'ok', 'switching to the same side twice is fine');
select tests.ok(public.test_side_set('+96170000099', 'customer') ->> 'status' = 'ok', '#customer is accepted');
select tests.ok(public.test_side_get('+96170000099') = 'customer', '#customer switches back');

-- A whole test order: cash currency, accept, deliver with the code, "Received", rating --------------------------
select public.customer_turn_begin('+96170000099', 'wamid.t.1', 'text', 'Rasheed') as t1 \gset
select (:'t1'::jsonb #>> '{customer,id}') as cid \gset
select public.address_save_pin(:'cid', 33.6775, 35.5645, 'Home') ->> 'status' as pin_status \gset
select tests.ok(:'pin_status' = 'saved', 'a pin in Baakline saves an address');
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Falafel Sandwich') as falafel \gset
select tests.ok(public.basket_add_item(:'cid', :'falafel', 2, '{}', null, true) ->> 'status' = 'added', 'two falafel sandwiches go in the basket');
select tests.ok(public.basket_cash_state(:'cid') ->> 'cash_currency' is null
  and public.basket_cash_state(:'cid') #>> '{allowed,0}' = 'USD' and public.basket_cash_state(:'cid') #>> '{allowed,1}' = 'LBP',
  'the shop takes USD and LBP and nothing is chosen yet');
select tests.ok(public.basket_set_cash_currency(:'cid', 'EUR') ->> 'status' = 'not_accepted', 'a currency the shop does not take is refused');
select tests.ok(public.basket_set_cash_currency(:'cid', 'LBP') ->> 'status' = 'ok', 'the customer chooses LBP');
select tests.ok(public.basket_cash_state(:'cid') ->> 'cash_currency' = 'LBP', 'and the server remembers it');
select public.route_cache_store(33.6770, 35.5640, array[33.6775], array[35.5645], array[900], array[120], 'ors');
select public.basket_quote(:'cid') as q \gset
select tests.ok(:'q'::jsonb ->> 'status' = 'ok' and (:'q'::jsonb ->> 'subtotal_usd')::numeric = 5.00, 'the quote prices from the menu: 2 x $2.50');
select public.basket_view(:'cid') as bv \gset
select public.order_place((:'bv'::jsonb ->> 'basket_id')::uuid, (:'bv'::jsonb ->> 'menu_version')::bigint, 'wa:test:t:1') as po \gset
select tests.ok(:'po'::jsonb ->> 'status' = 'placed', 'the test order is placed');
select (:'po'::jsonb ->> 'order_id') as oid \gset
select tests.ok((select cash_currency = 'LBP' from public.orders where id = :'oid'), 'the order keeps the cash currency');
select tests.ok(exists (select 1 from public.order_dispatch d where d.order_id = :'oid' and d.primary_channel = 'whatsapp')
  and exists (select 1 from public.outbound_messages m where m.order_id = :'oid' and m.purpose = 'new_order'
              and m.channel = 'whatsapp' and m.target = '+96170000099'),
  'the order card goes to the owner''s WhatsApp through the router');
select public.test_side_set('+96170000099', 'merchant');
select id as mid from public.vendor_members where phone_e164 = '+96170000099' and vendor_id = :'tv' \gset
select tests.ok(public.order_accept(:'oid', 15, :'mid', 'whatsapp') ->> 'status' = 'accepted', 'the owner accepts as merchant');
select tests.ok(public.order_progress(:'oid', 'ready', :'mid', 'whatsapp') ->> 'status' is not null, 'then marks it ready');
select public.order_progress(:'oid', 'picked_up', :'mid', 'whatsapp');
select tests.ok((select status = 'picked_up' from public.orders where id = :'oid'), 'then out for delivery');
select tests.ok(public.order_confirm_delivery_code('+96170000099', (select code from public.order_delivery_codes where order_id = :'oid')) ->> 'status' = 'delivered',
  'the owner types the delivery code and the order is delivered');
-- Session 5c (DECISIONS §38.3 "delivered + rate"): the delivered message carries the rating, so none is sent after it.
select tests.ok(exists (select 1 from public.outbound_messages where dedupe_key = 'cust:' || :'oid' || ':delivered'), 'the delivered message is queued');
select tests.ok(public.order_rating_prompt_now(:'cid', :'oid') ->> 'status' = 'sent', 'asking for the rating at once is accepted');
select tests.ok(not exists (select 1 from public.outbound_messages where dedupe_key = 'cust:' || :'oid' || ':rating'),
  'no separate rating message after the delivered message (it carries the rating)');
select tests.ok(public.order_rate(:'cid', :'oid', 5, null) ->> 'status' = 'rated', 'the customer rates it');
select tests.ok(public.order_rating_prompt_now(:'cid', :'oid') ->> 'status' = 'rated', 'a rated order is not asked again');
select tests.ok(public.order_rating_prompt_now('10000000-0000-0000-0000-000000000002', :'oid') ->> 'status' = 'no_order', 'only the customer''s own order');

-- A real merchant's order is rated by the timer, never at once ------------------------------------------------
update public.vendors set is_test = false where id = :'tv';
select tests.ok(public.order_rating_prompt_now(:'cid', :'oid') ->> 'status' = 'later', 'a normal merchant keeps the 30-minute delay');
update public.vendors set is_test = true where id = :'tv';

-- Handoff ends on its own and tells the owner ------------------------------------------------------------------
select tests.ok(public.customer_handoff(:'cid', 'asked for a person') ->> 'status' = 'handed_off', 'the bot hands off');
select tests.ok((select handoff_until between now() + interval '29 minutes' and now() + interval '31 minutes' from public.bot_sessions where customer_id = :'cid'),
  'the bot is quiet for 30 minutes, not 12 hours');
select tests.ok(exists (select 1 from public.outbound_messages where purpose = 'reply' and target = '+96170000099'
  and payload ->> 'text' like '%needs a person%'), 'the owner''s phone is told on WhatsApp');
select public.customer_handoff_end(:'cid');
select tests.ok((select handoff_until is null from public.bot_sessions where customer_id = :'cid'), 'a handoff can be ended at once');

-- Access ------------------------------------------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws($$select public.test_side_set('+96170000099', 'merchant')$$, 'permission denied', 'clients cannot call the switch');
select tests.throws($$select * from app_private.owner_phones$$, 'permission denied', 'clients cannot read the owner phones');
reset role;
set local role anon;
select tests.throws($$select public.vendor_sections('00000000-0000-0000-0000-000000000000')$$, 'permission denied', 'anon cannot read vendor_sections');
select tests.throws($$select is_test from public.vendors$$, 'permission denied', 'clients cannot read the test flag');
reset role;

rollback;
