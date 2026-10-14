-- Session F, DECISIONS §39.2: the delivery area is Rasheed's boundary, not a 10 km radius. Session E's dated row (259
-- places within 10 km in a straight line, Aley, Baabda, West Bekaa, Damour and the Iqlim included) is replaced.
--
--   * `supabase/seed/places/shouf_delivery_boundary.csv` (59 places: the shop villages, the villages Rasheed named and
--     the places between them) and `shouf_delivery_denylist.csv` (the hard stops in the Chouf) are loaded by
--     scripts/load-seed.sh into `app_private.delivery_boundary` and `app_private.delivery_denylist`;
--     `app_private.delivery_area_load()` checks them and, when the boundary differs from the `pilot_place_ids` in force,
--     inserts a new dated `pilot_place_ids` row (Rasheed strikes or adds a village by editing one line of the file).
--   * Road distances: `supabase/seed/places/shouf_delivery_road_km.csv` (when committed; the `area-data` workflow
--     computes it from OpenRouteService) loads into `app_private.delivery_road_km`.
--   * `public.delivery_area_proposal()` is now boundary ∩ road distance: a boundary place that is not deny-listed or
--     paused and whose road distance to the nearest pilot merchant is within `max_delivery_km()`. Road km comes from the
--     committed file, else the route cache, else the straight line (the fallback, §39.2).
--   * Enforcement: a real merchant delivers only to a place that is on. `basket_quote`, `customer_delivery_check` and
--     `order_place` answered "place_paused" only for paused places; an address in a place that is off (outside the
--     boundary or deny-listed) now gets the same answer ("We don't deliver to that area right now"). The staging test
--     merchants keep taking any pin (§35).
--   * OSM (§38.2 items 4-5, §39.2): landmarks load only for places in the area, and OSM landmarks and place names of
--     places now off are removed (an address keeps its text; its landmark link is set null).
-- The functions below are copied from 20261012150000 (basket_quote, customer_delivery_check) and 20261014090100
-- (order_place) with only the place check changed. Rollback: supabase/rollbacks/20261014200000_delivery_boundary.sql.

-- 1. Boundary, deny-list and road distances -----------------------------------------------------------------------
create table app_private.delivery_boundary (
  place_id text primary key,
  name_en text,
  name_ar text,
  role text not null check (role in ('shop_village', 'named_by_rasheed', 'between'))
);
create table app_private.delivery_denylist (
  place_id text primary key,
  name_en text,
  name_ar text,
  reason text not null check (char_length(reason) between 3 and 200)
);
create table app_private.delivery_road_km (
  place_id text primary key,
  road_km numeric(6, 2) not null check (road_km >= 0),
  nearest_vendor_place_id text,
  provider text not null check (provider ~ '^[a-z][a-z0-9_]*$'),
  computed_on date not null
);
revoke all on table app_private.delivery_boundary, app_private.delivery_denylist, app_private.delivery_road_km
  from public, anon, authenticated;

-- A real merchant delivers to a place only while it is on (§39.2).
create function app_private.place_delivered_to(p_place_id text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.service_status = 'on' from public.places p where p.id = p_place_id), false);
$$;
revoke all on function app_private.place_delivered_to(text) from public, anon, authenticated;

-- 2. The proposal: boundary ∩ road distance -------------------------------------------------------------------------
drop function public.delivery_area_proposal();
create function public.delivery_area_proposal()
returns table (place_id text, name_en text, name_ar text, district_code text, service_status public.service_status,
  role text, distance_km numeric, distance_source text, nearest_merchant_km numeric, in_pilot_place_ids boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select v.location, app_private.route_point_key(v.location) as point_key from public.vendors v
    where not v.is_test and v.location is not null
      and v.town_id = any (array(select jsonb_array_elements_text(public.config_value('pilot_merchant_place_ids'))))
  ), area as (
    select jsonb_array_elements_text(public.config_value('pilot_place_ids')) as id
  ), d as (
    select p.id, p.name_en, p.name_ar, p.district_code, p.service_status, b.role,
      (select r.road_km from app_private.delivery_road_km r where r.place_id = p.id) as road_file,
      (select round(min(c.distance_m)::numeric / 1000, 2) from public.route_cache c join m on c.origin_key = m.point_key
       where c.profile = 'driving-car' and c.dest_key = app_private.route_point_key(p.centroid) and c.expires_at > now()) as road_cache,
      round((select min(extensions.st_distance(m.location, p.centroid)) from m)::numeric / 1000, 2) as straight
    from app_private.delivery_boundary b
    join public.places p on p.id = b.place_id
    where p.service_status <> 'paused'
      and not exists (select 1 from app_private.delivery_denylist x where x.place_id = p.id)
  )
  select d.id, d.name_en, d.name_ar, d.district_code, d.service_status, d.role,
    coalesce(d.road_file, d.road_cache, d.straight),
    case when d.road_file is not null then 'road_file' when d.road_cache is not null then 'route_cache' else 'straight_line' end,
    d.straight,
    exists (select 1 from area where area.id = d.id)
  from d
  where coalesce(d.road_file, d.road_cache, d.straight) <= public.max_delivery_km()
  order by d.id;
