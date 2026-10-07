-- Places, pin snapping, place search, service status, categories and the vendor town link (§16, §17).
begin;

-- Fixture: two Chouf zones, one Nabatieh zone, and places in them.
insert into public.cadastral_zones (pcode, district_code, name_ar, name_en, boundary, source) values
  ('TZ-BAAKLINE', 'CHF', 'بعقلين', 'Baakline', 'SRID=4326;MULTIPOLYGON(((35.57 33.67,35.60 33.67,35.60 33.695,35.57 33.695,35.57 33.67)))', 'test'),
  ('TZ-JDEIDEH', 'CHF', 'جديدة الشوف', 'Jdeidet ech Chouf', 'SRID=4326;MULTIPOLYGON(((35.60 33.66,35.63 33.66,35.63 33.69,35.60 33.69,35.60 33.66)))', 'test'),
  ('TZ-KHRAYBEH-B', 'BLB', 'خريبة', 'Khraybeh', 'SRID=4326;MULTIPOLYGON(((36.10 34.00,36.12 34.00,36.12 34.02,36.10 34.02,36.10 34.00)))', 'test'),
  ('TZ-NAB', 'NBT', 'النبطية', 'Nabatieh', 'SRID=4326;MULTIPOLYGON(((35.47 33.37,35.50 33.37,35.50 33.39,35.47 33.39,35.47 33.37)))', 'test');

insert into public.places (id, zone_pcode, name_ar, name_en, aliases, kind, governorate_code, district_code, centroid, source, service_status) values
  ('LB-CHF-BAAKLINE', 'TZ-BAAKLINE', 'بعقلين', 'Baakline', '{Ba3qlin,Baaqline}', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.5861 33.6821)', 'test', 'on'),
  ('LB-CHF-JDEIDET-ECH-CHOUF', 'TZ-JDEIDEH', 'جديدة الشوف', 'Jdeidet ech Chouf', '{}', 'village', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.6200 33.6800)', 'test', 'off'),
  ('LB-CHF-KHRAYBEH', 'TZ-BAAKLINE', 'الخريبة', 'Khraybeh', '{}', 'village', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.5750 33.6750)', 'test', 'off'),
  ('LB-BLB-KHRAYBEH', 'TZ-KHRAYBEH-B', 'خريبة', 'Khraybeh', '{}', 'village', 'baalbek_hermel', 'BLB', 'SRID=4326;POINT(36.11 34.01)', 'test', 'off'),
  ('LB-NBT-NABATIEH', 'TZ-NAB', 'النبطية', 'Nabatieh', '{}', 'city', 'nabatieh', 'NBT', 'SRID=4326;POINT(35.48 33.38)', 'test', 'on');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, parent_id, source) values
  ('LB-CHF-BAKAATA', 'TZ-JDEIDEH', 'بقعاتا', 'Bakaata', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.6175 33.6738)', 'LB-CHF-JDEIDET-ECH-CHOUF', 'test');
select public.places_refresh_shared_names();

-- Load rules.
select tests.ok((select service_status from public.places where id = 'LB-CHF-BAAKLINE') = 'off', 'every place loads off, whatever the seed says');
select tests.ok((select service_status = 'paused' and paused_reason = 'security' from public.places where id = 'LB-NBT-NABATIEH'),
  'Nabatieh and South places load paused for security');
select tests.throws($$insert into public.places (id, name_en, kind, governorate_code, district_code, centroid, source)
  values ('LB-CHF-X', 'X', 'village', 'beirut', 'CHF', 'SRID=4326;POINT(35.5 33.6)', 'test')$$,
  'places_district_fk', 'a place cannot sit in a district of another governorate');
select tests.throws($$insert into public.places (id, name_en, kind, governorate_code, district_code, centroid, source)
  values ('chouf-x', 'X', 'village', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.5 33.6)', 'test')$$,
  'places_id_check', 'place IDs look like LB-CHF-BAKAATA');
select tests.ok((select count(*) from public.districts) = 26 and (select count(*) from public.governorates) = 9,
  '26 districts in 9 governorates');

-- Normalisation.
select tests.ok(app_private.normalize_place_name('Jdeidet ech-Chouf') = 'jdeidet chouf', 'articles and hyphens are dropped');
select tests.ok(app_private.normalize_place_name('Jounié') = 'jounie', 'accents are dropped');
select tests.ok(app_private.normalize_place_name('السمقانيّة') = app_private.normalize_place_name('سمقانية'),
  'Arabic article, shadda and ta marbuta are normalised');

-- Pin snapping.
select tests.ok((select place_id from public.place_for_point('SRID=4326;POINT(35.6170 33.6740)')) = 'LB-CHF-BAKAATA',
  'a pin in Bakaata snaps to Bakaata, not to its parent municipality');
select tests.ok((select method from public.place_for_point('SRID=4326;POINT(35.585 33.681)')) = 'zone', 'snapping uses the cadastral zone first');
select tests.ok((select place_id from public.place_for_point('SRID=4326;POINT(35.585 33.681)')) = 'LB-CHF-BAAKLINE', 'a pin in Baakline snaps to Baakline');
select tests.ok((select place_id from public.place_for_point('SRID=4326;POINT(35.6010 33.6800)')) = 'LB-CHF-BAKAATA',
  'the zone wins over a closer centroid in the next zone');
select tests.ok((select method from public.place_for_point('SRID=4326;POINT(35.567 33.68)')) = 'nearest', 'just outside every zone falls back to the nearest place');
select tests.ok(not exists (select 1 from public.place_for_point('SRID=4326;POINT(34.9 33.9)')), 'a pin at sea snaps to nothing');

