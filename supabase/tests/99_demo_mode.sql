-- Demo mode (DECISIONS §39.12): the staging fixture turns every seed shop with a priced menu into an orderable demo shop with their menus
-- (LBP at the dated rate), the owner as their merchant; simulated customers see them only when opted in; real customers
-- do not see the test shops while it is on; nothing goes to a shop's own number; item photos, never shop photos, are the
-- catalogue's images, and illustrative ones go when a shop is claimed.
begin;

select tests.ok(cardinality(app_private.demo_vendor_ids()) = 0 and not app_private.vendor_is_demo(gen_random_uuid()),
  'no demo shops by default (production)');

-- Three seed shops with drafts, as the Shouf load leaves them (the third has no price) ------------------------------------
insert into public.vendors (slug, place_id, name_en, business_type, claim_status, listing_status, orderable, public_page, source,
  field_sources, location, delivery_enabled, pickup_enabled)
values ('demo-test-grill-house', 'ChIJdemoTestShop00000001', 'Demo Grill House', 'restaurant', 'unclaimed', 'active', false, false,
        'seed_shouf_2026_10', '{"name_en": "seed"}', app_private.lat_lon_point(33.6775, 35.5645), true, false),
       ('demo-test-corner-shop', 'ChIJdemoTestShop00000002', 'Demo Corner Shop', 'minimarket', 'unclaimed', 'active', false, false,
        'seed_shouf_2026_10', '{"name_en": "seed"}', app_private.lat_lon_point(33.6780, 35.5650), true, false),
       ('demo-test-no-prices', 'ChIJdemoTestShop00000003', 'Demo No Prices', 'restaurant', 'unclaimed', 'active', false, false,
        'seed_shouf_2026_10', '{"name_en": "seed"}', app_private.lat_lon_point(33.6785, 35.5655), true, false);
select id as d1 from public.vendors where slug = 'demo-test-grill-house' \gset
select id as d2 from public.vendors where slug = 'demo-test-corner-shop' \gset
select id as d3 from public.vendors where slug = 'demo-test-no-prices' \gset
insert into public.vendor_private (vendor_id, phone_seed, phone_seed_mobile) values (:'d1', '+96171000001', true), (:'d2', '+96171000002', true);
insert into public.menu_drafts (vendor_id, source, status, sections, source_url) values
  (:'d1', 'seed', 'draft', '[{"name_en": "Grills", "name_ar": null, "name_fr": null, "items": [
     {"name_en": "Kafta Plate", "price": 895000, "currency": "LBP", "confidence": 0.5,
      "image_url": "https://example.test/kafta.jpg",
      "options": [{"name": "Choice", "min": 1, "max": 1, "choices": [{"name": "Kafta 1 kg"}, {"name": "Kabab 1 kg"}]}]},
     {"name_en": "Misread", "price": 100, "currency": "LBP", "confidence": 0.5},
     {"name_en": "No price", "price": null, "currency": "USD", "confidence": 0.5}]}]', 'supabase/seed/shouf/source/03_shouf_digital_menus.json'),
  (:'d2', 'seed', 'draft', '[{"name_en": "Drinks", "name_ar": null, "name_fr": null, "items": [
     {"name_en": "Water", "price": 0.5, "currency": "USD", "confidence": 0.5}]}]', 'supabase/seed/shouf/source/03_shouf_digital_menus.json'),
  (:'d3', 'seed', 'draft', '[{"name_en": "Menu", "name_ar": null, "name_fr": null, "items": [
     {"name_en": "Ask for the price", "price": null, "currency": null, "confidence": 0.5}]}]', 'supabase/seed/shouf/source/03_shouf_digital_menus.json');

