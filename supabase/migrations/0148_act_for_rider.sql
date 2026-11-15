-- Alo King Chouf, session D4b: the rider's job on the console, and "act for a rider" (docs/strategy/06-session-plan.md, section 4).
-- Kapso's sandbox reaches one registered phone, and a real rider's phone can die mid-job; the ops lead then does the rider's taps from
-- the console. Nothing here changes a rider rule: act_for_rider calls rider_respond, rider_picked_up, rider_arrived, rider_delivered and
-- rider_collect (0006, 0033) with the rider as p_driver, exactly as the staff line does, and so every refusal of those functions stands
-- (NOT_YOUR_JOB, NOT_YOUR_ORDER, AMOUNT_MISMATCH, the cash cap at offer time).
--
--   * Who may: the ops lead or the admin (require_role). A picker cannot act for a rider.
--   * Who acted: every action that changed something writes one order_events row for each order it touched: actor 'ops', actor_id the
--     person, reason 'acted_for_rider:<action>', meta {driver_id}. The timeline then says that a person did the tap, not the rider.
--     The console also writes its own action log (staff_actions) with the same person and the rider.
--   * 'assign' offers a waiting order to one chosen rider and accepts it for them in one step (offer_delivery, then rider_respond). It is
--     how a second test rider gets a job, how a transfer after "rider off" goes to a named rider, and how a rider with a dead phone is
--     given a job. offer_delivery checks that the rider is on shift and under the cash cap (invariant 5); this does not re-implement it.
--     It refuses an order a rider already holds, a pickup order, and an order that is not waiting for a rider (dispatch_order's own
--     states: confirmed, preparing, ready, or left on the road by a rider who could not continue).
--   * 'start_shift' is start_shift (0004): without a shift a rider is offered nothing.
-- console_rider_board() is the read for the page: every rider with their shift, cash, exposure and live job, and the orders that wait
-- for a rider. A customer's phone number is not in it.

