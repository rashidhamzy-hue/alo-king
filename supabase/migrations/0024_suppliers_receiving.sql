-- Alo King Chouf, session C1, build plan 2.7: suppliers and receiving, average cost, cost of goods.
-- Without this the business cannot see its own margin. Hub stock gets a value, and the ledger follows every unit:
--
--   receipt        Dr inventory:<hub>           Cr supplier_payable:<supplier>  (or hub_cash when paid on the spot)
--   sale (pick)    Dr cogs                       Cr inventory:<hub>              at the moving average cost
--   failed-delivery return   Dr inventory        Cr cogs                         the sale is undone
--   waste          Dr stock_loss                 Cr inventory                    damaged, expired, spoiled, recalled
--   adjustment     Dr/Cr stock_loss              Cr/Dr inventory                 counts, found, theft, samples
--   supplier paid  Dr supplier_payable           Cr hub_cash
--   opening value  Dr inventory                  Cr opening_balance              stock that was on the shelf before it had a cost
--
-- Cost of goods is posted when goods leave the shelf for an order (settle_stock's 'pick'), against that order, so an
-- order's margin is its goods revenue less its cost of goods; a failed delivery that comes back reverses it.
-- The average cost changes only when goods arrive (or a supplier credit, 2.11): stock leaving at the average leaves the
-- average unchanged, so the inventory account always equals units on hand times average cost, to the cent per movement.
-- Stock that has never been received with a cost (avg_cost_usd null) has no value and posts nothing; gross_margin()
-- reports how many units were sold that way, so a margin built on partly costed stock says so.
-- Every posting happens in the same statement as the stock movement (a trigger), so no path that moves stock can skip it.

alter type account_kind add value if not exists 'inventory';
alter type account_kind add value if not exists 'cogs';
alter type account_kind add value if not exists 'supplier_payable';
alter type account_kind add value if not exists 'stock_loss';
alter type account_kind add value if not exists 'opening_balance';

create table suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  terms      text,                                  -- "cash on delivery", "30 days": as agreed, for people to read
  is_active  boolean not null default true,
  created_by uuid references parties(id),
  created_at timestamptz not null default now()
);
create unique index suppliers_name_once on suppliers(lower(name));
alter table ledger_accounts add column if not exists supplier_id uuid references suppliers(id);

create table goods_receipts (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references suppliers(id),
  source_id    uuid not null references sources(id),
  supplier_ref text,                                -- the supplier's invoice or delivery-note number
  paid_from    text not null check (paid_from in ('credit', 'hub_cash')),
  total_usd    numeric(12,2) not null,
  received_by  uuid not null references parties(id),
  note         text,
  ledger_txn   uuid,
  created_at   timestamptz not null default now()
);
create unique index goods_receipts_ref_once on goods_receipts(supplier_id, supplier_ref) where supplier_ref is not null;

create table goods_receipt_lines (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    uuid not null references goods_receipts(id) on delete cascade,
  product_id    uuid not null references products(id),
  qty           numeric(10,3) not null check (qty > 0),
  unit_cost_usd numeric(12,4) not null check (unit_cost_usd >= 0),
  expiry_date   date,
  lot           text,
  avg_cost_before numeric(12,4),
  avg_cost_after  numeric(12,4) not null
);
create index goods_receipt_lines_product on goods_receipt_lines(product_id);
create index goods_receipt_lines_expiry on goods_receipt_lines(expiry_date) where expiry_date is not null;

alter table stock_levels add column if not exists avg_cost_usd numeric(12,4) check (avg_cost_usd >= 0);
alter table stock_movements add column if not exists unit_cost_usd numeric(12,4);
alter table stock_movements add column if not exists ledger_txn uuid;

-- plpgsql, not sql: a sql body is checked when it is created, and the account kinds above are not usable until this commits.
create or replace function inventory_account(p_source uuid) returns uuid language plpgsql as
$$ begin return ensure_account('inventory:' || p_source, 'inventory'::account_kind, null, p_source); end $$;

create or replace function supplier_account(p_supplier uuid) returns uuid language plpgsql as $$
declare v uuid := ensure_account('supplier_payable:' || p_supplier, 'supplier_payable'::account_kind);
begin
  update ledger_accounts set supplier_id = p_supplier where id = v and supplier_id is null;
  return v;
end $$;

