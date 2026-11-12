-- 0006: rider flow. Shift, dispatch, job, pickup, arrival, delivery, cash, no-answer, prepaid confirmation.
-- Logistics facts (picked up, arrived, delivered) and money facts (cash counted, transfer confirmed) are separate
-- functions on purpose. A late or inferred tap can move an order along the road; it can never post money.

insert into settings(key, value) values
  ('dispatch', '{"position_fresh_min": 30, "unpaid_alert_min": 10}'),
  ('failed_delivery', '{"charge_delivery_fee": true, "charge_merchant_food": true}')
on conflict (key) do nothing;

alter table deliveries add column if not exists pickup_village uuid references villages(id);
alter table delivery_stops add column if not exists inferred boolean not null default false;
create index if not exists deliveries_driver_active on deliveries(driver_id) where status in ('offered','accepted','in_progress');

-- ---------- position ----------
create or replace function nearest_village(p_lat numeric, p_lng numeric) returns uuid language sql stable as $$
  select id from villages where lat is not null
  order by (lat - p_lat) * (lat - p_lat) + (lng - p_lng) * (lng - p_lng) * 0.69 limit 1 $$;   -- cos^2(33.7 deg)

create or replace function record_driver_position(p_driver uuid, p_lat numeric, p_lng numeric, p_source text default 'whatsapp')
returns uuid language plpgsql as $$
declare v uuid := nearest_village(p_lat, p_lng);
begin
  insert into driver_positions(driver_id, lat, lng, village_id, source) values (p_driver, p_lat, p_lng, v, p_source);
  return v;
end $$;

create or replace function hub_village() returns uuid language sql stable as
$$ select village_id from sources where kind = 'dark_store' order by name limit 1 $$;

-- Where we believe the rider is: a fresh pin, else the last stop they completed, else the hub.
create or replace function driver_village(p_driver uuid) returns uuid language sql stable as $$
  select coalesce(
    (select village_id from driver_positions where driver_id = p_driver
        and recorded_at > now() - make_interval(mins => (setting('dispatch')->>'position_fresh_min')::int)
      order by recorded_at desc limit 1),
    (select o.village_id from delivery_stops s join deliveries d on d.id = s.delivery_id join orders o on o.id = s.order_id
      where d.driver_id = p_driver and s.completed_at > now() - interval '45 min' order by s.completed_at desc limit 1),
    hub_village()) $$;

-- ---------- dispatch ----------
-- Picks the closest eligible rider and offers the job. Eligible means: on shift, no job in hand, has not already
-- declined or ignored this order, and exposure (cash held + COD already assigned + this order) stays under the cap.
-- The per-rider advisory lock makes two simultaneous dispatches see each other's assignment.
create or replace function dispatch_order(p_order uuid) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_pick uuid; v_hot boolean; v_limit int; b jsonb := setting('batching');
        v_orders uuid[]; v_cod numeric; r record; c record; v_delivery uuid; v_sources uuid[];
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.is_pickup then return jsonb_build_object('status', 'pickup_order'); end if;
  if o.status not in ('confirmed','preparing','ready') then return jsonb_build_object('status', 'not_dispatchable', 'order_status', o.status); end if;
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

