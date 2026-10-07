-- Phase 1b route distances and location intelligence (DECISIONS §1, §3, §16, §28).
-- 1. Route cache: road distance and duration from OpenRouteService, pin to pin, cached 1-24 h, never
--    straight-line. `delivery_quote()` turns a road distance into the fee band and the radius check.
-- 2. The location knowledge base (§28.5): addresses, door points, buildings, landmarks, street and place
--    aliases, evidence, travel/prep/handover statistics and road incidents, with the promotion functions
--    and a nightly job. Tables start empty; orders and drivers fill them from Phases 2, 3a and 5.

create extension if not exists pg_cron;

-- Config: every threshold of §28.1 is a dated config row, so only the promotion rules change (§28.4).
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS §3, §28, 7 October 2026', false);
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('route_cache_ttl_hours', '12', '2026-10-07 00:00+03', 'Route cache lifetime, within the 1-24 h of DECISIONS §3, §4', null),
  ('eta_default_factor', '1.0', '2026-10-07 00:00+03', 'ORS duration multiplier until a cell has enough trips (DECISIONS §28.1); 1.0 until real trips exist', null),
  ('loc_door_max_accuracy_m', '30', '2026-10-07 00:00+03', 'Door point: driver GPS accuracy at Delivered (DECISIONS §28.1)', null),
  ('loc_door_radius_m', '25', '2026-10-07 00:00+03', 'Door point: deliveries within this distance agree (DECISIONS §28.1)', null),
  ('loc_door_min_deliveries', '2', '2026-10-07 00:00+03', 'Door point: agreeing deliveries to confirm (DECISIONS §28.1)', null),
  ('loc_building_radius_m', '15', '2026-10-07 00:00+03', 'Building: door points within this distance (DECISIONS §28.1)', null),
  ('loc_building_min_customers', '3', '2026-10-07 00:00+03', 'Building: distinct customers to confirm, or 1 customer + 1 driver (DECISIONS §28.1)', null),
  ('loc_landmark_radius_m', '150', '2026-10-07 00:00+03', 'Landmark: supporting pins within this distance (DECISIONS §28.1)', null),
  ('loc_landmark_min_customers', '2', '2026-10-07 00:00+03', 'Landmark: distinct customers to confirm, or a merchant or driver (DECISIONS §28.1)', null),
  ('loc_street_max_distance_m', '40', '2026-10-07 00:00+03', 'Street alias: mention pin within this distance of the OSM road (DECISIONS §28.1)', null),
  ('loc_street_min_orders', '3', '2026-10-07 00:00+03', 'Street alias: distinct orders to confirm (DECISIONS §28.1)', null),
  ('loc_alias_min_customers', '3', '2026-10-07 00:00+03', 'Place alias: distinct customers to confirm (DECISIONS §28.1)', null),
  ('loc_shared_min_people', '3', '2026-10-07 00:00+03', 'Shared knowledge needs this many distinct people (DECISIONS §28.3)', null),
  ('loc_travel_min_trips', '20', '2026-10-07 00:00+03', 'Travel time correction: trips per cell (DECISIONS §28.1)', null),
  ('loc_prep_min_orders', '20', '2026-10-07 00:00+03', 'Prep time: orders per cell (DECISIONS §28.1)', null),
  ('loc_handover_min_deliveries', '5', '2026-10-07 00:00+03', 'Handover time: deliveries per building or place (DECISIONS §28.1)', null),
  ('loc_incident_ttl_hours', '6', '2026-10-07 00:00+03', 'Road incident lifetime unless re-reported (DECISIONS §28.1)', null),
  ('loc_landmark_describe_radius_m', '750', '2026-10-07 00:00+03', 'Nearest landmark used to describe a pin (DECISIONS §16)', null);
select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);

-- 1. Route cache ----------------------------------------------------------------------------------------
-- Points are keyed to 4 decimals (about 11 m), so nearby pins of the same building share an entry.
create function app_private.route_point_key(p extensions.geography) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select to_char(round(extensions.st_y(p::extensions.geometry)::numeric, 4), 'FM990.0000') || ','
      || to_char(round(extensions.st_x(p::extensions.geometry)::numeric, 4), 'FM990.0000');
$$;

create table public.route_cache (
  id bigint generated always as identity primary key,
  profile text not null default 'driving-car' check (profile in ('driving-car', 'cycling-regular', 'foot-walking')),
  origin_key text not null,
  dest_key text not null,
  origin extensions.geography(point, 4326) not null,
  dest extensions.geography(point, 4326) not null,
  distance_m integer not null check (distance_m >= 0),
  duration_s integer not null check (duration_s >= 0),
  provider text not null check (provider ~ '^[a-z][a-z0-9_]*$'),
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint route_cache_unique unique (profile, origin_key, dest_key)
);
create index route_cache_expires_idx on public.route_cache (expires_at);

