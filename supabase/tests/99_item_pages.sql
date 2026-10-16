-- Session 5f (DECISIONS §39.15.7, spec §2 item 2, §3.4 #24): the item page, the credits page and a demo shop's page,
-- for anonymous visitors; only what the page shows, allergens only when declared. Which shops' items have a page is one
-- rule (app_private.item_page_visible), and the catalogue's link follows it.
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
insert into public.app_config (key, value, effective_from, note)
values ('public_site_url', '"https://aloking.test"', now() - interval '1 minute', 'test');

-- A claimed, active shop that takes orders has item pages without a page of its own (the catalogue links every item it
-- lists, §39.15.7): its photos are credited, and the shop is named but not linked (has_page false).
update public.vendors set public_page = false where id = :'tv';
set local role anon;
select public.site_item(:'falafel') as d0 \gset
select public.site_credits() as cr0 \gset
reset role;
select tests.ok(:'d0'::jsonb -> 'item' ->> 'name_en' = 'Falafel Sandwich' and not (:'d0'::jsonb -> 'vendor' ->> 'has_page')::boolean
  and not (:'d0'::jsonb -> 'vendor' ->> 'public_page')::boolean,
  'an orderable shop without its own page: its items have pages, and the shop has no page to link (has_page false)');
select tests.ok(exists (select 1 from jsonb_array_elements(:'cr0'::jsonb -> 'photos') x
  where x ->> 'item_id' = :'falafel' and x ->> 'license' = 'CC BY 2.0' and not (x ->> 'has_page')::boolean),
  'its photos are credited on /credits, the shop named without a link');
select (select x from jsonb_array_elements(public.catalog_desired(:'tv')) x where x ->> 'retailer_id' = :'falafel') as cd \gset
select tests.ok(:'cd'::jsonb ->> 'link' = 'https://aloking.test/en/i/' || :'falafel',
  'the catalogue links the item to its page, which answers');

-- Demo mode on (another shop is the demo shop): real customers are not shown test shops (§39.12), so the test grill gets
-- no item page and no credits, and its catalogue product has no link (the credit stays in the description).
insert into public.app_config (key, value, effective_from, note)
values ('demo_shops', '[{"id": "00000000-0000-0000-0000-0000000000de"}]', now() - interval '2 minutes', 'test');
set local role anon;
select tests.ok(public.site_item(:'falafel') is null
  and not exists (select 1 from jsonb_array_elements(public.site_credits() -> 'photos') x where x ->> 'vendor_slug' = :'tslug'),
  'a test shop while demo mode is on: no item page and no credits');
reset role;
select (select x from jsonb_array_elements(public.catalog_desired(:'tv')) x where x ->> 'retailer_id' = :'falafel') as cn \gset
select tests.ok(:'cn'::jsonb ->> 'link' is null and :'cn'::jsonb ->> 'photo_credit' = 'insatiablemunch via Openverse · CC BY 2.0',
  'catalog_desired gives no link for a shop whose items have no page, and hands the CC BY credit over for the description');

-- From here the grill is an ordinary shop (not a test shop).
update public.vendors set is_test = false where id = :'tv';

-- A shop with a public page: its item's page, as an anonymous visitor reads it.
update public.vendors set public_page = true where id = :'tv';
set local role anon;
select public.site_item(:'falafel') as d \gset
reset role;
select tests.ok(:'d'::jsonb -> 'item' ->> 'name_en' = 'Falafel Sandwich' and :'d'::jsonb -> 'item' ->> 'name_ar' is not null,
  'the item page has the item''s names');
select tests.ok(:'d'::jsonb -> 'vendor' ->> 'slug' = :'tslug' and :'d'::jsonb -> 'vendor' ->> 'place_en' = 'Baakline'
  and not (:'d'::jsonb -> 'vendor' ->> 'demo')::boolean and (:'d'::jsonb -> 'vendor' ->> 'has_page')::boolean,
  'it names the shop and its village, and the shop has its page to link (has_page)');
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

-- The village is linked only when its page answers (a place we deliver to; the fixture switched Baakline on).
select tests.ok(public.site_item(:'falafel') -> 'vendor' ->> 'place_slug' = 'chf-baakline', 'a live village is linked');
reset role;
update public.places set service_status = 'off' where id = 'LB-CHF-BAAKLINE';
set local role anon;
select tests.ok(public.site_item(:'falafel') -> 'vendor' -> 'place_slug' = 'null'::jsonb,
  'a village that is not live has no link (its page would not answer)');
reset role;
update public.places set service_status = 'on' where id = 'LB-CHF-BAAKLINE';
set local role anon;

-- Credits: every photo that is not the shop's own, with its author and license.
select public.site_credits() as cr \gset
reset role;
select tests.ok((select bool_or(x ->> 'item_id' = :'falafel' and x ->> 'license' = 'CC BY 2.0' and x ->> 'vendor_slug' = :'tslug'
  and (x ->> 'has_page')::boolean) from jsonb_array_elements(:'cr'::jsonb -> 'photos') x),
  'the credits page lists the illustrative photo, its shop linked');
select tests.ok(not (select bool_or(x ->> 'item_id' = :'other') from jsonb_array_elements(:'cr'::jsonb -> 'photos') x),
  'the shop''s own photos are not listed');
select tests.ok((:'cr'::jsonb ->> 'page_size')::int = 100 and (:'cr'::jsonb ->> 'total')::int >= 1, 'credits come 100 a page');

-- "Goes well with" counts orders, not lines: one delivered order holding the falafel on two lines and the other item
-- once is one order, not two (§29.3: at least two delivered orders together). Fixture written past the status trigger.
set local session_replication_role = replica;
insert into public.orders (id, code, idempotency_key, customer_id, vendor_id, status, fulfilment, payment_method,
  menu_version, usd_lbp_rate, food_subtotal_usd, total_usd, order_fee_usd, placed_at) values
  ('5f400000-0000-0000-0000-000000000001', 'GWPAA2', 'tests:item-pages:gw1', '10000000-0000-0000-0000-000000000001',
   :'tv', 'delivered', 'pickup', 'cod', 1, 89500, 9, 9, 1, now()),
  ('5f400000-0000-0000-0000-000000000002', 'GWPAA3', 'tests:item-pages:gw2', '10000000-0000-0000-0000-000000000002',
   :'tv', 'delivered', 'pickup', 'cod', 1, 89500, 6, 6, 1, now());
insert into public.order_items (order_id, item_id, name_en, quantity, pricing_unit, unit_price_usd, line_total_usd) values
  ('5f400000-0000-0000-0000-000000000001', :'falafel', 'Falafel Sandwich', 1, 'each', 3, 3),
  ('5f400000-0000-0000-0000-000000000001', :'falafel', 'Falafel Sandwich', 1, 'each', 3, 3),
  ('5f400000-0000-0000-0000-000000000001', :'other', 'Other', 1, 'each', 3, 3);
set local session_replication_role = origin;
set local role anon;
select tests.ok(public.site_item(:'falafel') -> 'goes_well' = 'null'::jsonb,
  'one order with the item on two lines is one order: no "Goes well with" yet');
reset role;
set local session_replication_role = replica;
insert into public.order_items (order_id, item_id, name_en, quantity, pricing_unit, unit_price_usd, line_total_usd) values
  ('5f400000-0000-0000-0000-000000000002', :'falafel', 'Falafel Sandwich', 1, 'each', 3, 3),
  ('5f400000-0000-0000-0000-000000000002', :'other', 'Other', 1, 'each', 3, 3);
set local session_replication_role = origin;
set local role anon;
select tests.ok(public.site_item(:'falafel') -> 'goes_well' ->> 'id' = :'other',
  'two delivered orders that bought them together: "Goes well with" names the other item');
reset role;
-- A demo order (§39.15.3) is a pretend order: it never counts on the public page.
set local session_replication_role = replica;
update public.orders set is_demo = true where id = '5f400000-0000-0000-0000-000000000002';
set local session_replication_role = origin;
set local role anon;
select tests.ok(public.site_item(:'falafel') -> 'goes_well' = 'null'::jsonb,
  'a demo order does not count: one real order is not enough for "Goes well with"');
reset role;
set local session_replication_role = replica;
update public.orders set is_demo = false where id = '5f400000-0000-0000-0000-000000000002';
set local session_replication_role = origin;

-- A removed item is never shown: no page, no credit, and the catalogue leaves it out (the sync hides it at Meta).
update public.menu_items set removed_at = now() where id = :'falafel';
set local role anon;
select tests.ok(public.site_item(:'falafel') is null
  and not exists (select 1 from jsonb_array_elements(public.site_credits() -> 'photos') x where x ->> 'item_id' = :'falafel'),
  'a removed item has no page and no credit');
reset role;
select tests.ok(not exists (select 1 from jsonb_array_elements(public.catalog_desired(:'tv')) x
  where x ->> 'retailer_id' = :'falafel'), 'and leaves the catalogue');
update public.menu_items set removed_at = null where id = :'falafel';

-- A shop that takes no orders and is not a demo shop: no item pages, no credits.
update public.vendors set orderable = false where id = :'tv';
set local role anon;
select tests.ok(public.site_item(:'falafel') is null
  and not exists (select 1 from jsonb_array_elements(public.site_credits() -> 'photos') x where x ->> 'vendor_slug' = :'tslug'),
  'a shop that takes no orders and is not a demo shop has no item pages and no credits');
reset role;

-- A demo shop (§39.12): no public page and not taking orders, yet its items and its shop page show, marked demo.
update public.vendors set public_page = false where id = :'tv';
insert into public.app_config (key, value, effective_from, note)
values ('demo_shops', jsonb_build_array(jsonb_build_object('id', :'tv')), now(), 'test');
set local role anon;
select tests.ok((public.site_item(:'falafel') -> 'vendor' ->> 'demo')::boolean
  and (public.site_item(:'falafel') -> 'vendor' ->> 'has_page')::boolean,
  'a demo shop''s item has a page, marked demo, linking the demo shop''s page');
select tests.ok(public.site_vendor(:'tslug') is null, 'site_vendor still shows no demo shop to an anonymous caller');
select public.site_vendor_demo(:'tslug') as dv \gset
select tests.ok((:'dv'::jsonb -> 'vendor' ->> 'demo')::boolean and :'dv'::jsonb -> 'vendor' ->> 'slug' = :'tslug'
  and jsonb_array_length(:'dv'::jsonb -> 'sections') > 0, 'the demo shop''s page: its menu, marked demo');
select tests.ok(public.site_vendor_demo('not-a-demo-shop') is null and public.site_vendor_demo('Bad Slug!') is null,
  'any other slug has no demo page');
select tests.ok(exists (select 1 from jsonb_array_elements(public.site_credits() -> 'photos') x where x ->> 'item_id' = :'falafel'),
  'a demo shop''s photos are credited too');
reset role;
select tests.ok((app_private.site_vendor_card(:'tv') ->> 'demo')::boolean,
  'a demo shop''s card says so, on every path that shows the card');

-- The public functions are invoker wrappers (no security-definer function in public is executable by anon).
select tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('site_item', 'site_credits', 'site_vendor_demo') and p.prosecdef),
  'site_item, site_credits and site_vendor_demo in public are security invoker');
