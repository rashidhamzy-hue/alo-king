-- Saved delivery addresses / pins and pending voice-note transcripts (flow spec item 3). Service role only.
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null,
  label text,
  village text,
  landmark text,
  lat double precision,
  lng double precision,
  addr_key text not null,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (customer_phone, addr_key)
);
create index if not exists customer_addresses_phone_idx on public.customer_addresses (customer_phone, last_used_at desc);

create table if not exists public.pending_voice (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null,
  transcript text not null,
  status text not null default 'pending' check (status in ('pending', 'used', 'rejected')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);
create index if not exists pending_voice_phone_idx on public.pending_voice (customer_phone, status);

alter table public.customer_addresses enable row level security;
alter table public.pending_voice enable row level security;
revoke all on public.customer_addresses, public.pending_voice from anon, authenticated;
