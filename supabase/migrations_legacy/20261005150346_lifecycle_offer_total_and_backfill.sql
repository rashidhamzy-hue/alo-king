-- A swap is only valid at the exact total the customer was shown.
alter table public.substitution_offers add column if not exists offered_total_usd numeric(10, 2);
-- Customers were already told about every status up to now (the sweep must not re-announce history).
update public.orders set customer_notified_status = status where customer_notified_status is null and status <> 'pending';
