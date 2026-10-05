
-- ===== helper: can this session manage that vendor? =====
create or replace function public.can_manage_vendor(p_vendor text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin' or (public.my_role() = 'merchant' and public.my_vendor() = p_vendor), false)
$$;
revoke execute on function public.can_manage_vendor(text) from public, anon;
grant execute on function public.can_manage_vendor(text) to authenticated;

-- ===== vendors: shareable slug =====
alter table public.vendors add column if not exists slug text generated always as (
  trim(both '-' from lower(regexp_replace(coalesce(name_en,'') || '-' || vendor_id, '[^a-zA-Z0-9]+', '-', 'g')))) stored;
create index if not exists vendors_slug_idx on public.vendors(slug);
grant select (slug) on public.vendors to anon, authenticated;
grant update (name_ar, address, latitude, longitude) on public.vendors to authenticated;
create policy "owner updates own vendor basics" on public.vendors for update to authenticated
  using (public.can_manage_vendor(vendor_id)) with check (public.can_manage_vendor(vendor_id));

-- ===== public business profile (everything the AI + public page may show) =====
create table if not exists public.vendor_profiles (
  vendor_id text primary key references public.vendors(vendor_id) on delete cascade,
  claimed_at timestamptz,
  claimed_by uuid references auth.users(id),
  tagline_en text, tagline_ar text,
  description_en text, description_ar text, story text,
  cuisine_tags text[] not null default '{}',
  features text[] not null default '{}',
  price_tier smallint check (price_tier between 1 and 4),
  established_year int check (established_year between 1800 and 2100),
  opened_on date,
  logo_url text, cover_url text, gallery_urls text[] not null default '{}',
  public_phone text, whatsapp_orders_number text,
  instagram_url text, facebook_url text, tiktok_url text, website_url text, google_maps_url text,
  hours jsonb,
  closed_dates jsonb not null default '[]',
  accepts_orders boolean not null default true,
  paused_until timestamptz,
  prep_time_min int, prep_time_max int,
  delivery_villages text[] not null default '{}',
  delivery_radius_km numeric,
  min_order_usd numeric,
  accepts_usd boolean not null default true,
  accepts_lbp boolean not null default true,
  halal_certified boolean,
  allergen_policy text, kitchen_notes text,
  languages text[] not null default '{}',
  faqs jsonb not null default '[]',
  ai_instructions text,
  updated_at timestamptz not null default now()
);
alter table public.vendor_profiles enable row level security;
create policy "public reads vendor profiles" on public.vendor_profiles for select to anon, authenticated using (true);
create policy "owner manages vendor profile" on public.vendor_profiles for all to authenticated
  using (public.can_manage_vendor(vendor_id)) with check (public.can_manage_vendor(vendor_id));

-- ===== private owner data (never public) =====
create table if not exists public.vendor_private (
  vendor_id text primary key references public.vendors(vendor_id) on delete cascade,
  owner_name text, owner_phone_urgent text, backup_phone text, owner_email text,
  order_alert_whatsapp text, notes_for_team text,
  updated_at timestamptz not null default now()
);
alter table public.vendor_private enable row level security;
revoke all on public.vendor_private from anon;
create policy "owner manages private data" on public.vendor_private for all to authenticated
  using (public.can_manage_vendor(vendor_id)) with check (public.can_manage_vendor(vendor_id));

-- ===== claims =====
create table if not exists public.vendor_claims (
  id uuid primary key default gen_random_uuid(),
  vendor_id text not null references public.vendors(vendor_id),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_name text, contact_phone text, evidence_note text,
  status text not null default 'pending_review'
    check (status in ('pending_otp','pending_review','approved','rejected','expired')),
  otp_hash text, otp_expires_at timestamptz, attempts int not null default 0,
  created_at timestamptz not null default now(), reviewed_at timestamptz
);
create unique index if not exists vendor_claims_one_open_per_user on public.vendor_claims(user_id) where status in ('pending_otp','pending_review');
create index if not exists vendor_claims_vendor_idx on public.vendor_claims(vendor_id);
alter table public.vendor_claims enable row level security;
revoke all on public.vendor_claims from anon;
revoke insert, update, delete on public.vendor_claims from authenticated;
create policy "user reads own claims" on public.vendor_claims for select to authenticated
  using (user_id = (select auth.uid()) or public.my_role() = 'admin');

create table if not exists public.ai_usage (
  vendor_id text not null, day date not null, calls int not null default 0,
  primary key (vendor_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- ===== detailed menu fields =====
alter table public.menu_items
  add column if not exists description_en text,
  add column if not exists description_ar text,
  add column if not exists ingredients text[] not null default '{}',
  add column if not exists image_url text,
  add column if not exists portion_grams numeric,
  add column if not exists allergen_list text[] not null default '{}',
  add column if not exists allergens_reviewed boolean not null default false,
  add column if not exists is_vegetarian boolean,
  add column if not exists is_dairy_free boolean,
  add column if not exists contains_alcohol boolean not null default false,
  add column if not exists contains_pork boolean not null default false,
  add column if not exists spice_level smallint check (spice_level between 0 and 4),
  add column if not exists prep_time_min int,
  add column if not exists cooking_method text,
  add column if not exists fiber_g numeric,
  add column if not exists saturated_fat_g numeric,
  add column if not exists sodium_mg numeric,
  add column if not exists customizations jsonb not null default '[]',
  add column if not exists tags text[] not null default '{}',
  add column if not exists is_popular boolean not null default false,
  add column if not exists is_chef_pick boolean not null default false,
  add column if not exists available_from time,
  add column if not exists available_to time,
  add column if not exists sort_order int not null default 0,
  add column if not exists ai_notes text,
  add column if not exists nutrition_source text check (nutrition_source in ('merchant','ai_estimate','lab','import')),
  add column if not exists nutrition_confidence text check (nutrition_confidence in ('low','medium','high')),
  add column if not exists nutrition_verified boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create policy "owner manages own menu" on public.menu_items for all to authenticated
  using (public.can_manage_vendor(vendor_id)) with check (public.can_manage_vendor(vendor_id));

-- ===== storage for photos =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vendor-media','vendor-media', true, 6291456, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "vendor media public read" on storage.objects for select to anon, authenticated using (bucket_id = 'vendor-media');
create policy "vendor media owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'vendor-media' and public.can_manage_vendor((storage.foldername(name))[1]));
create policy "vendor media owner update" on storage.objects for update to authenticated
  using (bucket_id = 'vendor-media' and public.can_manage_vendor((storage.foldername(name))[1]));
create policy "vendor media owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'vendor-media' and public.can_manage_vendor((storage.foldername(name))[1]));

-- ===== open-now (Asia/Beirut) =====
create or replace function public.vendor_is_open(p_vendor_id text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare p record; local_ts timestamp; dow text; nowt time; rng jsonb; s time; e time; ok boolean := false;
begin
  select hours, accepts_orders, paused_until, closed_dates into p from public.vendor_profiles where vendor_id = p_vendor_id;
  if not found or p.hours is null then return null; end if;
  if p.accepts_orders is false then return false; end if;
  if p.paused_until is not null and p.paused_until > now() then return false; end if;
  local_ts := now() at time zone 'Asia/Beirut';
  if exists (select 1 from jsonb_array_elements(p.closed_dates) as c(v)
             where local_ts::date between (c.v->>'from')::date and coalesce((c.v->>'to')::date, (c.v->>'from')::date)) then
    return false;
  end if;
  dow := lower(to_char(local_ts, 'dy'));
  nowt := local_ts::time;
  for rng in select value from jsonb_array_elements(coalesce(p.hours -> dow, '[]'::jsonb)) loop
    s := (rng ->> 0)::time; e := (rng ->> 1)::time;
    if e > s then
      if nowt >= s and nowt < e then ok := true; end if;
    else
      if nowt >= s or nowt < e then ok := true; end if;
    end if;
  end loop;
  return ok;
end $$;

-- ===== explore (server-side filtering for the public site) =====
create or replace function public.explore_vendors(
  p_q text default null, p_village text default null, p_category text default null, p_cuisine text default null,
  p_open_now boolean default null, p_claimed boolean default null, p_has_menu boolean default null,
  p_vegan boolean default null, p_gluten_free boolean default null, p_keto boolean default null,
  p_sort text default 'relevance', p_limit int default 24, p_offset int default 0
) returns table (
  vendor_id text, slug text, name_en text, name_ar text, category text, village text, address text,
  latitude numeric, longitude numeric, claimed boolean, open_now boolean, menu_count int, price_tier smallint,
  cuisine_tags text[], logo_url text, cover_url text, tagline_en text, tagline_ar text, matched_items text[], total_count bigint
) language sql stable security definer set search_path = public as $$
  with base as (
    select v.vendor_id, v.slug, v.name_en, v.name_ar, v.category_canonical as category, v.village_canonical as village, v.address,
           v.latitude, v.longitude, (vp.claimed_at is not null) as claimed, public.vendor_is_open(v.vendor_id) as open_now,
           coalesce(mc.n, 0)::int as menu_count, vp.price_tier, coalesce(vp.cuisine_tags, '{}') as cuisine_tags,
           vp.logo_url, vp.cover_url, vp.tagline_en, vp.tagline_ar,
           case when p_q is null or p_q = '' then '{}'::text[]
                else coalesce((select array_agg(distinct m.item_name_en) from public.menu_items m
                               where m.vendor_id = v.vendor_id and m.available
                                 and (m.item_name_en ilike '%'||p_q||'%' or coalesce(m.item_name_ar,'') ilike '%'||p_q||'%')), '{}') end as matched_items
    from public.vendors v
    left join public.vendor_profiles vp on vp.vendor_id = v.vendor_id
    left join (select mi.vendor_id, count(*) as n from public.menu_items mi where mi.available group by 1) mc on mc.vendor_id = v.vendor_id
    where v.is_active
      and (p_village is null or v.village_canonical ilike p_village)
      and (p_category is null or v.category_canonical ilike p_category)
      and (p_cuisine is null or p_cuisine = any(vp.cuisine_tags))
      and (p_claimed is null or (vp.claimed_at is not null) = p_claimed)
      and (p_has_menu is null or (coalesce(mc.n,0) > 0) = p_has_menu)
      and (p_vegan is not true or exists (select 1 from public.menu_items m where m.vendor_id = v.vendor_id and m.available and m.is_vegan))
      and (p_gluten_free is not true or exists (select 1 from public.menu_items m where m.vendor_id = v.vendor_id and m.available and m.is_gluten_free))
      and (p_keto is not true or exists (select 1 from public.menu_items m where m.vendor_id = v.vendor_id and m.available and m.is_keto))
  ), filtered as (
    select b.* from base b
    where (p_open_now is null or b.open_now is not distinct from p_open_now)
      and (p_q is null or p_q = '' or b.name_en ilike '%'||p_q||'%' or coalesce(b.name_ar,'') ilike '%'||p_q||'%'
           or cardinality(b.matched_items) > 0 or exists (select 1 from unnest(b.cuisine_tags) t where t ilike '%'||p_q||'%'))
  )
  select f.vendor_id, f.slug, f.name_en, f.name_ar, f.category, f.village, f.address, f.latitude, f.longitude,
         f.claimed, f.open_now, f.menu_count, f.price_tier, f.cuisine_tags, f.logo_url, f.cover_url, f.tagline_en, f.tagline_ar,
         f.matched_items, count(*) over () as total_count
  from filtered f
  order by (case when p_sort = 'name' then f.name_en end) asc nulls last, f.claimed desc, f.menu_count desc, f.name_en asc
  limit least(coalesce(p_limit, 24), 60) offset greatest(coalesce(p_offset, 0), 0)
$$;
grant execute on function public.explore_vendors to anon, authenticated;

-- ===== one public page payload =====
create or replace function public.get_vendor_page(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'vendor', jsonb_build_object('vendor_id', v.vendor_id, 'slug', v.slug, 'name_en', v.name_en, 'name_ar', v.name_ar,
        'category', v.category_canonical, 'village', v.village_canonical, 'address', v.address,
        'latitude', v.latitude, 'longitude', v.longitude, 'open_days', v.open_days, 'open_time', v.open_time, 'close_time', v.close_time),
    'profile', (select to_jsonb(vp) - 'claimed_by' from public.vendor_profiles vp where vp.vendor_id = v.vendor_id),
    'claimed', exists (select 1 from public.vendor_profiles vp where vp.vendor_id = v.vendor_id and vp.claimed_at is not null),
    'open_now', public.vendor_is_open(v.vendor_id))
  from public.vendors v where v.slug = p_slug and v.is_active
$$;
grant execute on function public.get_vendor_page(text) to anon, authenticated;

-- ===== bot-facing (service role only) =====
create or replace function public.get_vendor_info(p_vendor_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'vendor', jsonb_build_object('vendor_id', v.vendor_id, 'name_en', v.name_en, 'name_ar', v.name_ar, 'category', v.category_canonical,
        'village', v.village_canonical, 'address', v.address, 'legacy_open_days', v.open_days, 'legacy_open_time', v.open_time, 'legacy_close_time', v.close_time),
    'profile', (select to_jsonb(vp) - 'claimed_by' from public.vendor_profiles vp where vp.vendor_id = v.vendor_id),
    'open_now', public.vendor_is_open(v.vendor_id))
  from public.vendors v where v.vendor_id = p_vendor_id and v.is_active
$$;
revoke execute on function public.get_vendor_info(text) from public, anon, authenticated;
grant execute on function public.get_vendor_info(text) to service_role;

create or replace function public.bot_search_menu_v2(
  p_terms text[] default null, p_village text default null, p_vegan boolean default null, p_gluten_free boolean default null,
  p_keto boolean default null, p_max_calories int default null, p_min_protein numeric default null, p_max_price_usd numeric default null,
  p_vendor_id text default null, p_exclude_allergens text[] default null, p_include_closed boolean default false,
  p_demo boolean default true, p_limit int default 8
) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
    select * from (
      select m.item_id, m.item_name_en, m.item_name_ar, m.description_en, m.section, m.price_usd, m.serves, m.portion_grams,
             m.calories, m.protein_grams, m.carbs_grams, m.fat_grams, m.sugar_grams, m.fiber_g, m.sodium_mg,
             m.nutrition_source, m.nutrition_verified, m.ingredients, m.allergens, m.allergen_list, m.allergens_reviewed,
             m.is_vegan, m.is_vegetarian, m.is_gluten_free, m.is_keto, m.is_halal, m.is_dairy_free, m.contains_alcohol, m.contains_pork,
             m.spice_level, m.prep_time_min, m.customizations, m.ai_notes, m.is_popular, m.is_chef_pick,
             v.vendor_id, v.name_en as vendor_name, v.name_ar as vendor_name_ar, v.village_canonical as village, v.category_canonical as category,
             public.vendor_is_open(v.vendor_id) as open_now,
             coalesce((select count(*)::int from unnest(p_terms) t
                       where m.item_name_en ilike '%'||t||'%' or coalesce(m.item_name_ar,'') ilike '%'||t||'%'
                          or coalesce(m.section,'') ilike '%'||t||'%' or coalesce(m.description_en,'') ilike '%'||t||'%'
                          or v.name_en ilike '%'||t||'%' or coalesce(v.name_ar,'') ilike '%'||t||'%'), 0) as score
      from public.menu_items m join public.vendors v on v.vendor_id = m.vendor_id
      where m.available and v.is_active and (p_demo or v.is_live)
        and (p_include_closed or public.vendor_is_open(v.vendor_id) is distinct from false)
        and (p_vendor_id is null or v.vendor_id = p_vendor_id)
        and (p_village is null or v.village_canonical ilike p_village)
        and (p_vegan is null or m.is_vegan = p_vegan)
        and (p_gluten_free is null or m.is_gluten_free = p_gluten_free)
        and (p_keto is null or m.is_keto = p_keto)
        and (p_max_calories is null or m.calories <= p_max_calories)
        and (p_min_protein is null or m.protein_grams >= p_min_protein)
        and (p_max_price_usd is null or m.price_usd <= p_max_price_usd)
        and (p_exclude_allergens is null or not (m.allergen_list && p_exclude_allergens))
        and (p_terms is null or cardinality(p_terms) = 0 or exists (
              select 1 from unnest(p_terms) t
              where m.item_name_en ilike '%'||t||'%' or coalesce(m.item_name_ar,'') ilike '%'||t||'%'
                 or coalesce(m.section,'') ilike '%'||t||'%' or coalesce(m.description_en,'') ilike '%'||t||'%'
                 or v.name_en ilike '%'||t||'%' or coalesce(v.name_ar,'') ilike '%'||t||'%'))
    ) q order by q.score desc, q.is_popular desc, q.price_usd asc nulls last limit least(coalesce(p_limit, 8), 15)
  ) r
$$;
revoke execute on function public.bot_search_menu_v2 from public, anon, authenticated;
grant execute on function public.bot_search_menu_v2 to service_role;

-- ===== completeness / AI readiness =====
create or replace function public.vendor_completeness(p_vendor_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p record; mp text[] := '{}'; n int; d int; img int; ing int; alg int; mac int; prep int;
        pscore int; mscore int; priv_phone text;
begin
  if not (public.can_manage_vendor(p_vendor_id) or auth.role() = 'service_role') then raise exception 'not allowed'; end if;
  select * into p from public.vendor_profiles where vendor_id = p_vendor_id;
  if not found then mp := array['profile_not_created']; else
    if coalesce(p.description_en,'') = '' then mp := mp || 'description'; end if;
    if p.hours is null then mp := mp || 'opening_hours'; end if;
    if p.logo_url is null then mp := mp || 'logo'; end if;
    if p.cover_url is null then mp := mp || 'cover_photo'; end if;
    if cardinality(p.cuisine_tags) = 0 then mp := mp || 'cuisine_tags'; end if;
    if p.price_tier is null then mp := mp || 'price_tier'; end if;
    if cardinality(p.delivery_villages) = 0 then mp := mp || 'delivery_villages'; end if;
    if p.min_order_usd is null then mp := mp || 'min_order'; end if;
    if p.prep_time_min is null then mp := mp || 'prep_time'; end if;
    if p.whatsapp_orders_number is null then mp := mp || 'whatsapp_orders_number'; end if;
    if p.established_year is null then mp := mp || 'established_year'; end if;
    if coalesce(p.allergen_policy,'') = '' then mp := mp || 'allergen_policy'; end if;
    if p.instagram_url is null and p.facebook_url is null and p.website_url is null and p.tiktok_url is null then mp := mp || 'social_links'; end if;
    if p.google_maps_url is null then mp := mp || 'google_maps_link'; end if;
  end if;
  select owner_phone_urgent into priv_phone from public.vendor_private where vendor_id = p_vendor_id;
  if priv_phone is null then mp := mp || 'urgent_owner_phone'; end if;
  pscore := round(100.0 * (15 - cardinality(mp)) / 15);
  select count(*), count(*) filter (where coalesce(description_en,'') <> ''), count(*) filter (where image_url is not null),
         count(*) filter (where cardinality(ingredients) > 0), count(*) filter (where allergens_reviewed),
         count(*) filter (where nutrition_verified), count(*) filter (where prep_time_min is not null)
    into n, d, img, ing, alg, mac, prep from public.menu_items where vendor_id = p_vendor_id;
  mscore := case when n = 0 then 0 else round(100.0 * (d + img + ing + alg + mac + prep) / (6.0 * n)) end;
  return jsonb_build_object('profile_score', pscore, 'menu_score', mscore, 'overall', round(0.4 * pscore + 0.6 * mscore),
    'missing_profile', to_jsonb(mp),
    'menu', jsonb_build_object('items', n, 'with_description', d, 'with_photo', img, 'with_ingredients', ing,
        'allergens_reviewed', alg, 'macros_verified', mac, 'with_prep_time', prep));
end $$;
grant execute on function public.vendor_completeness(text) to authenticated, service_role;

-- ===== claims: finalize + admin review =====
create or replace function public.finalize_claim(p_claim_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c record; existing record;
begin
  select * into c from public.vendor_claims where id = p_claim_id and status in ('pending_otp','pending_review');
  if not found then raise exception 'claim not found or already closed'; end if;
  if exists (select 1 from public.vendor_profiles where vendor_id = c.vendor_id and claimed_at is not null) then
    raise exception 'vendor already claimed';
  end if;
  select * into existing from public.staff_profiles where user_id = c.user_id;
  if found and (existing.role <> 'merchant' or existing.vendor_id is distinct from c.vendor_id) then
    raise exception 'user is already linked to another role or vendor';
  end if;
  if not found then
    insert into public.staff_profiles (user_id, role, vendor_id, display_name) values (c.user_id, 'merchant', c.vendor_id, c.contact_name);
  end if;
  insert into public.vendor_profiles (vendor_id, claimed_at, claimed_by) values (c.vendor_id, now(), c.user_id)
    on conflict (vendor_id) do update set claimed_at = now(), claimed_by = c.user_id;
  insert into public.vendor_private (vendor_id, owner_name, owner_phone_urgent) values (c.vendor_id, c.contact_name, c.contact_phone)
    on conflict (vendor_id) do nothing;
  update public.vendor_claims set status = 'approved', reviewed_at = now(), otp_hash = null where id = p_claim_id;
  update public.vendor_claims set status = 'expired' where vendor_id = c.vendor_id and id <> p_claim_id and status in ('pending_otp','pending_review');
end $$;
revoke execute on function public.finalize_claim(uuid) from public, anon, authenticated;
grant execute on function public.finalize_claim(uuid) to service_role;

create or replace function public.review_claim(p_claim_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'admin' then raise exception 'admin only'; end if;
  if p_approve then
    perform public.finalize_claim(p_claim_id);
  else
    update public.vendor_claims set status = 'rejected', reviewed_at = now(), otp_hash = null
      where id = p_claim_id and status in ('pending_otp','pending_review');
  end if;
end $$;
revoke execute on function public.review_claim(uuid, boolean) from public, anon;
grant execute on function public.review_claim(uuid, boolean) to authenticated;

-- ===== updated_at touch =====
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger menu_items_touch before update on public.menu_items for each row execute function public.touch_updated_at();
create trigger vendor_profiles_touch before update on public.vendor_profiles for each row execute function public.touch_updated_at();
create trigger vendor_private_touch before update on public.vendor_private for each row execute function public.touch_updated_at();
