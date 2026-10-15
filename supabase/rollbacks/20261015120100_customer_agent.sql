-- Rollback of 20261015120100_customer_agent.sql (session 5c customer agent): restores the eleven functions it replaced
-- (customer_preference_set, customer_profile, basket_set_checkout, address_save_pin, order_card_payload,
-- customer_marketing_set, basket_quote, order_place, customer_notify, outbox_claim, webhook_finish) exactly as they were
-- before it, and removes everything it added.
--
-- What cannot come back, by design: the migration deleted allergy notes that had been stored without consent (health
-- data needs explicit consent, Law 81/2018 and DECISIONS §39.6); they are not restored. Rolling back also drops the
-- disputes, customer credits, gift requests and the dead-letter queue: replay or export those first. Ledger
-- transactions posted for disputes stay (the ledger is append-only, §20); post reversals for any open credits before
-- running this. Preference rows with the new keys (halal, gluten_free, no_sugar) are kept; the old key check is added
-- NOT VALID so they stay readable.
-- The ops_alert_kind values added by 20261015120000 stay (Postgres cannot drop an enum value); nothing uses them after this.
select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'rollback of 20261015120100_customer_agent', true);

select cron.unschedule('gift-expire');
select cron.unschedule('message-budget-check');
select cron.unschedule('credits-expire');
drop trigger orders_copy_customer_agent on public.orders;
drop trigger orders_credit_settle on public.orders;

-- 1. The replaced functions, as they were.
CREATE OR REPLACE FUNCTION public.address_save_pin(p_customer_id uuid, p_lat double precision, p_lon double precision, p_label text DEFAULT NULL::text, p_building text DEFAULT NULL::text, p_floor text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

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
      -- Outside the delivery area (§39.2: a place that is not on, deny-listed places included) answers like a paused place.
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
$function$
;

CREATE OR REPLACE FUNCTION public.basket_set_checkout(p_customer_id uuid, p_fulfilment fulfilment_kind DEFAULT NULL::fulfilment_kind, p_address_id uuid DEFAULT NULL::uuid, p_stairs_floors integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_basket public.baskets%rowtype;
begin
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_basket.id is null then
    return jsonb_build_object('status', 'no_basket');
  end if;
  if p_address_id is not null and not exists (select 1 from public.addresses a where a.id = p_address_id and a.customer_id = p_customer_id) then
    return jsonb_build_object('status', 'unknown_address');
  end if;
  update public.baskets set
    fulfilment = coalesce(p_fulfilment, fulfilment),
    address_id = coalesce(p_address_id, address_id),
    stairs_floors = case when p_stairs_floors is null then stairs_floors when p_stairs_floors <= 0 then null else least(p_stairs_floors, 30) end,
    customer_note = coalesce(left(nullif(trim(p_note), ''), 300), customer_note),
    last_activity_at = now()
  where id = v_basket.id;
  if p_address_id is not null then
    update public.addresses set last_used_at = now() where id = p_address_id;
  end if;
  return jsonb_build_object('status', 'updated', 'basket', public.basket_view(p_customer_id));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.customer_marketing_set(p_customer_id uuid, p_opt_in boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_opt_in then
    update public.customers set marketing_opt_in = true, marketing_opt_in_at = now() where id = p_customer_id;
  else
    update public.customers set marketing_opt_in = false, marketing_opt_out_at = now() where id = p_customer_id;
  end if;
  return jsonb_build_object('marketing_opt_in', p_opt_in);
end;
$function$
;

CREATE OR REPLACE FUNCTION app_private.customer_notify(p_order_id uuid, p_kind text, p_extra jsonb DEFAULT '{}'::jsonb, p_dedupe text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_o public.orders%rowtype;
  v_c public.customers%rowtype;
  v_id bigint;
begin
  select * into v_o from public.orders where id = p_order_id;
  select * into v_c from public.customers where id = v_o.customer_id;
  if v_c.id is null then
    return null;
  end if;
  v_id := app_private.outbox_add('cust:' || p_order_id || ':' || coalesce(p_dedupe, p_kind), p_order_id, v_o.vendor_id,
    'whatsapp', 'customer_message', v_c.phone_e164,
    jsonb_build_object('kind', p_kind, 'lang', coalesce(v_c.language::text, 'ar'), 'customer_id', v_c.id) || coalesce(p_extra, '{}'));
  if v_id is not null and (v_c.last_inbound_at is null or v_c.last_inbound_at < now() - interval '24 hours') then
    update public.outbound_messages set status = 'skipped', last_error = 'outside the 24-hour window: needs an approved utility template'
    where id = v_id;
  end if;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.customer_preference_set(p_customer_id uuid, p_key text, p_value text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.customer_preferences (customer_id, key, value) values (p_customer_id, p_key, left(trim(p_value), 120))
  on conflict (customer_id, key) do update set value = excluded.value, stated_at = now();
$function$
;

CREATE OR REPLACE FUNCTION public.customer_profile(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with c as (select * from public.customers where id = p_customer_id),
  o as (
    select o.* from public.orders o, c
    where o.customer_id = c.id and o.status = 'delivered' and (c.profile_reset_at is null or o.created_at > c.profile_reset_at)
  )
  select jsonb_build_object(
    'delivered_orders', (select count(*) from o),
    'usual_vendors', coalesce((
      select jsonb_agg(x order by x ->> 'n' desc) from (
        select jsonb_build_object('vendor_id', v.id, 'name', coalesce(v.name_ar, v.name_en), 'n', count(*)) as x
        from o join public.vendors v on v.id = o.vendor_id group by v.id order by count(*) desc limit 3) s), '[]'),
    'usual_items', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('item_id', i.item_id, 'name', coalesce(i.name_ar, i.name_en), 'n', sum(i.quantity)) as x
        from o join public.order_items i on i.order_id = o.id group by i.item_id, coalesce(i.name_ar, i.name_en)
        order by sum(i.quantity) desc limit 5) s), '[]'),
    'last_order_id', (select o.id from o order by o.created_at desc limit 1),
    'usual_hour', (select mode() within group (order by extract(hour from o.created_at at time zone 'Asia/Beirut')::int) from o),
    'addresses', coalesce((
      select jsonb_agg(jsonb_build_object('address_id', a.id, 'label', a.label, 'place', coalesce(p.name_ar, p.name_en),
        'place_en', coalesce(p.name_en, p.name_ar), 'default', a.is_default) order by a.is_default desc, a.last_used_at desc nulls last)
      from public.addresses a join public.places p on p.id = a.place_id where a.customer_id = p_customer_id), '[]'),
    'language', (select language from c),
    'preferences', coalesce((select jsonb_object_agg(key, value) from public.customer_preferences where customer_id = p_customer_id), '{}')
  );
$function$
;

CREATE OR REPLACE FUNCTION app_private.order_card_payload(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'order_id', o.id, 'code', o.code, 'status', o.status, 'fulfilment', o.fulfilment,
    'payment_method', o.payment_method, 'total_usd', o.total_usd, 'total_lbp', o.total_lbp, 'usd_lbp_rate', o.usd_lbp_rate,
    'estimated', o.weight_status in ('awaiting_weight', 'awaiting_customer'), 'is_new_customer', o.is_new_customer,
    'customer_note', o.customer_note, 'prep_minutes', o.prep_minutes,
    'area_en', p.name_en, 'area_ar', p.name_ar,
    'vendor_name', coalesce(v.name_ar, v.name_en),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(i.name_ar, i.name_en), 'name_en', i.name_en,
        'quantity', i.quantity, 'options', (select coalesce(jsonb_agg(coalesce(x ->> 'name_ar', x ->> 'name_en')), '[]') from jsonb_array_elements(i.options) x),
        'kg', i.est_weight_kg, 'has_empty', i.has_empty, 'note', i.note) order by i.created_at, i.id)
      from public.order_items i where i.order_id = o.id), '[]')
  )
  from public.orders o
  join public.vendors v on v.id = o.vendor_id
  left join public.places p on p.id = o.delivery_place_id
  where o.id = p_order_id;
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
      -- §39.2: an address outside the delivery area is refused even when it is within the radius.
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
$function$
;