-- Builds a WGS84 point from latitude and longitude (the JSON-friendly form edge functions send).
create function app_private.lat_lon_point(p_lat double precision, p_lon double precision) returns extensions.geography
language sql
immutable
parallel safe
set search_path = ''
as $$
  select extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;
$$;

-- Cached routes from one origin to many destinations, in the order given; null where missing or expired.
create function public.route_cache_lookup(
  p_origin_lat double precision,
  p_origin_lon double precision,
  p_dest_lats double precision[],
  p_dest_lons double precision[],
  p_profile text default 'driving-car'
)
returns table (idx integer, distance_m integer, duration_s integer, provider text)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.idx::integer, c.distance_m, c.duration_s, c.provider
  from unnest(p_dest_lats, p_dest_lons) with ordinality as d (lat, lon, idx)
  left join public.route_cache c
    on c.profile = p_profile
   and c.origin_key = app_private.route_point_key(app_private.lat_lon_point(p_origin_lat, p_origin_lon))
   and c.dest_key = app_private.route_point_key(app_private.lat_lon_point(d.lat, d.lon))
   and c.expires_at > now()
  order by d.idx;
$$;

create function public.route_cache_store(
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
  v_ttl numeric := least(greatest(public.config_numeric('route_cache_ttl_hours'), 1), 24);
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

-- Can this vendor deliver this road distance, and for what fee? Fee bands come from the dated table;
-- the limit is the vendor's radius capped by the largest band in force (LOG, PR #80). Road km only:
-- a missing route is "no_route", never a straight-line guess.
create function public.delivery_quote(p_vendor_id uuid, p_road_km numeric, p_at timestamptz default now())
returns table (deliverable boolean, reason text, fee_usd numeric, limit_km numeric, road_km numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_radius numeric;
  v_max numeric := public.max_delivery_km(p_at);
  v_limit numeric;
  v_found boolean;
begin
  select true, v.delivery_radius_km into v_found, v_radius from public.vendors v where v.id = p_vendor_id;
  if v_found is null then
    raise exception 'unknown vendor %', p_vendor_id using errcode = 'no_data_found';
  end if;
  v_limit := least(coalesce(v_radius, v_max), v_max);
  if p_road_km is null then
    return query select false, 'no_route'::text, null::numeric, v_limit, null::numeric;
  elsif v_limit is null or p_road_km > v_limit then
    return query select false, 'beyond_radius'::text, null::numeric, v_limit, p_road_km;
  else
    return query select true, 'ok'::text, public.delivery_fee_usd(p_road_km, p_at), v_limit, p_road_km;
  end if;
end;
$$;

-- 2. Location knowledge base ----------------------------------------------------------------------------
create type public.knowledge_status as enum ('unconfirmed', 'confirmed');
create type public.supporter_kind as enum ('customer', 'driver', 'merchant', 'operator', 'system');
create type public.location_evidence_kind as enum (
  'door_gps',       -- driver GPS at Delivered
  'address_note',   -- customer text or driver quick tag about an address
  'building_name',  -- a building named in address text, pinned by the order's door point
  'landmark_name',  -- a landmark named in address text
  'street_name',    -- a local street name near an OSM road
  'place_alias',    -- a spelling resolved to a place by the pin
  'confirmation',   -- a merchant, driver or operator confirms an entity on the spot
  'road_report'     -- a driver tag about a closure, checkpoint, flood or snow
);
create type public.address_source as enum ('pin', 'flow', 'list');
create type public.road_incident_kind as enum ('closure', 'checkpoint', 'flood', 'snow', 'other');

-- Shared entities: no link to who supplied the evidence (§28.3); support counts are recomputed.
create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  place_id text references public.places (id) on delete set null,
  name_ar text,
  name_en text,
  aliases text[] not null default '{}',
  normalized_name text generated always as (app_private.normalize_place_name(coalesce(name_ar, name_en))) stored,
  entrance_point extensions.geography(point, 4326) not null,
  floors smallint check (floors between 1 and 60),
  has_elevator boolean,
  gated boolean,
  status public.knowledge_status not null default 'unconfirmed',
  shared boolean not null default false,
  support_people integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buildings_has_name check (coalesce(name_ar, name_en) is not null)
);
create index buildings_point_idx on public.buildings using gist (entrance_point);
create index buildings_place_idx on public.buildings (place_id);

-- §16's landmarks table, extended by §28.
create table public.landmarks (
  id uuid primary key default gen_random_uuid(),
  place_id text references public.places (id) on delete set null,
  name_ar text,
  name_en text,
  aliases text[] not null default '{}',
  normalized_name text generated always as (app_private.normalize_place_name(coalesce(name_ar, name_en))) stored,
  kind text check (kind ~ '^[a-z_]+$'),
  point extensions.geography(point, 4326) not null,
  -- seed and operator landmarks are confirmed and shared from the start; learned ones earn it.
  source text not null default 'learned' check (source in ('seed', 'operator', 'learned')),
  status public.knowledge_status not null default 'unconfirmed',
  shared boolean not null default false,
  support_people integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint landmarks_has_name check (coalesce(name_ar, name_en) is not null)
);
create index landmarks_point_idx on public.landmarks using gist (point);
create index landmarks_place_idx on public.landmarks (place_id);
create index landmarks_name_idx on public.landmarks using gin (normalized_name extensions.gin_trgm_ops);

-- Local names for OpenStreetMap roads ("طريق الجامع").
create table public.street_aliases (
  id uuid primary key default gen_random_uuid(),
  place_id text references public.places (id) on delete set null,
  osm_way_id bigint,
  road extensions.geometry(linestring, 4326),
  name text not null,
  normalized_name text generated always as (app_private.normalize_place_name(name)) stored,
  status public.knowledge_status not null default 'unconfirmed',
  shared boolean not null default false,
  support_orders integer not null default 0,
  support_people integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint street_aliases_unique unique (place_id, normalized_name)
);
create index street_aliases_road_idx on public.street_aliases using gist (road);

-- Learned spellings of places. Seed aliases stay on places.aliases.
create table public.place_aliases (
  id uuid primary key default gen_random_uuid(),
  place_id text not null references public.places (id) on delete cascade,
  alias text not null,
  normalized_alias text generated always as (app_private.normalize_place_name(alias)) stored,
  lang public.lang_code,
  status public.knowledge_status not null default 'unconfirmed',
  shared boolean not null default false,
  support_people integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_aliases_unique unique (place_id, normalized_alias)
);
create index place_aliases_alias_idx on public.place_aliases using gin (normalized_alias extensions.gin_trgm_ops);

-- A customer's saved address: personal data (§28.3). Free text alone is never an address (§16):
-- every address has a place, from the pin or from the district and place lists.
create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  label text check (char_length(label) <= 40),
  place_id text not null references public.places (id),
  pin extensions.geography(point, 4326),
  source public.address_source not null,
  building_id uuid references public.buildings (id) on delete set null,
  landmark_id uuid references public.landmarks (id) on delete set null,
  building_text text check (char_length(building_text) <= 120),
  floor text check (char_length(floor) <= 20),
  apartment text check (char_length(apartment) <= 20),
  -- Shown to the next driver; the customer can edit or delete it (§28.1).
  note text check (char_length(note) <= 300),
  phone_for_driver text check (phone_for_driver ~ '^\+[1-9][0-9]{6,14}$'),
  is_default boolean not null default false,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint addresses_pin_from_pin check (source <> 'pin' or pin is not null)
);
create index addresses_customer_idx on public.addresses (customer_id);
create index addresses_pin_idx on public.addresses using gist (pin);
create unique index addresses_one_default on public.addresses (customer_id) where is_default;

