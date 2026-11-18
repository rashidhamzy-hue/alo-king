-- Alo King Chouf, session FD2, migration 0250 of 0249 to 0251: staff call the place ahead, and the rider buys at the counter.
-- docs/DECISIONS.md, "FD2, 18 November 2026".
--
--   1 the call ahead      when a food order is confirmed (the customer's own tap), a task: call the place on its phone (FD1's place_contacts,
--                         read only by the console) and read the order out. Staff record one outcome:
--                           accepted        with the ready-in minutes: the order goes to preparing (the place took it); the arrival
--                                           estimate is the ready-in minutes plus the ride. Only then is a rider offered the job.
--                           item missing    the customer is asked (keep the rest, or cancel), never swapped silently. Their tap decides.
--                           closed          the order is cancelled and the place is closed for the rest of the day (sources.closed_on).
--                           price changed   a new price for one item: lower or equal is applied and said; higher waits for the customer's
--                                           own tap (accept the new total, or cancel) before anything changes.
--                         Every step is logged (place_call_log, append-only). The customer is told each step in their language by the
--                         console, through the gateway (invariants 1, 9, 20); nothing here sends.
--   2 dispatch waits      dispatch_order (0041) answers waiting_for_place while a food order's call is not accepted, so no rider goes to a
--                         place that has not taken the order.
--   3 the rider's float   cash Alo King gives a rider to buy food at the counter: given and returned by an ops lead or admin
--                         (hub_cash <-> driver_float:<rider>); paid to the place with the amount and the receipt photo (driver_float ->
--                         merchant_payable:<place>, which the cash at the door credits with what the customer pays for the food, 0249).
--                         The float is not the rider's cash: the cash cap (driver_can_take) is unchanged.
--   4 the shift balance   per rider since the shift began: float given, paid to places (each order: owed, paid, the difference), returned,
--                         held; cash collected at the door, dropped, held. A difference is shown, never deducted (invariant 10).
-- Nothing here is reached by a model (invariant 3): staff act through the console, customers through their own buttons.

-- ---------- 1 ----------
create table if not exists place_calls (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null unique references orders(id),
  source_id     uuid not null references sources(id),
  status        text not null default 'to_call' check (status in ('to_call', 'waiting_customer', 'accepted', 'closed', 'cancelled')),
  ready_in_min  int check (ready_in_min between 0 and 180),
  accepted_at   timestamptz,
  ready_at      timestamptz,
  pending       jsonb,                                     -- what the customer is asked: {kind: item_missing | price_up, ...}
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references parties(id)
);
create index if not exists place_calls_open on place_calls(status, created_at) where status in ('to_call', 'waiting_customer');
comment on table place_calls is 'FD2. One per confirmed food order: staff call the place ahead and record accepted, an item missing, closed or a price change.';

create table if not exists place_call_log (
  id        bigint generated always as identity primary key,
  call_id   uuid not null references place_calls(id),
  action    text not null check (action in ('created', 'accepted', 'item_missing', 'closed', 'price_lower', 'price_up', 'customer_drop',
                                            'customer_cancel', 'customer_accept_price', 'customer_decline_price')),
  by_party  uuid references parties(id),
  at        timestamptz not null default now(),
  detail    jsonb not null default '{}'
);
create or replace function place_call_log_append_only() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'place_call_log is append-only'; end $$;
drop trigger if exists place_call_log_no_change on place_call_log;
create trigger place_call_log_no_change before update or delete on place_call_log for each row execute function place_call_log_append_only();

-- The task, made when the customer's tap confirms a food order.
create or replace function place_call_on_confirm() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_src uuid; v_id uuid;
begin
  if new.to_status = 'confirmed' and new.from_status is distinct from 'confirmed' then
    select s.id into v_src from fulfilments f join sources s on s.id = f.source_id
     where f.order_id = new.order_id and s.buys_for_customer and f.status <> 'cancelled' limit 1;
    if v_src is not null then
      insert into place_calls(order_id, source_id) values (new.order_id, v_src) on conflict (order_id) do nothing returning id into v_id;
      if v_id is not null then insert into place_call_log(call_id, action, detail) values (v_id, 'created', jsonb_build_object('order_id', new.order_id)); end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists order_events_place_call on order_events;
