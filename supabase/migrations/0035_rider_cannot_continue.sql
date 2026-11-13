-- Alo King Chouf, session C2, build plan 2.10: a rider who cannot continue (accident, breakdown, phone dead).
-- The ops lead marks the rider off on the ops line. In one transaction (mark_rider_off):
--   * the shift ends, so dispatch offers the rider nothing more;
--   * a job offered or accepted but not yet picked up is cancelled, and its orders wait for a rider again (the cron re-offers);
--   * an order already on the road with this rider is transferred: its stop on the old job is closed as transferred (the first
--     rider can no longer act on it), and the order is offered to another rider with the pickup at the hub, where the goods are
--     brought. Stops the rider already delivered stay theirs: they can still report the cash for them.
--   * the cash the rider holds stays on their account until it is handed over and counted (receive_rider_cash, which declares
--     and confirms one cash drop of exactly what they hold). Nothing is written off.
-- Exposure follows by itself: driver_pending_cod_usd counts only active jobs, so the transferred orders leave the first rider.
-- Earnings follow by itself: the delivery fee settles to the rider of the latest job when the order closes (0009), that is,
-- whoever delivers it. The first rider keeps what they earned on orders they delivered.
-- Instead of a second rider, ops may call an order off (call_off_stranded): it becomes a failed delivery with no charge to the
-- customer, the goods come back through the return count (2.5), and a paid order is owed its money back as credit (0030).
-- dispatch_order is copied from 0033, rider_owns_stop and orders_waiting_for_rider from 0006, with the 2.10 lines added.

alter table delivery_stops add column if not exists transferred_at timestamptz;

create table rider_incidents (
  id         uuid primary key default gen_random_uuid(),
  driver_id  uuid not null references parties(id),
  by_party   uuid not null references parties(id),
  reason     text not null,
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- On the road, with nobody carrying it any more.
create or replace function order_stranded(p_order uuid) returns boolean language sql stable as $$
  select exists (select 1 from orders o where o.id = p_order and o.status in ('out_for_delivery', 'arrived'))
     and exists (select 1 from delivery_stops s where s.order_id = p_order and s.kind = 'dropoff' and s.transferred_at is not null)
     and not exists (select 1 from delivery_stops s join deliveries d on d.id = s.delivery_id
                      where s.order_id = p_order and s.kind = 'dropoff' and d.status in ('offered', 'accepted', 'in_progress')) $$;

create or replace function mark_rider_off(p_driver uuid, p_by uuid, p_reason text default 'cannot_continue') returns jsonb language plpgsql as $$
declare d record; s record; v_requeued jsonb := '[]'::jsonb; v_stranded jsonb := '[]'::jsonb; n record; v_code text;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if not exists (select 1 from parties where id = p_driver and role = 'driver') then raise exception 'NOT_A_DRIVER'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rider:' || p_driver, 0));     -- the lock dispatch takes for this rider
  if not exists (select 1 from driver_shifts where driver_id = p_driver and ended_at is null)
     and not exists (select 1 from deliveries where driver_id = p_driver and status in ('offered', 'accepted', 'in_progress')) then
    select * into n from driver_cash_native(p_driver);
    return jsonb_build_object('ok', true, 'already', true, 'rider', (select display_name from parties where id = p_driver),
                              'requeued', '[]'::jsonb, 'stranded', '[]'::jsonb, 'cash_usd', n.usd, 'cash_lbp', n.lbp);
  end if;
  for d in select id, status from deliveries where driver_id = p_driver and status in ('offered', 'accepted', 'in_progress') for update loop
    if d.status in ('offered', 'accepted') then
      update deliveries set status = 'cancelled' where id = d.id;
      select v_requeued || coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'short_code', o.short_code)), '[]'::jsonb) into v_requeued
        from delivery_stops st join orders o on o.id = st.order_id where st.delivery_id = d.id and st.kind = 'dropoff';
    else
      for s in select st.id, st.order_id, o.short_code, o.customer_id, o.status from delivery_stops st join orders o on o.id = st.order_id
                where st.delivery_id = d.id and st.kind = 'dropoff' and st.completed_at is null for update of st loop
        update delivery_stops set transferred_at = now(), completed_at = now() where id = s.id;
        insert into order_events(order_id, from_status, to_status, actor, actor_id, reason, meta)
          values (s.order_id, s.status, s.status, 'ops', p_by, 'rider_cannot_continue', jsonb_build_object('driver_id', p_driver));
        v_stranded := v_stranded || jsonb_build_object('order_id', s.order_id, 'short_code', s.short_code, 'customer_id', s.customer_id);
      end loop;
      perform finish_delivery_if_done(d.id);
    end if;
  end loop;
  update driver_shifts set ended_at = now() where driver_id = p_driver and ended_at is null;
  select * into n from driver_cash_native(p_driver);
  insert into rider_incidents(driver_id, by_party, reason, detail)
    values (p_driver, p_by, coalesce(nullif(btrim(p_reason), ''), 'cannot_continue'),
            jsonb_build_object('requeued', v_requeued, 'stranded', v_stranded, 'cash_usd', n.usd, 'cash_lbp', n.lbp));
  select display_name into v_code from parties where id = p_driver;
  perform raise_ops_exception('rider_off', p_driver::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'),
    jsonb_build_object('rider', v_code, 'stranded', v_stranded, 'cash_usd', n.usd, 'cash_lbp', n.lbp));
  return jsonb_build_object('ok', true, 'rider', v_code, 'requeued', v_requeued, 'stranded', v_stranded,
                            'cash_usd', n.usd, 'cash_lbp', n.lbp, 'unpaid', rider_unpaid_orders(p_driver));
