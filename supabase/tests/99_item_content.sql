-- Session 5f (DECISIONS §39.15.2, spec §2 items 2-3): catalog_desired hands the sync the parts of each item's title and
-- description, the item's public page as its link and the shop as its brand; no credit, allergens only when declared.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-IC', 'CHF', 'Item content zone', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-IC', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test');
select set_config('app.fixture_owner_phone', '+96170000171', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
update public.vendors set town_id = 'LB-CHF-BAAKLINE' where id = :'tv';
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Falafel Sandwich') as falafel \gset
update public.menu_items set name_en = 'FALAFEL SANDWICH', description = null, allergens = '{sesame,gluten}', allergens_confirmed_at = null
where id = :'falafel';
insert into public.menu_item_photos (item_id, vendor_id, storage_path, source, origin_hash, license, credit)
values (:'falafel', :'tv', 'illustrative/' || :'tv' || '/' || :'falafel' || '.jpg', 'illustrative', repeat('b', 64), 'CC BY 2.0', 'insatiablemunch via Openverse');
insert into public.dish_library (id, name_ar, name_en, name_fr, category, unit, portion_g, recipe) values ('ic_falafel_sandwich', 'سندويش فلافل', 'Falafel sandwich', 'Sandwich falafel', 'sandwich', 'piece', '{"default": 250}',
  '{"pita_bread": 80, "chickpeas_cooked": 80, "vegetable_oil": 14, "tahini": 20, "tomato": 20, "salt": 1}')
on conflict (id) do update set recipe = excluded.recipe;
insert into public.menu_item_nutrition (item_id, vendor_id, dish_id, kcal, protein_g, value_sources, status, assumptions, may_contain)
values (:'falafel', :'tv', 'ic_falafel_sandwich', 523.4, 17.26, '{}', 'estimated', '{}', '{}');

-- No site address yet (until the public site answers, §39.15.7): no link, and the CC BY photo keeps its credit.
select (select x from jsonb_array_elements(public.catalog_desired(:'tv')) x where x ->> 'retailer_id' = :'falafel') as d0 \gset
select tests.ok(:'d0'::jsonb ->> 'link' is null and :'d0'::jsonb ->> 'photo_credit' = 'insatiablemunch via Openverse · CC BY 2.0',
  'without a site address: no link, and the CC BY credit is handed over for the description');
insert into public.app_config (key, value, effective_from, note)
values ('public_site_url', '"https://alo-king.vercel.app"', now() - interval '1 minute', 'test');
select (select x from jsonb_array_elements(public.catalog_desired(:'tv')) x where x ->> 'retailer_id' = :'falafel') as d \gset
select tests.ok(:'d'::jsonb ->> 'link' = 'https://alo-king.vercel.app/en/i/' || :'falafel',
  'the link is the item''s public page (public_site_url), never an image or storage URL');
select tests.ok(:'d'::jsonb ->> 'brand' = 'Alo Test Grill' and :'d'::jsonb ->> 'shop_en' = 'Alo Test Grill'
  and :'d'::jsonb ->> 'village_en' = 'Baakline', 'brand is the shop; the description names the shop and its village');
select tests.ok(:'d'::jsonb ->> 'name_en' = 'FALAFEL SANDWICH' and :'d'::jsonb ->> 'name_ar' is not null,
  'the names come in each language (the sync makes the one-language Title Case title)');
select tests.ok((:'d'::jsonb ->> 'kcal')::numeric = 523 and (:'d'::jsonb ->> 'protein_g')::numeric = 17.3,
  'estimated energy and protein from the dish library');
select tests.ok(:'d'::jsonb -> 'usually' = '["pita / arabic bread", "chickpeas", "tahini", "tomato"]'::jsonb
    or (:'d'::jsonb -> 'usually') ?& array['chickpeas', 'tahini', 'tomato'],
  '"Usually made with" the main ingredients by weight, without oil or salt');
select tests.ok(not ((:'d'::jsonb -> 'usually') ? 'vegetable oil'), 'oil is not an ingredient a customer means');
-- Tuna in oil and boiled potato are what the dish is made of (the filter names cooking oil, salt and water exactly).
insert into public.dish_library (id, name_ar, name_en, name_fr, category, unit, portion_g, recipe) values ('ic_tuna_sandwich',
  'سندويش تونا', 'Tuna sandwich', 'Sandwich thon', 'sandwich', 'piece', '{"default": 220}',
  '{"tuna_oil_drained": 70, "potato_boiled": 60, "tomato": 20, "olive_oil": 10, "salt": 1}')
on conflict (id) do update set recipe = excluded.recipe;
select tests.ok(array_length(app_private.item_usual_ingredients('ic_tuna_sandwich'), 1) = 3
  and not ('olive oil' = any (app_private.item_usual_ingredients('ic_tuna_sandwich'))),
  'tuna and potato stay in "Usually made with"; olive oil and salt do not');
select tests.ok(:'d'::jsonb -> 'allergens_declared' = 'null'::jsonb, 'allergens the merchant has not declared are never said');
update public.menu_items set allergens_confirmed_at = now() where id = :'falafel';
select tests.ok((select x -> 'allergens_declared' from jsonb_array_elements(public.catalog_desired(:'tv')) x
  where x ->> 'retailer_id' = :'falafel') ?& array['sesame', 'gluten'], 'declared allergens are given');
select tests.ok((:'d'::jsonb ->> 'illustrative')::boolean, 'an illustrative photo is flagged for its "Photo for illustration" line');
select tests.ok(:'d'::jsonb ->> 'description' !~ '(📷|CC BY|Openverse)', 'the old description field carries no credit (the sync builds the text; a CC BY credit only until the item has a page)');

-- Without a site address there is no link (the image route stands in, never shown as the item's page).
insert into public.app_config (key, value, effective_from, note) values ('public_site_url', '"not a url"', now(), 'test');
select tests.ok((select x ->> 'link' from jsonb_array_elements(public.catalog_desired(:'tv')) x
  where x ->> 'retailer_id' = :'falafel') is null, 'a public_site_url that is not https gives no link');

rollback;
