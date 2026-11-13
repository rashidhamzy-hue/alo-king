-- Alo King Chouf, session C2, build plan 2.4: offer the rider when picking starts, not at confirmation.
-- A hub order waits in confirmed until a picker starts it (2.1); dispatch_order then answers waiting_for_pick, and the ops line
-- tells the pickers instead of a rider (dispatchAndOffer in apps/gateway/src/ops-turn.ts). start_pick offers the rider at once.
-- The cron still walks orders_waiting_for_rider every minute, so an order nobody starts reaches ops after settings.picking.pick_alert_min.
-- The rider can now arrive before the goods are ready, so rider_picked_up refuses until every hub order on the job is ready:
-- nothing leaves before the total is final (2.2), and the cash the rider collects is the recalculated one.
-- This applies only when the hub picks through the ops line (a picker registered on it). Without one, as on staging today,
-- orders are offered at confirmation and the rider tap infers the picking steps, exactly as before.
-- Restaurant-only orders are unchanged: the restaurant prepares, the rider is offered at confirmation.
-- dispatch_order and rider_picked_up are copied from 0006 with the 2.4 lines added.

create or replace function hub_uses_pick_flow() returns boolean language sql stable as $$
  select exists (select 1 from parties p join party_identities i on i.party_id = p.id and i.line = 'ops'
                 where p.role = 'picker' and not p.is_blocked) $$;

-- A confirmed order with hub goods waits for a picker. p_started_counts: true when an order being picked must also wait.
create or replace function order_waits_for_pick(p_order uuid, p_started_counts boolean default false) returns boolean language sql stable as $$
  select hub_uses_pick_flow() and order_has_hub_goods(p_order)
     and (select status = 'confirmed' or (p_started_counts and status = 'preparing') from orders where id = p_order) $$;

-- Pickers who receive "new order to pick" on the ops line.
create or replace function pick_recipients() returns uuid[] language sql stable as $$
  select coalesce(array_agg(distinct p.id), '{}') from parties p join party_identities i on i.party_id = p.id and i.line = 'ops'
   where p.role = 'picker' and not p.is_blocked $$;

-- The rider holding (or offered) an order, so the picker's "ready" reaches them.
create or replace function order_rider(p_order uuid) returns uuid language sql stable as $$
  select d.driver_id from delivery_stops s join deliveries d on d.id = s.delivery_id
   where s.order_id = p_order and s.kind = 'dropoff' and d.status in ('offered', 'accepted', 'in_progress') order by d.offered_at desc limit 1 $$;

create or replace function dispatch_order(p_order uuid) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_pick uuid; v_hot boolean; v_limit int; b jsonb := setting('batching');
        v_orders uuid[]; v_cod numeric; r record; c record; v_delivery uuid; v_sources uuid[];
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.is_pickup then return jsonb_build_object('status', 'pickup_order'); end if;
  if o.status not in ('confirmed','preparing','ready') then return jsonb_build_object('status', 'not_dispatchable', 'order_status', o.status); end if;
  -- 2.4: a hub order is offered when picking starts, not at confirmation (when this hub picks through the ops line).
  if o.status = 'confirmed' and order_waits_for_pick(p_order) then
    return jsonb_build_object('status', 'waiting_for_pick', 'order_id', p_order, 'short_code', o.short_code,
                              'minutes_waiting', floor(extract(epoch from now() - coalesce(o.confirmed_at, o.created_at)) / 60));
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

create or replace function rider_picked_up(p_delivery uuid, p_driver uuid, p_source uuid default null) returns jsonb language plpgsql as $$
declare d deliveries%rowtype; r record; v_left int; v_waiting jsonb;
begin
  select * into d from deliveries where id = p_delivery for update;
  if not found or d.driver_id <> p_driver then raise exception 'NOT_YOUR_JOB'; end if;
  -- 2.4: the rider may now arrive while the order is still being picked. Nothing leaves the hub before it is ready.
  select coalesce(jsonb_agg(o.short_code), '[]'::jsonb) into v_waiting from delivery_stops s join orders o on o.id = s.order_id
   where s.delivery_id = p_delivery and s.kind = 'dropoff' and o.status in ('confirmed', 'preparing') and order_waits_for_pick(o.id, true);
  if jsonb_array_length(v_waiting) > 0 then return jsonb_build_object('ok', false, 'status', 'not_ready', 'waiting', v_waiting); end if;
  if d.status = 'offered' then   -- the accept tap was lost; picking up is acceptance
    update deliveries set status = 'accepted', accepted_at = now() where id = p_delivery;
  elsif d.status not in ('accepted','in_progress') then
    return jsonb_build_object('ok', false, 'status', d.status);
  end if;
  update delivery_stops set arrived_at = coalesce(arrived_at, now()), completed_at = coalesce(completed_at, now())
   where delivery_id = p_delivery and kind = 'pickup' and (p_source is null or source_id = p_source);
  update fulfilments f set status = 'handed_over' from delivery_stops s
   where s.delivery_id = p_delivery and s.kind = 'dropoff' and f.order_id = s.order_id
     and (p_source is null or f.source_id = p_source) and f.status <> 'cancelled';
  select count(*) into v_left from delivery_stops where delivery_id = p_delivery and kind = 'pickup' and completed_at is null;
  if v_left = 0 then
    update deliveries set status = 'in_progress' where id = p_delivery;
    for r in select order_id from delivery_stops where delivery_id = p_delivery and kind = 'dropoff' loop
      perform advance_order_to(r.order_id, 'out_for_delivery', 'driver', p_driver);
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'pickups_left', v_left);
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