-- Everything the rider's job card needs, in stop order.
create or replace function rider_job(p_delivery uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('delivery_id', d.id, 'driver_id', d.driver_id, 'status', d.status,
    'collect_usd', (select coalesce(sum(o.total_usd), 0) from delivery_stops s join orders o on o.id = s.order_id
                     where s.delivery_id = d.id and o.payment_method = 'cod'),
    'stops', (select jsonb_agg(jsonb_build_object(
        'seq', s.seq, 'kind', s.kind, 'done', s.completed_at is not null, 'arrived', s.arrived_at is not null,
        'source_id', s.source_id, 'source', src.name, 'source_village', sv.name_ar,
        'order_id', o.id, 'short_code', o.short_code, 'order_status', o.status, 'customer', pa.display_name,
        'phone', (select phone_e164 from party_identities pi where pi.party_id = o.customer_id and pi.phone_e164 is not null limit 1),
        'village', ov.name_ar, 'lat', coalesce(s.lat, cp.lat), 'lng', coalesce(s.lng, cp.lng),
        'directions', nullif(concat_ws(' - ', cp.building, cp.floor, cp.directions), ''), 'notes', o.customer_notes,
        'payment_method', o.payment_method, 'total_usd', o.total_usd, 'fx_rate_lbp', o.fx_rate_lbp, 'change_for_usd', o.change_for_usd,
        'paid', exists (select 1 from payments p where p.order_id = o.id and p.status = 'confirmed'),
        'items', (select count(*) from order_items i where i.order_id = o.id)) order by s.seq)
      from delivery_stops s left join sources src on src.id = s.source_id left join villages sv on sv.id = src.village_id
      left join orders o on o.id = s.order_id left join parties pa on pa.id = o.customer_id
      left join villages ov on ov.id = o.village_id left join customer_places cp on cp.id = o.place_id
      where s.delivery_id = d.id))
  from deliveries d where d.id = p_delivery $$;

create or replace function driver_active_delivery(p_driver uuid) returns uuid language sql stable as
$$ select id from deliveries where driver_id = p_driver and status in ('offered','accepted','in_progress') order by offered_at desc limit 1 $$;

-- Accept or decline. An answer to an offer that already expired changes nothing and says so.
create or replace function rider_respond(p_delivery uuid, p_driver uuid, p_accept boolean) returns jsonb language plpgsql as $$
declare d deliveries%rowtype; v_orders uuid[];
begin
  select * into d from deliveries where id = p_delivery for update;
  if not found or d.driver_id <> p_driver then raise exception 'NOT_YOUR_JOB'; end if;
  select array_agg(order_id) into v_orders from delivery_stops where delivery_id = p_delivery and kind = 'dropoff';
  if d.status <> 'offered' then
    return jsonb_build_object('ok', d.status in ('accepted','in_progress') and p_accept, 'status', d.status, 'changed', false, 'orders', to_jsonb(v_orders));
  end if;
  update deliveries set status = case when p_accept then 'accepted' else 'declined' end::delivery_status,
                        accepted_at = case when p_accept then now() end where id = p_delivery;
  return jsonb_build_object('ok', true, 'status', case when p_accept then 'accepted' else 'declined' end, 'changed', true, 'orders', to_jsonb(v_orders));
end $$;

create or replace function rider_owns_stop(p_order uuid, p_driver uuid) returns delivery_stops language plpgsql as $$
declare s delivery_stops%rowtype;
begin
  select st.* into s from delivery_stops st join deliveries d on d.id = st.delivery_id
   where st.order_id = p_order and st.kind = 'dropoff' and d.driver_id = p_driver and d.status in ('accepted','in_progress','completed')
   order by d.offered_at desc limit 1 for update of st;
  if not found then raise exception 'NOT_YOUR_ORDER'; end if;
  return s;
end $$;

-- Picked up at one source (or all of them when p_source is null). When the last pickup is done the orders are on the road.
create or replace function rider_picked_up(p_delivery uuid, p_driver uuid, p_source uuid default null) returns jsonb language plpgsql as $$
declare d deliveries%rowtype; r record; v_left int;
begin
  select * into d from deliveries where id = p_delivery for update;
  if not found or d.driver_id <> p_driver then raise exception 'NOT_YOUR_JOB'; end if;
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

create or replace function rider_arrived(p_order uuid, p_driver uuid) returns jsonb language plpgsql as $$
declare s delivery_stops%rowtype; v order_status;
begin
  s := rider_owns_stop(p_order, p_driver);
  update delivery_stops set arrived_at = coalesce(arrived_at, now()) where id = s.id;
  v := advance_order_to(p_order, 'arrived', 'driver', p_driver);
  return jsonb_build_object('ok', true, 'status', v);
end $$;

create or replace function finish_delivery_if_done(p_delivery uuid) returns boolean language plpgsql as $$
begin
  if exists (select 1 from delivery_stops where delivery_id = p_delivery and completed_at is null) then return false; end if;
  update deliveries set status = 'completed', completed_at = now() where id = p_delivery and status <> 'completed';
  return true;
end $$;

-- Handed over. This is a logistics fact only: it never posts money. A COD order stays "delivered, unpaid"
-- until rider_collect() records the cash, and run_timers() raises it if that takes too long.
create or replace function rider_delivered(p_order uuid, p_driver uuid) returns jsonb language plpgsql as $$
declare s delivery_stops%rowtype; o orders%rowtype; v_paid boolean;
begin
  s := rider_owns_stop(p_order, p_driver);
  if s.arrived_at is null then update delivery_stops set arrived_at = now(), inferred = true where id = s.id; end if;
  update delivery_stops set completed_at = coalesce(completed_at, now()) where id = s.id;
  perform advance_order_to(p_order, 'delivered', 'driver', p_driver);
  select * into o from orders where id = p_order;
  update orders set delivered_at = coalesce(delivered_at, now()) where id = p_order;
  update customer_places set verified_by_driver = true, delivery_count = delivery_count + 1, last_used_at = now() where id = o.place_id;
  v_paid := exists (select 1 from payments where order_id = p_order and status = 'confirmed');
  if v_paid then perform transition_order(p_order, 'closed', 'system', null, 'paid_and_delivered'); end if;
  return jsonb_build_object('ok', true, 'paid', v_paid, 'needs_cash', (not v_paid and o.payment_method = 'cod'),
                            'total_usd', o.total_usd, 'fx_rate_lbp', o.fx_rate_lbp, 'short_code', o.short_code,
                            'delivery_done', finish_delivery_if_done(s.delivery_id));
end $$;

-- Cash counted at the door. Amounts are what changed hands, per currency. Only the assigned rider can post it,
-- only once, only for an order that was actually handed over, and never with negative or impossible figures.
create or replace function rider_collect(
  p_order uuid, p_driver uuid, p_usd numeric, p_lbp numeric, p_change_usd numeric default 0, p_change_lbp numeric default 0
) returns jsonb language plpgsql as $$
declare s delivery_stops%rowtype; o orders%rowtype; v_fx numeric; v_in numeric; v_out numeric; v_gate text; n record;
begin
  s := rider_owns_stop(p_order, p_driver);
  select * into o from orders where id = p_order for update;
  if exists (select 1 from payments where order_id = p_order and status = 'confirmed') then
    return jsonb_build_object('ok', true, 'duplicate', true, 'cash_usd', driver_cash_usd(p_driver));
  end if;
  if o.status not in ('delivered','arrived','out_for_delivery') then raise exception 'NOT_AT_DOOR %', o.status; end if;
  if least(p_usd, p_lbp, p_change_usd, p_change_lbp) < 0 then raise exception 'NEGATIVE_AMOUNT'; end if;
  v_fx := coalesce(o.fx_rate_lbp, current_fx());
  v_in := p_usd + p_lbp / v_fx;  v_out := p_change_usd + p_change_lbp / v_fx;
  if v_out > v_in then raise exception 'CHANGE_EXCEEDS_RECEIVED'; end if;
  if o.status <> 'delivered' then perform rider_delivered(p_order, p_driver); end if;
  perform post_cod_collection(p_order, p_driver, p_usd, p_lbp, p_change_usd, p_change_lbp);
  perform transition_order(p_order, 'closed', 'system', null, 'paid_and_delivered');
  select * into n from driver_cash_native(p_driver);
  v_gate := driver_can_take(p_driver, 0);
  return jsonb_build_object('ok', true, 'duplicate', false, 'cash_usd', driver_cash_usd(p_driver), 'usd', n.usd, 'lbp', n.lbp,
                            'gate', v_gate, 'delivery_done', finish_delivery_if_done(s.delivery_id));
end $$;

-- Nobody at the door. Refused until the wait has run; then the order fails, hub goods go back on the shelf,
-- and what the customer owes (the trip, and food a restaurant already cooked) is carried to their next order.
create or replace function rider_no_answer(p_order uuid, p_driver uuid) returns jsonb language plpgsql as $$
declare s delivery_stops%rowtype; o orders%rowtype; v_wait int; v_left numeric; v_txn uuid := gen_random_uuid();
        v_fee numeric := 0; v_food numeric := 0; v_net numeric; r record; fd jsonb := setting('failed_delivery');
begin
  s := rider_owns_stop(p_order, p_driver);
  select * into o from orders where id = p_order for update;
  if o.status not in ('arrived','out_for_delivery') then return jsonb_build_object('ok', false, 'status', o.status); end if;
  if s.arrived_at is null then
    update delivery_stops set arrived_at = now() where id = s.id;
    perform advance_order_to(p_order, 'arrived', 'driver', p_driver);
    s.arrived_at := now();
  end if;
  select case when z.name = 'outer' then (setting('door_wait')->>'outer_min')::int else (setting('door_wait')->>'default_min')::int end
    into v_wait from villages v join zones z on z.id = v.zone_id where v.id = o.village_id;
  v_left := coalesce(v_wait, 8) - extract(epoch from now() - s.arrived_at) / 60;
  if v_left > 0 then return jsonb_build_object('ok', false, 'wait_more_min', ceil(v_left)); end if;

  perform transition_order(p_order, 'failed_delivery', 'driver', p_driver, 'no_answer');
  update delivery_stops set completed_at = now() where id = s.id;
  if not exists (select 1 from payments where order_id = p_order and status = 'confirmed') then
    if (fd->>'charge_delivery_fee')::boolean then v_fee := o.delivery_fee_usd; end if;
    for r in select f.subtotal_usd, f.source_id, sr.commission_pct from fulfilments f join sources sr on sr.id = f.source_id
              where f.order_id = p_order and sr.kind = 'merchant' and f.status <> 'cancelled' and (fd->>'charge_merchant_food')::boolean loop
      v_net := round(r.subtotal_usd * (1 - r.commission_pct / 100), 2);
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
        (v_txn, ensure_account('merchant_payable:' || r.source_id, 'merchant_payable', null, r.source_id), -v_net, 'USD', -v_net, p_order, 'Cooked, not delivered'),
        (v_txn, ensure_account('revenue_commission', 'revenue_commission'), -(r.subtotal_usd - v_net), 'USD', -(r.subtotal_usd - v_net), p_order, 'Commission');
      v_food := v_food + r.subtotal_usd;
    end loop;
    if v_fee > 0 then
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo)
        values (v_txn, ensure_account('revenue_delivery', 'revenue_delivery'), -v_fee, 'USD', -v_fee, p_order, 'Failed delivery fee');
    end if;
    if v_fee + v_food > 0 then
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo)
        values (v_txn, ensure_account('customer_receivable:' || o.customer_id, 'customer_receivable'::account_kind, o.customer_id),
                v_fee + v_food, 'USD', v_fee + v_food, p_order, 'Owed after failed delivery');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'status', 'failed_delivery', 'customer_owes_usd', v_fee + v_food,
                            'return_to_hub', exists (select 1 from fulfilments f join sources sr on sr.id = f.source_id
                                                      where f.order_id = p_order and sr.kind = 'dark_store'),
                            'delivery_done', finish_delivery_if_done(s.delivery_id));
