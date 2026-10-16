-- Rollback of 20261016200000_catalog_rules.sql: no catalogue rules, no learning loop, no holds, no merchant item photos by
-- WhatsApp. catalog_item_shown, catalog_desired and catalog_status_report return to their definitions in
-- 20261016140000_catalogue_truth.sql and 20261016160000_item_pages.sql. Redeploy the dispatch function from before
-- session 5f part 9 together with it (that one sends every product without the validator and has no photo route).
-- What is lost: the learned rules and their counts (Meta's errors stay in catalog_item_status, so the review session can
-- read them there), the holds (the next sync sends what was held), the measured photo sizes and the photos still waiting
-- for a merchant's tap. A merchant's photo already confirmed stays the item's photo (source merchant is a valid row before
-- this migration too). The config row merchant_photo_pending_hours stays (config rows are dated, never deleted).
select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'rollback: catalogue rules (session 5f part 9)', true);

drop trigger catalog_item_status_learn_insert on public.catalog_item_status;
drop trigger catalog_item_status_learn_update on public.catalog_item_status;
drop function app_private.catalog_rules_learn();
drop function app_private.catalog_error_key(jsonb);
drop function public.catalog_hold_record(uuid, jsonb);
drop function public.menu_item_photo_measure(uuid, text, integer, integer, integer);
drop function public.merchant_item_photo_pending_expired(integer);
drop function public.merchant_item_photo_confirm(uuid, uuid[]);
drop function public.merchant_item_photo_pending(uuid, uuid, uuid, text, text, integer, integer, integer, text);
drop function public.merchant_item_photo_path(uuid, uuid, text);
drop function app_private.merchant_item_photo_check(uuid, uuid);
-- Photos still waiting for a tap are dropped with their table; their files stay in the bucket (delete them through the
-- Storage API: select storage_path from app_private.merchant_item_photo_pending, before running this file).
drop table app_private.merchant_item_photo_pending;