-- The staging fixtures ---------------------------------------------------------------------------------------------------------
select set_config('app.fixture_owner_phone', '+96170000096', false);
\i supabase/test-fixtures/alo-test-grill.sql
-- The override list: the corner shop's full harvested menu (two drinks) instead of its one-item draft.
\copy (select * from (values ('ChIJdemoTestShop00000002', 'Demo Corner Shop', 'harvest', '[{"name_en": "Drinks", "items": [{"name_en": "Water", "price": 0.5, "currency": "USD"}, {"name_en": "Juice", "price": 2, "currency": "USD"}]}]', 'https://example.test/menu')) t (place_id, name, menu, sections, source_url)) to '/tmp/alo-demo-test.csv' with (format csv, header true)
\set demo_csv /tmp/alo-demo-test.csv
\i supabase/test-fixtures/demo-shops.sql

select tests.ok(app_private.demo_vendor_ids() @> array[:'d1', :'d2']::uuid[] and cardinality(app_private.demo_vendor_ids()) = 2,
  'every seed shop with a priced menu is a demo shop');
select tests.ok(not app_private.vendor_is_demo(:'d3') and (select claim_status = 'unclaimed' and not orderable from public.vendors where id = :'d3'),
  'a shop without a priced menu keeps its "Not on Alo King yet" listing');
select tests.ok((select count(*) from public.menu_items where vendor_id = :'d2') = 2, 'a listed shop gets its full harvested menu');
select tests.ok((select bool_and(claim_status = 'claimed' and orderable and field_sources ? 'demo') from public.vendors where id in (:'d1', :'d2')),
  'demo shops are claimed and orderable on staging, marked demo');
select tests.ok((select price_usd from public.menu_items where vendor_id = :'d1' and name_en = 'Kafta Plate') = round(895000 / public.usd_lbp_rate(), 2),
  'an LBP price is converted at the dated rate');
select tests.ok(not exists (select 1 from public.menu_items where vendor_id = :'d1' and name_en in ('Misread', 'No price')),
  'a price that rounds to $0 or has no price is not published');
select tests.ok((select count(*) = 2 and bool_and(o.price_delta_usd = 0) from public.menu_options o join public.menu_option_groups g on g.id = o.group_id
  join public.menu_items i on i.id = g.item_id where i.vendor_id = :'d1'), 'a choice without a price is a free choice');
select tests.ok((select d.image_url from app_private.demo_item_sources d join public.menu_items i on i.id = d.item_id where i.vendor_id = :'d1')
  = 'https://example.test/kafta.jpg', 'the shop''s own item image is kept for the photos');
select tests.ok((select status from public.menu_drafts where vendor_id = :'d1') = 'draft', 'the seed draft itself is untouched');
select tests.ok(exists (select 1 from public.vendor_members m where m.vendor_id = :'d1' and m.phone_e164 = '+96170000096' and m.status = 'active')
  and (select target from public.vendor_order_channels where vendor_id = :'d1' and role = 'primary' and enabled) = '+96170000096'
  and (select kitchen_whatsapp from public.vendor_private where vendor_id = :'d1') = '+96170000096',
  'the owner''s phone is the demo shop''s merchant and its order channel');
select tests.ok((select phone_seed from public.vendor_private where vendor_id = :'d1') = '+96171000001', 'the shop''s own number stays on record');

select count(*) as items_before from public.menu_items where vendor_id = :'d1' \gset
\i supabase/test-fixtures/demo-shops.sql
select tests.ok((select count(*) = 1 from public.app_config where key = 'demo_shops'), 'running the fixture again adds no config row');
select tests.ok((select count(*) from public.menu_items where vendor_id = :'d1') = :items_before, 'and publishes nothing twice');

-- Who sees which shop ----------------------------------------------------------------------------------------------------------
insert into public.customers (phone_e164) values ('+99996100000071'), ('+96170000071') on conflict (phone_e164) do nothing;
select id as sim from public.customers where phone_e164 = '+99996100000071' \gset
select id as real from public.customers where phone_e164 = '+96170000071' \gset
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
insert into public.customers (phone_e164) values ('+96170000096') on conflict (phone_e164) do nothing;
select id as owner from public.customers where phone_e164 = '+96170000096' \gset

select tests.ok(not exists (select 1 from public.vendor_search(null, null, null, null, null, 10, :'sim') where vendor_id in (:'d1', :'d2'))
  and exists (select 1 from public.vendor_search(null, null, null, null, null, 10, :'sim') where vendor_id = :'tv'),
  'a simulated customer sees the test shop and no demo shop (the other e2e scenarios are unchanged)');
