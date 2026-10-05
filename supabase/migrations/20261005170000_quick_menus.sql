-- Numbered quick-order (flow spec item 4): which dishes the numbers on the customer's screen refer to. One row per customer, replaced on every list shown.
-- Holds a phone number and dish ids only (no names, prices or addresses). Service role only; rows expire after 20 minutes and are deleted with "delete my data".
create table if not exists public.quick_menus (
  customer_phone text primary key,
  vendor_id text not null,
  page smallint not null default 0 check (page >= 0),
  item_ids text[] not null check (cardinality(item_ids) between 1 and 12),
  expires_at timestamptz not null default now() + interval '20 minutes',
  created_at timestamptz not null default now()
);
alter table public.quick_menus enable row level security;
revoke all on public.quick_menus from anon, authenticated;
