-- Session 6a (DECISIONS §37, §24, §5): what the public website reads, and the signed tracking link.
--
--   1. Read-only projections for public pages. Each returns one jsonb document with only the fields a public page
--      shows: no coordinates of vendors, no private contact numbers, no customer data. They run as the caller
--      (security invoker, like the other public lookups: advisor lints 0028/0029 stay clean), so row-level security
--      is a second lock, and each one repeats the visibility rule itself: only a claimed, active vendor with
--      `public_page` is ever returned (§5, §15: unclaimed vendors have no public page).
--   2. `order_tracking_links` + `order_tracking_link_create` + `order_track_public`: a tracking link is an unguessable
--      token whose hash is stored with an expiry. The page returns only the status, the merchant, the order code, the
--      total, a broad area and an ETA range (§3, §27): no items, no coordinates, no address, no delivery code.
--      Nothing sends the link yet; the bot adds it once the domain exists (HANDOFF).
-- No table of the frozen places and vendor set changes (§31).

-- 1. Config ---------------------------------------------------------------------------------------------
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS.md §37, 13 October 2026 (session 6a)', false);
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('tracking_link_hours', '48', '2026-10-13 00:00+03', 'How long a customer tracking link works after it is made (DECISIONS §3, §27)', null);
select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);

-- 2. Shared helpers ---------------------------------------------------------------------------------------
-- The slug of a place in public URLs: its id without the "LB-" prefix, lower case (LB-CHF-BAAKLINE -> chf-baakline).
create function app_private.place_slug(p_id text) returns text
language sql
immutable
set search_path = ''
as $$ select lower(regexp_replace(p_id, '^LB-', '')) $$;
revoke all on function app_private.place_slug(text) from public;
grant execute on function app_private.place_slug(text) to anon, authenticated, service_role;
-- The public cards ask whether a vendor is open; the answer is one boolean from public hours.
grant execute on function app_private.vendor_open_at(uuid, timestamptz) to anon, authenticated;

-- A public vendor card: what a place page or a cuisine page lists.
create function app_private.site_vendor_card(p_vendor_id uuid) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', v.slug, 'name_ar', v.name_ar, 'name_en', v.name_en, 'name_fr', v.name_fr, 'branch_label', v.branch_label,
    'business_type', v.business_type,
    'business_type_ar', bt.name_ar, 'business_type_en', bt.name_en, 'business_type_fr', bt.name_fr,
    'cuisine_tags', v.cuisine_tags,
    'delivery', v.delivery_enabled, 'pickup', v.pickup_enabled,
    'open_now', app_private.vendor_open_at(v.id) and not public.vendor_is_paused(v.id),
    'paused', public.vendor_is_paused(v.id),
    'orderable', v.orderable,
    'place_slug', app_private.place_slug(v.town_id),
    'place_ar', pl.name_ar, 'place_en', pl.name_en, 'place_fr', pl.name_fr)
  from public.vendors v
  join public.business_type_labels bt on bt.business_type = v.business_type
  left join public.places pl on pl.id = v.town_id
  where v.id = p_vendor_id and v.public_page and v.listing_status = 'active' and v.claim_status = 'claimed';
$$;
revoke all on function app_private.site_vendor_card(uuid) from public;
grant execute on function app_private.site_vendor_card(uuid) to anon, authenticated, service_role;

