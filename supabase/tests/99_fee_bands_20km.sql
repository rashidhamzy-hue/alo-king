-- DECISIONS §39.2 (15 October): the boundary decides where we deliver; road distance only sets the fee. The 15 October
-- band set (20261014230000) restates 3/6/10 km and adds 20 km at $6.00: an address in a named village beyond 10 km by
-- road (Jbaa 18.3, Niha 16.2, Bater 14.5, Mresti 13.2, Maasser el Shouf 12.5, Baadaran 10.9 from the nearest shop) now
-- completes an order at $6.00; beyond 20 km and outside the boundary are still refused; the 7 October rows are
-- untouched; the place page's "Not on Alo King yet" radius stays 10 km (listing_radius_km); places between the named
-- villages within 20 km by road (Delghani, El Bireh) are delivered to again.
begin;

select tests.ok(public.max_delivery_km() = 20 and public.delivery_fee_usd(10) = 4.50 and public.delivery_fee_usd(10.9) = 6.00
  and public.delivery_fee_usd(18.3) = 6.00 and public.delivery_fee_usd(20.1) is null, 'the 15 October set: 10 km $4.50, 10-20 km $6.00');
select tests.ok((select array_agg((max_km, fee_usd)::text order by max_km) from public.delivery_fee_bands
  where effective_from = '2026-10-07 00:00+03') = array['(3.00,2.00)', '(6.00,3.00)', '(10.00,4.50)'], 'the 7 October rows are untouched');
