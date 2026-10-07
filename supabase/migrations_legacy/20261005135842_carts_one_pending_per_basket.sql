-- A basket can have at most one order summary waiting for Confirm (prevents duplicate orders from double taps / webhook retries).
create unique index if not exists carts_one_pending_per_basket on public.carts (basket_id) where status = 'pending' and basket_id is not null;
create index if not exists carts_basket_idx on public.carts (basket_id);
