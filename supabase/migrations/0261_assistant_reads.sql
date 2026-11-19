-- 0261 (session AST1): the console assistant's read-only tools.
--
-- The console assistant (apps/console/src/assistant) answers staff questions about the state of Alo King. It never changes anything
-- (invariant 21: a staff tool may answer from read-only reports and may never act). Every number it says comes from one of the
-- functions below, called in that turn.
--
-- How "read-only" is enforced, not promised:
--   * A role, assistant_reader (nologin, noinherit, no attribute), holds SELECT on the tables and views these functions read, a
--     SELECT-only row policy on each, EXECUTE on the few read helpers they call, and nothing else: no INSERT, UPDATE, DELETE,
--     TRUNCATE, no sequence, no writer function.
--   * Every assistant_* function is SECURITY DEFINER and OWNED BY assistant_reader, with a fixed search_path, and STABLE. So it runs
--     with that role's rights only: even a mistaken write inside one is refused by Postgres (tested: test/db/ast1-assistant.test.ts).
--   * Only service_role may execute them (the console Worker). scripts/check_permissions.sh, section "assistant_reader", fails if the
--     role holds a write privilege, any attribute, or if an assistant_* function is not owned by it.
--
-- The tools (each returns jsonb; times are local clock times, HH:MI, in scheduling_tz(); durations in whole minutes):
--   assistant_orders(day, now)      orders of the day: counts by status and kind, late ones against their promise and the slowest stage
--   assistant_places(day, now)      food places: call-ahead answer times, accepted and refused, closures, prices to confirm
--   assistant_riders(day, now)      riders: on shift, cash held against the caps, deliveries, late pickups
--   assistant_stock(now, days)      stock: low, out, expiring, short or damaged on receiving, temperature log gaps
--   assistant_products(now, days)   products not sellable and why, price basis to confirm, searches that found nothing
--   assistant_customers(day, days)  hand-offs, complaints, the honest-answer cases, feedback (phone numbers masked)
--   assistant_approvals(now)        approvals waiting by kind, and what was approved automatically today
--   assistant_money(day, now)       sales (goods only), cash to collect, ledger differences          (admin only, in the console)
--   assistant_model_spend(now)      model spend this month against its caps (model_costs)             (admin only, in the console)
-- "Promised" (assistant_orders): the customer's confirmation plus the zone's time (zones.base_eta_minutes), plus the place's ready
-- time for a food order (the call ahead's ready_in_min, else the place's prep_minutes): the same rule as Today's "late" (CON1) and
-- FD2's estimate. Pickup orders and orders for a booked window have no such promise and are counted apart, never called late.
-- Test orders (probe parties) are left out of every figure and counted apart.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'assistant_reader') then
    create role assistant_reader nologin noinherit;
  end if;
  -- The role that applies migrations may SET ROLE assistant_reader, so it can give the functions to it (Postgres 16: creating a role does
  -- not give that by itself) and the permission check can probe as it. This gives assistant_reader nothing.
  if not exists (select 1 from pg_roles where rolname = current_user and rolsuper) then
    begin
      execute format('grant assistant_reader to %I', current_user);
    exception when others then
      raise warning 'assistant_reader: could not grant it to % (%)', current_user, sqlerrm;
    end;
  end if;
end $$;

grant usage on schema public to assistant_reader;

-- ---------- small helpers (owned by assistant_reader as well) ----------
create or replace function assistant_hm(p_at timestamptz) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_at is null then null else to_char(p_at at time zone scheduling_tz(), 'HH24:MI') end $$;

create or replace function assistant_min(p_from timestamptz, p_to timestamptz) returns int language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_from is null or p_to is null then null else round(extract(epoch from (p_to - p_from)) / 60)::int end $$;

-- A customer's phone, masked: never more than its last two digits (the personal-data rule).
create or replace function assistant_mask(p_phone text) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case when coalesce(p_phone, '') = '' then null else '•••' || right(regexp_replace(p_phone, '\D', '', 'g'), 2) end $$;

create or replace function assistant_probe_ids() returns uuid[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(id), '{}') from parties where is_probe $$;

create or replace function assistant_hub() returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select id from sources where kind = 'dark_store' order by id limit 1 $$;

-- ---------- orders ----------
create or replace function assistant_orders(p_day date default null, p_now timestamptz default now(), p_limit int default 15)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tz text := scheduling_tz();
  v_day date := coalesce(p_day, (p_now at time zone scheduling_tz())::date);
  v_from timestamptz := (v_day::timestamp at time zone scheduling_tz());
  v_to timestamptz := ((v_day + 1)::timestamp at time zone scheduling_tz());
  v_probe uuid[] := assistant_probe_ids();
  r jsonb;