-- As in 20261016140000_catalogue_truth.sql.
create or replace function app_private.catalog_item_shown(p_item_id uuid, p_catalog_id text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_catalog_id = 'sim' or exists (
    select 1 from public.catalog_sync_items c
    join public.catalog_item_status s on s.item_id = c.item_id
    where c.item_id = p_item_id and c.visible and c.catalog_id = p_catalog_id and s.catalog_id = p_catalog_id
      and s.meta_status = 'approved' and coalesce(s.visibility, 'published') = 'published'
      and coalesce(s.availability, 'in stock') = 'in stock');
$$;

drop function public.catalog_status_report(text);
create function public.catalog_status_report(p_catalog_id text default null)
returns table (vendor_id uuid, shop text, items bigint, with_photo bigint, synced bigint, approved bigint, pending bigint,
  rejected bigint, missing bigint, unknown bigint, top_error text)
language sql
stable
security definer
set search_path = ''
as $$
  with cat as (
    select coalesce(p_catalog_id, (select c.catalog_id from public.whatsapp_catalogs c where c.transport is not null
      order by c.checked_at desc limit 1)) as id
  )
  select v.id, coalesce(v.name_en, v.name_ar),
    count(*) filter (where app_private.menu_item_orderable(i.id, 1)),
    count(p.item_id),
    count(c.item_id) filter (where c.visible),
    count(*) filter (where c.visible and s.meta_status = 'approved' and coalesce(s.visibility, 'published') = 'published'
      and coalesce(s.availability, 'in stock') = 'in stock'),
    count(*) filter (where c.visible and s.meta_status in ('', 'pending', 'outdated')),
    count(*) filter (where c.visible and s.meta_status = 'rejected'),
    count(*) filter (where c.visible and s.meta_status = 'missing'),
    count(*) filter (where c.visible and s.item_id is null),
    (select e ->> 'title' from public.catalog_item_status s2 cross join jsonb_array_elements(s2.errors) e
      where s2.vendor_id = v.id group by e ->> 'title' order by count(*) desc limit 1)
  from public.vendors v
  cross join cat
  join public.menu_items i on i.vendor_id = v.id
  left join public.menu_item_photos p on p.item_id = i.id
  left join public.catalog_sync_items c on c.item_id = i.id and c.catalog_id = cat.id
  left join public.catalog_item_status s on s.item_id = i.id and s.catalog_id = cat.id
  where v.claim_status = 'claimed' and v.orderable and not v.is_test
  group by v.id, v.name_en, v.name_ar
  order by coalesce(v.name_en, v.name_ar);
$$;
revoke all on function public.catalog_status_report(text) from public, anon, authenticated;
grant execute on function public.catalog_status_report(text) to service_role;

-- As in 20261016160000_item_pages.sql.
create or replace function public.catalog_desired(p_vendor_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'retailer_id', i.id,
      -- The sync turns these parts into the title and the description (item-text.ts); 'name' and 'description' are what
      -- an older dispatch would show meanwhile.
      'name', left(coalesce(i.name_en, i.name_fr, i.name_ar), 150),
      'description', left(coalesce(nullif(i.description, ''), coalesce(i.name_en, i.name_ar)), 500),
      'name_en', i.name_en,
      'name_ar', i.name_ar,
      'name_fr', i.name_fr,
      'menu_text', nullif(btrim(i.description), ''),
      'shop_en', v.name_en,
      'shop_ar', v.name_ar,
      'village_en', pl.name_en,
      'village_ar', pl.name_ar,
      'kcal', case when nu.status in ('merchant_verified', 'estimated') then round(nu.kcal) end,
      'protein_g', case when nu.status in ('merchant_verified', 'estimated') then round(nu.protein_g, 1) end,
      'allergens_declared', case when i.allergens_confirmed_at is not null then to_jsonb(coalesce(i.allergens, '{}')) end,
      'usually', case when nu.dish_id is not null then to_jsonb(app_private.item_usual_ingredients(nu.dish_id)) end,
      'weight_kg', case when i.pricing_unit = 'kg' then i.est_weight_kg end,
      'illustrative', p.source = 'illustrative',
      'link', case when cfg.site is not null and cfg.page then cfg.site || '/en/i/' || i.id end,
      -- While the item has no page, a CC BY photo's credit stays in the description (the page credits it later).
      'photo_credit', case when p.license ~* '^CC BY' then left(regexp_replace(p.credit, '\s+', ' ', 'g'), 80) || ' · ' || p.license end,
      'price_minor', round(case when i.pricing_unit = 'kg' then i.price_usd * i.est_weight_kg else i.price_usd end * 100)::int,
      'currency', 'USD',
      'availability', case when app_private.menu_item_orderable(i.id, 1) then 'in stock' else 'out of stock' end,
      'product_set', v.id,
      'brand', left(coalesce(v.name_en, v.name_ar), 100),
      'has_options', exists (select 1 from public.menu_option_groups g where g.item_id = i.id),
      'section', coalesce(s.name_ar, s.name_en, 'Menu'),
      'section_en', coalesce(s.name_en, s.name_ar, 'Menu'),
      'photo', p.storage_path,
      'photo_hash', p.origin_hash)
    order by s.sort_order nulls last, i.sort_order, i.id), '[]')
  from public.menu_items i
  -- offset 0 keeps the subquery from being flattened: the address and the shop's page rule are read once per call, not
  -- once per product.
  cross join (select app_private.public_site_url() as site, app_private.item_page_visible(p_vendor_id) as page offset 0) cfg
  join public.vendors v on v.id = i.vendor_id
  join public.menu_item_photos p on p.item_id = i.id
  left join public.menu_sections s on s.id = i.section_id
  left join public.places pl on pl.id = v.town_id
  left join public.menu_item_nutrition nu on nu.item_id = i.id
  -- A removed item is never shown (menu_items.removed_at): it leaves the desired set, so the sync hides it at Meta.
  where i.vendor_id = p_vendor_id and i.removed_at is null and v.claim_status = 'claimed' and v.orderable
    and v.listing_status = 'active';
$$;

drop table public.catalog_item_holds;
drop table public.catalog_rules;
drop trigger menu_item_photos_size_reset on public.menu_item_photos;
drop function app_private.menu_item_photos_size_reset();
alter table public.menu_item_photos drop column width, drop column height, drop column bytes;
