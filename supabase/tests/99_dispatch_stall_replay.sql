-- Session E (issue #139): a turn whose first attempt died mid-way is replayed by the queue's retry, quickly, without
-- adding anything twice. On the code before 20261014150000 the retry answered "duplicate" (the tap was lost) and a
-- failed event stayed invisible for the claim's whole 90 s visibility timeout.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-STL', 'CHF', 'Stallline', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-STL', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test')
on conflict (id) do nothing;
select set_config('app.fixture_owner_phone', '+96170000099', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset

-- 1. A failed event is back on the queue within seconds ---------------------------------------------------------------
select public.webhook_intake('kapso', jsonb_build_array(jsonb_build_object(
  'event_key', 'stall-1', 'event_type', 'whatsapp.message.received', 'phone_number_id', 'PNID',
  'payload', jsonb_build_object('message', jsonb_build_object('id', 'wamid.stall.1'))))) as intake \gset
select msg_id, event_id, attempts from public.webhook_claim(10, 90) limit 1 \gset
select tests.ok(:attempts = 1, 'the first attempt claims the event (invisible for 90 s)');
select public.webhook_finish(:msg_id, :event_id, 'failed', 'basket_add_item: no answer within 8000 ms (request stalled)');
select tests.ok((select vt <= now() + interval '6 seconds' from pgmq.q_webhook_inbound where msg_id = :msg_id),
  'a failed attempt makes the event visible again within 5 s, not after the 90 s visibility timeout');
select tests.ok((select status = 'failed' and last_error like '%stalled%' from public.webhook_events where id = :event_id),
  'and the stall is recorded on the event');
select tests.ok((select count(*) = 1 from pgmq.q_webhook_inbound where msg_id = :msg_id), 'the event stays on the queue');
update pgmq.q_webhook_inbound set vt = now() - interval '1 second' where msg_id = :msg_id;
select attempts as attempts2 from public.webhook_claim(10, 160) where msg_id = :msg_id \gset
select public.webhook_finish(:msg_id, :event_id, 'failed', 'late repeat of attempt 1', 5, 1);
select tests.ok((select status = 'processing' and attempts = 2 from public.webhook_events where id = :event_id)
  and (select vt > now() + interval '100 seconds' from pgmq.q_webhook_inbound where msg_id = :msg_id),
  'a late repeat of attempt 1''s finish leaves attempt 2 alone (still claimed, still invisible)');
select public.webhook_finish(:msg_id, :event_id, 'done', null, 5, :attempts2);
select tests.ok((select status = 'done' from public.webhook_events where id = :event_id)
  and not exists (select 1 from pgmq.q_webhook_inbound where msg_id = :msg_id), 'attempt 2''s own finish archives it');

-- 2. The retry replays an unfinished turn; a finished one is still a duplicate ----------------------------------------
select public.customer_turn_begin('+96170000097', 'wamid.stall.tap', 'tap', 'Stall', 1, 'aaaaaaaa-0000-0000-0000-000000000001') as b1 \gset
select tests.ok((:'b1'::jsonb ->> 'duplicate')::boolean is false and (:'b1'::jsonb ->> 'replay')::boolean is false,
  'the first attempt begins the turn');
select (:'b1'::jsonb #>> '{customer,id}') as cid \gset
update public.bot_sessions set refs = '{"i1": {"id": "x", "label": "Falafel Sandwich"}}' where customer_id = :'cid';
select tests.ok((public.customer_turn_begin('+96170000097', 'wamid.stall.tap', 'tap', 'Stall') ->> 'duplicate')::boolean,
  'the same message delivered again by Kapso (attempt 1) is a duplicate');
select public.customer_turn_begin('+96170000097', 'wamid.stall.tap', 'tap', 'Stall', 2, 'aaaaaaaa-0000-0000-0000-000000000002') as held \gset
select tests.ok((:'held'::jsonb ->> 'busy')::boolean and not (:'held'::jsonb ->> 'duplicate')::boolean,
  'while the first attempt still holds the turn, a retry is told busy (it fails and tries again; the tap is not dropped)');
select public.customer_turn_release('wamid.stall.tap', 'aaaaaaaa-0000-0000-0000-000000000002');
select tests.ok((public.customer_turn_begin('+96170000097', 'wamid.stall.tap', 'tap', 'Stall', 2, 'aaaaaaaa-0000-0000-0000-000000000003') ->> 'busy')::boolean,
  'another attempt cannot release a lease it does not hold');
select public.customer_turn_release('wamid.stall.tap', 'aaaaaaaa-0000-0000-0000-000000000001');
select public.customer_turn_begin('+96170000097', 'wamid.stall.tap', 'tap', 'Stall', 2, 'aaaaaaaa-0000-0000-0000-000000000004') as b2 \gset
select tests.ok((:'b2'::jsonb ->> 'duplicate')::boolean is false and (:'b2'::jsonb ->> 'replay')::boolean,
  'the queue''s retry (attempt 2) of the unfinished turn replays it');
select tests.ok(:'b2'::jsonb #>> '{session,refs,i1,label}' = 'Falafel Sandwich',
  'with the options the customer was shown');
select tests.ok((public.customer_turn_begin('+96170000097', 'wamid.stall.tap', 'tap', 'Stall', 3) ->> 'busy')::boolean,
  'and the replay holds the turn in turn: a third copy waits');
select public.customer_turn_begin('+96170000097', 'wamid.stall.held', 'tap', 'Stall', 1, null, now() + interval '1 hour') as lb \gset
select tests.ok((select lease_until <= now() + interval '156 seconds' from public.bot_turns where message_id = 'wamid.stall.held'),
  'a lease never outlives an edge function, whatever the caller asks');
select public.customer_turn_end(:'cid', 'wamid.stall.tap', :'b2'::jsonb -> 'session', 'deterministic', 0, '{}', 0, 10);
select tests.ok((public.customer_turn_begin('+96170000097', 'wamid.stall.tap', 'tap', 'Stall', 3) ->> 'duplicate')::boolean,
  'once the turn has finished, a later retry is a duplicate');
select public.customer_turn_begin('+96170000096', 'wamid.stall.other', 'tap', 'Other') as b3 \gset
select tests.ok((public.customer_turn_begin('+96170000097', 'wamid.stall.other', 'tap', 'Stall', 2) ->> 'duplicate')::boolean,
  'another customer''s message id is never replayed');

-- 3. A keyed basket add runs once ---------------------------------------------------------------------------------------
select public.address_save_pin(:'cid', 33.6775, 35.5645, 'Home') ->> 'status' as pin \gset
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Falafel Sandwich') as falafel \gset
select tests.ok(public.basket_add_item(:'cid', :'falafel', 2, '{}', null, false, 'wamid.stall.tap#0') ->> 'status' = 'added',
  'the first attempt adds 2 falafel');
select public.basket_add_item(:'cid', :'falafel', 2, '{}', null, false, 'wamid.stall.tap#0') as again \gset
select tests.ok((:'again'::jsonb ->> 'replayed')::boolean and (:'again'::jsonb ->> 'status') = 'added',
  'the replayed add answers "added" without adding');
select tests.ok((select sum(quantity) = 2 from public.basket_items bi join public.baskets b on b.id = bi.basket_id
  where b.customer_id = :'cid' and b.status = 'open'), 'the basket holds 2, not 4');
select public.basket_add_item(:'cid', :'falafel', 1, '{}', null, false, 'wamid.stall.next#0') ->> 'status' as next_add \gset
select tests.ok(:'next_add' = 'added' and (select sum(quantity) = 3 from public.basket_items bi join public.baskets b on b.id = bi.basket_id
  where b.customer_id = :'cid' and b.status = 'open'), 'a new tap adds again');
select tests.ok(public.basket_add_item(:'cid', :'falafel', 1) ->> 'status' = 'added', 'callers without a key still work (Flows, carts)');
update public.menu_items set available = false where id = :'falafel';
select tests.ok(public.basket_add_item(:'cid', :'falafel', 1, '{}', null, false, 'wamid.stall.refused#0') ->> 'status' = 'unavailable',
  'a refused add answers why');
update public.menu_items set available = true where id = :'falafel';
select tests.ok(public.basket_add_item(:'cid', :'falafel', 1, '{}', null, false, 'wamid.stall.refused#0') ->> 'replayed' is null,
  'and its key is not kept: the replay adds for real once the item is back');
select tests.ok(not has_function_privilege('anon', 'public.basket_add_item(uuid, uuid, integer, uuid[], text, boolean, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.customer_turn_begin(text, text, text, text, integer, uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.customer_turn_release(text, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.customer_turn_begin(text, text, text, text, integer, uuid, timestamptz)', 'execute'),
  'both stay service-role only');

rollback;