-- 3. The overview: home, map and sitemaps ----------------------------------------------------------------------
create function public.site_overview() returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    -- Places switched on, with how many live merchants have their home there (live = public, claimed, orderable).
    'places', coalesce((
      select jsonb_agg(p order by p.merchants desc, p.name_en)
      from (
        select pl.id, app_private.place_slug(pl.id) as slug, pl.name_ar, pl.name_en, pl.name_fr, pl.kind, pl.district_code,
               round(extensions.st_y(pl.centroid::extensions.geometry)::numeric, 4) as lat,
               round(extensions.st_x(pl.centroid::extensions.geometry)::numeric, 4) as lon,
               (select count(*) from public.vendors v
                 where v.town_id = pl.id and v.public_page and v.listing_status = 'active' and v.orderable) as merchants
        from public.places pl
        where pl.service_status = 'on'
      ) p), '[]'::jsonb),
    -- Cuisines that at least one public vendor serves.
    'cuisines', coalesce((
      select jsonb_agg(c order by c.vendors desc, c.sort_order, c.tag)
      from (
        select t.tag, t.name_ar, t.name_en, t.name_fr, t.sort_order, count(*) as vendors
        from public.cuisine_tags t
        join public.vendors v on t.tag = any (v.cuisine_tags)
          and v.public_page and v.listing_status = 'active' and v.claim_status = 'claimed'
        where t.active
        group by t.tag, t.name_ar, t.name_en, t.name_fr, t.sort_order
      ) c), '[]'::jsonb),
    'merchants', (select count(*) from public.vendors v
                   where v.public_page and v.listing_status = 'active' and v.claim_status = 'claimed' and v.orderable),
    'fees', jsonb_build_object(
      'min_usd', public.delivery_fee_usd(0),
      'max_usd', public.delivery_fee_usd(public.max_delivery_km()),
      'max_km', public.max_delivery_km()),
    'order_fee_usd', public.price_usd('order_fee'),
    -- The merchant's free days at the start (price_list rules), so the page never repeats a number from this file.
    'order_fee_free_days', (select (p.rules ->> 'free_days')::int from public.price_list p
                             where p.product = 'order_fee' and p.effective_from <= now()
                             order by p.effective_from desc limit 1),
    'rate', public.usd_lbp_rate(),
    'rate_at', now());
$$;
revoke all on function public.site_overview() from public;
grant execute on function public.site_overview() to anon, authenticated, service_role;

-- Every public vendor slug with its last change, for the sitemap.
create function public.site_vendor_slugs() returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', v.slug, 'updated_at', v.updated_at) order by v.slug), '[]'::jsonb)
  from public.vendors v
  where v.public_page and v.listing_status = 'active' and v.claim_status = 'claimed';
$$;
revoke all on function public.site_vendor_slugs() from public;
grant execute on function public.site_vendor_slugs() to anon, authenticated, service_role;

-- 4. A place page ----------------------------------------------------------------------------------------------
create function public.site_place(p_slug text) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_place public.places%rowtype;
  v_vendors jsonb;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 80 then
    return null;
  end if;
  select * into v_place from public.places where id = upper('LB-' || p_slug) and service_status = 'on';
  if v_place.id is null then
    return null;
  end if;
  select coalesce(jsonb_agg(app_private.site_vendor_card(v.id) order by v.name_en, v.name_ar), '[]'::jsonb)
    into v_vendors
  from public.vendors v
  where v.town_id = v_place.id and v.public_page and v.listing_status = 'active' and v.claim_status = 'claimed' and v.orderable;
  return jsonb_build_object(
    'place', jsonb_build_object('id', v_place.id, 'slug', app_private.place_slug(v_place.id),
      'name_ar', v_place.name_ar, 'name_en', v_place.name_en, 'name_fr', v_place.name_fr, 'kind', v_place.kind,
      'district_code', v_place.district_code,
      'lat', round(extensions.st_y(v_place.centroid::extensions.geometry)::numeric, 4),
      'lon', round(extensions.st_x(v_place.centroid::extensions.geometry)::numeric, 4),
      'district_ar', (select d.name_ar from public.districts d where d.code = v_place.district_code and d.governorate_code = v_place.governorate_code),
      'district_en', (select d.name_en from public.districts d where d.code = v_place.district_code and d.governorate_code = v_place.governorate_code),
      'district_fr', (select d.name_fr from public.districts d where d.code = v_place.district_code and d.governorate_code = v_place.governorate_code)),
    'vendors', v_vendors,
    'fees', jsonb_build_object('min_usd', public.delivery_fee_usd(0),
      'max_usd', public.delivery_fee_usd(public.max_delivery_km()), 'max_km', public.max_delivery_km()),
    'rate', public.usd_lbp_rate());
