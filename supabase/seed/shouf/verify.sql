-- Session D verification output (DECISIONS §38.2 item 7). Read-only; run against staging after the deploy.
-- 1. Merchants per village.
select p.name_en as village, count(*) as merchants,
  count(*) filter (where vp.phone_seed_mobile) as whatsapp_candidates
from public.vendors v
join public.places p on p.id = v.town_id
left join public.vendor_private vp on vp.vendor_id = v.id
where v.source = 'seed_shouf_2026_10'
group by p.name_en order by merchants desc;

-- 2. Draft items for ROUTE 66, Un basilico and Fred's Food; 3. SKUs for Coop Baakleen.
select coalesce(v.name_en, v.name_ar) as merchant, d.status, d.source, count(*) as draft_items,
  count(*) filter (where jsonb_typeof(i -> 'price') = 'number') as priced,
  count(*) filter (where i ? 'sku') as skus
from public.menu_drafts d
join public.vendors v on v.id = d.vendor_id
cross join lateral jsonb_array_elements(d.sections) s
cross join lateral jsonb_array_elements(s -> 'items') i
where d.source = 'seed' and v.place_id in ('ChIJWZ-idEUhHxURPnKWXUD8diQ', 'ChIJL496ClghHxURB5WPYlPLRS0',
  'ChIJE9BeY7MhHxURyekGJ41v65s', 'ChIJhaAhhQMgHxURbFIi9R14X1I')
group by 1, 2, 3 order by 1;

-- 4. Totals.
select (select count(*) from public.vendors where source = 'seed_shouf_2026_10') as shouf_merchants,
  (select count(*) from public.vendors where source = 'seed_2026_10') as nationwide_left,
  (select count(*) from public.vendors where source ~ '^seed' and (orderable or public_page or claim_status <> 'unclaimed')) as seed_orderable_or_public,
  (select count(*) from public.menu_drafts where source = 'seed') as seed_drafts,
  (select count(*) from public.places where service_status = 'on') as places_on,
  (select count(*) from public.landmarks where source = 'osm') as osm_landmarks,
  (select count(*) from public.place_aliases where source = 'osm') as osm_aliases,
  (select count(*) from public.vendor_photos where source = 'seed') as seed_photos,
  (select count(*) from public.vendor_photos where source = 'seed' and status = 'confirmed') as seed_photos_shown;
