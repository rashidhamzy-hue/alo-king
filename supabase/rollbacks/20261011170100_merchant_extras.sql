-- Rollback for 20261011170100_merchant_extras.sql. The migration deletes no data itself: its DELETE statements
-- run later, inside vendor_power_on() (the generator list) and order_substitution_decide() (a declined line).
-- This file removes what the migration created. It keeps menu_items.needs_power, the substitution columns on
-- baskets and orders and the dated config rows (dated rows are never deleted once in effect); nothing reads
-- them afterwards. Items still hidden by generator mode are made available again first.
update public.menu_items i set available = true from app_private.power_hidden_items h where h.item_id = i.id;
update public.vendors v set paused_until = null, pause_reason = null where pause_reason = 'kitchen full (auto)';
drop trigger if exists orders_capacity_eta on public.orders;
drop trigger if exists orders_capacity_after on public.orders;
drop trigger if exists orders_copy_substitution on public.orders;
drop function if exists public.vendor_same_price(uuid);
drop function if exists public.order_card_image(uuid);
drop function if exists public.order_substitution_decide(uuid, uuid, boolean);
drop function if exists public.order_substitution_offer(uuid, text, text, uuid, uuid);
drop function if exists app_private.order_substitution_offer(uuid, text, text, uuid, uuid);
drop table if exists public.order_substitutions;
drop function if exists public.basket_set_substitution(uuid, text);
drop function if exists public.basket_substitution_needed(uuid);
drop function if exists app_private.orders_copy_substitution();
drop function if exists public.staff_shift_touch(text);
drop table if exists app_private.member_shifts;
drop function if exists public.vendor_staff_find(uuid, text);
drop function if exists app_private.vendor_power_on(uuid);
drop function if exists app_private.vendor_power_off(uuid);
drop table if exists app_private.power_hidden_items;
drop function if exists app_private.orders_capacity_after();
drop function if exists app_private.orders_capacity_eta();
-- Kept: vendor_ops, proposal_roles, kitchen_queue and kitchen_capacity_check, because merchant_proposal_create
-- and merchant_proposal_decide keep their new bodies and use them (a "resume" clears capacity_paused).
-- Restore the 20261011090200 bodies of those two functions from git to remove these as well.