CREATE OR REPLACE FUNCTION public.outbox_claim(p_limit integer DEFAULT 20, p_lock_s integer DEFAULT 30)
 RETURNS TABLE(id bigint, order_id uuid, vendor_id uuid, channel order_channel_kind, purpose outbox_purpose, target text, payload jsonb, attempts integer, card jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return query
  with claimed as (
    update public.outbound_messages m set status = 'sending', attempts = m.attempts + 1,
      locked_until = now() + make_interval(secs => greatest(p_lock_s, 5))
    where m.id in (
      select x.id from public.outbound_messages x
      where (x.status = 'queued' or (x.status = 'sending' and x.locked_until < now())) and x.available_at <= now()
      order by x.available_at, x.id
      limit least(greatest(p_limit, 1), 100)
      for update skip locked
    )
    returning m.*
  )
  select c.id, c.order_id, c.vendor_id, c.channel, c.purpose, c.target, c.payload, c.attempts,
    case when c.order_id is not null then app_private.order_card_payload(c.order_id) end
  from claimed c order by c.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.webhook_finish(p_msg_id bigint, p_event_id bigint, p_status webhook_status, p_error text DEFAULT NULL::text, p_max_attempts integer DEFAULT 5, p_attempt integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_attempts integer;
begin
  if p_status not in ('done', 'failed', 'ignored') then
    raise exception 'webhook_finish takes done, failed or ignored' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.webhook_events where id = p_event_id) then
    raise exception 'webhook event % does not exist', p_event_id using errcode = 'no_data_found';
  end if;
  -- A finish for an attempt that is no longer the latest (a repeated call after a later claim) changes nothing.
  update public.webhook_events e
    set status = p_status,
        last_error = case when p_status = 'failed' then left(p_error, 1000) else e.last_error end,
        processed_at = case when p_status in ('done', 'ignored') then now() else e.processed_at end
    where e.id = p_event_id and (p_attempt is null or e.attempts = p_attempt)
    returning e.attempts into v_attempts;
  if not found then
    return;
  end if;
  if p_status <> 'failed' or v_attempts >= p_max_attempts then
    perform pgmq.archive('webhook_inbound', p_msg_id);
  else
    -- Back on the queue in 5, 10, 15, 20 s instead of after the claim's visibility timeout.
    perform pgmq.set_vt('webhook_inbound', p_msg_id, least(5 * greatest(v_attempts, 1), 60));
  end if;
end;
$function$
;


-- 2. What the migration added.
drop function public.search_expand(text);
drop function public.catalog_search(uuid, text, integer);
drop view app_private.catalog_docs;
drop function app_private.search_stopword(text);
drop table public.search_lexicon;
drop function public.customer_fact_set(uuid, text, text, text, boolean);
drop function app_private.fact_is_health(text);
drop function public.customer_memory(uuid);
drop function public.customer_memory_forget(uuid, text, text);
drop function app_private.basket_address_confirmed(uuid);
drop function public.basket_address_state(uuid);
drop function public.basket_confirm_address(uuid, uuid);
drop function public.address_set_for_whom(uuid, uuid, text, boolean);
drop function public.address_set_recipient(uuid, uuid, text, text);
drop function public.basket_set_allergy_note(uuid, text);
drop function public.gift_request_create(uuid, uuid, bigint);
drop function public.gift_respond(text, uuid, boolean);
drop function app_private.gift_fingerprint(uuid, jsonb);
drop function app_private.gift_requests_expire();
drop function app_private.orders_copy_customer_agent();
drop function app_private.basket_allergy_note(uuid);
drop function app_private.stairs_fee_usd(uuid);
drop function app_private.credits_for(uuid, numeric);
drop function app_private.credits_expire();
drop function app_private.orders_credit_settle();
drop function app_private.dispute_book(uuid);
drop function public.dispute_open(uuid, uuid, text, uuid, integer);
drop function public.dispute_decide(uuid, boolean, uuid, numeric);
drop function app_private.operator_role(uuid);
drop function public.order_lines_for_customer(uuid, uuid);
drop function public.customer_last_delivered(uuid);
drop function app_private.customer_message_essential(text);
drop function app_private.offer_alternatives(uuid);
drop function public.order_messages_add(uuid, integer);
drop function public.customer_message_report(integer);
drop function app_private.message_budget_check();
drop function app_private.outbox_non_urgent(public.outbox_purpose, jsonb);
drop function public.webhook_dead_replay(bigint, uuid);
drop function public.menu_item_hints(uuid[]);

drop table public.order_disputes;
drop table public.customer_credits;
drop table public.gift_requests;
drop index public.outbound_messages_sent_idx;
drop index public.outbound_messages_target_sent_idx;
select pgmq.drop_queue('webhook_dead');
alter table public.webhook_events drop column dead_lettered_at;
alter table public.customers drop column gift_blocked_at;
alter table public.orders drop column is_gift, drop column recipient_name, drop column recipient_phone, drop column allergy_note,
  drop column credit_usd, drop column customer_messages;
alter table public.baskets drop constraint baskets_gift_has_recipient;
alter table public.baskets drop column address_confirmed_at, drop column is_gift, drop column recipient_name,
  drop column recipient_phone, drop column allergy_note;
alter table public.addresses drop constraint addresses_recipient_for_other;
alter table public.addresses drop column saved, drop column for_whom, drop column recipient_name, drop column recipient_phone,
  drop column pinned_at;
alter table public.customer_preferences drop constraint customer_preferences_health_consent;
alter table public.customer_preferences drop column source, drop column consented_at;
alter table public.customer_preferences drop constraint customer_preferences_key_check;
alter table public.customer_preferences add constraint customer_preferences_key_check
  check (key in ('vegetarian', 'vegan', 'no_pork', 'no_alcohol', 'fasting', 'allergy', 'spice', 'note')) not valid;

-- 3. Config is dated (§1): newer rows restore the earlier values; the new keys stay unread.
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('escalation_give_up_s', '300', now(), 'Rollback of 20261015120100: back to 300 s', null),
  ('ai_model_prices', '{"claude-sonnet-5-5": {"in": 2.00, "out": 10.00}, "gpt-4o-transcribe": {"in": 2.50, "out": 10.00, "audio_min": 0.006}, "gpt-4o-mini-transcribe": {"in": 1.25, "out": 5.00, "audio_min": 0.003}, "claude-haiku-4-5-20251001": {"in": 1.00, "out": 5.00}}', now(),
   'Rollback of 20261015120100: the list before Haiku 5.5', null);
