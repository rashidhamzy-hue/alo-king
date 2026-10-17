-- Session 5g part B: Explore behind the signed link. Shops that deliver to the customer's place (shop_place_routes, zero
-- routing calls), open and nearest first, 20 a page; categories, search, popular dishes (real sales only, else "dishes
-- near you"), new shops, and "Not on Alo King yet" last.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-EX', 'CHF', 'Explore zone', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-EX', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test')
on conflict (id) do nothing;
select set_config('app.fixture_owner_phone', '+96170000191', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
update public.vendors set town_id = 'LB-CHF-BAAKLINE' where id = :'tv';
insert into public.app_config (key, value, effective_from, note)
values ('public_site_url', '"https://aloking.test"', now() - interval '1 minute', 'test');
-- Two more shops: one near and open, one too far for its radius.
insert into public.vendors (slug, name_ar, name_en, business_type, cuisine_tags, claim_status, listing_status, orderable,
  source, location, delivery_radius_km, town_id, delivery_enabled) values
  ('ex-pizza-near', 'بيتزا قريبة', 'Near Pizza', 'restaurant', '{pizza}', 'claimed', 'active', true, 'admin',
   app_private.lat_lon_point(33.6772, 35.5642), 10, 'LB-CHF-BAAKLINE', true),
  ('ex-far-shop', 'محل بعيد', 'Far Shop', 'restaurant', '{}', 'claimed', 'active', true, 'admin',
   app_private.lat_lon_point(33.70, 35.60), 3, 'LB-CHF-BAAKLINE', true);
select id as vp from public.vendors where slug = 'ex-pizza-near' \gset
select id as vf from public.vendors where slug = 'ex-far-shop' \gset
insert into public.menu_items (vendor_id, name_en, name_ar, price_usd) values
  (:'vp', 'Margherita Pizza', 'بيتزا مارغريتا', 8), (:'vp', 'Pepperoni Pizza', 'بيتزا بيبروني', 9);
select (select id from public.menu_items where vendor_id = :'vp' and name_en = 'Margherita Pizza') as marg \gset
insert into public.menu_item_photos (item_id, vendor_id, storage_path, source, origin_hash)
values (:'marg', :'vp', 'merchant/' || :'vp' || '/' || :'marg' || '.jpg', 'merchant', repeat('a', 64));
select app_private.vendor_browse_refresh(:'vp');
insert into public.shop_place_routes (vendor_id, place_id, road_km, minutes, provider, origin, dest)
select v.id, 'LB-CHF-BAAKLINE', k, k * 2, 'test', v.location, 'SRID=4326;POINT(35.56355 33.67739)'
from (values (:'tv'::uuid, 1.2), (:'vp'::uuid, 0.6), (:'vf'::uuid, 5.0)) x(id, k) join public.vendors v on v.id = x.id;
select (public.customer_turn_begin('+96170000192', 'wamid.ex.1', 'text', 'Hi') #>> '{customer,id}') as cu \gset
select public.web_link_create(:'cu', 'explore', null, 'en') as url \gset
select substring(:'url' from '\?t=(.*)$') as tok \gset

set local role anon;
select public.web_explore(:'tok') as e0 \gset
reset role;
select tests.ok(:'e0'::jsonb ->> 'status' = 'no_address', 'no point yet: Explore asks for one');

insert into public.addresses (customer_id, place_id, pin, source, is_default, last_used_at) values
  (:'cu', 'LB-CHF-BAAKLINE', 'SRID=4326;POINT(35.5641 33.6771)', 'pin', true, now());
set local role anon;
select public.web_explore(:'tok') as e \gset
select public.web_explore(:'tok', null, 'pizza') as ecat \gset
select public.web_explore(:'tok', 'marg') as eq \gset
select public.web_explore(:'tok', '%') as epct \gset
select public.web_explore('AAAAAAAAAAAAAAAAAAAAAAAA') ->> 'status' as bad \gset
reset role;
select tests.ok(:'e'::jsonb ->> 'status' = 'ok' and :'e'::jsonb #>> '{place,name_en}' = 'Baakline', 'Explore for the customer''s place');
select tests.ok((select array_agg(x ->> 'slug' order by o) from jsonb_array_elements(:'e'::jsonb -> 'shops') with ordinality t(x, o))
  = array['ex-pizza-near', 'alo-test-grill'], 'the shops that deliver here, nearest first; a shop beyond its radius is left out');
select tests.ok((select (x ->> 'fee_usd')::numeric > 0 and (x ->> 'eta_min')::int >= 1 and (x ->> 'eta_max')::int > (x ->> 'eta_min')::int
                 from jsonb_array_elements(:'e'::jsonb -> 'shops') x where x ->> 'slug' = 'ex-pizza-near'),
  'each card has its delivery fee and an ETA range');
select tests.ok(exists (select 1 from jsonb_array_elements(:'e'::jsonb -> 'categories') c where c ->> 'key' = 'pizza' and (c ->> 'shops')::int = 1),
  'the categories with shops delivering here, with how many');
select tests.ok((:'e'::jsonb #>> '{popular,by_sales}')::boolean = false
  and :'e'::jsonb #>> '{popular,items,0,id}' = :'marg', 'no sales yet: a nearby shop''s photo dish, never called popular');
select tests.ok(jsonb_array_length(:'e'::jsonb -> 'new') >= 1, 'new shops');
select tests.ok(:'e'::jsonb ? 'unclaimed' and :'e'::jsonb ->> 'next_offset' is null, 'the last page carries Not on Alo King yet');
select tests.ok(jsonb_array_length(:'ecat'::jsonb -> 'shops') = 1 and :'ecat'::jsonb #>> '{shops,0,slug}' = 'ex-pizza-near'
  and not (:'ecat'::jsonb ? 'categories'), 'a category filters the shops');
select tests.ok(jsonb_array_length(:'eq'::jsonb -> 'shops') = 1 and :'eq'::jsonb #>> '{shops,0,slug}' = 'ex-pizza-near',
  'search finds a shop by a dish on its menu');
select tests.ok(jsonb_array_length(:'epct'::jsonb -> 'shops') = 0, 'a % is a character, not a pattern');
select tests.ok(:'bad' = 'expired', 'an unknown token');
select tests.ok(not (:'e'::jsonb::text ~ '\+96170000192'), 'the phone is never on the page');

-- A page holds explore_page_size shops and says where the next starts.
insert into public.app_config (key, value, effective_from, note) values ('explore_page_size', '1', now(), 'test');
set local role anon;
select public.web_explore(:'tok') as p1 \gset
select public.web_explore(:'tok', null, null, 1) as p2 \gset
reset role;
select tests.ok(jsonb_array_length(:'p1'::jsonb -> 'shops') = 1 and (:'p1'::jsonb ->> 'next_offset')::int = 1
  and not (:'p1'::jsonb ? 'unclaimed'), 'a first page with more to come');
select tests.ok(:'p2'::jsonb #>> '{shops,0,slug}' = 'alo-test-grill' and :'p2'::jsonb ->> 'next_offset' is null
  and not (:'p2'::jsonb ? 'categories'), 'the next page, the last one');

-- Real sales make "Popular near you" (pretend orders never count).
select tests.ok(app_private.explore_popular(:'cu', 'LB-CHF-BAAKLINE') ->> 'by_sales' = 'false', 'still no real sales');

rollback;
