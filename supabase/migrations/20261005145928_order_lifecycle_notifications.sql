-- Order lifecycle (flow spec item 4): what the customer was last told, closed-vendor notice, ratings, sold-out substitute offers. Service role only.
alter table public.orders add column if not exists customer_notified_status text;
alter table public.orders add column if not exists closed_notified_at timestamptz;

create table if not exists public.order_ratings (
  order_id uuid primary key references public.orders(id) on delete cascade,
  customer_phone text not null,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now()
);

create table if not exists public.substitution_offers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_phone text not null,
  missing_item_id text not null,
  sub_item_id text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  unique (order_id, missing_item_id)
);

alter table public.order_ratings enable row level security;
alter table public.substitution_offers enable row level security;
revoke all on public.order_ratings, public.substitution_offers from anon, authenticated;