end;
$$;
revoke all on function public.site_place(text) from public;
grant execute on function public.site_place(text) to anon, authenticated, service_role;

-- 5. A cuisine page ---------------------------------------------------------------------------------------------
create function public.site_cuisine(p_tag text) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tag public.cuisine_tags%rowtype;
  v_vendors jsonb;
begin
  if p_tag is null or p_tag !~ '^[a-z][a-z0-9_]*$' or char_length(p_tag) > 60 then
    return null;
  end if;
  select * into v_tag from public.cuisine_tags where tag = p_tag and active;
  if v_tag.tag is null then
    return null;
  end if;
  select coalesce(jsonb_agg(app_private.site_vendor_card(v.id) order by v.name_en, v.name_ar), '[]'::jsonb)
    into v_vendors
  from public.vendors v
  where p_tag = any (v.cuisine_tags) and v.public_page and v.listing_status = 'active' and v.claim_status = 'claimed';
  return jsonb_build_object(
    'cuisine', jsonb_build_object('tag', v_tag.tag, 'name_ar', v_tag.name_ar, 'name_en', v_tag.name_en, 'name_fr', v_tag.name_fr),
    'vendors', v_vendors,
    'rate', public.usd_lbp_rate());
end;
$$;
revoke all on function public.site_cuisine(text) from public;
grant execute on function public.site_cuisine(text) to anon, authenticated, service_role;

-- 6. A claimed vendor's page ------------------------------------------------------------------------------------
-- Menu, hours, area and ways to order. Available items only; allergens only when the merchant confirmed them
-- (§17, §32.3); prices in USD from the menu, LBP is computed by the page at the rate returned here.
create function public.site_vendor(p_slug text) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v public.vendors%rowtype;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 120 then
    return null;
  end if;
  select * into v from public.vendors
  where slug = p_slug and public_page and listing_status = 'active' and claim_status = 'claimed';
  if v.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'vendor', app_private.site_vendor_card(v.id) || jsonb_build_object(
      'delivery_radius_km', v.delivery_radius_km,
      'paused_until', case when public.vendor_is_paused(v.id) then v.paused_until end,
      'cash_currencies', v.cash_currencies,
      'updated_at', v.updated_at,
      'cuisines', coalesce((
        select jsonb_agg(jsonb_build_object('tag', t.tag, 'name_ar', t.name_ar, 'name_en', t.name_en, 'name_fr', t.name_fr)
                         order by t.sort_order, t.tag)
        from public.cuisine_tags t where t.tag = any (v.cuisine_tags) and t.active), '[]'::jsonb)),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', to_char(h.opens, 'HH24:MI'), 'closes', to_char(h.closes, 'HH24:MI'))
                       order by h.weekday)
      from public.vendor_hours h where h.vendor_id = v.id), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name_ar', s.name_ar, 'name_en', s.name_en, 'name_fr', s.name_fr,
        'items', (
          select jsonb_agg(jsonb_build_object(
            'name_ar', i.name_ar, 'name_en', i.name_en, 'name_fr', i.name_fr, 'description', i.description,
            'price_usd', i.price_usd, 'per_kg', i.pricing_unit = 'kg',
            'vegetarian', i.vegetarian, 'vegan', i.vegan, 'spicy', i.spicy_level,
            'pork', i.contains_pork, 'alcohol', i.contains_alcohol,
            'allergens', case when i.allergens_confirmed_at is not null then to_jsonb(i.allergens) end)
            order by i.sort_order, i.name_en, i.name_ar)
          from public.menu_items i
          where i.vendor_id = v.id and i.available and i.section_id is not distinct from s.id))
        order by s.sort_order, s.name_en)
      from (
        select ms.id, ms.name_ar, ms.name_en, ms.name_fr, ms.sort_order
        from public.menu_sections ms where ms.vendor_id = v.id
        union all
        select null::uuid, null, null, null, 2147483647
        where exists (select 1 from public.menu_items x where x.vendor_id = v.id and x.available and x.section_id is null)
      ) s
      where exists (select 1 from public.menu_items x where x.vendor_id = v.id and x.available and x.section_id is not distinct from s.id)), '[]'::jsonb),
    'fees', jsonb_build_object('min_usd', public.delivery_fee_usd(0),
      'max_usd', public.delivery_fee_usd(least(coalesce(v.delivery_radius_km, public.max_delivery_km()), public.max_delivery_km())),
      'max_km', least(coalesce(v.delivery_radius_km, public.max_delivery_km()), public.max_delivery_km())),
    'rate', public.usd_lbp_rate());
