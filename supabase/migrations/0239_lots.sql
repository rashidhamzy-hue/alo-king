-- Alo King Chouf, session WH1a: lots and first-to-expire (docs/strategy/02-journeys.md, section 4, "Expiry").
-- Before this, an expiry date was kept per receipt line, but nothing knew how much of each receipt was still on the shelf, so the pick
-- list could not name the lot to take and "use soon" listed receipts whose goods may have gone. Now:
--   * A lot is a receipt line (0024): its lot code, its expiry date, how many came and how many are left (qty_left). Every receipt line
--     makes its lot (a trigger), whatever receives it (receive_purchase_order, 0237, or receive_goods itself).
--   * Stock that was on the shelf before lots began, or found at a count, has no lot: it is on_hand less the lots' total. Nobody knows its
--     date, so the pick list tells the picker to read the date on the pack (rule: unknown is never safe).
--   * Every stock movement that takes goods off the shelf takes them from the lots too, in the same statement (a trigger on
--     stock_movements: no path that moves stock can skip it), recorded in stock_lot_moves:
--       pick (an order's goods leave the shelf): stock with no lot first (it is the oldest), then the lots by expiry date, earliest first,
--         never an expired lot while a good one is left. If only an expired lot can cover it (the books must follow the shelf), it is
--         taken and an alert is raised (expired_lot_picked): a person checks the bag.
--       a failed delivery that comes back (return): back into the lots the order was picked from; what is not restocked is written off
--         from those same lots (0034's waste row).
--       a write-off of a named lot (write_off_lot): that lot.
--       any other loss (a count that finds less, damaged, a supplier return, missing at pick): an expired lot first, then stock with no
--         lot, then the lots by expiry.
--     A lot never goes below zero; goods added by a count or "found" have no lot.
--   * An expired lot cannot be picked: the pick list never names one, says when only an expired lot is left, and pick_mark_line refuses
--     "Picked" for that line (LOT_EXPIRED). The way out is the old one: mark it missing, and write the lot off from the use-soon list.
--   * The use-soon list (expiring_stock) reads the lots still on the shelf, with how many are left in each and whether it has expired.
-- "Expired" means the expiry date is before today in the hub's time zone (a pack is good on its own date).
-- The pick list also names each line's bin (0238) and walks the bins inside UX2a's zone order (0227).

create table stock_lots (
  id              uuid primary key default gen_random_uuid(),
  source_id       uuid not null references sources(id),
  product_id      uuid not null references products(id),
  receipt_line_id uuid unique references goods_receipt_lines(id),
  lot             text,
  expiry_date     date,
  received_at     timestamptz not null default now(),
  qty_received    numeric(10,3) not null,
  qty_left        numeric(10,3) not null check (qty_left >= 0)
);
create index stock_lots_open on stock_lots(source_id, product_id) where qty_left > 0;
create index stock_lots_expiry on stock_lots(expiry_date) where qty_left > 0 and expiry_date is not null;

create table stock_lot_moves (
  id          uuid primary key default gen_random_uuid(),
  lot_id      uuid not null references stock_lots(id),
  movement_id uuid references stock_movements(id),
  order_id    uuid,
  kind        text not null check (kind in ('pick', 'return', 'return_waste', 'out', 'write_off')),
  qty         numeric(10,3) not null,                       -- signed: negative leaves the lot
  created_at  timestamptz not null default now()
);
create index stock_lot_moves_order on stock_lot_moves(order_id) where order_id is not null;
create index stock_lot_moves_lot on stock_lot_moves(lot_id);

create or replace function hub_today() returns date language sql stable as $$ select (now() at time zone scheduling_tz())::date $$;

-- ---------- a receipt line is a lot ----------
create or replace function stock_lot_from_receipt() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  insert into stock_lots(source_id, product_id, receipt_line_id, lot, expiry_date, received_at, qty_received, qty_left)
    select g.source_id, new.product_id, new.id, new.lot, new.expiry_date, g.created_at, new.qty, new.qty from goods_receipts g where g.id = new.receipt_id;
  return new;
end $$;
create trigger goods_receipt_lines_lot after insert on goods_receipt_lines for each row execute function stock_lot_from_receipt();

-- Lots for the receipts already on the books: each product's units on the shelf are given to its newest receipt lines first (the oldest
-- were sold first); what is left over has no lot.
do $$ declare k record; r record; v_left numeric; v_q numeric;
begin
  for k in select distinct g.source_id, l.product_id from goods_receipt_lines l join goods_receipts g on g.id = l.receipt_id loop
    select coalesce(on_hand, 0) into v_left from stock_levels where source_id = k.source_id and product_id = k.product_id;
    v_left := coalesce(v_left, 0);
    for r in select l.*, g.source_id, g.created_at from goods_receipt_lines l join goods_receipts g on g.id = l.receipt_id
              where g.source_id = k.source_id and l.product_id = k.product_id order by g.created_at desc, l.id loop
      v_q := least(r.qty, greatest(v_left, 0));
      v_left := v_left - v_q;
      insert into stock_lots(source_id, product_id, receipt_line_id, lot, expiry_date, received_at, qty_received, qty_left)
        values (r.source_id, r.product_id, r.id, r.lot, r.expiry_date, r.created_at, r.qty, v_q) on conflict (receipt_line_id) do nothing;
    end loop;
  end loop;
end $$;

-- ---------- how much of a product has no lot ----------
-- p_extra: units that have already left on_hand in this statement but not yet the lots (the movement being booked).
create or replace function stock_no_lot(p_source uuid, p_product uuid, p_extra numeric default 0) returns numeric language sql stable set search_path = public, pg_temp as $$
  select greatest(0, coalesce((select on_hand from stock_levels where source_id = p_source and product_id = p_product), 0) + coalesce(p_extra, 0)
                     - coalesce((select sum(qty_left) from stock_lots where source_id = p_source and product_id = p_product), 0)) $$;

-- ---------- what to take for a quantity, without taking it (the pick list) ----------
-- {take: [{lot, expiry_date, qty, no_lot}], good: units of stock that may be picked, expired_qty: units in expired lots}
create or replace function lot_plan(p_source uuid, p_product uuid, p_qty numeric) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare v_rem numeric := p_qty; v_take jsonb := '[]'::jsonb; v_none numeric; l record; v_q numeric; v_good numeric; v_today date := hub_today();
begin
  v_none := stock_no_lot(p_source, p_product);
  if v_none > 0 and v_rem > 0 then
    v_q := least(v_none, v_rem);
    v_take := v_take || jsonb_build_object('lot', null, 'expiry_date', null, 'qty', v_q, 'no_lot', true);
    v_rem := v_rem - v_q;
  end if;
  for l in select * from stock_lots where source_id = p_source and product_id = p_product and qty_left > 0
              and (expiry_date is null or expiry_date >= v_today) order by expiry_date nulls last, received_at, id loop
    exit when v_rem <= 0;
    v_q := least(l.qty_left, v_rem);
    v_take := v_take || jsonb_build_object('lot', l.lot, 'expiry_date', l.expiry_date, 'qty', v_q, 'no_lot', false);
    v_rem := v_rem - v_q;
  end loop;
  select v_none + coalesce(sum(qty_left), 0) into v_good from stock_lots
   where source_id = p_source and product_id = p_product and qty_left > 0 and (expiry_date is null or expiry_date >= v_today);
  return jsonb_build_object('take', v_take, 'good', v_good,
    'expired_qty', coalesce((select sum(qty_left) from stock_lots where source_id = p_source and product_id = p_product and qty_left > 0 and expiry_date < v_today), 0));
end $$;

-- ---------- booking a movement against the lots ----------
create or replace function lot_take(p_lot uuid, p_want numeric, p_movement uuid, p_order uuid, p_kind text) returns numeric
language plpgsql set search_path = public, pg_temp as $$
declare v_left numeric; v_q numeric;
begin
  if p_want <= 0 then return 0; end if;
  select qty_left into v_left from stock_lots where id = p_lot for update;
  v_q := least(coalesce(v_left, 0), p_want);
  if v_q <= 0 then return 0; end if;
  update stock_lots set qty_left = qty_left - v_q where id = p_lot;
  insert into stock_lot_moves(lot_id, movement_id, order_id, kind, qty) values (p_lot, p_movement, p_order, p_kind, -v_q);
  return v_q;
end $$;

create or replace function stock_movement_lots() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_units numeric; v_rem numeric; v_none numeric; l record; v_hint uuid; v_today date := hub_today(); v_expired numeric := 0; v_q numeric;
        v_mode text;
begin
  if new.reason::text = 'pick' then
    v_mode := 'pick'; v_units := new.qty_delta;                                     -- a pick row carries the units leaving as a positive number
  elsif new.reason::text = 'return' then
    v_mode := 'return'; v_units := new.qty_delta;
  elsif new.reason::text = 'waste' and new.order_id is not null and new.adjust_reason is null then
    v_mode := 'return_waste'; v_units := -new.qty_delta;                           -- 0034: what came back and is not restocked
  elsif new.reason::text in ('waste', 'adjust', 'supplier_return') and new.qty_delta < 0 then
    v_mode := 'out'; v_units := -new.qty_delta;
  else
    return new;                                                                     -- receive (0237's lot), reserve, release, goods found
  end if;
  if v_units is null or v_units <= 0 then return new; end if;
  v_rem := v_units;

  if v_mode = 'return' then
    -- back into the lots this order was picked from, net of what came back before
    for l in select m.lot_id, -sum(m.qty) as net from stock_lot_moves m join stock_lots s on s.id = m.lot_id
              where m.order_id = new.order_id and m.kind in ('pick', 'return') and s.product_id = new.product_id and s.source_id = new.source_id
              group by m.lot_id having -sum(m.qty) > 0 loop
      exit when v_rem <= 0;
      v_q := least(l.net, v_rem);
      update stock_lots set qty_left = qty_left + v_q where id = l.lot_id;
      insert into stock_lot_moves(lot_id, movement_id, order_id, kind, qty) values (l.lot_id, new.id, new.order_id, 'return', v_q);
      v_rem := v_rem - v_q;
    end loop;
    return new;                                                                     -- the rest had no lot when it left: it has none now
  end if;

  if v_mode = 'return_waste' then
    for l in select m.lot_id, sum(m.qty) filter (where m.kind = 'return') + coalesce(sum(m.qty) filter (where m.kind = 'return_waste'), 0) as back
               from stock_lot_moves m join stock_lots s on s.id = m.lot_id
              where m.order_id = new.order_id and m.kind in ('return', 'return_waste') and s.product_id = new.product_id and s.source_id = new.source_id
              group by m.lot_id loop
      exit when v_rem <= 0;
      if coalesce(l.back, 0) > 0 then v_rem := v_rem - lot_take(l.lot_id, least(l.back, v_rem), new.id, new.order_id, 'return_waste'); end if;
    end loop;
    return new;                                                                     -- never more than came back into a lot
  end if;

  -- pick and out: on_hand has already been lowered by these units in the same statement
  v_none := stock_no_lot(new.source_id, new.product_id, v_units);

  if v_mode = 'pick' then
    v_rem := v_rem - least(v_none, v_rem);
    for l in select id from stock_lots where source_id = new.source_id and product_id = new.product_id and qty_left > 0
                and (expiry_date is null or expiry_date >= v_today) order by expiry_date nulls last, received_at, id loop
      exit when v_rem <= 0;
      v_rem := v_rem - lot_take(l.id, v_rem, new.id, new.order_id, 'pick');
    end loop;
    for l in select id from stock_lots where source_id = new.source_id and product_id = new.product_id and qty_left > 0
                and expiry_date < v_today order by expiry_date, received_at, id loop
      exit when v_rem <= 0;
      v_q := lot_take(l.id, v_rem, new.id, new.order_id, 'pick');
      v_rem := v_rem - v_q; v_expired := v_expired + v_q;
    end loop;
    if v_expired > 0 then
      perform raise_ops_exception('expired_lot_picked', coalesce(new.order_id::text, new.id::text) || ':' || new.product_id,
        jsonb_build_object('order_id', new.order_id, 'short_code', (select short_code from orders where id = new.order_id),
                           'product_id', new.product_id, 'product', (select name_en from products where id = new.product_id), 'units', v_expired));
    end if;
    return new;
  end if;

  -- out: a named lot first (write_off_lot), then expired lots, then stock with no lot, then the lots by expiry
  v_hint := nullif(current_setting('ak.lot_hint', true), '')::uuid;
  if v_hint is not null then
    perform set_config('ak.lot_hint', '', true);
    if exists (select 1 from stock_lots where id = v_hint and source_id = new.source_id and product_id = new.product_id) then
      v_rem := v_rem - lot_take(v_hint, v_rem, new.id, new.order_id, 'write_off');
    end if;
  end if;
  for l in select id from stock_lots where source_id = new.source_id and product_id = new.product_id and qty_left > 0
              and expiry_date < v_today order by expiry_date, received_at, id loop
    exit when v_rem <= 0;
    v_rem := v_rem - lot_take(l.id, v_rem, new.id, new.order_id, 'out');
  end loop;
  -- stock with no lot, as it was before this movement (v_none, above)
  v_rem := v_rem - least(v_none, v_rem);
  for l in select id from stock_lots where source_id = new.source_id and product_id = new.product_id and qty_left > 0
              and (expiry_date is null or expiry_date >= v_today) order by expiry_date nulls last, received_at, id loop
    exit when v_rem <= 0;
    v_rem := v_rem - lot_take(l.id, v_rem, new.id, new.order_id, 'out');
  end loop;
  return new;
end $$;
create trigger stock_movements_lots after insert on stock_movements for each row execute function stock_movement_lots();

-- ---------- writing a lot off (the use-soon list's button) ----------
-- Through adjust_stock (0023): its reasons, the picker's limit, "never below what is reserved", the key, the ledger (stock_loss).
create or replace function write_off_lot(p_lot uuid, p_qty numeric, p_reason text, p_by uuid, p_note text default null, p_key text default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare l stock_lots%rowtype; r jsonb;
begin
  if p_key is not null and exists (select 1 from stock_movements where request_key = p_key) then
    return adjust_stock(null, null, 0, 'count', p_by, null, p_key);                -- answers as the first (duplicate)
  end if;
  select * into l from stock_lots where id = p_lot;
  if not found then raise exception 'UNKNOWN_LOT'; end if;
  if p_reason is null or p_reason not in ('expired', 'damaged', 'spoiled', 'recall') then raise exception 'UNKNOWN_REASON %', p_reason; end if;
  if p_qty is null or p_qty <= 0 or p_qty > l.qty_left then raise exception 'BAD_QTY % of %', p_qty, l.qty_left; end if;
  perform set_config('ak.lot_hint', p_lot::text, true);
  r := adjust_stock(l.source_id, l.product_id, -p_qty, p_reason, p_by,
                    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Lot ' || coalesce(l.lot, 'without a code') || coalesce(', use by ' || l.expiry_date, '')), p_key);
  perform set_config('ak.lot_hint', '', true);
  return r || jsonb_build_object('lot_id', p_lot, 'qty_left', (select qty_left from stock_lots where id = p_lot));
end $$;

-- ---------- reads ----------
-- The use-soon list: lots still on the shelf whose date falls within p_days (an expired lot included, flagged). Same keys as 0024's
-- version, plus the lot's own figures.
create or replace function expiring_stock(p_source uuid, p_days int default 7) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('lot_id', l.id, 'product_id', l.product_id, 'product', p.name_en, 'name_ar', coalesce(p.name_ar, p.name_en),
           'storage', p.storage, 'expiry_date', l.expiry_date, 'lot', l.lot, 'received_qty', l.qty_received, 'qty_left', l.qty_left, 'on_hand', sl.on_hand,
           'expired', l.expiry_date < hub_today(), 'days_left', l.expiry_date - hub_today(), 'bin', product_bin_code(l.source_id, l.product_id))
           order by l.expiry_date, p.name_en, l.received_at), '[]'::jsonb)
    from stock_lots l join products p on p.id = l.product_id
    join stock_levels sl on sl.source_id = l.source_id and sl.product_id = l.product_id
   where l.source_id = p_source and l.qty_left > 0 and l.expiry_date is not null and l.expiry_date <= hub_today() + p_days $$;

-- One item's lots on the shelf, in the order they are picked, and its stock with no lot.
create or replace function stock_lots_of(p_source uuid, p_product uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('no_lot', stock_no_lot(p_source, p_product), 'bin', product_bin_code(p_source, p_product),
    'lots', coalesce((select jsonb_agg(jsonb_build_object('lot_id', l.id, 'lot', l.lot, 'expiry_date', l.expiry_date, 'qty_left', l.qty_left,
               'received_at', l.received_at, 'expired', l.expiry_date < hub_today())
             order by (l.expiry_date < hub_today()) desc nulls last, l.expiry_date nulls last, l.received_at)
             from stock_lots l where l.source_id = p_source and l.product_id = p_product and l.qty_left > 0), '[]'::jsonb)) $$;

-- The pick list (0227's text) with each line's bin, the lots to take, "check the date" for stock with no lot, and "only an expired lot
-- is left". Lines are walked by zone (ambient, fresh, chilled, frozen), then by bin, then by name; the numbers follow the walk.
create or replace function pick_list(p_order uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'status', o.status, 'notes', o.customer_notes,
    'picker_id', ps.picker_id, 'started_at', ps.started_at, 'finished_at', ps.finished_at, 'total_usd', o.total_usd, 'payment_method', o.payment_method,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('n', x.n, 'item_id', x.id, 'product_id', x.product_id, 'name', x.name, 'qty', x.qty,
                         'unit', x.sell_unit, 'storage', x.storage, 'on_hold', x.on_hold, 'note', x.note, 'bin', x.bin,
                         'take', x.plan->'take', 'check_date', exists (select 1 from jsonb_array_elements(x.plan->'take') t where (t->>'no_lot')::boolean),
                         'expired_only', (x.plan->>'good')::numeric < x.qty and (x.plan->>'expired_qty')::numeric > 0) order by x.n)
                       from (select i.id, i.product_id, coalesce(p.name_ar, i.name_snapshot) as name, i.qty, p.sell_unit, p.storage, i.note,
                                    product_on_hold(i.product_id) as on_hold, b.code as bin, lot_plan(f.source_id, i.product_id, i.qty) as plan,
                                    row_number() over (order by zone_walk_rank(p.storage), (b.id is null), b.walk_order, b.code, i.name_snapshot, i.id) as n
                               from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
                               join products p on p.id = i.product_id
                               left join product_bins pb on pb.source_id = f.source_id and pb.product_id = i.product_id
                               left join bins b on b.id = pb.bin_id
                              where i.order_id = o.id and i.status = 'ok' and s.kind = 'dark_store') x), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'name', coalesce(p.name_ar, i.name_snapshot), 'qty', i.qty,
                           'status', i.status, 'reason', i.missing_reason, 'line_total_usd', round(i.qty * i.unit_price_usd, 2)) order by i.missing_at)
                         from order_items i join products p on p.id = i.product_id
                        where i.order_id = o.id and i.missing_at is not null), '[]'::jsonb))
  from orders o left join pick_sessions ps on ps.order_id = o.id where o.id = p_order $$;

