-- Session 6b: the website's anonymous forms (DECISIONS §37.4): the rate limiter and driver applications.
begin;

-- Rate limiter --------------------------------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.web_rate_hit('t:a', 2, 60) and public.web_rate_hit('t:a', 2, 60), 'two hits inside the limit pass');
select tests.ok(not public.web_rate_hit('t:a', 2, 60), 'the third hit in the window is refused');
select tests.ok(public.web_rate_hit('t:b', 2, 60), 'another key has its own counter');
reset role;
update app_private.web_rate set window_start = now() - interval '2 minutes' where key = 't:a';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.web_rate_hit('t:a', 2, 60), 'the counter restarts when the window has passed');
select tests.throws($$select public.web_rate_hit('t:c', 0, 60)$$, 'positive', 'a zero limit is rejected');
reset role;

set local role anon;
select tests.act_as(null);
select tests.throws($$select public.web_rate_hit('t:x', 5, 60)$$, 'permission denied', 'anonymous visitors cannot call the limiter');
select tests.throws($$select * from app_private.web_rate$$, 'permission denied', 'nor read its counters');
reset role;
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws($$select public.web_rate_hit('t:x', 5, 60)$$, 'permission denied', 'nor can a signed-in customer');
reset role;

-- One business for the claim page ----------------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok((select count(*) = 1 and bool_and(name = 'Vendor C' and seed_phone_tail = '…33' and claim_status = 'unclaimed' and not in_brand)
  from public.vendor_claim_lookup('20000000-0000-0000-0000-00000000000c')), 'the lookup returns the name and only the last two digits of the phone');
select tests.ok((select count(*) = 0 from public.vendor_claim_lookup('20000000-0000-0000-0000-0000000000ff')), 'an unknown id returns nothing');
reset role;
set local role anon;
select tests.act_as(null);
select tests.throws($$select * from public.vendor_claim_lookup('20000000-0000-0000-0000-00000000000c')$$, 'permission denied', 'anonymous visitors cannot call the lookup');
reset role;

-- Driver applications -------------------------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.driver_apply('Karim Haddad', '+96171555123', 'Baakline', 'motorbike', true, array['ar', 'en'], array['evenings'], 'I know the Shouf roads', 'ar') as d1 \gset
select tests.ok(:'d1'::jsonb ->> 'status' = 'received' and (:'d1'::jsonb ->> 'updated')::boolean = false, 'an application is received');
select public.driver_apply('Karim Haddad', '+96171555123', 'Beiteddine', 'car', true, array['ar'], array['nights'], null, 'ar') as d2 \gset
select tests.ok(:'d2'::jsonb ->> 'id' = :'d1'::jsonb ->> 'id' and (:'d2'::jsonb ->> 'updated')::boolean, 'applying again updates the open application');
reset role;
select tests.ok((select count(*) = 1 and bool_and(place = 'Beiteddine' and vehicle = 'car') from public.driver_applications
  where phone_e164 = '+96171555123'), 'there is one open row per number, with the latest answers');
select tests.ok((select count(*) = 1 from public.ops_alerts where kind = 'driver_application' and summary not like '%71555123%'),
  'one alert for Rasheed, and it carries no phone number');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.throws($$select public.driver_apply('X', '12345', 'Baakline', 'car', true)$$, 'E.164', 'a number that is not E.164 is rejected');
select tests.throws($$select public.driver_apply('Karim Haddad', '+96171555124', 'Baakline', 'spaceship', true)$$, 'driver_applications_vehicle_check|violates check', 'an unknown vehicle is rejected');
reset role;

-- Only operators read the queue and move it along.
set local role anon;
select tests.act_as(null);
select tests.throws($$select * from public.driver_applications$$, 'permission denied', 'anonymous visitors cannot read applications');
reset role;
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.ok((select count(*) = 0 from public.driver_applications), 'a customer sees no applications');
select tests.throws($$select public.driver_application_set_status(gen_random_uuid(), 'approved')$$, 'operators only', 'a customer cannot decide');
select tests.act_as('00000000-0000-0000-0000-00000000000b');
select tests.ok((select count(*) = 1 from public.driver_applications), 'an operator sees the application');
select public.driver_application_set_status((select id from public.driver_applications limit 1), 'contacted');
select tests.ok((select status = 'contacted' and decided_by = '00000000-0000-0000-0000-00000000000b' from public.driver_applications limit 1),
  'the operator moves it to contacted, and it is recorded who did');
select tests.throws($$select public.driver_application_set_status((select id from public.driver_applications limit 1), 'hired')$$, 'unknown status', 'an unknown status is rejected');
reset role;

set local role anon;
select tests.act_as(null);
select tests.throws($$select public.driver_apply('X Y', '+96171555125', 'Baakline', 'car', true)$$, 'permission denied', 'anonymous visitors cannot call driver_apply directly (the edge function does)');
reset role;

rollback;