end;
$$;
revoke all on function public.site_vendor(text) from public;
grant execute on function public.site_vendor(text) to anon, authenticated, service_role;

-- 7. Tracking links ----------------------------------------------------------------------------------------------
-- A token is 32 random bytes, shown once to the caller that makes it; only its SHA-256 is stored. Possession of the
-- link is the only credential (§3), so the page returns nothing personal.
create table public.order_tracking_links (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  order_id uuid not null references public.orders (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index order_tracking_links_order_idx on public.order_tracking_links (order_id);
alter table public.order_tracking_links enable row level security;
revoke all on table public.order_tracking_links from public, anon, authenticated;
grant all on table public.order_tracking_links to service_role;

create function public.order_tracking_link_create(p_order_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw bytea := extensions.gen_random_bytes(32);
  v_token text := translate(rtrim(encode(v_raw, 'base64'), '='), '+/', '-_');
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    return null;
  end if;
  insert into public.order_tracking_links (token_hash, order_id, expires_at)
  values (extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), p_order_id,
          now() + make_interval(hours => public.config_numeric('tracking_link_hours')::int));
  return v_token;
end;
$$;
revoke all on function public.order_tracking_link_create(uuid) from public, anon, authenticated;
grant execute on function public.order_tracking_link_create(uuid) to service_role;

-- What the tracking page shows. Null for an unknown or expired token, with no difference between the two.
-- The one deliberate security-definer function an anonymous caller can run (advisor lint 0028): orders are not
-- readable by clients, the token is 256 bits and stored only as a hash, and the answer is the §3 minimum.
create function public.order_track_public(p_token text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.order_tracking_links%rowtype;
  v_o public.orders%rowtype;
  v_v public.vendors%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,60}$' then
    return null;
  end if;
  select * into v_link from public.order_tracking_links
  where token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256') and expires_at > now();
  if v_link.order_id is null then
    return null;
  end if;
  select * into v_o from public.orders where id = v_link.order_id;
  select * into v_v from public.vendors where id = v_o.vendor_id;
  return jsonb_build_object(
    'code', v_o.code, 'status', v_o.status, 'fulfilment', v_o.fulfilment,
    'vendor_ar', v_v.name_ar, 'vendor_en', v_v.name_en, 'vendor_fr', v_v.name_fr,
    'total_usd', v_o.total_usd, 'total_lbp', v_o.total_lbp, 'usd_lbp_rate', v_o.usd_lbp_rate,
    'estimated', v_o.weight_status in ('awaiting_weight', 'awaiting_customer'),
    'eta', public.order_eta_range(v_o.id),
    'driver_assigned', v_o.driver_member_id is not null,
    -- A broad area for deliveries (the village), never the pin or the address.
    'area_ar', case when v_o.fulfilment = 'delivery' then (select p.name_ar from public.places p where p.id = v_o.delivery_place_id) end,
    'area_en', case when v_o.fulfilment = 'delivery' then (select p.name_en from public.places p where p.id = v_o.delivery_place_id) end,
    'area_fr', case when v_o.fulfilment = 'delivery' then (select p.name_fr from public.places p where p.id = v_o.delivery_place_id) end,
    'placed_at', v_o.placed_at, 'accepted_at', v_o.accepted_at, 'ready_at', v_o.ready_marked_at,
    'picked_up_at', v_o.picked_up_at, 'delivered_at', v_o.delivered_at,
    'expires_at', v_link.expires_at);
end;
$$;
revoke all on function public.order_track_public(text) from public;
grant execute on function public.order_track_public(text) to anon, authenticated, service_role;
