-- Alo King Chouf, session F1 (G1 fixes): cash on delivery over and short (G1-01).
--
-- Before: post_cod_collection (0052) accepted a collection up to 1 USD away from the total and posted the difference to
-- cash_over_short as "Rounding and FX difference". A rider could record up to a dollar less on every cash order and nothing flagged it.
-- Now, with diff = what the rider recorded (in dollars at the order's rate) minus the total:
--   * |diff| <= settings.over_short.cod_tolerance_usd (0.25: lira-note rounding only): cash_over_short, as before.
--   * a shortfall beyond it, up to settings.over_short.cod_max_usd (1.00): the whole shortfall is owed by the rider
--     (rider_receivable:<driver>) and a risk flag 'cod_short' (severity 2) names the order.
--   * more cash than the total beyond the tolerance: cash_over_short, with a risk flag 'cod_over' (severity 1) for the day close.
--   * more than cod_max_usd either way: refused, AMOUNT_MISMATCH, as before.
-- payments.over_short_usd keeps diff on the payment, and day_close_report shows, per rider, the day's over/short, what the rider
-- owes for shortfalls, and the number of flags.
-- Anyone redefining post_cod_collection or day_close_report: start from here.

update settings set value = jsonb_build_object('cod_tolerance_usd', 0.25, 'cod_max_usd', 1.00) || value
 where key = 'over_short' and not (value ? 'cod_tolerance_usd');
insert into settings(key, value) values ('over_short', '{"auto_writeoff_usd": 1, "cod_tolerance_usd": 0.25, "cod_max_usd": 1.00}')
  on conflict (key) do nothing;

alter table payments add column if not exists over_short_usd numeric(10,2) not null default 0;

create or replace function post_cod_collection(
  p_order uuid, p_driver uuid, p_usd numeric, p_lbp numeric, p_change_usd numeric default 0, p_change_lbp numeric default 0
) returns numeric language plpgsql as $$
declare o orders%rowtype; v_fx numeric; v_net_usd numeric; v_net_lbp numeric; v_equiv numeric;
        v_txn uuid := gen_random_uuid(); v_cash uuid; v_goods numeric := 0; v_merch numeric := 0; v_net numeric; r record;
        v_os jsonb := coalesce(setting('over_short'), '{}'::jsonb);
        v_tol numeric := coalesce((v_os->>'cod_tolerance_usd')::numeric, 0.25);
        v_max numeric := coalesce((v_os->>'cod_max_usd')::numeric, 1.00);
        v_diff numeric; v_rest numeric; v_short_to_rider boolean;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.payment_method <> 'cod' then raise exception 'NOT_COD'; end if;
  if exists (select 1 from payments where order_id = p_order and status = 'confirmed') then return driver_cash_usd(p_driver); end if;
  v_fx := coalesce(o.fx_rate_lbp, current_fx());
  v_net_usd := p_usd - p_change_usd;  v_net_lbp := p_lbp - p_change_lbp;
  v_equiv := round(v_net_usd + v_net_lbp / v_fx, 2);
  v_diff := v_equiv - o.total_usd;
  if abs(v_diff) > v_max + 0.005 then raise exception 'AMOUNT_MISMATCH expected % got %', o.total_usd, v_equiv; end if;   -- G1-01
  v_short_to_rider := v_diff < -(v_tol + 0.005);

  v_cash := ensure_account('driver_cash:' || p_driver, 'driver_cash', p_driver);
  if v_net_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo)
      values (v_txn, v_cash, v_net_usd, 'USD', v_net_usd, p_order, 'COD collected');
  end if;
  if v_net_lbp <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo)
      values (v_txn, v_cash, v_net_lbp, 'LBP', v_equiv - v_net_usd, p_order, 'COD collected');
  end if;
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
    (v_txn, ensure_account('tips_payable:' || p_driver, 'tips_payable', p_driver), -o.tip_usd, 'USD', -o.tip_usd, p_order, 'Tip');
  -- G1-01: what is left over is rounding (the company's) within the tolerance; a shortfall beyond it is owed by the rider.
  v_rest := v_equiv - v_goods - v_merch - o.delivery_fee_usd - o.tip_usd - o.dues_usd - o.small_order_fee_usd;
  if v_short_to_rider then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('rider_receivable:' || p_driver, 'rider_receivable'::account_kind, p_driver), -v_rest, 'USD', -v_rest, p_order,
       'Cash short at the door, owed by the rider');
    insert into risk_flags(subject_kind, subject_id, rule, severity, details)
      values ('driver', p_driver, 'cod_short', 2, jsonb_build_object('order_id', p_order, 'short_code', o.short_code, 'short_usd', -v_diff,
                                                                     'tolerance_usd', v_tol, 'usd', p_usd, 'lbp', p_lbp));
  else
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('cash_over_short', 'cash_over_short'), -v_rest, 'USD', -v_rest, p_order,
       case when v_diff > v_tol + 0.005 then 'Cash over at the door' else 'Rounding and FX difference' end);
    if v_diff > v_tol + 0.005 then
      insert into risk_flags(subject_kind, subject_id, rule, severity, details)
        values ('driver', p_driver, 'cod_over', 1, jsonb_build_object('order_id', p_order, 'short_code', o.short_code, 'over_usd', v_diff,
                                                                      'tolerance_usd', v_tol, 'usd', p_usd, 'lbp', p_lbp));
    end if;
  end if;
  if o.small_order_fee_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('revenue_small_order', 'revenue_small_order'::account_kind), -o.small_order_fee_usd, 'USD', -o.small_order_fee_usd, p_order, 'Small-order fee');
  end if;
  if o.dues_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('customer_receivable:' || o.customer_id, 'customer_receivable'::account_kind, o.customer_id), -o.dues_usd, 'USD', -o.dues_usd, p_order, 'Dues settled');
  end if;
  insert into payments(order_id, method, status, amount_usd, received_usd, received_lbp, change_usd, change_lbp, confirmed_by, confirmed_at, over_short_usd)
    values (p_order, 'cod', 'confirmed', o.total_usd, p_usd, p_lbp, p_change_usd, p_change_lbp, p_driver, now(), round(v_diff, 2));
  return driver_cash_usd(p_driver);
