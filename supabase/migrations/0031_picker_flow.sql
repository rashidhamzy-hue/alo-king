-- Alo King Chouf, session C2, build plan 2.1: the picker flow on the ops line.
-- Pick list, start, item missing, picked. "Picked" moves the order to ready, which takes the units off the shelf (settle_stock)
-- and values them (0024). Everything a picker does goes through these functions; the ops line handler only parses taps.
--   * start_pick:       confirmed -> preparing (actor picker), one open pick per picker. Lines whose product is on hold (0025) are
--                       found missing at once: they cannot be picked by any path, so they are never left on the list.
--   * pick_item_missing: the picker found fewer than ordered (none, or some). The shortfall becomes its own order line, so the
--                       order keeps the record. Its reservation is released, and the units the shelf was thought to hold are
--                       written off as a stock adjustment (reason missing_at_pick, valued as stock loss) so they are not sold
--                       again; ops is asked to count the product. The order total is recalculated at once.
--                       In 2.1 a missing line is removed. 2.2 (0032) lets the picker offer a substitute for the customer to keep.
--   * finish_pick:      preparing -> ready (actor picker). Refused while a line still waits for a decision. An order with nothing
--                       left is not sent out: ops is asked to call the customer (the cancel is theirs to make).
-- A prepaid order that is already paid and comes up short is owed the difference as customer credit (2.3, 0030), which ops can
-- pay out. A cash order simply costs less: the rider collects the recalculated total.

alter table stock_movements drop constraint if exists stock_movements_adjust_reason_check;
alter table stock_movements add constraint stock_movements_adjust_reason_check
  check (adjust_reason in ('count', 'found', 'damaged', 'expired', 'spoiled', 'theft', 'recall', 'sample', 'other', 'missing_at_pick'));

alter table order_items add column if not exists missing_reason text check (missing_reason in ('not_on_shelf', 'on_hold'));
alter table order_items add column if not exists missing_by uuid references parties(id);
alter table order_items add column if not exists missing_at timestamptz;

create table pick_sessions (
  order_id    uuid primary key references orders(id),
  picker_id   uuid not null references parties(id),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  finished_by uuid references parties(id)
);
create index pick_sessions_open on pick_sessions(picker_id) where finished_at is null;

insert into settings(key, value) values ('picking', '{"pick_alert_min": 10}')
on conflict (key) do update set value = excluded.value || settings.value;

create or replace function staff_can_pick(p_party uuid) returns boolean language sql stable as
$$ select exists (select 1 from parties where id = p_party and role in ('picker', 'ops_lead', 'admin') and not is_blocked) $$;

create or replace function order_has_hub_goods(p_order uuid) returns boolean language sql stable as
$$ select exists (select 1 from fulfilments f join sources s on s.id = f.source_id where f.order_id = p_order and s.kind = 'dark_store' and f.status <> 'cancelled') $$;

-- What a picker sees: lines to pick in shelf order (ambient, then chilled, frozen, fresh), numbered for a typed "missing 2",
-- and what has already come up missing.
create or replace function pick_list(p_order uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'status', o.status, 'notes', o.customer_notes,
    'picker_id', ps.picker_id, 'started_at', ps.started_at, 'finished_at', ps.finished_at, 'total_usd', o.total_usd, 'payment_method', o.payment_method,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('n', x.n, 'item_id', x.id, 'product_id', x.product_id, 'name', x.name, 'qty', x.qty,
                         'unit', x.sell_unit, 'storage', x.storage, 'on_hold', x.on_hold, 'note', x.note) order by x.n)
                       from (select i.id, i.product_id, coalesce(p.name_ar, i.name_snapshot) as name, i.qty, p.sell_unit, p.storage, i.note,
                                    product_on_hold(i.product_id) as on_hold,
                                    row_number() over (order by p.storage, i.name_snapshot, i.id) as n
                               from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
                               join products p on p.id = i.product_id
                              where i.order_id = o.id and i.status = 'ok' and s.kind = 'dark_store') x), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'name', coalesce(p.name_ar, i.name_snapshot), 'qty', i.qty,
                           'status', i.status, 'reason', i.missing_reason, 'line_total_usd', round(i.qty * i.unit_price_usd, 2)) order by i.missing_at)
                         from order_items i join products p on p.id = i.product_id
                        where i.order_id = o.id and i.missing_at is not null), '[]'::jsonb))
  from orders o left join pick_sessions ps on ps.order_id = o.id where o.id = p_order $$;

-- Waiting to be picked (oldest confirmation first), and picks that are open.
create or replace function pick_queue(p_limit int default 5) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by x->>'status' desc, x->>'confirmed_at'), '[]'::jsonb) from (
    select jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'status', o.status, 'confirmed_at', o.confirmed_at,
             'village', v.name_ar, 'picker_id', ps.picker_id,
             'items', (select count(*) from order_items i where i.order_id = o.id and i.status = 'ok')) as x
      from orders o left join pick_sessions ps on ps.order_id = o.id and ps.finished_at is null left join villages v on v.id = o.village_id
     where ((o.status = 'confirmed' and ps.order_id is null) or (o.status = 'preparing' and ps.order_id is not null))
       and order_has_hub_goods(o.id)
     order by (o.status = 'preparing') desc, o.confirmed_at limit p_limit) q $$;

