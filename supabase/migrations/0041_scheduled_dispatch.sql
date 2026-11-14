-- Alo King Chouf, session C3, build plan 2.8 (f): the rider is offered in time for the window, not at confirmation.
-- dispatch_order is copied from 0035 (C2's last text) with three changes: a scheduled order comes due
-- settings.scheduling.release_before_min before its window starts (release_scheduled_order, 0040, which reserves its
-- bought-to-order lines first and tells ops when they are not in yet); until then it answers 'scheduled' and is not batched;
-- and the picker's waiting time counts from when it came due. dispatchAndOffer in ops-turn.ts sends nothing for 'scheduled'
-- or 'stock_short' (the ops exception carries the alert), so the TypeScript is unchanged.
-- orders_waiting_for_rider (0035) lists a scheduled order once it is due, so the cron's minute releases and offers it.
-- pick_queue and start_pick (0031) leave a scheduled order alone until it is released: the pickers never see Friday's order
-- on Monday. order_status_for (0014) answers a scheduled order with its window, never minutes counted from its confirmation.
-- None of these five functions is redefined by a later migration.

create or replace function dispatch_order(p_order uuid) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_pick uuid; v_hot boolean; v_limit int; b jsonb := setting('batching');
        v_orders uuid[]; v_cod numeric; r record; c record; v_delivery uuid; v_sources uuid[]; v_rel text;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.is_pickup then return jsonb_build_object('status', 'pickup_order'); end if;
  -- 2.10: an order left on the road by a rider who could not continue goes to another rider, picked up at the hub.
  if o.status not in ('confirmed','preparing','ready') and not order_stranded(p_order) then
    return jsonb_build_object('status', 'not_dispatchable', 'order_status', o.status);
  end if;
  -- 2.8: a scheduled order is not offered at confirmation. It comes due release_before_min before its window (its
  -- bought-to-order lines reserved then); until then the answer is 'scheduled', and the cron asks again every minute.
  if o.delivery_slot_id is not null and o.released_at is null and o.status = 'confirmed' then
    v_rel := release_scheduled_order(p_order);
    if v_rel <> 'released' then
      return jsonb_build_object('status', v_rel, 'order_id', p_order, 'short_code', o.short_code, 'release_at', order_release_at(p_order));
    end if;
    select * into o from orders where id = p_order;
  end if;
  -- 2.4: a hub order is offered when picking starts, not at confirmation (when this hub picks through the ops line).
  -- 2.8: a scheduled order has waited from the moment it came due, not from its confirmation days ago.
  if o.status = 'confirmed' and order_waits_for_pick(p_order) then
    return jsonb_build_object('status', 'waiting_for_pick', 'order_id', p_order, 'short_code', o.short_code,
                              'minutes_waiting', floor(extract(epoch from now() - coalesce(o.released_at, o.confirmed_at, o.created_at)) / 60));
  end if;
  select d.id into v_delivery from deliveries d join delivery_stops s on s.delivery_id = d.id
   where s.order_id = p_order and d.status in ('offered','accepted','in_progress') limit 1;
  if v_delivery is not null then return jsonb_build_object('status', 'already', 'delivery_id', v_delivery); end if;

  select array_agg(f.source_id order by f.source_id), bool_or(s.kind = 'merchant'),
         (array_agg(s.village_id order by (s.kind = 'merchant'), s.name))[1]
    into v_sources, v_hot, v_pick
    from fulfilments f join sources s on s.id = f.source_id where f.order_id = p_order and f.status <> 'cancelled';
  v_limit := case when v_hot then (b->>'max_detour_temp_min')::int else (b->>'max_detour_min')::int end;

  -- batch: other waiting orders from exactly the same pickups whose door is within the detour limit
  v_orders := array[p_order];
  for r in select o2.id, o2.total_usd, o2.payment_method from orders o2
            where o2.id <> p_order and o2.status in ('confirmed','preparing','ready') and not o2.is_pickup
              and not (o2.status = 'confirmed' and order_waits_for_pick(o2.id))
              and (o2.delivery_slot_id is null or o2.released_at is not null)
              and (select array_agg(f.source_id order by f.source_id) from fulfilments f where f.order_id = o2.id and f.status <> 'cancelled') = v_sources
              and not exists (select 1 from delivery_stops s join deliveries d on d.id = s.delivery_id
                               where s.order_id = o2.id and d.status in ('offered','accepted','in_progress'))
              and coalesce(travel_minutes(o.village_id, o2.village_id), 99) <= v_limit
            order by o2.created_at for update skip locked loop
    exit when array_length(v_orders, 1) >= (b->>'max_orders')::int;
    v_orders := v_orders || r.id;
  end loop;

  <<riders>>
  for c in select sh.driver_id, coalesce(travel_minutes(driver_village(sh.driver_id), v_pick), 30) as mins
             from driver_shifts sh
            where sh.ended_at is null
              and not exists (select 1 from deliveries d where d.driver_id = sh.driver_id and d.status in ('offered','accepted','in_progress'))
              and not exists (select 1 from deliveries d join delivery_stops s on s.delivery_id = d.id
                               where d.driver_id = sh.driver_id and s.order_id = p_order and d.status in ('declined','expired'))
            order by 2, sh.started_at loop
    if not pg_try_advisory_xact_lock(hashtextextended('rider:' || c.driver_id, 0)) then continue; end if;
    if exists (select 1 from deliveries d where d.driver_id = c.driver_id and d.status in ('offered','accepted','in_progress')) then continue; end if;
    -- shrink the batch until the rider's exposure allows it; the first order alone must fit
    loop
      select coalesce(sum(total_usd) filter (where payment_method = 'cod'), 0) into v_cod from orders where id = any(v_orders);
      exit when driver_can_take(c.driver_id, v_cod) = 'ok' or array_length(v_orders, 1) = 1;
      v_orders := v_orders[1 : array_length(v_orders, 1) - 1];
    end loop;
    if driver_can_take(c.driver_id, v_cod) <> 'ok' then continue riders; end if;
    v_delivery := offer_delivery(c.driver_id, v_orders);
    update deliveries set pickup_village = v_pick where id = v_delivery;
    -- the dark store is loaded first, hot food last
    update delivery_stops s set seq = x.rn from (
      select s2.id, row_number() over (order by (s2.kind <> 'pickup'), (src.kind = 'merchant'), s2.seq) as rn
        from delivery_stops s2 left join sources src on src.id = s2.source_id where s2.delivery_id = v_delivery) x
     where s.id = x.id;
    return jsonb_build_object('status', 'offered', 'delivery_id', v_delivery, 'driver_id', c.driver_id,
                              'orders', to_jsonb(v_orders), 'minutes_to_pickup', c.mins);
  end loop;
  return jsonb_build_object('status', 'no_rider', 'order_id', p_order, 'short_code', o.short_code);
end $$;

create or replace function orders_waiting_for_rider() returns uuid[] language sql stable as $$
  select coalesce(array_agg(o.id order by coalesce(o.released_at, o.confirmed_at)), '{}') from orders o
   where (o.status in ('confirmed','preparing','ready') or order_stranded(o.id)) and not o.is_pickup
     and (o.delivery_slot_id is null or o.released_at is not null or order_release_at(o.id) <= now())
     and not exists (select 1 from delivery_stops s join deliveries d on d.id = s.delivery_id
                      where s.order_id = o.id and d.status in ('offered','accepted','in_progress')) $$;

create or replace function pick_queue(p_limit int default 5) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by x->>'status' desc, x->>'confirmed_at'), '[]'::jsonb) from (
    select jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'status', o.status, 'confirmed_at', o.confirmed_at,
             'village', v.name_ar, 'picker_id', ps.picker_id, 'window', window_json(o.delivery_slot_id),
             'items', (select count(*) from order_items i where i.order_id = o.id and i.status = 'ok')) as x
      from orders o left join pick_sessions ps on ps.order_id = o.id and ps.finished_at is null left join villages v on v.id = o.village_id
     where ((o.status = 'confirmed' and ps.order_id is null) or (o.status = 'preparing' and ps.order_id is not null))
       and order_has_hub_goods(o.id) and (o.delivery_slot_id is null or o.released_at is not null)
     order by (o.status = 'preparing') desc, coalesce(o.released_at, o.confirmed_at) limit p_limit) q $$;