-- Values each stock movement and posts it. Receipts and supplier returns are posted by their own functions.
create or replace function stock_movement_value() returns trigger language plpgsql as $$
declare v_units numeric; v_value numeric; v_counter uuid; v_memo text;
begin
  if new.reason::text not in ('pick', 'return', 'waste', 'adjust') then return new; end if;
  if new.unit_cost_usd is null then
    select avg_cost_usd into new.unit_cost_usd from stock_levels where source_id = new.source_id and product_id = new.product_id;
  end if;
  if new.unit_cost_usd is null then return new; end if;              -- not costed yet: nothing to post
  -- Units by which the valued shelf changes. A pick row carries the units leaving as a positive number (it clears the reservation).
  v_units := case new.reason when 'pick' then -new.qty_delta else new.qty_delta end;
  v_value := round(v_units * new.unit_cost_usd, 2);
  if v_value = 0 then return new; end if;
  v_counter := case when new.reason in ('pick', 'return') then ensure_account('cogs', 'cogs'::account_kind)
                    else ensure_account('stock_loss', 'stock_loss'::account_kind) end;
  v_memo := case new.reason when 'pick' then 'Cost of goods sold' when 'return' then 'Returned goods back on the shelf'
                            when 'waste' then 'Stock written off (' || coalesce(new.adjust_reason, 'waste') || ')'
                            else 'Stock adjustment (' || coalesce(new.adjust_reason, 'adjust') || ')' end;
  new.ledger_txn := gen_random_uuid();
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
    (new.ledger_txn, inventory_account(new.source_id), v_value, 'USD', v_value, new.order_id, v_memo),
    (new.ledger_txn, v_counter, -v_value, 'USD', -v_value, new.order_id, v_memo);
  return new;
end $$;
create trigger stock_movements_value before insert on stock_movements for each row execute function stock_movement_value();

create or replace function create_supplier(p_name text, p_by uuid, p_phone text default null, p_terms text default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'NAME_REQUIRED'; end if;
  select id into v from suppliers where lower(name) = lower(btrim(p_name));
  if v is null then
    insert into suppliers(name, phone, terms, created_by) values (btrim(p_name), p_phone, p_terms, p_by) returning id into v;
  end if;
  return v;
end $$;

-- A goods receipt. p_lines: [{product_id, qty, unit_cost_usd, expiry_date?, lot?}, ...]. Chilled, frozen and fresh goods
-- need an expiry date. Paying from the till (hub_cash) takes an ops lead or admin; a picker may receive on credit.
-- The supplier's reference makes a repeated submission return the first receipt instead of receiving twice.
create or replace function receive_goods(p_supplier uuid, p_source uuid, p_lines jsonb, p_by uuid,
                                         p_supplier_ref text default null, p_paid_from text default 'credit', p_note text default null)
returns jsonb language plpgsql as $$
declare v_role party_role; g goods_receipts%rowtype; ln jsonb; p products%rowtype; v_qty numeric; v_cost numeric; v_exp date;
        lvl stock_levels%rowtype; v_avg numeric; v_txn uuid := gen_random_uuid(); v_total numeric := 0; v_line numeric;
        v_opening numeric := 0; v_out jsonb := '[]'::jsonb; v_price numeric;
begin
  if p_supplier_ref is not null then
    select * into g from goods_receipts where supplier_id = p_supplier and supplier_ref = btrim(p_supplier_ref);
    if found then return jsonb_build_object('ok', true, 'duplicate', true, 'receipt_id', g.id, 'total_usd', g.total_usd); end if;
  end if;
  select role into v_role from parties where id = p_by and not is_blocked;
  if v_role is null or v_role not in ('picker', 'ops_lead', 'admin') then raise exception 'NOT_AUTHORISED'; end if;
  if p_paid_from not in ('credit', 'hub_cash') then raise exception 'UNKNOWN_PAYMENT %', p_paid_from; end if;
  if p_paid_from = 'hub_cash' and v_role = 'picker' then raise exception 'NEEDS_OPS_LEAD to pay from the till'; end if;
  if not exists (select 1 from suppliers where id = p_supplier and is_active) then raise exception 'UNKNOWN_SUPPLIER'; end if;
  if not exists (select 1 from sources where id = p_source and kind = 'dark_store') then raise exception 'NOT_A_STOCKED_SOURCE'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'NO_LINES'; end if;

  insert into goods_receipts(supplier_id, source_id, supplier_ref, paid_from, total_usd, received_by, note, ledger_txn)
    values (p_supplier, p_source, nullif(btrim(p_supplier_ref), ''), p_paid_from, 0, p_by, p_note, v_txn) returning * into g;

  for ln in select * from jsonb_array_elements(p_lines) loop
    select * into p from products where id = (ln->>'product_id')::uuid;
    if not found then raise exception 'UNKNOWN_PRODUCT %', ln->>'product_id'; end if;
    v_qty := (ln->>'qty')::numeric; v_cost := (ln->>'unit_cost_usd')::numeric; v_exp := nullif(ln->>'expiry_date', '')::date;
    if v_qty is null or v_qty <= 0 then raise exception 'BAD_QTY %', p.name_en; end if;
    if v_cost is null or v_cost < 0 then raise exception 'COST_REQUIRED %', p.name_en; end if;
    if v_exp is null and p.storage <> 'ambient' then raise exception 'EXPIRY_REQUIRED % is %', p.name_en, p.storage; end if;

    insert into stock_levels(source_id, product_id) values (p_source, p.id) on conflict do nothing;
    select * into lvl from stock_levels where source_id = p_source and product_id = p.id for update;
    v_avg := lvl.avg_cost_usd;
    if v_avg is null and lvl.on_hand > 0 then
      -- Units already on the shelf had no cost: they are valued at this first recorded cost, openly, as an opening balance.
      v_line := round(lvl.on_hand * v_cost, 2);
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
        (v_txn, inventory_account(p_source), v_line, 'USD', v_line, 'Existing stock valued at first receipt cost: ' || p.name_en),
        (v_txn, ensure_account('opening_balance', 'opening_balance'::account_kind), -v_line, 'USD', -v_line, 'Existing stock valued at first receipt cost: ' || p.name_en);
      v_opening := v_opening + v_line;
      v_avg := v_cost;
    end if;
    v_avg := case when lvl.on_hand + v_qty = 0 then v_cost
                  else round((lvl.on_hand * coalesce(v_avg, v_cost) + v_qty * v_cost) / (lvl.on_hand + v_qty), 4) end;
    update stock_levels set on_hand = on_hand + v_qty, avg_cost_usd = v_avg where source_id = p_source and product_id = p.id;
    insert into stock_movements(source_id, product_id, qty_delta, reason, actor_id, unit_cost_usd, ledger_txn, note)
      values (p_source, p.id, v_qty, 'receive', p_by, v_cost, v_txn, 'Receipt ' || coalesce(g.supplier_ref, g.id::text));
    insert into goods_receipt_lines(receipt_id, product_id, qty, unit_cost_usd, expiry_date, lot, avg_cost_before, avg_cost_after)
      values (g.id, p.id, v_qty, v_cost, v_exp, nullif(ln->>'lot', ''), lvl.avg_cost_usd, v_avg);
    v_line := round(v_qty * v_cost, 2);
    v_total := v_total + v_line;
    select price_usd into v_price from offers where source_id = p_source and product_id = p.id;
    v_out := v_out || jsonb_build_object('product_id', p.id, 'name', p.name_en, 'qty', v_qty, 'unit_cost_usd', v_cost,
               'avg_cost_usd', v_avg, 'price_usd', v_price,
               'margin_pct', case when v_price > 0 then round((v_price - v_avg) / v_price * 100, 1) end);
  end loop;

  if v_total > 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
      (v_txn, inventory_account(p_source), v_total, 'USD', v_total, 'Goods received ' || coalesce(g.supplier_ref, '')),
      (v_txn, case when p_paid_from = 'credit' then supplier_account(p_supplier) else ensure_account('hub_cash', 'hub_cash') end,
       -v_total, 'USD', -v_total, 'Goods received ' || coalesce(g.supplier_ref, ''));
  end if;
  update goods_receipts set total_usd = v_total where id = g.id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'receipt_id', g.id, 'total_usd', v_total,
                            'opening_value_usd', v_opening, 'lines', v_out);
