-- Alo King Chouf, session C3, build plan 2.8: scheduled orders (windows, capacity, cut-offs, changes, rescheduling).
-- The dispatch side (the rider in time for the window, fresh goods reserved when they are due) is migration 0041.
--
-- (a) Windows are data a person edits. delivery_window_plans say "every Monday to Saturday, 10:00-12:00, 8 orders"; the
--     calendar (delivery_calendar) marks Ramadan, Lent, holidays and closed days by date range, entered by a person: no date
--     is written in code. A plan with calendar_kind set applies only on days of that kind, and on those days it replaces the
--     ordinary plans. Concrete slots (delivery_slots) are generated from the plans for settings.scheduling.days_ahead days,
--     lazily, by the functions that read them; a person may close one slot or change its capacity (edit_delivery_slot).
--     A change to a plan or the calendar regenerates the future slots nobody holds, and raises an ops exception for a held
--     slot on a day that changed: those orders were promised a time and a person decides.
-- (b) Capacity is a count of orders. A slot is held only at confirmation (slot_holds), by the customer's tap, under a lock on
--     the slot row, so two taps cannot take the last place twice. open_delivery_windows() offers only slots with room whose
--     cut-off has not passed; the card never offers a full window. A full slot at the tap is refused, logged as demand
--     (log_demand 'no_slot', 1.12), and the order goes back to draft: a scheduled order never silently becomes "now".
-- (c) Each slot has an order-by time; fresh goods (the storage zones in settings.scheduling.bought_to_order) have their
--     own, earlier one. An order with such a line follows the earlier cut-off.
-- (d) Changes before the cut-off: a change is a new card (re-quoted by the ordering lane through create_order_from_quote,
--     linked with link_replacement_order) confirmed by a tap; the tap cancels the old order and confirms the new one in one
--     transaction, so nothing changes until the customer confirms and the slot is never lost in between. Cancelling before
--     the cut-off is the card's own cancel button. After the cut-off the customer is told to write to us (a person).
-- (e) Rescheduling: reschedule_order(), by the customer before the cut-off or by the ops lead at any time with a reason.
--     The old hold is released and the new one taken in one transaction, with the two slot rows locked in id order.
-- (g) Stock for shelf goods is reserved at confirmation as before; lines in the bought-to-order zones of a scheduled order
--     are not (reserve_stock below): they are bought for the order and reserved when the order comes due (0041).
-- Functions copied from earlier migrations, with the 2.8 lines added: reserve_stock (0002), handle_order_button (0003),
-- confirm_order_checked (0007). None of the three is redefined by any later migration.

insert into settings(key, value) values ('scheduling',
  '{"days_ahead": 7, "release_before_min": 60, "bought_to_order": ["fresh"], "offer_max": 6}') on conflict (key) do nothing;

create table delivery_calendar (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('ramadan', 'lent', 'holiday', 'other')),
  name       text not null,
  starts_on  date not null,
  ends_on    date not null check (ends_on >= starts_on),
  closed     boolean not null default false,       -- no deliveries at all on these days
  note       text,
  created_by uuid references parties(id),
  created_at timestamptz not null default now()
);

create table delivery_window_plans (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  weekdays           smallint[] not null default '{1,2,3,4,5,6,7}',   -- ISO: 1 Monday ... 7 Sunday
  starts             time not null,
  ends               time not null check (ends > starts),
  capacity           int not null check (capacity >= 0),            -- orders
  order_by_min       int not null default 120 check (order_by_min >= 0),   -- order-by: this many minutes before the start
  fresh_order_by_min int not null default 720,                       -- the earlier order-by for bought-to-order goods
  calendar_kind      text check (calendar_kind in ('ramadan', 'lent', 'holiday', 'other')),
  zone_id            uuid references zones(id),                      -- null: every zone
  active             boolean not null default true,
  created_by         uuid references parties(id),
  created_at         timestamptz not null default now(),
  check (fresh_order_by_min >= order_by_min),
  check (weekdays <@ '{1,2,3,4,5,6,7}'::smallint[])
);

create table delivery_slots (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid references delivery_window_plans(id) on delete set null,
  slot_date      date not null,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null check (ends_at > starts_at),
  order_by       timestamptz not null,
  fresh_order_by timestamptz not null,
  capacity       int not null check (capacity >= 0),
  zone_id        uuid references zones(id),
  closed         boolean not null default false,
  note           text,
  edited_by      uuid references parties(id),     -- set when a person changed this one slot; then it is never regenerated
  edited_at      timestamptz,
  created_at     timestamptz not null default now(),
  unique (plan_id, slot_date, starts_at)
);
create index delivery_slots_time on delivery_slots(starts_at);

create table slot_holds (
  order_id uuid primary key references orders(id),
  slot_id  uuid not null references delivery_slots(id),
  held_at  timestamptz not null default now()
);
create index slot_holds_slot on slot_holds(slot_id);

