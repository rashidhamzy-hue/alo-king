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

do $$ declare r text;
begin
  alter table hub_cash_movements enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table hub_cash_movements from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
    end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table hub_cash_movements to service_role;
    grant execute on all functions in schema public to service_role;
  end if;
end $$;
