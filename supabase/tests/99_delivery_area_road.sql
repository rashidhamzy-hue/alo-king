-- Session F (DECISIONS §39.2, 20261014220000): the loader with committed road distances. A place between the named
-- villages that is beyond max_delivery_km() by road from every merchant leaves the dated pilot_place_ids row and is
-- switched off; a shop village and a village Rasheed named stay on whatever the road file says. Its own file, so the
-- loader's dated row gets its own now() (app_config rows are never edited).
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-BAK', 'CHF', 'Baakline test zone', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test'),
  ('TZ-NIH', 'CHF', 'Niha test zone', 'SRID=4326;MULTIPOLYGON(((35.60 33.60,35.64 33.60,35.64 33.64,35.60 33.64,35.60 33.60)))', 'test'),
  ('TZ-MOU', 'CHF', 'Moukhtara test zone', 'SRID=4326;MULTIPOLYGON(((35.64 33.60,35.68 33.60,35.68 33.64,35.64 33.64,35.64 33.60)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-BAK', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test'),
  ('LB-CHF-NIHA', 'TZ-NIH', 'نيحا', 'Niha', 'village', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.61 33.62)', 'test'),
  ('LB-CHF-MOUKHTARA', 'TZ-MOU', 'المختارة', 'Moukhtara', 'village', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.65 33.62)', 'test');
update public.places set service_status = 'on' where id = 'LB-CHF-MOUKHTARA';

insert into app_private.delivery_boundary (place_id, name_en, role) values
  ('LB-CHF-BAAKLINE', 'Baakline', 'shop_village'), ('LB-CHF-NIHA', 'Niha', 'named_by_rasheed'),
  ('LB-CHF-MOUKHTARA', 'Moukhtara', 'between');
insert into app_private.delivery_road_km values
  ('LB-CHF-BAAKLINE', 21.00, 'ChIJtest', 'ors', '2026-10-15'),
  ('LB-CHF-NIHA', 22.20, 'ChIJtest', 'osrm', '2026-10-15'),
  ('LB-CHF-MOUKHTARA', 20.70, 'ChIJtest', 'osrm', '2026-10-15');
select app_private.delivery_area_load('road1') as l1 \gset

select tests.ok((:'l1'::jsonb ->> 'new_dated_row')::boolean and (:'l1'::jsonb ->> 'delivered_to')::int = 2,
  'the loader writes a new dated row with two places');
select tests.ok(:'l1'::jsonb -> 'beyond_road_km' = '["LB-CHF-MOUKHTARA"]'
    and :'l1'::jsonb -> 'named_beyond_road_km' = '["LB-CHF-BAAKLINE", "LB-CHF-NIHA"]',
  'it lists the place between and the shop and named villages that are beyond road distance');
select tests.ok((select array_agg(x order by x) from jsonb_array_elements_text(public.config_value('pilot_place_ids')) x)
  = array['LB-CHF-BAAKLINE', 'LB-CHF-NIHA'], 'the dated row in force is the boundary minus the place between');
select tests.ok((select service_status from public.places where id = 'LB-CHF-MOUKHTARA') = 'off',
  'the place between beyond road distance is switched off');
select tests.ok((select service_status from public.places where id = 'LB-CHF-NIHA') = 'on'
    and (select service_status from public.places where id = 'LB-CHF-BAAKLINE') = 'on',
  'the named village and the shop village stay on');
select tests.ok(not (app_private.delivery_area_load('road1') ->> 'new_dated_row')::boolean,
  'loading the same files again adds no row');

-- Within road distance the place between is in again (the next load after the road file changes).
update app_private.delivery_road_km set road_km = 8.40 where place_id = 'LB-CHF-MOUKHTARA';
select tests.ok(app_private.delivery_area_ids() = array['LB-CHF-BAAKLINE', 'LB-CHF-MOUKHTARA', 'LB-CHF-NIHA'],
  'a place between within road distance is delivered to');

rollback;
