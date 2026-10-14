-- Session F (DECISIONS §39.4 source 3, §39.5): seed photo classes load onto the photos by origin hash; the Open Food
-- Facts cache keeps only our allergens, is reused while fresh, and is closed to anonymous and customer callers.
begin;

-- Open Food Facts cache ----------------------------------------------------------------------------------------------
select public.off_product_put('{"barcode": "4006381333931", "found": true, "name": "Labneh", "brand": "Taanayel",
  "quantity": "500 g", "allergens": ["dairy", "not-an-allergen"], "nutriscore_grade": "c", "energy_kcal_100g": 180}');
select tests.ok((select allergens = '{dairy}' and license = 'ODbL-1.0' and attribution like 'Open Food Facts%'
  from public.off_products where barcode = '4006381333931'), 'the cache keeps our allergens only, with the ODbL attribution');
select tests.ok(public.off_product_get('4006381333931') ->> 'name' = 'Labneh'
  and not (public.off_product_get('4006381333931') ? 'license'), 'a fresh answer is reused');
select public.off_product_put('{"barcode": "4006381333931", "found": false}');
select tests.ok((select not found and name is null from public.off_products where barcode = '4006381333931'), 'a new answer replaces the old one');
update public.off_products set fetched_at = now() - interval '31 days' where barcode = '4006381333931';
select tests.ok(public.off_product_get('4006381333931') is null, 'after off_cache_days the caller asks OFF again');
select tests.throws($$select public.off_product_put('{"barcode": "12ab", "found": false}')$$, 'off_products_barcode_check',
  'a barcode that is not 8 or 12-14 digits is refused');
set local role anon;
select tests.throws($$select * from public.off_products$$, 'permission denied', 'anonymous visitors cannot read the cache');
select tests.throws($$select public.off_product_get('4006381333931')$$, 'permission denied', 'nor call the lookup');
reset role;

-- Seed photo classes --------------------------------------------------------------------------------------------------
insert into public.vendors (place_id, slug, name_en, business_type, source, location)
values ('ChIJphotoTest1', 'photo-test-1', 'Photo Test', 'restaurant', 'seed_shouf_2026_10', 'SRID=4326;POINT(35.56 33.67)');
select id as pv from public.vendors where place_id = 'ChIJphotoTest1' \gset
insert into public.vendor_photos (vendor_id, storage_path, source, origin_hash) values
  (:'pv', 'seed/' || :'pv' || '/' || repeat('a', 32) || '.jpg', 'seed', repeat('a', 64)),
  (:'pv', 'seed/' || :'pv' || '/' || repeat('b', 32) || '.jpg', 'seed', repeat('b', 64));
insert into app_private.seed_photo_classes values
  (repeat('a', 64), 'ChIJphotoTest1', 'menu', 0.93, 'claude-haiku-5-5', '2026-10-14'),
  (repeat('b', 64), 'ChIJphotoTest1', 'food', 0.88, 'claude-haiku-5-5', '2026-10-14'),
  (repeat('c', 64), 'ChIJphotoTest1', 'menu', 0.99, 'claude-haiku-5-5', '2026-10-14');
select tests.ok((app_private.photo_classes_load('cafe') ->> 'updated')::int = 2, 'two photos get their class (an unknown hash is ignored)');
select tests.ok((select content_kind = 'menu' and content_confidence = 0.93 and content_model = 'claude-haiku-5-5'
  from public.vendor_photos where origin_hash = repeat('a', 64)), 'the menu photo is marked menu');
select tests.ok((app_private.photo_classes_load('cafe') ->> 'updated')::int = 0, 'loading the same classes again changes nothing');
select tests.ok(public.config_value('ai_photo_classify_model') #>> '{}' = 'claude-haiku-5-5', 'the photo model is config');

rollback;