begin
  with o as (
    select o.*, exists (select 1 from place_calls pc where pc.order_id = o.id) as food
      from orders o where o.created_at >= v_from and o.created_at < v_to and o.status <> 'draft' and o.created_at <= p_now
       and not (o.customer_id = any(v_probe))),
  ev as (
    select e.order_id, min(e.created_at) filter (where e.to_status = 'ready') as ready_at,
           min(e.created_at) filter (where e.to_status = 'out_for_delivery') as out_at,
           min(e.created_at) filter (where e.to_status = 'delivered') as delivered_ev
      from order_events e where e.order_id in (select id from o) and e.created_at <= p_now group by e.order_id),
  t as (
    select o.id, o.short_code, o.status::text as status, o.food, o.is_pickup, o.delivery_slot_id, o.confirmed_at, o.cancel_reason,
           v.name_en as village, z.base_eta_minutes as zone_min, pc.ready_in_min, pc.accepted_at as place_accepted_at, pc.created_at as call_at,
           s.name as place, s.prep_minutes, ev.ready_at, ev.out_at,
           case when coalesce(o.delivered_at, ev.delivered_ev) <= p_now then coalesce(o.delivered_at, ev.delivered_ev) end as done_at
      from o left join ev on ev.order_id = o.id left join villages v on v.id = o.village_id left join zones z on z.id = v.zone_id
      left join place_calls pc on pc.order_id = o.id left join sources s on s.id = pc.source_id),
  p as (
    select t.*,
           case when t.confirmed_at is null or t.is_pickup or t.delivery_slot_id is not null or t.zone_min is null then null
                else t.confirmed_at + make_interval(mins => t.zone_min + case when t.food then coalesce(t.ready_in_min, t.prep_minutes, 0) else 0 end) end as promised,
           t.status in ('confirmed', 'preparing', 'ready', 'out_for_delivery', 'arrived') as open_now
      from t),
  l as (
    select p.*,
           case when p.promised is null then null
                when p.done_at is not null then assistant_min(p.promised, p.done_at)
                when p.open_now then assistant_min(p.promised, p_now) end as late_min,
           -- the stages, in minutes: preparing (picking at the hub, or the restaurant), waiting for a rider, the ride; a stage still running counts to now
           case when p.confirmed_at is null then null else assistant_min(p.confirmed_at, coalesce(p.ready_at, case when p.open_now and p.status in ('confirmed', 'preparing') then p_now end)) end as prep_min,
           case when p.ready_at is null then null else assistant_min(p.ready_at, coalesce(p.out_at, case when p.open_now and p.status = 'ready' then p_now end)) end as wait_min,
           case when p.out_at is null then null else assistant_min(p.out_at, coalesce(p.done_at, case when p.open_now and p.status in ('out_for_delivery', 'arrived') then p_now end)) end as ride_min,
           assistant_min(p.call_at, p.place_accepted_at) as answer_min
      from p),
  s as (
    select l.*,
           (select k from (values (case when l.food then 'restaurant' else 'picking' end, l.prep_min), ('waiting_for_rider', l.wait_min), ('ride', l.ride_min)) x(k, m)
             where m is not null order by m desc limit 1) as slowest
      from l)
  select jsonb_build_object(
    'day', v_day, 'now', assistant_hm(p_now), 'timezone', tz,
    'rule', 'promised = the customer''s confirmation + the zone''s time (+ the place''s ready time for food); pickup and booked-window orders have no such promise',
    'orders', (select count(*) from s where status <> 'cancelled'),
    'cancelled', (select count(*) from s where status = 'cancelled'),
    'cancel_reasons', (select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) from (select coalesce(cancel_reason, 'not given') as reason, count(*) as n from s where status = 'cancelled' group by 1) c),
    'grocery', (select count(*) from s where status <> 'cancelled' and not food),
    'food', (select count(*) from s where status <> 'cancelled' and food),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) as n from s group by status) b),
    'open_now', (select count(*) from s where open_now),
    'waiting_for_confirm_tap', (select count(*) from s where status = 'awaiting_confirmation'),
    'delivered', (select count(*) from s where done_at is not null),
    'delivered_on_time', (select count(*) from s where done_at is not null and late_min is not null and late_min <= 0),
    'delivered_late', (select count(*) from s where done_at is not null and late_min > 0),
    'avg_delivery_min', (select round(avg(assistant_min(confirmed_at, done_at)))::int from s where done_at is not null and promised is not null),
    'late_now', (select count(*) from s where open_now and late_min > 0),
    'late_total', (select count(*) from s where late_min > 0),
    'without_promise', (select count(*) from s where promised is null and status <> 'cancelled'),
    'test_orders_left_out', (select count(*) from orders o2 where o2.created_at >= v_from and o2.created_at < v_to and o2.status <> 'draft' and o2.customer_id = any(v_probe)),
    'late', (select coalesce(jsonb_agg(x order by (x->>'minutes_late')::int desc), '[]'::jsonb) from (
       select jsonb_strip_nulls(jsonb_build_object('code', short_code, 'kind', case when food then 'food' else 'grocery' end, 'village', village, 'place', place,
              'status', status, 'still_open', open_now, 'confirmed', assistant_hm(confirmed_at), 'promised', assistant_hm(promised), 'delivered', assistant_hm(done_at),
              'minutes_late', late_min, 'slowest_stage', slowest,
              'stages_min', jsonb_strip_nulls(jsonb_build_object(case when food then 'restaurant' else 'picking' end, prep_min, 'waiting_for_rider', wait_min, 'ride', ride_min, 'place_answer', answer_min)))) as x
         from s where late_min > 0 order by late_min desc limit greatest(least(p_limit, 50), 1)) q),
    'slowest_stage_counts', (select coalesce(jsonb_object_agg(slowest, n), '{}'::jsonb) from (select slowest, count(*) as n from s where late_min > 0 and slowest is not null group by 1) w)
  ) into r;
  return r;
