-- Session 5g part E: sim_tester enrols a simulator persona as a demo tester, on staging only.
begin;

select tests.ok(public.sim_tester('+99997100000001', true) ->> 'status' = 'sink_off', 'the simulator sink off (production): nothing');
insert into public.app_config (key, value, effective_from, note)
values ('sim_sink_enabled', 'true', now() - interval '1 minute', 'test');
select tests.ok(public.sim_tester('+97150000001', true) ->> 'status' = 'not_a_sim_phone', 'a real number is never enrolled');
select tests.ok(public.sim_tester('+99997100000001', true) ->> 'status' = 'no_customer', 'a persona that has not written yet');
select (public.customer_turn_begin('+99997100000001', 'wamid.st.1', 'text', 'Sim') #>> '{customer,id}') as cu \gset
select public.sim_tester('+99997100000001', true) ->> 'status' as on_status \gset
select tests.ok(:'on_status' = 'ok' and app_private.is_demo_tester(:'cu'), 'the persona is a demo tester');
select public.sim_tester('+99997100000001', false) ->> 'status' as off_status \gset
select tests.ok(:'off_status' = 'ok' and not app_private.is_demo_tester(:'cu'), 'and is removed at the end of its scenario');
select tests.ok(not has_function_privilege('anon', 'public.sim_tester(text, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.sim_tester(text, boolean)', 'execute'),
  'only the service role runs it');

rollback;
