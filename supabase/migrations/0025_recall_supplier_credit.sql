-- Alo King Chouf, session C1, build plan 2.11: product recall and supplier credit.
--   hold_product():  one action makes a product not sellable and not pickable. It goes off the catalog through the existing
--                    switches (products.is_active, offers.is_available), so search, quotes and the confirm-time check already
--                    refuse it, and a trigger refuses to reserve or pick it whatever path tries. release_hold() restores both.
--                    Any staff member may hold (failing closed is safe); only an ops lead or admin may release.
--   recall_orders(): every order that contained it in a date range, with the number to phone, for ops to call.
--   record_supplier_credit(): a credit note reduces what we owe the supplier and the average cost of what is left; goods
--                    sent back leave the shelf. Credit beyond the value still on the shelf reduces cost of goods (the goods were sold).
-- Recalled stock is either sent back (a credit note line with qty_returned) or destroyed (adjust_stock, reason 'recall').

alter type stock_reason add value if not exists 'supplier_return';

create table product_holds (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id),
  reason       text not null,
  held_by      uuid not null references parties(id),
  held_at      timestamptz not null default now(),
  prior_active boolean not null,
  prior_offers jsonb not null default '[]',      -- [{source_id, is_available}] as they were, restored on release
  released_by  uuid references parties(id),
  released_at  timestamptz,
  release_note text
);
create unique index product_holds_open on product_holds(product_id) where released_at is null;

create or replace function product_on_hold(p_product uuid) returns boolean language sql stable as
$$ select exists (select 1 from product_holds where product_id = p_product and released_at is null) $$;

-- Not pickable, not reservable, by any path. Named to fire before the costing trigger (triggers fire in name order).
create or replace function stock_movement_hold_check() returns trigger language plpgsql as $$
begin
  if new.reason::text in ('reserve', 'pick') and product_on_hold(new.product_id) then
    raise exception 'PRODUCT_ON_HOLD % (remove it from the order)', new.product_id;
  end if;
  return new;
end $$;
create trigger stock_movements_hold before insert on stock_movements for each row execute function stock_movement_hold_check();

-- Orders that are still at the hub or on the road with the product in them, for the hold result and the recall list.
create or replace function recall_orders(p_product uuid, p_from timestamptz default now() - interval '30 days', p_to timestamptz default now())
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'status', o.status,
           'stage', case when o.status in ('delivered', 'closed') then 'with_customer'
                         when o.status in ('out_for_delivery', 'arrived', 'failed_delivery') then 'on_the_way'
                         else 'at_hub' end,
           'qty', x.qty, 'ordered_at', o.created_at, 'delivered_at', o.delivered_at,
           'customer', pa.display_name, 'phone', customer_contact_phone(o.customer_id))
           order by coalesce(o.delivered_at, o.created_at) desc), '[]'::jsonb)
    from (select i.order_id, sum(i.qty) as qty from order_items i where i.product_id = p_product and i.status = 'ok' group by i.order_id) x
    join orders o on o.id = x.order_id join parties pa on pa.id = o.customer_id
   where o.status in ('awaiting_payment', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'arrived', 'failed_delivery', 'delivered', 'closed')
     and coalesce(o.delivered_at, o.confirmed_at, o.created_at) >= p_from and coalesce(o.delivered_at, o.confirmed_at, o.created_at) < p_to $$;

