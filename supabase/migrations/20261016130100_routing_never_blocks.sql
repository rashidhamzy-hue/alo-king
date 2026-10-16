-- Session 5f (DECISIONS §39.15.1): routing never blocks an order. On 16 October a live checkout stopped on "I couldn't
-- work out the road route" because the browse screens and four smoke runs had used the free OpenRouteService quota.
--
-- 1. shop_place_routes: the road distance from every orderable or demo shop to the centre of every delivered-to place,
--    filled by the route-matrix workflow (ORS Matrix in batches; shop_place_routes_needed / shop_place_routes_save).
-- 2. Browse costs zero routing calls: customer_delivery_check reads the exact cached route when there is one, else the
--    shop → place distance for the place the pin snaps to (app_private.shop_road_km).
-- 3. Checkout: basket_quote and order_place use the same resolver. A shop → pin route not cached yet is quoted from the
--    place distance (route_source = place_fallback, recorded on the order); dispatch makes at most one live call for it
--    (2 s timeout, cached 30 days: route_cache_ttl_hours 720). "no_route" only when neither exists.
-- 4. routing_usage: ORS requests per UTC day against config ors_daily_budget; at ors_checkout_reserve_pct only checkout
--    may call, at 100% nothing (routing_take); crossing the reserve raises one routing_budget alert a day.
-- 5. routing_fixtures: recorded routes for simulator numbers (config routing_provider_sim = fixture), so tests never
--    spend the quota.
-- 6. A customer's pin leaves the 30-day route cache with the address (delete my data, a moved pin).

-- Config (dated rows; DECISIONS §39.15.1) ------------------------------------------------------------------------------
insert into public.app_config (key, value, effective_from, note) values
  ('route_cache_ttl_hours', '720', '2026-10-16 12:00+03', 'DECISIONS §39.15.1: roads do not move; a shop → pin route is cached 30 days (amends §3, §4 "1-24 h")'),
  ('ors_daily_budget', '400', '2026-10-16 12:00+03', 'DECISIONS §39.15.1: OpenRouteService matrix requests a UTC day we allow ourselves (free plan: 500)'),
  ('ors_checkout_reserve_pct', '60', '2026-10-16 12:00+03', 'DECISIONS §39.15.1: past this share of ors_daily_budget only checkout may call ORS'),
  ('route_live_timeout_ms', '2000', '2026-10-16 12:00+03', 'DECISIONS §39.15.1: the one live route call at checkout gives up after 2 s'),
  ('route_live_retry_minutes', '10', '2026-10-16 12:00+03', 'Session 5f: a failed live call for the same shop and pin is not repeated sooner (Try again forces it)'),
  ('routing_provider_sim', '"fixture"', '2026-10-16 12:00+03', 'DECISIONS §39.15.1: simulator numbers (+999) get routes from routing_fixtures, never from ORS'),
  ('shop_place_route_max_shift_m', '250', '2026-10-16 12:00+03', 'Session 5f: a shop → place distance stays usable while the shop''s pin moved less than this')
on conflict do nothing;

-- 1. Shop → place road distances -----------------------------------------------------------------------------------------
create table public.shop_place_routes (
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  place_id text not null references public.places (id) on delete cascade,
  -- Null: the provider found no road between the two (asked again after a week, never guessed).
  road_km numeric(7, 3) check (road_km >= 0),
  minutes numeric(6, 1) check (minutes >= 0),
  provider text not null check (provider ~ '^[a-z][a-z0-9_]*$'),
  -- The shop's pin and the place's centre the distance was computed between.
  origin extensions.geography(point, 4326) not null,
  dest extensions.geography(point, 4326) not null,
  computed_on timestamptz not null default now(),
  primary key (vendor_id, place_id),
  constraint shop_place_routes_both check ((road_km is null) = (minutes is null))
);
create index shop_place_routes_place_idx on public.shop_place_routes (place_id);
alter table public.shop_place_routes enable row level security;
revoke all on public.shop_place_routes from public, anon, authenticated;
grant all on public.shop_place_routes to service_role;

