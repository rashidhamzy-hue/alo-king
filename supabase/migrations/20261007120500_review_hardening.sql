-- Hardening from the Claude review of the Phase 1a schema (PR #79).
-- 1. Dated rows cannot be backdated through the API: a past effective_from would silently change what
--    the rate, VAT, price and config lookups answer for past moments. Only direct database sessions
--    (migrations, actor `system`) may write a past date.
-- 2. A ledger idempotency key reused with different lines is an error, not a silent no-op.
-- 3. Ledger amounts carry at most 4 decimals, checked before anything is written.
-- 4. Changes to a customer's phone, login link or marketing consent are audited, and so are removal markers.
-- 5. The public rate, VAT, fee and price lookups run as the caller (security advisor).

create function app_private.dated_row_no_backdate() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.effective_from < now() - interval '5 minutes' and app_private.current_actor_kind() <> 'system' then
    raise exception '% rows cannot start in the past (effective_from %); use now or a later time', tg_table_name, new.effective_from
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['exchange_rates', 'vat_rates', 'delivery_fee_bands', 'price_list', 'message_rates', 'app_config']
  loop
    execute format('create trigger %1$s_no_backdate before insert on public.%1$I
      for each row execute function app_private.dated_row_no_backdate()', t);
  end loop;
end;
$$;

-- Ledger: fingerprint of the lines, compared when an idempotency key repeats.
alter table public.ledger_transactions add column lines_hash text;

create or replace function public.ledger_post(
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
  v_existing_hash text;
  v_hash text;
  v_rate numeric := coalesce(p_usd_lbp_rate, public.usd_lbp_rate(p_occurred_at));
  v_count integer;
  v_unbalanced text;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'ledger_post needs an array of at least two lines' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where (l ->> 'amount')::numeric <> round((l ->> 'amount')::numeric, 4)
  ) then
    raise exception 'ledger amounts carry at most 4 decimals' using errcode = 'invalid_parameter_value';
  end if;

  select encode(sha256(convert_to(string_agg(
           (l ->> 'account_id')::uuid::text || ':' || ((l ->> 'amount')::numeric(18, 4))::text, ','
           order by (l ->> 'account_id')::uuid, (l ->> 'amount')::numeric), 'UTF8')), 'hex')
    into v_hash
  from jsonb_array_elements(p_lines) l;

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
    kind, idempotency_key, occurred_at, order_id, usd_lbp_rate, reason, reverses_id, metadata, actor_kind, actor_id, lines_hash
  ) values (
    p_kind, p_idempotency_key, p_occurred_at, p_order_id, v_rate, p_reason, p_reverses_id,
    coalesce(p_metadata, '{}'), app_private.current_actor_kind(), (select auth.uid()), v_hash
  )
  on conflict (idempotency_key) do nothing
  returning id into v_tx;

  if v_tx is null then
    select t.id, t.kind, t.lines_hash into v_tx, v_existing, v_existing_hash
    from public.ledger_transactions t where t.idempotency_key = p_idempotency_key;
    if v_existing <> p_kind then
      raise exception 'idempotency key % was already used for a % transaction', p_idempotency_key, v_existing
        using errcode = 'unique_violation';
    end if;
    if v_existing_hash is not null and v_existing_hash <> v_hash then
      raise exception 'idempotency key % was already used with different lines', p_idempotency_key
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
revoke all on function public.ledger_post(public.ledger_tx_kind, text, jsonb, uuid, numeric, text, jsonb, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.ledger_post(public.ledger_tx_kind, text, jsonb, uuid, numeric, text, jsonb, timestamptz, uuid) to service_role;

-- Audit: identity and consent columns of customers (not every inbound timestamp), and removal markers.
create trigger customers_audit_identity
  after update of phone_e164, user_id, marketing_opt_in, marketing_opt_in_at, marketing_opt_out_at, blocked_until
  on public.customers
  for each row execute function app_private.audit_row();
create trigger customers_audit_insert_delete after insert or delete on public.customers
  for each row execute function app_private.audit_row();
create trigger vendor_removed_places_audit after insert or update or delete on public.vendor_removed_places
  for each row execute function app_private.audit_row();

-- The public lookups read only tables anyone may read, so they run as the caller (Supabase security
-- advisor lint 0028/0029: no security-definer function callable without need).
alter function public.usd_lbp_rate(timestamptz) security invoker;
alter function public.vat_rate(timestamptz) security invoker;
alter function public.delivery_fee_usd(numeric, timestamptz) security invoker;
alter function public.max_delivery_km(timestamptz) security invoker;
alter function public.price_usd(public.price_product, timestamptz) security invoker;
