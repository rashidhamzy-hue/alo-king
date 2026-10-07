-- Phase 1a ledger (DECISIONS §3, §20): one append-only double-entry ledger for every money movement:
-- customer payments, refunds, COD cash, fees, settlements, merchant credit, paid tools, reserves, VAT.
--
-- * An entry's amount is signed: positive = debit, negative = credit. Each transaction balances to zero
--   per currency, checked when the posting function runs and again at commit.
-- * Every entry records the USD/LBP rate locked for it (the order's rate when it belongs to an order) and
--   carries both the USD and the LBP value (§13).
-- * Nothing is ever updated or deleted. A mistake is corrected by a reversal transaction.
-- * Balances are views over the entries, never stored (§20.3).
-- * Only the security-definer functions below write. The service role can read but not insert directly.
-- The `orders` table arrives in Phase 2; `order_id` gets its foreign key then.

create type public.ledger_account_kind as enum (
  -- assets
  'platform_whish', 'platform_tap', 'platform_bank', 'driver_cash', 'partner_cod_receivable', 'money_incident',
  -- liabilities
  'merchant_payable', 'merchant_credit', 'merchant_credit_reserved', 'customer_refund_payable',
  'send_home_reserve', 'vat_payable',
  -- revenue
  'revenue_order_fee', 'revenue_delivery_fee', 'revenue_paid_tools', 'revenue_send_home_fee',
  -- expenses
  'expense_refunds', 'expense_partner_delivery', 'expense_payment_fees', 'expense_driver_pay'
);

create type public.ledger_tx_kind as enum (
  'customer_payment', 'refund', 'cod_collected', 'cod_deposited', 'order_fee', 'delivery_fee',
  'settlement_payout', 'credit_topup', 'credit_reserve', 'credit_release', 'broadcast_charge',
  'sponsored_charge', 'credit_refund', 'admin_adjustment', 'send_home_fee', 'gateway_fee',
  'reserve_hold', 'reserve_release', 'driver_pay', 'vat', 'reversal'
);

-- Debit-normal kinds (assets and expenses) show their balance as debits minus credits; the rest as
-- credits minus debits.
create function app_private.ledger_kind_is_debit_normal(p_kind public.ledger_account_kind) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_kind in (
    'platform_whish', 'platform_tap', 'platform_bank', 'driver_cash', 'partner_cod_receivable', 'money_incident',
    'expense_refunds', 'expense_partner_delivery', 'expense_payment_fees', 'expense_driver_pay'
  );
$$;

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  kind public.ledger_account_kind not null,
  currency public.currency_code not null,
  vendor_id uuid references public.vendors (id) on delete restrict,
  -- Driver or partner identifier until their tables exist (Phase 5).
  external_ref text,
  created_at timestamptz not null default now(),
  constraint ledger_accounts_unique unique nulls not distinct (kind, currency, vendor_id, external_ref),
  constraint ledger_accounts_vendor_kinds check (
    (kind in ('merchant_payable', 'merchant_credit', 'merchant_credit_reserved')) = (vendor_id is not null)
  ),
  constraint ledger_accounts_external_kinds check (
    (kind in ('driver_cash', 'partner_cod_receivable')) = (external_ref is not null)
  )
);

create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  kind public.ledger_tx_kind not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  occurred_at timestamptz not null default now(),
  posted_at timestamptz not null default now(),
  order_id uuid,
  usd_lbp_rate numeric(14, 4) not null check (usd_lbp_rate > 0),
  reason text,
  reverses_id uuid unique references public.ledger_transactions (id) on delete restrict,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  actor_kind public.actor_kind not null,
  actor_id uuid,
  constraint ledger_transactions_reason_required check (
    kind not in ('admin_adjustment', 'reversal') or char_length(coalesce(reason, '')) >= 3
  ),
  constraint ledger_transactions_reversal_link check ((kind = 'reversal') = (reverses_id is not null))
);
create index ledger_transactions_order_idx on public.ledger_transactions (order_id) where order_id is not null;
create index ledger_transactions_occurred_idx on public.ledger_transactions (occurred_at);

