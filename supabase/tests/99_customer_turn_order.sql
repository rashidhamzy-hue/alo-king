-- Session E, e2e run 4: a customer's next message waits while the previous turn is still running (its replies may be
-- out before its session is saved). On the code before 20261014180000 the second turn began at once and read the
-- old session, so a tap on a card that had just been sent found no option behind it.
begin;

-- 1. A turn is running (begun, not finished, lease held) -----------------------------------------------------------
select public.customer_turn_begin('+96170000096', 'wamid.order.pin', 'location', 'Order', 1,
  'bbbbbbbb-0000-0000-0000-000000000001', now() + interval '150 seconds') as a1 \gset
select (:'a1'::jsonb -> 'customer' ->> 'id') as cid \gset
select tests.ok((:'a1'::jsonb ->> 'busy') is null and (:'a1'::jsonb ->> 'duplicate')::boolean is false,
  'the first message begins its turn');

-- 2. The customer's next tap is held back, and leaves no turn behind ----------------------------------------------
select public.customer_turn_begin('+96170000096', 'wamid.order.tap', 'tap', 'Order', 1,
  'bbbbbbbb-0000-0000-0000-000000000002', now() + interval '150 seconds') as b1 \gset
select tests.ok((:'b1'::jsonb ->> 'busy')::boolean and (:'b1'::jsonb ->> 'duplicate')::boolean is false,
  'a tap while the previous turn is still running is busy (the queue retries it in seconds)');
select tests.ok(not exists (select 1 from public.bot_turns where message_id = 'wamid.order.tap'),
  'and it begins nothing, so its retry is a first attempt again');

-- 3. Other customers are not held ----------------------------------------------------------------------------------
select public.customer_turn_begin('+96170000095', 'wamid.order.other', 'text', 'Other', 1,
  'bbbbbbbb-0000-0000-0000-000000000003', now() + interval '150 seconds') as o1 \gset
select tests.ok((:'o1'::jsonb ->> 'busy') is null, 'another customer''s message runs at once');

-- 4. A redelivery of the running message is still a duplicate, not busy -------------------------------------------
select tests.ok((public.customer_turn_begin('+96170000096', 'wamid.order.pin', 'location', 'Order', 1) ->> 'duplicate')::boolean,
  'Kapso delivering the running message again is a duplicate');

-- 5. Once the turn has saved its session, the tap runs and reads it ------------------------------------------------
select public.customer_turn_end(:'cid', 'wamid.order.pin',
  jsonb_build_object('lang', 'en', 'refs', jsonb_build_object('v1', jsonb_build_object('id', 'x', 'label', 'Alo Test Market'))),
  'deterministic', 0, '{}', 0, 10);
select public.customer_turn_begin('+96170000096', 'wamid.order.tap', 'tap', 'Order', 2,
  'bbbbbbbb-0000-0000-0000-000000000004', now() + interval '150 seconds') as b2 \gset
select tests.ok((:'b2'::jsonb ->> 'busy') is null and (:'b2'::jsonb ->> 'replay')::boolean is false,
  'after the save the tap begins (its retry is a fresh turn)');
select tests.ok(:'b2'::jsonb #>> '{session,refs,v1,label}' = 'Alo Test Market',
  'and it reads the session the card was sent with');

-- 6. A replay of a turn is also held while a later turn runs -------------------------------------------------------
select public.customer_turn_begin('+96170000094', 'wamid.order.r1', 'tap', 'Replay', 1,
  'bbbbbbbb-0000-0000-0000-000000000005', now() + interval '150 seconds') as r1 \gset
select public.customer_turn_release('wamid.order.r1', 'bbbbbbbb-0000-0000-0000-000000000005');
select public.customer_turn_begin('+96170000094', 'wamid.order.r2', 'tap', 'Replay', 1,
  'bbbbbbbb-0000-0000-0000-000000000006', now() + interval '150 seconds') as r2 \gset
select tests.ok((:'r2'::jsonb ->> 'busy') is null, 'a released turn (stalled, waiting for its replay) holds nobody');
select tests.ok((public.customer_turn_begin('+96170000094', 'wamid.order.r1', 'tap', 'Replay', 2,
  'bbbbbbbb-0000-0000-0000-000000000007', now() + interval '150 seconds') ->> 'busy')::boolean,
  'its replay waits while the later turn runs');

-- 7. A turn whose worker is gone holds nobody for long --------------------------------------------------------------
update public.bot_turns set received_at = now() - interval '31 seconds' where message_id = 'wamid.order.r2';
select tests.ok((public.customer_turn_begin('+96170000094', 'wamid.order.r3', 'text', 'Replay', 1,
  'bbbbbbbb-0000-0000-0000-000000000008', now() + interval '150 seconds') ->> 'busy') is null,
  'a turn begun more than 30 s ago no longer holds the next message (it is never held past the queue''s retries)');
update public.bot_turns set lease_until = now() - interval '1 second' where message_id = 'wamid.order.r3';
update public.bot_turns set received_at = now() where message_id = 'wamid.order.r2';
update public.bot_turns set lease_until = now() - interval '1 second', finished_at = now() where message_id = 'wamid.order.r2';
select tests.ok((public.customer_turn_begin('+96170000094', 'wamid.order.r4', 'text', 'Replay', 1) ->> 'busy') is null,
  'a finished turn or an expired lease holds nobody');

select tests.ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'bot_turns_running_idx'),
  'running turns are found by an index');

rollback;
