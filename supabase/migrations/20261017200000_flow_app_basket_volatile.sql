-- Session 5h part 5 (DECISIONS §39.15.13): flow_app_basket reads the basket through public.basket_view, which locks the
-- open basket (select … for update) while it refreshes prices. Declared stable, PostgREST ran it in a read-only
-- transaction and the Flow's basket screen failed after every Add ("cannot execute SELECT FOR UPDATE in a read-only
-- transaction", the simulator's flow-app scenario on staging, 17 October). It is volatile, like basket_view.
alter function public.flow_app_basket(text) volatile;
