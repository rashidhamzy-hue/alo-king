-- Session W (DECISIONS §39.11): the "Where we deliver" map's data. site_delivery_map counts, per place that is on, the
-- orderable shops and the "Not on Alo King yet" shops based there; site_village_unclaimed lists the latter for one village.
-- Public fields only, anonymous callers only through the invoker wrappers; nothing for a place that is off. Same vendors as
-- 99_unclaimed_listings.sql.
begin;

insert into public.places (id, name_ar, name_en, name_fr, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-UNCTOWN', 'قرية', 'Unctown', 'Unctown', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.60 33.70)', 'test'),
  ('LB-CHF-UNCNEAR', null, 'Uncnear', null, 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.65 33.72)', 'test'),
  ('LB-CHF-UNCFAR', null, 'Uncfar', null, 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.95 33.95)', 'test'),
  ('LB-CHF-UNCOFF', null, 'Uncoff', null, 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.601 33.701)', 'test');
select public.place_set_service_status('LB-CHF-UNCTOWN', 'on', 'test');
select public.place_set_service_status('LB-CHF-UNCNEAR', 'on', 'test');
select public.place_set_service_status('LB-CHF-UNCFAR', 'on', 'test');
-- Merchants are placed in Unctown only (§38.1, §39.2); Uncfar is a place merchants are not in. No site_url yet (#74).
insert into public.app_config (key, value, effective_from, note) values
  ('pilot_merchant_place_ids', '["LB-CHF-UNCTOWN"]', now(), 'test');

-- C (fixture): unclaimed seed, landline. D: unclaimed seed with a Lebanese mobile and a seed draft menu with prices.
-- G: a claim in progress (pending). K: frozen (contested claim). E: unclaimed but not seed. F: seed in a place that is
-- not a merchant village. H: seed but hidden. S: a claimed SEED vendor with a public page. X: claimed seed, hidden.
-- A (fixture): claimed and public, not seed. B (fixture): claimed, no public page.
update public.vendors set town_id = 'LB-CHF-UNCTOWN', cuisine_tags = '{lebanese}', name_ar = 'المقهى سي'
where id = '20000000-0000-0000-0000-00000000000c';
update public.vendor_private set import_labels = '{"hours_seed": "Monday: 8 AM to 8 PM | Sunday: Closed"}'
where vendor_id = '20000000-0000-0000-0000-00000000000c';
insert into public.vendors (id, slug, name_en, business_type, claim_status, source, place_id, location, town_id, cuisine_tags, listing_status, public_page) values
  ('20000000-0000-0000-0000-0000000000d1', 'vendor-d', 'Mamlaka Shawarma', 'restaurant', 'unclaimed', 'seed_shouf_2026_10', 'gpD', 'SRID=4326;POINT(35.61 33.71)', 'LB-CHF-UNCTOWN', '{lebanese,grills_mashawi}', 'active', false),
  ('20000000-0000-0000-0000-0000000000d2', 'vendor-g', 'Vendor G', 'cafe', 'pending', 'seed_shouf_2026_10', 'gpG', 'SRID=4326;POINT(35.62 33.71)', 'LB-CHF-UNCTOWN', '{}', 'active', false),
  ('20000000-0000-0000-0000-0000000000d6', 'vendor-k', 'Vendor K', 'cafe', 'frozen', 'seed_shouf_2026_10', 'gpK', 'SRID=4326;POINT(35.63 33.71)', 'LB-CHF-UNCTOWN', '{}', 'active', false),
  ('20000000-0000-0000-0000-0000000000d3', 'vendor-e', 'Vendor E', 'cafe', 'unclaimed', 'merchant', 'gpE', 'SRID=4326;POINT(35.60 33.70)', 'LB-CHF-UNCTOWN', '{lebanese}', 'active', false),
  ('20000000-0000-0000-0000-0000000000d4', 'vendor-f', 'Vendor F', 'cafe', 'unclaimed', 'seed_shouf_2026_10', 'gpF', 'SRID=4326;POINT(35.95 33.95)', 'LB-CHF-UNCFAR', '{lebanese}', 'active', false),
  ('20000000-0000-0000-0000-0000000000d5', 'vendor-h', 'Vendor H', 'cafe', 'unclaimed', 'seed_shouf_2026_10', 'gpH', 'SRID=4326;POINT(35.60 33.70)', 'LB-CHF-UNCTOWN', '{lebanese}', 'hidden', false),
  ('20000000-0000-0000-0000-0000000000d7', 'vendor-s', 'Mamlaka Sweets', 'sweets_pastry', 'claimed', 'seed_shouf_2026_10', 'gpS', 'SRID=4326;POINT(35.60 33.70)', 'LB-CHF-UNCTOWN', '{lebanese}', 'active', true),
  ('20000000-0000-0000-0000-0000000000d8', 'vendor-x', 'Vendor X', 'cafe', 'claimed', 'seed_shouf_2026_10', 'gpX', 'SRID=4326;POINT(35.60 33.70)', 'LB-CHF-UNCTOWN', '{lebanese}', 'hidden', true);
insert into public.vendor_private (vendor_id, phone_seed, phone_seed_mobile, address_seed) values
  ('20000000-0000-0000-0000-0000000000d1', '+96171123456', true, 'Seed address D'),
  ('20000000-0000-0000-0000-0000000000d2', '+96176999888', true, 'Seed address G'),
  ('20000000-0000-0000-0000-0000000000d7', '+96171555666', true, 'Seed address S');
insert into public.menu_drafts (vendor_id, source, status, sections, warnings) values
  ('20000000-0000-0000-0000-0000000000d1', 'seed', 'draft',
   '[{"name_en": "Sandwiches", "approved": false, "items": [
      {"name_en": "Chicken Shawarma", "description": "Garlic and pickles", "price": 4.75, "currency": "USD"},
      {"name_en": "Kafta", "price": 650000, "currency": "LBP", "options": [{"name": "Size", "choices": [{"name": "Large", "price": 1.25}]}]}]},
     {"name_en": "Empty", "items": []}]', '[]');