create table public.ledger_entries (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.ledger_transactions (id) on delete restrict,
  account_id uuid not null references public.ledger_accounts (id) on delete restrict,
  currency public.currency_code not null,
  amount numeric(18, 4) not null check (amount <> 0),
  usd_lbp_rate numeric(14, 4) not null check (usd_lbp_rate > 0),
  amount_usd numeric(18, 4) generated always as (
    case when currency = 'USD' then amount else round(amount / usd_lbp_rate, 4) end
  ) stored,
  amount_lbp numeric(20, 0) generated always as (
    case when currency = 'LBP' then round(amount, 0) else round(amount * usd_lbp_rate, 0) end
  ) stored,
  memo text
);
create index ledger_entries_tx_idx on public.ledger_entries (transaction_id);
create index ledger_entries_account_idx on public.ledger_entries (account_id, id);

-- Append-only, including TRUNCATE.
create trigger ledger_accounts_append_only before update or delete on public.ledger_accounts
  for each row execute function app_private.forbid_change();
create trigger ledger_transactions_append_only before update or delete on public.ledger_transactions
  for each row execute function app_private.forbid_change();
create trigger ledger_entries_append_only before update or delete on public.ledger_entries
  for each row execute function app_private.forbid_change();
create trigger ledger_accounts_no_truncate before truncate on public.ledger_accounts
  for each statement execute function app_private.forbid_change();
create trigger ledger_transactions_no_truncate before truncate on public.ledger_transactions
  for each statement execute function app_private.forbid_change();
create trigger ledger_entries_no_truncate before truncate on public.ledger_entries
  for each statement execute function app_private.forbid_change();

-- Every entry matches its account's currency.
create function app_private.ledger_entry_check() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.ledger_accounts a where a.id = new.account_id and a.currency = new.currency) then
    raise exception 'ledger entry currency % does not match its account', new.currency using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger ledger_entries_check before insert on public.ledger_entries
  for each row execute function app_private.ledger_entry_check();

-- At commit: every transaction touched has at least two entries and sums to zero in each currency.
create function app_private.ledger_balance_check() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bad text;
begin
  select string_agg(s.currency::text || ' ' || s.total::text, ', ') into v_bad
  from (
    select le.currency, sum(le.amount) as total
    from public.ledger_entries le
    where le.transaction_id = new.transaction_id
    group by le.currency
  ) s
  where s.total <> 0;
  if v_bad is not null then
    raise exception 'ledger transaction % does not balance: %', new.transaction_id, v_bad using errcode = 'check_violation';
  end if;
  if (select count(*) from public.ledger_entries le where le.transaction_id = new.transaction_id) < 2 then
    raise exception 'ledger transaction % needs at least two entries', new.transaction_id using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
create constraint trigger ledger_entries_balanced after insert on public.ledger_entries
  deferrable initially deferred
  for each row execute function app_private.ledger_balance_check();

