-- Session 5h part 5: every Flow app function that reaches basket_view (which locks the basket) is volatile, so PostgREST
-- never runs it in a read-only transaction.
begin;
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'flow_app_%' and p.provolatile <> 'v'
    and pg_get_functiondef(p.oid) ~ 'basket_view'),
  'no stable Flow app function reads basket_view');
select tests.ok((select p.provolatile = 'v' from pg_proc p where p.oid = 'public.flow_app_basket(text)'::regprocedure),
  'flow_app_basket is volatile');
rollback;