-- 0147's text, and an expired lot cannot be picked: "Picked" is refused for a line that only an expired lot could fill.
create or replace function pick_mark_line(p_item uuid, p_by uuid, p_picked boolean default true) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_order uuid; v_status order_status; v_src uuid; v_product uuid; v_qty numeric; v_plan jsonb;
begin
  if not staff_can_pick(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select i.order_id, o.status, f.source_id, i.product_id, i.qty into v_order, v_status, v_src, v_product, v_qty
    from order_items i join orders o on o.id = i.order_id join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
   where i.id = p_item and i.status = 'ok' and s.kind = 'dark_store';
  if v_order is null then raise exception 'ITEM_NOT_FOUND'; end if;
  perform 1 from orders where id = v_order for update;
  if v_status <> 'preparing' or not exists (select 1 from pick_sessions where order_id = v_order and finished_at is null) then
    raise exception 'NOT_BEING_PICKED %', v_status;
  end if;
  if coalesce(p_picked, true) then
    v_plan := lot_plan(v_src, v_product, v_qty);
    if (v_plan->>'good')::numeric < v_qty and (v_plan->>'expired_qty')::numeric > 0 then
      raise exception 'LOT_EXPIRED only an expired lot is left: mark the line missing and write the lot off';
    end if;
    insert into pick_line_marks(item_id, order_id, picked_by) values (p_item, v_order, p_by) on conflict (item_id) do nothing;
  else
    delete from pick_line_marks where item_id = p_item;
  end if;
  return jsonb_build_object('order_id', v_order, 'picked', coalesce(p_picked, true), 'unmarked', pick_unmarked_lines(v_order));
end $$;

do $$ declare t text; r text;
begin
  foreach t in array array['stock_lots', 'stock_lot_moves'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated', 'web_channel'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