-- Where handover really happens for an address (§28.1): candidate until enough deliveries agree.
create table public.door_points (
  address_id uuid primary key references public.addresses (id) on delete cascade,
  point extensions.geography(point, 4326) not null,
  status public.knowledge_status not null default 'unconfirmed',
  support_deliveries integer not null default 0,
  updated_at timestamptz not null default now()
);
create index door_points_point_idx on public.door_points using gist (point);

-- Raw observations. Personal rows (customer_id, address_id) are deleted with the customer (§28.3).
create table public.location_evidence (
  id bigint generated always as identity primary key,
  kind public.location_evidence_kind not null,
  supporter_kind public.supporter_kind not null,
  customer_id uuid references public.customers (id) on delete cascade,
  supporter_user_id uuid references auth.users (id) on delete set null,
  vendor_id uuid references public.vendors (id) on delete cascade,
  -- Foreign key to orders arrives with the orders table (Phase 2).
  order_id uuid,
  address_id uuid references public.addresses (id) on delete cascade,
  place_id text references public.places (id) on delete set null,
  building_id uuid references public.buildings (id) on delete cascade,
  landmark_id uuid references public.landmarks (id) on delete cascade,
  street_alias_id uuid references public.street_aliases (id) on delete cascade,
  place_alias_id uuid references public.place_aliases (id) on delete cascade,
  point extensions.geography(point, 4326),
  accuracy_m numeric(7, 1) check (accuracy_m >= 0),
  text_value text check (char_length(text_value) <= 500),
  -- One person counted once, whoever they are.
  supporter_key text generated always as (
    case supporter_kind
      when 'customer' then 'c:' || customer_id::text
      when 'merchant' then 'm:' || coalesce(supporter_user_id::text, vendor_id::text)
      when 'driver' then 'd:' || coalesce(supporter_user_id::text, '')
      when 'operator' then 'o:' || coalesce(supporter_user_id::text, '')
      else 's:'
    end
  ) stored,
  created_at timestamptz not null default now(),
  constraint location_evidence_customer_has_id check (supporter_kind <> 'customer' or customer_id is not null),
  constraint location_evidence_merchant_has_id check (supporter_kind <> 'merchant' or coalesce(supporter_user_id, vendor_id) is not null),
  constraint location_evidence_staff_has_id check (supporter_kind not in ('driver', 'operator') or supporter_user_id is not null),
  constraint location_evidence_door_has_point check (kind <> 'door_gps' or (point is not null and address_id is not null))
);
create index location_evidence_point_idx on public.location_evidence using gist (point);
create index location_evidence_address_idx on public.location_evidence (address_id) where address_id is not null;
create index location_evidence_customer_idx on public.location_evidence (customer_id) where customer_id is not null;
create index location_evidence_building_idx on public.location_evidence (building_id) where building_id is not null;
create index location_evidence_landmark_idx on public.location_evidence (landmark_id) where landmark_id is not null;
create index location_evidence_street_idx on public.location_evidence (street_alias_id) where street_alias_id is not null;
create index location_evidence_alias_idx on public.location_evidence (place_alias_id) where place_alias_id is not null;