$$;
revoke all on function public.delivery_area_proposal() from public, anon, authenticated;
grant execute on function public.delivery_area_proposal() to service_role;

-- 3. OSM for the area only --------------------------------------------------------------------------------------------
-- OSM landmarks and place names outside the places that are on go; learned ones (customers, drivers) are never touched.
create function app_private.osm_prune_outside_area() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_area text[] := array(select jsonb_array_elements_text(public.config_value('pilot_place_ids')));
  n_landmarks integer;
  n_aliases integer;
begin
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'OSM outside the delivery area (DECISIONS §39.2)', true);
  delete from public.landmarks l where l.source = 'osm' and (l.place_id is null or not (l.place_id = any (v_area)));
  get diagnostics n_landmarks = row_count;
  delete from public.place_aliases a where a.source = 'osm' and not (a.place_id = any (v_area));
  get diagnostics n_aliases = row_count;
  return jsonb_build_object('landmarks_removed', n_landmarks, 'aliases_removed', n_aliases);
end;
$$;
revoke all on function app_private.osm_prune_outside_area() from public, anon, authenticated;

create or replace function app_private.osm_load_seed(p_sha256 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pilot text[] := array(select jsonb_array_elements_text(public.config_value('pilot_place_ids')));
  n_landmarks integer;
  n_aliases integer;
  v_pruned jsonb;
begin
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'OSM pilot seed ' || left(p_sha256, 12), true);
  -- Landmarks only in the places that are on (§39.2); the rest of the box is skipped.
  insert into public.landmarks (place_id, name_ar, name_en, aliases, kind, point, source, status, shared, confidence, osm_ref)
  select f.place_id, nullif(s.name_ar, ''), nullif(s.name_en, ''),
    coalesce(nullif(s.aliases, '')::text[], '{}'), s.kind, p.pt, 'osm', 'unconfirmed', true, 0.3, s.osm_ref
  from app_private.seed_osm_landmarks s
  cross join lateral (select extensions.st_setsrid(extensions.st_makepoint(s.lon, s.lat), 4326)::extensions.geography as pt) p
  cross join lateral (select x.place_id from public.place_for_point(p.pt) x) f
  where coalesce(nullif(s.name_ar, ''), nullif(s.name_en, '')) is not null and s.kind ~ '^[a-z_]+$'
    and s.osm_ref ~ '^(node|way|relation)/[0-9]+$'
    and f.place_id = any (v_pilot)
  on conflict (osm_ref) do update
    set name_ar = excluded.name_ar, name_en = excluded.name_en, aliases = excluded.aliases, kind = excluded.kind,
        point = excluded.point, place_id = excluded.place_id
    where landmarks.source = 'osm' and (landmarks.name_ar, landmarks.name_en, landmarks.aliases, landmarks.kind, landmarks.point, landmarks.place_id)
      is distinct from (excluded.name_ar, excluded.name_en, excluded.aliases, excluded.kind, excluded.point, excluded.place_id);
  get diagnostics n_landmarks = row_count;

  -- An OSM place node's names become aliases of the place its point falls in (the village's own node, and hamlets or
  -- neighbourhoods inside it), for places that are on; nodes that fall in any other place are skipped.
  insert into public.place_aliases (place_id, alias, lang, status, shared, source, osm_key)
  select distinct on (f.place_id, app_private.normalize_place_name(s.alias))
    f.place_id, trim(s.alias), nullif(s.lang, '')::public.lang_code, 'confirmed', true, 'osm', s.osm_key
  from app_private.seed_osm_aliases s
  cross join lateral public.place_for_point(extensions.st_setsrid(extensions.st_makepoint(s.lon, s.lat), 4326)::extensions.geography) f
  where f.place_id = any (v_pilot)
    and char_length(trim(s.alias)) between 2 and 80
    and coalesce(app_private.normalize_place_name(s.alias), '') <> ''
    and s.osm_key in ('name', 'alt_name', 'loc_name', 'old_name', 'official_name', 'short_name')
  order by f.place_id, app_private.normalize_place_name(s.alias), s.osm_key
  on conflict (place_id, normalized_alias) do nothing;
  get diagnostics n_aliases = row_count;

  v_pruned := app_private.osm_prune_outside_area();

  insert into app_private.seed_loads (name, sha256, loaded_at, counts)
  values ('osm_pilot', p_sha256, now(), jsonb_build_object('landmarks', n_landmarks, 'aliases', n_aliases) || v_pruned
    || jsonb_build_object('landmarks_total', (select count(*) from public.landmarks where source = 'osm'),
    'aliases_total', (select count(*) from public.place_aliases where source = 'osm')))
  on conflict (name) do update set sha256 = excluded.sha256, loaded_at = excluded.loaded_at, counts = excluded.counts;
  return (select counts from app_private.seed_loads where name = 'osm_pilot');