end $$;

-- ---------- food places ----------
create or replace function assistant_places(p_day date default null, p_now timestamptz default now(), p_call_min int default 10)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_day date := coalesce(p_day, (p_now at time zone scheduling_tz())::date);
  v_from timestamptz := (v_day::timestamp at time zone scheduling_tz());
  v_to timestamptz := ((v_day + 1)::timestamp at time zone scheduling_tz());
  r jsonb;
begin
  with c as (
    select pc.*, assistant_min(pc.created_at, pc.accepted_at) as answer_min
      from place_calls pc where pc.created_at >= v_from and pc.created_at < v_to and pc.created_at <= p_now),
  lg as (
    select pc.source_id, g.action, count(*) as n from place_call_log g join place_calls pc on pc.id = g.call_id
     where g.at >= v_from and g.at < v_to and g.at <= p_now group by 1, 2),
  pl as (
    select s.id, s.name, s.visibility, s.approved_at is not null as approved, s.closed_on, s.prep_minutes, v.name_en as village
      from sources s left join villages v on v.id = s.village_id
     where s.kind = 'merchant' and (s.buys_for_customer or exists (select 1 from c where c.source_id = s.id))),
  rows as (
    select pl.*,
      (select count(*) from c where c.source_id = pl.id) as calls,
      (select count(*) from c where c.source_id = pl.id and c.accepted_at is not null) as accepted,
      (select count(*) from c where c.source_id = pl.id and c.status = 'closed') as refused_closed,
      (select count(*) from c where c.source_id = pl.id and c.status = 'cancelled') as cancelled,
      (select count(*) from c where c.source_id = pl.id and c.status = 'to_call') as waiting_answer,
      (select count(*) from c where c.source_id = pl.id and c.status = 'to_call' and c.created_at <= p_now - make_interval(mins => p_call_min)) as waiting_over_limit,
      (select round(avg(answer_min))::int from c where c.source_id = pl.id and answer_min is not null) as avg_answer_min,
      (select max(answer_min) from c where c.source_id = pl.id) as slowest_answer_min,
      (select round(avg(ready_in_min))::int from c where c.source_id = pl.id and ready_in_min is not null) as avg_ready_in_min,
      coalesce((select n from lg where lg.source_id = pl.id and lg.action = 'item_missing'), 0) as items_missing,
      coalesce((select sum(n) from lg where lg.source_id = pl.id and lg.action in ('price_lower', 'price_up')), 0) as price_changes,
      (select count(*) from menu_dish_proposals d where d.source_id = pl.id and d.status = 'waiting' and d.price_status = 'to_confirm') as prices_to_confirm,
      (select count(*) from menu_dish_proposals d where d.source_id = pl.id and d.status = 'waiting') as dishes_waiting
      from pl)
  select jsonb_build_object(
    'day', v_day, 'now', assistant_hm(p_now), 'call_ahead_limit_min', p_call_min,
    'places', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('place', name, 'village', village, 'visibility', visibility, 'approved', approved,
                  'calls', calls, 'accepted', accepted, 'refused_closed', refused_closed, 'cancelled', cancelled, 'waiting_answer', waiting_answer,
                  'waiting_over_limit', waiting_over_limit, 'avg_answer_min', avg_answer_min, 'slowest_answer_min', slowest_answer_min,
                  'avg_ready_in_min', avg_ready_in_min, 'items_missing', items_missing, 'price_changes', price_changes,
                  'closed_today', closed_on = v_day, 'prices_to_confirm', prices_to_confirm, 'dishes_waiting', dishes_waiting))
                  order by avg_answer_min desc nulls last, name), '[]'::jsonb) from rows),
    'slowest_place', (select name from rows where avg_answer_min is not null order by avg_answer_min desc, name limit 1),
    'slowest_place_avg_answer_min', (select avg_answer_min from rows where avg_answer_min is not null order by avg_answer_min desc, name limit 1),
    'calls', (select count(*) from c), 'accepted', (select count(*) from c where accepted_at is not null),
    'closed_today', (select coalesce(jsonb_agg(name order by name), '[]'::jsonb) from rows where closed_on = v_day),
    'prices_to_confirm', (select coalesce(sum(prices_to_confirm), 0) from rows)
  ) into r;
  return r;
end $$;