-- Search in four languages; same-name villages carry their district.
select tests.ok((select id from public.search_places('ba3qlin') limit 1) = 'LB-CHF-BAAKLINE', 'Arabizi alias finds Baakline');
select tests.ok((select id from public.search_places('بعقلين') limit 1) = 'LB-CHF-BAAKLINE', 'Arabic name finds Baakline');
select tests.ok((select id from public.search_places('Bakaata') limit 1) = 'LB-CHF-BAKAATA', 'English name finds Bakaata');
select tests.ok((select label_en from public.search_places('khraybeh', 'BLB')) = 'Khraybeh (Baalbek)', 'same-name villages show the district');
select tests.ok((select label_en from public.search_places('Bakaata') limit 1) = 'Bakaata', 'unique names show no district');
select tests.ok(tests.count_of($$select * from public.search_places('khraybeh')$$) = 2, 'both Khraybeh villages are returned');

-- Access.
set local role anon;
select tests.act_as(null);
select tests.ok(tests.count_of('select id from public.places') = 6, 'anon reads places');
select tests.ok((select id from public.search_places('bakaata') limit 1) = 'LB-CHF-BAKAATA', 'anon can search places');
select tests.throws($$update public.places set service_status = 'on'$$, 'permission denied', 'anon cannot switch places');
select tests.throws($$select public.place_set_service_status('LB-CHF-BAKAATA', 'on')$$, 'permission denied', 'anon cannot call the switch RPC');
select tests.throws($$insert into public.cuisine_tags (tag, name_ar, name_en, name_fr) values ('x', 'x', 'x', 'x')$$, 'permission denied', 'anon cannot add tags');
reset role;

set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000e');
update public.places set service_status = 'on' where id = 'LB-CHF-BAKAATA';
select tests.throws($$update public.places set name_en = 'X'$$, 'permission denied', 'a merchant cannot rename places');
select tests.throws($$select public.place_set_service_status('LB-CHF-BAKAATA', 'on')$$, 'only the admin', 'a merchant cannot switch places');
select tests.throws($$insert into public.cuisine_tags (tag, name_ar, name_en, name_fr) values ('x', 'x', 'x', 'x')$$, 'row-level security', 'a merchant cannot add tags');
select tests.ok(tests.count_of('select town_id from public.vendors') = 1, 'clients may read a vendor''s town column');
reset role;
select tests.ok((select service_status from public.places where id = 'LB-CHF-BAKAATA') = 'off', 'a merchant''s direct status update changes nothing');

set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000b');
select tests.throws($$select public.place_set_service_status('LB-CHF-BAKAATA', 'on')$$, 'only the admin', 'an operator cannot switch places');
reset role;

set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000a');
select public.place_set_service_status('LB-CHF-BAKAATA', 'on', 'first marketing area');
select tests.throws($$select public.place_set_service_status('LB-CHF-BAKAATA', 'paused')$$, 'needs a reason', 'pausing needs a reason');
insert into public.cuisine_tags (tag, name_ar, name_en, name_fr) values ('georgian', 'جورجي', 'Georgian', 'Géorgien');
reset role;
select tests.ok((select service_status from public.places where id = 'LB-CHF-BAKAATA') = 'on', 'the admin switches a place on');
select tests.ok(exists (
  select 1 from public.audit_log
  where table_name = 'places' and row_id = 'LB-CHF-BAKAATA' and actor_id = '00000000-0000-0000-0000-00000000000a'
    and new_row ->> 'service_status' = 'on' and reason = 'first marketing area'
), 'switching a place is audited with the admin and the reason');
select tests.ok(exists (select 1 from public.cuisine_tags where tag = 'georgian'), 'the admin adds a cuisine tag');

-- Categories and the vendor town link.
select tests.ok((select count(*) from public.cuisine_tags where tag <> 'georgian') = 30, 'the 30 cuisine tags of §17 are seeded');
select tests.ok((select count(*) from public.business_type_labels) = 15, 'every business type has a label');
select tests.throws($$update public.vendors set cuisine_tags = '{lebanese,martian}' where slug = 'vendor-a'$$,
  'unknown cuisine tag martian', 'vendors take only known cuisine tags');
update public.vendors set cuisine_tags = '{lebanese,manakish}' where slug = 'vendor-a';
select tests.ok((select cuisine_tags from public.vendors where slug = 'vendor-a') = '{lebanese,manakish}', 'known tags are accepted');

insert into public.vendors (id, slug, name_en, business_type, source, location) values
  ('20000000-0000-0000-0000-0000000000d1', 'bakaata-shop', 'Bakaata Shop', 'minimarket', 'seed_2026_10', 'SRID=4326;POINT(35.6172 33.6741)');
select tests.ok((select town_id from public.vendors where slug = 'bakaata-shop') = 'LB-CHF-BAKAATA', 'a new vendor gets its town from its pin');
update public.vendors set location = 'SRID=4326;POINT(35.585 33.681)' where slug = 'bakaata-shop';
select tests.ok((select town_id from public.vendors where slug = 'bakaata-shop') = 'LB-CHF-BAAKLINE', 'a moved pin moves the town');
update public.vendors set town_id = 'LB-CHF-BAKAATA', field_sources = '{"town_id": "merchant"}' where slug = 'bakaata-shop';
update public.vendors set location = 'SRID=4326;POINT(35.5855 33.6815)' where slug = 'bakaata-shop';
select tests.ok((select town_id from public.vendors where slug = 'bakaata-shop') = 'LB-CHF-BAKAATA', 'a merchant-set town is kept when the pin moves');
select tests.ok(public.vendors_relink_towns() >= 0 and (select town_id from public.vendors where slug = 'bakaata-shop') = 'LB-CHF-BAKAATA',
  'relinking never overrides a merchant-set town');

rollback;