create or replace function act_for_rider(
  p_by uuid, p_driver uuid, p_action text, p_order uuid default null, p_delivery uuid default null,
  p_usd numeric default null, p_lbp numeric default null, p_change_usd numeric default 0, p_change_lbp numeric default 0
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare r jsonb; o orders%rowtype; v_delivery uuid; v_sources uuid[]; v_pick uuid; v_changed boolean; v_order uuid;
begin
  perform require_role(p_by, array['admin', 'ops_lead']);
  if not exists (select 1 from parties where id = p_driver and role = 'driver' and not is_blocked) then raise exception 'NOT_A_DRIVER'; end if;
  if p_action not in ('start_shift', 'assign', 'accept', 'decline', 'picked_up', 'arrived', 'delivered', 'collect') then raise exception 'UNKNOWN_ACTION %', p_action; end if;
  perform pg_advisory_xact_lock(hashtextextended('rider:' || p_driver, 0));     -- the lock dispatch and mark_rider_off take for this rider

  if p_action = 'start_shift' then
    return start_shift(p_driver) || jsonb_build_object('acted_by', p_by, 'acted_for', p_driver, 'action', p_action);
  end if;

  if p_action = 'assign' then
    select * into o from orders where id = p_order for update;
    if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
    if o.is_pickup then raise exception 'PICKUP_ORDER'; end if;
    if o.status not in ('confirmed', 'preparing', 'ready') and not order_stranded(p_order) then raise exception 'NOT_WAITING_FOR_RIDER %', o.status; end if;
    if o.delivery_slot_id is not null and o.released_at is null and o.status = 'confirmed' then raise exception 'NOT_WAITING_FOR_RIDER scheduled'; end if;
    if exists (select 1 from deliveries d join delivery_stops s on s.delivery_id = d.id
                where s.order_id = p_order and s.kind = 'dropoff' and d.status in ('offered', 'accepted', 'in_progress')) then
      raise exception 'ALREADY_WITH_A_RIDER';
    end if;
    select array_agg(f.source_id order by f.source_id), (array_agg(s.village_id order by (s.kind = 'merchant'), s.name))[1]
      into v_sources, v_pick from fulfilments f join sources s on s.id = f.source_id where f.order_id = p_order and f.status <> 'cancelled';
    v_delivery := offer_delivery(p_driver, array[p_order]);
    update deliveries set pickup_village = v_pick where id = v_delivery;
    update delivery_stops s set seq = x.rn from (
      select s2.id, row_number() over (order by (s2.kind <> 'pickup'), (src.kind = 'merchant'), s2.seq) as rn
        from delivery_stops s2 left join sources src on src.id = s2.source_id where s2.delivery_id = v_delivery) x
     where s.id = x.id;
    r := rider_respond(v_delivery, p_driver, true) || jsonb_build_object('delivery_id', v_delivery);
    v_changed := true;
  elsif p_action in ('accept', 'decline') then
    r := rider_respond(p_delivery, p_driver, p_action = 'accept');
    v_changed := coalesce((r->>'changed')::boolean, false);
  elsif p_action = 'picked_up' then
    r := rider_picked_up(p_delivery, p_driver);
    v_changed := coalesce((r->>'ok')::boolean, false);
  elsif p_action = 'arrived' then
    r := rider_arrived(p_order, p_driver);
    v_changed := true;
  elsif p_action = 'delivered' then
    r := rider_delivered(p_order, p_driver);
    v_changed := true;
  else
    if p_usd is null and p_lbp is null then raise exception 'AMOUNT_REQUIRED'; end if;
    r := rider_collect(p_order, p_driver, coalesce(p_usd, 0), coalesce(p_lbp, 0), coalesce(p_change_usd, 0), coalesce(p_change_lbp, 0));
    v_changed := not coalesce((r->>'duplicate')::boolean, false);
  end if;

  if v_changed then
    for v_order in
      select distinct oid from (
        select p_order as oid where p_order is not null
        union all
        select s.order_id from delivery_stops s
         where s.kind = 'dropoff' and s.delivery_id = coalesce(p_delivery, (r->>'delivery_id')::uuid)) x
       where oid is not null loop
      insert into order_events(order_id, from_status, to_status, actor, actor_id, reason, meta)
        select o2.id, o2.status, o2.status, 'ops', p_by, 'acted_for_rider:' || p_action, jsonb_build_object('driver_id', p_driver)
          from orders o2 where o2.id = v_order;
    end loop;
  end if;
  return r || jsonb_build_object('acted_by', p_by, 'acted_for', p_driver, 'action', p_action);
end $$;

create or replace function console_rider_board() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'riders', coalesce((select jsonb_agg(jsonb_build_object(
        'driver_id', p.id, 'name', p.display_name,
        'on_shift', sh.id is not null, 'shift_since', sh.started_at,
        'cash_usd', n.usd, 'cash_lbp', n.lbp,
        'exposure_usd', driver_exposure_usd(p.id),
        'delivery', (select jsonb_build_object('delivery_id', d.id, 'status', d.status, 'offered_at', d.offered_at, 'accepted_at', d.accepted_at, 'job', rider_job(d.id))
                       from deliveries d where d.driver_id = p.id and d.status in ('offered', 'accepted', 'in_progress') order by d.offered_at desc limit 1),
        'unpaid', rider_unpaid_orders(p.id)) order by sh.id is null, p.display_name)
      from parties p
      left join driver_shifts sh on sh.driver_id = p.id and sh.ended_at is null
      cross join lateral driver_cash_native(p.id) n
     where p.role = 'driver' and not p.is_blocked), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(jsonb_build_object(
        'order_id', o.id, 'short_code', o.short_code, 'status', o.status, 'payment_method', o.payment_method, 'total_usd', o.total_usd,
        'village_ar', v.name_ar, 'village_en', v.name_en, 'stranded', order_stranded(o.id)) order by o.confirmed_at)
      from orders o left join villages v on v.id = o.village_id
     where (o.id = any(orders_waiting_for_rider()) or order_stranded(o.id))), '[]'::jsonb)) $$;

-- A function created here is callable by the server role only (as every function since 0124): not by PUBLIC, and so not by web_channel.
do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
