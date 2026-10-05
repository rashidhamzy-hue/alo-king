-- Closed-vendor fixture for the "closed vendor" persona (Habaq).
-- SETUP (run once before the suite):
insert into public.vendor_profiles (vendor_id, accepts_orders) values ('habaq-36500', false)
on conflict (vendor_id) do update set accepts_orders = false;
-- TEARDOWN (after the suite):
-- update public.vendor_profiles set accepts_orders = true where vendor_id = 'habaq-36500';
