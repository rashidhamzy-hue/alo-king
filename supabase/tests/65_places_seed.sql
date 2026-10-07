-- Places seed loading and spelling-tolerant search (§16).
begin;

insert into app_private.seed_districts values ('CHF', 'LB-CHF-PCODE', 'POLYGON((35.5 33.6,35.7 33.6,35.7 33.8,35.5 33.8,35.5 33.6))');
insert into app_private.seed_zones values
  ('Z1', 'CHF', 'بعقلين', 'Baakline', null, 700, 1000, true, 'MULTIPOLYGON(((35.57 33.67,35.60 33.67,35.60 33.695,35.57 33.695,35.57 33.67)))'),
  ('Z2', 'CHF', 'جديدة الشوف', 'Jdeidet ech Chouf', null, 800, 1100, true, 'MULTIPOLYGON(((35.60 33.66,35.63 33.66,35.63 33.69,35.60 33.69,35.60 33.66)))'),
  ('Z3', 'NBT', 'النبطية', 'Nabatieh', null, 300, 500, true, 'MULTIPOLYGON(((35.47 33.37,35.50 33.37,35.50 33.39,35.47 33.39,35.47 33.37)))');
insert into app_private.seed_places values
  ('LB-CHF-BAAKLINE', 'Z1', 'Z1', 'بعقلين', 'Baakline', null, 'Baaqline', 'town', 'CHF', 'Baakline', 'Chouf el-Awsat', 'middle_mountain', 840, false, 33.6821, 35.5861, null, null, '{"name_ar": "high"}', '1'),
  ('LB-CHF-BAKAATA', null, 'Z2', 'بقعاتا', 'Bakaata', null, 'Ba2aata;Baqaata', 'town', 'CHF', 'Jdeidet ech Chouf', null, 'middle_mountain', 880, false, 33.6738, 35.6175, null, 'LB-CHF-JDEIDET-ECH-CHOUF', '{}', null),
  ('LB-CHF-JDEIDET-ECH-CHOUF', 'Z2', 'Z2', 'جديدة الشوف', 'Jdeidet ech Chouf', null, null, 'village', 'CHF', 'Jdeidet ech Chouf', null, 'middle_mountain', 900, false, 33.6686, 35.6186, null, null, '{}', '2'),
  ('LB-NBT-NABATIEH', 'Z3', 'Z3', 'النبطية', 'Nabatieh', null, null, 'city', 'NBT', 'Nabatieh', null, 'lower_mountain', 420, false, 33.378, 35.484, null, null, '{}', '3');

select tests.ok((app_private.places_load_seed('sha-1') ->> 'places')::int = 4, 'the loader inserts every seed place');
select tests.ok((select parent_id from public.places where id = 'LB-CHF-BAKAATA') = 'LB-CHF-JDEIDET-ECH-CHOUF', 'parents are linked after all places exist');
select tests.ok((select governorate_code from public.places where id = 'LB-CHF-BAKAATA') = 'mount_lebanon', 'governorate comes from the district');
select tests.ok((select service_status from public.places where id = 'LB-NBT-NABATIEH') = 'paused', 'Nabatieh loads paused');
select tests.ok((select pcode is not null and boundary is not null from public.districts where code = 'CHF'), 'district P-code and boundary are loaded');
select tests.ok((select count(*) from public.cadastral_zones) = 3, 'zones are loaded');
select tests.ok((select sha256 from app_private.seed_loads where name = 'places') = 'sha-1', 'the load is recorded with its hash');
select tests.ok((select vendors_relinked from (select (counts ->> 'vendors_relinked')::int as vendors_relinked from app_private.seed_loads) x) >= 1,
  'existing vendors are linked to their town after a load');
select tests.ok((select town_id from public.vendors where slug = 'vendor-a') = 'LB-CHF-BAAKLINE', 'vendor A (pin in Baakline) gets Baakline');

-- A reload changes names but never the status an admin set, and never deletes a place.
set local role service_role;
select public.place_set_service_status('LB-CHF-BAKAATA', 'on', 'pilot area');
reset role;
delete from app_private.seed_places where id = 'LB-NBT-NABATIEH';
update app_private.seed_places set name_fr = 'Bakaata (FR)' where id = 'LB-CHF-BAKAATA';
select tests.ok((app_private.places_load_seed('sha-2') ->> 'not_in_seed')::int = 1, 'a place missing from the new seed is reported, not deleted');
select tests.ok((select service_status = 'on' and name_fr = 'Bakaata (FR)' from public.places where id = 'LB-CHF-BAKAATA'),
  'a reload updates names and keeps the admin''s status');
select tests.ok(exists (select 1 from public.places where id = 'LB-NBT-NABATIEH'), 'the missing place still exists');
insert into app_private.seed_places (id, kind, district_code, name_en, lat, lon) values ('LB-XXX-BAD', 'town', 'XXX', 'Bad', 33.5, 35.5);
select tests.throws($$select app_private.places_load_seed('sha-3')$$, 'unknown district', 'a seed naming an unknown district is refused');

-- Spelling-tolerant search.
select tests.ok(app_private.place_phonetic_key('Ba3qlin') = app_private.place_phonetic_key('بعقلين')
  and app_private.place_phonetic_key('Baakline') = 'bkln', 'Arabizi, Arabic and English spellings share a key');
select tests.ok(app_private.place_phonetic_key('Beit el Din') = app_private.place_phonetic_key('Beiteddine'), 'Beit el Din = Beiteddine');
select tests.ok(app_private.place_phonetic_key('Ashrafiyeh') = app_private.place_phonetic_key('الأشرفية'), 'Ashrafiyeh = الأشرفية');
select tests.ok((select id from public.search_places('ba3qlin') limit 1) = 'LB-CHF-BAAKLINE', 'an unlisted Arabizi spelling finds Baakline');
select tests.ok((select id from public.search_places('Baqaata') limit 1) = 'LB-CHF-BAKAATA', 'a seed alias finds Bakaata');
select tests.ok((select id from public.search_places('بقعاته') limit 1) = 'LB-CHF-BAKAATA', 'an Arabic misspelling finds Bakaata');
select tests.ok(not exists (select 1 from public.search_places('zzzz')), 'nonsense finds nothing');

set local role anon;
select tests.act_as(null);
select tests.throws($$select * from app_private.seed_places$$, 'permission denied', 'clients cannot read the seed staging tables');
select tests.throws($$select app_private.places_load_seed('x')$$, 'permission denied', 'clients cannot load a seed');
reset role;

rollback;