create trigger order_events_place_call after insert on order_events for each row execute function place_call_on_confirm();

-- What staff read out, and what the customer is told: the order's lines with their options, the place, the estimate.
create or replace function food_call_json(p_call uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('call_id', c.id, 'order_id', o.id, 'short_code', o.short_code, 'status', c.status, 'order_status', o.status,
    'customer_id', o.customer_id, 'place_id', s.id, 'place', s.name, 'phone', pc.phone_e164,
    'ready_in_min', c.ready_in_min, 'ready_at', c.ready_at, 'pending', c.pending, 'created_at', c.created_at,
    'subtotal_usd', o.subtotal_usd, 'total_usd', o.total_usd, 'delivery_fee_usd', o.delivery_fee_usd, 'fx_rate_lbp', o.fx_rate_lbp,
    'notes', o.customer_notes,
    'village_en', v.name_en, 'village_ar', v.name_ar,
    'ride_min', coalesce(round(travel_minutes(s.village_id, o.village_id))::int, z.base_eta_minutes, 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'name', i.name_snapshot, 'name_ar', p.name_ar, 'qty', i.qty,
                                       'unit_price_usd', i.unit_price_usd, 'line_total_usd', round(i.qty * i.unit_price_usd, 2), 'options', i.options,
                                       'modifiers', i.modifiers, 'note', i.note, 'status', i.status) order by i.id)
                         from order_items i join products p on p.id = i.product_id where i.order_id = o.id), '[]'::jsonb))
    from place_calls c join orders o on o.id = c.order_id join sources s on s.id = c.source_id
    left join place_contacts pc on pc.source_id = s.id
    left join villages v on v.id = o.village_id left join zones z on z.id = v.zone_id
   where c.id = p_call $$;

-- The console's list: open calls first (to call, waiting on the customer), then today's accepted ones.
create or replace function food_calls_console() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(food_call_json(c.id) order by case c.status when 'to_call' then 0 when 'waiting_customer' then 1 else 2 end, c.created_at), '[]'::jsonb)
    from place_calls c join orders o on o.id = c.order_id
   where c.status in ('to_call', 'waiting_customer')
      or (c.status = 'accepted' and o.status in ('confirmed', 'preparing', 'ready', 'out_for_delivery', 'arrived'))
      or c.updated_at > now() - interval '12 hours' $$;

create or replace function food_call_for_update(p_call uuid, p_by uuid) returns place_calls language plpgsql set search_path = public, pg_temp as $$
declare c place_calls%rowtype;
begin
  if not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select * into c from place_calls where id = p_call for update;
  if not found then raise exception 'CALL_NOT_FOUND'; end if;
  if c.status in ('closed', 'cancelled') then raise exception 'CALL_FINISHED: this order was cancelled'; end if;
  if c.status = 'accepted' then raise exception 'CALL_ALREADY_ACCEPTED'; end if;
  if (select status from orders where id = c.order_id) <> 'confirmed' then raise exception 'ORDER_NOT_CONFIRMED'; end if;
  return c;
end $$;

-- Recomputes an order's totals from its items (after a line is dropped or re-priced). The total column follows (generated).
create or replace function food_order_recount(p_order uuid) returns void language plpgsql set search_path = public, pg_temp as $$
begin
  update fulfilments f set subtotal_usd = coalesce((select sum(round(i.qty * i.unit_price_usd, 2)) from order_items i where i.fulfilment_id = f.id and i.status = 'ok'), 0)
   where f.order_id = p_order;
  update orders set subtotal_usd = coalesce((select sum(f.subtotal_usd) from fulfilments f where f.order_id = p_order and f.status <> 'cancelled'), 0)
   where id = p_order;
end $$;