end $$;

-- ---------- prepaid: a person confirms the transfer landed; the screenshot alone never does ----------
create unique index if not exists payments_external_ref_once on payments(method, external_ref) where external_ref is not null and status = 'confirmed';

create or replace function confirm_payment(p_order uuid, p_by uuid, p_external_ref text, p_amount_usd numeric) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_txn uuid := gen_random_uuid(); v_goods numeric := 0; v_merch numeric := 0; v_net numeric; r record; v_kind account_kind;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.payment_method = 'cod' then raise exception 'COD_ORDER'; end if;
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead','admin')) then raise exception 'NOT_AUTHORISED'; end if;
  if exists (select 1 from payments where order_id = p_order and status = 'confirmed') then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if o.status = 'cancelled' then raise exception 'ORDER_CANCELLED_REFUND_NEEDED'; end if;
  if p_external_ref is null or length(trim(p_external_ref)) < 4 then raise exception 'REFERENCE_REQUIRED'; end if;
  if exists (select 1 from payments where method = o.payment_method and external_ref = p_external_ref and status = 'confirmed') then
    raise exception 'REFERENCE_ALREADY_USED %', p_external_ref; end if;
  if p_amount_usd < o.total_usd - 0.01 then raise exception 'UNDERPAID expected % got %', o.total_usd, p_amount_usd; end if;

  v_kind := case when o.payment_method = 'whish' then 'whish_clearing' else 'omt_clearing' end;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo)
    values (v_txn, ensure_account(v_kind::text, v_kind), p_amount_usd, 'USD', p_amount_usd, p_order, 'Transfer ' || p_external_ref);
  for r in select f.subtotal_usd, s.id as source_id, s.kind, s.commission_pct
           from fulfilments f join sources s on s.id = f.source_id where f.order_id = p_order and f.status <> 'cancelled' loop
    if r.kind = 'dark_store' then v_goods := v_goods + r.subtotal_usd;
    else
      v_net := round(r.subtotal_usd * (1 - r.commission_pct / 100), 2);
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
        (v_txn, ensure_account('merchant_payable:' || r.source_id, 'merchant_payable', null, r.source_id), -v_net, 'USD', -v_net, p_order, 'Owed to merchant'),
        (v_txn, ensure_account('revenue_commission', 'revenue_commission'), -(r.subtotal_usd - v_net), 'USD', -(r.subtotal_usd - v_net), p_order, 'Commission');
      v_merch := v_merch + r.subtotal_usd;
    end if;
  end loop;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
    (v_txn, ensure_account('revenue_goods', 'revenue_goods'), -v_goods, 'USD', -v_goods, p_order, 'Goods'),
    (v_txn, ensure_account('revenue_delivery', 'revenue_delivery'), -o.delivery_fee_usd, 'USD', -o.delivery_fee_usd, p_order, 'Delivery fee'),
    (v_txn, ensure_account('tips_payable', 'tips_payable'), -o.tip_usd, 'USD', -o.tip_usd, p_order, 'Tip'),
    (v_txn, ensure_account('cash_over_short', 'cash_over_short'),
     -(p_amount_usd - v_goods - v_merch - o.delivery_fee_usd - o.tip_usd - o.dues_usd), 'USD',
     -(p_amount_usd - v_goods - v_merch - o.delivery_fee_usd - o.tip_usd - o.dues_usd), p_order, 'Overpayment or rounding');
  if o.dues_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('customer_receivable:' || o.customer_id, 'customer_receivable'::account_kind, o.customer_id), -o.dues_usd, 'USD', -o.dues_usd, p_order, 'Dues settled');
  end if;
  update payments set status = 'confirmed', external_ref = p_external_ref, received_usd = p_amount_usd, confirmed_by = p_by, confirmed_at = now()
   where order_id = p_order and status in ('pending','proof_submitted');
  if not found then
    insert into payments(order_id, method, status, amount_usd, received_usd, external_ref, confirmed_by, confirmed_at)
      values (p_order, o.payment_method, 'confirmed', o.total_usd, p_amount_usd, p_external_ref, p_by, now());
  end if;
  if o.status = 'awaiting_payment' then perform transition_order(p_order, 'confirmed', 'ops', p_by, 'payment_confirmed'); end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'status', 'confirmed');