-- An open pick is one whose order is still being prepared (ops may cancel an order mid-pick).
create or replace function pick_open_for(p_picker uuid) returns uuid language sql stable as
$$ select ps.order_id from pick_sessions ps join orders o on o.id = ps.order_id
   where ps.picker_id = p_picker and ps.finished_at is null and o.status = 'preparing' order by ps.started_at desc limit 1 $$;

-- Subtotals follow the lines that are still ok. Fees and dues stay as quoted: a missing item never adds a fee.
create or replace function recalc_order_lines(p_order uuid) returns numeric language plpgsql as $$
declare v numeric;
begin
  update fulfilments f set subtotal_usd = coalesce((select sum(round(i.qty * i.unit_price_usd, 2)) from order_items i
                                                     where i.fulfilment_id = f.id and i.status = 'ok'), 0)
   where f.order_id = p_order;
  select coalesce(sum(round(qty * unit_price_usd, 2)), 0) into v from order_items where order_id = p_order and status = 'ok';
  update orders set subtotal_usd = v where id = p_order;
  return v;
end $$;

-- Internal: the shortfall of one line becomes its own line with status missing; its reservation is released.
-- p_cause not_on_shelf also writes the phantom units off the shelf figure; on_hold does not (the goods are there, held).
create or replace function pick_short_line(p_item uuid, p_by uuid, p_found numeric, p_cause text) returns uuid language plpgsql as $$
declare i order_items%rowtype; v_src uuid; v_short numeric; v_missing uuid; v_free numeric; v_w numeric; v_code text;
begin
  select * into i from order_items where id = p_item for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if i.status <> 'ok' then return case when i.missing_at is not null then i.id end; end if;
  select f.source_id into v_src from fulfilments f join sources s on s.id = f.source_id where f.id = i.fulfilment_id and s.kind = 'dark_store';
  if v_src is null then raise exception 'NOT_A_HUB_LINE'; end if;
  if p_found is null or p_found < 0 or p_found >= i.qty then raise exception 'BAD_FOUND_QTY found % of %', p_found, i.qty; end if;
  v_short := i.qty - p_found;
  if p_found > 0 then
    update order_items set qty = p_found where id = i.id;
    insert into order_items(order_id, fulfilment_id, product_id, name_snapshot, qty, unit_price_usd, modifiers, note, raw_phrase,
                            status, missing_reason, missing_by, missing_at)
      values (i.order_id, i.fulfilment_id, i.product_id, i.name_snapshot, v_short, i.unit_price_usd, i.modifiers, i.note, i.raw_phrase,
              'missing', p_cause, p_by, now())
      returning id into v_missing;
  else
    update order_items set status = 'missing', missing_reason = p_cause, missing_by = p_by, missing_at = now() where id = i.id;
    v_missing := i.id;
  end if;
  update stock_levels set reserved = greatest(reserved - v_short, 0) where source_id = v_src and product_id = i.product_id;
  insert into stock_movements(source_id, product_id, qty_delta, reason, order_id, actor_id, note)
    values (v_src, i.product_id, v_short, 'release', i.order_id, p_by, 'missing at pick');
  if p_cause = 'not_on_shelf' then
    select on_hand - reserved into v_free from stock_levels where source_id = v_src and product_id = i.product_id for update;
    v_w := least(v_short, greatest(coalesce(v_free, 0), 0));
    if v_w > 0 then
      select short_code into v_code from orders where id = i.order_id;
      update stock_levels set on_hand = on_hand - v_w where source_id = v_src and product_id = i.product_id;
      insert into stock_movements(source_id, product_id, qty_delta, reason, order_id, actor_id, adjust_reason, note)
        values (v_src, i.product_id, -v_w, 'adjust', i.order_id, p_by, 'missing_at_pick', 'not on the shelf for ' || v_code);
    end if;
    perform raise_ops_exception('count_needed', v_src || ':' || i.product_id,
      jsonb_build_object('product_id', i.product_id, 'product', i.name_snapshot, 'order', v_code, 'missing_units', v_short));
  end if;
  return v_missing;
end $$;

-- Internal: a missing line is taken off the order. Paid orders are owed the difference as credit (0030).
create or replace function pick_remove_line(p_missing uuid, p_by uuid) returns jsonb language plpgsql as $$
declare i order_items%rowtype; v_amt numeric; v_credit numeric := 0;
begin
  select * into i from order_items where id = p_missing for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if i.status = 'removed' then return jsonb_build_object('removed_usd', 0, 'already', true); end if;
  if i.status <> 'missing' then raise exception 'LINE_NOT_MISSING %', i.status; end if;
  update order_items set status = 'removed' where id = i.id;
  perform recalc_order_lines(i.order_id);
  v_amt := round(i.qty * i.unit_price_usd, 2);
  if v_amt > 0 and exists (select 1 from payments where order_id = i.order_id and status = 'confirmed') then
    perform grant_customer_credit(i.order_id, v_amt, 'goods', 'missing_at_pick', p_by, i.name_snapshot, i.id, 'pick:' || i.id);
    v_credit := v_amt;
  end if;
  return jsonb_build_object('removed_usd', v_amt, 'credit_usd', v_credit);