-- ---------- riders ----------
create or replace function assistant_riders(p_day date default null, p_now timestamptz default now(), p_late_pickup_min int default 15)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_day date := coalesce(p_day, (p_now at time zone scheduling_tz())::date);
  v_from timestamptz := (v_day::timestamp at time zone scheduling_tz());
  v_to timestamptz := ((v_day + 1)::timestamp at time zone scheduling_tz());
  v_soft numeric := (setting('cash_cap')->>'soft_usd')::numeric;
  v_hard numeric := (setting('cash_cap')->>'hard_usd')::numeric;
  r jsonb;
begin
  with drops as (
    select d.driver_id, st.order_id, st.completed_at
      from delivery_stops st join deliveries d on d.id = st.delivery_id
     where st.kind = 'dropoff' and st.order_id is not null),
  pk as (
    select dr.driver_id, dr.order_id,
           assistant_min((select min(e.created_at) from order_events e where e.order_id = dr.order_id and e.to_status = 'ready'),
                         (select min(e.created_at) from order_events e where e.order_id = dr.order_id and e.to_status = 'out_for_delivery')) as wait_min,
           (select short_code from orders o where o.id = dr.order_id) as code
      from drops dr join orders o on o.id = dr.order_id where o.created_at >= v_from and o.created_at < v_to),
  rd as (
    select p.id, p.display_name,
           (select sh.started_at from driver_shifts sh where sh.driver_id = p.id and sh.ended_at is null and sh.started_at <= p_now order by sh.started_at desc limit 1) as shift_started,
           driver_cash_usd(p.id) as cash, driver_exposure_usd(p.id) as exposure, rider_float_usd(p.id) as float_usd,
           (select count(*) from drops where drops.driver_id = p.id and drops.completed_at >= v_from and drops.completed_at < v_to and drops.completed_at <= p_now) as delivered_today
      from parties p where p.role = 'driver' and not p.is_blocked and not p.is_probe)
  select jsonb_build_object(
    'day', v_day, 'now', assistant_hm(p_now), 'cash_cap_soft_usd', v_soft, 'cash_cap_hard_usd', v_hard, 'late_pickup_min', p_late_pickup_min,
    'on_shift', (select count(*) from rd where shift_started is not null),
    'riders', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('rider', coalesce(display_name, 'Rider'), 'on_shift', shift_started is not null,
                  'shift_started', assistant_hm(shift_started), 'cash_usd', round(cash, 2), 'cash_and_pending_usd', round(exposure, 2), 'food_float_usd', nullif(round(float_usd, 2), 0),
                  'cap_state', case when exposure >= v_hard then 'over_hard_cap' when exposure >= v_soft then 'over_soft_cap' else 'under_caps' end,
                  'deliveries_today', delivered_today,
                  'avg_pickup_wait_min', (select round(avg(wait_min))::int from pk where pk.driver_id = rd.id and wait_min is not null),
                  'late_pickups', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'wait_min', wait_min) order by wait_min desc), '[]'::jsonb)
                                     from pk where pk.driver_id = rd.id and wait_min > p_late_pickup_min)))
                  order by (shift_started is null), exposure desc, display_name), '[]'::jsonb)
               from rd where shift_started is not null or cash <> 0 or delivered_today > 0 or float_usd <> 0),
    'over_hard_cap', (select count(*) from rd where exposure >= v_hard),
    'over_soft_cap', (select count(*) from rd where exposure >= v_soft and exposure < v_hard),
    'late_pickups_total', (select count(*) from pk where wait_min > p_late_pickup_min)
  ) into r;
  return r;
end $$;

-- ---------- stock ----------
create or replace function assistant_stock(p_now timestamptz default now(), p_days int default 3, p_limit int default 20)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_hub uuid := assistant_hub();
  v_today date := (p_now at time zone scheduling_tz())::date;
  v_temp jsonb;
  r jsonb;
