-- Session 5f smoke run (17 October): a customer at a shop's own door saw it outside "Shops near you, nearest first",
-- because browse fell back to the shop → place distance (§39.15.1) while the doorstep rule (#206: a pin within 50 m of
-- the shop is that distance) was applied only by the live call at checkout. The resolver applies it too: it is a
-- distance between two stored points, so browse still costs zero routing calls, and the checkout no longer needs a live
-- call for a doorstep pin.

-- As in 20261016130100_routing_never_blocks.sql, with one change: after the cache, a pin within 50 m of the shop is that
-- straight distance (route_source = doorstep), before the place distance.
create or replace function app_private.shop_road_km(p_vendor_id uuid, p_address_id uuid)
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
  -- The same 50 m as DOORSTEP_M in supabase/functions/_shared/routing.ts: change both together.
  if extensions.st_dwithin(v_loc, v_pin, 50) then
    road_km := round((extensions.st_distance(v_loc, v_pin) / 1000.0)::numeric, 2);
    source := 'doorstep';
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
