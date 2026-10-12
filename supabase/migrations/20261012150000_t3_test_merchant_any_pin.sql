-- Session T3 (DECISIONS §34, owner's rules of 12 October):
--   1. The staging test merchant ("Alo Test Grill", vendors.is_test) accepts a pin anywhere in the world:
--      no road route, no radius check, no paused-place block, and the delivery fee is always the first band
--      (0-3 km). A pin outside every place polygon (or outside Lebanon) is saved against the "Test location"
--      place, which only the staging fixture creates; with no such place the old answers stay
--      (outside_lebanon, no_place), so production behaves exactly as before.
--   2. The 30 km test fee band of T2 goes away (done by the fixture on staging; nothing here adds a band).
--   3. Config flag google_places_enabled = false. vendor_from_google (claim case D) refuses while it is off,
--      so the claim flow uses our list and the "not in our list" registration path only.
-- Real merchants keep every check. Reads places and vendors only; no frozen table is changed (§31).

-- 1. Config ---------------------------------------------------------------------------------------------
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS.md §34, 12 October 2026 (session T3)', false);
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('google_places_enabled', 'false', '2026-10-12 00:00+03', 'Live Google Places lookups (the Google server key) stay off: the claim flow uses our list and the "not in our list" path only', null);
select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);

-- 2. The test-merchant switch -----------------------------------------------------------------------------
create function app_private.vendor_is_test(p_vendor_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select v.is_test from public.vendors v where v.id = p_vendor_id), false);
$$;
revoke all on function app_private.vendor_is_test(uuid) from public;
grant execute on function app_private.vendor_is_test(uuid) to service_role;

-- A test merchant is always deliverable at the first band's fee; a real vendor is judged on road km as before.
create or replace function public.delivery_quote(p_vendor_id uuid, p_road_km numeric, p_at timestamptz default now())
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
  if app_private.vendor_is_test(p_vendor_id) then
    return query select true, 'ok'::text, public.delivery_fee_usd(0, p_at), null::numeric, 0::numeric;
    return;
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

