
create or replace function public.bot_search_menu(
  p_terms text[] default null,
  p_village text default null,
  p_vegan boolean default null,
  p_gluten_free boolean default null,
  p_keto boolean default null,
  p_max_calories int default null,
  p_min_protein numeric default null,
  p_max_price_usd numeric default null,
  p_vendor_id text default null,
  p_demo boolean default true,
  p_limit int default 12
) returns table (
  item_id text, item_name_en text, item_name_ar text, section text, price_usd numeric,
  calories int, protein_grams numeric, carbs_grams numeric, fat_grams numeric,
  is_vegan boolean, is_gluten_free boolean, is_keto boolean, allergens text,
  vendor_id text, vendor_name text, vendor_name_ar text, village text, category text, score int
) language sql stable security definer set search_path = public as $$
  select m.item_id, m.item_name_en, m.item_name_ar, m.section, m.price_usd,
         m.calories, m.protein_grams, m.carbs_grams, m.fat_grams,
         m.is_vegan, m.is_gluten_free, m.is_keto, m.allergens,
         v.vendor_id, v.name_en, v.name_ar, v.village_canonical, v.category_canonical,
         coalesce((select count(*)::int from unnest(p_terms) t
                   where m.item_name_en ilike '%'||t||'%' or coalesce(m.item_name_ar,'') ilike '%'||t||'%'
                      or coalesce(m.section,'') ilike '%'||t||'%' or v.name_en ilike '%'||t||'%'
                      or coalesce(v.name_ar,'') ilike '%'||t||'%'), 0) as score
  from public.menu_items m
  join public.vendors v on v.vendor_id = m.vendor_id
  where m.available and v.is_active and (p_demo or v.is_live)
    and (p_vendor_id is null or v.vendor_id = p_vendor_id)
    and (p_village is null or v.village_canonical ilike p_village)
    and (p_vegan is null or m.is_vegan = p_vegan)
    and (p_gluten_free is null or m.is_gluten_free = p_gluten_free)
    and (p_keto is null or m.is_keto = p_keto)
    and (p_max_calories is null or m.calories <= p_max_calories)
    and (p_min_protein is null or m.protein_grams >= p_min_protein)
    and (p_max_price_usd is null or m.price_usd <= p_max_price_usd)
    and (p_terms is null or cardinality(p_terms) = 0 or exists (
          select 1 from unnest(p_terms) t
          where m.item_name_en ilike '%'||t||'%' or coalesce(m.item_name_ar,'') ilike '%'||t||'%'
             or coalesce(m.section,'') ilike '%'||t||'%' or v.name_en ilike '%'||t||'%'
             or coalesce(v.name_ar,'') ilike '%'||t||'%'))
  order by score desc, m.price_usd asc nulls last
  limit least(coalesce(p_limit,12), 25)
$$;
revoke execute on function public.bot_search_menu from public, anon, authenticated;
grant execute on function public.bot_search_menu to service_role;
