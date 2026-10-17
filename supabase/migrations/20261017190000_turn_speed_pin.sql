-- Session 5h part 4 (DECISIONS §39.15.6, speed measured on staging from bot_turns): the address save and the browse taps.
--
-- 1. address_card read the whole of describe_location, which runs place_for_point again (the zone polygons): 433 ms cold,
--    55 ms warm on staging, for a place the address already names. Its `near` now holds only what the card shows (the
--    nearest confirmed landmark and the building at the entrance), read by app_private.describe_near. describe_location
--    itself is unchanged for its other callers.
-- 2. browse_delivering(customer, limit): the shops that deliver to the customer's search point and their delivery check in
--    one call (it was customer_search_point, browse_shops and customer_delivery_check one after another: three round trips
--    from the edge function and the search point read three times in the database). Same rows, same zero routing calls.

create function app_private.describe_near(p_pt extensions.geography) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'landmark', (select jsonb_build_object('name_ar', l.name_ar, 'name_en', l.name_en, 'distance_m', round(extensions.st_distance(l.point, p_pt)))
                 from public.landmarks l
                 where l.status = 'confirmed' and l.shared
                   and extensions.st_dwithin(l.point, p_pt, public.config_numeric('loc_landmark_describe_radius_m'))
                 order by l.point operator(extensions.<->) p_pt limit 1),
    'building', (select jsonb_build_object('name_ar', b.name_ar, 'name_en', b.name_en, 'floors', b.floors, 'elevator', b.has_elevator)
                 from public.buildings b
                 where b.status = 'confirmed' and b.shared and extensions.st_dwithin(b.entrance_point, p_pt, 30)
                 order by b.entrance_point operator(extensions.<->) p_pt limit 1));
$$;
revoke all on function app_private.describe_near(extensions.geography) from public;

create or replace function public.address_card(p_address_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('address_id', a.id, 'label', a.label, 'place', coalesce(p.name_ar, p.name_en), 'place_en', coalesce(p.name_en, p.name_ar),
    'place_status', p.service_status, 'building', a.building_text, 'floor', a.floor, 'note', a.note,
    'near', case when a.pin is not null then app_private.describe_near(a.pin) end)
  from public.addresses a join public.places p on p.id = a.place_id where a.id = p_address_id;
$$;

create function public.browse_delivering(p_customer_id uuid, p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_pt jsonb := public.customer_search_point(p_customer_id);
  v_b jsonb;
  v_ids uuid[];
begin
  if v_pt is null or v_pt ->> 'address_id' is null then
    return jsonb_build_object('point', null);
  end if;
  v_b := public.browse_shops(p_customer_id, (v_pt ->> 'lat')::double precision, (v_pt ->> 'lon')::double precision, p_limit);
  select array_agg((x ->> 'vendor_id')::uuid) into v_ids from jsonb_array_elements(coalesce(v_b -> 'shops', '[]')) x;
  return v_b || jsonb_build_object('point', v_pt,
    'check', case when v_ids is not null then public.customer_delivery_check(p_customer_id, v_ids) end);
end;
$$;
revoke all on function public.browse_delivering(uuid, integer) from public, anon, authenticated;
grant execute on function public.browse_delivering(uuid, integer) to service_role;