-- Every change of window on an order that was already confirmed, and who made it.
create table slot_changes (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id),
  from_slot  uuid references delivery_slots(id),
  to_slot    uuid references delivery_slots(id),
  actor      actor_kind not null,
  actor_id   uuid references parties(id),
  reason     text,
  created_at timestamptz not null default now()
);

alter table orders add column if not exists delivery_slot_id uuid references delivery_slots(id);
alter table orders add column if not exists released_at timestamptz;          -- 0041: a scheduled order handed to the pick and dispatch
alter table orders add column if not exists replaces_order_id uuid references orders(id);
create index if not exists orders_delivery_slot on orders(delivery_slot_id) where delivery_slot_id is not null;
comment on column orders.delivery_slot_id is '2.8: the delivery window the customer chose. Null: deliver now.';

-- ---------- helpers ----------
create or replace function scheduling_tz() returns text language sql stable as
$$ select coalesce(setting('hours')->>'tz', 'Asia/Beirut') $$;

create or replace function bought_to_order_zones() returns text[] language sql stable as
$$ select coalesce((select array_agg(z) from jsonb_array_elements_text(setting('scheduling')->'bought_to_order') z), '{}') $$;

-- An order with a line from a bought-to-order zone (fresh goods by default) follows the earlier cut-off.
create or replace function order_bought_to_order(p_order uuid) returns boolean language sql stable as $$
  select exists (select 1 from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
                   join products p on p.id = i.product_id
                  where i.order_id = p_order and i.status = 'ok' and s.kind = 'dark_store' and p.storage::text = any(bought_to_order_zones())) $$;

-- The plans that apply on one date: none on a closed day; on a day of a calendar kind that has its own plans, only those.
create or replace function window_plans_for(p_day date) returns setof delivery_window_plans language sql stable as $$
  with c as (select coalesce(bool_or(closed), false) as closed, coalesce(array_agg(distinct kind) filter (where not closed), '{}') as kinds
               from delivery_calendar where p_day between starts_on and ends_on),
       special as (select exists (select 1 from delivery_window_plans w, c where w.active and w.calendar_kind = any(c.kinds)) as yes)
  select w.* from delivery_window_plans w, c, special
   where not c.closed and w.active and extract(isodow from p_day)::smallint = any(w.weekdays)
     and case when special.yes then w.calendar_kind = any(c.kinds) else w.calendar_kind is null end $$;

-- Slots for today and the next days, from the plans. Idempotent; never touches a slot that exists.
create or replace function generate_delivery_slots(p_days int default null) returns int language plpgsql as $$
declare v_tz text := scheduling_tz(); v_days int := coalesce(p_days, (setting('scheduling')->>'days_ahead')::int, 7);
        v_today date := (now() at time zone scheduling_tz())::date; d date; p record; n int := 0; k int;
begin
  for i in 0 .. greatest(v_days, 1) - 1 loop
    d := v_today + i;
    for p in select * from window_plans_for(d) loop
      insert into delivery_slots(plan_id, slot_date, starts_at, ends_at, order_by, fresh_order_by, capacity, zone_id)
        values (p.id, d, (d + p.starts) at time zone v_tz, (d + p.ends) at time zone v_tz,
                ((d + p.starts) at time zone v_tz) - make_interval(mins => p.order_by_min),
                ((d + p.starts) at time zone v_tz) - make_interval(mins => p.fresh_order_by_min), p.capacity, p.zone_id)
        on conflict (plan_id, slot_date, starts_at) do nothing;
      get diagnostics k = row_count; n := n + k;
    end loop;
  end loop;
  return n;
end $$;

-- A plan or the calendar changed. Future slots nobody chose are regenerated. A slot an order points to keeps its times (that
-- time was promised): if its plan still applies that day at the same times it takes the plan's new capacity and cut-offs;
-- otherwise it is closed to new orders, and if orders hold it, ops gets an exception: a person decides what to tell them.
-- A slot a person edited (edited_by) is never touched here.
create or replace function delivery_slots_refresh() returns trigger language plpgsql as $$
declare v_today date := (now() at time zone scheduling_tz())::date; v_tz text := scheduling_tz(); s record; p record;
begin
  delete from delivery_slots ds where ds.slot_date >= v_today and ds.edited_by is null
     and not exists (select 1 from slot_holds h where h.slot_id = ds.id)
     and not exists (select 1 from orders o where o.delivery_slot_id = ds.id);
  for s in select * from delivery_slots ds where ds.slot_date >= v_today and ds.edited_by is null and not ds.closed loop
    select * into p from window_plans_for(s.slot_date) w
     where w.id = s.plan_id and (s.slot_date + w.starts) at time zone v_tz = s.starts_at and (s.slot_date + w.ends) at time zone v_tz = s.ends_at;
    if found then
      update delivery_slots set capacity = p.capacity, order_by = starts_at - make_interval(mins => p.order_by_min),
             fresh_order_by = starts_at - make_interval(mins => p.fresh_order_by_min), zone_id = p.zone_id where id = s.id;
    else
      update delivery_slots set closed = true, note = 'plan or calendar changed' where id = s.id;
      if exists (select 1 from slot_holds h where h.slot_id = s.id) then
        perform raise_ops_exception('scheduled_day_changed', s.id::text, jsonb_build_object('slot_date', s.slot_date, 'starts_at', s.starts_at,
          'orders', (select jsonb_agg(o.short_code order by o.short_code) from slot_holds h join orders o on o.id = h.order_id where h.slot_id = s.id)));
      end if;
    end if;
  end loop;
  perform generate_delivery_slots();
  return null;