create or replace function food_call_accept(p_call uuid, p_by uuid, p_ready_in_min int) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare c place_calls%rowtype;
begin
  c := food_call_for_update(p_call, p_by);
  if c.status <> 'to_call' then raise exception 'CUSTOMER_ASKED: wait for the customer''s answer first'; end if;
  if p_ready_in_min is null or p_ready_in_min < 0 or p_ready_in_min > 180 then raise exception 'READY_IN: 0 to 180 minutes'; end if;
  update place_calls set status = 'accepted', ready_in_min = p_ready_in_min, accepted_at = now(), ready_at = now() + make_interval(mins => p_ready_in_min),
         pending = null, updated_at = now(), updated_by = p_by where id = p_call;
  update fulfilments set status = 'accepted' where order_id = c.order_id and source_id = c.source_id;
  perform transition_order(c.order_id, 'preparing', 'merchant', p_by, 'place_accepted_by_phone', jsonb_build_object('ready_in_min', p_ready_in_min));
  insert into place_call_log(call_id, action, by_party, detail) values (p_call, 'accepted', p_by, jsonb_build_object('ready_in_min', p_ready_in_min));
  return food_call_json(p_call) || jsonb_build_object('notice', 'accepted', 'eta_minutes', p_ready_in_min + (food_call_json(p_call)->>'ride_min')::int);
end $$;