end $$;

-- The cash the rider held, handed over and counted at the hub: one drop of exactly what they hold, confirmed by ops.
create or replace function receive_rider_cash(p_driver uuid, p_by uuid) returns jsonb language plpgsql as $$
declare n record; v_drop uuid;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  select * into n from driver_cash_native(p_driver);
  if n.usd = 0 and n.lbp = 0 then return jsonb_build_object('ok', true, 'usd', 0, 'lbp', 0, 'nothing', true); end if;
  v_drop := declare_cash_drop(p_driver, 'hub', n.usd, n.lbp, null);
  perform confirm_cash_drop(v_drop, p_by);
  return jsonb_build_object('ok', true, 'usd', n.usd, 'lbp', n.lbp, 'drop_id', v_drop, 'cash_left_usd', driver_cash_usd(p_driver));
end $$;

-- Ops calls a stranded order off: no charge to the customer, the goods come back for counting, a paid order is owed its money.
create or replace function call_off_stranded(p_order uuid, p_by uuid) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_taken boolean; v_amt numeric; v_credit numeric := 0; c record;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.status not in ('out_for_delivery', 'arrived') then return jsonb_build_object('ok', false, 'status', o.status, 'short_code', o.short_code); end if;
  -- An offer the cron already made to another rider is withdrawn; a rider who already accepted keeps it.
  select exists (select 1 from delivery_stops s join deliveries d on d.id = s.delivery_id
                  where s.order_id = p_order and s.kind = 'dropoff' and d.status in ('accepted', 'in_progress')) into v_taken;
  if v_taken then return jsonb_build_object('ok', false, 'status', 'taken_over', 'short_code', o.short_code); end if;
  update deliveries d set status = 'cancelled' from delivery_stops s
   where s.delivery_id = d.id and s.order_id = p_order and s.kind = 'dropoff' and d.status = 'offered';
  if not order_stranded(p_order) then return jsonb_build_object('ok', false, 'status', 'not_stranded', 'short_code', o.short_code); end if;
  perform transition_order(p_order, 'failed_delivery', 'ops', p_by, 'rider_incident');
  if exists (select 1 from payments where order_id = p_order and status = 'confirmed') then
    for c in select * from (values ('goods', 'revenue_goods'), ('delivery_fee', 'revenue_delivery'), ('small_order_fee', 'revenue_small_order')) x(charge, code) loop
      v_amt := order_revenue_usd(p_order, c.code);
      if v_amt > 0 then
        perform grant_customer_credit(p_order, v_amt, c.charge, 'order_cancelled', p_by, 'rider could not continue', null, 'calloff:' || p_order || ':' || c.charge);
        v_credit := v_credit + v_amt;
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'status', 'failed_delivery', 'short_code', o.short_code, 'customer_id', o.customer_id, 'credit_usd', v_credit);
end $$;

-- Riders on shift, for the ops lead's list.
create or replace function riders_on_shift() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('driver_id', p.id, 'name', p.display_name, 'since', sh.started_at,
           'cash_usd', driver_cash_usd(p.id), 'active_delivery', driver_active_delivery(p.id)) order by sh.started_at), '[]'::jsonb)
    from driver_shifts sh join parties p on p.id = sh.driver_id where sh.ended_at is null $$;

create or replace function dispatch_order(p_order uuid) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_pick uuid; v_hot boolean; v_limit int; b jsonb := setting('batching');
        v_orders uuid[]; v_cod numeric; r record; c record; v_delivery uuid; v_sources uuid[];
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.is_pickup then return jsonb_build_object('status', 'pickup_order'); end if;
  -- 2.10: an order left on the road by a rider who could not continue goes to another rider, picked up at the hub.
  if o.status not in ('confirmed','preparing','ready') and not order_stranded(p_order) then
    return jsonb_build_object('status', 'not_dispatchable', 'order_status', o.status);
  end if;
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

create or replace function rider_owns_stop(p_order uuid, p_driver uuid) returns delivery_stops language plpgsql as $$
declare s delivery_stops%rowtype;
begin
  select st.* into s from delivery_stops st join deliveries d on d.id = st.delivery_id
   where st.order_id = p_order and st.kind = 'dropoff' and d.driver_id = p_driver and d.status in ('accepted','in_progress','completed')
     and st.transferred_at is null
   order by d.offered_at desc limit 1 for update of st;
  if not found then raise exception 'NOT_YOUR_ORDER'; end if;
  return s;
end $$;

create or replace function orders_waiting_for_rider() returns uuid[] language sql stable as $$
  select coalesce(array_agg(o.id order by o.confirmed_at), '{}') from orders o
   where (o.status in ('confirmed','preparing','ready') or order_stranded(o.id)) and not o.is_pickup
     and not exists (select 1 from delivery_stops s join deliveries d on d.id = s.delivery_id
                      where s.order_id = o.id and d.status in ('offered','accepted','in_progress')) $$;

do $$ declare r text;
begin
  alter table rider_incidents enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table rider_incidents from %I', r); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
