-- Session T3 (DECISIONS §34): Alo Test Grill takes a pin anywhere in the world. A Dubai pin and a Beirut pin both
-- order from the test merchant: no road route, no radius check, the 0-3 km fee, and a pin outside every place
-- polygon lands on the "Test location" place. Real merchants keep every check; production (no test place, no
-- test merchant) behaves as before. Also: the google_places_enabled flag keeps live Google lookups off.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-TST', 'CHF', 'Testline', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test'),
  ('TZ-BEI', 'BEY', 'Beirut test zone', 'SRID=4326;MULTIPOLYGON(((35.48 33.87,35.54 33.87,35.54 33.91,35.48 33.91,35.48 33.87)))', 'test'),
  ('TZ-SOU', 'TYR', 'South test zone', 'SRID=4326;MULTIPOLYGON(((35.17 33.25,35.23 33.25,35.23 33.30,35.17 33.30,35.17 33.25)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-TST', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test'),
  ('LB-BEY-BEIRUT', 'TZ-BEI', 'بيروت', 'Beirut', 'city', 'beirut', 'BEY', 'SRID=4326;POINT(35.5018 33.8938)', 'test'),
  ('LB-TYR-SOUTHTEST', 'TZ-SOU', 'جنوب', 'South test', 'town', 'south', 'TYR', 'SRID=4326;POINT(35.20 33.27)', 'test');

select set_config('app.fixture_owner_phone', '+96170000097', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Falafel Sandwich') as falafel \gset

-- The Test location place -------------------------------------------------------------------------------------------
select tests.ok((select name_en = 'Test location' and source = 'test' and service_status = 'on' and district_code = 'CHF'
  from public.places where id = 'LB-TST-LOCATION'), 'the fixture makes the "Test location" place and switches it on');
\i supabase/test-fixtures/alo-test-grill.sql
select tests.ok((select count(*) = 1 from public.places where id = 'LB-TST-LOCATION'), 'running the fixture again keeps one');
select tests.ok((select service_status = 'off' from public.places where id = 'LB-BEY-BEIRUT'), 'Beirut itself is not switched on');

-- A Dubai pin orders from the test merchant ---------------------------------------------------------------------------
select public.customer_turn_begin('+96170000011', 'wamid.t3.1', 'text', 'Dubai tester') as t1 \gset
select (:'t1'::jsonb #>> '{customer,id}') as dcid \gset
select public.address_save_pin(:'dcid', 25.2048, 55.2708, 'Dubai') as dpin \gset
select tests.ok(:'dpin'::jsonb ->> 'status' = 'saved' and :'dpin'::jsonb #>> '{address,place_en}' = 'Test location',
  'a Dubai pin is saved against the Test location place');
select tests.ok((select place_id = 'LB-TST-LOCATION' from public.addresses where id = (:'dpin'::jsonb #>> '{address,address_id}')::uuid),
  'on the address record too');
select tests.ok(exists (select 1 from public.vendor_search(null, 25.2048, 55.2708, null, null, 10) where vendor_id = :'tv'),
  'the search lists the test merchant for a pin 2,000 km away');
select tests.ok(public.customer_delivery_check(:'dcid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'ok'
  and (public.customer_delivery_check(:'dcid', array[:'tv'::uuid]) #>> '{vendors,0,fee_usd}')::numeric = 2.00
  and (public.customer_delivery_check(:'dcid', array[:'tv'::uuid]) #>> '{vendors,0,road_km}')::numeric = 0,
  'the road check is ok with no route at the 0-3 km fee');
select tests.ok(public.basket_add_item(:'dcid', :'falafel', 2, '{}', null, true) ->> 'status' = 'added', 'two falafel sandwiches go in the basket');
select public.basket_quote(:'dcid') as dq \gset
select tests.ok(:'dq'::jsonb ->> 'status' = 'ok' and (:'dq'::jsonb ->> 'delivery_fee_usd')::numeric = 2.00
  and (:'dq'::jsonb ->> 'total_usd')::numeric = 7.00 and (:'dq'::jsonb ->> 'road_km')::numeric = 0
  and (:'dq'::jsonb ->> 'total_lbp')::numeric = round(7.00 * public.usd_lbp_rate(), 0),
  'the Dubai quote is $5.00 food + $2.00 fee, in USD and LBP at the locked rate');
select public.basket_view(:'dcid') as dbv \gset
select public.order_place((:'dbv'::jsonb ->> 'basket_id')::uuid, (:'dbv'::jsonb ->> 'menu_version')::bigint, 'wa:t3:dubai:1') as dpo \gset
select tests.ok(:'dpo'::jsonb ->> 'status' = 'placed', 'the Dubai order is placed');
select tests.ok((select o.delivery_place_id = 'LB-TST-LOCATION' and o.delivery_fee_usd = 2.00 and o.road_km = 0 and o.total_usd = 7.00
    and o.status = 'placed' and o.vendor_id = :'tv'::uuid
  from public.orders o where o.id = (:'dpo'::jsonb ->> 'order_id')::uuid), 'with the Test location, the 0-3 km fee and the server total');

-- A Beirut pin orders from the test merchant ---------------------------------------------------------------------------
select public.customer_turn_begin('+96170000012', 'wamid.t3.2', 'text', 'Beirut tester') as t2 \gset
select (:'t2'::jsonb #>> '{customer,id}') as bcid \gset
select public.address_save_pin(:'bcid', 33.8938, 35.5018, 'Beirut') as bpin \gset
select tests.ok(:'bpin'::jsonb ->> 'status' = 'saved' and :'bpin'::jsonb #>> '{address,place_en}' = 'Beirut',
  'a Beirut pin snaps to Beirut by polygon, as for any customer');
select tests.ok(exists (select 1 from public.vendor_search(null, 33.8938, 35.5018, null, null, 10) where vendor_id = :'tv'),
  'the search lists the test merchant 20 km from the pin');
select tests.ok(public.customer_delivery_check(:'bcid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'ok'
  and (public.customer_delivery_check(:'bcid', array[:'tv'::uuid]) #>> '{vendors,0,fee_usd}')::numeric = 2.00,
  'the Beirut road check is ok at the 0-3 km fee with no route fetched');
select tests.ok(public.basket_add_item(:'bcid', :'falafel', 1, '{}', null, true) ->> 'status' = 'added', 'a falafel sandwich goes in the basket');
select public.basket_quote(:'bcid') as bq \gset
select tests.ok(:'bq'::jsonb ->> 'status' = 'ok' and (:'bq'::jsonb ->> 'delivery_fee_usd')::numeric = 2.00 and (:'bq'::jsonb ->> 'total_usd')::numeric = 4.50,
  'the Beirut quote is $2.50 food + $2.00 fee');
select public.basket_view(:'bcid') as bbv \gset
select public.order_place((:'bbv'::jsonb ->> 'basket_id')::uuid, (:'bbv'::jsonb ->> 'menu_version')::bigint, 'wa:t3:beirut:1') as bpo \gset
select tests.ok(:'bpo'::jsonb ->> 'status' = 'placed', 'the Beirut order is placed');
select tests.ok((select o.delivery_place_id = 'LB-BEY-BEIRUT' and o.delivery_fee_usd = 2.00 and o.road_km = 0 and o.total_usd = 4.50
  from public.orders o where o.id = (:'bpo'::jsonb ->> 'order_id')::uuid), 'with Beirut as the place and the 0-3 km fee');

-- Other pins: a gap inside Lebanon, a paused place, the sea -------------------------------------------------------------
select public.customer_turn_begin('+96170000013', 'wamid.t3.3', 'text', 'Gap tester') as t3 \gset
select (:'t3'::jsonb #>> '{customer,id}') as gcid \gset
select tests.ok(public.address_save_pin(:'gcid', 34.30, 36.20, 'Beqaa gap') #>> '{address,place_en}' = 'Test location',
  'a pin in Lebanon outside every polygon and 3 km from every place also lands on the Test location');
select tests.ok((select service_status = 'paused' from public.places where id = 'LB-TYR-SOUTHTEST'), 'the South test place is paused');
select tests.ok(public.address_save_pin(:'gcid', 33.275, 35.20, 'South') #>> '{address,place_en}' = 'Test location'
  and public.address_save_pin(:'gcid', 33.275, 35.20, 'South') #>> '{address,place_status}' = 'on',
  'a pin in a paused place lands on the Test location, so the test merchant still takes it');
select tests.ok(public.address_save_pin(:'gcid', 95, 55, 'Bad') ->> 'status' = 'outside_lebanon'
  and public.address_save_pin(:'gcid', 25, 200, 'Bad') ->> 'status' = 'outside_lebanon', 'coordinates that are not on Earth are refused');

-- A real merchant keeps every check ---------------------------------------------------------------------------------------
update public.vendors set is_test = false where id = :'tv';
select tests.ok(not exists (select 1 from public.vendor_search(null, 25.2048, 55.2708, null, null, 10) where vendor_id = :'tv'),
  'a real merchant is not listed for a Dubai pin');
select tests.ok(not exists (select 1 from public.vendor_search(null, 33.8938, 35.5018, null, null, 10) where vendor_id = :'tv'),
  'nor for a Beirut pin beyond its radius');
select tests.ok(public.customer_delivery_check(:'dcid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'no_route'
  and public.customer_delivery_check(:'bcid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'no_route',
  'its road check needs a route');
select tests.ok(public.basket_add_item(:'dcid', :'falafel', 1, '{}', null, true) ->> 'status' = 'added', 'another basket for the Dubai customer');
select tests.ok(public.basket_quote(:'dcid') ->> 'status' = 'no_route', 'a real merchant''s quote needs a route');
select public.basket_view(:'dcid') as dbv2 \gset
select tests.ok(public.order_place((:'dbv2'::jsonb ->> 'basket_id')::uuid, (:'dbv2'::jsonb ->> 'menu_version')::bigint, 'wa:t3:dubai:2') ->> 'status' = 'no_route',
  'and a real merchant''s order is refused with no route');
select public.route_cache_store(33.6770, 35.5640, array[33.8938], array[35.5018], array[28000], array[2400], 'ors');
select tests.ok(public.customer_delivery_check(:'bcid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'beyond_radius',
  'with a route, 28 road km is beyond a real merchant''s radius');
-- Production: no test merchant, so no Test location fallback ------------------------------------------------------------
select public.customer_turn_begin('+96170000014', 'wamid.t3.4', 'text', 'Prod tester') as t4 \gset
select (:'t4'::jsonb #>> '{customer,id}') as pcid \gset
select tests.ok(public.address_save_pin(:'pcid', 25.2048, 55.2708, 'Dubai') ->> 'status' = 'outside_lebanon'
  and public.address_save_pin(:'pcid', 34.30, 36.20, 'gap') ->> 'status' = 'no_place',
  'with no test merchant a Dubai pin is outside Lebanon and a gap is no place, as in production');
update public.vendors set is_test = true where id = :'tv';

-- Google Places stays off ------------------------------------------------------------------------------------------------
select tests.ok((public.config_value('google_places_enabled') #>> '{}')::boolean = false, 'google_places_enabled is false');
select tests.ok(public.vendor_from_google('ChIJT3googleplace1', 'Google Cafe', 33.68, 35.58, 'cafe') ->> 'status' = 'disabled'
  and not exists (select 1 from public.vendors where place_id = 'ChIJT3googleplace1'),
  'a live Google vendor is refused while the flag is off, and nothing is created');
insert into public.app_config (key, value, effective_from, note) values ('google_places_enabled', 'true', now() - interval '1 second', 'test: flag on');
select tests.ok(public.vendor_from_google('ChIJT3googleplace1', 'Google Cafe', 33.68, 35.58, 'cafe') ->> 'status' = 'created',
  'with the flag on the claim-time lookup works as before');

-- Access -------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws($$select app_private.vendor_is_test('00000000-0000-0000-0000-000000000000')$$, 'permission denied', 'clients cannot ask which vendor is a test vendor');
select tests.throws($$select public.vendor_from_google('ChIJT3googleplace2', 'x', 33.68, 35.58, 'cafe')$$, 'permission denied', 'clients cannot create vendors from Google');
reset role;

rollback;