-- Contradictions and other doubts, processed weekly by Claude (§28.1); the admin sees the count.
create table public.location_review_items (
  id bigint generated always as identity primary key,
  subject_table text not null check (subject_table in ('buildings', 'landmarks', 'street_aliases', 'place_aliases', 'door_points')),
  subject_id text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);
create unique index location_review_items_open on public.location_review_items (subject_table, subject_id) where resolved_at is null;

-- Statistics. Cells are used only above their config threshold; below it the defaults apply.
create table public.travel_time_stats (
  origin_place_id text not null references public.places (id) on delete cascade,
  dest_place_id text not null references public.places (id) on delete cascade,
  hour smallint not null check (hour between 0 and 23),
  weekday smallint not null check (weekday between 0 and 6),
  winter boolean not null,
  trips integer not null default 0 check (trips >= 0),
  -- Median of actual duration / ORS duration.
  correction_factor numeric(5, 3) check (correction_factor > 0),
  updated_at timestamptz not null default now(),
  primary key (origin_place_id, dest_place_id, hour, weekday, winter)
);

create table public.prep_time_stats (
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  hour smallint not null check (hour between 0 and 23),
  weekday smallint not null check (weekday between 0 and 6),
  basket_band smallint not null check (basket_band between 1 and 4),
  orders integer not null default 0 check (orders >= 0),
  p50_s integer check (p50_s >= 0),
  p80_s integer check (p80_s >= 0),
  updated_at timestamptz not null default now(),
  primary key (vendor_id, hour, weekday, basket_band)
);

