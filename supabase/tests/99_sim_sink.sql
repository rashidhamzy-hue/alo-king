-- Session 11-lite (DECISIONS §36): the simulator sink. +999 numbers are recorded, never sent; real numbers are
-- never recorded; the sink is off until the staging fixture turns it on; the simulated merchant takes over the
-- test merchant's order channel for a run and the owner's setting comes back; a simulated customer's handoff does
-- not message the owner's phone.
begin;

select tests.ok(app_private.sim_sink_on() = false, 'the sink is off by default (production stays so)');
select tests.ok(public.sim_sink_record('555', '{"to":"99996100000009","type":"text","text":{"body":"x"}}') = false,
  'with the sink off a +999 message is refused, not recorded');
select tests.ok((select count(*) = 0 from public.sim_outbox), 'nothing was recorded');
select tests.ok(public.sim_prepare('+99996100000001') ->> 'status' = 'sink_off', 'sim_prepare refuses while the sink is off');

select set_config('app.fixture_owner_phone', '+96170000097', false);
\i supabase/test-fixtures/alo-test-grill.sql
select tests.ok(app_private.sim_sink_on(), 'the staging fixture turns the sink on');
\i supabase/test-fixtures/alo-test-grill.sql
select tests.ok((select count(*) = 1 from public.app_config where key = 'sim_sink_enabled' and value = 'true'),
  'running the fixture again adds no second row');

select tests.ok(public.sim_sink_record('555', '{"messaging_product":"whatsapp","to":"99996100000009","type":"interactive","interactive":{"type":"button","body":{"text":"Pick"},"action":{"buttons":[{"type":"reply","reply":{"id":"c:order","title":"Order"}}]}}}') = true,
  'a +999 message is recorded');
select tests.ok((select to_phone = '+99996100000009' and kind = 'interactive:button' and body = 'Pick' from public.sim_outbox), 'with its number, kind and body');
select tests.ok(public.sim_sink_record('555', '{"to":"96170000001","type":"text","text":{"body":"x"}}') = false, 'a real number is never recorded');
select tests.ok(public.sim_sink_record('555', '{"to":"9991234","type":"text","text":{"body":"x"}}') = false, 'a number that is only 999 plus 4 digits is not a simulator number');
select tests.ok((select count(*) = 1 from public.sim_outbox), 'one row in total');

-- Persona setup and teardown ------------------------------------------------------------------------------------
select tests.ok(public.sim_prepare('+96170000001') ->> 'status' = 'not_a_sim_phone', 'a real number cannot become the simulated merchant');
select id as tv from public.vendors where is_test \gset
select coalesce((select target from public.vendor_order_channels where vendor_id = :'tv' and role = 'primary' and enabled), '') as before_target \gset
select tests.ok(public.sim_prepare('+99996100000001') ->> 'status' = 'ok', 'sim_prepare works for the test merchant');
select tests.ok((select target = '+99996100000001' and channel = 'whatsapp' from public.vendor_order_channels where vendor_id = :'tv' and role = 'primary' and enabled),
  'the simulated merchant is the primary channel');
select tests.ok(exists (select 1 from public.vendor_members where vendor_id = :'tv' and phone_e164 = '+99996100000001' and status = 'active' and role = 'owner'),
  'and an active owner');
select public.sim_prepare('+99996100000001');
select tests.ok((select count(*) = 1 and bool_and(coalesce(channel_target, '') = :'before_target') from app_private.sim_state),
  'a second prepare keeps the first saved setting');
select tests.ok(public.sim_restore() ->> 'status' = 'ok', 'sim_restore runs');
select tests.ok((select coalesce(max(target), '') = :'before_target' from public.vendor_order_channels where vendor_id = :'tv' and role = 'primary' and enabled),
  'the primary channel is back to what it was');
select tests.ok(not exists (select 1 from public.vendor_members where vendor_id = :'tv' and phone_e164 = '+99996100000001' and status = 'active'),
  'the simulated merchant is revoked');
select tests.ok(public.sim_restore() ->> 'status' = 'nothing_saved', 'a second restore does nothing');

-- Handoff of a simulated customer does not message the owner's phone ---------------------------------------------
select public.customer_turn_begin('+99996100000042', 'wamid.sim.1', 'text', 'Sim') as t1 \gset
select (:'t1'::jsonb #>> '{customer,id}') as scid \gset
select count(*) as before_n from public.outbound_messages where purpose = 'reply' \gset
select public.customer_handoff(:'scid', 'test', 'sim customer');
select tests.ok((select count(*) from public.outbound_messages where purpose = 'reply') = :before_n, 'no note to the owner for a simulated customer');
select tests.ok(exists (select 1 from public.ops_alerts where kind = 'customer_handoff'), 'the alert row is still written');
select public.customer_turn_begin('+96170000043', 'wamid.sim.2', 'text', 'Real') as t2 \gset
select (:'t2'::jsonb #>> '{customer,id}') as rcid \gset
select public.customer_handoff(:'rcid', 'test', 'real customer');
select tests.ok((select count(*) from public.outbound_messages where purpose = 'reply') > :before_n, 'a real customer''s handoff still notes the owner');

rollback;
