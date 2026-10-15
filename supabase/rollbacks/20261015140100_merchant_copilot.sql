-- Rollback of 20261015140100_merchant_copilot.sql (session 5c merchant copilot): restores vendor_open_at, hours_tick,
-- proposal_roles, basket_quote and order_place exactly as they were after 20261015120100, puts the merchant proposal
-- functions back under their own names, and removes everything the copilot added.
-- What goes with it: running offers, availability holds (items they hid stay off: switch them on by hand or with
-- "back" first), closures, Boost budgets (never charged), merchant facts and suggestions, the station, stock-carry and
-- removed marks on menu items, and the offer columns on orders (their discount stays in discount_usd, so totals still
-- add up). The proposal_kind values added by 20261015140000 stay (Postgres cannot drop an enum value); nothing creates
-- them after this, and proposals of those kinds can no longer be confirmed.
select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'rollback of 20261015140100_merchant_copilot', true);

select cron.unschedule('availability-restore');
select cron.unschedule('stock-carry-over');
select cron.unschedule('merchant-facts');
select cron.unschedule('merchant-suggestions');
select cron.unschedule('merchant-weekly-summary');

-- 1. The replaced functions, as they were.
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
  select coalesce(sum(c.amount_usd), 0) into v_credit from app_private.credits_for(p_customer_id, v_subtotal) c;
  v_total := v_subtotal + v_fee + v_deposit + v_stairs - v_credit;
  v_new := not exists (select 1 from public.orders o where o.customer_id = p_customer_id and o.status = 'delivered');
  v_cap := public.config_numeric('cod_cap_usd');
  if v_new then
    v_cap := least(v_cap, public.config_numeric('cod_cap_new_number_usd'));
  end if;
  return jsonb_build_object('status', 'ok', 'basket', v_view, 'subtotal_usd', v_subtotal, 'delivery_fee_usd', v_fee,
    'deposit_usd', v_deposit, 'stairs_fee_usd', v_stairs, 'credit_usd', v_credit, 'total_usd', v_total, 'usd_lbp_rate', v_rate,
    'total_lbp', round(v_total * v_rate, 0), 'road_km', v_road,
    'cod_cap_usd', v_cap, 'over_cod_cap', v_basket.payment_method = 'cod' and v_total > v_cap,
    'estimated', exists (select 1 from jsonb_array_elements(v_view -> 'lines') l where (l ->> 'estimated')::boolean),
    'needs_empty_answer', exists (select 1 from jsonb_array_elements(v_view -> 'lines') l where (l ->> 'needs_empty_answer')::boolean),
    'stairs_fee_per_floor_usd', v_vendor.stairs_fee_per_floor_usd,
    'is_gift', v_basket.is_gift, 'recipient_name', v_basket.recipient_name, 'allergy_note', app_private.basket_allergy_note(v_basket.id),
    'address', case when v_address.id is not null then public.address_card(v_address.id) end);
end;
$function$
;

CREATE OR REPLACE FUNCTION app_private.hours_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
  n_paused int := 0;
  n_resumed int := 0;
  v_next timestamptz;
begin
  perform set_config('app.actor_kind', 'system', true);
  for v in
    select x.id, x.paused_until, x.pause_reason from public.vendors x
    where x.orderable and exists (select 1 from public.vendor_hours h where h.vendor_id = x.id)
  loop
    if app_private.vendor_open_at(v.id) then
      if v.pause_reason = 'closed (hours)' and v.paused_until > now() then
        perform app_private.vendor_set_pause(v.id, null, null, 'opened (hours)');
        n_resumed := n_resumed + 1;
      end if;
    elsif v.paused_until is null or v.paused_until <= now() then
      v_next := app_private.vendor_next_open(v.id);
      if v_next is not null then
        perform app_private.vendor_set_pause(v.id, v_next, 'closed (hours)', 'closed (hours)');
        n_paused := n_paused + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('paused', n_paused, 'resumed', n_resumed);
