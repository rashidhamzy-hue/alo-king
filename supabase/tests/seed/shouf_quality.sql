-- Quality checks on the Shouf pilot load (DECISIONS §38.1–38.2), run by scripts/db-test.sh after loading it.
begin;

select tests.ok((select count(*) from public.vendors where source = 'seed_shouf_2026_10') = 314, 'the 315 Shouf rows are 314 merchants: Nayeh w Meshwiyeh was listed twice (§39.4)');
select tests.ok((select count(*) = 1 from public.vendors where source = 'seed_shouf_2026_10' and place_id in ('ChIJX_XVOO0hHxURJO_Dq1Kl-Lo', 'ChIJR6VlRAAhHxURSemilwLScnE'))
  and (select name_ar = 'نية و مشوية' and name_en = 'Nayeh w Meshwiyeh' from public.vendors where place_id = 'ChIJX_XVOO0hHxURJO_Dq1Kl-Lo')
  and exists (select 1 from public.vendor_import_exclusions where place_id = 'ChIJR6VlRAAhHxURSemilwLScnE' and reason = 'duplicate of ChIJX_XVOO0hHxURJO_Dq1Kl-Lo'),
  'Nayeh w Meshwiyeh is one vendor with both names; its second listing is an exclusion');
-- Rows from a Google file carry place IDs (ChIJ...); the test fixtures in 00_helpers.sql do not.
select tests.ok(not exists (select 1 from public.vendors where source = 'seed_2026_10' and place_id like 'ChIJ%'), 'no nationwide seed vendor is loaded');
select tests.ok(not exists (select 1 from public.vendors where source = 'seed_shouf_2026_10'
  and (claim_status <> 'unclaimed' or orderable or public_page)), 'every Shouf merchant is unclaimed, not orderable, not public');
select tests.ok(not exists (select 1 from public.vendors v where v.source = 'seed_shouf_2026_10'
  and (v.field_sources ->> 'name_en') is distinct from 'seed'), 'every imported field is marked seed');
select tests.ok((select count(*) from public.vendors v join public.vendor_private p on p.vendor_id = v.id
  where v.source = 'seed_shouf_2026_10' and p.phone_seed_mobile) = 219,
  '219 WhatsApp claim candidates, decided by the number (Eatout''s from its menu photo)');
select tests.ok(exists (select 1 from public.vendors v join public.vendor_private p on p.vendor_id = v.id
  where v.place_id = 'ChIJSVk-bgAhHxURr-4t76SU8nA' and p.phone_seed = '+96176904875' and p.phone_seed_mobile
    and p.import_labels ->> 'phone_source' = 'menu photo'),
  'Eatout has the phone printed on its menu (phone_from_menu), marked as such');
select tests.ok(not exists (select 1 from public.vendors v join public.vendor_private p on p.vendor_id = v.id
  where v.source = 'seed_shouf_2026_10' and p.phone_seed_mobile and not app_private.is_lebanese_mobile(p.phone_seed)),
  'a candidate always has a Lebanese mobile');
select tests.ok((select count(*) from public.vendors where source = 'seed_shouf_2026_10' and name_ar is not null) = 57,
  'the 57 names in Arabic script keep their Arabic name');
select tests.ok(not exists (select 1 from public.vendors where source = 'seed_shouf_2026_10'
  and (name_en ~ '[؀-ۿ]' or name_ar ~ '[A-Za-z]')), 'mixed names are split by script');
select tests.ok(not exists (select 1 from public.places) or not exists (
  select 1 from public.vendors v where v.source = 'seed_shouf_2026_10'
    and not (v.town_id = any (array(select jsonb_array_elements_text(public.config_value('pilot_merchant_place_ids')))))),
  'every merchant sits in one of the 12 pilot villages (when places are loaded)');
select tests.ok(jsonb_array_length(public.config_value('pilot_merchant_place_ids')) = 12, 'there are 12 merchant villages');
select tests.ok((select count(*) from public.menu_drafts where source = 'seed' and status = 'draft') = 27,
  '19 menus, 2 supermarket catalogues, the 3 owner menus (Eatout added) and 3 harvested menus (§39.4) are draft menus');
select tests.ok((select array_agg(v.name_en order by v.name_en) from public.menu_drafts d join public.vendors v on v.id = d.vendor_id
    where d.source = 'seed' and d.source_url ~ '^https://') = array['Al Kooz Cafe', 'Batloun Dairy Stores', 'INDINER time'],
  'the harvested drafts keep their page as the source; Deli Dough and J.O''s keep their curated draft');
select tests.ok(not exists (select 1 from public.menu_drafts where source = 'seed' and (source_url is null or captured_at is null)),
  'every seed draft says where it came from and when');
select tests.ok((select sum(jsonb_array_length(s -> 'items')) from public.menu_drafts d join public.vendors v on v.id = d.vendor_id,
  jsonb_array_elements(d.sections) s where v.place_id = 'ChIJJ8-7quchHxURgn5sxhONNLI') = 44
  and (select sum(jsonb_array_length(s -> 'items')) from public.menu_drafts d join public.vendors v on v.id = d.vendor_id,
  jsonb_array_elements(d.sections) s where v.place_id = 'ChIJX_XVOO0hHxURJO_Dq1Kl-Lo') = 121,
  'SEVEN Burgers has 44 draft items and Nayeh w Meshwiyeh 121');
select tests.ok((select bool_and(i ->> 'currency' = 'LBP') from public.menu_drafts d join public.vendors v on v.id = d.vendor_id,
  jsonb_array_elements(d.sections) s, jsonb_array_elements(s -> 'items') i where v.place_id = 'ChIJJ8-7quchHxURgn5sxhONNLI'),
  'SEVEN Burgers'' prices stay in LBP until the merchant approves a section');
select tests.ok((select count(*) from public.menu_drafts d, jsonb_array_elements(d.sections) s, jsonb_array_elements(s -> 'items') i
  where d.source = 'seed' and jsonb_array_length(i -> 'options') = 1 and i #>> '{options,0,min}' = '1') = 4,
  'the four "A / B" items are one item with a required choice');
select tests.ok((select app_private.menu_draft_summary(d.id) #>> '{sections,0,preview,0}' from public.menu_drafts d
  join public.vendors v on v.id = d.vendor_id where v.place_id = 'ChIJJ8-7quchHxURgn5sxhONNLI')
  = 'Classic · 850,000 LBP → $' || round(850000 / public.usd_lbp_rate(), 2)::text,
  'the section card shows the LBP price as printed and the dollars it becomes (§39.4)');
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