end $$;
create trigger delivery_window_plans_refresh after insert or update or delete on delivery_window_plans
  for each statement execute function delivery_slots_refresh();
create trigger delivery_calendar_refresh after insert or update or delete on delivery_calendar
  for each statement execute function delivery_slots_refresh();

-- ok | unknown | closed | cutoff | fresh_cutoff | full. p_ignore_order: an order whose own hold does not count (a change).
create or replace function slot_state(p_slot uuid, p_fresh boolean default false, p_ignore_order uuid default null) returns text language sql stable as $$
  select case when s.id is null then 'unknown'
              when s.closed then 'closed'
              when now() >= s.order_by then 'cutoff'
              when p_fresh and now() >= s.fresh_order_by then 'fresh_cutoff'
              when (select count(*) from slot_holds h where h.slot_id = s.id and h.order_id is distinct from p_ignore_order) >= s.capacity then 'full'
              else 'ok' end
    from (select p_slot as id) x left join delivery_slots s on s.id = x.id $$;

-- What the card and the replies show. Times are the hub's local time; dow is ISO (1 Monday); day_offset 0 is today.
create or replace function window_json(p_slot uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('slot_id', s.id, 'date', s.slot_date, 'dow', extract(isodow from s.slot_date)::int,
           'day_offset', s.slot_date - (now() at time zone scheduling_tz())::date,
           'starts', to_char(s.starts_at at time zone scheduling_tz(), 'HH24:MI'), 'ends', to_char(s.ends_at at time zone scheduling_tz(), 'HH24:MI'),
           'starts_at', s.starts_at, 'ends_at', s.ends_at, 'order_by', s.order_by, 'fresh_order_by', s.fresh_order_by,
           'free', greatest(0, s.capacity - (select count(*) from slot_holds h where h.slot_id = s.id)))
    from delivery_slots s where s.id = p_slot $$;

-- The windows a card may offer: open, with room, before the cut-off that applies, serving the village's zone. Never a full one.
create or replace function open_delivery_windows(p_village uuid default null, p_fresh boolean default false, p_limit int default null)
returns jsonb language plpgsql as $$
declare v_zone uuid := (select zone_id from villages where id = p_village);
begin
  perform generate_delivery_slots();
  return coalesce((select jsonb_agg(window_json(x.id) order by x.starts_at) from (
    select s.id, s.starts_at from delivery_slots s
     where s.starts_at > now() and slot_state(s.id, p_fresh) = 'ok' and (s.zone_id is null or s.zone_id = v_zone)
     order by s.starts_at limit coalesce(p_limit, (setting('scheduling')->>'offer_max')::int, 6)) x), '[]'::jsonb);
end $$;

-- When the customer may still change or cancel a scheduled order by themselves.
create or replace function order_change_deadline(p_order uuid) returns timestamptz language sql stable as $$
  select case when order_bought_to_order(o.id) then s.fresh_order_by else s.order_by end
    from orders o join delivery_slots s on s.id = o.delivery_slot_id where o.id = p_order $$;

create or replace function order_changeable(p_order uuid) returns boolean language sql stable as $$
  select o.delivery_slot_id is not null and o.released_at is null and o.status in ('awaiting_payment', 'confirmed')
     and not exists (select 1 from pick_sessions ps where ps.order_id = o.id)
     and now() < order_change_deadline(o.id)
    from orders o where o.id = p_order $$;

-- ---------- choosing a window ----------
-- On a card not yet confirmed. p_slot null: deliver now. Refuses what the card must never offer; a full window is demand.
create or replace function request_delivery_window(p_order uuid, p_slot uuid, p_party uuid) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_state text; v_fresh boolean;
begin
  select * into o from orders where id = p_order for update;
  if not found or o.customer_id <> p_party then raise exception 'NOT_YOUR_ORDER'; end if;
  if o.status not in ('draft', 'awaiting_confirmation') then
    return jsonb_build_object('ok', false, 'reason', 'status', 'status', o.status, 'short_code', o.short_code);
  end if;
  if p_slot is null then
    update orders set delivery_slot_id = null where id = p_order;
    return jsonb_build_object('ok', true, 'window', null, 'short_code', o.short_code);
  end if;
  if o.is_pickup then return jsonb_build_object('ok', false, 'reason', 'pickup', 'short_code', o.short_code); end if;
  if exists (select 1 from fulfilments f join sources s on s.id = f.source_id where f.order_id = p_order and f.status <> 'cancelled' and s.kind <> 'dark_store') then
    return jsonb_build_object('ok', false, 'reason', 'restaurant', 'short_code', o.short_code);     -- Phase 8: the kitchen's own timing
  end if;
  perform generate_delivery_slots();
  v_fresh := order_bought_to_order(p_order);
  v_state := slot_state(p_slot, v_fresh);
  if v_state = 'ok' and exists (select 1 from delivery_slots s where s.id = p_slot and s.zone_id is not null
                                   and s.zone_id is distinct from (select zone_id from villages where id = o.village_id)) then
    v_state := 'zone';
  end if;
  if v_state <> 'ok' then
    if v_state = 'full' then
      perform log_demand('no_slot', 'window_request', p_party, 'slot ' || coalesce((select to_char(starts_at at time zone scheduling_tz(), 'YYYY-MM-DD HH24:MI') from delivery_slots where id = p_slot), '?'),
                         null, null, o.village_id, null, jsonb_build_object('slot_id', p_slot, 'order_id', p_order));
    end if;
    return jsonb_build_object('ok', false, 'reason', v_state, 'short_code', o.short_code, 'windows', open_delivery_windows(o.village_id, v_fresh));
  end if;
  update orders set delivery_slot_id = p_slot where id = p_order;
  return jsonb_build_object('ok', true, 'window', window_json(p_slot), 'short_code', o.short_code);
end $$;

-- ---------- the hold, at confirmation and by no other path ----------
create or replace function hold_slot(p_order uuid, p_slot uuid, p_check_cutoff boolean default true) returns void language plpgsql as $$
declare v_state text;
begin
  perform 1 from delivery_slots where id = p_slot for update;
  v_state := slot_state(p_slot, order_bought_to_order(p_order), p_order);
  if not p_check_cutoff and v_state in ('cutoff', 'fresh_cutoff') then v_state := 'ok'; end if;
  if v_state <> 'ok' then raise exception 'SLOT_%', upper(v_state); end if;
  insert into slot_holds(order_id, slot_id) values (p_order, p_slot)
    on conflict (order_id) do update set slot_id = excluded.slot_id, held_at = now();
end $$;

-- Whatever path confirms or cancels an order, the hold follows: taken when the customer's tap leaves awaiting_confirmation,
-- given back when the order is cancelled. A full slot here aborts the confirmation (confirm_order_checked checks first and
-- answers the customer; this is the second lock).
create or replace function orders_slot_hold() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'awaiting_confirmation' and new.status in ('confirmed', 'awaiting_payment') and new.delivery_slot_id is not null then
      perform hold_slot(new.id, new.delivery_slot_id);
    elsif new.status = 'cancelled' then
      delete from slot_holds where order_id = new.id;
    end if;
  end if;
  return null;
end $$;
create trigger orders_slot_hold after update of status on orders for each row execute function orders_slot_hold();

-- (g) Shelf goods are reserved at confirmation. The bought-to-order lines of a scheduled order are not: they are bought for
-- the order and reserved when it comes due (reserve_due_lines, 0041). Copied from 0002 with that one condition added.
create or replace function reserve_stock(p_order uuid) returns void language plpgsql as $$
declare r record; v_updated int; v_later boolean;
begin
  select delivery_slot_id is not null and released_at is null into v_later from orders where id = p_order;
  for r in
    select f.source_id, i.product_id, sum(i.qty) as qty
    from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id join products p on p.id = i.product_id
    where i.order_id = p_order and i.status = 'ok' and s.kind = 'dark_store'
      and not (coalesce(v_later, false) and p.storage::text = any(bought_to_order_zones()))
    group by f.source_id, i.product_id
  loop
    update stock_levels set reserved = reserved + r.qty
      where source_id = r.source_id and product_id = r.product_id and on_hand - reserved >= r.qty;
    get diagnostics v_updated = row_count;
    if v_updated = 0 then raise exception 'OUT_OF_STOCK %', r.product_id; end if;
    insert into stock_movements(source_id, product_id, qty_delta, reason, order_id)
      values (r.source_id, r.product_id, -r.qty, 'reserve', p_order);
  end loop;
end $$;

-- ---------- coming due (used by dispatch_order, 0041) ----------
-- A scheduled order is handed to the pick and the rider settings.scheduling.release_before_min before its window starts.
create or replace function order_release_at(p_order uuid) returns timestamptz language sql stable as $$
  select s.starts_at - make_interval(mins => coalesce((setting('scheduling')->>'release_before_min')::int, 60))
    from orders o join delivery_slots s on s.id = o.delivery_slot_id where o.id = p_order $$;

-- Reserves what an order still needs of its bought-to-order lines (net of what it already reserved). Returns the lines it
-- could not reserve: not bought yet, or held (2.11).
create or replace function reserve_due_lines(p_order uuid) returns jsonb language plpgsql as $$
declare r record; v_short jsonb := '[]'::jsonb; v_need numeric; v_updated int;
begin
  for r in select f.source_id, i.product_id, min(i.name_snapshot) as name, sum(i.qty) as qty,
                  coalesce((select -sum(m.qty_delta) from stock_movements m where m.order_id = p_order and m.source_id = f.source_id
                              and m.product_id = i.product_id and m.reason in ('reserve', 'release')), 0) as held
             from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id join products p on p.id = i.product_id
            where i.order_id = p_order and i.status = 'ok' and s.kind = 'dark_store' and p.storage::text = any(bought_to_order_zones())
            group by f.source_id, i.product_id loop
    v_need := r.qty - r.held;
    continue when v_need <= 0;
    begin
      update stock_levels set reserved = reserved + v_need
       where source_id = r.source_id and product_id = r.product_id and on_hand - reserved >= v_need;
      get diagnostics v_updated = row_count;
      if v_updated = 0 then
        v_short := v_short || jsonb_build_object('product_id', r.product_id, 'name', r.name, 'qty', v_need, 'reason', 'not_in_stock');
      else
        insert into stock_movements(source_id, product_id, qty_delta, reason, order_id) values (r.source_id, r.product_id, -v_need, 'reserve', p_order);
      end if;
    exception when others then
      if sqlerrm not like 'PRODUCT_ON_HOLD%' then raise; end if;
      v_short := v_short || jsonb_build_object('product_id', r.product_id, 'name', r.name, 'qty', v_need, 'reason', 'on_hold');
    end;
  end loop;
  return v_short;
end $$;

-- scheduled (not yet) | stock_short (ops told; retried every minute) | released | not_confirmed.
create or replace function release_scheduled_order(p_order uuid) returns text language plpgsql as $$
declare o orders%rowtype; v_short jsonb;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.delivery_slot_id is null or o.released_at is not null then return 'released'; end if;
  if o.status <> 'confirmed' then return 'not_confirmed'; end if;
  if now() < order_release_at(p_order) then return 'scheduled'; end if;
  v_short := reserve_due_lines(p_order);
  if jsonb_array_length(v_short) > 0 then
    perform raise_ops_exception('scheduled_stock_short', p_order::text,
      jsonb_build_object('short_code', o.short_code, 'lines', v_short, 'window', window_json(o.delivery_slot_id)));
    return 'stock_short';
  end if;
  update orders set released_at = now() where id = p_order;
  update ops_exceptions set status = 'resolved', resolved_at = now()
   where kind = 'scheduled_stock_short' and ref = p_order::text and status <> 'resolved';
  return 'released';
end $$;

-- ---------- cancelling and changing ----------
-- A scheduled order called off: by the customer before the cut-off, by the ops lead at any time before it leaves.
-- A paid order is owed back as credit, as when a rider cannot continue (0035).
create or replace function cancel_scheduled_order(p_order uuid, p_actor actor_kind, p_by uuid, p_reason text) returns jsonb language plpgsql as $$
declare o orders%rowtype; c record; v_amt numeric; v_credit numeric := 0;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if p_actor = 'customer' then
    if o.customer_id is distinct from p_by then raise exception 'NOT_YOUR_ORDER'; end if;
    if o.status = 'awaiting_confirmation' then null;      -- a card nobody confirmed holds nothing
    elsif not coalesce(order_changeable(p_order), false) then
      return jsonb_build_object('ok', false, 'status', 'too_late', 'short_code', o.short_code, 'changed', false, 'window', window_json(o.delivery_slot_id));
    end if;
  elsif p_actor = 'ops' then
    if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
    if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  else
    raise exception 'NOT_AUTHORISED';
  end if;
  if o.status in ('cancelled', 'closed') then return jsonb_build_object('ok', true, 'status', o.status, 'short_code', o.short_code, 'changed', false); end if;
  perform transition_order(p_order, 'cancelled', p_actor, p_by, p_reason);
  if exists (select 1 from payments where order_id = p_order and status = 'confirmed') then
    for c in select * from (values ('goods', 'revenue_goods'), ('delivery_fee', 'revenue_delivery'), ('small_order_fee', 'revenue_small_order')) x(charge, code) loop
      v_amt := order_revenue_usd(p_order, c.code);
      if v_amt > 0 then
        perform grant_customer_credit(p_order, v_amt, c.charge, 'order_cancelled', case when p_actor = 'ops' then p_by end,
                                      'scheduled order cancelled', null, 'schedcancel:' || p_order || ':' || c.charge);
        v_credit := v_credit + v_amt;
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'status', 'cancelled', 'short_code', o.short_code, 'changed', true, 'customer_id', o.customer_id, 'credit_usd', v_credit);
end $$;

