-- Session F (DECISIONS §39.2): the delivery area is Rasheed's boundary. The loader turns the boundary file into a dated
-- pilot_place_ids row and switches places to match; deny-listed places stay off; the proposal is boundary ∩ road
-- distance (committed road km, else the route cache, else the straight line); a real merchant refuses an address in
-- a place that is off; the test merchant still takes any pin; OSM rows outside the area go.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-BAK', 'CHF', 'Baakline test zone', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test'),
  ('TZ-NIH', 'CHF', 'Niha test zone', 'SRID=4326;MULTIPOLYGON(((35.60 33.60,35.64 33.60,35.64 33.64,35.60 33.64,35.60 33.60)))', 'test'),
  ('TZ-DAM', 'CHF', 'Damour test zone', 'SRID=4326;MULTIPOLYGON(((35.44 33.70,35.48 33.70,35.48 33.74,35.44 33.74,35.44 33.70)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-BAK', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test'),
  ('LB-CHF-NIHA', 'TZ-NIH', 'نيحا', 'Niha', 'village', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.61 33.62)', 'test'),
  ('LB-CHF-DAMOUR', 'TZ-DAM', 'الدامور', 'Damour', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.46 33.72)', 'test');

select set_config('app.fixture_owner_phone', '+96170000197', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Falafel Sandwich') as falafel \gset
-- The grill stands in for a real pilot merchant in Baakline for the rule.
update public.vendors set is_test = false, town_id = 'LB-CHF-BAAKLINE' where id = :'tv';

-- The loader -------------------------------------------------------------------------------------------------------------
insert into app_private.delivery_boundary (place_id, name_en, role) values
  ('LB-CHF-BAAKLINE', 'Baakline', 'shop_village'), ('LB-CHF-NIHA', 'Niha', 'named_by_rasheed');
insert into app_private.delivery_denylist (place_id, name_en, reason) values ('LB-CHF-DAMOUR', 'Damour', 'Chouf el-Saheli');
update public.places set service_status = 'on' where id = 'LB-CHF-DAMOUR';
select app_private.delivery_area_load('f00d') as l1 \gset
select tests.ok((:'l1'::jsonb ->> 'new_dated_row')::boolean and (:'l1'::jsonb ->> 'boundary')::int = 2,
  'a boundary that differs from pilot_place_ids becomes a new dated row');
select tests.ok((select array_agg(x order by x) from jsonb_array_elements_text(public.config_value('pilot_place_ids')) x)
  = array['LB-CHF-BAAKLINE', 'LB-CHF-NIHA'], 'pilot_place_ids is the boundary');
select tests.ok((select service_status from public.places where id = 'LB-CHF-NIHA') = 'on'
  and (select service_status from public.places where id = 'LB-CHF-DAMOUR') = 'off', 'Niha is on; deny-listed Damour is off');
select tests.ok(not (app_private.delivery_area_load('f00d') ->> 'new_dated_row')::boolean, 'loading the same file again adds no row');

insert into app_private.delivery_boundary (place_id, role) values ('LB-CHF-DAMOUR', 'between');
select tests.throws($$select app_private.delivery_area_load('bad1')$$, 'deny-listed places in the boundary', 'a deny-listed place in the boundary is refused');
delete from app_private.delivery_boundary where place_id = 'LB-CHF-DAMOUR';
insert into app_private.delivery_boundary (place_id, role) values ('LB-CHF-NOWHERE', 'between');
select tests.throws($$select app_private.delivery_area_load('bad2')$$, 'unknown place ids', 'an unknown place id is refused');
delete from app_private.delivery_boundary where place_id = 'LB-CHF-NOWHERE';

-- The proposal: boundary ∩ road distance ---------------------------------------------------------------------------------
select tests.ok((select distance_source = 'straight_line' and distance_km < 10 and in_pilot_place_ids
  from public.delivery_area_proposal() where place_id = 'LB-CHF-NIHA'), 'with no road distance, Niha is in by the straight line');
select tests.ok(not exists (select 1 from public.delivery_area_proposal() where place_id = 'LB-CHF-DAMOUR'),
  'a deny-listed place is never proposed');
select public.route_cache_store(v.lat, v.lon, array[33.62], array[35.61], array[9400], array[900], 'ors') from (
  select extensions.st_y(location::extensions.geometry) lat, extensions.st_x(location::extensions.geometry) lon
  from public.vendors where id = :'tv') v;
select tests.ok((select distance_source = 'route_cache' and distance_km = 9.40
  from public.delivery_area_proposal() where place_id = 'LB-CHF-NIHA'), 'a cached route gives the road distance');
insert into app_private.delivery_road_km values ('LB-CHF-NIHA', 12.30, 'ChIJtest', 'ors', '2026-10-15');
select tests.ok(not exists (select 1 from public.delivery_area_proposal() where place_id = 'LB-CHF-NIHA'),
  'beyond max_delivery_km() by road (committed file), Niha is not proposed');
select tests.ok(exists (select 1 from jsonb_array_elements_text(public.config_value('pilot_place_ids')) a(id)
  where not exists (select 1 from public.delivery_area_proposal() d where d.place_id = a.id)),
  'so pilot_place_ids ⊄ proposal: the seed check flags it');
delete from app_private.delivery_road_km;

-- Enforcement: a real merchant refuses an address in a place that is off --------------------------------------------------
select public.customer_turn_begin('+96170000111', 'wamid.f.1', 'text', 'Damour tester') as t1 \gset
select (:'t1'::jsonb #>> '{customer,id}') as dcid \gset
select tests.ok(public.address_save_pin(:'dcid', 33.721, 35.461, 'Damour') ->> 'status' = 'saved', 'a Damour pin is saved');
select public.route_cache_store(v.lat, v.lon, array[33.721], array[35.461], array[8200], array[800], 'ors') from (
  select extensions.st_y(location::extensions.geometry) lat, extensions.st_x(location::extensions.geometry) lon
  from public.vendors where id = :'tv') v;
select tests.ok(public.customer_delivery_check(:'dcid', array[:'tv'::uuid]) ->> 'status' = 'place_paused',
  'the road check after the pin: Damour is outside the area although 8.2 road km is within the radius');
select tests.ok(public.basket_add_item(:'dcid', :'falafel', 1, '{}', null, true) ->> 'status' = 'added', 'a basket');
select tests.ok(public.basket_quote(:'dcid') ->> 'status' = 'place_paused', 'the quote refuses it');
select public.basket_view(:'dcid') as dbv \gset
select tests.ok(public.order_place((:'dbv'::jsonb ->> 'basket_id')::uuid, (:'dbv'::jsonb ->> 'menu_version')::bigint, 'wa:f:damour:1') ->> 'status' = 'place_paused',
  'and the order is refused');

select public.customer_turn_begin('+96170000112', 'wamid.f.2', 'text', 'Niha tester') as t2 \gset
select (:'t2'::jsonb #>> '{customer,id}') as ncid \gset
select tests.ok(public.address_save_pin(:'ncid', 33.621, 35.611, 'Niha') ->> 'status' = 'saved', 'a Niha pin is saved');
select public.route_cache_store(v.lat, v.lon, array[33.621], array[35.611], array[9300], array[900], 'ors') from (
  select extensions.st_y(location::extensions.geometry) lat, extensions.st_x(location::extensions.geometry) lon
  from public.vendors where id = :'tv') v;
select tests.ok(public.customer_delivery_check(:'ncid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'ok',
  'inside the area, the same merchant delivers');

update public.vendors set is_test = true where id = :'tv';
select tests.ok(public.customer_delivery_check(:'dcid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'ok'
  and public.basket_quote(:'dcid') ->> 'status' = 'ok', 'the staging test merchant still takes the Damour pin (§35)');

-- OSM outside the area goes ------------------------------------------------------------------------------------------------
insert into public.landmarks (place_id, name_en, kind, point, source, status, shared, confidence, osm_ref) values
  ('LB-CHF-NIHA', 'Niha church', 'church', 'SRID=4326;POINT(35.611 33.621)', 'osm', 'unconfirmed', true, 0.3, 'node/9000001'),
  ('LB-CHF-DAMOUR', 'Damour church', 'church', 'SRID=4326;POINT(35.461 33.721)', 'osm', 'unconfirmed', true, 0.3, 'node/9000002');
insert into public.place_aliases (place_id, alias, status, shared, source, osm_key) values
  ('LB-CHF-NIHA', 'Nihat el Chouf', 'confirmed', true, 'osm', 'alt_name'),
  ('LB-CHF-DAMOUR', 'Damour el Sahel', 'confirmed', true, 'osm', 'alt_name');
select tests.ok(app_private.osm_prune_outside_area() = '{"landmarks_removed": 1, "aliases_removed": 1}'::jsonb,
  'the prune removes one landmark and one place name');
select tests.ok(exists (select 1 from public.landmarks where osm_ref = 'node/9000001')
  and not exists (select 1 from public.landmarks where osm_ref = 'node/9000002')
  and not exists (select 1 from public.place_aliases where alias = 'Damour el Sahel')
  and exists (select 1 from public.place_aliases where alias = 'Nihat el Chouf'), 'Niha keeps its OSM rows, Damour loses them');

rollback;
