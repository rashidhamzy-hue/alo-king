-- Human handoff: while customers.handoff_until is in the future the bot stays silent for that customer and forwards their messages to the admin.
-- handoff_log maps each message we send the admin to its customer, so the admin's reply (WhatsApp "reply") can be relayed. Service role only.
alter table public.customers add column if not exists handoff_until timestamptz;
create table if not exists public.handoff_log (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null,
  admin_message_id text not null unique,
  kind text not null check (kind in ('request', 'forward')),
  created_at timestamptz not null default now()
);
create index if not exists handoff_log_phone_idx on public.handoff_log (customer_phone, created_at desc);
alter table public.handoff_log enable row level security;
revoke all on public.handoff_log from anon, authenticated;
