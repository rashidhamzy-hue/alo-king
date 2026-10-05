-- Vendor order card + 90s escalation bookkeeping (written by kapso-brain with the service role only).
alter table public.orders
  add column if not exists vendor_notified_at timestamptz,
  add column if not exists escalated_at timestamptz;
create index if not exists orders_pending_escalation_idx on public.orders (created_at) where status = 'pending' and escalated_at is null;
