-- Alo King Chouf, session D2 (console): the hub's own money, and the day close.
--
-- 3.15 Petty cash and bank deposits. Two more ledger movements out of the hub drawer (hub_cash): cash taken to the bank, with
--      the slip's reference and photo, and petty cash spent, with a reason and the name of who spent it or was paid.
-- 3.12 Expenses (paid from the drawer or the bank) beside them, so hub cash reconciles to the bank; the receiving form is the
--      console's page on receive_goods (0024).
-- 3.11 The day-close report and the counted drawer.
-- Every movement is one balanced ledger transaction and one row in hub_cash_movements, made only by these functions.
-- The hub drawer holds dollars and lira; each currency leaves at the value it is carried at, as a rider's drop does (0004).

alter type account_kind add value if not exists 'bank';
alter type account_kind add value if not exists 'expense';

create table hub_cash_movements (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('bank_deposit', 'petty_cash', 'expense')),
  usd         numeric(12,2) not null default 0 check (usd >= 0),
  lbp         numeric(16,2) not null default 0 check (lbp >= 0),
  value_usd   numeric(12,2) not null,                -- what left the account, at the value it was carried at
  paid_from   text not null check (paid_from in ('hub_cash', 'bank')),
  category    text,                                  -- expenses and petty cash: what it was for (settings.hub_expenses.categories)
  reason      text not null,
  payee       text,                                  -- petty cash: who spent it or was paid; expenses: who was paid
  reference   text,                                  -- bank slip, invoice or receipt number
  media_path  text,                                  -- slip or receipt photo, private media bucket
  by_party    uuid not null references parties(id),
  request_key text unique,
  ledger_txn  uuid not null,
  created_at  timestamptz not null default now(),
  check (usd > 0 or lbp > 0)
);
create index hub_cash_movements_day on hub_cash_movements(created_at);

insert into settings(key, value) values ('hub_expenses', '{"categories": ["fuel", "rent", "utilities", "supplies", "repairs", "packaging", "fees", "other"]}')
  on conflict (key) do nothing;

-- The drawer as the books have it: notes per currency, and the dollar value the lira are carried at.
create or replace function account_native(p_code text)
returns table (usd numeric, lbp numeric, lbp_carried_usd numeric) language sql stable as $$
  select coalesce(sum(e.amount) filter (where e.currency = 'USD'), 0),
         coalesce(sum(e.amount) filter (where e.currency = 'LBP'), 0),
         coalesce(sum(e.usd_equiv) filter (where e.currency = 'LBP'), 0)
  from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = p_code $$;

-- One movement out of the drawer (or the bank): dollars and lira each leave their own balance; never more than is there.
create or replace function hub_money_out(p_kind text, p_usd numeric, p_lbp numeric, p_from text, p_to_code text, p_to_kind text,
                                         p_category text, p_reason text, p_payee text, p_ref text, p_media text, p_by uuid, p_key text)
returns jsonb language plpgsql as $$
declare m hub_cash_movements%rowtype; n record; v_txn uuid := gen_random_uuid(); v_usd numeric := round(coalesce(p_usd, 0), 2);
        v_lbp numeric := round(coalesce(p_lbp, 0), 0); v_lbp_value numeric := 0; v_from uuid; v_to uuid; v_memo text;
begin
  if p_key is not null then
    select * into m from hub_cash_movements where request_key = p_key;
    if found then return jsonb_build_object('ok', true, 'duplicate', true, 'id', m.id, 'value_usd', m.value_usd); end if;
  end if;
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if v_usd < 0 or v_lbp < 0 or (v_usd = 0 and v_lbp = 0) then raise exception 'BAD_AMOUNT'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hub_money:' || p_from, 0));
  select * into n from account_native(p_from);
  if v_usd > n.usd + 0.005 or v_lbp > n.lbp + 0.5 then raise exception 'NOT_ENOUGH_CASH % holds % USD and % LBP', p_from, n.usd, n.lbp; end if;
  if v_lbp > 0 then
    v_lbp_value := case when n.lbp > 0 then round(v_lbp * n.lbp_carried_usd / n.lbp, 2) else round(v_lbp / current_fx(), 2) end;
  end if;
  v_from := ensure_account(p_from, p_from::account_kind);
  v_to := ensure_account(p_to_code, p_to_kind::account_kind);
  v_memo := initcap(replace(p_kind, '_', ' ')) || ': ' || btrim(p_reason);
  if v_usd > 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
      (v_txn, v_from, -v_usd, 'USD', -v_usd, v_memo), (v_txn, v_to, v_usd, 'USD', v_usd, v_memo);
  end if;
  if v_lbp > 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
      (v_txn, v_from, -v_lbp, 'LBP', -v_lbp_value, v_memo), (v_txn, v_to, v_lbp, 'LBP', v_lbp_value, v_memo);
  end if;
  insert into hub_cash_movements(kind, usd, lbp, value_usd, paid_from, category, reason, payee, reference, media_path, by_party, request_key, ledger_txn)
    values (p_kind, v_usd, v_lbp, v_usd + v_lbp_value, p_from, p_category, btrim(p_reason), nullif(btrim(p_payee), ''), nullif(btrim(p_ref), ''),
            nullif(btrim(p_media), ''), p_by, p_key, v_txn) returning * into m;
  select * into n from account_native('hub_cash');
  return jsonb_build_object('ok', true, 'duplicate', false, 'id', m.id, 'value_usd', m.value_usd, 'drawer_usd', n.usd, 'drawer_lbp', n.lbp);