begin
  if v_hub is null then return jsonb_build_object('hub', null, 'note', 'no dark store in the database'); end if;
  v_temp := temperature_log_recent(v_hub, 7, p_now);
  with lv as (
    select p.sku, p.name_en, p.name_ar, p.storage::text as zone, sl.on_hand, sl.reserved, sl.reorder_point, (sl.on_hand - sl.reserved) as available
      from stock_levels sl join products p on p.id = sl.product_id where sl.source_id = v_hub and p.is_active),
  ex as (
    select p.sku, p.name_en, l.lot, l.expiry_date, l.qty_left, (l.expiry_date - v_today) as days_left
      from stock_lots l join products p on p.id = l.product_id
     where l.source_id = v_hub and l.qty_left > 0 and l.expiry_date is not null and l.expiry_date <= v_today + p_days),
  rv as (
    select po.number as po, p.sku, p.name_en, rl.ordered, rl.counted, rl.short, rl.damaged, (rl.received_at at time zone scheduling_tz())::date as day
      from receiving_lines rl join purchase_orders po on po.id = rl.po_id join products p on p.id = rl.product_id
     where rl.received_at >= p_now - interval '7 days' and rl.received_at <= p_now and (rl.short > 0 or rl.damaged > 0)),
  ts as (
    select d->>'day' as day, sl->>'zone' as zone, sl->>'slot' as slot, sl->>'state' as state, sl->>'by' as due_by
      from jsonb_array_elements(v_temp) d cross join jsonb_array_elements(d->'slots') sl),
  rd as (
    select d->>'day' as day, x->>'zone' as zone, (x->>'reading_c')::numeric as reading_c, (x->>'in_range')::boolean as in_range
      from jsonb_array_elements(v_temp) d cross join jsonb_array_elements(d->'readings') x)
  select jsonb_build_object(
    'now', assistant_hm(p_now), 'today', v_today, 'expiring_within_days', p_days,
    'out_of_stock', (select count(*) from lv where available <= 0),
    'low', (select count(*) from lv where available > 0 and available <= reorder_point),
    'out_list', (select coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'item', name_en, 'available', available) order by sku), '[]'::jsonb)
                   from (select * from lv where available <= 0 order by sku limit p_limit) a),
    'low_list', (select coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'item', name_en, 'available', available, 'reorder_point', reorder_point) order by available, sku), '[]'::jsonb)
                   from (select * from lv where available > 0 and available <= reorder_point order by available, sku limit p_limit) b),
    'expired', (select count(*) from ex where days_left < 0),
    'expiring', (select count(*) from ex where days_left >= 0),
    'expiry_list', (select coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'item', name_en, 'lot', lot, 'expiry', expiry_date, 'days_left', days_left, 'units_left', qty_left) order by expiry_date, sku), '[]'::jsonb)
                     from (select * from ex order by expiry_date, sku limit p_limit) c),
    'receiving_last_7_days', (select coalesce(jsonb_agg(jsonb_build_object('po', po, 'sku', sku, 'item', name_en, 'ordered', ordered, 'counted', counted, 'short', short, 'damaged', damaged, 'day', day) order by day desc, po, sku), '[]'::jsonb) from rv),
    'receiving_short_units', (select coalesce(sum(short), 0) from rv),
    'receiving_damaged_units', (select coalesce(sum(damaged), 0) from rv),
    'temperature_log_started', exists (select 1 from temperature_readings t where t.source_id = v_hub),
    'temperature_missed_last_7_days', (select count(*) from ts where state = 'missed'),
    'temperature_late_last_7_days', (select count(*) from ts where state = 'late'),
    'temperature_missed', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'zone', zone, 'slot', slot, 'due_by', due_by) order by day desc, slot), '[]'::jsonb) from ts where state = 'missed'),
    'temperature_out_of_range', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'zone', zone, 'reading_c', reading_c) order by day desc), '[]'::jsonb) from rd where not in_range)
  ) into r;
  return r;
end $$;

-- ---------- products ----------
create or replace function assistant_products(p_now timestamptz default now(), p_days int default 7, p_limit int default 20)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_ns jsonb := readiness_not_sellable();
  v_sum jsonb := readiness_summary();
  r jsonb;
begin
  with miss as (select m as reason, count(*) as n from jsonb_array_elements(v_ns) x cross join jsonb_array_elements_text(coalesce(x->'missing', '[]'::jsonb)) m group by m),
  srch as (
    select lower(btrim(d.query)) as q, count(*) as asks, count(distinct d.party_id) as customers, max(d.created_at) as last_seen
      from demand_signals d where d.kind = 'unknown_product' and d.query is not null and d.created_at >= p_now - make_interval(days => p_days) and d.created_at <= p_now
     group by 1)
  select jsonb_build_object(
    'now', assistant_hm(p_now), 'days', p_days,
    'active', v_sum->'active', 'sellable', v_sum->'sellable', 'fact_complete', v_sum->'fact_complete',
    'not_sellable', jsonb_array_length(v_ns),
    'not_sellable_reasons', (select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) from miss),
    'not_sellable_list', (select coalesce(jsonb_agg(jsonb_build_object('sku', x->>'sku', 'item', x->>'name_en', 'missing', x->'missing')), '[]'::jsonb)
                            from (select x from jsonb_array_elements(v_ns) x limit p_limit) y),
    'without_approved_photo', (select count(*) from products p where p.is_active and p.owner_source_id is null
                                 and not exists (select 1 from product_images i where i.product_id = p.id and i.status = 'approved')),
    'photos_waiting_approval', (select count(*) from product_images i where i.status = 'proposed'),
    'price_basis_to_confirm', (select coalesce(jsonb_agg(jsonb_build_object('sku', p.sku, 'item', p.name_en, 'blocks_sale', c.blocks_sale) order by p.sku), '[]'::jsonb)
                                 from price_basis_checks c join products p on p.id = c.product_id where c.resolved_at is null),
    'searches_found_nothing', (select coalesce(jsonb_agg(jsonb_build_object('said', q, 'asks', asks, 'customers', customers, 'last', to_char(last_seen at time zone scheduling_tz(), 'YYYY-MM-DD HH24:MI')) order by asks desc, q), '[]'::jsonb)
                                 from (select * from srch order by asks desc, q limit p_limit) s),
    'searches_found_nothing_total', (select coalesce(sum(asks), 0) from srch)
  ) into r;
  return r;
