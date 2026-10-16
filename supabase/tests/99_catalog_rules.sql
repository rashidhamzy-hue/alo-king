-- Session 5f part 9 (DECISIONS §39.15.4): catalogue rules the merchant agent learns. The published rules are seeded in
-- four languages; Meta's refusals no rule knows become learned rules, and known ones are counted; what the sync holds
-- back is left out of product messages but stays orderable; the report counts it; a merchant's own photo is recorded by
-- an owner or manager only; clients see none of it.
begin;

select set_config('app.fixture_owner_phone', '+96170000163', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
insert into public.whatsapp_catalogs (waba_id, catalog_id, transport, commerce_on) values ('1086076707590021', '1684040949970021', 'graph', true);
select s.id as sec from public.menu_sections s where s.vendor_id = :'tv' and s.name_en = 'Sandwiches' \gset
select array_agg(i.id order by i.sort_order, i.id) as items from public.menu_items i where i.section_id = :'sec' \gset
select cardinality(:'items'::uuid[]) as n_items \gset
insert into public.catalog_sync_items (item_id, vendor_id, content_hash, visible, catalog_id)
select x, :'tv', 'h', true, '1684040949970021' from unnest(:'items'::uuid[]) x;

-- 1. The published rules -------------------------------------------------------------------------------------------------
select tests.ok((select count(*) from public.catalog_rules where source = 'meta_published') = 19, 'the 19 published rules are seeded');
select tests.ok(not exists (select 1 from public.catalog_rules where source = 'meta_published'
  and (rule_ar !~ '[؀-ۿ]' or rule_en !~ '[a-z]' or rule_fr is null or rule_arabizi is null or basis is null)),
  'each in Arabic, English, French and Arabizi, with where it comes from');
select tests.ok((select array_agg(code order by code) from public.catalog_rules where not checked_here)
  = array['image_collage', 'image_text_overlay', 'image_watermark'],
  'only writing on a photo, a watermark and a collage are left to Meta''s review (no vision model here)');
select tests.ok((select bool_and(count = 0 and first_seen is null and last_seen is null) from public.catalog_rules),
  'nothing is counted before Meta reports it');
select tests.ok((select rule_en from public.catalog_rules where code = 'image_too_small') = 'Photos are at least 500 × 500 pixels.',
  'the words are the validator''s');

-- 2. Learning from Meta's refusals ---------------------------------------------------------------------------------------
select public.catalog_status_record('1684040949970021', jsonb_build_array(
  jsonb_build_object('retailer_id', (:'items'::uuid[])[1], 'review_status', 'rejected', 'visibility', 'published',
    'errors', jsonb_build_object('data', jsonb_build_array(
      jsonb_build_object('title', 'Image has text overlay', 'error_type', 'IMAGE_TEXT_OVERLAY', 'priority', 'HIGH',
        'description', 'Images with text overlay are not allowed.'),
      jsonb_build_object('foo', 'bar'),
      '"not an object"'::jsonb))))) as r1 \gset
select tests.ok(:r1 = 1, 'the status is recorded as before');
select tests.ok((select count(*) from public.catalog_rules where source = 'learned') = 1,
  'an error no rule knows becomes one learned rule (an error without a title or type is not a rule)');
select code as learned1 from public.catalog_rules where source = 'learned' \gset
select tests.ok((select field = 'other' and not checked_here and meta_error_title = 'Image has text overlay'
    and meta_error_type = 'IMAGE_TEXT_OVERLAY' and rule_en = 'Images with text overlay are not allowed.'
    and example_item_id = (:'items'::uuid[])[1] and count = 1 and first_seen is not null and last_seen is not null
    and rule_ar is null and code ~ '^learned_image_text_overlay_[0-9a-f]{8}$'
  from public.catalog_rules where code = :'learned1'),
  'with Meta''s words, its type, its example item and a count of one; the review session writes the other languages');
-- The sweep reads the same refusal again: not a new occurrence.
update public.catalog_rules set last_seen = now() - interval '2 hours' where code = :'learned1';
select public.catalog_status_record('1684040949970021', jsonb_build_array(
  jsonb_build_object('retailer_id', (:'items'::uuid[])[1], 'review_status', 'rejected', 'visibility', 'published',
    'errors', jsonb_build_array(jsonb_build_object('title', 'Image  has text overlay ', 'error_type', 'IMAGE_TEXT_OVERLAY')))));
select tests.ok((select count = 1 and last_seen > now() - interval '1 minute' from public.catalog_rules where code = :'learned1'),
  'a refusal read again on the same item moves last_seen only');
-- Within the hour a sweep re-reading the same refusal writes nothing at all (§39.14 rule 2: no write per read).
update public.catalog_rules set last_seen = now() - interval '30 minutes' where code = :'learned1';
select public.catalog_status_record('1684040949970021', jsonb_build_array(
  jsonb_build_object('retailer_id', (:'items'::uuid[])[1], 'review_status', 'rejected', 'visibility', 'published',
    'errors', jsonb_build_array(jsonb_build_object('title', 'Image has text overlay', 'error_type', 'IMAGE_TEXT_OVERLAY')))));
select tests.ok((select count = 1 and last_seen = now() - interval '30 minutes' from public.catalog_rules where code = :'learned1'),
  'a repeat within the hour leaves the rule untouched');
select tests.ok((select count(*) = 2 and bool_and((t.tgtype & 1) = 0) from pg_trigger t
  where t.tgrelid = 'public.catalog_item_status'::regclass and t.tgname like 'catalog_item_status_learn%'),
  'learning runs once per statement (a status page), not once per row');
-- Another item with the same type (Meta's title worded differently): the same rule, counted.
select public.catalog_status_record('1684040949970021', jsonb_build_array(
  jsonb_build_object('retailer_id', (:'items'::uuid[])[2], 'review_status', 'rejected',
    'errors', jsonb_build_array(jsonb_build_object('title', 'Text on product image', 'error_type', 'image_text_overlay')))));
select tests.ok((select count from public.catalog_rules where code = :'learned1') = 2
  and (select count(*) from public.catalog_rules where source = 'learned') = 1,
  'a known error on another item is counted on its rule (matched by type, without case); no new rule');
-- A title only, then the same title with a type: one rule, which learns the type.
select public.catalog_status_record('1684040949970021', jsonb_build_array(
  jsonb_build_object('retailer_id', (:'items'::uuid[])[3], 'review_status', 'rejected',
    'errors', jsonb_build_array(jsonb_build_object('title', 'Policy violations')))));
select code as learned2 from public.catalog_rules where meta_error_title = 'Policy violations' \gset
select tests.ok((select meta_error_type is null and count = 1 and rule_en = 'Policy violations' and code ~ '^learned_policy_violations_'
  from public.catalog_rules where code = :'learned2'), 'a title alone is enough to learn a rule');
select public.catalog_status_record('1684040949970021', jsonb_build_array(
  jsonb_build_object('retailer_id', (:'items'::uuid[])[1], 'review_status', 'rejected',
    'errors', jsonb_build_array(jsonb_build_object('title', 'POLICY VIOLATIONS', 'error_type', 'POLICY_VIOLATION')))));
select tests.ok((select meta_error_type = 'POLICY_VIOLATION' and count = 2 from public.catalog_rules where code = :'learned2')
  and (select count(*) from public.catalog_rules where source = 'learned') = 2,
  'matched by its title, it is counted and learns Meta''s type');
-- A published rule the review session linked to Meta's title: counted there, nothing learned.
update public.catalog_rules set meta_error_title = 'Image too small' where code = 'image_too_small';
select public.catalog_status_record('1684040949970021', jsonb_build_array(
  jsonb_build_object('retailer_id', (:'items'::uuid[])[2], 'review_status', 'rejected',
    'errors', jsonb_build_array(jsonb_build_object('title', 'IMAGE TOO SMALL'),
                                jsonb_build_object('title', 'Text on product image', 'error_type', 'image_text_overlay')))));
select tests.ok((select count = 1 and first_seen is not null and example_item_id = (:'items'::uuid[])[2]
  from public.catalog_rules where code = 'image_too_small')
  and (select count(*) from public.catalog_rules where source = 'learned') = 2
  and (select count from public.catalog_rules where code = :'learned1') = 2,
  'a published rule with Meta''s title is counted, with its first sighting and example; the item''s older error is not counted twice');
-- Learning never blocks Meta's answer: a rule that cannot be written is a warning, the status is still recorded.
savepoint no_learning;
alter table public.catalog_rules add constraint catalog_rules_test_block check (source <> 'learned') not valid;
select public.catalog_status_record('1684040949970021', jsonb_build_array(
  jsonb_build_object('retailer_id', (:'items'::uuid[])[3], 'review_status', 'rejected', 'visibility', 'published',
    'errors', jsonb_build_array(jsonb_build_object('title', 'Brand new refusal', 'error_type', 'NEW_THING'))))) as r_block \gset
select tests.ok(:r_block = 1
  and (select errors -> 0 ->> 'title' = 'Brand new refusal' from public.catalog_item_status where item_id = (:'items'::uuid[])[3])
  and not exists (select 1 from public.catalog_rules where meta_error_type = 'NEW_THING'),
  'when learning fails (a warning) the status is still recorded');
rollback to savepoint no_learning;
select tests.ok(not exists (select 1 from public.catalog_rules where meta_error_type = 'NEW_THING'), '(and nothing half-learned stays)');
-- A whole status page (500 products in one statement): one set-based write per rule, each item counted once.
insert into public.menu_items (vendor_id, name_en, price_usd)
select '20000000-0000-0000-0000-00000000000a', 'Page item ' || g, 1 from generate_series(1, 500) g;
select array_agg(id order by id) as page from public.menu_items where name_en like 'Page item %' \gset
select count as before_overlay from public.catalog_rules where code = :'learned1' \gset
select public.catalog_status_record('1684040949970021', (select jsonb_agg(jsonb_build_object('retailer_id', x,
  'review_status', 'rejected', 'errors', jsonb_build_array(
    jsonb_build_object('title', 'Product image is blurry', 'error_type', 'BLURRY_IMAGE', 'description', 'The image is blurry.'),
    jsonb_build_object('title', 'Text on product image', 'error_type', 'image_text_overlay'))))
  from unnest(:'page'::uuid[]) x)) as r500 \gset
select tests.ok(:r500 = 500
  and (select count = 500 and example_item_id = (:'page'::uuid[])[1] and rule_en = 'The image is blurry.'
       from public.catalog_rules where meta_error_type = 'BLURRY_IMAGE')
  and (select count from public.catalog_rules where code = :'learned1') = :before_overlay + 500,
  'a 500-product page learns one rule and counts both errors once per item, in one statement');
select public.catalog_status_record('1684040949970021', (select jsonb_agg(jsonb_build_object('retailer_id', x,
  'review_status', 'rejected', 'errors', jsonb_build_array(
    jsonb_build_object('title', 'Product image is blurry', 'error_type', 'BLURRY_IMAGE'),
    jsonb_build_object('title', 'Text on product image', 'error_type', 'image_text_overlay'))))
  from unnest(:'page'::uuid[]) x));
select tests.ok((select count from public.catalog_rules where meta_error_type = 'BLURRY_IMAGE') = 500
  and (select count from public.catalog_rules where code = :'learned1') = :before_overlay + 500,
  'the same page read again counts nothing new');

-- 3. Held items: left out of the catalogue, still orderable ---------------------------------------------------------------
select public.catalog_status_record('1684040949970021', (select jsonb_agg(jsonb_build_object('retailer_id', x, 'review_status', 'approved',
  'visibility', 'published', 'availability', 'in stock', 'errors', '[]'::jsonb)) from unnest(:'items'::uuid[]) x));
select tests.ok((public.catalog_shop_menu(:'tv', '1684040949970021') ->> 'shown')::int = :n_items, 'every item approved and shown');
insert into public.menu_items (vendor_id, name_en, price_usd) values ('20000000-0000-0000-0000-00000000000a', 'Other shop''s item', 1)
returning id as other_item \gset
select tests.ok(public.catalog_hold_record(:'tv', jsonb_build_array(
  jsonb_build_object('item_id', (:'items'::uuid[])[2], 'codes', jsonb_build_array('price_not_positive', 'BAD code!', 'price_not_positive')),
  jsonb_build_object('item_id', (:'items'::uuid[])[3], 'codes', jsonb_build_array('?')),
  jsonb_build_object('item_id', :'other_item', 'codes', jsonb_build_array('policy_alcohol')),
  jsonb_build_object('item_id', 'not-ours', 'codes', jsonb_build_array('policy_alcohol')))) = 1,
  'the sync''s holds are recorded for this shop''s items only, with well-formed codes');
select tests.ok((select codes = array['price_not_positive'] and vendor_id = :'tv' from public.catalog_item_holds
  where item_id = (:'items'::uuid[])[2]), 'each code once');
select tests.ok(not app_private.catalog_item_shown((:'items'::uuid[])[2], '1684040949970021')
  and app_private.catalog_item_shown((:'items'::uuid[])[1], '1684040949970021'),
  'a held item is not shown in WhatsApp, even while Meta still lists it as approved');
select tests.ok(not app_private.catalog_item_shown((:'items'::uuid[])[2], 'sim'), 'nor in the simulator''s catalogue');
select tests.ok((select (s ->> 'total')::int = :n_items and (s ->> 'shown')::int = :n_items - 1
  from jsonb_array_elements(public.catalog_shop_menu(:'tv', '1684040949970021') -> 'sections') s where s ->> 'section_id' = :'sec'),
  'its section still counts it, and opens the others as a product message');
select tests.ok(exists (select 1 from public.catalog_section_rest(:'tv', '1684040949970021', :'sec') where item_id = (:'items'::uuid[])[2]),
  'the held item comes in the list after the product message: still reachable');
select tests.ok(app_private.menu_item_orderable((:'items'::uuid[])[2], 1)
  and exists (select 1 from public.vendor_menu(:'tv', null, :'sec', 30) m where m.item_id = (:'items'::uuid[])[2]),
  'and still orderable: the chat menu and the web menu keep it');
select tests.ok(not exists (select 1 from jsonb_array_elements(public.catalog_products(:'tv', '1684040949970021', :'sec') -> 'products') p
  where p ->> 'retailer_id' = (:'items'::uuid[])[2]::text), 'no product message offers it');
select held_since as hs from public.catalog_item_holds where item_id = (:'items'::uuid[])[2] \gset
update public.vendors set is_test = false where id = :'tv';
select tests.ok((select held = 1 and top_hold = 'price_not_positive' and synced = :n_items
  from public.catalog_status_report('1684040949970021') where vendor_id = :'tv'),
  'the report counts it as held and names the reason');
select public.catalog_hold_record(:'tv', jsonb_build_array(
  jsonb_build_object('item_id', (:'items'::uuid[])[2], 'codes', jsonb_build_array('price_not_positive', 'policy_alcohol'))));
select tests.ok((select held_since = :'hs'::timestamptz and codes = array['policy_alcohol', 'price_not_positive']
  from public.catalog_item_holds where item_id = (:'items'::uuid[])[2]), 'held again: the reasons are updated, held_since kept');
select public.catalog_hold_record(:'tv', '[]') as r_clear \gset
select tests.ok(:r_clear = 0 and not exists (select 1 from public.catalog_item_holds where vendor_id = :'tv')
  and app_private.catalog_item_shown((:'items'::uuid[])[2], '1684040949970021'),
  'once its items pass, the shop''s holds are cleared and the item is shown again');
select tests.throws($$select public.catalog_hold_record('20000000-0000-0000-0000-00000000000a', '{}')$$, 'must be a json array',
  'the holds must be a list');

-- 4. What catalog_desired hands the validator -------------------------------------------------------------------------
insert into public.menu_item_photos (item_id, vendor_id, storage_path, source)
values ((:'items'::uuid[])[1], :'tv', 'merchant/' || :'tv' || '/' || (:'items'::uuid[])[1] || '.jpg', 'merchant')
returning storage_path as p1 \gset
select tests.ok(public.menu_item_photo_measure((:'items'::uuid[])[1], :'p1', 800, 800, 64000) ->> 'status' = 'ok'
  and public.menu_item_photo_measure((:'items'::uuid[])[1], 'merchant/x.jpg', 800, 800, 64000) ->> 'status' = 'no_photo'
  and public.menu_item_photo_measure((:'items'::uuid[])[1], :'p1', 0, 800, 64000) ->> 'status' = 'bad_size',
  'the demo pipeline records the size of the photo it stored, for that photo only');
update public.menu_items set contains_alcohol = true where id = (:'items'::uuid[])[1];
select tests.ok((select (d ->> 'photo_width')::int = 800 and (d ->> 'photo_height')::int = 800 and (d ->> 'photo_bytes')::int = 64000
    and (d ->> 'contains_alcohol')::boolean and d ->> 'business_type' = 'restaurant'
  from jsonb_array_elements(public.catalog_desired(:'tv')) d where d ->> 'retailer_id' = (:'items'::uuid[])[1]::text),
  'catalog_desired carries the photo''s size, the alcohol flag and the business type');
update public.menu_items set contains_alcohol = false where id = (:'items'::uuid[])[1];

-- 5. A merchant's own photo: it waits for the merchant's tap, then becomes the item's photo ----------------------------
\set va '20000000-0000-0000-0000-00000000000a'
\set kn '59000000-0000-0000-0000-000000000001'
insert into public.menu_items (id, vendor_id, name_en, name_ar, price_usd) values (:'kn', :'va', 'Knefe', 'كنافة', 3.50);
insert into public.menu_item_photos (item_id, vendor_id, storage_path, source, license, credit)
values (:'kn', :'va', 'illustrative/' || :'va' || '/' || :'kn' || '.jpg', 'illustrative', 'CC0', 'someone');
select id as owner_a from public.vendor_members where vendor_id = :'va' and role = 'owner' \gset
select id as cashier_a from public.vendor_members where vendor_id = :'va' and role = 'cashier' \gset
set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.merchant_item_photo_path(:'owner_a', :'kn', 'jpg') as w1 \gset
select (:'w1'::jsonb ->> 'pending_id') as pend1, (:'w1'::jsonb ->> 'path') as path1 \gset
select tests.ok(:'w1'::jsonb ->> 'status' = 'ok' and :'w1'::jsonb ->> 'item_name' = 'كنافة'
  and :'path1' = 'merchant/' || :'va' || '/' || :'pend1' || '.jpg',
  'an owner''s photo is uploaded under a fresh name in the shop''s folder');
select tests.ok(public.merchant_item_photo_path(:'owner_a', :'kn', 'jpg') ->> 'pending_id' <> :'pend1',
  'every photo gets its own name, so no file is overwritten before the tap');
select tests.ok(public.merchant_item_photo_path(:'cashier_a', :'kn', 'jpg') ->> 'status' = 'not_allowed'
  and public.merchant_item_photo_path(null, :'kn', 'jpg') ->> 'status' = 'not_allowed',
  'a cashier may not change the menu''s photos (owner or manager, as for every menu change)');
select tests.ok(public.merchant_item_photo_path(:'owner_a', :'kn', 'gif') ->> 'status' = 'bad_format'
  and public.merchant_item_photo_path(:'owner_a', (:'items'::uuid[])[1], 'jpg') ->> 'status' = 'not_allowed'
  and public.merchant_item_photo_path(:'owner_a', '59000000-0000-0000-0000-0000000000ff', 'jpg') ->> 'status' = 'no_item',
  'JPEG, PNG or WebP; another shop''s item or an unknown one is refused');
select tests.ok(public.merchant_item_photo_pending(:'owner_a', :'pend1', :'kn', :'path1', repeat('a', 64), 1200, 900, 180000, 'ar')
  = '{"status": "ok", "replaced": null}'::jsonb, 'the uploaded photo waits for the tap');
reset role;
select tests.ok((select source = 'illustrative' from public.menu_item_photos where item_id = :'kn')
  and (select lang = 'ar' and expires_at > now() + interval '23 hours' from app_private.merchant_item_photo_pending where id = :'pend1'),
  'nothing changes before the tap; the photo waits a day (merchant_photo_pending_hours)');
set local role service_role;
select tests.ok(public.merchant_item_photo_pending(:'owner_a', gen_random_uuid(), :'kn', :'path1', repeat('a', 64), 1200, 900, 1, 'ar') ->> 'status' = 'bad_path'
  and public.merchant_item_photo_pending(:'owner_a', :'pend1', :'kn', replace(:'path1', :'va', :'tv'), repeat('a', 64), 1200, 900, 1, 'ar') ->> 'status' = 'bad_path'
  and public.merchant_item_photo_pending(:'owner_a', :'pend1', :'kn', :'path1', 'nothex', 1200, 900, 1, 'ar') ->> 'status' = 'bad_hash'
  and public.merchant_item_photo_pending(:'owner_a', :'pend1', :'kn', :'path1', repeat('a', 64), 30000, 900, 1, 'ar') ->> 'status' = 'bad_size'
  and public.merchant_item_photo_pending(:'owner_a', :'pend1', :'kn', :'path1', repeat('a', 64), 1200, 900, 1, 'de') ->> 'status' = 'bad_lang'
  and public.merchant_item_photo_pending(:'cashier_a', :'pend1', :'kn', :'path1', repeat('a', 64), 1200, 900, 1, 'ar') ->> 'status' = 'not_allowed',
  'the name the server gave, the hash, the size, the language and the member are checked when it is recorded');
-- A second photo of the same item replaces the one still waiting.
select public.merchant_item_photo_path(:'owner_a', :'kn', 'png') as w2 \gset
select (:'w2'::jsonb ->> 'pending_id') as pend2, (:'w2'::jsonb ->> 'path') as path2 \gset
select tests.ok(public.merchant_item_photo_pending(:'owner_a', :'pend2', :'kn', :'path2', repeat('b', 64), 1000, 1000, 90000, 'en')
  ->> 'replaced' = :'path1', 'a second photo of the item replaces the one still waiting, and names its file to delete');
select tests.ok(public.merchant_item_photo_confirm(:'pend1', array[:'owner_a']::uuid[]) ->> 'status' = 'not_found',
  'the replaced photo''s card no longer records anything');
select tests.ok(public.merchant_item_photo_confirm(:'pend2', array[:'cashier_a']::uuid[])
  = jsonb_build_object('status', 'not_allowed', 'lang', 'en'), 'only the member who sent the photo confirms it');
reset role;
delete from app_private.catalog_sync_queue where vendor_id = :'va';
set local role service_role;
select public.merchant_item_photo_confirm(:'pend2', array[:'cashier_a', :'owner_a']::uuid[]) as c2 \gset
select tests.ok(:'c2'::jsonb = '{"status": "ok", "item_name": "كنافة", "lang": "en", "previous": null}'::jsonb,
  'the tap records it, answering in the caption''s language');
reset role;
select tests.ok((select source = 'merchant' and license is null and credit is null and width = 1000 and height = 1000 and bytes = 90000
    and storage_path = :'path2' from public.menu_item_photos where item_id = :'kn')
  and not exists (select 1 from app_private.merchant_item_photo_pending where item_id = :'kn'),
  'as the merchant''s own, replacing the dish photo, with its size; nothing waits any more');
select tests.ok(exists (select 1 from app_private.catalog_sync_queue where vendor_id = :'va'),
  'and the shop''s catalogue sync is queued (the validator runs again there)');
set local role service_role;
select public.merchant_item_photo_path(:'owner_a', :'kn', 'jpg') as w3 \gset
select (:'w3'::jsonb ->> 'pending_id') as pend3, (:'w3'::jsonb ->> 'path') as path3 \gset
select public.merchant_item_photo_pending(:'owner_a', :'pend3', :'kn', :'path3', repeat('c', 64), 800, 800, 70000, 'fr');
select tests.ok(public.merchant_item_photo_confirm(:'pend3', array[:'owner_a']::uuid[]) ->> 'previous' = :'path2',
  'a newer photo, confirmed, replaces the merchant''s earlier one and names its file to delete');
-- A tap after the wait, and the sweep of photos nobody tapped.
select public.merchant_item_photo_path(:'owner_a', :'kn', 'jpg') as w4 \gset
select (:'w4'::jsonb ->> 'pending_id') as pend4, (:'w4'::jsonb ->> 'path') as path4 \gset
select public.merchant_item_photo_pending(:'owner_a', :'pend4', :'kn', :'path4', repeat('d', 64), 800, 800, 70000, 'arabizi');
reset role;
update app_private.merchant_item_photo_pending set expires_at = now() - interval '1 minute' where id = :'pend4';
set local role service_role;
select tests.ok(public.merchant_item_photo_confirm(:'pend4', array[:'owner_a']::uuid[])
  = jsonb_build_object('status', 'expired', 'lang', 'arabizi', 'path', :'path4'),
  'a tap after the wait records nothing and names the file to delete');
reset role;
select tests.ok((select storage_path = :'path3' from public.menu_item_photos where item_id = :'kn')
  and not exists (select 1 from app_private.merchant_item_photo_pending where id = :'pend4'), 'the item keeps its photo');
set local role service_role;
select public.merchant_item_photo_path(:'owner_a', :'kn', 'webp') as w5 \gset
select (:'w5'::jsonb ->> 'pending_id') as pend5, (:'w5'::jsonb ->> 'path') as path5 \gset
select public.merchant_item_photo_pending(:'owner_a', :'pend5', :'kn', :'path5', repeat('e', 64), 800, 800, 70000, 'en');
reset role;
update app_private.merchant_item_photo_pending set expires_at = now() - interval '1 minute' where id = :'pend5';
set local role service_role;
select tests.ok(public.merchant_item_photo_pending_expired(20) = array[:'path5'],
  'a photo nobody tapped in time is cleared, its file named for deletion');
select tests.ok(public.merchant_item_photo_pending_expired(20) = '{}'::text[], 'once');
reset role;
-- A shop that became a demo shop, or an item removed, while the photo waited: the tap records nothing.
set local role service_role;
select public.merchant_item_photo_path(:'owner_a', :'kn', 'jpg') as w6 \gset
select (:'w6'::jsonb ->> 'pending_id') as pend6, (:'w6'::jsonb ->> 'path') as path6 \gset
select public.merchant_item_photo_pending(:'owner_a', :'pend6', :'kn', :'path6', repeat('f', 64), 800, 800, 70000, 'en');
reset role;
savepoint demo;
insert into public.app_config (key, value, effective_from, note)
values ('demo_shops', jsonb_build_array(jsonb_build_object('id', :'va', 'name', 'Vendor A')), now() - interval '1 second', 'test');
select tests.ok(public.merchant_item_photo_path(:'owner_a', :'kn', 'jpg') ->> 'status' = 'demo_shop'
  and public.merchant_item_photo_confirm(:'pend6', array[:'owner_a']::uuid[]) = jsonb_build_object('status', 'demo_shop', 'lang', 'en', 'path', :'path6'),
  'a demo shop''s photos come from the demo pipeline, never from a chat');
rollback to savepoint demo;
update public.menu_items set removed_at = now() where id = :'kn';
select tests.ok(public.merchant_item_photo_path(:'owner_a', :'kn', 'jpg') ->> 'status' = 'no_item'
  and public.merchant_item_photo_confirm(:'pend6', array[:'owner_a']::uuid[]) ->> 'status' = 'no_item',
  'an item removed from the menu takes no photo');

-- 6. Access ------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws($$select * from public.catalog_rules$$, 'permission denied', 'clients cannot read the rules');
select tests.throws($$select * from public.catalog_item_holds$$, 'permission denied', 'or the holds');
select tests.throws($$select public.catalog_hold_record('20000000-0000-0000-0000-00000000000a', '[]')$$, 'permission denied',
  'or record holds');
select tests.throws($$select public.merchant_item_photo_confirm(null, null)$$, 'permission denied', 'or confirm a photo');
select tests.throws($$select public.merchant_item_photo_pending(null, null, null, null, null, null, null, null, null)$$,
  'permission denied', 'or record one');
select tests.throws($$select public.merchant_item_photo_pending_expired(1)$$, 'permission denied', 'or sweep them');
select tests.throws($$select public.menu_item_photo_measure(null, null, null, null, null)$$, 'permission denied', 'or measure one');
reset role;
set local role anon;
select tests.act_as(null);
select tests.throws($$select * from public.catalog_rules$$, 'permission denied', 'nor can anonymous visitors');
reset role;
set local role service_role;
select tests.ok((select count(*) from public.catalog_rules) >= 19, 'the service role (dispatch, the review session) reads them');
reset role;

-- A new file without its size loses the old size (review): never judged by the previous file's measure.
update public.menu_item_photos set width = 1000, height = 1000, bytes = 90000 where item_id = :'kn';
update public.menu_item_photos set storage_path = 'merchant/' || vendor_id || '/' || gen_random_uuid() || '.jpg', origin_hash = repeat('a', 64) where item_id = :'kn';
select tests.ok((select width is null and height is null and bytes is null from public.menu_item_photos where item_id = :'kn'),
  'a photo replaced without a size is unmeasured, not stale');
update public.menu_item_photos set storage_path = 'merchant/' || vendor_id || '/' || gen_random_uuid() || '.jpg', origin_hash = repeat('b', 64), width = 800, height = 600,
  bytes = 70000 where item_id = :'kn';
select tests.ok((select width = 800 and height = 600 and bytes = 70000 from public.menu_item_photos where item_id = :'kn'),
  'a photo replaced with its size keeps the new size');

rollback;