end $$;


create or replace function day_close_report(p_day date default null) returns jsonb language plpgsql stable as $$
declare v_day date := coalesce(p_day, hub_today()); b record; v jsonb; c day_closes%rowtype; v_imbalance numeric; v_stock jsonb;
        v_drawer jsonb; v_riders jsonb;
begin
  select * into b from hub_day_bounds(v_day);
  select * into c from day_closes where day = v_day;
  select coalesce(sum(usd_equiv), 0) into v_imbalance from ledger_entries where created_at >= b.since and created_at < b.until;

  with picks as (
    select m.order_id, m.product_id, sum(m.qty_delta) as picked from stock_movements m
     where m.reason = 'pick' and m.order_id is not null and m.created_at >= b.since and m.created_at < b.until group by 1, 2
  ), lines as (
    select i.order_id, i.product_id, sum(i.qty) as sold from order_items i
     where i.status = 'ok' and i.order_id in (select order_id from picks) group by 1, 2
  ), j as (
    select coalesce(p.order_id, l.order_id) as order_id, coalesce(p.product_id, l.product_id) as product_id,
           coalesce(p.picked, 0) as picked, coalesce(l.sold, 0) as sold
      from picks p full join lines l on l.order_id = p.order_id and l.product_id = p.product_id
  )
  select jsonb_build_object('picked_units', coalesce(sum(picked), 0), 'sold_units', coalesce(sum(sold), 0),
           'returned_units', (select coalesce(sum(qty_delta), 0) from stock_movements where reason = 'return' and created_at >= b.since and created_at < b.until),
           'written_off_units', (select coalesce(-sum(qty_delta), 0) from stock_movements where reason in ('waste', 'adjust') and qty_delta < 0
                                   and created_at >= b.since and created_at < b.until),
           'mismatches', coalesce(jsonb_agg(jsonb_build_object('order', o.short_code, 'product', pr.name_en, 'picked', j.picked, 'sold', j.sold))
                                    filter (where j.picked <> j.sold), '[]'::jsonb))
    into v_stock from j left join orders o on o.id = j.order_id left join products pr on pr.id = j.product_id;

  select jsonb_build_object(
      'usd', coalesce(sum(e.amount) filter (where e.currency = 'USD' and e.created_at < b.until), 0),
      'lbp', coalesce(sum(e.amount) filter (where e.currency = 'LBP' and e.created_at < b.until), 0),
      'in_from_riders_usd', coalesce(sum(e.usd_equiv) filter (where e.memo like 'Cash drop%' and e.created_at >= b.since and e.created_at < b.until), 0))
    into v_drawer from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = 'hub_cash';

  -- G1-01: the day's cash over/short per rider (collections confirmed that day), what the rider owes for shortfalls, and the flags.
  select coalesce(jsonb_agg(jsonb_build_object('rider', p.display_name, 'rider_id', p.id, 'usd', n.usd, 'lbp', n.lbp,
           'earnings_usd', (rider_statement(p.id)->>'earnings_usd')::numeric,
           'over_short_usd', os.over_short, 'short_owed_usd', os.short_owed, 'cod_flags', os.flags) order by p.display_name), '[]'::jsonb)
    into v_riders
    from parties p cross join lateral driver_cash_native(p.id) n
    cross join lateral (select
        coalesce((select sum(py.over_short_usd) from payments py where py.method = 'cod' and py.status = 'confirmed' and py.confirmed_by = p.id
                   and py.confirmed_at >= b.since and py.confirmed_at < b.until), 0) as over_short,
        coalesce((select sum(e.usd_equiv) from ledger_entries e join ledger_accounts a on a.id = e.account_id
                   where a.code = 'rider_receivable:' || p.id and e.memo = 'Cash short at the door, owed by the rider'
                     and e.created_at >= b.since and e.created_at < b.until), 0) as short_owed,
        (select count(*) from risk_flags f where f.subject_kind = 'driver' and f.subject_id = p.id and f.rule in ('cod_short', 'cod_over')
                   and f.created_at >= b.since and f.created_at < b.until) as flags) os
   where p.role = 'driver' and (n.usd <> 0 or n.lbp <> 0 or (rider_statement(p.id)->>'earnings_usd')::numeric <> 0 or os.over_short <> 0 or os.flags > 0
                                or exists (select 1 from driver_shifts s where s.driver_id = p.id and s.started_at < b.until and coalesce(s.ended_at, 'infinity') >= b.since));

  v := jsonb_build_object(
    'day', v_day, 'since', b.since, 'until', b.until,
    'orders', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
                 select o.status::text as status, count(*) as n from orders o join parties p on p.id = o.customer_id
                  where o.created_at >= b.since and o.created_at < b.until and not p.is_probe and o.status not in ('draft', 'awaiting_confirmation')
                  group by o.status) x),
    'probe_orders', (select count(*) from orders o join parties p on p.id = o.customer_id where p.is_probe and o.created_at >= b.since and o.created_at < b.until),
    'sales', (select jsonb_build_object(
                'goods_usd', coalesce(-sum(e.usd_equiv) filter (where a.kind::text = 'revenue_goods'), 0),
                'delivery_fees_usd', coalesce(-sum(e.usd_equiv) filter (where a.kind::text = 'revenue_delivery'), 0),
                'small_order_fees_usd', coalesce(-sum(e.usd_equiv) filter (where a.kind::text = 'revenue_small_order'), 0),
                'refunds_charged_to_goodwill_usd', coalesce(sum(e.usd_equiv) filter (where a.kind::text = 'refund_expense'), 0),
                'expenses_usd', coalesce(sum(e.usd_equiv) filter (where a.kind::text = 'expense'), 0))
              from ledger_entries e join ledger_accounts a on a.id = e.account_id where e.created_at >= b.since and e.created_at < b.until),
    'margin', gross_margin(b.since, b.until),
    'payments', (select coalesce(jsonb_object_agg(method, jsonb_build_object('count', n, 'usd', s)), '{}'::jsonb) from (
                   select py.method::text as method, count(*) as n, sum(py.amount_usd) as s from payments py
                    where py.status = 'confirmed' and coalesce(py.confirmed_at, py.created_at) >= b.since and coalesce(py.confirmed_at, py.created_at) < b.until
                    group by py.method) x),
    'riders', v_riders,
    'rider_earnings_settled_usd', (select coalesce(-sum(e.usd_equiv), 0) from ledger_entries e join ledger_accounts a on a.id = e.account_id
                                    where a.kind::text = 'rider_payable' and e.usd_equiv < 0 and e.created_at >= b.since and e.created_at < b.until),
    'credits', jsonb_build_object(
      'refunded_usd', (select coalesce(sum(amount_usd), 0) from refunds where created_at >= b.since and created_at < b.until),
      'paid_out_usd', (select coalesce(sum(amount_usd), 0) from credit_payouts where created_at >= b.since and created_at < b.until),
      'used_on_orders_usd', (select coalesce(sum(amount_usd), 0) from credit_applications where status = 'consumed' and consumed_at >= b.since and consumed_at < b.until)),
    'drawer', v_drawer || jsonb_build_object(
      'to_bank_usd', (select coalesce(sum(value_usd), 0) from hub_cash_movements where kind = 'bank_deposit' and created_at >= b.since and created_at < b.until),
      'petty_cash_usd', (select coalesce(sum(value_usd), 0) from hub_cash_movements where kind = 'petty_cash' and created_at >= b.since and created_at < b.until),
      'expenses_from_drawer_usd', (select coalesce(sum(value_usd), 0) from hub_cash_movements where kind = 'expense' and paid_from = 'hub_cash' and created_at >= b.since and created_at < b.until)),
    'stock', v_stock,
    'count', case when c.day is null then null else jsonb_build_object('counted_usd', c.counted_usd, 'counted_lbp', c.counted_lbp, 'book_usd', c.book_usd,
               'book_lbp', c.book_lbp, 'difference_usd', c.difference_usd, 'difference_lbp', c.difference_lbp, 'difference_value_usd', c.difference_value_usd,
               'note', c.note, 'closed_by', (select display_name from parties where id = c.closed_by), 'closed_at', c.closed_at) end,
    'ledger_imbalance_usd', v_imbalance,
    'unexplained_usd', round(v_imbalance + coalesce(c.difference_value_usd, 0), 2));
  return v || jsonb_build_object('balanced', (v->>'unexplained_usd')::numeric = 0 and jsonb_array_length(v_stock->'mismatches') = 0);
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