end $$;

-- ---------- customers ----------
create or replace function assistant_customers(p_day date default null, p_days int default 1, p_now timestamptz default now(), p_limit int default 15)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_day date := coalesce(p_day, (p_now at time zone scheduling_tz())::date);
  v_days int := greatest(least(coalesce(p_days, 1), 31), 1);
  v_from timestamptz := ((v_day - v_days + 1)::timestamp at time zone scheduling_tz());
  v_to timestamptz := least(((v_day + 1)::timestamp at time zone scheduling_tz()), p_now);
  v_probe uuid[] := assistant_probe_ids();
  r jsonb;
begin
  with h as (
    select h.*, cv.party_id from handoffs h join conversations cv on cv.id = h.conversation_id
     where h.created_at >= v_from and h.created_at < v_to and not (cv.party_id = any(v_probe))),
  cc as (
    select c.*, o.short_code, o.customer_id from complaint_cases c left join orders o on o.id = c.order_id
     where c.opened_at >= v_from and c.opened_at < v_to),
  ds as (
    select d.kind::text as kind, lower(btrim(coalesce(d.query, d.subject, ''))) as said, d.party_id
      from demand_signals d where d.created_at >= v_from and d.created_at < v_to and not (coalesce(d.party_id, '00000000-0000-0000-0000-000000000000'::uuid) = any(v_probe))),
  fb as (select f.* from order_feedback f where f.answered_at >= v_from and f.answered_at < v_to)
  select jsonb_build_object(
    'from', v_day - v_days + 1, 'to', v_day, 'days', v_days, 'now', assistant_hm(p_now),
    'handoffs', (select count(*) from h),
    'handoffs_by_reason', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select coalesce(kind, reason) as k, count(*) as n from h group by 1) a),
    'handoffs_open_now', (select count(*) from handoffs h2 where h2.state in ('open', 'claimed')),
    'handoffs_late_now', (select count(*) from handoffs h2 where h2.state in ('open', 'claimed') and h2.late),
    'avg_first_reply_min', (select round(avg(assistant_min(created_at, first_staff_reply_at)))::int from h where first_staff_reply_at is not null),
    'open_handoffs', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_strip_nulls(jsonb_build_object('since', assistant_hm(h2.created_at), 'kind', coalesce(h2.kind, h2.reason), 'order', o.short_code,
               'customer', assistant_mask(p.contact_phone), 'late', h2.late)) as x
          from handoffs h2 join conversations cv on cv.id = h2.conversation_id left join parties p on p.id = cv.party_id left join orders o on o.id = h2.order_id
         where h2.state in ('open', 'claimed') order by h2.created_at limit p_limit) q),
    'complaints', (select count(*) from cc),
    'complaints_by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) as n from cc group by kind) b),
    'complaints_open', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('order', c.short_code, 'kind', c.kind, 'priority', c.priority, 'opened', to_char(c.opened_at at time zone scheduling_tz(), 'YYYY-MM-DD HH24:MI'),
                          'customer', assistant_mask((select contact_phone from parties where id = c.customer_id)))) order by c.opened_at), '[]'::jsonb)
                          from (select c2.*, o.short_code, o.customer_id from complaint_cases c2 left join orders o on o.id = c2.order_id where c2.status = 'open' order by c2.opened_at limit p_limit) c),
    'honest_answers', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) as n from ds group by kind) d),
    'asked_for_and_not_sold', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'said', said, 'asks', asks, 'customers', customers) order by asks desc, said), '[]'::jsonb)
                                 from (select kind, said, count(*) as asks, count(distinct party_id) as customers from ds
                                        where kind in ('unknown_product', 'facts_unconfirmed', 'out_of_stock', 'unsigned_restaurant', 'listing') and said <> ''
                                        group by 1, 2 order by asks desc, said limit p_limit) e),
    'feedback_fine', (select count(*) from fb where verdict = 'fine'),
    'feedback_problem', (select count(*) from fb where verdict = 'problem'),
    'feedback_asked_not_answered', (select count(*) from order_feedback f where f.asked_at >= v_from and f.asked_at < v_to and f.answered_at is null)
  ) into r;
  return r;
end $$;