end $$;

-- Phase 5: the opening count. Gives a cost to stock that is on the shelf and has none. Revaluing costed stock is not done here.
create or replace function value_opening_stock(p_source uuid, p_product uuid, p_unit_cost numeric, p_by uuid) returns jsonb language plpgsql as $$
declare lvl stock_levels%rowtype; v numeric; v_txn uuid := gen_random_uuid();
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'COST_REQUIRED'; end if;
  select * into lvl from stock_levels where source_id = p_source and product_id = p_product for update;
  if not found then raise exception 'NO_STOCK_ROW'; end if;
  if lvl.avg_cost_usd is not null then raise exception 'ALREADY_VALUED at %', lvl.avg_cost_usd; end if;
  update stock_levels set avg_cost_usd = p_unit_cost where source_id = p_source and product_id = p_product;
  v := round(lvl.on_hand * p_unit_cost, 2);
  if v > 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
      (v_txn, inventory_account(p_source), v, 'USD', v, 'Opening stock value'),
      (v_txn, ensure_account('opening_balance', 'opening_balance'::account_kind), -v, 'USD', -v, 'Opening stock value');
  end if;
  return jsonb_build_object('ok', true, 'value_usd', v);
end $$;

-- Paying a supplier from the hub till. The reference (receipt or transfer number) is required and used once per supplier.
create or replace function pay_supplier(p_supplier uuid, p_amount_usd numeric, p_by uuid, p_ref text) returns jsonb language plpgsql as $$
declare v_txn uuid := gen_random_uuid(); v_acct uuid;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_amount_usd is null or p_amount_usd <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if length(btrim(coalesce(p_ref, ''))) < 3 then raise exception 'REFERENCE_REQUIRED'; end if;
  v_acct := supplier_account(p_supplier);
  if exists (select 1 from ledger_entries where account_id = v_acct and memo = 'Supplier paid ' || btrim(p_ref)) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'owed_usd', supplier_balance(p_supplier));
  end if;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
    (v_txn, v_acct, p_amount_usd, 'USD', p_amount_usd, 'Supplier paid ' || btrim(p_ref)),
    (v_txn, ensure_account('hub_cash', 'hub_cash'), -p_amount_usd, 'USD', -p_amount_usd, 'Supplier paid ' || btrim(p_ref));
  return jsonb_build_object('ok', true, 'duplicate', false, 'owed_usd', supplier_balance(p_supplier));
