-- Alo King Chouf, session D3 (console): the console never takes the hub drawer below zero.
-- D2 found that pay_supplier (0024) and pay_out_credit with cash (0030) do not check that the drawer holds the money, so the books
-- could show a negative drawer; record_bank_deposit, petty cash and expenses (hub_money_out, 0047) do check. receive_goods paid
-- from the till (0024, the console's receiving page) had the same gap.
--
-- drawer_can_pay() is hub_money_out's check, for dollars (these pay in dollars only). It takes the same lock, so two movements
-- out of the drawer cannot both pass on the same notes, and refuses with the same NOT_ENOUGH_CASH hub_cash.
--   * receive_goods: checked inside, before the till is credited (one added line, marked D3).
--   * pay_supplier and pay_out_credit: the console calls pay_supplier_checked and pay_out_credit_checked, which check the drawer
--     and then call them unchanged; refund_order_now (0046, the console's refund, also after a second approval) pays out cash
--     through pay_out_credit_checked. The two base functions are left as they are because lane C's own tests
--     (test/db/refunds.test.ts, test/db/receiving-margin.test.ts) pay from an empty drawer and are not D3's files: moving the
--     check into them is two fixture lines there (a rider's cash drop before paying), recorded in docs/HANDOFF.md.
-- Anyone redefining these: start from here. Not changed (lane C): a rider's earnings paid from the hub at settlement (0010).

create or replace function drawer_can_pay(p_usd numeric) returns void language plpgsql as $$
declare n record;
begin
  perform pg_advisory_xact_lock(hashtextextended('hub_money:hub_cash', 0));
  select * into n from account_native('hub_cash');
  if round(coalesce(p_usd, 0), 2) > n.usd + 0.005 then raise exception 'NOT_ENOUGH_CASH hub_cash holds % USD and % LBP', n.usd, n.lbp; end if;
end $$;

-- A repeat (the same receipt number) is answered by pay_supplier as before, whatever the drawer holds now.
create or replace function pay_supplier_checked(p_supplier uuid, p_amount_usd numeric, p_by uuid, p_ref text) returns jsonb language plpgsql as $$
begin
  if not exists (select 1 from ledger_entries e join ledger_accounts a on a.id = e.account_id
                  where a.code = 'supplier_payable:' || p_supplier and e.memo = 'Supplier paid ' || btrim(coalesce(p_ref, ''))) then
    perform drawer_can_pay(p_amount_usd);
  end if;
  return pay_supplier(p_supplier, p_amount_usd, p_by, p_ref);
end $$;

-- Cash only: Whish and OMT leave from their clearing accounts. A repeat (the same form key) is answered by pay_out_credit.
create or replace function pay_out_credit_checked(p_party uuid, p_amount numeric, p_method text, p_by uuid, p_ref text default null, p_key text default null)
returns jsonb language plpgsql as $$
begin
  if p_method = 'cash' and (p_key is null or not exists (select 1 from credit_payouts where request_key = p_key)) then
    perform drawer_can_pay(p_amount);
  end if;
  return pay_out_credit(p_party, p_amount, p_method, p_by, p_ref, p_key);
end $$;

-- 0046's text; the cash payout goes through pay_out_credit_checked.
create or replace function refund_order_now(p_order uuid, p_by uuid, p_amount_usd numeric, p_charged_to text, p_reason text,
                                            p_settle text default 'credit', p_ref text default null, p_note text default null,
                                            p_item uuid default null, p_key text default null)
returns jsonb language plpgsql as $$
declare v_refund uuid; v_payout jsonb; r refunds%rowtype; v_customer uuid;
begin
  if p_key is not null then
    select * into r from refunds where request_key = p_key;
    if found then return jsonb_build_object('ok', true, 'duplicate', true, 'refund_id', r.id, 'settle', r.settle); end if;
  end if;
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_settle not in ('credit', 'cash', 'whish', 'omt') then raise exception 'UNKNOWN_SETTLE %', p_settle; end if;
  if p_reason = 'other' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'NOTE_REQUIRED'; end if;
  if p_item is not null and not exists (select 1 from order_items where id = p_item and order_id = p_order) then raise exception 'ITEM_NOT_ON_ORDER'; end if;
  v_refund := grant_customer_credit(p_order, p_amount_usd, p_charged_to, p_reason, p_by, p_note, p_item, p_key);
  if p_settle <> 'credit' then
    select customer_id into v_customer from orders where id = p_order;
    v_payout := pay_out_credit_checked(v_customer, p_amount_usd, p_settle, p_by, p_ref, case when p_key is null then null else p_key || ':payout' end);
    update refunds set settle = p_settle, payout_id = (v_payout->>'payout_id')::uuid where id = v_refund;
  end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'refund_id', v_refund, 'settle', p_settle,
                            'credit_left_usd', customer_credit_usd((select customer_id from orders where id = p_order)));
end $$;

-- 0024's text, with the D3 line: paid from the till only when the drawer holds the total.
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

  if v_total > 0 and p_paid_from = 'hub_cash' then perform drawer_can_pay(v_total); end if;   -- D3: never more than the drawer holds
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

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