end $$;

-- ---------- timers: add "delivered but nobody recorded the cash" ----------
create or replace function unpaid_deliveries() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'delivered_unpaid', 'order_id', o.id, 'short_code', o.short_code,
                                               'driver_id', d.driver_id, 'total_usd', o.total_usd)), '[]'::jsonb)
    from orders o join delivery_stops s on s.order_id = o.id and s.kind = 'dropoff' join deliveries d on d.id = s.delivery_id
   where o.status = 'delivered' and o.payment_method = 'cod'
     and o.delivered_at < now() - make_interval(mins => (setting('dispatch')->>'unpaid_alert_min')::int)
     and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'confirmed') $$;

-- Orders this rider handed over and has not yet reported cash for. A typed amount is applied only when there is exactly one.
create or replace function rider_unpaid_orders(p_driver uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'total_usd', o.total_usd, 'fx_rate_lbp', o.fx_rate_lbp)), '[]'::jsonb)
    from orders o join delivery_stops s on s.order_id = o.id and s.kind = 'dropoff' join deliveries d on d.id = s.delivery_id
   where d.driver_id = p_driver and d.status in ('in_progress','completed') and o.status = 'delivered' and o.payment_method = 'cod'
     and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'confirmed') $$;

-- Confirmed orders that no rider is holding yet. The cron retries these every minute.
create or replace function orders_waiting_for_rider() returns uuid[] language sql stable as $$
  select coalesce(array_agg(o.id order by o.confirmed_at), '{}') from orders o
   where o.status in ('confirmed','preparing','ready') and not o.is_pickup
     and not exists (select 1 from delivery_stops s join deliveries d on d.id = s.delivery_id
                      where s.order_id = o.id and d.status in ('offered','accepted','in_progress')) $$;

-- Small lookups the worker needs, as functions, so the worker never reads tables directly.
create or replace function party_address(p_party uuid, p_line wa_line) returns text language sql stable as
$$ select coalesce(phone_e164, wa_user_id) from party_identities where party_id = p_party and line = p_line order by created_at desc limit 1 $$;
create or replace function party_role(p_party uuid) returns text language sql stable as $$ select role::text from parties where id = p_party and not is_blocked $$;
create or replace function ops_recipients() returns uuid[] language sql stable as
$$ select coalesce(array_agg(id), '{}') from parties where role in ('ops_lead','admin') and not is_blocked $$;