end;
$$;
revoke all on function app_private.osm_load_seed(text) from public, anon, authenticated;

-- 4. The loader: the boundary file becomes the dated pilot_place_ids row --------------------------------------------
create function app_private.delivery_area_load(p_sha256 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_area text[] := array(select b.place_id from app_private.delivery_boundary b order by b.place_id);
  v_current text[] := array(select x from jsonb_array_elements_text(public.config_value('pilot_place_ids')) x order by x);
  v_bad text;
  v_new boolean := false;
  v_places jsonb;
  v_pruned jsonb;
begin
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'delivery boundary ' || left(p_sha256, 12) || ' (DECISIONS §39.2)', true);
  if cardinality(v_area) = 0 then
    raise exception 'delivery boundary: the file is empty' using errcode = 'invalid_parameter_value';
  end if;
  select string_agg(x.place_id, ', ') into v_bad from (
    select place_id from app_private.delivery_boundary union all select place_id from app_private.delivery_denylist
    union all select place_id from app_private.delivery_road_km) x
  where not exists (select 1 from public.places p where p.id = x.place_id);
  if v_bad is not null then
    raise exception 'delivery boundary: unknown place ids: %', v_bad using errcode = 'invalid_parameter_value';
  end if;
  select string_agg(b.place_id, ', ') into v_bad from app_private.delivery_boundary b
  where exists (select 1 from app_private.delivery_denylist x where x.place_id = b.place_id);
  if v_bad is not null then
    raise exception 'delivery boundary: deny-listed places in the boundary: %', v_bad using errcode = 'invalid_parameter_value';
  end if;
  select string_agg(b.place_id, ', ') into v_bad from app_private.delivery_boundary b
  join public.places p on p.id = b.place_id where p.service_status = 'paused';
  if v_bad is not null then
    raise exception 'delivery boundary: paused places in the boundary: %', v_bad using errcode = 'invalid_parameter_value';
  end if;

  if v_area is distinct from v_current then
    insert into public.app_config (key, value, effective_from, note, created_by)
    values ('pilot_place_ids', to_jsonb(v_area), now(),
      format('Delivery area: Rasheed''s boundary, %s places (DECISIONS §39.2; shouf_delivery_boundary.csv %s)',
             cardinality(v_area), left(p_sha256, 12)), null);
    v_new := true;
  end if;
  v_places := app_private.pilot_places_apply();
  if exists (select 1 from app_private.delivery_denylist x join public.places p on p.id = x.place_id where p.service_status = 'on') then
    raise exception 'delivery boundary: a deny-listed place is still on' using errcode = 'check_violation';
  end if;
  v_pruned := app_private.osm_prune_outside_area();

  insert into app_private.seed_loads (name, sha256, loaded_at, counts)
  values ('delivery_area', p_sha256, now(), jsonb_build_object('boundary', cardinality(v_area),
    'denylist', (select count(*) from app_private.delivery_denylist),
    'road_km', (select count(*) from app_private.delivery_road_km), 'new_dated_row', v_new, 'places', v_places) || v_pruned)
  on conflict (name) do update set sha256 = excluded.sha256, loaded_at = excluded.loaded_at, counts = excluded.counts;
  return (select counts from app_private.seed_loads where name = 'delivery_area');
