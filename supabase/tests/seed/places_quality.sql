-- Quality checks on the real places seed (DECISIONS §16), run by scripts/db-test.sh after loading it.
begin;

select tests.ok((select count(*) from public.places) between 1500 and 4500, 'about 2,240 destinations (1,500-4,500)');
select tests.ok((select count(distinct district_code) from public.places) = 26, 'every district has places');
select tests.ok((select count(*) from public.cadastral_zones) between 1400 and 1800, 'about 1,623 cadastral zones');
select tests.ok(not exists (select 1 from public.districts where boundary is null or pcode is null), 'every district has its P-code and polygon');
select tests.ok(not exists (select 1 from public.places where service_status = 'on'), 'every place loads off');
select tests.ok(not exists (select 1 from public.places where governorate_code in ('south', 'nabatieh') and service_status <> 'paused'),
  'South and Nabatieh are paused');
select tests.ok((select count(*) filter (where name_ar is not null) * 1.0 / count(*) from public.places) >= 0.8, 'at least 80% of places have an Arabic name');
select tests.ok((select count(*) filter (where elevation_m is not null) * 1.0 / count(*) from public.places) >= 0.98, 'elevations come from the terrain model');

-- §16's named places.
select tests.ok(exists (select 1 from public.places where id = 'LB-CHF-BAKAATA' and parent_id like 'LB-CHF-JDEIDET%'), 'Bakaata, under Jdeidet el-Chouf');
select tests.ok(exists (select 1 from public.search_places('Semqanieh', 'CHF')), 'Semqanieh');
select tests.ok((select id from public.search_places('Baakline', 'CHF') limit 1) = 'LB-CHF-BAAKLINE', 'Baakline');
select tests.ok(exists (select 1 from public.search_places('Beiteddine', 'CHF')), 'Beiteddine');
select tests.ok(exists (select 1 from public.places p join public.places q on q.id = p.parent_id
  where p.name_en = 'Kaslik' and q.name_en ilike 'Jounie%'), 'Kaslik, under Jounieh');
select tests.ok(exists (select 1 from public.places where name_en = 'Dora' and district_code = 'MTN'), 'Dora');
select tests.ok(exists (select 1 from public.places where name_en = 'Dawha Aramoun' or 'Dawha Aramoun' = any (aliases)), 'Dawha Aramoun');
select tests.ok(exists (select 1 from public.places where (name_en ilike '%cedars%' or 'The Cedars' = any (aliases)) and district_code = 'BSH' and winter_risk),
  'The Cedars, with winter risk');
select tests.ok(exists (select 1 from public.places where (name_en ilike 'mzaar%' or 'Mzaar' = any (aliases)) and winter_risk), 'Mzaar, with winter risk');
select tests.ok(exists (select 1 from public.places where (name_en ilike 'faqra%' or 'Faqra' = any (aliases)) and district_code = 'KSR'), 'Faqra');
select tests.ok(exists (select 1 from public.places where name_en ilike 'ehden%' and district_code = 'ZGH')
  and exists (select 1 from public.places where name_en ilike 'zgharta%' and district_code = 'ZGH'), 'Zgharta and Ehden are separate places');
select tests.ok((select count(*) from public.search_places('khraybeh')) >= 2, 'same-name villages exist as separate places');

-- Snapping and search on real data.
select tests.ok((select place_id from public.place_for_point('SRID=4326;POINT(35.5861 33.6821)')) = 'LB-CHF-BAAKLINE', 'Baakline''s centre snaps to Baakline');
select tests.ok((select place_id from public.place_for_point('SRID=4326;POINT(35.6175 33.6738)')) = 'LB-CHF-BAKAATA', 'Bakaata''s centre snaps to Bakaata');
select tests.ok((select id from public.search_places('ba3qlin') limit 1) = 'LB-CHF-BAAKLINE', 'Ba3qlin finds Baakline');
select tests.ok(exists (select 1 from public.search_places('beit el din') s where s.id like 'LB-CHF-BEIT%'), 'Beit el Din finds Beiteddine');

rollback;
