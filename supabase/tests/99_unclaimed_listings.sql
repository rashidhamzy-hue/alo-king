-- Session E PR 3 (DECISIONS §39.3): "Not on Alo King yet" listings and "Ask them to join".
-- Listings: seed merchants that are not claimed, in the pilot merchant villages, within max_delivery_km() of a place
-- (place pages) or with the cuisine tag (cuisine pages); public fields only, never a price, phone, address or coordinates.
-- Join: only the site-claim edge function (service role) records a tap and gets the wa.me target, with a visitor key it
-- derived itself; anon and signed-in users cannot call it. Claimed public vendors and non-seed vendors are refused; rate
-- limited; the count shows on the claim lookup. The bot's search is service-role only.
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
  ('pilot_merchant_place_ids', '["LB-CHF-UNCTOWN"]', now() - interval '1 second', 'test');

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

set local role anon;

-- Place page ---------------------------------------------------------------------------------------------------------
select public.site_place_unclaimed('chf-unctown') as pl \gset
select tests.ok((:'pl'::jsonb ->> 'total')::int = 4 and (:'pl'::jsonb ->> 'page')::int = 1 and (:'pl'::jsonb ->> 'page_size')::int = 24,
  'the place page lists the 4 seed merchants that are not claimed, claims in progress (pending, frozen) included');
select tests.ok(array(select v ->> 'slug' from jsonb_array_elements(:'pl'::jsonb -> 'vendors') v) = array['vendor-c', 'vendor-d', 'vendor-g', 'vendor-k'],
  'nearest first; a frozen claim is still "not on Alo King yet"; not the non-seed (E), hidden (H), out-of-village (F) or claimed (A, S, X) vendors');
