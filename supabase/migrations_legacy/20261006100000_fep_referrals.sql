-- Free entry point tracking (observation only). One row per inbound message that carried a Click-to-WhatsApp / Facebook CTA referral,
-- with the 72-hour window it opens. Service role only; cleared by "delete my data"; purged after 90 days.
create table if not exists public.fep_referrals (
  message_id text primary key,
  customer_phone text not null,
  source_type text,
  source_id text,
  source_url text,
  headline text,
  ctwa_clid text,
  referral_at timestamptz not null,
  window_opens_at timestamptz not null,
  window_expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists fep_referrals_phone_idx on public.fep_referrals (customer_phone, window_expires_at desc);
create index if not exists fep_referrals_created_idx on public.fep_referrals (created_at);
alter table public.fep_referrals enable row level security;

-- The latest window per customer, and whether it is still open.
create or replace view public.customer_fep_windows with (security_invoker = on) as
  select distinct on (customer_phone) customer_phone, source_type, source_id, window_opens_at, window_expires_at, (now() >= window_opens_at and now() < window_expires_at) as active
  from public.fep_referrals order by customer_phone, window_expires_at desc;

-- Per day (Asia/Beirut): outgoing messages by what Meta reported, and how many fell inside a window we tracked.
-- free_entry_point = Meta's own pricing.type for messages free because of the window; free_other = free for another reason (for example inside the customer-service window).
-- share_free_pct is over the messages that carry a pricing object. in_tracked_window uses our own record and does not depend on Meta's label.
create or replace view public.message_free_share_daily with (security_invoker = on) as
with m as (
  select distinct on (wamid) wamid, to_phone, min(status_at) over (partition by wamid) as status_at, billable, pricing_type
  from public.message_billing_log
  where status_at is not null
  order by wamid, (billable is null), (case status when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 else 0 end) desc
)
select (m.status_at at time zone 'Asia/Beirut')::date as day,
       count(*) as messages_total,
       count(*) filter (where m.billable is true) as billable,
       count(*) filter (where m.billable is false) as free,
       count(*) filter (where m.pricing_type = 'free_entry_point') as free_entry_point,
       count(*) filter (where m.billable is false and m.pricing_type is distinct from 'free_entry_point') as free_other,
       count(*) filter (where exists (select 1 from public.fep_referrals f where f.customer_phone = m.to_phone and m.status_at >= f.window_opens_at and m.status_at < f.window_expires_at)) as in_tracked_window,
       round(100.0 * count(*) filter (where m.billable is false) / nullif(count(*) filter (where m.billable is not null), 0), 1) as share_free_pct,
       round(100.0 * count(*) filter (where m.pricing_type = 'free_entry_point') / nullif(count(*) filter (where m.billable is not null), 0), 1) as share_free_entry_point_pct
from m group by 1 order by 1 desc;

revoke all on public.fep_referrals, public.customer_fep_windows, public.message_free_share_daily from anon, authenticated;