end $$;

-- 3.15: cash taken to the bank. The slip's reference is required; its photo is kept when there is one.
create or replace function record_bank_deposit(p_usd numeric, p_lbp numeric, p_by uuid, p_slip_ref text, p_slip_path text default null, p_key text default null)
returns jsonb language plpgsql as $$
begin
  if length(btrim(coalesce(p_slip_ref, ''))) < 3 then raise exception 'REFERENCE_REQUIRED'; end if;
  if exists (select 1 from hub_cash_movements where kind = 'bank_deposit' and reference = btrim(p_slip_ref)
                and (p_key is null or request_key is distinct from p_key)) then
    raise exception 'SLIP_ALREADY_USED';
  end if;
  return hub_money_out('bank_deposit', p_usd, p_lbp, 'hub_cash', 'bank', 'bank', null, 'Deposit slip ' || btrim(p_slip_ref), null, p_slip_ref, p_slip_path, p_by, p_key);
end $$;

-- 3.15: petty cash spent from the drawer, with a reason and a name.
create or replace function record_petty_cash(p_usd numeric, p_lbp numeric, p_reason text, p_name text, p_by uuid,
                                             p_receipt_path text default null, p_key text default null)
returns jsonb language plpgsql as $$
begin
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'NAME_REQUIRED'; end if;
  return hub_money_out('petty_cash', p_usd, p_lbp, 'hub_cash', 'expense:petty_cash', 'expense', 'petty_cash', p_reason, p_name, null, p_receipt_path, p_by, p_key);
end $$;

-- 3.12: an expense, paid from the drawer or from the bank, in one of settings.hub_expenses.categories.
create or replace function record_expense(p_category text, p_usd numeric, p_lbp numeric, p_paid_from text, p_reason text, p_payee text, p_by uuid,
                                          p_reference text default null, p_receipt_path text default null, p_key text default null)
returns jsonb language plpgsql as $$
begin
  if p_paid_from not in ('hub_cash', 'bank') then raise exception 'UNKNOWN_PAYMENT %', p_paid_from; end if;
  if p_category is null or p_category = 'petty_cash'
     or not coalesce(setting('hub_expenses')->'categories', '[]'::jsonb) ? p_category then raise exception 'UNKNOWN_CATEGORY %', p_category; end if;
  return hub_money_out('expense', p_usd, p_lbp, p_paid_from, 'expense:' || p_category, 'expense', p_category, p_reason, p_payee, p_reference,
                       p_receipt_path, p_by, p_key);
end $$;

-- The drawer now, and its movements over a period, for the console.
create or replace function hub_cash_view(p_since timestamptz, p_until timestamptz default now()) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'drawer', (select jsonb_build_object('usd', n.usd, 'lbp', n.lbp, 'lbp_carried_usd', n.lbp_carried_usd) from account_native('hub_cash') n),
    'bank', (select jsonb_build_object('usd', n.usd, 'lbp', n.lbp, 'lbp_carried_usd', n.lbp_carried_usd) from account_native('bank') n),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'usd', m.usd, 'lbp', m.lbp, 'value_usd', m.value_usd,
                   'paid_from', m.paid_from, 'category', m.category, 'reason', m.reason, 'payee', m.payee, 'reference', m.reference,
                   'media_path', m.media_path, 'by', p.display_name, 'at', m.created_at) order by m.created_at desc)
                 from hub_cash_movements m join parties p on p.id = m.by_party
                where m.created_at >= p_since and m.created_at < p_until), '[]'::jsonb)) $$;

-- ---------- 3.11 the day close ----------
-- A day is a calendar day in the hub's time zone (settings.hours.tz). Probe orders (0063) are counted apart, never as sales.
create table day_closes (
  day                  date primary key,
  counted_usd          numeric(12,2) not null,
  counted_lbp          numeric(16,2) not null,
  book_usd             numeric(12,2) not null,
  book_lbp             numeric(16,2) not null,
  difference_usd       numeric(12,2) not null,
  difference_lbp       numeric(16,2) not null,
  difference_value_usd numeric(12,2) not null,      -- the drawer's difference in dollars: posted to cash_over_short, never hidden
  note                 text,
  report               jsonb not null,
  ledger_txn           uuid,
  closed_by            uuid not null references parties(id),
  closed_at            timestamptz not null default now()
);

