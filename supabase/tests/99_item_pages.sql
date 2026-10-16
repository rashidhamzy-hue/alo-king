-- Session 5f (DECISIONS §39.15.7, spec §2 item 2, §3.4 #24): the item page, the credits page and a demo shop's page,
-- for anonymous visitors; only what the page shows, allergens only when declared, no item of a shop without a page.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-IP', 'CHF', 'Item pages zone', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-IP', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test');
select set_config('app.fixture_owner_phone', '+96170000172', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv, slug as tslug from public.vendors where slug = 'alo-test-grill' \gset
update public.vendors set town_id = 'LB-CHF-BAAKLINE' where id = :'tv';
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Falafel Sandwich') as falafel \gset
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.id <> :'falafel' order by i.sort_order limit 1) as other \gset
update public.menu_items set allergens = '{sesame,gluten}', allergens_confirmed_at = null where id = :'falafel';
insert into public.menu_item_photos (item_id, vendor_id, storage_path, source, origin_hash, license, credit, source_url)
values (:'falafel', :'tv', 'illustrative/' || :'tv' || '/' || :'falafel' || '.jpg', 'illustrative', repeat('c', 64),
  'CC BY 2.0', 'insatiablemunch via Openverse', 'https://www.flickr.com/photos/insatiablemunch/1');
insert into public.menu_item_photos (item_id, vendor_id, storage_path, source, origin_hash)
values (:'other', :'tv', 'merchant/' || :'tv' || '/' || :'other' || '.jpg', 'merchant', repeat('d', 64));
insert into public.dish_library (id, name_ar, name_en, name_fr, category, unit, portion_g, recipe) values ('ip_falafel', 'سندويش فلافل',
  'Falafel sandwich', 'Sandwich falafel', 'sandwich', 'piece', '{"default": 250}', '{"chickpeas_cooked": 80}')
on conflict (id) do nothing;
insert into public.menu_item_nutrition (item_id, vendor_id, dish_id, kcal, protein_g, carbs_g, fat_g, value_sources, status,
  assumptions, may_contain)
values (:'falafel', :'tv', 'ip_falafel', 523.4, 17.26, 61.04, 22.5, '{}', 'estimated', '{}', '{}');

-- The test grill has no public page and is not a demo shop: none of its items has a page.
update public.vendors set public_page = false where id = :'tv';
set local role anon;
select tests.ok(public.site_item(:'falafel') is null, 'an item of a shop without a page has no page');
reset role;

-- A shop with a public page: its item's page, as an anonymous visitor reads it.
update public.vendors set public_page = true where id = :'tv';
set local role anon;
select public.site_item(:'falafel') as d \gset
reset role;
select tests.ok(:'d'::jsonb -> 'item' ->> 'name_en' = 'Falafel Sandwich' and :'d'::jsonb -> 'item' ->> 'name_ar' is not null,
  'the item page has the item''s names');
select tests.ok(:'d'::jsonb -> 'vendor' ->> 'slug' = :'tslug' and :'d'::jsonb -> 'vendor' ->> 'place_en' = 'Baakline'
  and not (:'d'::jsonb -> 'vendor' ->> 'demo')::boolean, 'it names the shop and its village, linked by slug');
select tests.ok(:'d'::jsonb -> 'item' -> 'credit' ->> 'credit' = 'insatiablemunch via Openverse'
  and :'d'::jsonb -> 'item' -> 'credit' ->> 'license' = 'CC BY 2.0' and :'d'::jsonb -> 'item' ->> 'photo_source' = 'illustrative',
  'a photo that is not the shop''s own carries its credit and license');
select tests.ok((:'d'::jsonb -> 'nutrition' ->> 'kcal')::numeric = 523 and :'d'::jsonb -> 'nutrition' ->> 'status' = 'estimated',
  'energy as the dish library estimated it, marked estimated');
select tests.ok(:'d'::jsonb -> 'allergens' = 'null'::jsonb, 'allergens the shop has not declared are never shown');
select tests.ok(jsonb_typeof(:'d'::jsonb -> 'options') = 'array' and (:'d'::jsonb ->> 'rate')::numeric > 0,
  'extras come as a list, with the rate for LBP');
select tests.ok(:'d'::jsonb -> 'goes_well' = 'null'::jsonb,
  'no "Goes well with" without two delivered orders that bought them together (§29.3)');
select tests.ok(not (:'d'::jsonb::text ~ '(storage_path|origin_hash|owner|phone|cost)'),
  'nothing private: no storage path, hash, owner or phone');
update public.menu_items set allergens_confirmed_at = now() where id = :'falafel';
set local role anon;
select tests.ok(public.site_item(:'falafel') -> 'allergens' ?& array['sesame', 'gluten'], 'declared allergens are shown');
select tests.ok(public.site_item(:'other') -> 'item' -> 'credit' = 'null'::jsonb
  and (public.site_item(:'other') -> 'item' ->> 'photo')::boolean, 'the shop''s own photo needs no credit');
select tests.ok(public.site_item('00000000-0000-0000-0000-000000000000') is null, 'an unknown id has no page');

-- Credits: every photo that is not the shop's own, with its author and license.
select public.site_credits() as cr \gset
reset role;
select tests.ok((select bool_or(x ->> 'item_id' = :'falafel' and x ->> 'license' = 'CC BY 2.0' and x ->> 'vendor_slug' = :'tslug')
  from jsonb_array_elements(:'cr'::jsonb -> 'photos') x), 'the credits page lists the illustrative photo');
select tests.ok(not (select bool_or(x ->> 'item_id' = :'other') from jsonb_array_elements(:'cr'::jsonb -> 'photos') x),
  'the shop''s own photos are not listed');
select tests.ok((:'cr'::jsonb ->> 'page_size')::int = 100 and (:'cr'::jsonb ->> 'total')::int >= 1, 'credits come 100 a page');

-- A demo shop (§39.12): no public page, yet its items and its shop page show, marked demo.
update public.vendors set public_page = false where id = :'tv';
insert into public.app_config (key, value, effective_from, note)
values ('demo_shops', jsonb_build_array(jsonb_build_object('id', :'tv')), now(), 'test');
set local role anon;
select tests.ok((public.site_item(:'falafel') -> 'vendor' ->> 'demo')::boolean, 'a demo shop''s item has a page, marked demo');
select tests.ok(public.site_vendor(:'tslug') is null, 'site_vendor still shows no demo shop to an anonymous caller');
select public.site_vendor_demo(:'tslug') as dv \gset
select tests.ok((:'dv'::jsonb -> 'vendor' ->> 'demo')::boolean and :'dv'::jsonb -> 'vendor' ->> 'slug' = :'tslug'
  and jsonb_array_length(:'dv'::jsonb -> 'sections') > 0, 'the demo shop''s page: its menu, marked demo');
select tests.ok(public.site_vendor_demo('not-a-demo-shop') is null and public.site_vendor_demo('Bad Slug!') is null,
  'any other slug has no demo page');
select tests.ok(exists (select 1 from jsonb_array_elements(public.site_credits() -> 'photos') x where x ->> 'item_id' = :'falafel'),
  'a demo shop''s photos are credited too');
reset role;

-- The public functions are invoker wrappers (no security-definer function in public is executable by anon).
select tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('site_item', 'site_credits', 'site_vendor_demo') and p.prosecdef),
  'site_item, site_credits and site_vendor_demo in public are security invoker');

-- Not a demo shop any more, and no public page: nothing.
update public.vendors set orderable = false, listing_status = 'hidden' where id = :'tv';
set local role anon;
select tests.ok(public.site_item(:'falafel') is null and public.site_vendor_demo(:'tslug') is null,
  'a shop that is not active has no item pages');
reset role;

rollback;