-- ---------- approvals ----------
create or replace function assistant_approvals(p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_day date := (p_now at time zone scheduling_tz())::date;
  v_from timestamptz := (v_day::timestamp at time zone scheduling_tz());
  v_labels int;
  r jsonb;
begin
  begin v_labels := jsonb_array_length(coalesce(approval_queue(400), '[]'::jsonb)); exception when others then v_labels := null; end;
  select jsonb_build_object(
    'now', assistant_hm(p_now),
    'waiting', jsonb_strip_nulls(jsonb_build_object(
      'names', (select count(*) from product_name_proposals where status = 'proposed'),
      'photos', (select count(*) from product_images where status = 'proposed'),
      'label_readings', v_labels,
      'dishes', (select count(*) from menu_dish_proposals where status = 'waiting'),
      'places', (select count(*) from sources where kind = 'merchant' and buys_for_customer and approved_at is null),
      'second_approvals', (select count(*) from pending_approvals where status = 'pending' and kind <> 'refund'),
      'refunds', (select count(*) from pending_approvals where status = 'pending' and kind = 'refund'),
      'auto_approval_spot_checks', (select count(*) from auto_approval_spot_checks where status = 'waiting'))),
    'oldest_waiting', jsonb_strip_nulls(jsonb_build_object(
      'photos', (select to_char(min(fetched_at) at time zone scheduling_tz(), 'YYYY-MM-DD') from product_images where status = 'proposed'),
      'second_approvals', (select to_char(min(requested_at) at time zone scheduling_tz(), 'YYYY-MM-DD HH24:MI') from pending_approvals where status = 'pending'))),
    'approved_automatically_today', (select count(*) from auto_approvals where created_at >= v_from and created_at <= p_now and applied),
    'approved_automatically_today_by_field', (select coalesce(jsonb_object_agg(field, n), '{}'::jsonb) from (
        select field, count(*) as n from auto_approvals where created_at >= v_from and created_at <= p_now and applied group by field) a),
    'automatic_approvals_undone_today', (select count(*) from auto_approvals where reverted_at >= v_from and reverted_at <= p_now)
  ) into r;
  return r;
end $$;

-- ---------- money (the console offers this to the admin only) ----------
create or replace function assistant_money(p_day date default null, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_day date := coalesce(p_day, (p_now at time zone scheduling_tz())::date);
  v_from timestamptz := (v_day::timestamp at time zone scheduling_tz());
  v_to timestamptz := ((v_day + 1)::timestamp at time zone scheduling_tz());
  v_probe uuid[] := assistant_probe_ids();
  r jsonb;
begin
  with o as (
    select * from orders where created_at >= v_from and created_at < v_to and created_at <= p_now and status not in ('draft', 'cancelled')
       and not (customer_id = any(v_probe))),
  open_cod as (
    select o.* from orders o where o.payment_method = 'cod' and o.status in ('confirmed', 'preparing', 'ready', 'out_for_delivery', 'arrived', 'delivered', 'failed_delivery')
       and not (o.customer_id = any(v_probe))
       and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'confirmed')),
  riders as (select p.id, driver_cash_usd(p.id) as cash from parties p where p.role = 'driver'),
  unbalanced as (
    select e.txn_id from ledger_entries e where e.created_at >= p_now - interval '30 days' and e.created_at <= p_now
     group by e.txn_id having abs(sum(e.usd_equiv)) > 0.005)
  select jsonb_build_object(
    'day', v_day, 'now', assistant_hm(p_now),
    'note', 'sales are goods only: delivery fees and tips belong to whoever delivers and are never company revenue',
    'orders', (select count(*) from o),
    'sales_goods_usd', (select round(coalesce(sum(subtotal_usd), 0), 2) from o),
    'food_service_fees_usd', (select round(coalesce(sum(service_fee_usd), 0), 2) from o),
    'delivery_fees_for_riders_usd', (select round(coalesce(sum(delivery_fee_usd), 0), 2) from o),
    'tips_for_riders_usd', (select round(coalesce(sum(tip_usd), 0), 2) from o),
    'cash_to_collect_orders', (select count(*) from open_cod),
    'cash_to_collect_usd', (select round(coalesce(sum(total_usd), 0), 2) from open_cod),
    'cash_held_by_riders_usd', (select round(coalesce(sum(cash), 0), 2) from riders),
    'cash_drops_to_confirm', (select count(*) from cash_drops where status = 'declared'),
    'cash_drops_to_confirm_usd', (select round(coalesce(sum(declared_usd), 0), 2) from cash_drops where status = 'declared'),
    'payments_to_confirm', (select count(*) from payments where status in ('pending', 'proof_submitted') and method <> 'cod'),
    'payments_to_confirm_usd', (select round(coalesce(sum(amount_usd), 0), 2) from payments where status in ('pending', 'proof_submitted') and method <> 'cod'),
    'over_short_usd', (select round(coalesce(sum(p.over_short_usd), 0), 2) from payments p where p.confirmed_at >= v_from and p.confirmed_at < v_to),
    'day_closed', exists (select 1 from day_closes d where d.day = v_day),
    'day_close_difference_usd', (select difference_value_usd from day_closes d where d.day = v_day),
    'ledger_unbalanced_transactions_30_days', (select count(*) from unbalanced)
  ) into r;
  return r;
end $$;

-- ---------- model spend (the console offers this to the admin only) ----------
create or replace function assistant_model_spend(p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_today date := (p_now at time zone scheduling_tz())::date;
  v_month date := date_trunc('month', v_today)::date;
  v_a jsonb := coalesce(setting('assistant'), '{}'::jsonb);
  v_sim jsonb := coalesce(setting('sim_monthly_cap_usd'), '{}'::jsonb);
  r jsonb;
begin
  select jsonb_build_object(
    'month', to_char(v_month, 'YYYY-MM'), 'today', v_today,
    'workflows_usd', (select coalesce(jsonb_object_agg(workflow, usd), '{}'::jsonb) from (
        select workflow, round(sum(usd), 4) as usd from model_costs where day >= v_month and day <= v_today group by workflow) w),
    'workflows_total_usd', (select round(coalesce(sum(usd), 0), 4) from model_costs where day >= v_month and day <= v_today),
    'customer_turns_usd', (select round(coalesce(sum(usd), 0), 4) from ai_cost_daily where day >= v_month and day <= v_today),
    'assistant_today_usd', (select round(coalesce(sum(usd), 0), 4) from model_costs where workflow in ('assistant', 'assistant-digest') and day = v_today),
    'assistant_month_usd', (select round(coalesce(sum(usd), 0), 4) from model_costs where workflow in ('assistant', 'assistant-digest') and day >= v_month and day <= v_today),
    'assistant_daily_cap_usd', (v_a->>'daily_cap_usd')::numeric,
    'assistant_monthly_cap_usd', (v_a->>'monthly_cap_usd')::numeric,
    'sim_test_month_usd', (select round(coalesce(sum(usd), 0), 4) from model_costs where workflow = 'sim-test' and day >= v_month and day <= v_today),
    'sim_test_monthly_cap_usd', coalesce((v_sim->'months'->>to_char(v_month, 'YYYY-MM'))::numeric, (v_sim->>'default_usd')::numeric),
    'workflow_caps_note', 'each workflow run has its own cap (docs/RULES.md, "Workflow caps"); stopped runs are marked stopped_at_cap',
    'runs_stopped_at_cap', (select count(distinct workflow || run_id) from model_costs where stopped_at_cap and day >= v_month and day <= v_today)
  ) into r;
  return r;
end $$;

-- ---------- the role's rights, and nothing else ----------
do $$ declare t text; f text; r text;
  tabs text[] := array['orders', 'order_events', 'place_calls', 'place_call_log', 'sources', 'villages', 'zones', 'parties', 'settings', 'deliveries',
    'delivery_stops', 'driver_shifts', 'ledger_entries', 'ledger_accounts', 'fx_rates', 'stock_levels', 'stock_lots', 'products', 'receiving_lines',
    'purchase_orders', 'temperature_readings', 'product_images', 'price_basis_checks', 'demand_signals', 'handoffs', 'conversations', 'complaint_cases',
    'order_feedback', 'product_name_proposals', 'menu_dish_proposals', 'pending_approvals', 'auto_approval_spot_checks', 'auto_approvals', 'payments',
    'cash_drops', 'day_closes', 'model_costs', 'product_facts', 'food_attributes', 'offers', 'product_templates', 'product_template_fields',
    'catalog_categories', 'product_categories', 'label_scans', 'label_captures', 'product_evidence', 'product_went_live', 'evidence',
    'category_templates', 'template_fields', 'product_field_values', 'product_certificates', 'catalog_placements', 'product_claims'];
  views text[] := array['ai_cost_daily'];
  fns text[] := array['setting(text)', 'scheduling_tz()', 'current_fx()', 'driver_cash_native(uuid)', 'driver_cash_usd(uuid)', 'driver_pending_cod_usd(uuid)',
    'driver_exposure_usd(uuid)', 'rider_float_usd(uuid)', 'temperature_log_recent(uuid,integer,timestamp with time zone)',
    'temperature_log_day(uuid,date,timestamp with time zone)', 'readiness_not_sellable()', 'readiness_summary()', 'product_template_status(uuid)',
    'approval_queue(integer)', 'product_label_status(uuid,jsonb)', 'sell_requires_label()', 'product_template(uuid)', 'auto_approval_party()',
    'product_is_packaged(uuid)', 'web_real_gtin(text)', 'product_nutrition(uuid)', 'json_num(jsonb)'];
begin
  foreach t in array tabs loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('grant select on table %I to assistant_reader', t);
    -- A row policy makes any leftover client grant reach rows, so the client roles lose every grant on these tables (they never had a use).
    foreach r in array array['anon', 'authenticated', 'web_channel'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
    execute format('drop policy if exists assistant_read on %I', t);
    execute format('create policy assistant_read on %I for select to assistant_reader using (true)', t);
  end loop;
  foreach t in array views loop
    if to_regclass('public.' || t) is not null then execute format('grant select on table %I to assistant_reader', t); end if;
  end loop;
  foreach f in array fns loop
    if to_regprocedure('public.' || f) is not null then execute format('grant execute on function %s to assistant_reader', f); end if;
  end loop;
end $$;

-- The functions belong to the read-only role. CREATE on the schema is needed only for the change of owner, and is taken back at once.
do $$ declare f record; begin
  execute 'grant create on schema public to assistant_reader';
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'assistant\_%' loop
    execute format('alter function %s owner to assistant_reader', f.sig);
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'web_channel') then execute format('revoke all on function %s from web_channel', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
  execute 'revoke create on schema public from assistant_reader';
end $$;