-- (d) A change is a new card. The ordering lane creates it with create_order_from_quote (re-quoted at today's prices) and
-- links it here; the old order stands untouched until the customer confirms the new card. The new card keeps the window
-- unless the customer chose another (request_delivery_window on the new order).
create or replace function link_replacement_order(p_new uuid, p_old uuid, p_party uuid) returns jsonb language plpgsql as $$
declare n orders%rowtype; o orders%rowtype;
begin
  select * into o from orders where id = p_old for update;
  select * into n from orders where id = p_new for update;
  if o.id is null or n.id is null or o.customer_id <> p_party or n.customer_id <> p_party then raise exception 'NOT_YOUR_ORDER'; end if;
  if n.status not in ('draft', 'awaiting_confirmation') then return jsonb_build_object('ok', false, 'reason', 'status', 'status', n.status); end if;
  if not coalesce(order_changeable(p_old), false) then
    return jsonb_build_object('ok', false, 'reason', 'too_late', 'short_code', o.short_code, 'window', window_json(o.delivery_slot_id));
  end if;
  if exists (select 1 from payments where order_id = p_old and status = 'confirmed') then
    return jsonb_build_object('ok', false, 'reason', 'paid', 'short_code', o.short_code);   -- a person changes a paid order (HANDOFF)
  end if;
  update orders set replaces_order_id = p_old, delivery_slot_id = coalesce(n.delivery_slot_id, o.delivery_slot_id) where id = p_new;
  return jsonb_build_object('ok', true, 'replaces', o.short_code, 'window', window_json(coalesce(n.delivery_slot_id, o.delivery_slot_id)));
end $$;

-- ---------- the buttons ----------
-- Copied from 0003. Cancel on a scheduled order goes through cancel_scheduled_order (the cut-off, the credit); edit on a
-- confirmed scheduled order before the cut-off opens a change. Every answer carries the window.
create or replace function handle_order_button(p_order uuid, p_action text, p_party uuid, p_wamid text default null)
returns jsonb language plpgsql as $$
declare o orders%rowtype; v_to order_status; r jsonb;
begin
  select * into o from orders where id = p_order;
  if not found or o.customer_id <> p_party then raise exception 'NOT_YOUR_ORDER'; end if;
  if p_action = 'confirm' then
    if o.status <> 'awaiting_confirmation' then
      return jsonb_build_object('status', o.status, 'short_code', o.short_code, 'changed', false, 'window', window_json(o.delivery_slot_id));
    end if;
    -- The card states that confirming means agreeing to order updates on this chat. The tap is the opt-in.
    insert into consent_events(party_id, line, kind, action, source, wording, evidence_message_id)
      values (p_party, 'customer', 'transactional', 'opt_in', 'order_card_confirm',
              'بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة', p_wamid);
    v_to := case when o.payment_method = 'cod' then 'confirmed' else 'awaiting_payment' end;
    perform transition_order(p_order, v_to, 'customer', p_party, 'card_confirm', jsonb_build_object('wamid', p_wamid));
  elsif p_action = 'edit' then
    if o.status = 'awaiting_confirmation' then perform transition_order(p_order, 'draft', 'customer', p_party, 'card_edit');
    elsif o.delivery_slot_id is not null and o.status in ('confirmed', 'awaiting_payment') then
      return jsonb_build_object('status', case when coalesce(order_changeable(p_order), false) then 'change_open' else 'too_late' end,
                                'short_code', o.short_code, 'changed', false, 'window', window_json(o.delivery_slot_id));
    end if;
  elsif p_action = 'cancel' then
    if o.delivery_slot_id is not null and o.status in ('confirmed', 'awaiting_payment') then
      r := cancel_scheduled_order(p_order, 'customer', p_party, 'card_cancel');
      return r - 'customer_id';
    end if;
    perform transition_order(p_order, 'cancelled', 'customer', p_party, 'card_cancel');
  else
    raise exception 'UNKNOWN_ACTION %', p_action;
  end if;
  select * into o from orders where id = p_order;
  return jsonb_build_object('status', o.status, 'short_code', o.short_code, 'changed', true, 'payment_method', o.payment_method,
                            'total_usd', o.total_usd, 'fx_rate_lbp', o.fx_rate_lbp, 'window', window_json(o.delivery_slot_id));
end $$;

-- Copied from 0007, with the window checked before the tap and a change applied in the same transaction.
-- slot_full / slot_closed: the order goes back to draft and the customer is told (order-card.ts); never "now" instead.
create or replace function confirm_order_checked(p_order uuid, p_party uuid, p_wamid text) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_issues jsonb; v_state text; v_old orders%rowtype; r jsonb;
begin
  select * into o from orders where id = p_order for update;
  if not found or o.customer_id <> p_party then raise exception 'NOT_YOUR_ORDER'; end if;
  if o.status = 'awaiting_confirmation' then
    v_issues := order_quote_issues(p_order);
    if jsonb_array_length(v_issues) > 0 then
      perform transition_order(p_order, 'draft', 'customer', p_party, 'stale_quote', jsonb_build_object('issues', v_issues));
      return jsonb_build_object('status', 'stale_quote', 'changed', false, 'issues', v_issues, 'short_code', o.short_code);
    end if;
    if not o.is_pickup and not exists (select 1 from customer_places cp where cp.id = o.place_id
          and (cp.lat is not null or cp.verified_by_driver or length(coalesce(cp.directions, '') || coalesce(cp.building, '')) >= 8)) then
      return jsonb_build_object('status', 'needs_location', 'changed', false, 'short_code', o.short_code);
    end if;
    if o.replaces_order_id is not null then
      select * into v_old from orders where id = o.replaces_order_id for update;
      if not coalesce(order_changeable(v_old.id), false) or exists (select 1 from payments where order_id = v_old.id and status = 'confirmed') then
        perform transition_order(p_order, 'draft', 'customer', p_party, 'change_too_late');
        return jsonb_build_object('status', 'change_too_late', 'changed', false, 'short_code', v_old.short_code, 'window', window_json(v_old.delivery_slot_id));
      end if;
    end if;
    if o.delivery_slot_id is not null then
      perform 1 from delivery_slots where id = o.delivery_slot_id for update;
      v_state := slot_state(o.delivery_slot_id, order_bought_to_order(p_order), o.replaces_order_id);
      if v_state <> 'ok' then
        if v_state = 'full' then
          perform log_demand('no_slot', 'confirm', p_party, 'slot ' || (select to_char(starts_at at time zone scheduling_tz(), 'YYYY-MM-DD HH24:MI') from delivery_slots where id = o.delivery_slot_id),
                             null, null, o.village_id, null, jsonb_build_object('slot_id', o.delivery_slot_id, 'order_id', p_order));
        end if;
        perform transition_order(p_order, 'draft', 'customer', p_party, 'slot_' || v_state);
        return jsonb_build_object('status', case when v_state = 'full' then 'slot_full' else 'slot_closed' end, 'changed', false,
                                  'short_code', o.short_code, 'window', window_json(o.delivery_slot_id),
                                  'windows', open_delivery_windows(o.village_id, order_bought_to_order(p_order)));
      end if;
    end if;
    if o.replaces_order_id is not null then
      -- The old order goes in the same transaction as the new one is confirmed: its slot, its stock, its card.
      perform transition_order(v_old.id, 'cancelled', 'customer', p_party, 'replaced_by:' || o.short_code);
      if v_old.delivery_slot_id is distinct from o.delivery_slot_id then
        insert into slot_changes(order_id, from_slot, to_slot, actor, actor_id, reason) values (p_order, v_old.delivery_slot_id, o.delivery_slot_id, 'customer', p_party, 'change');
      end if;
    end if;
  end if;
  r := handle_order_button(p_order, 'confirm', p_party, p_wamid);
  if o.replaces_order_id is not null and o.status = 'awaiting_confirmation' then r := r || jsonb_build_object('replaces', v_old.short_code); end if;
  return r;
end $$;

-- (e) Rescheduling. The customer before the cut-off; the ops lead at any time before picking starts, with a reason, past
-- cut-offs but never past capacity or into a closed slot (raise the slot's capacity with edit_delivery_slot first).
-- The old hold and the new one move in one transaction. A released order (0041) waits again if the new window is later.
create or replace function reschedule_order(p_order uuid, p_slot uuid, p_actor actor_kind, p_by uuid, p_reason text default null) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_state text; v_fresh boolean;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if p_actor = 'customer' then
    if o.customer_id is distinct from p_by then raise exception 'NOT_YOUR_ORDER'; end if;
    if o.delivery_slot_id is null or (o.status <> 'awaiting_confirmation' and not coalesce(order_changeable(p_order), false)) then
      return jsonb_build_object('ok', false, 'reason', 'too_late', 'short_code', o.short_code, 'window', window_json(o.delivery_slot_id));
    end if;
  elsif p_actor = 'ops' then
    if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
    if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  else
    raise exception 'NOT_AUTHORISED';
  end if;
  if o.status not in ('awaiting_confirmation', 'awaiting_payment', 'confirmed') or o.is_pickup
     or exists (select 1 from pick_sessions ps where ps.order_id = p_order)
     or exists (select 1 from delivery_stops s join deliveries d on d.id = s.delivery_id where s.order_id = p_order and d.status in ('offered', 'accepted', 'in_progress')) then
    return jsonb_build_object('ok', false, 'reason', 'in_progress', 'status', o.status, 'short_code', o.short_code);
  end if;
  if p_slot is not distinct from o.delivery_slot_id then
    return jsonb_build_object('ok', true, 'changed', false, 'short_code', o.short_code, 'window', window_json(p_slot));
  end if;
  perform generate_delivery_slots();
  perform 1 from delivery_slots where id in (o.delivery_slot_id, p_slot) order by id for update;
  v_fresh := order_bought_to_order(p_order);
  v_state := case when p_slot is null then 'ok' else slot_state(p_slot, v_fresh, p_order) end;
  if p_actor = 'ops' and v_state in ('cutoff', 'fresh_cutoff') then v_state := 'ok'; end if;
  if v_state = 'ok' and exists (select 1 from delivery_slots s where s.id = p_slot and s.zone_id is not null
                                   and s.zone_id is distinct from (select zone_id from villages where id = o.village_id)) then v_state := 'zone'; end if;
  if v_state <> 'ok' then
    if v_state = 'full' and p_actor = 'customer' then
      perform log_demand('no_slot', 'reschedule', p_by, 'slot ' || coalesce((select to_char(starts_at at time zone scheduling_tz(), 'YYYY-MM-DD HH24:MI') from delivery_slots where id = p_slot), '?'),
                         null, null, o.village_id, null, jsonb_build_object('slot_id', p_slot, 'order_id', p_order));
    end if;
    return jsonb_build_object('ok', false, 'reason', v_state, 'short_code', o.short_code, 'windows', open_delivery_windows(o.village_id, v_fresh));
  end if;
  update orders set delivery_slot_id = p_slot, released_at = null where id = p_order;
  if p_slot is null and o.status <> 'awaiting_confirmation' then
    -- Delivered now instead: what was left to buy for the window is needed now.
    if jsonb_array_length(reserve_due_lines(p_order)) > 0 then raise exception 'OUT_OF_STOCK (bought-to-order lines are not in stock yet)'; end if;
    update orders set released_at = now() where id = p_order;
  end if;
  if o.status <> 'awaiting_confirmation' then
    if p_slot is null then delete from slot_holds where order_id = p_order;
    else perform hold_slot(p_order, p_slot, p_actor <> 'ops'); end if;
    insert into slot_changes(order_id, from_slot, to_slot, actor, actor_id, reason) values (p_order, o.delivery_slot_id, p_slot, p_actor, p_by, nullif(btrim(coalesce(p_reason, '')), ''));
  end if;
  return jsonb_build_object('ok', true, 'changed', true, 'short_code', o.short_code, 'customer_id', o.customer_id,
                            'from', window_json(o.delivery_slot_id), 'window', window_json(p_slot));
end $$;

-- ---------- what a person edits (the console, ops lead or admin) ----------
create or replace function edit_delivery_slot(p_slot uuid, p_by uuid, p_capacity int default null, p_closed boolean default null, p_note text default null)
returns jsonb language plpgsql as $$
declare s delivery_slots%rowtype;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  update delivery_slots set capacity = coalesce(p_capacity, capacity), closed = coalesce(p_closed, closed), note = coalesce(nullif(btrim(p_note), ''), note),
         edited_by = p_by, edited_at = now() where id = p_slot returning * into s;
  if not found then raise exception 'UNKNOWN_SLOT %', p_slot; end if;
  -- Closing or shrinking a slot never cancels an order already promised: those stay held and are listed for ops.
  return window_json(s.id) || jsonb_build_object('capacity', s.capacity, 'closed', s.closed, 'held', (select count(*) from slot_holds where slot_id = s.id));
end $$;

-- The schedule for the next days, for the console: every slot with what is held on it.
create or replace function delivery_schedule(p_days int default null) returns jsonb language plpgsql as $$
begin
  perform generate_delivery_slots(p_days);
  return coalesce((select jsonb_agg(window_json(s.id) || jsonb_build_object('capacity', s.capacity, 'closed', s.closed, 'note', s.note,
            'held', (select count(*) from slot_holds h where h.slot_id = s.id),
            'orders', (select coalesce(jsonb_agg(o.short_code order by o.short_code), '[]'::jsonb) from slot_holds h join orders o on o.id = h.order_id where h.slot_id = s.id))
          order by s.starts_at)
     from delivery_slots s where s.ends_at > now() and s.slot_date < (now() at time zone scheduling_tz())::date + coalesce(p_days, (setting('scheduling')->>'days_ahead')::int, 7)), '[]'::jsonb);
end $$;

do $$ declare r text; t text;
begin
  foreach t in array array['delivery_calendar', 'delivery_window_plans', 'delivery_slots', 'slot_holds', 'slot_changes'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