end $$;

-- What we owe a supplier (positive) or they owe us (negative, after a credit note larger than the open balance).
create or replace function supplier_balance(p_supplier uuid) returns numeric language sql stable as $$
  select coalesce(-sum(e.usd_equiv), 0) from ledger_entries e join ledger_accounts a on a.id = e.account_id
   where a.code = 'supplier_payable:' || p_supplier $$;

-- Gross margin over a period: goods revenue (dark store sales) less cost of goods, with waste and adjustments shown apart.
-- uncosted_units_sold counts units that left the shelf with no cost; while it is above zero the margin is overstated.
create or replace function gross_margin(p_since timestamptz default date_trunc('day', now()), p_until timestamptz default now())
returns jsonb language sql stable as $$
  with t as (
    select a.kind::text as kind, sum(e.usd_equiv) as s from ledger_entries e join ledger_accounts a on a.id = e.account_id
     where e.created_at >= p_since and e.created_at < p_until and a.kind::text in ('revenue_goods', 'cogs', 'stock_loss')
     group by a.kind
  ), v as (
    select coalesce(-(select s from t where kind = 'revenue_goods'), 0) as revenue, coalesce((select s from t where kind = 'cogs'), 0) as cogs,
           coalesce((select s from t where kind = 'stock_loss'), 0) as loss
  )
  select jsonb_build_object('revenue_goods_usd', revenue, 'cogs_usd', cogs, 'gross_margin_usd', revenue - cogs,
           'gross_margin_pct', case when revenue > 0 then round((revenue - cogs) / revenue * 100, 1) end,
           'stock_loss_usd', loss,
           'uncosted_units_sold', (select coalesce(sum(qty_delta), 0) from stock_movements
                                    where reason = 'pick' and unit_cost_usd is null and created_at >= p_since and created_at < p_until))
  from v $$;

-- One order: what its goods sold for and what they cost.
create or replace function order_margin(p_order uuid) returns jsonb language sql stable as $$
  with r as (select coalesce(sum(round(i.qty * i.unit_price_usd, 2)), 0) as revenue
               from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
              where i.order_id = p_order and i.status = 'ok' and s.kind = 'dark_store'),
       c as (select coalesce(sum(e.usd_equiv), 0) as cogs from ledger_entries e join ledger_accounts a on a.id = e.account_id
              where e.order_id = p_order and a.code = 'cogs')
  select jsonb_build_object('order_id', p_order, 'goods_usd', r.revenue, 'cogs_usd', c.cogs, 'margin_usd', r.revenue - c.cogs,
           'costed', not exists (select 1 from stock_movements where order_id = p_order and reason = 'pick' and unit_cost_usd is null))
  from r, c $$;

-- The hub's stock at cost, product by product, and how it ties to the inventory account.
create or replace function inventory_valuation(p_source uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'stock_value_usd', coalesce((select round(sum(on_hand * avg_cost_usd), 2) from stock_levels where source_id = p_source and avg_cost_usd is not null), 0),
    'ledger_usd', coalesce((select sum(e.usd_equiv) from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = 'inventory:' || p_source), 0),
    'uncosted_products', (select count(*) from stock_levels where source_id = p_source and avg_cost_usd is null and on_hand > 0)) $$;

-- Received lots whose expiry falls within p_days, for products still on the shelf.
create or replace function expiring_stock(p_source uuid, p_days int default 7) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', l.product_id, 'product', p.name_en, 'expiry_date', l.expiry_date,
           'lot', l.lot, 'received_qty', l.qty, 'on_hand', sl.on_hand) order by l.expiry_date, p.name_en), '[]'::jsonb)
    from goods_receipt_lines l join goods_receipts g on g.id = l.receipt_id join products p on p.id = l.product_id
    join stock_levels sl on sl.source_id = g.source_id and sl.product_id = l.product_id
   where g.source_id = p_source and sl.on_hand > 0 and l.expiry_date is not null and l.expiry_date <= current_date + p_days $$;

do $$ declare t text; r text;
begin
  foreach t in array array['suppliers', 'goods_receipts', 'goods_receipt_lines'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
