-- Session 6a (DECISIONS §37.6): when the merchant allows pickup, checkout offers Delivery / Pickup buttons.
-- The bot needs to know, for the customer's open basket, whether the shop takes delivery, pickup or both.
-- A read-only RPC for the service role; nothing is stored and no existing function changes.

create function public.basket_fulfilment_options(p_customer_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('status', 'ok', 'delivery', v.delivery_enabled, 'pickup', v.pickup_enabled,
                               'fulfilment', b.fulfilment)
     from public.baskets b
     join public.vendors v on v.id = b.vendor_id
     where b.customer_id = p_customer_id and b.status = 'open'),
    jsonb_build_object('status', 'no_basket'));
$$;
revoke all on function public.basket_fulfilment_options(uuid) from public, anon, authenticated;
grant execute on function public.basket_fulfilment_options(uuid) to service_role;
