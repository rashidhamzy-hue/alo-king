
alter table public.customers
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists opted_in_at timestamptz,
  add column if not exists opted_out_at timestamptz,
  add column if not exists village text,
  add column if not exists last_lat numeric,
  add column if not exists last_lng numeric,
  add column if not exists last_address text;

create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null, vendor_id text not null, items jsonb not null,
  subtotal_usd numeric(10,2) not null, delivery_fee_usd numeric(10,2) not null, total_usd numeric(10,2) not null,
  village text, address text, notes text,
  status text not null default 'pending' check (status in ('pending','confirmed','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '20 minutes');
create index if not exists carts_phone_idx on public.carts(customer_phone, created_at desc);

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  vendor_id text not null, owner_phone text not null, message text not null, target_village text,
  audience_count int not null, cost_usd numeric(10,2) not null,
  status text not null default 'pending_confirm' check (status in ('pending_confirm','sending','sent','cancelled','failed')),
  sent_count int not null default 0, failed_count int not null default 0,
  created_at timestamptz not null default now(), confirmed_at timestamptz);

create table if not exists public.admin_actions (
  id bigint generated always as identity primary key,
  vendor_id text not null, owner_phone text not null, action text not null, target text,
  before jsonb, after jsonb, undone boolean not null default false,
  created_at timestamptz not null default now());
create index if not exists admin_actions_vendor_idx on public.admin_actions(vendor_id, created_at desc);

create table if not exists public.owner_link_codes (
  code text primary key, vendor_id text not null, created_by uuid,
  expires_at timestamptz not null default now() + interval '30 minutes', used_at timestamptz);
create table if not exists public.selftest_tokens (
  token text primary key, expires_at timestamptz not null default now() + interval '30 minutes');

alter table public.carts enable row level security;
alter table public.broadcasts enable row level security;
alter table public.admin_actions enable row level security;
alter table public.owner_link_codes enable row level security;
alter table public.selftest_tokens enable row level security;
