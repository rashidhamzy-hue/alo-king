-- Phase 1a foundation (DECISIONS §3, §7.1, §10): extensions, the private helper schema, shared enums,
-- the updated_at and append-only guards, and the audit log.
--
-- Conventions for every later migration:
--   * Every table enables row-level security and starts from `revoke all ... from anon, authenticated`,
--     then grants exactly what the policies allow. Supabase's default grants are never relied on.
--   * Helpers used by policies live in `app_private`, which PostgREST does not expose.
--   * Security-definer RPCs in `public` are revoked from public, anon and authenticated and granted to
--     service_role unless they check the caller themselves.

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to anon, authenticated, service_role;

-- Shared enums ----------------------------------------------------------------------------------------
create type public.currency_code as enum ('USD', 'LBP');
-- Arabizi is a language preference of its own: replies in Latin-script Lebanese Arabic.
create type public.lang_code as enum ('ar', 'en', 'fr', 'arabizi');
create type public.operator_role as enum ('admin', 'operator');
create type public.member_role as enum ('owner', 'manager', 'cashier', 'kitchen');
create type public.actor_kind as enum ('user', 'operator', 'service', 'system', 'whatsapp', 'ai');

-- Generic triggers --------------------------------------------------------------------------------------
create function app_private.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Append-only tables (audit log, ledger) reject every update and delete, for every role.
create function app_private.forbid_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

-- Dated tables (rates, VAT, fee bands, prices, config): rows in force are never edited or deleted;
-- a change is a new row with a later effective_from. A row not yet in force may be withdrawn.
create function app_private.dated_row_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '% rows are never edited; insert a new row with a later effective_from', tg_table_name
      using errcode = 'insufficient_privilege';
  end if;
  if old.effective_from <= now() then
    raise exception '% row % is already in force and cannot be deleted', tg_table_name, old.id
      using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

-- Audit log ---------------------------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_kind public.actor_kind not null,
  actor_id uuid,
  action text not null,
  table_name text not null,
  row_id text,
  old_row jsonb,
  new_row jsonb,
  reason text
);
create index audit_log_table_row_idx on public.audit_log (table_name, row_id, at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc) where actor_id is not null;

create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function app_private.forbid_change();
-- TRUNCATE skips row triggers, so it gets its own statement trigger.
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app_private.forbid_change();

alter table public.audit_log enable row level security;
revoke all on table public.audit_log from public, anon, authenticated;
grant select on table public.audit_log to authenticated;
grant select, insert on table public.audit_log to service_role;

-- Who is acting. Server code that acts for someone else sets `app.actor_kind` (and optionally
-- `app.audit_reason`) with set_config(..., true) inside its transaction.
create function app_private.current_actor_kind() returns public.actor_kind
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('app.actor_kind', true), '')::public.actor_kind,
    case
      when (select auth.uid()) is not null then 'user'::public.actor_kind
      when coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
        then 'service'::public.actor_kind
      else 'system'::public.actor_kind
    end
  );
$$;

-- Row-level audit trigger: one row per insert, update or delete on audited tables.
create function app_private.audit_row() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  insert into public.audit_log (actor_kind, actor_id, action, table_name, row_id, old_row, new_row, reason)
  values (
    app_private.current_actor_kind(),
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'vendor_id', v_old ->> 'vendor_id', v_new ->> 'user_id', v_old ->> 'user_id'),
    v_old,
    v_new,
    nullif(current_setting('app.audit_reason', true), '')
  );
  return coalesce(new, old);
end;
$$;
revoke all on function app_private.audit_row() from public;
