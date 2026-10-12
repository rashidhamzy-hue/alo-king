-- Session T2 (DECISIONS §34, fixes from the owner's first live test on staging, 12 October 07:45-07:50):
--   1. basket_quote failed for every pickup basket ("record v_route is not assigned yet"): it read the
--      delivery route of a basket that has none. The edge code answered "Sorry, I'm a bit slow" to the
--      pickup tap and to every Checkout tap after it (the pickup choice was already stored on the basket).
--   2. customer_delivery_check: the road check for several places at once, so the bot lists only places
--      that deliver to the pin, before any basket exists.
--   3. vendor_search_pickup: open places that take pickup orders near the customer, for the pickup choice
--      when nothing delivers to the pin.
--   4. Handoffs set before session T (12 hours long) are ended once, here.
-- Reads places and vendors only; no frozen table is changed (§31).

-- 1. Config ---------------------------------------------------------------------------------------------
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS.md §34, 12 October 2026 (session T2)', false);
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('pickup_search_km', '15', '2026-10-12 00:00+03', 'Straight-line km around the pin within which the pickup choice lists places (DECISIONS §34)', null);
select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);

-- 2. basket_quote: pickup has no route, no distance and no delivery fee ----------------------------------
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
  v_subtotal := (v_view ->> 'subtotal_usd')::numeric;
  select coalesce(sum(case when (l ->> 'has_empty')::boolean is false then (l ->> 'deposit_usd')::numeric * (l ->> 'quantity')::int else 0 end), 0)
    into v_deposit from jsonb_array_elements(v_view -> 'lines') l;
  if v_basket.fulfilment = 'delivery' then
    select * into v_address from public.addresses where id = v_basket.address_id;
    if v_address.id is null or v_address.pin is null then
      return jsonb_build_object('status', 'no_address', 'basket', v_view);
    end if;
    if (select p.service_status from public.places p where p.id = v_address.place_id) = 'paused' then
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

-- 3. The road check for a list of places ---------------------------------------------------------------------
-- For the customer's saved pin: per place, "ok" with the fee, "beyond_radius" with the limit, or "no_route"
-- with both points so the caller can fetch the road route once and ask again. Road kilometres only, never a
-- straight-line guess (§1, §28.6). A paused place at the pin answers for every vendor.
create function public.customer_delivery_check(p_customer_id uuid, p_vendor_ids uuid[]) returns jsonb
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
begin
  if v_pt is null then
    return jsonb_build_object('status', 'no_address', 'vendors', '[]'::jsonb);
  end if;
  select * into v_addr from public.addresses where id = (v_pt ->> 'address_id')::uuid;
  if (select p.service_status from public.places p where p.id = v_addr.place_id) = 'paused' then
    return jsonb_build_object('status', 'place_paused', 'vendors', '[]'::jsonb);
  end if;
  for v_v in
    select v.id, v.location, v.pickup_enabled from public.vendors v where v.id = any (p_vendor_ids)
  loop
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
  end loop;
  return jsonb_build_object('status', 'ok', 'vendors', v_out);
end;
$$;

-- 4. Pickup choices ------------------------------------------------------------------------------------------
-- Orderable, claimed places that take pickup, within pickup_search_km (straight line) of the point, nearest
-- first. Same columns as vendor_search so the bot renders both the same way.
create function public.vendor_search_pickup(
  p_lat double precision,
  p_lon double precision,
  p_limit integer default 10
)
returns table (
  vendor_id uuid, name_ar text, name_en text, business_type public.business_type, cuisine_tags text[],
  is_open boolean, paused_until timestamptz, straight_km numeric, vendor_lat double precision, vendor_lon double precision,
  matched text, score real
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (select app_private.lat_lon_point(p_lat, p_lon) as pt, public.config_numeric('pickup_search_km') as max_km),
  base as (
    select v.*, extensions.st_distance(v.location, q.pt) / 1000.0 as km, q.max_km
    from public.vendors v cross join q
    where p_lat is not null and p_lon is not null
      and v.orderable and v.listing_status = 'active' and v.claim_status = 'claimed' and v.pickup_enabled
  )
  select b.id, b.name_ar, b.name_en, b.business_type, b.cuisine_tags,
    not (b.paused_until is not null and b.paused_until > now()), b.paused_until, round(b.km::numeric, 2),
    extensions.st_y(b.location::extensions.geometry), extensions.st_x(b.location::extensions.geometry), 'nearby'::text, 0.5::real
  from base b
  where b.km <= b.max_km
  order by (b.paused_until is not null and b.paused_until > now()), b.km, b.id
  limit least(greatest(coalesce(p_limit, 10), 1), 10);
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'customer_delivery_check(uuid, uuid[])',
    'vendor_search_pickup(double precision, double precision, integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- 5. Handoffs from before session T ----------------------------------------------------------------------------
-- They lasted 12 hours (handoff_hours), so one set the evening before still answered "Rasheed will reply" the
-- next morning. Every handoff open at deploy time ends here; new ones last handoff_minutes.
update public.bot_sessions set handoff_until = null, handoff_reason = null where handoff_until is not null;