end;
$$;
revoke all on function app_private.delivery_area_load(text) from public, anon, authenticated;

-- 5. Enforcement: outside the area answers like a paused place (copies with the place check changed) ---------------
create or replace function public.basket_quote(p_customer_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basket public.baskets%rowtype;
  v_vendor public.vendors%rowtype;
  v_address public.addresses%rowtype;
  v_view jsonb;
  v_route record;
  v_quote record;
  v_subtotal numeric;
  v_deposit numeric;
  v_stairs numeric := 0;
  v_fee numeric := 0;
  v_total numeric;
  v_rate numeric := public.usd_lbp_rate();
  v_new boolean;
  v_cap numeric;
  v_road numeric;
  v_test boolean;
begin
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open';
  if v_basket.id is null then
    return jsonb_build_object('status', 'no_basket');
  end if;
  v_view := public.basket_view(p_customer_id);
  if jsonb_array_length(v_view -> 'lines') = 0 then
    return jsonb_build_object('status', 'empty_basket');
  end if;
  select * into v_vendor from public.vendors where id = v_basket.vendor_id;
  v_test := app_private.vendor_is_test(v_vendor.id);
  v_subtotal := (v_view ->> 'subtotal_usd')::numeric;
  select coalesce(sum(case when (l ->> 'has_empty')::boolean is false then (l ->> 'deposit_usd')::numeric * (l ->> 'quantity')::int else 0 end), 0)
    into v_deposit from jsonb_array_elements(v_view -> 'lines') l;
  if v_basket.fulfilment = 'delivery' then
    select * into v_address from public.addresses where id = v_basket.address_id;
    if v_address.id is null or v_address.pin is null then
      return jsonb_build_object('status', 'no_address', 'basket', v_view);
    end if;
    if v_test then
      -- Staging test merchant: any pin, no route, no radius; the delivery fee is the first (0-3 km) band.
      select * into v_quote from public.delivery_quote(v_vendor.id, 0);
      v_road := 0;
      v_fee := v_quote.fee_usd;
    else
      -- Outside the delivery area (§39.2: a place that is not on, deny-listed places included) answers like a paused place.
      if not app_private.place_delivered_to(v_address.place_id) then
        return jsonb_build_object('status', 'place_paused', 'basket', v_view);
      end if;
      select * into v_route from public.route_cache_lookup(
        extensions.st_y(v_vendor.location::extensions.geometry), extensions.st_x(v_vendor.location::extensions.geometry),
        array[extensions.st_y(v_address.pin::extensions.geometry)], array[extensions.st_x(v_address.pin::extensions.geometry)]);
      if v_route.distance_m is null then
        return jsonb_build_object('status', 'no_route', 'basket', v_view,
          'origin', jsonb_build_object('lat', extensions.st_y(v_vendor.location::extensions.geometry), 'lon', extensions.st_x(v_vendor.location::extensions.geometry)),
          'dest', jsonb_build_object('lat', extensions.st_y(v_address.pin::extensions.geometry), 'lon', extensions.st_x(v_address.pin::extensions.geometry)));
      end if;
      select * into v_quote from public.delivery_quote(v_vendor.id, round(v_route.distance_m / 1000.0, 2));
      if not v_quote.deliverable then
        return jsonb_build_object('status', v_quote.reason, 'basket', v_view, 'limit_km', v_quote.limit_km,
          'road_km', v_quote.road_km, 'pickup_enabled', v_vendor.pickup_enabled);
      end if;
      v_road := round(v_route.distance_m / 1000.0, 2);
      v_fee := v_quote.fee_usd;
    end if;
    if v_basket.stairs_floors is not null and v_vendor.stairs_fee_per_floor_usd is not null then
      v_stairs := v_basket.stairs_floors * v_vendor.stairs_fee_per_floor_usd;
    end if;
  end if;
  v_total := v_subtotal + v_fee + v_deposit + v_stairs;
  v_new := not exists (select 1 from public.orders o where o.customer_id = p_customer_id and o.status = 'delivered');
  v_cap := public.config_numeric('cod_cap_usd');
  if v_new then
    v_cap := least(v_cap, public.config_numeric('cod_cap_new_number_usd'));
  end if;
  return jsonb_build_object('status', 'ok', 'basket', v_view, 'subtotal_usd', v_subtotal, 'delivery_fee_usd', v_fee,
    'deposit_usd', v_deposit, 'stairs_fee_usd', v_stairs, 'total_usd', v_total, 'usd_lbp_rate', v_rate,
    'total_lbp', round(v_total * v_rate, 0), 'road_km', v_road,
    'cod_cap_usd', v_cap, 'over_cod_cap', v_basket.payment_method = 'cod' and v_total > v_cap,
    'estimated', exists (select 1 from jsonb_array_elements(v_view -> 'lines') l where (l ->> 'estimated')::boolean),
    'needs_empty_answer', exists (select 1 from jsonb_array_elements(v_view -> 'lines') l where (l ->> 'needs_empty_answer')::boolean),
    'stairs_fee_per_floor_usd', v_vendor.stairs_fee_per_floor_usd,
    'address', case when v_address.id is not null then public.address_card(v_address.id) end);
end;
$$;

create or replace function public.customer_delivery_check(p_customer_id uuid, p_vendor_ids uuid[]) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pt jsonb := public.customer_search_point(p_customer_id);
  v_addr public.addresses%rowtype;
  v_out jsonb := '[]';
  v_v record;
  v_route record;
  v_q record;
  v_paused boolean;
begin
  if v_pt is null then
    return jsonb_build_object('status', 'no_address', 'vendors', '[]'::jsonb);
  end if;
  select * into v_addr from public.addresses where id = (v_pt ->> 'address_id')::uuid;
  if v_addr.id is null or v_addr.pin is null then
    return jsonb_build_object('status', 'no_address', 'vendors', '[]'::jsonb);
  end if;
  -- §39.2: a place outside the delivery area (not on: paused, deny-listed or simply off) answers like a paused one.
  v_paused := not app_private.place_delivered_to(v_addr.place_id);
  -- A place outside the area at the pin answers for every real vendor; a test merchant ignores it.
  if v_paused and not exists (select 1 from public.vendors v where v.id = any (p_vendor_ids) and v.is_test) then
    return jsonb_build_object('status', 'place_paused', 'vendors', '[]'::jsonb);
  end if;
  for v_v in
    select v.id, v.location, v.pickup_enabled, v.is_test from public.vendors v where v.id = any (p_vendor_ids)
  loop
    if v_v.is_test then
      select * into v_q from public.delivery_quote(v_v.id, 0);
      v_out := v_out || jsonb_build_object('vendor_id', v_v.id, 'status', v_q.reason, 'road_km', v_q.road_km,
        'limit_km', v_q.limit_km, 'fee_usd', v_q.fee_usd, 'pickup_enabled', v_v.pickup_enabled);
    elsif v_paused then
      v_out := v_out || jsonb_build_object('vendor_id', v_v.id, 'status', 'place_paused', 'pickup_enabled', v_v.pickup_enabled);
    else
      select * into v_route from public.route_cache_lookup(
        extensions.st_y(v_v.location::extensions.geometry), extensions.st_x(v_v.location::extensions.geometry),
        array[extensions.st_y(v_addr.pin::extensions.geometry)], array[extensions.st_x(v_addr.pin::extensions.geometry)]);
      if v_route.distance_m is null then
        v_out := v_out || jsonb_build_object('vendor_id', v_v.id, 'status', 'no_route',
          'origin', jsonb_build_object('lat', extensions.st_y(v_v.location::extensions.geometry), 'lon', extensions.st_x(v_v.location::extensions.geometry)),
          'dest', jsonb_build_object('lat', extensions.st_y(v_addr.pin::extensions.geometry), 'lon', extensions.st_x(v_addr.pin::extensions.geometry)));
      else
        select * into v_q from public.delivery_quote(v_v.id, round(v_route.distance_m / 1000.0, 2));
        v_out := v_out || jsonb_build_object('vendor_id', v_v.id, 'status', v_q.reason, 'road_km', v_q.road_km,
          'limit_km', v_q.limit_km, 'fee_usd', v_q.fee_usd, 'pickup_enabled', v_v.pickup_enabled);
      end if;
    end if;
  end loop;
  return jsonb_build_object('status', 'ok', 'vendors', v_out);
end;
$$;

create or replace function public.order_place(
  p_basket_id uuid,
  p_expected_menu_version bigint,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.orders%rowtype;
  v_basket public.baskets%rowtype;
  v_vendor public.vendors%rowtype;
  v_address public.addresses%rowtype;
  v_place_status public.service_status;
  v_priced jsonb;
  v_rate numeric := public.usd_lbp_rate();
  v_road_km numeric;
  v_quote record;
  v_delivery_fee numeric := 0;
  v_deposit numeric := 0;
  v_stairs numeric := 0;
  v_subtotal numeric;
  v_total numeric;
  v_cap numeric;
  v_new_customer boolean;
  v_weighted boolean;
  v_order public.orders%rowtype;
  v_line record;
  v_low_threshold integer := public.config_numeric('daily_qty_low_threshold')::integer;
  v_low jsonb := '[]';
  v_remaining integer;
begin
  select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
  if v_existing.id is not null and v_existing.basket_id is distinct from p_basket_id then
    raise exception 'idempotency key already used for another basket' using errcode = 'unique_violation';
  end if;
  if v_existing.id is not null then
    return jsonb_build_object('status', 'placed', 'order_id', v_existing.id, 'code', v_existing.code,
      'total_usd', v_existing.total_usd, 'total_lbp', v_existing.total_lbp, 'usd_lbp_rate', v_existing.usd_lbp_rate,
      'estimated', v_existing.weight_status <> 'none', 'repeat', true);
  end if;

  select * into v_basket from public.baskets where id = p_basket_id for update;
  if v_basket.id is null then
    raise exception 'unknown basket %', p_basket_id using errcode = 'no_data_found';
  end if;
  if v_basket.status <> 'open' then
    -- A duplicate confirmation that waited on the basket lock returns the order the first one created.
    select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object('status', 'placed', 'order_id', v_existing.id, 'code', v_existing.code,
        'total_usd', v_existing.total_usd, 'total_lbp', v_existing.total_lbp, 'usd_lbp_rate', v_existing.usd_lbp_rate,
        'estimated', v_existing.weight_status <> 'none', 'repeat', true);
    end if;
    raise exception 'basket % is %', p_basket_id, v_basket.status using errcode = 'check_violation';
  end if;
  -- Placements for one vendor run one at a time: a pause or menu change cannot slip in between the checks
  -- and the insert, and selling the last unit (which bumps the menu version on this row) cannot deadlock
  -- against another placement holding a share lock. Orders per vendor are few; the wait is milliseconds.
  select * into v_vendor from public.vendors where id = v_basket.vendor_id for no key update;

  if not v_vendor.orderable or v_vendor.listing_status <> 'active' then
    return jsonb_build_object('status', 'vendor_closed');
  end if;
  if v_vendor.paused_until is not null and v_vendor.paused_until > now() then
    return jsonb_build_object('status', 'vendor_paused', 'until', v_vendor.paused_until);
  end if;
  if (v_basket.fulfilment = 'delivery' and not v_vendor.delivery_enabled)
     or (v_basket.fulfilment = 'pickup' and not v_vendor.pickup_enabled) then
    return jsonb_build_object('status', 'fulfilment_unavailable');
  end if;
  if v_basket.payment_method <> 'cod' and not coalesce((public.config_value('online_payments_enabled') #>> '{}')::boolean, false) then
    return jsonb_build_object('status', 'online_payment_off');
  end if;

  -- Menu version check (§30.1.1): a stale summary is never charged.
  if v_vendor.menu_version <> p_expected_menu_version or v_basket.priced_menu_version is distinct from p_expected_menu_version then
    v_priced := public.basket_price(p_basket_id);
    return jsonb_build_object('status', case when jsonb_array_length(v_priced -> 'unavailable') > 0 then 'unavailable' else 'repriced' end,
      'summary', v_priced);
  end if;
  v_priced := public.basket_price(p_basket_id);
  if jsonb_array_length(v_priced -> 'unavailable') > 0 then
    return jsonb_build_object('status', 'unavailable', 'summary', v_priced);
  end if;
  if jsonb_array_length(v_priced -> 'lines') = 0 then
    return jsonb_build_object('status', 'empty_basket');
  end if;
  -- Container exchange (§29.2): the customer must answer "do you have an empty to return?" first.
  if exists (
    select 1 from public.basket_items bi join public.menu_items i on i.id = bi.item_id
    where bi.basket_id = p_basket_id and i.container_deposit_usd is not null and bi.has_empty is null
  ) then
    return jsonb_build_object('status', 'needs_empty_answer', 'items', (
      select jsonb_agg(bi.item_id) from public.basket_items bi join public.menu_items i on i.id = bi.item_id
      where bi.basket_id = p_basket_id and i.container_deposit_usd is not null and bi.has_empty is null));
  end if;
  v_subtotal := (v_priced ->> 'subtotal_usd')::numeric;
  select coalesce(sum((l ->> 'container_deposit_usd')::numeric), 0), bool_or((l ->> 'estimated')::boolean)
    into v_deposit, v_weighted from jsonb_array_elements(v_priced -> 'lines') l;

  -- Delivery: an address with a place that takes orders, a cached road route, and the vendor's radius.
  -- The staging test merchant takes any pin: no route, no radius, no paused-place block, first band's fee.
  if v_basket.fulfilment = 'delivery' then
    select * into v_address from public.addresses where id = v_basket.address_id and customer_id = v_basket.customer_id;
    if v_address.id is null or v_address.pin is null then
      return jsonb_build_object('status', 'no_address');
    end if;
    if v_vendor.is_test then
      select * into v_quote from public.delivery_quote(v_vendor.id, 0);
      v_road_km := 0;
    else
      select p.service_status into v_place_status from public.places p where p.id = v_address.place_id;
      -- §39.2: an address outside the delivery area is refused even when it is within the radius.
      if v_place_status is distinct from 'on' then
        return jsonb_build_object('status', 'place_paused');
      end if;
      select c.distance_m / 1000.0 into v_road_km
      from public.route_cache_lookup(
        extensions.st_y(v_vendor.location::extensions.geometry), extensions.st_x(v_vendor.location::extensions.geometry),
        array[extensions.st_y(v_address.pin::extensions.geometry)], array[extensions.st_x(v_address.pin::extensions.geometry)]) c;
      select * into v_quote from public.delivery_quote(v_vendor.id, round(v_road_km, 2));
      if not v_quote.deliverable then
        return jsonb_build_object('status', v_quote.reason);
      end if;
    end if;
    v_delivery_fee := v_quote.fee_usd;
    if v_basket.stairs_floors is not null and v_vendor.stairs_fee_per_floor_usd is not null then
      v_stairs := v_basket.stairs_floors * v_vendor.stairs_fee_per_floor_usd;
    end if;
  end if;

  v_total := v_subtotal + v_delivery_fee + v_deposit + v_stairs;

  -- COD caps: the per-order cap, and $50 until the number has one delivered order (§29.4).
  v_new_customer := not exists (
    select 1 from public.orders o where o.customer_id = v_basket.customer_id and o.status = 'delivered'
  );
  if v_basket.payment_method = 'cod' then
    v_cap := public.config_numeric('cod_cap_usd');
    if v_new_customer then
      v_cap := least(v_cap, public.config_numeric('cod_cap_new_number_usd'));
    end if;
    if v_total > v_cap then
      return jsonb_build_object('status', 'cod_cap', 'cap_usd', v_cap, 'total_usd', v_total, 'new_customer', v_new_customer);
    end if;
  end if;

  -- Daily quantities are decremented atomically; a race for the last units leaves the loser unavailable.
  -- Rows are locked in item-id order, one update per item (combo components summed in), so two baskets holding
  -- the same items in a different order never deadlock (session D, §38.3).
  for v_line in
    select q.item_id, sum(q.quantity)::integer as quantity
    from (
      select bi.item_id, bi.quantity from public.basket_items bi where bi.basket_id = p_basket_id
      union all
      select c.component_item_id, c.quantity * bi.quantity from public.basket_items bi
      join public.menu_combo_components c on c.combo_item_id = bi.item_id where bi.basket_id = p_basket_id
    ) q
    group by q.item_id
    order by q.item_id
  loop
    update public.menu_items i
    set daily_remaining = i.daily_remaining - v_line.quantity
    where i.id = v_line.item_id and i.daily_remaining is not null and i.daily_date = current_date
      and i.daily_remaining >= v_line.quantity
    returning i.daily_remaining into v_remaining;
    if not found then
      if exists (select 1 from public.menu_items i where i.id = v_line.item_id and i.daily_remaining is not null
                 and i.daily_date = current_date) then
        -- Lost the race for the last units: the whole placement rolls back.
        raise exception 'sold_out: item %', v_line.item_id using errcode = 'check_violation';
      end if;
    else
      if v_remaining <= v_low_threshold then
        v_low := v_low || jsonb_build_object('item_id', v_line.item_id, 'remaining', v_remaining);
      end if;
    end if;
  end loop;

  insert into public.orders (
    code, idempotency_key, basket_id, customer_id, vendor_id, status, fulfilment, delivery_mode, payment_method,
    address_id, delivery_place_id, delivery_pin, road_km, menu_version, usd_lbp_rate, food_subtotal_usd,
    delivery_fee_usd, container_deposit_usd, stairs_floors, stairs_fee_usd, total_usd, order_fee_usd, weight_status,
    estimated_total_usd, is_new_customer, customer_note, prep_minutes, placed_at
  ) values (
    app_private.new_order_code(), p_idempotency_key, v_basket.id, v_basket.customer_id, v_vendor.id,
    case when v_basket.payment_method = 'cod' then 'placed' else 'awaiting_payment' end::public.order_status,
    v_basket.fulfilment, case when v_basket.fulfilment = 'delivery' then 'merchant'::public.delivery_mode end,
    v_basket.payment_method, v_address.id, v_address.place_id, v_address.pin, round(v_road_km, 2), v_vendor.menu_version,
    v_rate, v_subtotal, v_delivery_fee, v_deposit, case when v_stairs > 0 then v_basket.stairs_floors end, v_stairs, v_total,
    public.order_fee_usd(v_vendor.id, v_subtotal), case when v_weighted then 'awaiting_weight' else 'none' end::public.weight_status,
    case when v_weighted then v_total end, v_new_customer, v_basket.customer_note, v_vendor.default_prep_minutes,
    case when v_basket.payment_method = 'cod' then now() end
  ) returning * into v_order;

  insert into public.order_items (order_id, item_id, name_ar, name_en, name_fr, quantity, pricing_unit, unit_price_usd,
    options, options_total_usd, est_weight_kg, price_per_kg_usd, line_total_usd, container_deposit_usd, has_empty, note)
  select v_order.id, i.id, i.name_ar, i.name_en, i.name_fr, bi.quantity, i.pricing_unit,
    case when i.pricing_unit = 'kg' then round(i.price_usd * i.est_weight_kg, 2) else i.price_usd end,
    coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name_ar', o.name_ar, 'name_en', o.name_en,
      'price_delta_usd', o.price_delta_usd) order by o.sort_order) from public.menu_options o where o.id = any (bi.option_ids)), '[]'),
    coalesce((select sum(o.price_delta_usd) from public.menu_options o where o.id = any (bi.option_ids)), 0),
    case when i.pricing_unit = 'kg' then i.est_weight_kg * bi.quantity end,
    case when i.pricing_unit = 'kg' then i.price_usd end,
    bi.line_total_usd,
    case when i.container_deposit_usd is not null and bi.has_empty is false then i.container_deposit_usd * bi.quantity else 0 end,
    case when i.container_deposit_usd is not null then bi.has_empty end,
    bi.note
  from public.basket_items bi join public.menu_items i on i.id = bi.item_id
  where bi.basket_id = p_basket_id;

  update public.baskets set status = 'ordered' where id = p_basket_id;
  insert into public.order_events (order_id, from_status, to_status, event, actor_kind, detail)
  values (v_order.id, null, v_order.status, 'placed', app_private.current_actor_kind(),
          jsonb_build_object('menu_version', v_order.menu_version, 'low_stock', v_low));

  return jsonb_build_object('status', 'placed', 'order_id', v_order.id, 'code', v_order.code,
    'total_usd', v_order.total_usd, 'total_lbp', v_order.total_lbp, 'usd_lbp_rate', v_order.usd_lbp_rate,
    'estimated', v_weighted, 'new_customer', v_new_customer, 'low_stock', v_low);
end;
$$;