create table public.handover_time_stats (
  id bigint generated always as identity primary key,
  place_id text not null references public.places (id) on delete cascade,
  building_id uuid references public.buildings (id) on delete cascade,
  deliveries integer not null default 0 check (deliveries >= 0),
  p50_s integer check (p50_s >= 0),
  updated_at timestamptz not null default now()
);
create unique index handover_time_stats_cell on public.handover_time_stats
  (place_id, coalesce(building_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.road_incidents (
  id uuid primary key default gen_random_uuid(),
  kind public.road_incident_kind not null,
  place_id text references public.places (id) on delete set null,
  point extensions.geography(point, 4326) not null,
  note text check (char_length(note) <= 200),
  reports integer not null default 1 check (reports >= 1),
  reported_at timestamptz not null default now(),
  last_reported_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index road_incidents_point_idx on public.road_incidents using gist (point);
create index road_incidents_active_idx on public.road_incidents (expires_at);

do $$
declare
  t text;
begin
  foreach t in array array['buildings', 'landmarks', 'street_aliases', 'place_aliases', 'addresses']
  loop
    execute format('create trigger %1$s_touch before update on public.%1$I
      for each row execute function app_private.touch_updated_at()', t);
  end loop;
end;
$$;

-- Promotion -------------------------------------------------------------------------------------------
-- Door points: the cluster of driver GPS fixes (accuracy <= limit) with the most agreeing deliveries;
-- its component-wise median (robust to one bad fix) becomes the door point, confirmed at the threshold.
create function app_private.promote_door_points() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc numeric := public.config_numeric('loc_door_max_accuracy_m');
  v_r numeric := public.config_numeric('loc_door_radius_m');
  v_min numeric := public.config_numeric('loc_door_min_deliveries');
  n integer;
begin
  with ev as (
    select e.id, e.address_id, e.point, e.created_at
    from public.location_evidence e
    where e.kind = 'door_gps' and e.accuracy_m is not null and e.accuracy_m <= v_acc
  ),
  support as (
    select a.address_id, a.id, a.point, a.created_at, count(*) as n
    from ev a join ev b on b.address_id = a.address_id and extensions.st_dwithin(a.point, b.point, v_r)
    group by a.address_id, a.id, a.point, a.created_at
  ),
  best as (
    select distinct on (s.address_id) s.address_id, s.point, s.n
    from support s order by s.address_id, s.n desc, s.created_at desc
  ),
  cluster as (
    select b.address_id, b.n,
      percentile_cont(0.5) within group (order by extensions.st_x(e.point::extensions.geometry)) as x,
      percentile_cont(0.5) within group (order by extensions.st_y(e.point::extensions.geometry)) as y
    from best b join ev e on e.address_id = b.address_id and extensions.st_dwithin(e.point, b.point, v_r)
    group by b.address_id, b.n
  )
  insert into public.door_points (address_id, point, status, support_deliveries, updated_at)
  select c.address_id, extensions.st_setsrid(extensions.st_makepoint(c.x, c.y), 4326)::extensions.geography,
    case when c.n >= v_min then 'confirmed' else 'unconfirmed' end::public.knowledge_status, c.n, now()
  from cluster c
  on conflict (address_id) do update
    set point = excluded.point, status = excluded.status, support_deliveries = excluded.support_deliveries, updated_at = now()
    where (door_points.point, door_points.status, door_points.support_deliveries)
      is distinct from (excluded.point, excluded.status, excluded.support_deliveries);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Opens one review item per subject (no duplicates while open).
create function app_private.flag_for_review(p_table text, p_id text, p_reason text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.location_review_items (subject_table, subject_id, reason)
  values (p_table, p_id, p_reason)
  on conflict (subject_table, subject_id) where resolved_at is null do nothing;
$$;

-- Buildings: evidence within the radius supports; as much evidence elsewhere as in support is a
-- contradiction (demoted, reviewed). Confirmed at 3 distinct customers, or 1 customer + 1 driver.
create function app_private.promote_buildings() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r numeric := public.config_numeric('loc_building_radius_m');
  v_min numeric := public.config_numeric('loc_building_min_customers');
  v_shared numeric := public.config_numeric('loc_shared_min_people');
  r record;
  n integer := 0;
  v_status public.knowledge_status;
begin
  for r in
    select b.id, b.status, b.shared, b.support_people,
      count(distinct e.supporter_key) filter (where e.supporter_kind = 'customer' and extensions.st_dwithin(e.point, b.entrance_point, v_r)) as customers,
      count(distinct e.supporter_key) filter (where e.supporter_kind = 'driver' and extensions.st_dwithin(e.point, b.entrance_point, v_r)) as drivers,
      count(distinct e.supporter_key) filter (where e.supporter_kind <> 'system' and extensions.st_dwithin(e.point, b.entrance_point, v_r)) as people,
      count(*) filter (where e.point is not null and not extensions.st_dwithin(e.point, b.entrance_point, v_r)) as against,
      count(*) filter (where e.point is not null and extensions.st_dwithin(e.point, b.entrance_point, v_r)) as supporting
    from public.buildings b
    left join public.location_evidence e on e.building_id = b.id
    group by b.id
  loop
    v_status := case when r.customers >= v_min or (r.customers >= 1 and r.drivers >= 1) then 'confirmed' else 'unconfirmed' end;
    if r.against >= 2 and r.against >= r.supporting then
      v_status := 'unconfirmed';
      perform app_private.flag_for_review('buildings', r.id::text, 'contradicting pins');
    end if;
    if (r.status, r.shared, r.support_people) is distinct from (v_status, r.people >= v_shared, r.people::integer) then
      update public.buildings set status = v_status, shared = r.people >= v_shared, support_people = r.people where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Landmarks: 2 distinct customers within 150 m, or one merchant, driver or operator confirmation.
create function app_private.promote_landmarks() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r numeric := public.config_numeric('loc_landmark_radius_m');
  v_min numeric := public.config_numeric('loc_landmark_min_customers');
  v_shared numeric := public.config_numeric('loc_shared_min_people');
  r record;
  n integer := 0;
  v_status public.knowledge_status;
  v_is_shared boolean;
begin
  for r in
    select l.id, l.source, l.status, l.shared, l.support_people,
      count(distinct e.supporter_key) filter (where e.supporter_kind = 'customer' and extensions.st_dwithin(e.point, l.point, v_r)) as customers,
      count(distinct e.supporter_key) filter (where e.supporter_kind in ('merchant', 'driver', 'operator') and (e.point is null or extensions.st_dwithin(e.point, l.point, v_r))) as onsite,
      count(distinct e.supporter_key) filter (where e.supporter_kind <> 'system' and (e.point is null or extensions.st_dwithin(e.point, l.point, v_r))) as people,
      count(*) filter (where e.point is not null and not extensions.st_dwithin(e.point, l.point, v_r)) as against,
      count(*) filter (where e.point is not null and extensions.st_dwithin(e.point, l.point, v_r)) as supporting
    from public.landmarks l
    left join public.location_evidence e on e.landmark_id = l.id
    group by l.id
  loop
    if r.source in ('seed', 'operator') then
      v_status := 'confirmed';
      v_is_shared := true;
    else
      v_status := case when r.customers >= v_min or r.onsite >= 1 then 'confirmed' else 'unconfirmed' end;
      if r.against >= 2 and r.against >= r.supporting then
        v_status := 'unconfirmed';
        perform app_private.flag_for_review('landmarks', r.id::text, 'contradicting pins');
      end if;
      v_is_shared := r.people >= v_shared;
    end if;
    if (r.status, r.shared, r.support_people) is distinct from (v_status, v_is_shared, r.people::integer) then
      update public.landmarks set status = v_status, shared = v_is_shared, support_people = r.people where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Street aliases: 3 distinct orders whose pin lies within 40 m of the road (when the road is known).
create function app_private.promote_street_aliases() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d numeric := public.config_numeric('loc_street_max_distance_m');
  v_min numeric := public.config_numeric('loc_street_min_orders');
  v_shared numeric := public.config_numeric('loc_shared_min_people');
  n integer;
begin
  with s as (
    select a.id,
      count(distinct coalesce(e.order_id::text, 'e' || e.id::text)) filter (where e.id is not null) as orders,
      count(distinct e.supporter_key) filter (where e.supporter_kind <> 'system') as people
    from public.street_aliases a
    left join public.location_evidence e on e.street_alias_id = a.id
      and (a.road is null or (e.point is not null and extensions.st_dwithin(e.point, a.road::extensions.geography, v_d)))
    group by a.id
  )
  update public.street_aliases a
  set status = case when s.orders >= v_min then 'confirmed' else 'unconfirmed' end::public.knowledge_status,
      shared = s.people >= v_shared, support_orders = s.orders, support_people = s.people
  from s
  where a.id = s.id
    and (a.status, a.shared, a.support_orders, a.support_people) is distinct from
        (case when s.orders >= v_min then 'confirmed' else 'unconfirmed' end::public.knowledge_status, s.people >= v_shared, s.orders::integer, s.people::integer);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Place aliases: 3 distinct customers; before that the alias is a hint only.
create function app_private.promote_place_aliases() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min numeric := public.config_numeric('loc_alias_min_customers');
  v_shared numeric := public.config_numeric('loc_shared_min_people');
  n integer;
begin
  with s as (
    select a.id,
      count(distinct e.supporter_key) filter (where e.supporter_kind = 'customer') as customers,
      count(distinct e.supporter_key) filter (where e.supporter_kind <> 'system') as people
    from public.place_aliases a
    left join public.location_evidence e on e.place_alias_id = a.id
    group by a.id
  )
  update public.place_aliases a
  set status = case when s.customers >= v_min then 'confirmed' else 'unconfirmed' end::public.knowledge_status,
      shared = s.people >= v_shared, support_people = s.people
  from s
  where a.id = s.id
    and (a.status, a.shared, a.support_people) is distinct from
        (case when s.customers >= v_min then 'confirmed' else 'unconfirmed' end::public.knowledge_status, s.people >= v_shared, s.people::integer);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Runs every promotion; returns how many rows each changed. Called nightly and after a forget request.
create function public.location_promote_all()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'door_points', app_private.promote_door_points(),
    'buildings', app_private.promote_buildings(),
    'landmarks', app_private.promote_landmarks(),
    'street_aliases', app_private.promote_street_aliases(),
    'place_aliases', app_private.promote_place_aliases()
  );
end;
$$;

-- "Delete my data" (§28.3): the customer's addresses, door points and evidence go; shared entities
-- that fall below their thresholds are demoted by the promotion run.
create function public.location_forget_customer(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_addresses integer;
  v_evidence integer;
begin
  delete from public.location_evidence where customer_id = p_customer_id;
  get diagnostics v_evidence = row_count;
  delete from public.addresses where customer_id = p_customer_id;
  get diagnostics v_addresses = row_count;
  return jsonb_build_object('addresses', v_addresses, 'evidence', v_evidence, 'promotion', public.location_promote_all());
end;
$$;

-- Estimates read the statistics only above their thresholds (§28.1, §28.2). Winter is November-April
-- in Beirut time.
create function public.eta_travel_s(
  p_ors_duration_s integer,
  p_origin_place_id text,
  p_dest_place_id text,
  p_at timestamptz default now()
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_at at time zone 'Asia/Beirut';
  v_factor numeric;
begin
  if p_ors_duration_s is null then
    return null;
  end if;
  select s.correction_factor into v_factor
  from public.travel_time_stats s
  where s.origin_place_id = p_origin_place_id and s.dest_place_id = p_dest_place_id
    and s.hour = extract(hour from v_local) and s.weekday = extract(dow from v_local)
    and s.winter = (extract(month from v_local) in (11, 12, 1, 2, 3, 4))
    and s.trips >= public.config_numeric('loc_travel_min_trips')
    and s.correction_factor is not null;
  return round(p_ors_duration_s * coalesce(v_factor, public.config_numeric('eta_default_factor')))::integer;
end;
$$;

create function public.prep_time_estimate_s(p_vendor_id uuid, p_basket_band smallint, p_at timestamptz default now())
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select s.p50_s from public.prep_time_stats s
  where s.vendor_id = p_vendor_id and s.basket_band = p_basket_band
    and s.hour = extract(hour from p_at at time zone 'Asia/Beirut')
    and s.weekday = extract(dow from p_at at time zone 'Asia/Beirut')
    and s.orders >= public.config_numeric('loc_prep_min_orders');
$$;

create function public.handover_estimate_s(p_place_id text, p_building_id uuid default null, p_at timestamptz default now())
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select s.p50_s from public.handover_time_stats s
  where s.place_id = p_place_id
    and (s.building_id = p_building_id or s.building_id is null)
    and s.deliveries >= public.config_numeric('loc_handover_min_deliveries')
  order by (s.building_id is not null) desc
  limit 1;
$$;

-- A road report: a new incident, or a re-report that extends an active one of the same kind nearby.
create function public.road_incident_report(
  p_kind public.road_incident_kind,
  p_point extensions.geography,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl interval := make_interval(hours => public.config_numeric('loc_incident_ttl_hours')::integer);
  v_id uuid;
begin
  update public.road_incidents i
  set reports = reports + 1, last_reported_at = now(), expires_at = now() + v_ttl
  where i.id = (
    select i2.id from public.road_incidents i2
    where i2.kind = p_kind and i2.expires_at > now() and extensions.st_dwithin(i2.point, p_point, 300)
    order by i2.point operator(extensions.<->) p_point limit 1
  )
  returning i.id into v_id;
  if v_id is null then
    insert into public.road_incidents (kind, point, place_id, note, expires_at)
    values (p_kind, p_point, (select f.place_id from public.place_for_point(p_point) f), p_note, now() + v_ttl)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Nightly job (§28.5): promotions, expired route cache, expired incidents kept for statistics.
-- Travel, prep and handover statistics are recomputed here once orders and traces exist (Phases 2, 5).
create function app_private.location_nightly() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_routes integer;
begin
  delete from public.route_cache where expires_at < now() - interval '1 day';
  get diagnostics v_routes = row_count;
  return public.location_promote_all() || jsonb_build_object('route_cache_purged', v_routes);
end;
$$;

-- 03:30 Beirut (00:30 UTC), after the day's last orders.
select cron.schedule('location-nightly', '30 0 * * *', 'select app_private.location_nightly()');

-- Row-level security ------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['route_cache', 'buildings', 'landmarks', 'street_aliases', 'place_aliases', 'addresses',
    'door_points', 'location_evidence', 'location_review_items', 'travel_time_stats', 'prep_time_stats',
    'handover_time_stats', 'road_incidents']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
  -- Operators read the knowledge base and statistics; the server tools (service role) do the rest.
  foreach t in array array['buildings', 'landmarks', 'street_aliases', 'place_aliases', 'location_evidence',
    'location_review_items', 'travel_time_stats', 'prep_time_stats', 'handover_time_stats', 'road_incidents', 'door_points']
  loop
    execute format('grant select on table public.%I to authenticated', t);
    execute format('create policy %1$s_operator_read on public.%1$I for select to authenticated
      using ((select app_private.is_operator()))', t);
  end loop;
end;
$$;

-- Addresses: the customer reads, edits the note and details, and deletes its own; operators read all.
-- The merchant and driver of an active order get read access with the orders table (Phase 2).
grant select, delete on table public.addresses to authenticated;
grant update (label, building_text, floor, apartment, note, phone_for_driver, is_default) on table public.addresses to authenticated;
create policy addresses_owner_read on public.addresses for select to authenticated
  using (
    (select app_private.is_operator())
    or exists (select 1 from public.customers c where c.id = addresses.customer_id and c.user_id = (select auth.uid()))
  );
create policy addresses_owner_update on public.addresses for update to authenticated
  using (exists (select 1 from public.customers c where c.id = addresses.customer_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.customers c where c.id = addresses.customer_id and c.user_id = (select auth.uid())));
create policy addresses_owner_delete on public.addresses for delete to authenticated
  using (exists (select 1 from public.customers c where c.id = addresses.customer_id and c.user_id = (select auth.uid())));

-- Door points of the customer's own addresses are personal data too.
create policy door_points_owner_read on public.door_points for select to authenticated
  using (exists (
    select 1 from public.addresses a join public.customers c on c.id = a.customer_id
    where a.id = door_points.address_id and c.user_id = (select auth.uid())
  ));

-- Functions: server only.
revoke all on function public.route_cache_lookup(double precision, double precision, double precision[], double precision[], text) from public, anon, authenticated;
revoke all on function public.route_cache_store(double precision, double precision, double precision[], double precision[], integer[], integer[], text, text) from public, anon, authenticated;
revoke all on function public.delivery_quote(uuid, numeric, timestamptz) from public, anon, authenticated;
revoke all on function public.location_promote_all() from public, anon, authenticated;
revoke all on function public.location_forget_customer(uuid) from public, anon, authenticated;
revoke all on function public.eta_travel_s(integer, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.prep_time_estimate_s(uuid, smallint, timestamptz) from public, anon, authenticated;
revoke all on function public.handover_estimate_s(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.road_incident_report(public.road_incident_kind, extensions.geography, text) from public, anon, authenticated;
grant execute on function public.route_cache_lookup(double precision, double precision, double precision[], double precision[], text) to service_role;
grant execute on function public.route_cache_store(double precision, double precision, double precision[], double precision[], integer[], integer[], text, text) to service_role;
grant execute on function public.delivery_quote(uuid, numeric, timestamptz) to service_role;
grant execute on function public.location_promote_all() to service_role;
grant execute on function public.location_forget_customer(uuid) to service_role;
grant execute on function public.eta_travel_s(integer, text, text, timestamptz) to service_role;
grant execute on function public.prep_time_estimate_s(uuid, smallint, timestamptz) to service_role;
grant execute on function public.handover_estimate_s(text, uuid, timestamptz) to service_role;
grant execute on function public.road_incident_report(public.road_incident_kind, extensions.geography, text) to service_role;
revoke all on function app_private.route_point_key(extensions.geography) from public;
revoke all on function app_private.lat_lon_point(double precision, double precision) from public;
grant execute on function app_private.route_point_key(extensions.geography) to service_role;
grant execute on function app_private.lat_lon_point(double precision, double precision) to service_role;
revoke all on function app_private.promote_door_points() from public;
revoke all on function app_private.flag_for_review(text, text, text) from public;
revoke all on function app_private.promote_buildings() from public;
revoke all on function app_private.promote_landmarks() from public;
revoke all on function app_private.promote_street_aliases() from public;
revoke all on function app_private.promote_place_aliases() from public;
revoke all on function app_private.location_nightly() from public;
