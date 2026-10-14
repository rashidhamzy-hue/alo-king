-- Session F, DECISIONS §39.2 "boundary ∩ road distance", now that road distances are committed
-- (supabase/seed/places/shouf_delivery_road_km.csv, OpenRouteService from the nearest pilot merchant to each place):
--   * `app_private.delivery_area_load()`: the dated pilot_place_ids row is the boundary minus the places *between*
--     (role `between`) that are more than max_delivery_km() from every merchant by road. The per-order check would
--     refuse them anyway; leaving them on only showed "too far" after the pin. They come back when the fee bands go
--     further (scripts/load-seed.sh re-runs this load when max_delivery_km() changes) or when area-data recomputes the
--     road file after a nearer merchant joins and that file is committed.
--   * the shop villages (§38.1) and the villages Rasheed named are always delivered to: §39.2 calls his list
--     authoritative, and a centroid-to-merchant route (Jbaa 18.3 km, Bater 14.5 km by road from 6.5 and 7.0 km in a
--     straight line) is a reason to look again, not to strike a village he named. The per-order road check from the
--     chosen shop (§29.1) still applies to every address.
--   * `public.delivery_area_proposal()`: the same rule, so pilot_place_ids ⊆ proposal holds.
-- Copies of the 20261014200000 functions with only these changes, plus app_private.delivery_area_ids() (the rule
-- itself). Rollback: supabase/rollbacks/20261014220000_delivery_area_road.sql.

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
  -- The shop villages (§38.1) and the villages Rasheed named are always delivered to (§39.2, authoritative list).
  where d.role in ('shop_village', 'named_by_rasheed') or coalesce(d.road_file, d.road_cache, d.straight) <= public.max_delivery_km()
  order by d.id;
$$;
revoke all on function public.delivery_area_proposal() from public, anon, authenticated;
grant execute on function public.delivery_area_proposal() to service_role;

-- Boundary ∩ road distance (§39.2): a place between whose committed road distance (nearest pilot merchant) is beyond
-- max_delivery_km() is not delivered to; the shop villages and the villages Rasheed named always are. Without a road
-- distance the place stays in (the straight line is the fallback, and every boundary place is within it).
create function app_private.delivery_area_ids() returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(b.place_id order by b.place_id), '{}') from app_private.delivery_boundary b
  where b.role in ('shop_village', 'named_by_rasheed')
     or not exists (select 1 from app_private.delivery_road_km r where r.place_id = b.place_id and r.road_km > public.max_delivery_km());
$$;
revoke all on function app_private.delivery_area_ids() from public, anon, authenticated;

create or replace function app_private.delivery_area_load(p_sha256 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_area text[] := app_private.delivery_area_ids();
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
      format('Delivery area: Rasheed''s boundary within road distance, %s places (DECISIONS §39.2; boundary files %s)',
             cardinality(v_area), left(p_sha256, 12)), null);
    v_new := true;
  end if;
  v_places := app_private.pilot_places_apply();
  if exists (select 1 from app_private.delivery_denylist x join public.places p on p.id = x.place_id where p.service_status = 'on') then
    raise exception 'delivery boundary: a deny-listed place is still on' using errcode = 'check_violation';
  end if;
  v_pruned := app_private.osm_prune_outside_area();

  insert into app_private.seed_loads (name, sha256, loaded_at, counts)
  values ('delivery_area', p_sha256, now(), jsonb_build_object('boundary', (select count(*) from app_private.delivery_boundary),
    'delivered_to', cardinality(v_area),
    'beyond_road_km', (select coalesce(jsonb_agg(r.place_id order by r.place_id), '[]') from app_private.delivery_road_km r
      join app_private.delivery_boundary b on b.place_id = r.place_id
      where b.role = 'between' and r.road_km > public.max_delivery_km()),
    'named_beyond_road_km', (select coalesce(jsonb_agg(r.place_id order by r.place_id), '[]') from app_private.delivery_road_km r
      join app_private.delivery_boundary b on b.place_id = r.place_id
      where b.role <> 'between' and r.road_km > public.max_delivery_km()),
    'denylist', (select count(*) from app_private.delivery_denylist),
    'road_km', (select count(*) from app_private.delivery_road_km), 'new_dated_row', v_new, 'places', v_places) || v_pruned)
  on conflict (name) do update set sha256 = excluded.sha256, loaded_at = excluded.loaded_at, counts = excluded.counts;
  return (select counts from app_private.seed_loads where name = 'delivery_area');
end;
$$;
revoke all on function app_private.delivery_area_load(text) from public, anon, authenticated;