create or replace function start_pick(p_order uuid, p_by uuid) returns jsonb language plpgsql as $$
declare o orders%rowtype; s pick_sessions%rowtype; v_other uuid; r record; v_held jsonb := '[]'::jsonb;
begin
  perform pick_start_checks(p_by);
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  select * into s from pick_sessions where order_id = p_order;
  if found then
    return jsonb_build_object('status', case when s.picker_id = p_by then 'already' else 'taken' end, 'picker_id', s.picker_id) || jsonb_build_object('list', pick_list(p_order));
  end if;
  if o.status <> 'confirmed' then return jsonb_build_object('status', 'not_pickable', 'order_status', o.status, 'short_code', o.short_code); end if;
  -- 2.8: a scheduled order is picked when it comes due (its fresh goods are reserved then), not before.
  if o.delivery_slot_id is not null and o.released_at is null then
    return jsonb_build_object('status', 'not_pickable', 'order_status', 'scheduled', 'short_code', o.short_code, 'release_at', order_release_at(p_order));
  end if;
  if not order_has_hub_goods(p_order) then return jsonb_build_object('status', 'not_pickable', 'order_status', o.status, 'short_code', o.short_code); end if;
  v_other := pick_open_for(p_by);
  if v_other is not null then
    return jsonb_build_object('status', 'busy', 'open_order', v_other, 'open_code', (select short_code from orders where id = v_other));
  end if;
  insert into pick_sessions(order_id, picker_id) values (p_order, p_by);
  perform transition_order(p_order, 'preparing', 'picker', p_by, 'pick_started');
  -- Held products cannot be picked by any path: they come up missing now, not at the end.
  for r in select i.id, i.name_snapshot from order_items i join fulfilments f on f.id = i.fulfilment_id join sources sr on sr.id = f.source_id
            where i.order_id = p_order and i.status = 'ok' and sr.kind = 'dark_store' and product_on_hold(i.product_id) loop
    perform pick_found_held(r.id, p_by);
    v_held := v_held || to_jsonb(r.name_snapshot);
  end loop;
  return jsonb_build_object('status', 'started', 'held', v_held, 'list', pick_list(p_order));
end $$;

-- Where is my order (0014): a scheduled order answers with its window, not minutes counted from its confirmation.
create or replace function order_status_for(p_party uuid) returns jsonb language sql stable as $$
  select to_jsonb(x) from (
    select o.id as order_id, o.short_code, o.status, o.total_usd, o.payment_method, o.is_pickup,
           window_json(o.delivery_slot_id) as "window",
           (select z.base_eta_minutes from villages v join zones z on z.id = v.zone_id where v.id = o.village_id) as eta_minutes,
           case when o.status in ('confirmed','preparing','ready','out_for_delivery') and o.confirmed_at is not null and not o.is_pickup
                     and o.delivery_slot_id is null then
             greatest(0, ceil((select z.base_eta_minutes from villages v join zones z on z.id = v.zone_id where v.id = o.village_id)
                              - extract(epoch from now() - o.confirmed_at) / 60))::int end as eta_remaining_minutes
    from orders o where o.customer_id = p_party and o.status not in ('draft', 'closed', 'cancelled', 'returned')
    order by o.created_at desc limit 1) x
$$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
