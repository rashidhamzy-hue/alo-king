-- Fixtures for scripts/db-race-test.sh, committed in the throwaway database after supabase/tests ran.
update public.vendors set pickup_enabled = true, live_since = now() - interval '40 days'
where id = '20000000-0000-0000-0000-00000000000a';
insert into public.menu_items (id, vendor_id, name_en, price_usd, daily_quantity, daily_remaining, daily_date) values
  ('51000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Race croissant', 2.00, 3, 3, current_date),
  ('51000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', 'Race manakish', 1.50, null, null, null);
-- Twelve customers, each with an open pickup basket: one croissant.
insert into public.customers (id, phone_e164)
select ('52000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, '+9617100' || lpad(g::text, 4, '0')
from generate_series(1, 12) g;
insert into public.baskets (id, customer_id, vendor_id, fulfilment)
select ('53000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid,
       ('52000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, '20000000-0000-0000-0000-00000000000a', 'pickup'
from generate_series(1, 12) g;
insert into public.basket_items (basket_id, item_id, quantity)
select ('53000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid,
       case when g <= 10 then '51000000-0000-0000-0000-000000000001' else '51000000-0000-0000-0000-000000000002' end::uuid, 1
from generate_series(1, 12) g;
select public.basket_price(('53000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid) from generate_series(1, 12) g;
-- Deadlock order (session D, §38.3): two limited items and 21 customers, even ones adding labneh then zaatar, odd ones
-- zaatar then labneh (basket 21 is the lock-order probe).
insert into public.menu_items (id, vendor_id, name_en, price_usd, daily_quantity, daily_remaining, daily_date) values
  ('51000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', 'Race labneh', 1.00, 100, 100, current_date),
  ('51000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-00000000000a', 'Race zaatar', 1.00, 100, 100, current_date);
insert into public.customers (id, phone_e164)
select ('54000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, '+9617600' || lpad(g::text, 4, '0')
from generate_series(1, 21) g;
insert into public.baskets (id, customer_id, vendor_id, fulfilment)
select ('55000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid,
       ('54000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, '20000000-0000-0000-0000-00000000000a', 'pickup'
from generate_series(1, 21) g;
-- One row at a time, so each basket's lines are stored (and scanned) in the order given.
insert into public.basket_items (basket_id, item_id, quantity)
select ('55000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid,
       case when (g % 2 = 0) = (n = 1) then '51000000-0000-0000-0000-000000000003' else '51000000-0000-0000-0000-000000000004' end::uuid, 1
from generate_series(1, 21) g cross join generate_series(1, 2) n
order by g, n;
select public.basket_price(('55000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid) from generate_series(1, 21) g;
-- Adding the two items bumped the menu version: every race basket is priced again at the current version.
select public.basket_price(('53000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid) from generate_series(1, 12) g;