create or replace function hub_day_bounds(p_day date) returns table (since timestamptz, until timestamptz) language sql stable as $$
  select (p_day::timestamp at time zone tz), ((p_day + 1)::timestamp at time zone tz)
    from (select coalesce(setting('hours')->>'tz', 'Asia/Beirut') as tz) z $$;

create or replace function hub_today() returns date language sql stable as
$$ select (now() at time zone coalesce(setting('hours')->>'tz', 'Asia/Beirut'))::date $$;

-- The day's figures. Every number comes from the ledger, the orders, the payments and the stock movements of that day.
-- unexplained_usd must be zero: the ledger's own imbalance over the day plus the drawer's counted difference (once counted).
-- stock: units picked off the shelf against the units on those orders' lines; a mismatch is listed, order by order.
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

  select coalesce(jsonb_agg(jsonb_build_object('rider', p.display_name, 'usd', n.usd, 'lbp', n.lbp,
           'earnings_usd', (rider_statement(p.id)->>'earnings_usd')::numeric) order by p.display_name), '[]'::jsonb)
    into v_riders
    from parties p cross join lateral driver_cash_native(p.id) n
   where p.role = 'driver' and (n.usd <> 0 or n.lbp <> 0 or (rider_statement(p.id)->>'earnings_usd')::numeric <> 0
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

-- The ops lead counts the drawer at the end of the day. A difference is posted to cash_over_short (so the books match the drawer
-- from then on) and stays on the report as unexplained, with the note the person must write. One close per day.
create or replace function close_day(p_day date, p_counted_usd numeric, p_counted_lbp numeric, p_by uuid, p_note text default null)
returns jsonb language plpgsql as $$
declare c day_closes%rowtype; n record; v_du numeric; v_dl numeric; v_dl_value numeric := 0; v_txn uuid; v_drawer uuid; v_os uuid;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_day is null or p_day > hub_today() then raise exception 'DAY_NOT_OVER'; end if;
  if p_counted_usd is null or p_counted_usd < 0 or p_counted_lbp is null or p_counted_lbp < 0 then raise exception 'BAD_COUNT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hub_money:hub_cash', 0));
  select * into c from day_closes where day = p_day;
  if found then return jsonb_build_object('ok', true, 'already', true, 'report', day_close_report(p_day)); end if;
  select * into n from account_native('hub_cash');
  v_du := round(p_counted_usd - n.usd, 2);
  v_dl := round(p_counted_lbp - n.lbp, 0);
  if (v_du <> 0 or v_dl <> 0) and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'DIFFERENCE_NOTE_REQUIRED'; end if;
  if v_dl <> 0 then
    v_dl_value := case when v_dl < 0 and n.lbp > 0 then round(v_dl * n.lbp_carried_usd / n.lbp, 2) else round(v_dl / current_fx(), 2) end;
  end if;
  if v_du <> 0 or v_dl <> 0 then
    v_txn := gen_random_uuid();
    v_drawer := ensure_account('hub_cash', 'hub_cash');
    v_os := ensure_account('cash_over_short', 'cash_over_short');
    if v_du <> 0 then
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
        (v_txn, v_drawer, v_du, 'USD', v_du, 'Drawer counted at day close ' || p_day), (v_txn, v_os, -v_du, 'USD', -v_du, 'Drawer counted at day close ' || p_day);
    end if;
    if v_dl <> 0 then
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
        (v_txn, v_drawer, v_dl, 'LBP', v_dl_value, 'Drawer counted at day close ' || p_day), (v_txn, v_os, -v_dl, 'LBP', -v_dl_value, 'Drawer counted at day close ' || p_day);
    end if;
  end if;
  insert into day_closes(day, counted_usd, counted_lbp, book_usd, book_lbp, difference_usd, difference_lbp, difference_value_usd, note, report, ledger_txn, closed_by)
    values (p_day, p_counted_usd, p_counted_lbp, n.usd, n.lbp, v_du, v_dl, v_du + v_dl_value, nullif(btrim(p_note), ''), '{}', v_txn, p_by);
  update day_closes set report = day_close_report(p_day) where day = p_day;
  return jsonb_build_object('ok', true, 'already', false, 'difference_usd', v_du, 'difference_lbp', v_dl, 'report', day_close_report(p_day));
end $$;

do $$ declare r text;
begin
  alter table hub_cash_movements enable row level security;
  alter table day_closes enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table hub_cash_movements, day_closes from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
    end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table hub_cash_movements, day_closes to service_role;
    grant execute on all functions in schema public to service_role;
  end if;
end $$;