select tests.ok(public.config_numeric('listing_radius_km') = 10, 'the listing radius is its own dated key');

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-BAK', 'CHF', 'Baakline test zone', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test'),
  ('TZ-JBA', 'CHF', 'Jbaa test zone', 'SRID=4326;MULTIPOLYGON(((35.64 33.60,35.68 33.60,35.68 33.64,35.64 33.64,35.64 33.60)))', 'test'),
  ('TZ-BIR', 'CHF', 'El Bireh test zone', 'SRID=4326;MULTIPOLYGON(((35.62 33.70,35.66 33.70,35.66 33.74,35.62 33.74,35.62 33.70)))', 'test'),
  ('TZ-DAM', 'CHF', 'Damour test zone', 'SRID=4326;MULTIPOLYGON(((35.44 33.70,35.48 33.70,35.48 33.74,35.44 33.74,35.44 33.70)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-BAK', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test'),
  ('LB-CHF-JBAA', 'TZ-JBA', 'جباع', 'Jbaa', 'village', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.66 33.62)', 'test'),
  ('LB-CHF-EL-BIREH', 'TZ-BIR', 'بيرة', 'El Bireh', 'village', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.6437 33.7218)', 'test'),
  ('LB-CHF-DAMOUR', 'TZ-DAM', 'الدامور', 'Damour', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.46 33.72)', 'test');

select set_config('app.fixture_owner_phone', '+96170000198', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Falafel Sandwich') as falafel \gset
select tests.ok(public.max_delivery_km() = 20, 'the staging fixture keeps the 20 km band (it retires only a band above 20 km)');
-- The grill stands in for a real pilot merchant in Baakline with no own radius (so the bands are its limit).
update public.vendors set is_test = false, town_id = 'LB-CHF-BAAKLINE', delivery_radius_km = null where id = :'tv';

-- The area: El Bireh, a place between at 12.7 km by road, is delivered to again ----------------------------------------
insert into app_private.delivery_boundary (place_id, name_en, role) values
  ('LB-CHF-BAAKLINE', 'Baakline', 'shop_village'), ('LB-CHF-JBAA', 'Jbaa', 'named_by_rasheed'),
  ('LB-CHF-EL-BIREH', 'El Bireh', 'between');
insert into app_private.delivery_denylist (place_id, name_en, reason) values ('LB-CHF-DAMOUR', 'Damour', 'Chouf el-Saheli');
insert into app_private.delivery_road_km values
  ('LB-CHF-JBAA', 18.30, 'ChIJtest', 'ors', '2026-10-14'), ('LB-CHF-EL-BIREH', 12.71, 'ChIJtest', 'ors', '2026-10-14');
select app_private.delivery_area_load('bands20') as l1 \gset
select tests.ok(:'l1'::jsonb -> 'beyond_road_km' = '[]' and :'l1'::jsonb -> 'named_beyond_road_km' = '[]'
  and (:'l1'::jsonb ->> 'delivered_to')::int = 3, 'within 20 km by road nothing in the boundary is cut');
select tests.ok((select service_status from public.places where id = 'LB-CHF-EL-BIREH') = 'on'
  and (select service_status from public.places where id = 'LB-CHF-JBAA') = 'on', 'El Bireh and Jbaa are on');
update app_private.delivery_road_km set road_km = 20.40 where place_id = 'LB-CHF-EL-BIREH';
select tests.ok(app_private.delivery_area_ids() = array['LB-CHF-BAAKLINE', 'LB-CHF-JBAA'],
  'a place between beyond 20 km by road would still be cut');
update app_private.delivery_road_km set road_km = 12.71 where place_id = 'LB-CHF-EL-BIREH';

-- An order to Jbaa at 18.3 road km completes at $6.00 ----------------------------------------------------------------
select public.customer_turn_begin('+96170000121', 'wamid.b20.1', 'text', 'Jbaa tester') as t1 \gset
select (:'t1'::jsonb #>> '{customer,id}') as jcid \gset
select tests.ok(public.address_save_pin(:'jcid', 33.621, 35.661, 'Jbaa') ->> 'status' = 'saved', 'a Jbaa pin is saved');
select public.route_cache_store(v.lat, v.lon, array[33.621], array[35.661], array[18300], array[1700], 'ors') from (
  select extensions.st_y(location::extensions.geometry) lat, extensions.st_x(location::extensions.geometry) lon
  from public.vendors where id = :'tv') v;
select tests.ok(public.customer_delivery_check(:'jcid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'ok'
  and (public.customer_delivery_check(:'jcid', array[:'tv'::uuid]) #>> '{vendors,0,fee_usd}')::numeric = 6.00,
  'the road check after the pin: Jbaa at 18.3 km is delivered, $6.00');
select tests.ok(public.basket_add_item(:'jcid', :'falafel', 1, '{}', null, true) ->> 'status' = 'added', 'a basket');
select tests.ok(public.basket_quote(:'jcid') ->> 'status' = 'ok' and (public.basket_quote(:'jcid') ->> 'delivery_fee_usd')::numeric = 6.00,
  'the quote charges $6.00');
select public.basket_view(:'jcid') as jbv \gset
select public.order_place((:'jbv'::jsonb ->> 'basket_id')::uuid, (:'jbv'::jsonb ->> 'menu_version')::bigint, 'wa:b20:jbaa:1') as jo \gset
select tests.ok(:'jo'::jsonb ->> 'status' = 'placed', 'the order is placed');
select tests.ok((select o.delivery_fee_usd = 6.00 and o.road_km = 18.30 and o.delivery_place_id = 'LB-CHF-JBAA'
  from public.orders o where o.id = (:'jo'::jsonb ->> 'order_id')::uuid), 'with the $6.00 fee and 18.3 road km on the order');

-- Beyond 20 km by road and outside the boundary are still refused -----------------------------------------------------
select public.customer_turn_begin('+96170000122', 'wamid.b20.2', 'text', 'Far tester') as t2 \gset
select (:'t2'::jsonb #>> '{customer,id}') as fcid \gset
select tests.ok(public.address_save_pin(:'fcid', 33.639, 35.679, 'Jbaa edge') ->> 'status' = 'saved', 'a far Jbaa pin is saved');
select public.route_cache_store(v.lat, v.lon, array[33.639], array[35.679], array[21500], array[2000], 'ors') from (
  select extensions.st_y(location::extensions.geometry) lat, extensions.st_x(location::extensions.geometry) lon
  from public.vendors where id = :'tv') v;
select tests.ok(public.customer_delivery_check(:'fcid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'beyond_radius'
  and (public.customer_delivery_check(:'fcid', array[:'tv'::uuid]) #>> '{vendors,0,limit_km}')::numeric = 20,
  '21.5 road km is beyond 20 km, even inside the boundary');
select public.customer_turn_begin('+96170000123', 'wamid.b20.3', 'text', 'Damour tester') as t3 \gset
select (:'t3'::jsonb #>> '{customer,id}') as dcid \gset
select tests.ok(public.address_save_pin(:'dcid', 33.721, 35.461, 'Damour') ->> 'status' = 'saved', 'a Damour pin is saved');
select public.route_cache_store(v.lat, v.lon, array[33.721], array[35.461], array[8200], array[800], 'ors') from (
  select extensions.st_y(location::extensions.geometry) lat, extensions.st_x(location::extensions.geometry) lon
  from public.vendors where id = :'tv') v;
select tests.ok(public.customer_delivery_check(:'dcid', array[:'tv'::uuid]) ->> 'status' = 'place_paused',
  'Damour (deny-listed) is refused at 8.2 road km');

-- A shop's own smaller radius still wins; a merchant may set up to 20 km --------------------------------------------------
update public.vendors set delivery_radius_km = 12 where id = :'tv';
select tests.ok(public.customer_delivery_check(:'jcid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'beyond_radius',
  'a shop with its own 12 km radius does not deliver to Jbaa at 18.3 km');
update public.vendors set delivery_radius_km = 20 where id = :'tv';
select tests.throws($$update public.vendors set delivery_radius_km = 20.5 where slug = 'alo-test-grill'$$, 'exceeds the 20',
  'a radius above 20 km is refused');
select tests.ok(app_private.merchant_flow_data(:'tv', 'en') ->> 'radius_km' = '20'
  and app_private.merchant_flow_data(:'tv', 'en') ->> 'fee_note' like '%$6.00 up to 20 km%',
  'the merchant Flow starts from 20 km and shows the $6.00 band');
update public.vendors set delivery_radius_km = 13.5 where id = :'tv';
select tests.ok(app_private.merchant_flow_data(:'tv', 'en') ->> 'radius_km' = '12', 'a radius between options snaps down to one');

rollback;