-- Posting -----------------------------------------------------------------------------------------------
-- Get or create the account for (kind, currency, vendor, external ref).
create function public.ledger_account(
  p_kind public.ledger_account_kind,
  p_currency public.currency_code,
  p_vendor_id uuid default null,
  p_external_ref text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.ledger_accounts (kind, currency, vendor_id, external_ref)
  values (p_kind, p_currency, p_vendor_id, p_external_ref)
  on conflict on constraint ledger_accounts_unique do nothing
  returning id into v_id;
  if v_id is null then
    select a.id into v_id from public.ledger_accounts a
    where a.kind = p_kind and a.currency = p_currency
      and a.vendor_id is not distinct from p_vendor_id
      and a.external_ref is not distinct from p_external_ref;
  end if;
  return v_id;
end;
$$;

-- Post one balanced transaction. p_lines: [{"account_id": uuid, "amount": number|string, "memo": text}].
-- Idempotent on p_idempotency_key: a repeat returns the first transaction's id and writes nothing.
-- p_usd_lbp_rate is the rate locked on the order; without it the rate in force at p_occurred_at is used.
create function public.ledger_post(
  p_kind public.ledger_tx_kind,
  p_idempotency_key text,
  p_lines jsonb,
  p_order_id uuid default null,
  p_usd_lbp_rate numeric default null,
  p_reason text default null,
  p_metadata jsonb default '{}',
  p_occurred_at timestamptz default now(),
  p_reverses_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx uuid;
  v_existing public.ledger_tx_kind;
  v_rate numeric := coalesce(p_usd_lbp_rate, public.usd_lbp_rate(p_occurred_at));
  v_count integer;
  v_unbalanced text;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'ledger_post needs an array of at least two lines' using errcode = 'invalid_parameter_value';
  end if;

  -- Fail fast with a clear message; the deferred trigger re-checks at commit.
  select string_agg(currency::text || ' ' || total::text, ', ') into v_unbalanced
  from (
    select a.currency, sum((l ->> 'amount')::numeric) as total
    from jsonb_array_elements(p_lines) l
    join public.ledger_accounts a on a.id = (l ->> 'account_id')::uuid
    group by a.currency
  ) s
  where total <> 0;
  if v_unbalanced is not null then
    raise exception 'ledger_post lines do not balance: %', v_unbalanced using errcode = 'check_violation';
  end if;

  insert into public.ledger_transactions (
    kind, idempotency_key, occurred_at, order_id, usd_lbp_rate, reason, reverses_id, metadata, actor_kind, actor_id
  ) values (
    p_kind, p_idempotency_key, p_occurred_at, p_order_id, v_rate, p_reason, p_reverses_id,
    coalesce(p_metadata, '{}'), app_private.current_actor_kind(), (select auth.uid())
  )
  on conflict (idempotency_key) do nothing
  returning id into v_tx;

  if v_tx is null then
    select t.id, t.kind into v_tx, v_existing from public.ledger_transactions t where t.idempotency_key = p_idempotency_key;
    if v_existing <> p_kind then
      raise exception 'idempotency key % was already used for a % transaction', p_idempotency_key, v_existing
        using errcode = 'unique_violation';
    end if;
    return v_tx;
  end if;

  -- One statement for all lines, so the balance check passes even when constraints run immediately.
  insert into public.ledger_entries (transaction_id, account_id, currency, amount, usd_lbp_rate, memo)
  select v_tx, a.id, a.currency, (l ->> 'amount')::numeric, v_rate, l ->> 'memo'
  from jsonb_array_elements(p_lines) l
  join public.ledger_accounts a on a.id = (l ->> 'account_id')::uuid;
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_lines) then
    raise exception 'ledger_post refers to an account that does not exist' using errcode = 'foreign_key_violation';
  end if;

  return v_tx;
end;
$$;

-- Reverse a transaction exactly once, at its original rate.
create function public.ledger_reverse(p_transaction_id uuid, p_idempotency_key text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orig public.ledger_transactions;
  v_lines jsonb;
begin
  select * into v_orig from public.ledger_transactions t where t.id = p_transaction_id;
  if not found then
    raise exception 'ledger transaction % does not exist', p_transaction_id using errcode = 'no_data_found';
  end if;
  if v_orig.kind = 'reversal' then
    raise exception 'a reversal cannot be reversed; post a new transaction' using errcode = 'invalid_parameter_value';
  end if;
  select jsonb_agg(jsonb_build_object('account_id', e.account_id, 'amount', -e.amount, 'memo', 'reversal of entry ' || e.id))
    into v_lines
  from public.ledger_entries e where e.transaction_id = p_transaction_id;
  return public.ledger_post(
    'reversal', p_idempotency_key, v_lines, v_orig.order_id, v_orig.usd_lbp_rate, p_reason,
    jsonb_build_object('reverses_kind', v_orig.kind), now(), p_transaction_id
  );
end;
$$;

revoke all on function public.ledger_account(public.ledger_account_kind, public.currency_code, uuid, text) from public, anon, authenticated;
revoke all on function public.ledger_post(public.ledger_tx_kind, text, jsonb, uuid, numeric, text, jsonb, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.ledger_reverse(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ledger_account(public.ledger_account_kind, public.currency_code, uuid, text) to service_role;
grant execute on function public.ledger_post(public.ledger_tx_kind, text, jsonb, uuid, numeric, text, jsonb, timestamptz, uuid) to service_role;
grant execute on function public.ledger_reverse(uuid, text, text) to service_role;

-- Balances ----------------------------------------------------------------------------------------------
create view public.ledger_account_balances with (security_invoker = true) as
select
  a.id as account_id,
  a.kind,
  a.currency,
  a.vendor_id,
  a.external_ref,
  coalesce(sum(e.amount), 0) as debits_minus_credits,
  case when app_private.ledger_kind_is_debit_normal(a.kind) then coalesce(sum(e.amount), 0)
       else -coalesce(sum(e.amount), 0) end as balance,
  count(e.id) as entry_count,
  max(e.id) as last_entry_id
from public.ledger_accounts a
left join public.ledger_entries e on e.account_id = a.id
group by a.id;

-- Alo King Credit per merchant (§20.3): available and reserved for running campaigns.
create view public.merchant_credit_balances with (security_invoker = true) as
select
  b.vendor_id,
  b.currency,
  coalesce(sum(b.balance) filter (where b.kind = 'merchant_credit'), 0) as available,
  coalesce(sum(b.balance) filter (where b.kind = 'merchant_credit_reserved'), 0) as reserved
from public.ledger_account_balances b
where b.kind in ('merchant_credit', 'merchant_credit_reserved')
group by b.vendor_id, b.currency;

-- Row-level security: operators read everything; a merchant's owner and manager read their own vendor's
-- accounts, entries and transactions. Cashier and kitchen staff see no money.
create function app_private.can_read_ledger_account(p_account_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_operator() or exists (
    select 1 from public.ledger_accounts a
    where a.id = p_account_id and a.vendor_id is not null
      and app_private.has_vendor_role(a.vendor_id, array['owner', 'manager']::public.member_role[])
  );
$$;

create function app_private.can_read_ledger_transaction(p_transaction_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_operator() or exists (
    select 1 from public.ledger_entries e
    join public.ledger_accounts a on a.id = e.account_id
    where e.transaction_id = p_transaction_id and a.vendor_id is not null
      and app_private.has_vendor_role(a.vendor_id, array['owner', 'manager']::public.member_role[])
  );
$$;
revoke all on function app_private.can_read_ledger_account(uuid) from public;
revoke all on function app_private.can_read_ledger_transaction(uuid) from public;
grant execute on function app_private.can_read_ledger_account(uuid) to authenticated, service_role;
grant execute on function app_private.can_read_ledger_transaction(uuid) to authenticated, service_role;

alter table public.ledger_accounts enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_entries enable row level security;
revoke all on table public.ledger_accounts, public.ledger_transactions, public.ledger_entries from public, anon, authenticated, service_role;
revoke all on table public.ledger_account_balances, public.merchant_credit_balances from public, anon, authenticated, service_role;
grant select on table public.ledger_accounts, public.ledger_transactions, public.ledger_entries to authenticated, service_role;
grant select on table public.ledger_account_balances, public.merchant_credit_balances to authenticated, service_role;

create policy ledger_accounts_read on public.ledger_accounts for select to authenticated
  using (app_private.can_read_ledger_account(id));
create policy ledger_entries_read on public.ledger_entries for select to authenticated
  using (app_private.can_read_ledger_account(account_id));
create policy ledger_transactions_read on public.ledger_transactions for select to authenticated
  using (app_private.can_read_ledger_transaction(id));