create or replace function hold_product(p_product uuid, p_by uuid, p_reason text) returns jsonb language plpgsql as $$
declare h product_holds%rowtype; p products%rowtype; v_already boolean := true;
begin
  if not exists (select 1 from parties where id = p_by and role in ('picker', 'ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into p from products where id = p_product for update;
  if not found then raise exception 'UNKNOWN_PRODUCT %', p_product; end if;
  select * into h from product_holds where product_id = p_product and released_at is null;
  if not found then
    insert into product_holds(product_id, reason, held_by, prior_active, prior_offers)
      values (p_product, btrim(p_reason), p_by, p.is_active,
              coalesce((select jsonb_agg(jsonb_build_object('source_id', source_id, 'is_available', is_available)) from offers where product_id = p_product), '[]'))
      returning * into h;
    v_already := false;
    update products set is_active = false where id = p_product;
    update offers set is_available = false where product_id = p_product;
  end if;
  return jsonb_build_object('ok', true, 'hold_id', h.id, 'held_at', h.held_at, 'already', v_already, 'reason', h.reason,
    'open_orders', (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(recall_orders(p_product, '-infinity', 'infinity')) x
                     where x->>'stage' <> 'with_customer'));
end $$;

create or replace function release_hold(p_product uuid, p_by uuid, p_note text) returns jsonb language plpgsql as $$
declare h product_holds%rowtype; x jsonb;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'NOTE_REQUIRED'; end if;
  select * into h from product_holds where product_id = p_product and released_at is null for update;
  if not found then return jsonb_build_object('ok', true, 'was_held', false); end if;
  update product_holds set released_by = p_by, released_at = now(), release_note = btrim(p_note) where id = h.id;
  update products set is_active = h.prior_active where id = p_product;
  for x in select * from jsonb_array_elements(h.prior_offers) loop
    update offers set is_available = (x->>'is_available')::boolean where product_id = p_product and source_id = (x->>'source_id')::uuid;
  end loop;
  return jsonb_build_object('ok', true, 'was_held', true);
end $$;

-- ---------- supplier credit notes ----------
create table supplier_credit_notes (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id),
  source_id   uuid not null references sources(id),
  reference   text not null,
  reason      text not null,
  total_usd   numeric(12,2) not null,
  created_by  uuid not null references parties(id),
  ledger_txn  uuid not null,
  created_at  timestamptz not null default now(),
  unique (supplier_id, reference)
);
create table supplier_credit_lines (
  id             uuid primary key default gen_random_uuid(),
  credit_id      uuid not null references supplier_credit_notes(id) on delete cascade,
  product_id     uuid not null references products(id),
  qty_returned   numeric(10,3) not null default 0 check (qty_returned >= 0),
  amount_usd     numeric(12,2) not null check (amount_usd > 0),
  to_inventory_usd numeric(12,2) not null,      -- taken off the value of stock still on the shelf (or sent back)
  to_cogs_usd    numeric(12,2) not null,        -- beyond that: the goods were already sold, so their cost comes down
  avg_cost_before numeric(12,4),
  avg_cost_after  numeric(12,4)
);

-- p_lines: [{product_id, amount_usd, qty_returned?}, ...]. qty_returned units leave the shelf (they go back to the supplier);
-- the amount comes off what we owe. The value of the stock left drops by the amount, so its average cost falls; if the amount
-- is more than that value, the rest reduces cost of goods. Credit below the value of goods sent back is a stock loss.
create or replace function record_supplier_credit(p_supplier uuid, p_source uuid, p_lines jsonb, p_by uuid, p_reference text, p_reason text)
returns jsonb language plpgsql as $$
declare c supplier_credit_notes%rowtype; ln jsonb; lvl stock_levels%rowtype; v_q numeric; v_amt numeric; v_value numeric; v_left numeric;
        v_inv numeric; v_rest numeric; v_avg numeric; v_txn uuid := gen_random_uuid(); v_total numeric := 0; v_out jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if length(btrim(coalesce(p_reference, ''))) < 3 then raise exception 'REFERENCE_REQUIRED'; end if;
  select * into c from supplier_credit_notes where supplier_id = p_supplier and reference = btrim(p_reference);
  if found then return jsonb_build_object('ok', true, 'duplicate', true, 'credit_id', c.id, 'total_usd', c.total_usd); end if;
  if not exists (select 1 from suppliers where id = p_supplier) then raise exception 'UNKNOWN_SUPPLIER'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'NO_LINES'; end if;

  insert into supplier_credit_notes(supplier_id, source_id, reference, reason, total_usd, created_by, ledger_txn)
    values (p_supplier, p_source, btrim(p_reference), coalesce(nullif(btrim(p_reason), ''), 'credit'), 0, p_by, v_txn) returning * into c;

  for ln in select * from jsonb_array_elements(p_lines) loop
    v_q := coalesce((ln->>'qty_returned')::numeric, 0); v_amt := round((ln->>'amount_usd')::numeric, 2);
    if v_amt is null or v_amt <= 0 then raise exception 'BAD_AMOUNT'; end if;
    if v_q < 0 then raise exception 'BAD_QTY'; end if;
    select * into lvl from stock_levels where source_id = p_source and product_id = (ln->>'product_id')::uuid for update;
    if v_q > 0 and (not found or lvl.on_hand - lvl.reserved < v_q) then raise exception 'NOT_ON_THE_SHELF %', ln->>'product_id'; end if;
    v_left := coalesce(lvl.on_hand, 0) - v_q;
    if lvl.avg_cost_usd is null then
      v_inv := 0; v_avg := null;                                   -- stock never had a cost: the whole credit reduces cost of goods
    else
      v_value := round(lvl.on_hand * lvl.avg_cost_usd, 2);
      if v_left > 0 then
        v_inv := least(v_amt, v_value);
        v_avg := round((v_value - v_inv) / v_left, 4);
        v_inv := v_value - round(v_left * v_avg, 2);              -- what the books take off, so inventory stays units times average
      else
        v_inv := v_value; v_avg := lvl.avg_cost_usd;
      end if;
    end if;
    v_rest := v_amt - v_inv;                                       -- > 0: the goods were sold, their cost comes down; < 0: a loss on the return
    if lvl.source_id is not null then
      update stock_levels set on_hand = on_hand - v_q, avg_cost_usd = coalesce(v_avg, avg_cost_usd)
       where source_id = p_source and product_id = lvl.product_id;
    end if;
    if v_q > 0 then
      insert into stock_movements(source_id, product_id, qty_delta, reason, actor_id, unit_cost_usd, ledger_txn, note)
        values (p_source, lvl.product_id, -v_q, 'supplier_return', p_by, lvl.avg_cost_usd, v_txn, 'Credit note ' || c.reference);
    end if;
    if v_inv <> 0 then
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo)
        values (v_txn, inventory_account(p_source), -v_inv, 'USD', -v_inv, 'Supplier credit ' || c.reference);
    end if;
    if v_rest <> 0 then
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo)
        values (v_txn, case when v_rest > 0 then ensure_account('cogs', 'cogs'::account_kind) else ensure_account('stock_loss', 'stock_loss'::account_kind) end,
                -v_rest, 'USD', -v_rest, 'Supplier credit ' || c.reference);
    end if;
    insert into supplier_credit_lines(credit_id, product_id, qty_returned, amount_usd, to_inventory_usd, to_cogs_usd, avg_cost_before, avg_cost_after)
      values (c.id, (ln->>'product_id')::uuid, v_q, v_amt, v_inv, v_rest, lvl.avg_cost_usd, coalesce(v_avg, lvl.avg_cost_usd));
    v_total := v_total + v_amt;
    v_out := v_out || jsonb_build_object('product_id', ln->>'product_id', 'qty_returned', v_q, 'amount_usd', v_amt,
                                         'avg_cost_before', lvl.avg_cost_usd, 'avg_cost_after', coalesce(v_avg, lvl.avg_cost_usd));
  end loop;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo)
    values (v_txn, supplier_account(p_supplier), v_total, 'USD', v_total, 'Supplier credit ' || c.reference);
  update supplier_credit_notes set total_usd = v_total where id = c.id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'credit_id', c.id, 'total_usd', v_total, 'lines', v_out,
                            'owed_usd', supplier_balance(p_supplier));
end $$;

do $$ declare t text; r text;
begin
  foreach t in array array['product_holds', 'supplier_credit_notes', 'supplier_credit_lines'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
