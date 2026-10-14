-- Session D (DECISIONS §38.3, "Optimistic locking on checkout, FOR UPDATE ordered by item ID"): order_place as in
-- 20261012150000, except that the daily-quantity decrements lock menu_items rows in item-id order, one update per
-- item. Before this, two baskets with the same limited items added in opposite orders could deadlock each other
-- (the deadlock-order test in scripts/db-race-test.sh, case 5, reproduces it).

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