select tests.ok(not has_function_privilege('anon', 'app_private.item_page_visible(uuid)', 'execute'),
  'the page rule itself is not callable by anonymous visitors');

-- Not a demo shop any more, and no public page: nothing.
update public.vendors set orderable = false, listing_status = 'hidden' where id = :'tv';
set local role anon;
select tests.ok(public.site_item(:'falafel') is null and public.site_vendor_demo(:'tslug') is null,
  'a shop that is not active has no item pages');
reset role;

-- The bot names the item when it asks for a required choice, however the item came (the site's code, a catalogue cart).
select tests.ok(coalesce((select bool_and(g ->> 'item_en' = i.name_en and g ->> 'item' = coalesce(i.name_ar, i.name_en))
  from public.menu_items i, jsonb_array_elements(public.menu_item_options(i.id)) g
  where i.vendor_id = :'tv' and exists (select 1 from public.menu_option_groups x where x.item_id = i.id)), false),
  'menu_item_options names the item on each choice group (Arabic first, and in English)');

-- The tracking link (§39.15.7): the page's full address in the customer's language, never a bare token.
set local session_replication_role = replica;
insert into public.orders (id, code, idempotency_key, customer_id, vendor_id, status, fulfilment, payment_method,
  menu_version, usd_lbp_rate, food_subtotal_usd, total_usd, order_fee_usd, placed_at) values
  ('5f400000-0000-0000-0000-000000000003', 'TRKAA2', 'tests:item-pages:tr1', '10000000-0000-0000-0000-000000000001',
   :'tv', 'ready', 'pickup', 'cod', 1, 89500, 9, 9, 1, now()),
  ('5f400000-0000-0000-0000-000000000004', 'TRKAA3', 'tests:item-pages:tr2', '10000000-0000-0000-0000-000000000002',
   :'tv', 'ready', 'pickup', 'cod', 1, 89500, 9, 9, 1, now());
set local session_replication_role = origin;
update public.customers set language = 'fr' where id = '10000000-0000-0000-0000-000000000001';
update public.customers set language = 'arabizi' where id = '10000000-0000-0000-0000-000000000002';
select app_private.customer_notify('5f400000-0000-0000-0000-000000000003', 'on_the_way');
select app_private.customer_notify('5f400000-0000-0000-0000-000000000004', 'on_the_way');
select tests.ok((select m.payload ->> 'track_url' ~ '^https://aloking\.test/fr/track/[A-Za-z0-9_-]{43}$' from public.outbound_messages m
  where m.dedupe_key = 'cust:5f400000-0000-0000-0000-000000000003:on_the_way'),
  'the tracking link is <site>/<lang>/track/<token>, in the customer''s language');
select tests.ok((select m.payload ->> 'track_url' ~ '^https://aloking\.test/ar/track/[A-Za-z0-9_-]{43}$' from public.outbound_messages m
  where m.dedupe_key = 'cust:5f400000-0000-0000-0000-000000000004:on_the_way'),
  'a language the site does not have (Arabizi) gets the Arabic page');
select tests.ok(public.order_track_public(
    (select substring(m.payload ->> 'track_url' from '/track/(.*)$') from public.outbound_messages m
     where m.dedupe_key = 'cust:5f400000-0000-0000-0000-000000000003:on_the_way')) ->> 'code' = 'TRKAA2',
  'the token in the link opens the order''s tracking page');

rollback;