-- Vendor A (fixture) is claimed, public and orderable: one orderable shop in Unctown.
update public.vendors set town_id = 'LB-CHF-UNCTOWN', orderable = true where id = '20000000-0000-0000-0000-00000000000a';

set local role anon;
select public.site_delivery_map() as m \gset
select tests.ok((select (p ->> 'shops')::int = 1 and (p ->> 'unclaimed')::int = 4
  from jsonb_array_elements(:'m'::jsonb -> 'places') p where p ->> 'slug' = 'chf-unctown'),
  'Unctown: 1 orderable shop and 4 not on Alo King yet (claims in progress included; not E, H, S, X)');
select tests.ok((select (p ->> 'shops')::int = 0 and (p ->> 'unclaimed')::int = 0
  from jsonb_array_elements(:'m'::jsonb -> 'places') p where p ->> 'slug' = 'chf-uncfar'),
  'Uncfar is on with no shops (F is outside the merchant villages)');
select tests.ok(not exists (select 1 from jsonb_array_elements(:'m'::jsonb -> 'places') p where p ->> 'slug' = 'chf-uncoff'),
  'a place that is off is not on the map data');
select tests.ok((:'m'::jsonb ->> 'unclaimed_total')::int = 4, 'the total of shops not on Alo King yet in places that are on');
select tests.ok(:'m'::text not like '%+961%' and :'m'::text not like '%vendor-%', 'counts only: no names, slugs or numbers of shops');

select public.site_village_unclaimed('chf-unctown') as v \gset
select tests.ok((:'v'::jsonb ->> 'total')::int = 4
  and array(select x ->> 'slug' from jsonb_array_elements(:'v'::jsonb -> 'vendors') x) = array['vendor-d', 'vendor-c', 'vendor-g', 'vendor-k'],
  'the village panel lists its 4 shops not on Alo King yet, by name');
select tests.ok(:'v'::text not like '%+961%' and :'v'::text not like '%Seed address%' and :'v'::text not like '%4.75%'
  and :'v'::text not like '%"price"%' and :'v'::text not like '%vendor-s%',
  'no phone, address or price, and never a claimed shop');
select tests.ok(public.site_village_unclaimed('chf-uncnear') ->> 'total' = '0',
  'a neighbouring village lists only the shops based there (none)');
select tests.ok(public.site_village_unclaimed('chf-uncoff') is null and public.site_village_unclaimed('x; drop') is null
  and public.site_village_unclaimed(null) is null, 'a place that is off or a malformed slug gives nothing');
reset role;
select tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('site_delivery_map', 'site_village_unclaimed') and p.prosecdef),
  'the public wrappers run as the caller');

rollback;