create or replace function food_call_item_missing(p_call uuid, p_by uuid, p_item uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare c place_calls%rowtype; i record;
begin
  c := food_call_for_update(p_call, p_by);
  if c.status <> 'to_call' then raise exception 'CUSTOMER_ASKED: wait for the customer''s answer first'; end if;
  select it.id, it.name_snapshot, p.name_ar, it.qty, round(it.qty * it.unit_price_usd, 2) as line_total into i
    from order_items it join products p on p.id = it.product_id where it.id = p_item and it.order_id = c.order_id and it.status = 'ok';
  if not found then raise exception 'ITEM_NOT_IN_ORDER'; end if;
  update place_calls set status = 'waiting_customer', updated_at = now(), updated_by = p_by,
         pending = jsonb_build_object('kind', 'item_missing', 'item_id', i.id, 'name', i.name_snapshot, 'name_ar', i.name_ar, 'qty', i.qty,
                                      'line_total_usd', i.line_total, 'asked_at', now())
   where id = p_call;
  insert into place_call_log(call_id, action, by_party, detail) values (p_call, 'item_missing', p_by, jsonb_build_object('item_id', p_item));
  return food_call_json(p_call) || jsonb_build_object('notice', 'item_missing');
end $$;

create or replace function food_call_closed(p_call uuid, p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare c place_calls%rowtype;
begin
  c := food_call_for_update(p_call, p_by);
  update sources set closed_on = (now() at time zone coalesce(setting('hours')->>'tz', 'Asia/Beirut'))::date where id = c.source_id;
  update place_calls set status = 'closed', pending = null, updated_at = now(), updated_by = p_by where id = p_call;
  perform transition_order(c.order_id, 'cancelled', 'ops', p_by, 'place_closed');
  insert into place_call_log(call_id, action, by_party, detail) values (p_call, 'closed', p_by, '{}'::jsonb);
  return food_call_json(p_call) || jsonb_build_object('notice', 'closed');
end $$;

create or replace function food_call_price(p_call uuid, p_by uuid, p_item uuid, p_unit_usd numeric) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare c place_calls%rowtype; i order_items%rowtype; o orders%rowtype; v_new_total numeric;
begin
  c := food_call_for_update(p_call, p_by);
  if c.status <> 'to_call' then raise exception 'CUSTOMER_ASKED: wait for the customer''s answer first'; end if;
  if p_unit_usd is null or p_unit_usd <= 0 or p_unit_usd > 1000 then raise exception 'PRICE_INVALID: the new price of one, in dollars'; end if;
  select * into i from order_items where id = p_item and order_id = c.order_id and status = 'ok';
  if not found then raise exception 'ITEM_NOT_IN_ORDER'; end if;
  select * into o from orders where id = c.order_id;
  v_new_total := o.total_usd - round(i.qty * i.unit_price_usd, 2) + round(i.qty * round(p_unit_usd, 2), 2);
  if v_new_total <= o.total_usd then
    update order_items set unit_price_usd = round(p_unit_usd, 2) where id = p_item;
    perform food_order_recount(c.order_id);
    update place_calls set updated_at = now(), updated_by = p_by where id = p_call;
    insert into place_call_log(call_id, action, by_party, detail) values (p_call, 'price_lower', p_by,
      jsonb_build_object('item_id', p_item, 'was', i.unit_price_usd, 'now', round(p_unit_usd, 2)));
    return food_call_json(p_call) || jsonb_build_object('notice', 'price_lower', 'total_was', o.total_usd);
  end if;
  -- higher: nothing changes until the customer's own tap
  update place_calls set status = 'waiting_customer', updated_at = now(), updated_by = p_by,
         pending = jsonb_build_object('kind', 'price_up', 'item_id', i.id, 'name', i.name_snapshot, 'name_ar', (select name_ar from products where id = i.product_id),
                                      'qty', i.qty, 'was_unit_usd', i.unit_price_usd, 'now_unit_usd', round(p_unit_usd, 2),
                                      'total_was', o.total_usd, 'total_now', v_new_total, 'asked_at', now())
   where id = p_call;
  insert into place_call_log(call_id, action, by_party, detail) values (p_call, 'price_up', p_by,
    jsonb_build_object('item_id', p_item, 'was', i.unit_price_usd, 'now', round(p_unit_usd, 2)));
  return food_call_json(p_call) || jsonb_build_object('notice', 'price_up');
end $$;

-- The customer's own answers (their buttons). Only the order's own customer, only to the question asked.
create or replace function food_call_answer(p_call uuid, p_party uuid, p_answer text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare c place_calls%rowtype; o orders%rowtype; v_kind text;
begin
  select * into c from place_calls where id = p_call for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into o from orders where id = c.order_id;
  if o.customer_id is distinct from p_party then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  v_kind := c.pending->>'kind';
  if c.status <> 'waiting_customer' or v_kind is null or o.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'reason', 'not_waiting', 'short_code', o.short_code, 'status', o.status);
  end if;
  if p_answer not in ('drop', 'accept', 'cancel') or (p_answer = 'drop' and v_kind <> 'item_missing') or (p_answer = 'accept' and v_kind <> 'price_up') then
    raise exception 'ANSWER_INVALID';
  end if;
  if p_answer = 'cancel' then
    update place_calls set status = 'cancelled', updated_at = now() where id = p_call;
    perform transition_order(c.order_id, 'cancelled', 'customer', p_party, case v_kind when 'item_missing' then 'food_item_missing' else 'food_price_up' end);
    insert into place_call_log(call_id, action, by_party, detail) values (p_call, case v_kind when 'item_missing' then 'customer_cancel' else 'customer_decline_price' end, p_party, c.pending);
    return jsonb_build_object('ok', true, 'answer', 'cancelled', 'short_code', o.short_code);
  end if;
  if p_answer = 'drop' then
    update order_items set status = 'removed', missing_reason = null, missing_at = now() where id = (c.pending->>'item_id')::uuid and order_id = c.order_id;
    perform food_order_recount(c.order_id);
    insert into place_call_log(call_id, action, by_party, detail) values (p_call, 'customer_drop', p_party, c.pending);
    if not exists (select 1 from order_items where order_id = c.order_id and status = 'ok') then
      update place_calls set status = 'cancelled', pending = null, updated_at = now() where id = p_call;
      perform transition_order(c.order_id, 'cancelled', 'customer', p_party, 'food_item_missing');
      return jsonb_build_object('ok', true, 'answer', 'cancelled', 'short_code', o.short_code);
    end if;
  else
    update order_items set unit_price_usd = (c.pending->>'now_unit_usd')::numeric where id = (c.pending->>'item_id')::uuid and order_id = c.order_id;
    perform food_order_recount(c.order_id);
    insert into place_call_log(call_id, action, by_party, detail) values (p_call, 'customer_accept_price', p_party, c.pending);
  end if;
  -- staff call the place again with the change, then record it accepted
  update place_calls set status = 'to_call', pending = null, updated_at = now() where id = p_call;
  return jsonb_build_object('ok', true, 'answer', p_answer, 'short_code', o.short_code,
                            'total_usd', (select total_usd from orders where id = c.order_id), 'fx_rate_lbp', o.fx_rate_lbp);
end $$;

-- The waiting call of a customer's order, for the code that reads a typed answer.
create or replace function food_call_waiting(p_party uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('call_id', c.id, 'short_code', o.short_code, 'pending', c.pending)
    from place_calls c join orders o on o.id = c.order_id
   where o.customer_id = p_party and c.status = 'waiting_customer' order by c.updated_at desc limit 1 $$;

-- ---------- 2: dispatch waits for the place (0041's dispatch_order, renamed and called) ----------
alter function dispatch_order(uuid) rename to dispatch_order_0041;
create or replace function dispatch_order(p_order uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare c place_calls%rowtype;
begin
  select * into c from place_calls where order_id = p_order;
  if found and c.status in ('to_call', 'waiting_customer') then
    return jsonb_build_object('status', 'waiting_for_place', 'order_id', p_order, 'call_id', c.id,
                              'short_code', (select short_code from orders where id = p_order), 'place', (select name from sources where id = c.source_id),
                              'minutes_waiting', floor(extract(epoch from now() - c.created_at) / 60));
  end if;
  return dispatch_order_0041(p_order);
end $$;

-- ---------- 3: the rider's float ----------
insert into settings(key, value) values ('food', '{"service_fee_usd": 0}') on conflict (key) do nothing;
update settings set value = value || '{"float_max_usd": 100}'::jsonb where key = 'food' and not (value ? 'float_max_usd');
insert into editable_settings(key, field, kind, min_value, max_value, max_len, choices, two_person, two_person_when)
  values ('food', 'float_max_usd', 'number', 0, 300, null, null, false, null)
  on conflict (key, field) do nothing;

create table if not exists rider_float_events (
  id            uuid primary key default gen_random_uuid(),
  rider_id      uuid not null references parties(id),
  kind          text not null check (kind in ('give', 'return', 'paid_place')),
  amount_usd    numeric(10,2) not null check (amount_usd > 0),
  order_id      uuid references orders(id),
  source_id     uuid references sources(id),
  receipt_path  text,
  by_party      uuid not null references parties(id),
  txn_id        uuid not null,
  at            timestamptz not null default now(),
  check (kind <> 'paid_place' or (order_id is not null and source_id is not null and receipt_path is not null))
);
create unique index if not exists rider_float_paid_once on rider_float_events(order_id) where kind = 'paid_place';
create index if not exists rider_float_events_rider on rider_float_events(rider_id, at);
create or replace function rider_float_events_append_only() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'rider_float_events is append-only'; end $$;
drop trigger if exists rider_float_events_no_change on rider_float_events;
create trigger rider_float_events_no_change before update or delete on rider_float_events for each row execute function rider_float_events_append_only();

create or replace function rider_float_usd(p_rider uuid) returns numeric language sql stable set search_path = public, pg_temp as $$
  select coalesce(sum(e.usd_equiv), 0) from ledger_entries e join ledger_accounts a on a.id = e.account_id
   where a.code = 'driver_float:' || p_rider $$;

create or replace function rider_float_move(p_rider uuid, p_by uuid, p_kind text, p_amount numeric) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_txn uuid := gen_random_uuid(); v_amt numeric := round(coalesce(p_amount, 0), 2); v_max numeric := coalesce((setting('food')->>'float_max_usd')::numeric, 100);
        v_float uuid; v_hub uuid;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if not exists (select 1 from parties where id = p_rider and role = 'driver') then raise exception 'NOT_A_DRIVER'; end if;
  if v_amt <= 0 then raise exception 'AMOUNT_INVALID: an amount in dollars above 0'; end if;
  if p_kind = 'give' and rider_float_usd(p_rider) + v_amt > v_max then raise exception 'FLOAT_OVER_MAX: a rider holds at most % USD of float', v_max; end if;
  if p_kind = 'return' and v_amt > rider_float_usd(p_rider) + 0.005 then raise exception 'RETURN_OVER_FLOAT: the rider holds % USD of float', rider_float_usd(p_rider); end if;
  v_float := ensure_account('driver_float:' || p_rider, 'driver_float', p_rider);
  v_hub := ensure_account('hub_cash', 'hub_cash');
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
    (v_txn, v_float, case when p_kind = 'give' then v_amt else -v_amt end, 'USD', case when p_kind = 'give' then v_amt else -v_amt end,
     case when p_kind = 'give' then 'Float given to rider' else 'Float returned by rider' end),
    (v_txn, v_hub, case when p_kind = 'give' then -v_amt else v_amt end, 'USD', case when p_kind = 'give' then -v_amt else v_amt end,
     case when p_kind = 'give' then 'Float given to rider' else 'Float returned by rider' end);
  insert into rider_float_events(rider_id, kind, amount_usd, by_party, txn_id) values (p_rider, p_kind, v_amt, p_by, v_txn);
  return jsonb_build_object('ok', true, 'float_usd', rider_float_usd(p_rider));
end $$;
create or replace function rider_float_give(p_rider uuid, p_by uuid, p_amount_usd numeric) returns jsonb language sql set search_path = public, pg_temp as $$
  select rider_float_move(p_rider, p_by, 'give', p_amount_usd) $$;
create or replace function rider_float_return(p_rider uuid, p_by uuid, p_amount_usd numeric) returns jsonb language sql set search_path = public, pg_temp as $$
  select rider_float_move(p_rider, p_by, 'return', p_amount_usd) $$;

-- The rider paid the place at the counter: the amount on the receipt, and the receipt's photo (shrunk on the phone to 1600 px, JPEG 0.8,
-- in the private media bucket under food-receipts/<order>/). Once per order. Recorded by staff for the rider (FD2 decision 9).
create or replace function rider_paid_place(p_order uuid, p_rider uuid, p_by uuid, p_amount_usd numeric, p_receipt_path text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v_src uuid; v_txn uuid := gen_random_uuid(); v_amt numeric := round(coalesce(p_amount_usd, 0), 2); o orders%rowtype;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if not exists (select 1 from parties where id = p_rider and role = 'driver') then raise exception 'NOT_A_DRIVER'; end if;
  select * into o from orders where id = p_order;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  select s.id into v_src from fulfilments f join sources s on s.id = f.source_id where f.order_id = p_order and s.buys_for_customer limit 1;
  if v_src is null then raise exception 'NOT_A_FOOD_ORDER'; end if;
  if o.status in ('draft', 'awaiting_confirmation', 'cancelled') then raise exception 'ORDER_NOT_CONFIRMED'; end if;
  if v_amt <= 0 or v_amt > 1000 then raise exception 'AMOUNT_INVALID: the receipt''s amount in dollars'; end if;
  if p_receipt_path is null or p_receipt_path !~ ('^food-receipts/' || p_order::text || '/[A-Za-z0-9_\-./]+\.(jpg|jpeg|png|webp)$') or p_receipt_path ~ '\.\.' then
    raise exception 'RECEIPT_REQUIRED: the receipt''s photo, under food-receipts/<order>/';
  end if;
  if exists (select 1 from rider_float_events where order_id = p_order and kind = 'paid_place') then raise exception 'ALREADY_RECORDED'; end if;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
    (v_txn, ensure_account('merchant_payable:' || v_src, 'merchant_payable', null, v_src), v_amt, 'USD', v_amt, p_order, 'Paid to the place at the counter'),
    (v_txn, ensure_account('driver_float:' || p_rider, 'driver_float', p_rider), -v_amt, 'USD', -v_amt, p_order, 'Paid to the place at the counter');
  insert into rider_float_events(rider_id, kind, amount_usd, order_id, source_id, receipt_path, by_party, txn_id)
    values (p_rider, 'paid_place', v_amt, p_order, v_src, p_receipt_path, p_by, v_txn);
  return jsonb_build_object('ok', true, 'float_usd', rider_float_usd(p_rider), 'owed_usd', o.subtotal_usd, 'difference_usd', v_amt - o.subtotal_usd);
end $$;

-- ---------- 4: the end-of-shift balance ----------
create or replace function rider_shift_balance(p_rider uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare sh driver_shifts%rowtype; v_since timestamptz; v_until timestamptz; v_orders jsonb; v_given numeric; v_returned numeric; v_paid numeric;
        v_collected numeric; v_dropped numeric;
begin
  select * into sh from driver_shifts where driver_id = p_rider order by (ended_at is null) desc, started_at desc limit 1;
  v_since := coalesce(sh.started_at, now() - interval '24 hours'); v_until := coalesce(sh.ended_at, now());
  select coalesce(sum(amount_usd) filter (where kind = 'give'), 0), coalesce(sum(amount_usd) filter (where kind = 'return'), 0),
         coalesce(sum(amount_usd) filter (where kind = 'paid_place'), 0)
    into v_given, v_returned, v_paid
    from rider_float_events where rider_id = p_rider and at >= v_since and at <= v_until;
  -- every food order this rider delivered or holds in the shift, and every one they paid for: owed (the food's price), paid, difference
  select coalesce(jsonb_agg(jsonb_build_object('order_id', x.id, 'short_code', x.short_code, 'status', x.status, 'place', x.place,
           'owed_usd', x.owed, 'paid_usd', x.paid, 'receipt_path', x.receipt_path, 'difference_usd', coalesce(x.paid, 0) - x.owed) order by x.short_code), '[]'::jsonb)
    into v_orders
    from (select distinct on (o.id) o.id, o.short_code, o.status::text as status, s.name as place, f.subtotal_usd as owed, e.amount_usd as paid, e.receipt_path
            from orders o join fulfilments f on f.order_id = o.id join sources s on s.id = f.source_id and s.buys_for_customer
            left join rider_float_events e on e.order_id = o.id and e.kind = 'paid_place'
           where o.status <> 'cancelled'
             and ((e.rider_id = p_rider and e.at >= v_since and e.at <= v_until)
                  or exists (select 1 from delivery_stops ds join deliveries d on d.id = ds.delivery_id
                              where ds.order_id = o.id and d.driver_id = p_rider and d.status in ('accepted', 'in_progress', 'completed')
                                and coalesce(d.accepted_at, d.offered_at) >= v_since))
           order by o.id) x;
  select coalesce(sum(e.usd_equiv) filter (where e.memo = 'COD collected'), 0), coalesce(-sum(e.usd_equiv) filter (where e.memo like 'Cash drop%'), 0)
    into v_collected, v_dropped
    from ledger_entries e join ledger_accounts a on a.id = e.account_id
   where a.code = 'driver_cash:' || p_rider and e.created_at >= v_since and e.created_at <= v_until;
  return jsonb_build_object('rider_id', p_rider, 'name', (select display_name from parties where id = p_rider),
    'shift_id', sh.id, 'since', v_since, 'until', sh.ended_at, 'open', sh.id is not null and sh.ended_at is null,
    'float', jsonb_build_object('given_usd', v_given, 'paid_to_places_usd', v_paid, 'returned_usd', v_returned,
                                'held_usd', rider_float_usd(p_rider), 'expected_held_usd', v_given - v_paid - v_returned),
    'cash', jsonb_build_object('collected_usd', v_collected, 'dropped_usd', v_dropped, 'held_usd', driver_cash_usd(p_rider)),
    'orders', v_orders,
    'differences', (select count(*) from jsonb_array_elements(v_orders) y where (y->>'paid_usd') is null or (y->>'difference_usd')::numeric <> 0));
end $$;

create or replace function riders_float_console() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(rider_shift_balance(p.id) order by p.display_name), '[]'::jsonb)
    from parties p
   where p.role = 'driver' and not p.is_blocked
     and (exists (select 1 from driver_shifts sh where sh.driver_id = p.id and (sh.ended_at is null or sh.ended_at > now() - interval '24 hours'))
          or rider_float_usd(p.id) <> 0) $$;

-- The customer must hear each step of the call (they act on two of them): the four food notices are essential in the message budget (0143).
update settings set value = jsonb_set(value, '{essential}',
         coalesce(value->'essential', '[]'::jsonb) || (select coalesce(jsonb_agg(k), '[]'::jsonb) from unnest(array['food_accepted', 'food_item_missing', 'food_closed', 'food_price']) k
                                                        where not coalesce(value->'essential', '[]'::jsonb) ? k))
 where key = 'message_budget';

-- ---------- grants ----------
do $$ declare t text; r text;
begin
  foreach t in array array['place_calls', 'place_call_log', 'rider_float_events'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated', 'web_channel'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table %I to service_role', t); end if;
  end loop;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