-- Which shops count: orderable or demo shops (DECISIONS §39.12), never the test merchant (any pin, no road check).
-- p_scope 'all' adds every Shouf merchant in the pilot villages, for a full precompute before claims.
create function app_private.route_matrix_shops(p_scope text default 'active')
returns table (vendor_id uuid, lat double precision, lon double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, extensions.st_y(v.location::extensions.geometry), extensions.st_x(v.location::extensions.geometry)
  from public.vendors v
  where not v.is_test and v.location is not null
    and (v.orderable
      or v.id::text in (select jsonb_array_elements_text(coalesce(public.config_value('demo_shops'), '[]'::jsonb)))
      or (p_scope = 'all' and v.town_id in (
        select jsonb_array_elements_text(coalesce(public.config_value('pilot_merchant_place_ids'), '[]'::jsonb)))))
  order by v.id;
$$;
revoke all on function app_private.route_matrix_shops(text) from public, anon, authenticated;

-- The shop × place pairs to compute: missing, the shop's pin moved, the place's centre moved, or no road found a week
-- ago. Delivered-to places only (§39.2).
create function public.shop_place_routes_needed(p_scope text default 'active')
returns table (vendor_id uuid, origin_lat double precision, origin_lon double precision,
  place_id text, dest_lat double precision, dest_lon double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select s.vendor_id, s.lat, s.lon, p.id,
    extensions.st_y(p.centroid::extensions.geometry), extensions.st_x(p.centroid::extensions.geometry)
  from app_private.route_matrix_shops(p_scope) s
  cross join public.places p
  left join public.shop_place_routes r on r.vendor_id = s.vendor_id and r.place_id = p.id
  where p.service_status = 'on'
    and (r.vendor_id is null
      or not extensions.st_dwithin(r.origin, app_private.lat_lon_point(s.lat, s.lon), 25)
      or not extensions.st_dwithin(r.dest, p.centroid, 25)
      or (r.road_km is null and r.computed_on < now() - interval '7 days'))
  order by s.vendor_id, p.id;
$$;
revoke all on function public.shop_place_routes_needed(text) from public, anon, authenticated;
grant execute on function public.shop_place_routes_needed(text) to service_role;

-- Saves computed pairs: [{vendor_id, place_id, road_km|null, minutes|null, origin_lat, origin_lon, dest_lat, dest_lon}].
create function public.shop_place_routes_save(p_rows jsonb, p_provider text default 'ors') returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a json array' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.shop_place_routes (vendor_id, place_id, road_km, minutes, provider, origin, dest, computed_on)
  select (r ->> 'vendor_id')::uuid, r ->> 'place_id', round((r ->> 'road_km')::numeric, 3), round((r ->> 'minutes')::numeric, 1),
    p_provider,
    app_private.lat_lon_point((r ->> 'origin_lat')::double precision, (r ->> 'origin_lon')::double precision),
    app_private.lat_lon_point((r ->> 'dest_lat')::double precision, (r ->> 'dest_lon')::double precision), now()
  from jsonb_array_elements(p_rows) r
  on conflict (vendor_id, place_id) do update
    set road_km = excluded.road_km, minutes = excluded.minutes, provider = excluded.provider,
        origin = excluded.origin, dest = excluded.dest, computed_on = excluded.computed_on;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.shop_place_routes_save(jsonb, text) from public, anon, authenticated;
grant execute on function public.shop_place_routes_save(jsonb, text) to service_role;

-- 2. One resolver for every quote --------------------------------------------------------------------------------------
-- Road km from a shop to a delivery address: the exact cached route (ORS, the doorstep or a simulator fixture), else the
-- shop → place distance of the place the pin snaps to (route_source = place_fallback), else nothing. Never a straight
-- line (§28.6). The place distance is used only while the shop's pin is where it was computed from.
create function app_private.shop_road_km(p_vendor_id uuid, p_address_id uuid)
returns table (road_km numeric, source text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_loc extensions.geography;
  v_pin extensions.geography;
  v_place text;
  v_route record;
  v_km numeric;
begin
  select v.location into v_loc from public.vendors v where v.id = p_vendor_id;
  select a.pin, a.place_id into v_pin, v_place from public.addresses a where a.id = p_address_id;
  if v_loc is null or v_pin is null then
    return;
  end if;
  select c.distance_m, c.provider into v_route from public.route_cache_lookup(
    extensions.st_y(v_loc::extensions.geometry), extensions.st_x(v_loc::extensions.geometry),
    array[extensions.st_y(v_pin::extensions.geometry)], array[extensions.st_x(v_pin::extensions.geometry)]) c;
  if v_route.distance_m is not null then
    road_km := round(v_route.distance_m / 1000.0, 2);
    source := coalesce(v_route.provider, 'ors');
    return next;
    return;
  end if;
  select r.road_km into v_km from public.shop_place_routes r
  where r.vendor_id = p_vendor_id and r.place_id = v_place and r.road_km is not null
    and extensions.st_dwithin(r.origin, v_loc, public.config_numeric('shop_place_route_max_shift_m')::double precision);
  if v_km is not null then
    road_km := round(v_km, 2);
    source := 'place_fallback';
    return next;
  end if;
end;
$$;
revoke all on function app_private.shop_road_km(uuid, uuid) from public, anon, authenticated;

-- The shop's pin and the customer's pin, for the one live call (dispatch); null without both.
create function app_private.route_pair(p_vendor_id uuid, p_address_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'origin', jsonb_build_object('lat', extensions.st_y(v.location::extensions.geometry), 'lon', extensions.st_x(v.location::extensions.geometry)),
    'dest', jsonb_build_object('lat', extensions.st_y(a.pin::extensions.geometry), 'lon', extensions.st_x(a.pin::extensions.geometry)))
  from public.vendors v, public.addresses a
  where v.id = p_vendor_id and a.id = p_address_id and v.location is not null and a.pin is not null;
$$;
revoke all on function app_private.route_pair(uuid, uuid) from public, anon, authenticated;

alter table public.orders add column route_source text check (route_source ~ '^[a-z][a-z0-9_]*$');
comment on column public.orders.route_source is
  'Where the road km came from (DECISIONS §39.15.1): ors, doorstep, fixture (simulator), place_fallback, test';

-- The cache keeps a route up to 30 days now (route_cache_ttl_hours), within route_cache_store's new 720 h ceiling.
create or replace function public.route_cache_store(
  p_origin_lat double precision,
  p_origin_lon double precision,
  p_dest_lats double precision[],
  p_dest_lons double precision[],
  p_distances_m integer[],
  p_durations_s integer[],
  p_provider text,
  p_profile text default 'driving-car'
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ttl numeric := least(greatest(public.config_numeric('route_cache_ttl_hours'), 1), 720);
  v_origin extensions.geography := app_private.lat_lon_point(p_origin_lat, p_origin_lon);
  n integer;
begin
  if cardinality(p_dest_lats) is distinct from cardinality(p_dest_lons)
     or cardinality(p_dest_lats) is distinct from cardinality(p_distances_m)
     or cardinality(p_dest_lats) is distinct from cardinality(p_durations_s) then
    raise exception 'destinations, distances and durations must have the same length' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.route_cache (profile, origin_key, dest_key, origin, dest, distance_m, duration_s, provider, fetched_at, expires_at)
  select p_profile, app_private.route_point_key(v_origin), app_private.route_point_key(app_private.lat_lon_point(d.lat, d.lon)),
    v_origin, app_private.lat_lon_point(d.lat, d.lon),
    d.dist, d.dur, p_provider, now(), now() + make_interval(secs => (v_ttl * 3600)::double precision)
  from unnest(p_dest_lats, p_dest_lons, p_distances_m, p_durations_s) as d (lat, lon, dist, dur)
  where d.dist is not null and d.dur is not null
  on conflict (profile, origin_key, dest_key) do update
    set origin = excluded.origin, dest = excluded.dest, distance_m = excluded.distance_m,
        duration_s = excluded.duration_s, provider = excluded.provider,
        fetched_at = excluded.fetched_at, expires_at = excluded.expires_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 6. A customer's pin leaves the cache with the address (§28.3 "delete my data", a pin moved). The cache holds no
-- customer link, only the pin rounded to about 11 m; other pins of the same spot are asked again if they come back.
create index route_cache_dest_key_idx on public.route_cache (dest_key);
create function app_private.addresses_forget_routes() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.pin is not null and (tg_op = 'DELETE' or new.pin is distinct from old.pin) then
    delete from public.route_cache c where c.dest_key = app_private.route_point_key(old.pin);
  end if;
  return null;
end;
$$;
revoke all on function app_private.addresses_forget_routes() from public, anon, authenticated;
create trigger addresses_forget_routes after delete or update of pin on public.addresses
  for each row execute function app_private.addresses_forget_routes();

-- 4. The daily budget ---------------------------------------------------------------------------------------------------
create table public.routing_usage (
  day date primary key,
  requests integer not null default 0 check (requests >= 0),
  checkout integer not null default 0 check (checkout >= 0),
  matrix integer not null default 0 check (matrix >= 0),
  other integer not null default 0 check (other >= 0),
  -- Calls we did not make (budget spent, reserved for checkout).
  refused integer not null default 0 check (refused >= 0),
  reserve_crossed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.routing_usage enable row level security;
revoke all on public.routing_usage from public, anon, authenticated;
grant select on public.routing_usage to service_role;

-- A live call for the same shop and pin is not repeated within route_live_retry_minutes (unless forced by Try again).
create table app_private.route_live_attempts (
  origin_key text not null,
  dest_key text not null,
  tried_at timestamptz not null default now(),
  primary key (origin_key, dest_key)
);
alter table app_private.route_live_attempts enable row level security;
revoke all on app_private.route_live_attempts from public, anon, authenticated;

-- Counts n requests for the day; the first count past the reserve raises one operator alert (Slack) for the day.
create function app_private.routing_usage_count(p_day date, p_purpose text, p_n integer) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_budget numeric := public.config_numeric('ors_daily_budget');
  v_reserve numeric := floor(v_budget * public.config_numeric('ors_checkout_reserve_pct') / 100);
  v_before integer;
  v_after integer;
begin
  update public.routing_usage
  set requests = requests + p_n,
      checkout = checkout + case when p_purpose = 'checkout' then p_n else 0 end,
      matrix = matrix + case when p_purpose = 'matrix' then p_n else 0 end,
      other = other + case when p_purpose not in ('checkout', 'matrix') then p_n else 0 end,
      updated_at = now()
  where day = p_day
  returning requests - p_n, requests into v_before, v_after;
  if v_before < v_reserve and v_after >= v_reserve then
    update public.routing_usage set reserve_crossed_at = now() where day = p_day;
    perform app_private.ops_alert('routing_budget:' || p_day, 'routing_budget', 'warning',
      format('OpenRouteService: %s of %s requests used today (UTC); only checkout may call it now, browse reads shop_place_routes',
        v_after, v_budget::integer), null, null,
      jsonb_build_object('day', p_day, 'requests', v_after, 'budget', v_budget));
  end if;
end;
$$;
revoke all on function app_private.routing_usage_count(date, text, integer) from public, anon, authenticated;

-- May dispatch make one live ORS call now? Checkout only past the reserve, nothing past the budget, and never the same
-- shop → pin twice within route_live_retry_minutes unless p_force (the customer tapped Try again).
create function public.routing_take(
  p_purpose text,
  p_origin_lat double precision,
  p_origin_lon double precision,
  p_dest_lat double precision,
  p_dest_lon double precision,
  p_force boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_budget numeric := public.config_numeric('ors_daily_budget');
  v_reserve numeric := floor(v_budget * public.config_numeric('ors_checkout_reserve_pct') / 100);
  v_ok_key text := app_private.route_point_key(app_private.lat_lon_point(p_origin_lat, p_origin_lon));
  v_dk_key text := app_private.route_point_key(app_private.lat_lon_point(p_dest_lat, p_dest_lon));
  v_used integer;
begin
  if p_purpose is null or p_purpose !~ '^[a-z][a-z_]{1,30}$' or p_purpose = 'matrix' then
    raise exception 'unknown routing purpose %', p_purpose using errcode = 'invalid_parameter_value';
  end if;
  if not coalesce(p_force, false) and exists (
    select 1 from app_private.route_live_attempts a
    where a.origin_key = v_ok_key and a.dest_key = v_dk_key
      and a.tried_at > now() - make_interval(mins => public.config_numeric('route_live_retry_minutes')::integer)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'recent_attempt');
  end if;
  insert into public.routing_usage (day) values (v_day) on conflict (day) do nothing;
  select u.requests into v_used from public.routing_usage u where u.day = v_day for update;
  if v_used >= v_budget or (p_purpose <> 'checkout' and v_used >= v_reserve) then
    update public.routing_usage set refused = refused + 1, updated_at = now() where day = v_day;
    return jsonb_build_object('ok', false, 'reason', case when v_used >= v_budget then 'budget' else 'reserved' end,
      'used', v_used, 'budget', v_budget);
  end if;
  perform app_private.routing_usage_count(v_day, p_purpose, 1);
  insert into app_private.route_live_attempts (origin_key, dest_key, tried_at) values (v_ok_key, v_dk_key, now())
  on conflict (origin_key, dest_key) do update set tried_at = excluded.tried_at;
  -- Old attempts are only a guard against repeats: keep the table small.
  delete from app_private.route_live_attempts a where a.tried_at < now() - interval '1 day';
  return jsonb_build_object('ok', true, 'used', v_used + 1, 'budget', v_budget);
end;
$$;
revoke all on function public.routing_take(text, double precision, double precision, double precision, double precision, boolean)
  from public, anon, authenticated;
grant execute on function public.routing_take(text, double precision, double precision, double precision, double precision, boolean)
  to service_role;

-- The route-matrix workflow asks for p_n requests and gets at most what is left below the checkout reserve (it never
-- eats into checkout's share); the granted number is counted at once.
create function public.routing_matrix_take(p_n integer) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_reserve numeric := floor(public.config_numeric('ors_daily_budget') * public.config_numeric('ors_checkout_reserve_pct') / 100);
  v_used integer;
  v_grant integer;
begin
  if p_n is null or p_n < 0 then
    raise exception 'p_n must be zero or more' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.routing_usage (day) values (v_day) on conflict (day) do nothing;
  select u.requests into v_used from public.routing_usage u where u.day = v_day for update;
  v_grant := greatest(0, least(p_n, v_reserve::integer - v_used));
  if v_grant > 0 then
    perform app_private.routing_usage_count(v_day, 'matrix', v_grant);
  end if;
  return v_grant;
end;
$$;
revoke all on function public.routing_matrix_take(integer) from public, anon, authenticated;
grant execute on function public.routing_matrix_take(integer) to service_role;

-- 5. Recorded routes for simulator numbers -------------------------------------------------------------------------------
create table public.routing_fixtures (
  origin_key text not null,
  dest_key text not null,
  distance_m integer not null check (distance_m >= 0),
  duration_s integer not null check (duration_s >= 0),
  source text not null default 'recorded' check (source ~ '^[a-z][a-z0-9_]*$'),
  recorded_at timestamptz not null default now(),
  primary key (origin_key, dest_key)
);
alter table public.routing_fixtures enable row level security;
revoke all on public.routing_fixtures from public, anon, authenticated;
grant all on public.routing_fixtures to service_role;

create function public.routing_fixture_lookup(
  p_origin_lat double precision,
  p_origin_lon double precision,
  p_dest_lats double precision[],
  p_dest_lons double precision[]
)
returns table (idx integer, distance_m integer, duration_s integer)
language sql
stable
security definer
set search_path = ''
as $$
  select d.idx::integer, f.distance_m, f.duration_s
  from unnest(p_dest_lats, p_dest_lons) with ordinality as d (lat, lon, idx)
  left join public.routing_fixtures f
    on f.origin_key = app_private.route_point_key(app_private.lat_lon_point(p_origin_lat, p_origin_lon))
   and f.dest_key = app_private.route_point_key(app_private.lat_lon_point(d.lat, d.lon))
  order by d.idx;
$$;
revoke all on function public.routing_fixture_lookup(double precision, double precision, double precision[], double precision[])
  from public, anon, authenticated;
grant execute on function public.routing_fixture_lookup(double precision, double precision, double precision[], double precision[])
  to service_role;

-- Staging fixture (supabase/test-fixtures/routing-fixtures.sql): every route OpenRouteService gave us, kept as a fixture.
create function app_private.routing_fixtures_record() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.routing_fixtures (origin_key, dest_key, distance_m, duration_s, source)
  select c.origin_key, c.dest_key, c.distance_m, c.duration_s, 'recorded'
  from public.route_cache c
  where c.provider = 'ors' and c.profile = 'driving-car'
  on conflict (origin_key, dest_key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function app_private.routing_fixtures_record() from public, anon, authenticated;

-- 2-3. The quotes and the order use the resolver (as in 20261014200000 and 20261015140100, with the resolver) --------
CREATE OR REPLACE FUNCTION public.customer_delivery_check(p_customer_id uuid, p_vendor_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pt jsonb := public.customer_search_point(p_customer_id);
  v_addr public.addresses%rowtype;
  v_out jsonb := '[]';
  v_v record;
  v_rk record;
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
      -- Browse never calls a routing service (§39.15.1): the exact cached route, else the shop → place distance.
      select * into v_rk from app_private.shop_road_km(v_v.id, v_addr.id);
      if v_rk.road_km is null then
        v_out := v_out || jsonb_build_object('vendor_id', v_v.id, 'status', 'no_route', 'pickup_enabled', v_v.pickup_enabled);
      else
        select * into v_q from public.delivery_quote(v_v.id, v_rk.road_km);
        v_out := v_out || jsonb_build_object('vendor_id', v_v.id, 'status', v_q.reason, 'road_km', v_q.road_km,
          'limit_km', v_q.limit_km, 'fee_usd', v_q.fee_usd, 'pickup_enabled', v_v.pickup_enabled, 'route_source', v_rk.source);
      end if;
    end if;
  end loop;
  return jsonb_build_object('status', 'ok', 'vendors', v_out);
end;
$function$;

CREATE OR REPLACE FUNCTION public.basket_quote(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_basket public.baskets%rowtype;
  v_vendor public.vendors%rowtype;
  v_address public.addresses%rowtype;
  v_view jsonb;
  v_route record;
  v_quote record;
  v_subtotal numeric;
  v_offer_id uuid;
  v_offer_usd numeric := 0;
  v_min numeric;
  v_deposit numeric;
  v_stairs numeric := 0;
  v_fee numeric := 0;
  v_credit numeric := 0;
  v_total numeric;
  v_rate numeric := public.usd_lbp_rate();
  v_new boolean;
  v_cap numeric;
  v_road numeric;
  v_test boolean;
  v_source text;
  v_live jsonb;
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
  -- The merchant's minimum order (§39.7), on the food before any offer.
  select o.min_order_usd into v_min from public.vendor_ops o where o.vendor_id = v_basket.vendor_id;
  if v_min is not null and v_subtotal < v_min then
    return jsonb_build_object('status', 'below_minimum', 'basket', v_view, 'min_order_usd', v_min, 'subtotal_usd', v_subtotal,
      'missing_usd', v_min - v_subtotal);
  end if;
  -- The best running merchant offer (§20.4: merchant-funded, priced here from the server's lines).
  select f.offer_id, f.amount_usd into v_offer_id, v_offer_usd from app_private.offer_for_basket(v_basket.id) f;
  v_offer_usd := coalesce(v_offer_usd, 0);
  update public.baskets set quoted_offer_usd = v_offer_usd, quoted_offer_id = v_offer_id where id = v_basket.id;
  select coalesce(sum(case when (l ->> 'has_empty')::boolean is false then (l ->> 'deposit_usd')::numeric * (l ->> 'quantity')::int else 0 end), 0)
    into v_deposit from jsonb_array_elements(v_view -> 'lines') l;
  if v_basket.fulfilment = 'delivery' then
    select * into v_address from public.addresses where id = v_basket.address_id;
    if v_address.id is null or v_address.pin is null then
      return jsonb_build_object('status', 'no_address', 'basket', v_view);
    end if;
    if v_test then
      select * into v_quote from public.delivery_quote(v_vendor.id, 0);
      v_road := 0;
      v_source := 'test';
      v_fee := v_quote.fee_usd;
    else
      if not app_private.place_delivered_to(v_address.place_id) then
        return jsonb_build_object('status', 'place_paused', 'basket', v_view);
      end if;
      -- The exact route, else the shop → place distance (§39.15.1). When the exact one is not cached yet, the pins go back
      -- with the quote: dispatch makes its one live call and quotes again; a failure keeps the place distance.
      select * into v_route from app_private.shop_road_km(v_vendor.id, v_address.id);
      v_source := v_route.source;
      if v_source is null or v_source = 'place_fallback' then
        v_live := app_private.route_pair(v_vendor.id, v_address.id);
      end if;
      if v_route.road_km is null then
        return jsonb_build_object('status', 'no_route', 'basket', v_view) || coalesce(v_live, '{}'::jsonb);
      end if;
      select * into v_quote from public.delivery_quote(v_vendor.id, v_route.road_km);
      if not v_quote.deliverable then
        return jsonb_build_object('status', v_quote.reason, 'basket', v_view, 'limit_km', v_quote.limit_km,
          'road_km', v_quote.road_km, 'pickup_enabled', v_vendor.pickup_enabled, 'route_source', v_source)
          || coalesce(v_live, '{}'::jsonb);
      end if;
      v_road := v_route.road_km;
      v_fee := v_quote.fee_usd;
    end if;
    v_stairs := app_private.stairs_fee_usd(v_basket.id);
  end if;
  select coalesce(sum(c.amount_usd), 0) into v_credit from app_private.credits_for(p_customer_id, v_subtotal - v_offer_usd) c;
  v_total := v_subtotal - v_offer_usd + v_fee + v_deposit + v_stairs - v_credit;
  v_new := not exists (select 1 from public.orders o where o.customer_id = p_customer_id and o.status = 'delivered');
  v_cap := public.config_numeric('cod_cap_usd');
  if v_new then
    v_cap := least(v_cap, public.config_numeric('cod_cap_new_number_usd'));
  end if;
  return jsonb_build_object('status', 'ok', 'basket', v_view, 'subtotal_usd', v_subtotal, 'delivery_fee_usd', v_fee,
    'deposit_usd', v_deposit, 'stairs_fee_usd', v_stairs, 'offer_usd', v_offer_usd, 'offer_id', v_offer_id,
    'offer', (select jsonb_build_object('kind', f.kind, 'percent', f.percent) from public.vendor_offers f where f.id = v_offer_id),
    'credit_usd', v_credit, 'total_usd', v_total, 'usd_lbp_rate', v_rate,
    'total_lbp', round(v_total * v_rate, 0), 'road_km', v_road,
    'cod_cap_usd', v_cap, 'over_cod_cap', v_basket.payment_method = 'cod' and v_total > v_cap,
    'estimated', exists (select 1 from jsonb_array_elements(v_view -> 'lines') l where (l ->> 'estimated')::boolean),
    'needs_empty_answer', exists (select 1 from jsonb_array_elements(v_view -> 'lines') l where (l ->> 'needs_empty_answer')::boolean),
    'stairs_fee_per_floor_usd', v_vendor.stairs_fee_per_floor_usd,
    'is_gift', v_basket.is_gift, 'recipient_name', v_basket.recipient_name, 'allergy_note', app_private.basket_allergy_note(v_basket.id),
    'address', case when v_address.id is not null then public.address_card(v_address.id) end)
    || jsonb_build_object('route_source', v_source) || coalesce(v_live, '{}'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.order_place(p_basket_id uuid, p_expected_menu_version bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing public.orders%rowtype;
  v_basket public.baskets%rowtype;
  v_vendor public.vendors%rowtype;
  v_address public.addresses%rowtype;
  v_place_status public.service_status;
  v_priced jsonb;
  v_rate numeric := public.usd_lbp_rate();
  v_road_km numeric;
  v_route_source text;
  v_quote record;
  v_delivery_fee numeric := 0;
  v_deposit numeric := 0;
  v_stairs numeric := 0;
  v_credit numeric := 0;
  v_credit_ids uuid[] := '{}';
  v_subtotal numeric;
  v_offer_id uuid;
  v_offer_usd numeric := 0;
  v_min numeric;
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
    select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object('status', 'placed', 'order_id', v_existing.id, 'code', v_existing.code,
        'total_usd', v_existing.total_usd, 'total_lbp', v_existing.total_lbp, 'usd_lbp_rate', v_existing.usd_lbp_rate,
        'estimated', v_existing.weight_status <> 'none', 'repeat', true);
    end if;
    raise exception 'basket % is %', p_basket_id, v_basket.status using errcode = 'check_violation';
  end if;
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
  -- A gift is placed only from the recipient's acceptance (gift_respond), never from the sender's own Confirm tap.
  if v_basket.is_gift and p_idempotency_key not like 'gift:%' then
    return jsonb_build_object('status', 'gift_needs_recipient');
  end if;
  -- The delivery address is confirmed on every order (§39.6).
  if v_basket.fulfilment = 'delivery' and not app_private.basket_address_confirmed(v_basket.id) then
    return jsonb_build_object('status', 'address_unconfirmed');
  end if;

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
  if exists (
    select 1 from public.basket_items bi join public.menu_items i on i.id = bi.item_id
    where bi.basket_id = p_basket_id and i.container_deposit_usd is not null and bi.has_empty is null
  ) then
    return jsonb_build_object('status', 'needs_empty_answer', 'items', (
      select jsonb_agg(bi.item_id) from public.basket_items bi join public.menu_items i on i.id = bi.item_id
      where bi.basket_id = p_basket_id and i.container_deposit_usd is not null and bi.has_empty is null));
  end if;
  v_subtotal := (v_priced ->> 'subtotal_usd')::numeric;
  select o.min_order_usd into v_min from public.vendor_ops o where o.vendor_id = v_basket.vendor_id;
  if v_min is not null and v_subtotal < v_min then
    return jsonb_build_object('status', 'below_minimum', 'min_order_usd', v_min, 'missing_usd', v_min - v_subtotal);
  end if;
  select f.offer_id, f.amount_usd into v_offer_id, v_offer_usd from app_private.offer_for_basket(v_basket.id) f;
  v_offer_usd := coalesce(v_offer_usd, 0);
  -- The customer confirmed the total with the quoted offer: a different offer now is a new price, never a surprise.
  if coalesce(v_basket.quoted_offer_usd, 0) <> v_offer_usd or v_basket.quoted_offer_id is distinct from v_offer_id then
    return jsonb_build_object('status', 'repriced', 'offer_usd', v_offer_usd);
  end if;
  select coalesce(sum((l ->> 'container_deposit_usd')::numeric), 0), bool_or((l ->> 'estimated')::boolean)
    into v_deposit, v_weighted from jsonb_array_elements(v_priced -> 'lines') l;

  if v_basket.fulfilment = 'delivery' then
    select * into v_address from public.addresses where id = v_basket.address_id and customer_id = v_basket.customer_id;
    if v_address.id is null or v_address.pin is null then
      return jsonb_build_object('status', 'no_address');
    end if;
    if v_vendor.is_test then
      select * into v_quote from public.delivery_quote(v_vendor.id, 0);
      v_road_km := 0;
      v_route_source := 'test';
    else
      select p.service_status into v_place_status from public.places p where p.id = v_address.place_id;
      if v_place_status is distinct from 'on' then
        return jsonb_build_object('status', 'place_paused');
      end if;
      -- The same resolver as the quote (§39.15.1); a place-distance order records route_source = place_fallback.
      select r.road_km, r.source into v_road_km, v_route_source from app_private.shop_road_km(v_vendor.id, v_address.id) r;
      select * into v_quote from public.delivery_quote(v_vendor.id, v_road_km);
      if not v_quote.deliverable then
        return jsonb_build_object('status', v_quote.reason);
      end if;
    end if;
    v_delivery_fee := v_quote.fee_usd;
    -- §38.3 rule from config; the merchant's per-floor field only says that it carries upstairs.
    v_stairs := app_private.stairs_fee_usd(v_basket.id);
  end if;

  -- Customer credits (disputes, §38.3): a discount on this order, each credit used whole.
  select coalesce(sum(c.amount_usd), 0), coalesce(array_agg(c.credit_id), '{}') into v_credit, v_credit_ids
  from app_private.credits_for(v_basket.customer_id, v_subtotal - v_offer_usd) c;

  v_total := v_subtotal - v_offer_usd + v_delivery_fee + v_deposit + v_stairs - v_credit;

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
    address_id, delivery_place_id, delivery_pin, road_km, route_source, menu_version, usd_lbp_rate, food_subtotal_usd,
    delivery_fee_usd, container_deposit_usd, stairs_floors, stairs_fee_usd, credit_usd, offer_id, offer_usd, discount_usd, total_usd, order_fee_usd, weight_status,
    estimated_total_usd, is_new_customer, customer_note, prep_minutes, placed_at
  ) values (
    app_private.new_order_code(), p_idempotency_key, v_basket.id, v_basket.customer_id, v_vendor.id,
    case when v_basket.payment_method = 'cod' then 'placed' else 'awaiting_payment' end::public.order_status,
    v_basket.fulfilment, case when v_basket.fulfilment = 'delivery' then 'merchant'::public.delivery_mode end,
    v_basket.payment_method, v_address.id, v_address.place_id, v_address.pin, round(v_road_km, 2), v_route_source, v_vendor.menu_version,
    v_rate, v_subtotal, v_delivery_fee, v_deposit, case when v_stairs > 0 then v_basket.stairs_floors end, v_stairs, v_credit, v_offer_id, v_offer_usd, v_credit + v_offer_usd, v_total,
    -- The commission is on the food the merchant actually sells, after its own offer.
    public.order_fee_usd(v_vendor.id, v_subtotal - v_offer_usd), case when v_weighted then 'awaiting_weight' else 'none' end::public.weight_status,
    case when v_weighted then v_total end, v_new_customer, v_basket.customer_note, v_vendor.default_prep_minutes,
    case when v_basket.payment_method = 'cod' then now() end
  ) returning * into v_order;

  if cardinality(v_credit_ids) > 0 then
    update public.customer_credits set used_order_id = v_order.id where id = any (v_credit_ids);
  end if;

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
          jsonb_build_object('menu_version', v_order.menu_version, 'low_stock', v_low, 'credit_usd', v_credit, 'offer_usd', v_offer_usd));

  return jsonb_build_object('status', 'placed', 'order_id', v_order.id, 'code', v_order.code,
    'total_usd', v_order.total_usd, 'total_lbp', v_order.total_lbp, 'usd_lbp_rate', v_order.usd_lbp_rate,
    'estimated', v_weighted, 'new_customer', v_new_customer, 'low_stock', v_low, 'credit_usd', v_credit);
end;
$function$;