end;
$function$
;

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
  from app_private.credits_for(v_basket.customer_id, v_subtotal) c;

  v_total := v_subtotal + v_delivery_fee + v_deposit + v_stairs - v_credit;

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
    delivery_fee_usd, container_deposit_usd, stairs_floors, stairs_fee_usd, credit_usd, discount_usd, total_usd, order_fee_usd, weight_status,
    estimated_total_usd, is_new_customer, customer_note, prep_minutes, placed_at
  ) values (
    app_private.new_order_code(), p_idempotency_key, v_basket.id, v_basket.customer_id, v_vendor.id,
    case when v_basket.payment_method = 'cod' then 'placed' else 'awaiting_payment' end::public.order_status,
    v_basket.fulfilment, case when v_basket.fulfilment = 'delivery' then 'merchant'::public.delivery_mode end,
    v_basket.payment_method, v_address.id, v_address.place_id, v_address.pin, round(v_road_km, 2), v_vendor.menu_version,
    v_rate, v_subtotal, v_delivery_fee, v_deposit, case when v_stairs > 0 then v_basket.stairs_floors end, v_stairs, v_credit, v_credit, v_total,
    public.order_fee_usd(v_vendor.id, v_subtotal), case when v_weighted then 'awaiting_weight' else 'none' end::public.weight_status,
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
          jsonb_build_object('menu_version', v_order.menu_version, 'low_stock', v_low, 'credit_usd', v_credit));

  return jsonb_build_object('status', 'placed', 'order_id', v_order.id, 'code', v_order.code,
    'total_usd', v_order.total_usd, 'total_lbp', v_order.total_lbp, 'usd_lbp_rate', v_order.usd_lbp_rate,
    'estimated', v_weighted, 'new_customer', v_new_customer, 'low_stock', v_low, 'credit_usd', v_credit);
end;
$function$
;

CREATE OR REPLACE FUNCTION app_private.proposal_roles(p_kind proposal_kind)
 RETURNS member_role[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_kind in ('staff_add', 'staff_remove') then array['owner']::public.member_role[]
    when p_kind in ('price', 'capacity', 'same_price', 'needs_power') then array['owner', 'manager']::public.member_role[]
    else array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[] end;
$function$
;

CREATE OR REPLACE FUNCTION app_private.vendor_open_at(p_vendor_id uuid, p_at timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with t as (select (p_at at time zone 'Asia/Beirut') as l)
  select case when not exists (select 1 from public.vendor_hours h where h.vendor_id = p_vendor_id) then true
    else exists (
      select 1 from public.vendor_hours h, t
      where h.vendor_id = p_vendor_id and (
        -- same-day window
        (h.opens < h.closes and h.weekday = extract(dow from t.l) and t.l::time >= h.opens and t.l::time < h.closes)
        -- window past midnight: the evening part on its day, the early part on the next day
        or (h.opens >= h.closes and h.weekday = extract(dow from t.l) and t.l::time >= h.opens)
        or (h.opens >= h.closes and h.weekday = (extract(dow from t.l)::int + 6) % 7 and t.l::time < h.closes)))
    end;
$function$
;


-- 2. The proposal functions under their own names again, with their grants (20261011090200).
drop function app_private.merchant_proposal_create(uuid, public.proposal_kind, jsonb, text, uuid);
alter function app_private.merchant_proposal_create_base(uuid, public.proposal_kind, jsonb, text, uuid) rename to merchant_proposal_create;
drop function app_private.merchant_proposal_decide(uuid, boolean, uuid);
alter function app_private.merchant_proposal_decide_base(uuid, boolean, uuid) rename to merchant_proposal_decide;
revoke all on function app_private.merchant_proposal_create(uuid, public.proposal_kind, jsonb, text, uuid),
  app_private.merchant_proposal_decide(uuid, boolean, uuid) from public, anon;
grant execute on function app_private.merchant_proposal_create(uuid, public.proposal_kind, jsonb, text, uuid),
  app_private.merchant_proposal_decide(uuid, boolean, uuid) to authenticated, service_role;

-- 3. What the migration added.
drop function app_private.proposal_apply_copilot(public.merchant_proposals, uuid);
drop function app_private.proposal_check_copilot(uuid, public.proposal_kind, jsonb);
drop function app_private.availability_tick();
drop function app_private.availability_restore(uuid);
drop function app_private.availability_off(uuid, text, text, timestamptz, text, uuid);
drop function app_private.availability_items(uuid, text, text);
drop function app_private.stock_carry_over();
drop function app_private.offer_for_basket(uuid);
drop function public.merchant_menu_parts(uuid, uuid);
drop function public.vendor_staff_list(uuid, uuid);
drop function public.merchant_report(uuid, uuid, text);
drop function public.merchant_memory(uuid, uuid);
drop function public.merchant_fact_writes_in(uuid, text);
drop function app_private.merchant_weekly_summary();
drop function app_private.merchant_suggest_tick();
drop function app_private.merchant_suggest(uuid, text, public.proposal_kind, jsonb, text);
drop function app_private.merchant_facts_refresh_all();
drop function app_private.merchant_facts_refresh(uuid);
drop function app_private.merchant_fact_put(uuid, text, jsonb, text);
drop table app_private.merchant_suggestions;
drop table public.merchant_facts;
drop table public.merchant_campaigns;
alter table public.orders drop column offer_id, drop column offer_usd;
drop table public.vendor_offers;
drop function app_private.vendor_offers_bump_version();
drop table public.vendor_closures;
drop table public.availability_holds;
alter table public.vendor_ops drop column min_order_usd;
alter table public.menu_items drop column station, drop column stock_tracked, drop column removed_at;
