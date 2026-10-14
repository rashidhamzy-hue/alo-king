-- Quality checks on the Shouf pilot load (DECISIONS §38.1–38.2), run by scripts/db-test.sh after loading it.
begin;

select tests.ok((select count(*) from public.vendors where source = 'seed_shouf_2026_10') = 315, 'all 315 Shouf merchants are imported');
-- Rows from a Google file carry place IDs (ChIJ...); the test fixtures in 00_helpers.sql do not.
select tests.ok(not exists (select 1 from public.vendors where source = 'seed_2026_10' and place_id like 'ChIJ%'), 'no nationwide seed vendor is loaded');
select tests.ok(not exists (select 1 from public.vendors where source = 'seed_shouf_2026_10'
  and (claim_status <> 'unclaimed' or orderable or public_page)), 'every Shouf merchant is unclaimed, not orderable, not public');
select tests.ok(not exists (select 1 from public.vendors v where v.source = 'seed_shouf_2026_10'
  and (v.field_sources ->> 'name_en') is distinct from 'seed'), 'every imported field is marked seed');
select tests.ok((select count(*) from public.vendors v join public.vendor_private p on p.vendor_id = v.id
  where v.source = 'seed_shouf_2026_10' and p.phone_seed_mobile) = 218, '218 WhatsApp claim candidates, decided by the number');
select tests.ok(not exists (select 1 from public.vendors v join public.vendor_private p on p.vendor_id = v.id
  where v.source = 'seed_shouf_2026_10' and p.phone_seed_mobile and not app_private.is_lebanese_mobile(p.phone_seed)),
  'a candidate always has a Lebanese mobile');
select tests.ok((select count(*) from public.vendors where source = 'seed_shouf_2026_10' and name_ar is not null) = 57,
  'the 57 names in Arabic script keep their Arabic name');
select tests.ok(not exists (select 1 from public.vendors where source = 'seed_shouf_2026_10'
  and (name_en ~ '[؀-ۿ]' or name_ar ~ '[A-Za-z]')), 'mixed names are split by script');
select tests.ok(not exists (select 1 from public.places) or not exists (
  select 1 from public.vendors v where v.source = 'seed_shouf_2026_10'
    and not (v.town_id = any (array(select jsonb_array_elements_text(public.config_value('pilot_place_ids')))))),
  'every merchant sits in one of the 12 pilot villages (when places are loaded)');
select tests.ok(not exists (select 1 from public.places) or (select count(*) from public.places
  where service_status = 'on' and id <> 'LB-TST-LOCATION') = 12, 'exactly the 12 pilot villages are switched on');
select tests.ok((select count(*) from public.menu_drafts where source = 'seed' and status = 'draft') = 21,
  '19 menus and 2 supermarket catalogues are draft menus');
select tests.ok(not exists (select 1 from public.menu_items i join public.vendors v on v.id = i.vendor_id
  where v.source = 'seed_shouf_2026_10'), 'no seed menu item reaches a menu before the merchant approves it');
select tests.ok((select count(*) from public.vendors where source = 'seed_shouf_2026_10' and business_type = 'grocery_supermarket'
  and exists (select 1 from public.menu_drafts d where d.vendor_id = vendors.id and d.source = 'seed'
              and jsonb_array_length(d.sections) = 7)) = 2, 'the two catalogue shops are supermarkets with 7 sections');
select tests.ok((select sum(jsonb_array_length(s -> 'items')) from public.menu_drafts d join public.vendors v on v.id = d.vendor_id,
  jsonb_array_elements(d.sections) s where v.slug like 'fred-s-food%') = 63, 'Fred''s Food has its 63 draft items');
select tests.ok(not exists (select 1 from information_schema.columns where table_schema = 'public'
  and column_name ~ '(rating|review)'), 'no rating or review column exists anywhere');
select tests.ok(not exists (select 1 from public.vendor_links where url ~ '^https://[0-9.]+/' and status <> 'unchecked'),
  'a raw-IP website stays unchecked (never shown)');

-- A second load of the same files changes nothing.
select tests.ok((select (counts ->> 'vendors_new')::int from app_private.seed_loads where name = 'vendors_shouf') >= 0, 'the load is recorded');

rollback;
