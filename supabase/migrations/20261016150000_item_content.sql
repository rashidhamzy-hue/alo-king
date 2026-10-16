-- Session 5f (DECISIONS §39.15.2, spec §2 items 2-3, §5): what a customer reads about an item in WhatsApp's catalogue.
-- On 16 October titles mixed two languages and ALL CAPS ("Sujuk & Cheese Platter · صحن سجق جبنة", "HOT DOG"), the
-- description was a photo credit, the link was our Supabase image URL and the shop was never named.
--
-- catalog_desired now hands the sync the parts (names in each language, the menu's text, the shop and its village, the
-- dish library's estimated nutrition and main ingredients, the allergens the merchant declared, options, weight, whether
-- the photo is an illustration) and the item's public page as `link` once the site has an address; the words are built
-- in one place (supabase/functions/_shared/item-text.ts): "<Item> · <Shop>" in Title Case and the decided description
-- lines. A photo credit moves to the item page and /credits when the item has a page; until then a CC BY photo keeps
-- its credit at the end of the description. `brand` is the shop. The whole catalogue is queued for a forced re-sync.

-- No address row yet: it is added once the public site answers 200 without a login (§39.15.7; owner issue #214). Until
-- then every link is null, the image route stands in for Meta, and a CC BY photo keeps its credit in the description.
-- The site address (config public_site_url), without a trailing slash; null when unset or not https.
create function app_private.public_site_url() returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when v ~ '^https://[a-z0-9.-]+(:[0-9]+)?$' then v end
  from (select rtrim(public.config_value('public_site_url') #>> '{}', '/') as v) x;
$$;
revoke all on function app_private.public_site_url() from public, anon, authenticated;

-- The dish library's main ingredients for an item, by weight, in plain words ("beef", "burger bun"); cooking oil, salt
-- and water are left out (not what a customer means by "made with"); tuna in oil and boiled potato stay.
create function app_private.item_usual_ingredients(p_dish_id text, p_limit integer default 5) returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(w order by g desc), '{}') from (
    select lower(btrim(split_part(regexp_replace(coalesce(n.name_en, replace(r.key, '_', ' ')), '\s*\(.*\)', '', 'g'), ',', 1))) as w,
      max((r.value #>> '{}')::numeric) as g
    from public.dish_library d
    cross join lateral jsonb_each(case when jsonb_typeof(d.recipe) = 'object' then d.recipe else '{}' end) r
    left join public.nutrition_ingredients n on n.id = r.key
    where d.id = p_dish_id and (r.value #>> '{}') ~ '^[0-9.]+$'
      and r.key not in ('olive_oil', 'vegetable_oil', 'salt', 'water')
    group by 1
    order by g desc
    limit greatest(coalesce(p_limit, 5), 1)
  ) x where w <> '';
$$;
revoke all on function app_private.item_usual_ingredients(text, integer) from public, anon, authenticated;

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
      'link', case when cfg.site is not null then cfg.site || '/en/i/' || i.id end,
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
  -- offset 0 keeps the subquery from being flattened: the address is read once per call, not twice per product.
  cross join (select app_private.public_site_url() as site offset 0) cfg
  join public.vendors v on v.id = i.vendor_id
  join public.menu_item_photos p on p.item_id = i.id
  left join public.menu_sections s on s.id = i.section_id
  left join public.places pl on pl.id = v.town_id
  left join public.menu_item_nutrition nu on nu.item_id = i.id
  where i.vendor_id = p_vendor_id and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active';
$$;

-- Every shop's products get the new titles and descriptions (DECISIONS §39.15.2: the demo catalogue is re-synced). The
-- deploy applies migrations before it deploys the functions, so the queue waits 15 minutes: the old dispatch must not
-- send the old words once more first (Meta would review every product twice).
select app_private.catalog_enqueue_all(true, 'item content (session 5f)');
update app_private.catalog_sync_queue set next_at = greatest(next_at, now() + interval '15 minutes')
where reason = 'item content (session 5f)';