select tests.ok((:'pl'::jsonb #>> '{vendors,0,hours_seed}') = 'Monday: 8 AM to 8 PM | Sunday: Closed'
  and (:'pl'::jsonb #>> '{vendors,0,place_en}') = 'Unctown' and (:'pl'::jsonb #>> '{vendors,0,business_type_en}') is not null
  and (:'pl'::jsonb #> '{vendors,0,cuisines}') @> '[{"tag": "lebanese"}]',
  'a card has the seed hours, the village, the category and the cuisine labels');
select tests.ok((:'pl'::jsonb #>> '{vendors,1,menu_items}')::int = 2
  and (:'pl'::jsonb #> '{vendors,1,menu_preview}') = '[{"name_ar": null, "name_en": "Chicken Shawarma", "name_fr": null}, {"name_ar": null, "name_en": "Kafta", "name_fr": null}]'::jsonb,
  'a card previews the draft menu by item name');
select tests.ok(not exists (
  select 1 from jsonb_array_elements(:'pl'::jsonb -> 'vendors') v, jsonb_object_keys(v) k
  where k in ('id', 'vendor_id', 'lat', 'lon', 'location', 'address', 'address_seed', 'phone', 'phone_seed', 'price', 'rating', 'photo'))
  and :'pl'::text not like '%+961%' and :'pl'::text not like '%Seed address%' and :'pl'::text not like '%4.75%'
  and :'pl'::text not like '%650000%' and :'pl'::text not like '%price%',
  'no phone, address, coordinates, id or price in the place list');
select tests.ok(:'pl'::text not like '%vendor-s%' and :'pl'::text not like '%Mamlaka Sweets%',
  'a claimed seed vendor never appears as not on Alo King');
select tests.ok(public.site_place_unclaimed('chf-uncnear') ->> 'total' = '4',
  'a neighbouring place within max_delivery_km() of the merchants lists them too');
select tests.ok(public.site_place_unclaimed('chf-uncfar') ->> 'total' = '0',
  'a place farther than max_delivery_km() lists none (F is not in a merchant village)');
select tests.ok(public.site_place_unclaimed('chf-uncoff') is null and public.site_place_unclaimed('x; drop') is null
  and public.site_place_unclaimed('chf-unctown', 0) is null and public.site_place_unclaimed('chf-unctown', 101) is null
  and public.site_place_unclaimed(null) is null,
  'a place that is off, a malformed slug or a page out of range gives nothing');
select tests.ok(public.site_place_unclaimed('chf-unctown', 2) = '{"total": 4, "page": 2, "page_size": 24, "vendors": []}'::jsonb,
  'page 2 of a short list is empty, with the total');
select tests.ok(jsonb_array_length(public.site_place('chf-unctown') -> 'vendors') = 0,
  'the orderable list of the place page is unchanged: no unclaimed vendor in site_place');

-- Cuisine page ---------------------------------------------------------------------------------------------------------
select public.site_cuisine_unclaimed('lebanese') as cu \gset
select tests.ok(array(select v ->> 'slug' from jsonb_array_elements(:'cu'::jsonb -> 'vendors') v) = array['vendor-d', 'vendor-c']
  and (:'cu'::jsonb ->> 'total')::int = 2,
  'the cuisine page lists the seed merchants with the tag in the merchant villages (not E, F, H, or the claimed S and X), by village and name');
select tests.ok(public.site_cuisine_unclaimed('no_such_tag') is null and public.site_cuisine_unclaimed('Bad Tag') is null,
  'an unknown or malformed cuisine gives nothing');

-- Vendor page ----------------------------------------------------------------------------------------------------------
select public.site_vendor_unclaimed('vendor-d') as vd \gset
select tests.ok(:'vd'::jsonb #>> '{vendor,name_en}' = 'Mamlaka Shawarma'
  and :'vd'::jsonb #>> '{vendor,vendor_id}' = '20000000-0000-0000-0000-0000000000d1',
  'the page of a shop not on Alo King yet has its card and its id for the claim link');
select tests.ok((:'vd'::jsonb -> 'sections') = '[{"name_ar": null, "name_en": "Sandwiches", "name_fr": null, "items": [
    {"name_ar": null, "name_en": "Chicken Shawarma", "name_fr": null, "description": "Garlic and pickles"},
    {"name_ar": null, "name_en": "Kafta", "name_fr": null, "description": null}]}]'::jsonb,
  'the draft menu shows item names and descriptions only: no price, no currency, no option price, no empty section');
select tests.ok(:'vd'::text not like '%+961%' and :'vd'::text not like '%Seed address%' and :'vd'::text not like '%price%'
  and :'vd'::text not like '%33.71%', 'no phone, address, price or coordinates on the vendor page');
select tests.ok(public.site_vendor_unclaimed('vendor-a') is null and public.site_vendor_unclaimed('vendor-e') is null
  and public.site_vendor_unclaimed('vendor-f') is null and public.site_vendor_unclaimed('vendor-h') is null
  and public.site_vendor_unclaimed('vendor-s') is null and public.site_vendor_unclaimed('Vendor D') is null,
  'claimed (also a claimed seed vendor), non-seed, out-of-village, hidden and malformed slugs have no unclaimed page');
select tests.ok(public.site_vendor_unclaimed('vendor-k') ->> 'vendor' is not null, 'a frozen claim still has its page');
select tests.ok(public.site_vendor('vendor-d') is null, 'the claimed-vendor page function still refuses an unclaimed vendor');

-- Ask them to join: never from anon or a signed-in user ---------------------------------------------------------------
select tests.throws($$select public.vendor_join_request('vendor-d', 'web', repeat('a', 64))$$, 'permission denied',
  'anon cannot record a tap (a caller choosing its own visitor key could inflate the count)');
select tests.throws('select count(*) from public.vendor_join_requests', 'permission denied',
  'anonymous visitors cannot read the taps');
reset role;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
set local role authenticated;
select tests.throws($$select public.vendor_join_request('vendor-d', 'web', repeat('a', 64))$$, 'permission denied',
  'a signed-in user cannot record a tap either');
reset role;
select tests.act_as(null);

-- The site-claim edge function (service role) -------------------------------------------------------------------------
set local role service_role;
select tests.ok(public.vendor_join_request('vendor-d', 'web', 'nothex') ->> 'status' = 'invalid'
  and public.vendor_join_request('vendor-d', 'email', repeat('a', 64)) ->> 'status' = 'invalid'
  and public.vendor_join_request('Vendor D', 'web', repeat('a', 64)) ->> 'status' = 'invalid'
  and public.vendor_join_request('vendor-d', 'web', repeat('a', 24)) ->> 'status' = 'invalid',
  'malformed visitor key, channel or slug is refused');
select tests.ok(public.vendor_join_request('vendor-a', 'web', repeat('a', 64)) = '{"status": "claimed", "site_url": null}'::jsonb
  and public.vendor_join_request('vendor-s', 'web', repeat('a', 64)) = '{"status": "claimed", "site_url": null}'::jsonb,
  'a claimed vendor with a public page is refused (the function sends the customer to its page), with no number');
select tests.ok(public.vendor_join_request('vendor-b', 'web', repeat('a', 64)) = '{"status": "not_found"}'::jsonb
  and public.vendor_join_request('vendor-x', 'web', repeat('a', 64)) = '{"status": "not_found"}'::jsonb,
  'a claimed vendor without a public page, or hidden, is not found');
select tests.ok(public.vendor_join_request('vendor-e', 'web', repeat('a', 64)) = '{"status": "not_found"}'::jsonb
  and public.vendor_join_request('vendor-f', 'web', repeat('a', 64)) = '{"status": "not_found"}'::jsonb
  and public.vendor_join_request('vendor-h', 'web', repeat('a', 64)) = '{"status": "not_found"}'::jsonb,
  'non-seed, out-of-village and hidden seed vendors are refused');
select public.vendor_join_request('vendor-d', 'web', repeat('a', 64)) as j1 \gset
select tests.ok(:'j1'::jsonb ->> 'status' = 'ok' and :'j1'::jsonb ->> 'wa_url' = 'https://wa.me/96171123456'
  and (:'j1'::jsonb ->> 'counted')::boolean and :'j1'::jsonb ->> 'vendor_id' = '20000000-0000-0000-0000-0000000000d1'
  and :'j1'::jsonb -> 'site_url' = 'null'::jsonb,
  'a seed merchant with a Lebanese mobile: the tap is counted and the target opens WhatsApp on that number; no site_url yet');
select tests.ok((select count(*) from jsonb_object_keys(:'j1'::jsonb) k where k ~ 'phone|address|location') = 0
  and position('96171123456' in replace(:'j1'::text, '"https://wa.me/96171123456"', '')) = 0,
  'the number appears only inside the wa.me target');
select tests.ok(public.vendor_join_request('vendor-c', 'bot', repeat('b', 64)) ->> 'wa_url' = 'https://wa.me/'
  and public.vendor_join_request('vendor-k', 'web', repeat('b', 64)) ->> 'status' = 'ok',
  'a landline: wa.me with no number, the customer picks the contact; a frozen claim can still be asked');

-- Rate limit: 30 taps an hour per visitor key (the visitor's earlier taps count).
select count(*) filter (where public.vendor_join_request('vendor-d', 'web', repeat('c', 64)) ->> 'status' = 'ok') as ok30
from generate_series(1, 30) \gset
select tests.ok(:ok30 = 30, 'thirty taps in an hour pass');
select tests.ok(public.vendor_join_request('vendor-d', 'web', repeat('c', 64)) = '{"status": "rate_limited"}'::jsonb,
  'the thirty-first is refused, with no number');
select tests.ok(public.vendor_join_request('vendor-d', 'web', repeat('d', 64)) ->> 'status' = 'ok',
  'another visitor is not affected');
reset role;

select tests.ok((select count(*) from public.vendor_join_requests where vendor_id = '20000000-0000-0000-0000-0000000000d1') = 32
  and (select count(*) from public.vendor_join_requests where vendor_id = '20000000-0000-0000-0000-00000000000c' and channel = 'bot') = 1,
  'every accepted tap is a row, with its channel');
select tests.ok((select count(distinct visitor_hash) from public.vendor_join_requests where vendor_id = '20000000-0000-0000-0000-0000000000d1') = 3
  and exists (select 1 from app_private.web_rate where key = 'join:' || repeat('c', 64)),
  'the function''s keyed hash is both the stored visitor hash and the rate key');
select tests.ok(not exists (select 1 from public.vendor_join_requests where vendor_id in (
  '20000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000d3', '20000000-0000-0000-0000-0000000000d7')),
  'refused taps record nothing');

-- At most 200 recorded taps per shop a day: the customer still gets the link, the count stops growing.
insert into public.vendor_join_requests (vendor_id, channel, visitor_hash)
select '20000000-0000-0000-0000-0000000000d2', 'web', md5(g::text) || md5(g::text) from generate_series(1, 200) g;
set local role service_role;
select tests.ok((public.vendor_join_request('vendor-g', 'web', repeat('e', 64)) ->> 'counted')::boolean is false,
  'past 200 a day the tap is not recorded, the target is still given');
reset role;
select tests.ok((select count(*) from public.vendor_join_requests where vendor_id = '20000000-0000-0000-0000-0000000000d2') = 200,
  'the 200 cap holds');

-- Once the site's address is a dated config row, the function gets it for the claim link and the shop's page.
insert into public.app_config (key, value, effective_from, note) values
  ('site_url', '"https://aloking.test/"', now() - interval '1 second', 'test');
set local role service_role;
select tests.ok(public.vendor_join_request('vendor-d', 'web', repeat('f', 64)) ->> 'site_url' = 'https://aloking.test'
  and public.vendor_join_request('vendor-a', 'web', repeat('f', 64)) ->> 'site_url' = 'https://aloking.test',
  'site_url (without a trailing slash) is returned once configured');

-- The claim page: "N customers asked for you" (distinct people).
select tests.ok((select asked from public.vendor_claim_lookup('20000000-0000-0000-0000-0000000000d1')) = 4
  and (select asked from public.vendor_claim_lookup('20000000-0000-0000-0000-00000000000a')) = 0
  and (select seed_phone_tail from public.vendor_claim_lookup('20000000-0000-0000-0000-0000000000d1')) is not null,
  'the claim lookup counts the different people who asked, and keeps its other columns');

-- The bot: by name, never for a dish or cuisine word.
select tests.ok((select slug from public.vendor_search_unclaimed('mamlaka', 1)) = 'vendor-d'
  and (select slug from public.vendor_search_unclaimed('Mamlaka Shawarma', 1)) = 'vendor-d',
  'a named unclaimed shop is found (not the claimed seed shop with a similar name)');
select tests.ok(not exists (select 1 from public.vendor_search_unclaimed('shawarma', 3))
  and not exists (select 1 from public.vendor_search_unclaimed('lebanese', 3))
  and not exists (select 1 from public.vendor_search_unclaimed('Unctown', 3)),
  'a dish, a cuisine or a place name is a request for food, not for one shop');
select tests.ok(not exists (select 1 from public.vendor_search_unclaimed('mamlaka sweets', 3) where slug in ('vendor-s', 'vendor-a'))
  and not exists (select 1 from public.vendor_search_unclaimed('vendor e', 3) where slug = 'vendor-e'),
  'claimed and non-seed vendors are never offered as not on Alo King');
reset role;

-- Grants -----------------------------------------------------------------------------------------------------------
select tests.ok(has_function_privilege('anon', 'public.site_place_unclaimed(text, integer)', 'execute')
  and has_function_privilege('anon', 'public.site_cuisine_unclaimed(text, integer)', 'execute')
  and has_function_privilege('anon', 'public.site_vendor_unclaimed(text)', 'execute'),
  'the website (anon) can call the listing functions');
select tests.ok(not has_function_privilege('anon', 'public.vendor_join_request(text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.vendor_join_request(text, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.vendor_join_request(text, text, text)', 'execute')
  and to_regprocedure('app_private.vendor_join_request(text, text, text)') is null,
  'recording a tap is service-role only (the site-claim edge function), with no other way in');
select tests.ok(not has_function_privilege('anon', 'public.vendor_search_unclaimed(text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.vendor_search_unclaimed(text, integer)', 'execute')
  and has_function_privilege('service_role', 'public.vendor_search_unclaimed(text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.vendor_claim_lookup(uuid)', 'execute'),
  'the bot search and the claim lookup are service-role only');
select tests.ok(not has_function_privilege('anon', 'app_private.site_unclaimed_card(uuid)', 'execute')
  and not has_function_privilege('anon', 'app_private.join_request_count(uuid)', 'execute')
  and not has_function_privilege('anon', 'app_private.seed_draft_sections(uuid)', 'execute')
  and not has_table_privilege('anon', 'app_private.unclaimed_listings', 'select'),
  'the helpers and the listing view are not reachable directly');
select tests.ok((select prosecdef from pg_proc where oid = 'public.site_place_unclaimed(text, integer)'::regprocedure) is false
  and (select prosecdef from pg_proc where oid = 'public.site_vendor_unclaimed(text)'::regprocedure) is false,
  'the public read functions run as the caller (the definer code lives in app_private)');

rollback;