select tests.ok(public.sim_demo('+99996100000071', '+99996100000072', true) ->> 'status' = 'ok', 'a scenario opts its customer in');
select tests.ok((select count(*) from public.vendor_search(null, null, null, null, null, 10, :'sim') where vendor_id in (:'d1', :'d2')) = 2,
  'then it sees the demo shops');
select tests.ok((select count(*) from public.vendor_members where phone_e164 = '+99996100000072' and status = 'active' and vendor_id in (:'d1', :'d2')) = 2,
  'and the simulated merchant is a member of each demo shop for the run');
select tests.ok((select count(*) from public.vendor_search(null, null, null, null, null, 10, :'real') where vendor_id in (:'d1', :'d2')) = 2
  and not exists (select 1 from public.vendor_search(null, null, null, null, null, 10, :'real') where vendor_id = :'tv'),
  'a real customer (an investor) sees the demo shops and not the test shop');
select tests.ok(exists (select 1 from public.vendor_search(null, null, null, null, null, 10, :'owner') where vendor_id = :'tv'),
  'the owner still sees the test shop');
select tests.ok(exists (select 1 from public.vendor_search(null, null, null, null, null, 10) where vendor_id = :'tv'),
  'without a customer nothing is hidden');
select tests.ok(not exists (select 1 from public.vendor_search_pickup(33.6775, 35.5645, 10, :'real') where vendor_id = :'tv'),
  'the pickup search hides the same shops');
select tests.ok(not exists (select 1 from jsonb_array_elements(public.catalog_search(:'real', 'hummus') -> 'items') x
                            where (x ->> 'vendor_id')::uuid = :'tv'), 'and so does the dish search');
select tests.ok(public.sim_demo('+99996100000071', '+99996100000072', false) ->> 'status' = 'ok', 'the scenario opts out at the end');
select tests.ok(not exists (select 1 from public.vendor_members where phone_e164 = '+99996100000072' and status = 'active' and vendor_id in (:'d1', :'d2')),
  'which revokes the simulated merchant');
select tests.ok(public.sim_demo('+96170000071', '+99996100000072', true) ->> 'status' = 'not_a_sim_phone', 'a real number cannot be opted in');

-- Nothing to a shop's own number ------------------------------------------------------------------------------------------------
insert into public.outbound_messages (dedupe_key, vendor_id, channel, purpose, target)
values ('demo-test:1', :'d1', 'whatsapp', 'reply', '+96171000001'), ('demo-test:2', :'d1', 'call', 'reply', '+96171000001'),
       ('demo-test:3', :'d1', 'whatsapp', 'reply', '+96170000096'), ('demo-test:4', :'tv', 'whatsapp', 'reply', '+96171000009');
select tests.ok((select target from public.outbound_messages where dedupe_key = 'demo-test:1') = '+96170000096'
  and (select target from public.outbound_messages where dedupe_key = 'demo-test:2') = '+96170000096',
  'a message for a demo shop to the shop''s own number goes to the owner instead (WhatsApp and call)');
select tests.ok((select target from public.outbound_messages where dedupe_key = 'demo-test:3') = '+96170000096', 'the owner''s phone stays');
select tests.ok((select target from public.outbound_messages where dedupe_key = 'demo-test:4') = '+96171000009', 'other shops are untouched');
update public.outbound_messages set target = '+96171000001' where dedupe_key = 'demo-test:3';
select tests.ok((select target from public.outbound_messages where dedupe_key = 'demo-test:3') = '+96170000096', 'a later change of target is caught too');
delete from app_private.owner_phones;
insert into public.outbound_messages (dedupe_key, vendor_id, channel, purpose, target) values ('demo-test:5', :'d1', 'whatsapp', 'reply', '+96171000001');
select tests.ok((select status = 'skipped' and target = '+96171000001' from public.outbound_messages where dedupe_key = 'demo-test:5'),
  'with nobody to route to, it is skipped, never sent');

