-- Phase 1a dated tables (DECISIONS §1, §6, §20.4): exchange rate, VAT, delivery fee bands, the price
-- list, WhatsApp message rates and general config. No business number lives in code: every value below
-- is a row with an effective date, changed by inserting a newer row (admin only, audited).
-- The seed rows carry the values decided in DECISIONS.md on 7 October 2026.

create type public.price_product as enum (
  'order_fee', 'broadcast_message', 'broadcast_campaign_minimum', 'sponsored_order', 'send_home_fee'
);
create type public.message_category as enum ('marketing', 'utility', 'authentication', 'service');

create table public.exchange_rates (
  id bigint generated always as identity primary key,
  base_currency public.currency_code not null default 'USD',
  quote_currency public.currency_code not null default 'LBP',
  rate numeric(14, 4) not null check (rate > 0),
  effective_from timestamptz not null,
  source text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint exchange_rates_pair check (base_currency <> quote_currency),
  constraint exchange_rates_unique unique (base_currency, quote_currency, effective_from)
);

create table public.vat_rates (
  id bigint generated always as identity primary key,
  rate numeric(6, 5) not null check (rate >= 0 and rate < 1),
  effective_from timestamptz not null unique,
  note text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- One band set per effective_from: a fee applies up to and including max_km road kilometres.
-- Beyond the largest max_km of the set in force there is no delivery.
create table public.delivery_fee_bands (
  id bigint generated always as identity primary key,
  effective_from timestamptz not null,
  max_km numeric(5, 2) not null check (max_km > 0),
  fee_usd numeric(10, 2) not null check (fee_usd >= 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint delivery_fee_bands_unique unique (effective_from, max_km)
);

create table public.price_list (
  id bigint generated always as identity primary key,
  product public.price_product not null,
  amount_usd numeric(10, 4) not null check (amount_usd >= 0),
  rules jsonb not null default '{}' check (jsonb_typeof(rules) = 'object'),
  effective_from timestamptz not null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint price_list_unique unique (product, effective_from)
);

-- Meta's per-delivered-message rates by market and category; the cost ledger compares them with the
-- pricing category each status webhook reports (§6, §8.4).
create table public.message_rates (
  id bigint generated always as identity primary key,
  market text not null,
  category public.message_category not null,
  rate_usd numeric(10, 5) not null check (rate_usd >= 0),
  effective_from timestamptz not null,
  source text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint message_rates_unique unique (market, category, effective_from)
);

create table public.app_config (
  id bigint generated always as identity primary key,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  value jsonb not null,
  effective_from timestamptz not null,
  note text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint app_config_unique unique (key, effective_from)
);

-- Guards, audit and access, the same for every dated table.
do $$
declare
  t text;
begin
  foreach t in array array['exchange_rates', 'vat_rates', 'delivery_fee_bands', 'price_list', 'message_rates', 'app_config']
  loop
    execute format('create trigger %1$s_dated_guard before update or delete on public.%1$I
      for each row execute function app_private.dated_row_guard()', t);
    execute format('create trigger %1$s_no_truncate before truncate on public.%1$I
      for each statement execute function app_private.forbid_change()', t);
    execute format('create trigger %1$s_audit after insert or delete on public.%1$I
      for each row execute function app_private.audit_row()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, delete on table public.%I to service_role', t);
    execute format('grant select, insert, delete on table public.%I to authenticated', t);
    execute format('create policy %1$s_admin_insert on public.%1$I for insert to authenticated
      with check ((select app_private.is_admin()))', t);
    execute format('create policy %1$s_admin_delete on public.%1$I for delete to authenticated
      using ((select app_private.is_admin()))', t);
  end loop;
end;
$$;

-- Customer-facing numbers are public: exchange rate, VAT, fee bands, prices.
grant select on table public.exchange_rates, public.vat_rates, public.delivery_fee_bands, public.price_list to anon;
create policy exchange_rates_read on public.exchange_rates for select to anon, authenticated using (true);
create policy vat_rates_read on public.vat_rates for select to anon, authenticated using (true);
create policy delivery_fee_bands_read on public.delivery_fee_bands for select to anon, authenticated using (true);
create policy price_list_read on public.price_list for select to anon, authenticated using (true);
-- Internal numbers: operators only.
create policy message_rates_operator_read on public.message_rates for select to authenticated
  using ((select app_private.is_operator()));
create policy app_config_operator_read on public.app_config for select to authenticated
  using ((select app_private.is_operator()));

-- Lookups ---------------------------------------------------------------------------------------------
-- The USD to LBP rate in force at p_at. Money code locks this value on the order; it never re-reads it.
create function public.usd_lbp_rate(p_at timestamptz default now())
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rate numeric;
begin
  select r.rate into v_rate
  from public.exchange_rates r
  where r.base_currency = 'USD' and r.quote_currency = 'LBP' and r.effective_from <= p_at
  order by r.effective_from desc
  limit 1;
  if v_rate is null then
    raise exception 'no USD/LBP rate in force at %', p_at using errcode = 'no_data_found';
  end if;
  return v_rate;
end;
$$;

create function public.vat_rate(p_at timestamptz default now())
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rate numeric;
begin
  select v.rate into v_rate from public.vat_rates v where v.effective_from <= p_at order by v.effective_from desc limit 1;
  if v_rate is null then
    raise exception 'no VAT rate in force at %', p_at using errcode = 'no_data_found';
  end if;
  return v_rate;
end;
$$;

-- Delivery fee for a road distance; null means no delivery at that distance.
create function public.delivery_fee_usd(p_road_km numeric, p_at timestamptz default now())
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with band_set as (
    select max(b.effective_from) as effective_from from public.delivery_fee_bands b where b.effective_from <= p_at
  )
  select b.fee_usd
  from public.delivery_fee_bands b
  join band_set s on b.effective_from = s.effective_from
  where p_road_km >= 0 and b.max_km >= p_road_km
  order by b.max_km
  limit 1;
$$;

-- The longest delivery distance in force: the largest band.
create function public.max_delivery_km(p_at timestamptz default now())
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with band_set as (
    select max(b.effective_from) as effective_from from public.delivery_fee_bands b where b.effective_from <= p_at
  )
  select max(b.max_km) from public.delivery_fee_bands b join band_set s on b.effective_from = s.effective_from;
$$;

create function public.price_usd(p_product public.price_product, p_at timestamptz default now())
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_amount numeric;
begin
  select p.amount_usd into v_amount from public.price_list p
  where p.product = p_product and p.effective_from <= p_at
  order by p.effective_from desc limit 1;
  if v_amount is null then
    raise exception 'no price for % in force at %', p_product, p_at using errcode = 'no_data_found';
  end if;
  return v_amount;
end;
$$;

-- Server-only config reads (service role and the server's own definer functions).
create function public.config_value(p_key text, p_at timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select c.value from public.app_config c
  where c.key = p_key and c.effective_from <= p_at
  order by c.effective_from desc limit 1;
$$;

create function public.config_numeric(p_key text, p_at timestamptz default now())
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := public.config_value(p_key, p_at);
begin
  if v is null or jsonb_typeof(v) <> 'number' then
    raise exception 'config % has no numeric value in force at %', p_key, p_at using errcode = 'no_data_found';
  end if;
  return (v #>> '{}')::numeric;
end;
$$;

revoke all on function public.config_value(text, timestamptz) from public, anon, authenticated;
revoke all on function public.config_numeric(text, timestamptz) from public, anon, authenticated;
grant execute on function public.config_value(text, timestamptz) to service_role;
grant execute on function public.config_numeric(text, timestamptz) to service_role;
-- The public lookups read only public tables.
revoke all on function public.usd_lbp_rate(timestamptz) from public;
revoke all on function public.vat_rate(timestamptz) from public;
revoke all on function public.delivery_fee_usd(numeric, timestamptz) from public;
revoke all on function public.max_delivery_km(timestamptz) from public;
revoke all on function public.price_usd(public.price_product, timestamptz) from public;
grant execute on function public.usd_lbp_rate(timestamptz) to anon, authenticated, service_role;
grant execute on function public.vat_rate(timestamptz) to anon, authenticated, service_role;
grant execute on function public.delivery_fee_usd(numeric, timestamptz) to anon, authenticated, service_role;
grant execute on function public.max_delivery_km(timestamptz) to anon, authenticated, service_role;
grant execute on function public.price_usd(public.price_product, timestamptz) to anon, authenticated, service_role;

-- A vendor's delivery radius never exceeds the largest fee band in force (§1: max 10 road-km).
create function app_private.vendors_check_radius() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max numeric := public.max_delivery_km();
begin
  if new.delivery_radius_km is not null and v_max is not null and new.delivery_radius_km > v_max then
    raise exception 'delivery radius % km exceeds the % km maximum', new.delivery_radius_km, v_max
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger vendors_check_radius before insert or update of delivery_radius_km on public.vendors
  for each row execute function app_private.vendors_check_radius();

-- Seed values decided on 7 October 2026 ---------------------------------------------------------------
-- The seed rows are audited as written by the system (session setting, reset below).
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS.md, 7 October 2026', false);

insert into public.exchange_rates (rate, effective_from, source, created_by) values
  (89500, '2026-01-01 00:00+02', 'BdL official rate as recorded in DECISIONS §13; admin updates by inserting a newer row', null);

insert into public.vat_rates (rate, effective_from, note, created_by) values
  (0.11, '2026-01-01 00:00+02', 'Rate in force (DECISIONS §0 correction 6); 12% proposed, pending Parliament; lawyer confirms before the first invoice', null);

insert into public.delivery_fee_bands (effective_from, max_km, fee_usd, created_by) values
  ('2026-10-07 00:00+03', 3, 2.00, null),
  ('2026-10-07 00:00+03', 6, 3.00, null),
  ('2026-10-07 00:00+03', 10, 4.50, null);

insert into public.price_list (product, amount_usd, rules, effective_from, note, created_by) values
  ('order_fee', 1.00, '{"per": "delivered_order", "free_days": 30}', '2026-10-07 00:00+03', 'DECISIONS §1, §20.4', null),
  ('broadcast_message', 0.08, '{"per": "delivered_message"}', '2026-10-07 00:00+03', 'DECISIONS §20.4', null),
  ('broadcast_campaign_minimum', 5.00, '{"per": "campaign"}', '2026-10-07 00:00+03', 'DECISIONS §20.4', null),
  ('sponsored_order', 0.40, '{"per": "delivered_sponsored_order", "window_hours": 24}', '2026-10-07 00:00+03', 'DECISIONS §20.4', null),
  ('send_home_fee', 1.50, '{"per": "order", "paid_by": "sender", "review_after_orders": 100}', '2026-10-07 00:00+03', 'DECISIONS §20.4', null);

insert into public.message_rates (market, category, rate_usd, effective_from, source, created_by) values
  ('LB', 'marketing', 0.0392, '2026-10-01 00:00+00', 'Meta rate card 1 Oct 2026, Rest of Middle East (DECISIONS §6); confirm in WhatsApp Manager', null),
  ('LB', 'utility', 0.0091, '2026-10-01 00:00+00', 'Meta rate card 1 Oct 2026, Rest of Middle East (DECISIONS §6); confirm in WhatsApp Manager', null),
  ('LB', 'authentication', 0.0091, '2026-10-01 00:00+00', 'Meta rate card 1 Oct 2026, Rest of Middle East (DECISIONS §6); confirm in WhatsApp Manager', null),
  ('LB', 'service', 0.0091, '2026-10-01 00:00+00', 'Meta rate card 1 Oct 2026; first 1,000 service messages per number per month free (DECISIONS §6)', null);

insert into public.app_config (key, value, effective_from, note, created_by) values
  ('cod_cap_usd', '150', '2026-10-07 00:00+03', 'Cash-on-delivery cap per order (DECISIONS §1, §20.1)', null),
  ('cod_cap_new_number_usd', '50', '2026-10-07 00:00+03', 'COD cap until a number has one delivered order (DECISIONS §22.2 scenario 3)', null),
  ('free_service_messages_per_number_month', '1000', '2026-10-01 00:00+00', 'Meta free service messages (DECISIONS §6)', null),
  ('settlement_cycle_days', '14', '2026-10-07 00:00+03', 'Merchant settlement cycle (DECISIONS §20.2)', null),
  ('settlement_dispute_days', '7', '2026-10-07 00:00+03', 'Days a merchant may dispute a statement line (DECISIONS §20.2)', null),
  ('settlement_adjustment_approval_usd', '20', '2026-10-07 00:00+03', 'Adjustments above this need the admin (DECISIONS §20.2)', null),
  ('payout_account_change_freeze_hours', '72', '2026-10-07 00:00+03', 'Payout freeze after a payout account change (DECISIONS §20.2)', null),
  ('whish_float_sweep_usd', '15000', '2026-10-07 00:00+03', 'Whish balance above this sweeps to the bank (DECISIONS §20.2)', null),
  ('credit_topup_minimum_usd', '10', '2026-10-07 00:00+03', 'Minimum Alo King Credit top-up (DECISIONS §20.3)', null),
  ('credit_admin_approval_usd', '20', '2026-10-07 00:00+03', 'Admin credit above this needs the admin tap (DECISIONS §20.3)', null),
  ('credit_low_balance_alert_usd', '5', '2026-10-07 00:00+03', 'Low-credit alert threshold (DECISIONS §20.3)', null),
  ('driver_cash_limit_usd', '150', '2026-10-07 00:00+03', 'Driver cash-in-hand limit (DECISIONS §21.4)', null),
  ('send_home_reserve_share', '0.02', '2026-10-07 00:00+03', 'Share of Send Home revenue held as chargeback reserve (DECISIONS §22.4)', null);

select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);
