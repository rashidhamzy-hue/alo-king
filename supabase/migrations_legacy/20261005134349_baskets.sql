-- Persistent basket per customer per vendor (flow spec item 1). Lines hold item id, quantity and chosen options only:
-- prices are always recomputed server-side from menu_items at display and checkout time, never stored here.
create table if not exists public.baskets (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null,
  vendor_id text not null,
  status text not null default 'active' check (status in ('active', 'ordered', 'cleared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists baskets_one_active_per_vendor on public.baskets (customer_phone, vendor_id) where status = 'active';
create index if not exists baskets_customer_idx on public.baskets (customer_phone, status);

create table if not exists public.basket_lines (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references public.baskets(id) on delete cascade,
  item_id text not null,
  line_key text not null, -- item_id + sorted choices: the same dish with the same options merges into one line
  quantity integer not null check (quantity between 1 and 20),
  choices jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (basket_id, line_key)
);

alter table public.carts add column if not exists basket_id uuid references public.baskets(id) on delete set null;

-- Service role only (the WhatsApp edge function): no policies and no grants for anon/authenticated.
alter table public.baskets enable row level security;
alter table public.basket_lines enable row level security;
revoke all on public.baskets, public.basket_lines from anon, authenticated;
