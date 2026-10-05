-- AI cost control: one row per Anthropic API call from kapso-brain (tokens and estimated USD only, never message content),
-- attributed to a customer phone and, once they confirm, to the order. (`ai_usage` already exists: per-vendor daily counter for merchant-ai.)
create table if not exists public.ai_call_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  day date not null, -- budget day, Asia/Beirut
  kind text not null check (kind in ('customer', 'owner')),
  customer_phone text,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  est_usd numeric(12, 6) not null default 0,
  order_id uuid references public.orders(id) on delete set null
);
create index if not exists ai_call_log_day_idx on public.ai_call_log (day);
create index if not exists ai_call_log_phone_time_idx on public.ai_call_log (customer_phone, created_at desc);
create index if not exists ai_call_log_order_idx on public.ai_call_log (order_id) where order_id is not null;

-- One alert per day when the daily budget is hit (the primary key makes the ping idempotent).
create table if not exists public.ai_budget_alerts (
  day date primary key,
  spent_usd numeric(12, 6) not null,
  budget_usd numeric(12, 2) not null,
  pinged_at timestamptz not null default now(),
  ping_ok boolean
);

create or replace view public.ai_cost_daily with (security_invoker = on) as
  select day, count(*) as api_calls, round(sum(est_usd), 4) as est_usd,
         count(distinct customer_phone) as customers, count(distinct order_id) as orders_attributed
  from public.ai_call_log group by day order by day desc;
create or replace view public.ai_cost_per_order with (security_invoker = on) as
  select order_id, count(*) as api_calls, round(sum(est_usd), 4) as est_usd,
         sum(input_tokens + cache_read_tokens + cache_write_tokens) as prompt_tokens, sum(output_tokens) as output_tokens
  from public.ai_call_log where order_id is not null group by order_id;

alter table public.ai_call_log enable row level security;
alter table public.ai_budget_alerts enable row level security;
revoke all on public.ai_call_log, public.ai_budget_alerts, public.ai_cost_daily, public.ai_cost_per_order from anon, authenticated;
