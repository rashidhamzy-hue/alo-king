-- Session 5h part 4 (§39.15.6): the address card no longer runs the zone lookup a second time, and browse_delivering
-- answers what customer_search_point, browse_shops and customer_delivery_check answer, in one call.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-SP', 'CHF', 'Speed pin zone', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-SP', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test')
on conflict (id) do nothing;
select set_config('app.fixture_owner_phone', '+96170000201', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
update public.vendors set town_id = 'LB-CHF-BAAKLINE' where id = :'tv';
select (public.customer_turn_begin('+96170000202', 'wamid.sp.1', 'text', 'Hi') #>> '{customer,id}') as cu \gset

select tests.ok(public.browse_delivering(:'cu') -> 'point' = 'null'::jsonb, 'no address yet: no point, nothing else');

select public.address_save_pin(:'cu', 33.6771, 35.5641) as saved \gset
select tests.ok(:'saved'::jsonb ->> 'status' = 'saved' and :'saved'::jsonb #>> '{address,place_en}' = 'Baakline',
  'the pin is saved against its place');
select tests.ok(:'saved'::jsonb #> '{address,near}' is not null and not (:'saved'::jsonb #> '{address,near}' ? 'place'),
  'the card''s "near" holds the landmark and the building only (the place is the card''s own)');

select public.browse_delivering(:'cu') as b \gset
select public.customer_search_point(:'cu') as pt \gset
select tests.ok(:'b'::jsonb -> 'point' = :'pt'::jsonb, 'the point is customer_search_point''s');
select tests.ok(:'b'::jsonb -> 'shops' = public.browse_shops(:'cu', (:'pt'::jsonb ->> 'lat')::float8, (:'pt'::jsonb ->> 'lon')::float8, 40) -> 'shops',
  'the shops are browse_shops''');
select tests.ok(jsonb_array_length(:'b'::jsonb -> 'shops') > 0
  and :'b'::jsonb -> 'check' = public.customer_delivery_check(:'cu',
    (select array_agg((x ->> 'vendor_id')::uuid) from jsonb_array_elements(:'b'::jsonb -> 'shops') x)),
  'the check is customer_delivery_check''s for those shops');
select tests.ok(not has_function_privilege('anon', 'public.browse_delivering(uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.browse_delivering(uuid, integer)', 'execute'),
  'only the service role browses for a customer');

rollback;
