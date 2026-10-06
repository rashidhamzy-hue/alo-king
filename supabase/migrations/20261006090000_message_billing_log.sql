-- Billing log: one row per outgoing WhatsApp message status, with Meta's pricing flags. No message content.
-- Filled by kapso-brain from Kapso's whatsapp.message.sent / delivered / read / failed webhooks.
-- Service role only (RLS on, no anon/authenticated access). Phones are cleared by "delete my data" and rows are purged after 90 days.
create table if not exists public.message_billing_log (
  wamid text not null,
  status text not null,
  phone_number_id text,
  to_phone text,
  message_type text,
  template_name text,
  billable boolean,
  pricing_type text,
  pricing_category text,
  pricing_model text,
  error_code integer,
  status_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (wamid, status)
);
create index if not exists message_billing_log_phone_time_idx on public.message_billing_log (to_phone, status_at);
create index if not exists message_billing_log_created_idx on public.message_billing_log (created_at);

-- Meta's per-message rate for the recipient market (Lebanon). Filled by the owner from Meta's USD rate card; nothing is invented here.
create table if not exists public.meta_rates (
  category text primary key check (category in ('marketing', 'utility', 'authentication', 'service')),
  usd_per_message numeric(10, 5) not null check (usd_per_message >= 0),
  source text not null,
  effective_from date not null default current_date,
  note text
);

alter table public.message_billing_log enable row level security;
alter table public.meta_rates enable row level security;

-- Per order: the messages sent to the customer's phone from 30 minutes before the order was placed until 15 minutes after it was delivered or cancelled (6 h after it was placed if it is still open, never more than 12 h), Meta's flags, and the cost.
-- Overlapping orders of one customer share messages (counted in each). est_meta_usd only counts categories that have a rate in meta_rates; rates_missing says if any billable category had none.
create or replace view public.message_cost_per_order as
with o as (
  select id, short_code, vendor_id, customer_phone, created_at,
         least(case when delivered_at is not null then delivered_at + interval '15 minutes'
                    when status in ('cancelled', 'rejected') then updated_at + interval '15 minutes'
                    else created_at + interval '6 hours' end, created_at + interval '12 hours') as ends_at
  from public.orders where customer_phone ~ '^[0-9]{8,15}$'
), m as (
  select distinct on (wamid) wamid, to_phone, status_at, billable, pricing_category
  from public.message_billing_log
  where to_phone is not null and status_at is not null
  order by wamid, (case status when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 else 0 end) desc
), j as (
  select o.id as order_id, m.wamid, m.billable, m.pricing_category, r.usd_per_message
  from o join m on m.to_phone = o.customer_phone and m.status_at between o.created_at - interval '30 minutes' and o.ends_at
  left join public.meta_rates r on r.category = m.pricing_category
), agg as (
  select order_id, count(*) as messages_total,
         count(*) filter (where billable is true) as messages_billable,
         count(*) filter (where billable is false) as messages_free,
         round(coalesce(sum(usd_per_message) filter (where billable is true), 0), 5) as est_meta_usd,
         coalesce(bool_or(billable is true and usd_per_message is null), false) as rates_missing
  from j group by order_id
), cat as (
  select order_id, jsonb_object_agg(pricing_category, n) as billable_by_category
  from (select order_id, pricing_category, count(*) as n from j where billable is true and pricing_category is not null group by order_id, pricing_category) x
  group by order_id
)
select o.id as order_id, o.short_code, o.vendor_id, o.created_at,
       coalesce(agg.messages_total, 0) as messages_total, coalesce(agg.messages_billable, 0) as messages_billable, coalesce(agg.messages_free, 0) as messages_free,
       coalesce(cat.billable_by_category, '{}'::jsonb) as billable_by_category,
       coalesce(agg.est_meta_usd, 0) as est_meta_usd, coalesce(agg.rates_missing, false) as rates_missing,
       a.est_usd as ai_usd, round(coalesce(agg.est_meta_usd, 0) + coalesce(a.est_usd, 0), 5) as total_est_usd
from o
left join agg on agg.order_id = o.id
left join cat on cat.order_id = o.id
left join public.ai_cost_per_order a on a.order_id = o.id;

revoke all on public.message_billing_log, public.meta_rates, public.message_cost_per_order from anon, authenticated;
