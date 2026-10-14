-- Session D (DECISIONS §38): the Shouf load, pilot villages, seed drafts, seed photos, OSM landmarks and aliases,
-- address fields, lost-driver calls and the staging test market.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-SHF', 'CHF', 'Shouf test zone', 'SRID=4326;MULTIPOLYGON(((35.54 33.66,35.575 33.66,35.575 33.70,35.54 33.70,35.54 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-SHF', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.5635 33.6774)', 'test'),
  ('LB-CHF-BAKAATA', null, 'بقعاتا', 'Bakaata', 'village', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.6000 33.6690)', 'test'),
  ('LB-CHF-BEITEDDINE', null, 'بيت الدين', 'Beiteddine', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.5800 33.6950)', 'test'),
  ('LB-CHF-TEST-PAUSED', null, 'مكان', 'Paused test place', 'village', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.62 33.65)', 'test'),
  ('LB-NRT-TEST-FAR', null, 'بعيد', 'Far test place', 'village', 'north', 'BAT', 'SRID=4326;POINT(35.84 34.25)', 'test');
update public.places set service_status = 'on' where id in ('LB-CHF-BEITEDDINE', 'LB-NRT-TEST-FAR');
update public.places set service_status = 'paused', paused_reason = 'security' where id = 'LB-CHF-TEST-PAUSED';

-- Seed sources ---------------------------------------------------------------------------------------------------
select tests.throws($$insert into public.vendors (slug, name_en, business_type, source) values ('x-bad-source', 'X', 'cafe', 'seed_Shouf!_2026')$$,
  'check constraint', 'a seed source must look like seed[_file]_yyyy_mm');

-- Pilot villages -------------------------------------------------------------------------------------------------
select app_private.pilot_places_apply() as pa \gset
select tests.ok((select service_status from public.places where id = 'LB-CHF-BAAKLINE') = 'on'
  and (select service_status from public.places where id = 'LB-CHF-BAKAATA') = 'on', 'the pilot villages are switched on');
select tests.ok((select service_status from public.places where id = 'LB-CHF-BEITEDDINE') = 'on', 'Beiteddine is in the delivery area (§39.2) and stays on');
select tests.ok((select service_status from public.places where id = 'LB-NRT-TEST-FAR') = 'off', 'a place outside the delivery area goes off');
select tests.ok((select service_status from public.places where id = 'LB-CHF-TEST-PAUSED') = 'paused', 'a paused place stays paused');
select tests.ok((:'pa'::jsonb ->> 'missing')::int = 256, 'the 256 delivery-area places this database lacks are reported missing');
select tests.ok((app_private.pilot_places_apply() ->> 'switched_on')::int = 0, 'running it again changes nothing');

-- The Shouf load -------------------------------------------------------------------------------------------------
insert into app_private.seed_vendors (place_id, slug, name_ar, name_en, branch_label, business_type, cuisine_tags, lat, lon,
  phone_seed, phone_seed_mobile, address_seed, brand_slug, brand_name_en, brand_name_ar, links, import_labels, town_id) values
  ('ChIJtestshoufgrill', 'shawarma-kareem-test', 'شاورما كريم', 'Shawarma Kareem', null, 'fast_food', '{shawarma}', 33.6703, 35.5991,
   '+96181917061', true, 'Main road, Boqaata', null, null, null, '[]', '{"hours_seed":"Monday: 8 AM to 8 PM"}', 'LB-CHF-BAKAATA'),
  ('ChIJtestshoufcoop', 'baakleen-coop-test', null, 'Baakleen Coop', null, 'minimarket', '{}', 33.6802, 35.5708,
   '+9615301050', false, 'MHJC+38J, Baakleen', null, null, null, '[{"kind":"website","url":"https://185.76.176.87/","status":"unchecked"}]', '{}', 'LB-CHF-BAAKLINE'),
  ('ChIJtestshoufnotown', 'no-village-test', null, 'No Village Cafe', null, 'cafe', '{}', 33.6780, 35.5650,
   null, null, 'chouf', null, null, null, '[]', '{}', null);
insert into app_private.seed_menu_drafts (place_id, kind, sections) values
  ('ChIJtestshoufgrill', 'restaurant', '[{"name_ar":"القائمة","name_en":"Menu","name_fr":"Menu","items":[{"name_en":"Chicken shawarma","price":4.5,"currency":"USD","confidence":0.5},{"name_en":"Garlic dip","price":null,"currency":null,"confidence":0.5}]}]'),
  ('ChIJtestshoufcoop', 'supermarket', '[{"name_ar":"مياه ومشروبات","name_en":"Water & Beverages","name_fr":"Eaux et boissons","items":[{"name_en":"Water 1.5L x 6","price":2.2,"currency":"USD","confidence":0.5,"sku":"BEV-WAT-001","unit":"Pack of 6"}]}]');
select app_private.shouf_load_seed('test-sha-1') as l1 \gset
select tests.ok((:'l1'::jsonb ->> 'vendors_new')::int = 3, 'three Shouf merchants are loaded');
select tests.ok(not exists (select 1 from public.vendors where source = 'seed_shouf_2026_10' and (claim_status <> 'unclaimed' or orderable or public_page)),
  'unclaimed, not orderable, no public page');
select tests.ok((select town_id from public.vendors where place_id = 'ChIJtestshoufgrill') = 'LB-CHF-BAKAATA', 'the file''s village is the town');
select tests.ok((select town_id from public.vendors where place_id = 'ChIJtestshoufnotown') = 'LB-CHF-BAAKLINE', 'a row with no village gets the nearest pilot village');
select tests.ok((select business_type from public.vendors where place_id = 'ChIJtestshoufcoop') = 'grocery_supermarket', 'a catalogue shop is a supermarket');
select tests.ok((select p.phone_seed_mobile and p.import_labels ->> 'hours_seed' is not null from public.vendor_private p
  join public.vendors v on v.id = p.vendor_id where v.place_id = 'ChIJtestshoufgrill'), 'seed phone, candidate flag and hours stay internal');
select tests.ok((select count(*) from public.menu_drafts d join public.vendors v on v.id = d.vendor_id
  where v.source = 'seed_shouf_2026_10' and d.source = 'seed' and d.status = 'draft') = 2, 'one seed draft per menu, status draft');
select tests.ok(not exists (select 1 from public.menu_items i join public.vendors v on v.id = i.vendor_id where v.source = 'seed_shouf_2026_10'),
  'nothing reaches a menu from a draft');
select tests.ok(not exists (select 1 from public.vendor_links where url like 'https://185.%' and status <> 'unchecked'), 'a raw-IP link stays unchecked');
select app_private.shouf_load_seed('test-sha-2') as l2 \gset
select tests.ok((:'l2'::jsonb ->> 'vendors_new')::int = 0 and (:'l2'::jsonb ->> 'drafts_new')::int = 0, 'a second load adds nothing');
select tests.throws($$insert into public.menu_drafts (vendor_id, source, sections) select id, 'seed', '[]' from public.vendors where place_id = 'ChIJtestshoufgrill'$$,
  'duplicate key', 'one seed draft per vendor');

-- A claimed merchant approves the seed section: the priced item becomes a menu item, the unpriced one does not.
select id as gv from public.vendors where place_id = 'ChIJtestshoufgrill' \gset
select id as gd from public.menu_drafts where vendor_id = :'gv' and source = 'seed' \gset
update public.vendors set claim_status = 'claimed' where id = :'gv';
insert into public.vendor_members (vendor_id, phone_e164, role, status) values (:'gv', '+96181917061', 'owner', 'invited');
select id as gm from public.vendor_members where vendor_id = :'gv' \gset
update public.vendor_members set user_id = '00000000-0000-0000-0000-000000000010', status = 'active' where id = :'gm';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.menu_draft_approve_section(:'gd', 0, :'gm');
reset role;
select tests.ok((select count(*) from public.menu_items where vendor_id = :'gv') = 1, 'approving the seed section adds only the priced item');
select tests.ok((select status from public.menu_drafts where id = :'gd') = 'approved', 'the seed draft is approved');
-- A claimed merchant's draft is never refreshed by a later load.
select app_private.shouf_load_seed('test-sha-3') as l3 \gset
select tests.ok((select status from public.menu_drafts where id = :'gd') = 'approved', 'a later load leaves a claimed merchant''s draft alone');

-- Seed photos --------------------------------------------------------------------------------------------------
insert into public.vendor_photos (vendor_id, storage_path, source, origin_hash, bytes) values
  (:'gv', 'seed/' || :'gv' || '/0123456789abcdef0123456789abcdef.jpg', 'seed', repeat('a', 64), 1000),
  (:'gv', 'seed/' || :'gv' || '/fedcba9876543210fedcba9876543210.jpg', 'seed', repeat('b', 64), 1000);
select tests.throws($$insert into public.vendor_photos (vendor_id, storage_path, source) select id, 'seed/' || id || '/00112233445566778899aabbccddeeff.jpg', 'seed' from public.vendors where place_id = 'ChIJtestshoufgrill'$$,
  'vendor_photos_seed_hash', 'a seed photo carries the hash of its source');
select tests.throws($$insert into public.vendor_photos (vendor_id, storage_path, source, origin_hash) select id, 'seed/' || id || '/aa.jpg', 'seed', repeat('a', 64) from public.vendors where place_id = 'ChIJtestshoufgrill'$$,
  'check constraint|duplicate key', 'the same source photo is never stored twice');
select id as ph1 from public.vendor_photos where origin_hash = repeat('a', 64) \gset
select id as ph2 from public.vendor_photos where origin_hash = repeat('b', 64) \gset
select tests.ok((select count(*) from public.vendor_photos where vendor_id = :'gv' and status = 'pending') = 2, 'seed photos start pending (not shown)');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.vendor_photo_decide(:'ph1', true, :'gm');
select public.vendor_photo_decide(:'ph2', false, :'gm');
reset role;
select tests.ok((select status from public.vendor_photos where id = :'ph1') = 'confirmed', 'the merchant keeps a photo');
select tests.ok((select status from public.vendor_photos where id = :'ph2') = 'removed', 'and removes another');
select tests.throws(format($$select public.vendor_photo_decide(%L, true)$$, :'ph2'), 'unknown photo', 'a removed photo cannot come back');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.throws(format($$select public.vendor_photo_decide(%L, false, '20000000-0000-0000-0000-00000000000a')$$, :'ph1'), 'not allowed',
  'the server acts only for a member of this vendor');
reset role;
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws(format($$select public.vendor_photo_decide(%L, false)$$, :'ph1'), 'permission denied', 'a signed-in user cannot decide photos directly');
select tests.throws(format($$select public.vendor_photos_remove_seed(%L)$$, :'gv'), 'permission denied', 'nor remove them all');
select tests.ok((select count(*) from public.vendor_photos) = 0, 'and cannot read them');
select tests.act_as('00000000-0000-0000-0000-000000000010');
select tests.ok((select count(*) from public.vendor_photos where vendor_id = :'gv') = 2, 'the owner reads the vendor''s photos');
reset role;
select tests.act_as(null);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.vendor_photos_remove_seed(:'gv') = 1, 'on request every seed photo of a vendor is removed');
reset role;

-- OSM landmarks and place aliases ------------------------------------------------------------------------------
insert into app_private.seed_osm_landmarks (osm_ref, kind, name_ar, name_en, aliases, lat, lon) values
  ('node/101', 'druze_majlis', 'مجلس بعقلين', 'Baakline Majlis', '{"Khalwa"}', 33.6780, 35.5640),
  ('way/102', 'roundabout', null, 'Saha roundabout', null, 33.6790, 35.5650),
  ('node/103', 'pharmacy', null, null, null, 33.6790, 35.5650);
insert into app_private.seed_osm_aliases (osm_ref, alias, lang, osm_key, lat, lon) values
  ('node/201', 'Baakleen', '', 'alt_name', 33.6774, 35.5635),
  ('node/201', 'Ba3klin', 'arabizi', 'loc_name', 33.6774, 35.5635),
  ('node/202', 'Far Alias', '', 'alt_name', 34.2500, 35.8400);
select app_private.osm_load_seed('osm-sha-1') as o1 \gset
select tests.ok((:'o1'::jsonb ->> 'landmarks')::int = 2, 'named OSM landmarks are loaded, an unnamed one is not');
select tests.ok((select bool_and(source = 'osm' and status = 'unconfirmed' and shared and confidence = 0.3) from public.landmarks), 'OSM landmarks start low: unconfirmed, shared, 0.3');
select tests.ok((select place_id from public.landmarks where osm_ref = 'node/101') = 'LB-CHF-BAAKLINE', 'a landmark gets its place from the point');
select tests.ok((select count(*) from public.place_aliases where source = 'osm' and place_id = 'LB-CHF-BAAKLINE' and status = 'confirmed') = 2,
  'OSM names of a pilot village become confirmed aliases');
select tests.ok(not exists (select 1 from public.place_aliases where alias = 'Far Alias'), 'a name outside the delivery area is skipped');
select app_private.promote_landmarks();
select app_private.promote_place_aliases();
select tests.ok((select bool_and(shared) from public.landmarks where source = 'osm'), 'promotion keeps OSM landmarks shared');
select tests.ok((select bool_and(status = 'confirmed') from public.place_aliases where source = 'osm'), 'promotion keeps OSM aliases confirmed');
select tests.ok((app_private.osm_load_seed('osm-sha-2') ->> 'landmarks')::int = 0, 'a second OSM load changes nothing');

-- Address fields and lost-driver calls ---------------------------------------------------------------------------
select tests.ok(public.config_numeric('loc_door_max_accuracy_m') = 25 and public.config_numeric('loc_door_radius_m') = 60,
  'door points: fixes within 25 m accuracy agree within 60 m (§38.3)');
select tests.throws($$insert into public.addresses (customer_id, place_id, source, landmark_relation)
  select id, 'LB-CHF-BAAKLINE', 'list', 'next_to' from public.customers limit 1$$, 'addresses_relation_needs_landmark',
  'a landmark relation needs a landmark');
insert into public.addresses (customer_id, place_id, source, landmark_id, landmark_relation, floor, has_elevator)
select c.id, 'LB-CHF-BAAKLINE', 'list', l.id, 'behind', '3', false from public.customers c, public.landmarks l where l.osm_ref = 'node/101' limit 1;
select tests.ok(exists (select 1 from public.addresses where landmark_relation = 'behind' and has_elevator = false and floor = '3'),
  'an address keeps the landmark relation, floor and elevator');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.throws($$select public.order_lost_driver_call('30000000-0000-0000-0000-000000000001')$$, 'not a delivery order',
  'a pickup order has no lost-driver calls');
select tests.ok((public.lost_driver_calls_metric(30) ->> 'target')::numeric = 0.5, 'the metric reports against the 0.5 target');
reset role;
update public.orders set lost_driver_calls = 1 where id = '30000000-0000-0000-0000-000000000001';
select tests.ok((select lost_driver_calls from public.orders where id = '30000000-0000-0000-0000-000000000001') = 1, 'orders carry the count');

-- The staging test market ----------------------------------------------------------------------------------------
select tests.ok(public.sim_market('+99996100000001', true) ->> 'status' = 'sink_off', 'sim_market refuses while the sink is off');
update public.vendors set place_id = 'ChIJhaAhhQMgHxURbFIi9R14X1I' where place_id = 'ChIJtestshoufcoop';
select set_config('app.fixture_owner_phone', '+96170000098', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as mv from public.vendors where slug = 'alo-test-market' \gset
select tests.ok((select is_test and claim_status = 'claimed' and not orderable and not public_page and not pickup_enabled
  and business_type = 'grocery_supermarket' from public.vendors where id = :'mv'), 'the fixture makes the test market, closed');
select tests.ok((select count(*) from public.menu_items where vendor_id = :'mv') = 1, 'with the Coop''s priced catalogue items');
select tests.ok((select orderable from public.vendors where place_id = 'ChIJhaAhhQMgHxURbFIi9R14X1I') = false, 'the real Coop stays an unorderable draft');
\i supabase/test-fixtures/alo-test-grill.sql
select tests.ok((select count(*) from public.menu_items where vendor_id = :'mv') = 1, 'the fixture is idempotent');
select tests.ok(public.sim_market('+96170000001', true) ->> 'status' = 'not_a_sim_phone', 'a real number cannot open the test market');
select tests.ok(public.sim_market('+99996100000001', true) ->> 'status' = 'ok', 'sim_market opens the test market');
select tests.ok((select orderable from public.vendors where id = :'mv')
  and exists (select 1 from public.vendor_order_channels where vendor_id = :'mv' and role = 'primary' and enabled and target = '+99996100000001'),
  'orderable, with the simulated merchant as its channel');
select tests.ok(public.sim_market('+99996100000001', false) ->> 'status' = 'ok', 'sim_market closes the test market');
select tests.ok(not (select orderable from public.vendors where id = :'mv'), 'it is no longer orderable');
select tests.ok(not exists (select 1 from public.vendor_members where vendor_id = :'mv' and status = 'active'), 'the simulated merchant is revoked');

-- One shop listed twice (§39.4): a later load names the second listing as a duplicate; the unclaimed copy is removed.
truncate app_private.seed_vendors, app_private.seed_vendor_exclusions, app_private.seed_menu_drafts;
insert into app_private.seed_vendors (place_id, slug, name_ar, name_en, branch_label, business_type, cuisine_tags, lat, lon,
  phone_seed, phone_seed_mobile, address_seed, brand_slug, brand_name_en, brand_name_ar, links, import_labels, town_id) values
  ('ChIJtestdupkeep', 'dup-keep-test', null, 'Dup Keep', null, 'restaurant', '{}', 33.6790, 35.5640,
   null, null, 'Baakleen', null, null, null, '[]', '{}', 'LB-CHF-BAAKLINE'),
  ('ChIJtestdupcopy', 'dup-copy-test', 'نسخة', null, null, 'restaurant', '{}', 33.6791, 35.5641,
   null, null, 'Baakleen', null, null, null, '[]', '{}', 'LB-CHF-BAAKLINE');
select app_private.shouf_load_seed('test-sha-dup-1') as d1 \gset
select tests.ok((select count(*) = 2 from public.vendors where place_id in ('ChIJtestdupkeep', 'ChIJtestdupcopy')), 'both listings load at first');
truncate app_private.seed_vendors, app_private.seed_vendor_exclusions, app_private.seed_menu_drafts;
insert into app_private.seed_vendors (place_id, slug, name_ar, name_en, branch_label, business_type, cuisine_tags, lat, lon,
  phone_seed, phone_seed_mobile, address_seed, brand_slug, brand_name_en, brand_name_ar, links, import_labels, town_id) values
  ('ChIJtestdupkeep', 'dup-keep-test', 'نسخة', 'Dup Keep', null, 'restaurant', '{}', 33.6790, 35.5640,
   null, null, 'Baakleen', null, null, null, '[]', '{}', 'LB-CHF-BAAKLINE');
insert into app_private.seed_vendor_exclusions (place_id, name, reason) values ('ChIJtestdupcopy', 'نسخة', 'duplicate of ChIJtestdupkeep');
select app_private.shouf_load_seed('test-sha-dup-2') as d2 \gset
select tests.ok((:'d2'::jsonb ->> 'duplicates_removed')::int = 1
  and not exists (select 1 from public.vendors where place_id = 'ChIJtestdupcopy')
  and exists (select 1 from public.vendors where place_id = 'ChIJtestdupkeep'),
  'the duplicate is removed, the kept listing stays');
select tests.ok(exists (select 1 from public.vendor_import_exclusions where place_id = 'ChIJtestdupcopy' and reason like 'duplicate of %'),
  'and it is recorded as an exclusion, so it is never imported again');
truncate app_private.seed_vendors, app_private.seed_vendor_exclusions, app_private.seed_menu_drafts;

rollback;
