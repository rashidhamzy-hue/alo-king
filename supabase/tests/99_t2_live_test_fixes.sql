-- Session T2: the bugs from the owner's first live test (12 October 07:45-07:50). Pickup baskets quote
-- (they raised "record v_route is not assigned yet", which the bot answered with "Sorry, I'm a bit slow" to the
-- pickup tap and to every later Checkout), the road check for a list of places, pickup choices, and the staging
-- test merchant's 30 km radius.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-TST', 'CHF', 'Testline', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-TST', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test');

select set_config('app.fixture_owner_phone', '+96170000099', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset

-- The T2 30 km test band is retired (session T3) -----------------------------------------------------------------------
select tests.ok((select delivery_radius_km = 10.0 and pickup_enabled and delivery_enabled from public.vendors where id = :'tv'),
  'Alo Test Grill is back at a 10 km radius on record and takes pickup');
select tests.ok(public.max_delivery_km() = 20, 'the fixture adds no fee band above the real 20 km band (§39.2)');
select tests.ok(public.delivery_fee_usd(2.5) = 2.00 and public.delivery_fee_usd(5) = 3.00 and public.delivery_fee_usd(9.5) = 4.50,
  'the existing bands keep their fees');
select tests.ok(public.delivery_fee_usd(25) is null and not exists (select 1 from public.delivery_fee_bands where max_km = 30),
  'and there is no 10-30 km test band');
-- A staging database that still has T2's band set: the fixture replaces it with a newer set without the 30 km band.
update public.vendors set delivery_radius_km = 10.0 where id = :'tv';
-- Between the newest set in force and now(): newer than the migrations' sets, older than the fixture's own now() set.
select (select max(effective_from) from public.delivery_fee_bands where effective_from <= now())
  + (now() - (select max(effective_from) from public.delivery_fee_bands where effective_from <= now())) / 2 as t2at \gset
insert into public.delivery_fee_bands (effective_from, max_km, fee_usd, created_by) values
  (:'t2at', 3, 2.00, null), (:'t2at', 6, 3.00, null),
  (:'t2at', 10, 4.50, null), (:'t2at', 30, 6.00, null);
select tests.ok(public.max_delivery_km() = 30 and public.delivery_fee_usd(25) = 6.00, 'T2''s 30 km band set is in force');
\i supabase/test-fixtures/alo-test-grill.sql
select tests.ok(public.max_delivery_km() = 10 and public.delivery_fee_usd(25) is null and public.delivery_fee_usd(9.5) = 4.50,
  'the fixture retires it with a newer set of the three real bands');
select tests.ok((select count(*) = 3 from public.delivery_fee_bands b
  where b.effective_from = (select max(x.effective_from) from public.delivery_fee_bands x where x.effective_from <= now())),
  'three bands are in force');
\i supabase/test-fixtures/alo-test-grill.sql
select tests.ok((select count(*) = 3 from public.delivery_fee_bands b
  where b.effective_from = (select max(x.effective_from) from public.delivery_fee_bands x where x.effective_from <= now())),
  'running the fixture again adds nothing');
select tests.ok((select deliverable and fee_usd = 2.00 and road_km = 0 from public.delivery_quote(:'tv', 12.64)),
  'the test merchant delivers any distance at the 0-3 km fee');

-- A pickup basket quotes (the live-test bug) -------------------------------------------------------------------------
select public.customer_turn_begin('+96170000098', 'wamid.t2.1', 'text', 'T2') as t1 \gset
select (:'t1'::jsonb #>> '{customer,id}') as cid \gset
select public.address_save_pin(:'cid', 33.6775, 35.5645, 'Home') ->> 'status' as pin_status \gset
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Falafel Sandwich') as falafel \gset
select tests.ok(public.basket_add_item(:'cid', :'falafel', 2, '{}', null, true) ->> 'status' = 'added', 'two falafel sandwiches go in the basket');
select tests.ok(public.basket_set_checkout(:'cid', 'pickup') ->> 'status' = 'updated', 'the customer taps "I''ll pick up"');
select public.basket_quote(:'cid') as q \gset
select tests.ok(:'q'::jsonb ->> 'status' = 'ok', 'a pickup basket quotes instead of raising');
select tests.ok((:'q'::jsonb ->> 'delivery_fee_usd')::numeric = 0 and (:'q'::jsonb ->> 'total_usd')::numeric = 5.00
  and :'q'::jsonb -> 'address' = 'null'::jsonb and :'q'::jsonb -> 'road_km' = 'null'::jsonb, 'with no delivery fee, no address and no distance');
select tests.ok(public.basket_quote(:'cid') ->> 'status' = 'ok', 'a second Checkout tap quotes the same');
select public.basket_view(:'cid') as bv \gset
select tests.ok(public.order_place((:'bv'::jsonb ->> 'basket_id')::uuid, (:'bv'::jsonb ->> 'menu_version')::bigint, 'wa:t2:pickup:1') ->> 'status' = 'placed',
  'and the pickup order is placed');

-- Delivery is checked on the road, per place, right after the pin ----------------------------------------------------
-- The test merchant needs no route at all (T3); a real merchant does.
select tests.ok(public.customer_delivery_check(:'cid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'ok'
  and (public.customer_delivery_check(:'cid', array[:'tv'::uuid]) #>> '{vendors,0,fee_usd}')::numeric = 2.00,
  'the test merchant is ok with no road route, at the 0-3 km fee');
update public.vendors set is_test = false where id = :'tv';
select tests.ok(public.customer_delivery_check(:'cid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'no_route',
  'a real merchant''s unknown road route asks the caller to fetch it');
select tests.ok(public.customer_delivery_check(:'cid', array[:'tv'::uuid]) #>> '{vendors,0,origin,lat}' is not null, 'with both points');
select public.route_cache_store(33.6770, 35.5640, array[33.6775], array[35.5645], array[12640], array[1500], 'ors');
select tests.ok(public.customer_delivery_check(:'cid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'beyond_radius'
  and (public.customer_delivery_check(:'cid', array[:'tv'::uuid]) #>> '{vendors,0,limit_km}')::numeric = 10,
  '12.64 road km is beyond a real merchant''s 10 km');
update public.vendors set is_test = true where id = :'tv';
select tests.ok(public.customer_delivery_check('10000000-0000-0000-0000-000000000002', array[:'tv'::uuid]) ->> 'status' = 'no_address',
  'a customer with no pin has nothing to check');

-- The pickup choice -------------------------------------------------------------------------------------------------
select tests.ok(exists (select 1 from public.vendor_search_pickup(33.6775, 35.5645, 10) where vendor_id = :'tv'), 'the pickup choice lists the open place near the pin');
select tests.ok((select count(*) = 0 from public.vendor_search_pickup(34.4, 35.8, 10)), 'and nothing about 80 km away');
select tests.ok((select count(*) = 0 from public.vendor_search_pickup(null, null, 10)), 'and nothing without a point');
update public.vendors set pickup_enabled = false where id = :'tv';
select tests.ok(not exists (select 1 from public.vendor_search_pickup(33.6775, 35.5645, 10) where vendor_id = :'tv'), 'a place that does not take pickup is not listed');
update public.vendors set pickup_enabled = true where id = :'tv';

-- Access ------------------------------------------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws($$select public.customer_delivery_check('00000000-0000-0000-0000-000000000000', '{}')$$, 'permission denied', 'clients cannot call the road check');
select tests.throws($$select * from public.vendor_search_pickup(33.6, 35.5, 5)$$, 'permission denied', 'clients cannot call the pickup search');
reset role;

rollback;