-- Item photos -----------------------------------------------------------------------------------------------------------------------
select id as kafta from public.menu_items where vendor_id = :'d1' and name_en = 'Kafta Plate' \gset
select tests.ok(public.menu_item_photo_set(:'kafta', 'illustrative', 'illustrative/' || :'d1' || '/' || :'kafta' || '.png', repeat('a', 64)) ->> 'status' = 'ok',
  'an illustrative photo is recorded for a demo item');
select tests.ok(exists (select 1 from jsonb_array_elements(public.demo_photos_todo(50)) x where (x ->> 'item_id')::uuid = :'kafta'
  and x #>> '{photo,source}' = 'illustrative' and x ->> 'image_url' = 'https://example.test/kafta.jpg'), 'the to-do list shows it, with the shop''s image');
select tests.ok((select p ->> 'photo' from jsonb_array_elements(public.catalog_desired(:'d1')) p where (p ->> 'retailer_id')::uuid = :'kafta')
  = 'illustrative/' || :'d1' || '/' || :'kafta' || '.png', 'the catalogue shows the item''s own photo');
insert into public.vendor_photos (vendor_id, storage_path, source, status, origin_hash)
values (:'d2', 'seed/' || :'d2' || '/' || repeat('b', 32) || '.jpg', 'seed', 'confirmed', repeat('b', 64));
select tests.ok((select bool_and(p ->> 'photo' is null) from jsonb_array_elements(public.catalog_desired(:'d2')) p),
  'a shop photo (here a confirmed Google one) is never an item''s photo');
select tests.ok(public.menu_item_photo_set((select i.id from public.menu_items i where i.vendor_id = :'tv' limit 1), 'illustrative',
  'illustrative/' || :'tv' || '/' || gen_random_uuid() || '.png', null) ->> 'status' = 'not_demo', 'illustrative photos are for demo shops only');
select tests.throws($$insert into public.menu_item_photos (item_id, vendor_id, storage_path, source)
  select i.id, i.vendor_id, 'website/' || i.vendor_id || '/' || i.id || '.png', 'illustrative' from public.menu_items i limit 1$$,
  'menu_item_photos_path_source', 'a photo''s path matches its source');

-- Leaving the list, and a claim, remove illustrative photos --------------------------------------------------------------------------
update public.menu_drafts set sections = '[{"name_en": "Grills", "items": [{"name_en": "Kafta Plate", "price": null, "currency": null}]}]'
where vendor_id = :'d1';
\i supabase/test-fixtures/demo-shops.sql
select tests.ok((select claim_status = 'unclaimed' and not orderable and not field_sources ? 'demo' from public.vendors where id = :'d1'),
  'a shop whose menu lost its prices is a seed listing again');
select tests.ok(not exists (select 1 from public.menu_item_photos where vendor_id = :'d1'), 'its illustrative photos are gone');
-- (A shop outside demo mode: the test shop, which is claimed already, is unclaimed and claimed again.)
select id as tv_item from public.menu_items where vendor_id = :'tv' limit 1 \gset
insert into public.menu_item_photos (item_id, vendor_id, storage_path, source)
values (:'tv_item', :'tv', 'illustrative/' || :'tv' || '/' || :'tv_item' || '.png', 'illustrative');
update public.vendors set orderable = false, claim_status = 'unclaimed' where id = :'tv';
update public.vendors set claim_status = 'claimed' where id = :'tv';
select tests.ok(not exists (select 1 from public.menu_item_photos where vendor_id = :'tv'), 'a real claim removes illustrative photos');

-- Permissions -----------------------------------------------------------------------------------------------------------------------
set local role anon;
select tests.throws($$select public.sim_demo('+99996100000071', '+99996100000072', true)$$, 'permission denied', 'clients cannot opt in');
select tests.throws($$select public.demo_photos_todo(1)$$, 'permission denied', 'or list demo items');
select tests.throws($$select * from public.menu_item_photos$$, 'permission denied', 'or read item photos');
reset role;

rollback;
