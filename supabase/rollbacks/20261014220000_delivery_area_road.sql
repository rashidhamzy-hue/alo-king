-- Rollback of 20261014220000_delivery_area_road.sql: the 20261014200000 loader and proposal (the whole boundary file
-- is the dated row; no shop-village exception). The next boundary load writes a new dated row.
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

create or replace function app_private.delivery_area_load(p_sha256 text) returns jsonb
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
drop function app_private.delivery_area_ids();
