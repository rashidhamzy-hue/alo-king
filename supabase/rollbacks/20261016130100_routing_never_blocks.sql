-- Rollback of 20261016130100_routing_never_blocks.sql: no shop → place distances, routing budget or fixtures; the quotes
-- and the order read the route cache only again (as in 20261014200000 and 20261015140100), and the cache keeps 1-24 h.
-- Redeploy the dispatch function from before session 5f PR 1 together with it (that one fetches routes on browse).
-- The app_config rows stay: config rows are dated and never deleted, and nothing reads them without this migration.
-- What is lost: the computed shop → place distances (route-matrix recomputes them on re-apply), the day's routing
-- counters and the recorded simulator routes (the staging deploy records them again); orders keep their road km.
select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'rollback: routing never blocks an order (session 5f)', true);

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
      v_fee := v_quote.fee_usd;
    else
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
    'address', case when v_address.id is not null then public.address_card(v_address.id) end);
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
    else
      select p.service_status into v_place_status from public.places p where p.id = v_address.place_id;
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
    address_id, delivery_place_id, delivery_pin, road_km, menu_version, usd_lbp_rate, food_subtotal_usd,
    delivery_fee_usd, container_deposit_usd, stairs_floors, stairs_fee_usd, credit_usd, offer_id, offer_usd, discount_usd, total_usd, order_fee_usd, weight_status,
    estimated_total_usd, is_new_customer, customer_note, prep_minutes, placed_at
  ) values (
    app_private.new_order_code(), p_idempotency_key, v_basket.id, v_basket.customer_id, v_vendor.id,
    case when v_basket.payment_method = 'cod' then 'placed' else 'awaiting_payment' end::public.order_status,
    v_basket.fulfilment, case when v_basket.fulfilment = 'delivery' then 'merchant'::public.delivery_mode end,
    v_basket.payment_method, v_address.id, v_address.place_id, v_address.pin, round(v_road_km, 2), v_vendor.menu_version,
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


CREATE OR REPLACE FUNCTION public.route_cache_store(p_origin_lat double precision, p_origin_lon double precision, p_dest_lats double precision[], p_dest_lons double precision[], p_distances_m integer[], p_durations_s integer[], p_provider text, p_profile text DEFAULT 'driving-car'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;


CREATE OR REPLACE FUNCTION app_private.ops_alerts_to_slack()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_channel text := case
    when new.kind in ('merchant_not_answering', 'order_given_up', 'sos', 'arrived_not_delivered', 'order_exception',
                      'food_age', 'not_ready', 'acknowledged_not_accepted', 'merchant_auto_paused', 'channel_down', 'dead_letter') then 'urgent'
    when new.kind in ('money_incident', 'cash_over_limit', 'customer_dispute', 'broadcast', 'ai_budget', 'message_budget') then 'money'
    when new.kind in ('claim_review', 'listing_report', 'menu_help', 'driver_application') then 'claims'
    when new.kind in ('customer_handoff', 'customer_problem', 'support_case') then 'support'
    when new.kind in ('partner_late', 'driver_requested') then 'drivers'
    else 'urgent' end;
  v_code text := (select o.code from public.orders o where o.id = new.order_id);
  v_icon text := case new.severity when 'urgent' then '🚨' when 'warning' then '⚠️' else 'ℹ️' end;
begin
  -- A handoff has its own case thread (support_case_open); its alert row stays the record only.
  if new.kind = 'customer_handoff' then
    return null;
  end if;
  perform app_private.slack_post(v_channel, case when new.order_id is not null and v_channel = 'urgent' then 'alert:' || new.id end,
    v_icon || ' ' || new.summary || coalesce(' · #' || v_code, ''),
    jsonb_build_array(jsonb_build_object('action_id', 'ack_alert', 'text', 'Acknowledge', 'value', new.id::text))
      || case when v_code is not null then jsonb_build_array(jsonb_build_object('action_id', 'order_show', 'text', 'Order #' || v_code, 'value', v_code)) else '[]' end,
    'alert:' || new.id, new.id);
  return null;
exception when others then
  raise warning 'ops_alerts_to_slack: % %', sqlstate, left(sqlerrm, 200);
  return null; -- Slack is a mirror: it never blocks the alert it mirrors (the alert row stays the record)
end;
$function$;

-- Routes cached for 30 days go back to the old ceiling of 24 h before the forget trigger goes.
update public.route_cache set expires_at = least(expires_at, now() + interval '24 hours');
drop trigger addresses_forget_routes on public.addresses;
drop function app_private.addresses_forget_routes();
drop index public.route_cache_dest_key_idx;
drop function app_private.routing_fixtures_record();
drop function public.routing_fixture_lookup(double precision, double precision, double precision[], double precision[]);
drop table public.routing_fixtures;
drop function public.routing_matrix_take(integer);
drop function public.routing_take(text, double precision, double precision, double precision, double precision, boolean);
drop function app_private.routing_usage_count(date, text, integer);
drop table app_private.route_live_attempts;
drop table public.routing_usage;
alter table public.orders drop column route_source;
alter table public.baskets drop column quoted_delivery_fee_usd;
drop function app_private.route_pair(uuid, uuid);
drop function app_private.shop_road_km(uuid, uuid);
drop function public.shop_place_routes_save(jsonb, text);
drop function public.shop_place_routes_needed(text);
drop function app_private.route_matrix_shops(text);
drop table public.shop_place_routes;