-- 3. Pins: Lebanon's bounds and the place polygons apply unless the staging "Test location" place exists --------
create or replace function public.address_save_pin(
  p_customer_id uuid,
  p_lat double precision,
  p_lon double precision,
  p_label text default null,
  p_building text default null,
  p_floor text default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pt extensions.geography;
  v_place record;
  v_place_id text;
  v_test_place text := (select p.id from public.places p where p.id = 'LB-TST-LOCATION' and p.source = 'test'
                          and exists (select 1 from public.vendors v where v.is_test));
  v_id uuid;
begin
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    return jsonb_build_object('status', 'outside_lebanon');
  end if;
  if (p_lat not between 33.0 and 34.8 or p_lon not between 35.0 and 36.7) and v_test_place is null then
    return jsonb_build_object('status', 'outside_lebanon');
  end if;
  v_pt := app_private.lat_lon_point(p_lat, p_lon);
  select a.id into v_id from public.addresses a
  where a.customer_id = p_customer_id and a.pin is not null and extensions.st_dwithin(a.pin, v_pt, 30)
  order by a.pin operator(extensions.<->) v_pt limit 1;
  if v_id is null then
    -- Outside Lebanon there is no polygon to ask; inside, the usual snapping runs first.
    if p_lat between 33.0 and 34.8 and p_lon between 35.0 and 36.7 then
      select * into v_place from public.place_for_point(v_pt);
      v_place_id := v_place.place_id;
    end if;
    -- Staging only: a pin in a paused place (South, Nabatieh) also lands on the Test location, so the test
    -- merchant really takes any pin; real merchants never see it because a test place exists only on staging.
    if v_test_place is not null and v_place_id is not null
       and (select p.service_status from public.places p where p.id = v_place_id) = 'paused' then
      v_place_id := null;
    end if;
    v_place_id := coalesce(v_place_id, v_test_place);
    if v_place_id is null then
      return jsonb_build_object('status', 'no_place');
    end if;
    insert into public.addresses (customer_id, label, place_id, pin, source, building_text, floor, note, is_default)
    values (p_customer_id, left(nullif(trim(p_label), ''), 40), v_place_id, v_pt, 'pin', left(nullif(trim(p_building), ''), 120),
      left(nullif(trim(p_floor), ''), 20), left(nullif(trim(p_note), ''), 300),
      not exists (select 1 from public.addresses a where a.customer_id = p_customer_id and a.is_default))
    returning id into v_id;
  end if;
  update public.addresses set last_used_at = now() where id = v_id;
  update public.baskets set address_id = v_id, last_activity_at = now() where customer_id = p_customer_id and status = 'open';
  return jsonb_build_object('status', 'saved', 'address', public.address_card(v_id));
end;
$$;

-- 4. Search: a test merchant is listed for any pin (the straight-line prefilter is skipped for it) ------------
create or replace function public.vendor_search(
  p_query text default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_business_type public.business_type default null,
  p_cuisine text default null,
  p_limit integer default 5
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
  with q as (
    select nullif(app_private.normalize_place_name(coalesce(p_query, '')), '') as n,
           case when p_lat is not null and p_lon is not null then app_private.lat_lon_point(p_lat, p_lon) end as pt,
           public.max_delivery_km() as max_km
  ),
  base as (
    select v.*, q.n, q.pt,
      case when q.pt is not null then extensions.st_distance(v.location, q.pt) / 1000.0 end as km,
      least(coalesce(v.delivery_radius_km, q.max_km), q.max_km) as limit_km
    from public.vendors v cross join q
    where v.orderable and v.listing_status = 'active' and v.claim_status = 'claimed' and v.delivery_enabled
      and (p_business_type is null or v.business_type = p_business_type)
      and (p_cuisine is null or p_cuisine = any (v.cuisine_tags))
  ),
  scored as (
    select b.*,
      case when b.n is null then 0.5::real else greatest(
        extensions.word_similarity(b.n, app_private.normalize_place_name(coalesce(b.name_ar, '') || ' ' || coalesce(b.name_en, '') || ' ' || coalesce(b.name_fr, ''))),
        case when exists (select 1 from unnest(b.cuisine_tags) t where b.n like '%' || replace(t, '_', ' ') || '%'
                          or replace(t, '_', ' ') like '%' || b.n || '%') then 0.8 else 0 end,
        0.9 * coalesce((select max(extensions.word_similarity(b.n, app_private.normalize_place_name(
                 coalesce(i.name_ar, '') || ' ' || coalesce(i.name_en, '') || ' ' || coalesce(i.name_fr, ''))))
               from public.menu_items i where i.vendor_id = b.id and i.available), 0)
      )::real end as sc,
      case when b.n is null then 'nearby'
           when extensions.word_similarity(b.n, app_private.normalize_place_name(coalesce(b.name_ar, '') || ' ' || coalesce(b.name_en, ''))) >= 0.6 then 'name'
           when exists (select 1 from unnest(b.cuisine_tags) t where b.n like '%' || replace(t, '_', ' ') || '%') then 'cuisine'
           else 'dish' end as why
    from base b
    where b.pt is null or b.km <= b.limit_km or b.is_test
  )
  select s.id, s.name_ar, s.name_en, s.business_type, s.cuisine_tags,
    not (s.paused_until is not null and s.paused_until > now()), s.paused_until, round(s.km::numeric, 2),
    extensions.st_y(s.location::extensions.geometry), extensions.st_x(s.location::extensions.geometry), s.why, s.sc
  from scored s
  where s.n is null or s.sc >= 0.35
  order by (s.paused_until is not null and s.paused_until > now()), s.sc desc, s.km nulls last, s.id
  limit least(greatest(coalesce(p_limit, 5), 1), 10);
$$;

-- 5. Quote: no route, no paused-place block and the first band's fee for a test merchant -------------------
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

-- 6. The road check right after the pin: a test merchant is always "ok" ---------------------------------------
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
  v_paused := coalesce((select p.service_status from public.places p where p.id = v_addr.place_id) = 'paused', false);
  -- A paused place at the pin answers for every real vendor; a test merchant ignores it.
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

-- 7. Placing the order: same bypass, stored road_km = 0 and the first band's fee for a test merchant ----------
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
      if v_place_status = 'paused' then
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
  for v_line in
    select bi.item_id, bi.quantity from public.basket_items bi where bi.basket_id = p_basket_id
    union all
    select c.component_item_id, c.quantity * bi.quantity from public.basket_items bi
    join public.menu_combo_components c on c.combo_item_id = bi.item_id where bi.basket_id = p_basket_id
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

-- 8. Google Places stays off (claim case D) ------------------------------------------------------------------
-- The server function that looks a business up live with the Google server key must not run while the flag
-- is off; this refusal is the second lock, so even a caller that forgot to check the flag creates nothing.
alter function public.vendor_from_google(text, text, double precision, double precision, public.business_type, text, text)
  rename to vendor_from_google_enabled;
create function public.vendor_from_google(p_place_id text, p_name text, p_lat double precision, p_lon double precision,
  p_business_type public.business_type, p_phone text default null, p_address text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce((public.config_value('google_places_enabled') #>> '{}')::boolean, false) then
    return jsonb_build_object('status', 'disabled');
  end if;
  return public.vendor_from_google_enabled(p_place_id, p_name, p_lat, p_lon, p_business_type, p_phone, p_address);
end;
$$;
revoke all on function public.vendor_from_google_enabled(text, text, double precision, double precision, public.business_type, text, text) from public, anon, authenticated;
grant execute on function public.vendor_from_google_enabled(text, text, double precision, double precision, public.business_type, text, text) to service_role;
revoke all on function public.vendor_from_google(text, text, double precision, double precision, public.business_type, text, text) from public, anon, authenticated;
grant execute on function public.vendor_from_google(text, text, double precision, double precision, public.business_type, text, text) to service_role;