end $$;

create or replace function pick_start_checks(p_by uuid) returns void language plpgsql as $$
begin
  if not staff_can_pick(p_by) then raise exception 'NOT_AUTHORISED'; end if;
end $$;

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

-- A line whose product is on hold. In 2.1 it is removed at once; 2.2 redefines this to let the picker offer a substitute.
create or replace function pick_found_held(p_item uuid, p_by uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := pick_short_line(p_item, p_by, 0, 'on_hold');
  perform pick_remove_line(v, p_by);
  return v;
end $$;

-- The picker found p_found of the line (0: none). Returns the missing line and what the order now costs.
create or replace function pick_item_missing(p_item uuid, p_by uuid, p_found numeric default 0) returns jsonb language plpgsql as $$
declare v_order uuid; v_status order_status; v_missing uuid; r jsonb;
begin
  if not staff_can_pick(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select i.order_id, o.status into v_order, v_status from order_items i join orders o on o.id = i.order_id where i.id = p_item;
  if v_order is null then raise exception 'ITEM_NOT_FOUND'; end if;
  perform 1 from orders where id = v_order for update;
  if v_status <> 'preparing' or not exists (select 1 from pick_sessions where order_id = v_order and finished_at is null) then
    raise exception 'NOT_BEING_PICKED %', v_status;
  end if;
  v_missing := pick_short_line(p_item, p_by, coalesce(p_found, 0), 'not_on_shelf');
  r := pick_remove_line(v_missing, p_by);
  return r || jsonb_build_object('order_id', v_order, 'missing_item', v_missing, 'decision', 'removed',
                                 'total_usd', (select total_usd from orders where id = v_order));
end $$;

-- Picked. Refused while a missing line waits for a decision; an order with nothing left goes to ops, not to the road.
create or replace function finish_pick(p_order uuid, p_by uuid) returns jsonb language plpgsql as $$
declare o orders%rowtype; r record; v_waiting jsonb; v_changed boolean;
begin
  if not staff_can_pick(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.status <> 'preparing' then
    return jsonb_build_object('status', case when o.status in ('ready', 'out_for_delivery', 'arrived', 'delivered', 'closed') then 'already' else 'not_pickable' end,
                              'order_status', o.status, 'short_code', o.short_code);
  end if;
  if not exists (select 1 from pick_sessions where order_id = p_order and finished_at is null) then
    return jsonb_build_object('status', 'not_started', 'short_code', o.short_code);
  end if;
  -- A hold placed while the order was being picked: the line cannot leave the shelf, so it comes up missing now.
  for r in select i.id from order_items i join fulfilments f on f.id = i.fulfilment_id join sources sr on sr.id = f.source_id
            where i.order_id = p_order and i.status = 'ok' and sr.kind = 'dark_store' and product_on_hold(i.product_id) loop
    perform pick_found_held(r.id, p_by);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'name', i.name_snapshot)), '[]'::jsonb) into v_waiting
    from order_items i where i.order_id = p_order and i.status = 'missing';
  if jsonb_array_length(v_waiting) > 0 then
    return jsonb_build_object('status', 'waiting', 'short_code', o.short_code, 'lines', v_waiting, 'list', pick_list(p_order));
  end if;
  if not exists (select 1 from order_items where order_id = p_order and status = 'ok') then
    perform raise_ops_exception('pick_empty', o.short_code, jsonb_build_object('order_id', p_order, 'picker', p_by));
    return jsonb_build_object('status', 'empty', 'short_code', o.short_code);
  end if;
  perform transition_order(p_order, 'ready', 'picker', p_by, 'picked');
  update pick_sessions set finished_at = now(), finished_by = p_by where order_id = p_order;
  v_changed := exists (select 1 from order_items where order_id = p_order and missing_at is not null);
  return jsonb_build_object('status', 'ready', 'short_code', o.short_code, 'customer_id', o.customer_id, 'changed', v_changed,
                            'changes', pick_changes(p_order));
end $$;

-- What changed at the shelf, for the customer's message: lines taken off or replaced, the new total, any credit owed.
create or replace function pick_changes(p_order uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('short_code', o.short_code, 'total_usd', o.total_usd, 'fx_rate_lbp', o.fx_rate_lbp, 'payment_method', o.payment_method,
    'removed', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(p.name_ar, i.name_snapshot), 'qty', i.qty,
                          'line_total_usd', round(i.qty * i.unit_price_usd, 2)) order by i.missing_at)
                        from order_items i join products p on p.id = i.product_id where i.order_id = o.id and i.status = 'removed'), '[]'::jsonb),
    'credit_usd', coalesce((select sum(amount_usd) from refunds where order_id = o.id and reason in ('missing_at_pick', 'substitute_cheaper')), 0))
  from orders o where o.id = p_order $$;

do $$ declare r text;
begin
  alter table pick_sessions enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table pick_sessions from %I', r); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
