-- Session 5f part 8a (CUSTOMER-EXPERIENCE.md §3.1 #1-7, §3.2 #11, §3.3 #21): first contact.
-- One reply to a burst of typed messages (2 s debounce, a dated config row), opening times and "every shop near you is
-- closed", the "Remind me" reminder (one service message, only inside the 24-hour window, else dropped), a shop link by slug,
-- and the waitlist outside the delivery area (one utility notice the customer asked for, STOP honoured, never marketing).
begin;

-- 0. Config ----------------------------------------------------------------------------------------------------------------
select tests.ok(public.config_numeric('inbound_debounce_ms') = 2000 and public.config_numeric('inbound_debounce_max_ms') = 8000,
  'the debounce window is a dated config row: 2000 ms, capped at 8000 ms from the first message');
select tests.ok(public.config_value('whatsapp_template_map') ->> 'waitlist_open' = 'alo_waitlist_open'
  and public.config_value('whatsapp_template_map') ->> 'accepted' = 'alo_order_confirmed'
  and public.config_value('whatsapp_template_map') ->> 'kitchen_full' = 'alo_kitchen_full',
  'the template map gains the waitlist notice and keeps every earlier key');

-- 1. One reply to a burst of typed messages ----------------------------------------------------------------------------------
create temporary table ev (k text primary key, id bigint);
create function pg_temp.inbound(p_key text, p_phone text, p_type text, p_body text, p_direction text default 'inbound',
  p_event text default 'whatsapp.message.received') returns bigint
language sql as $$
  select e.event_id from public.webhook_intake('kapso', jsonb_build_array(jsonb_build_object(
    'event_key', p_event || ':wamid.fc.' || p_key, 'event_type', p_event, 'phone_number_id', '597907523413541',
    'payload', jsonb_build_object(
      'conversation', jsonb_build_object('phone_number', p_phone),
      'message', jsonb_build_object('id', 'wamid.fc.' || p_key, 'type', p_type, 'from', ltrim(p_phone, '+'),
        'text', jsonb_build_object('body', p_body), 'kapso', jsonb_build_object('direction', p_direction)))))) e;
$$;
insert into ev values
  ('a1', pg_temp.inbound('a1', '+96170000301', 'text', 'hi')),
  ('a2', pg_temp.inbound('a2', '+96170000301', 'text', 'i want shawarma')),
  ('a3', pg_temp.inbound('a3', '+96170000301', 'text', '2 please')),
  ('tap', pg_temp.inbound('tap', '+96170000301', 'interactive', null)),
  ('echo', pg_temp.inbound('echo', '+96170000301', 'text', 'our own reply', 'outbound', 'whatsapp.message.sent')),
  ('other', pg_temp.inbound('other', '+96170000302', 'text', 'hello from someone else'));
-- As dispatch claims them (attempt 1).
update public.webhook_events set status = 'processing', attempts = 1 where id in (select id from ev);
update public.webhook_events set received_at = clock_timestamp() - interval '1 second' where id = (select id from ev where k = 'a1');
update public.webhook_events set received_at = clock_timestamp() - interval '600 milliseconds' where id = (select id from ev where k = 'a2');
update public.webhook_events set received_at = clock_timestamp() where id in (select id from ev where k in ('a3', 'echo', 'tap', 'other'));

select public.customer_burst((select id from ev where k = 'a1')) as w1 \gset
select tests.ok((:'w1'::jsonb) ->> 'status' = 'wait' and ((:'w1'::jsonb) ->> 'wait_s')::numeric between 1.5 and 2.05,
  'a message typed while the customer is still typing waits until 2 s after their latest one');
select tests.ok(public.customer_burst((select id from ev where k = 'tap')) ->> 'status' = 'single',
  'a tap never waits (single)');

-- Two seconds of quiet later: the first worker to look leads and answers all three, oldest first.
update public.webhook_events set received_at = received_at - interval '3 seconds'
where id in (select id from ev where k in ('a1', 'a2', 'a3', 'echo'));
select public.customer_burst((select id from ev where k = 'a2')) as b \gset
select tests.ok((:'b'::jsonb) ->> 'status' = 'burst' and (:'b'::jsonb) -> 'texts' = '["hi", "i want shawarma", "2 please"]'::jsonb
  and ((:'b'::jsonb) ->> 'count')::int = 3, 'the burst leader carries the three texts in the order they were sent');
select tests.ok((select bool_and(folded_into = (select id from ev where k = 'a2') and status = 'done' and processed_at is not null)
  from public.webhook_events where id in (select id from ev where k in ('a1', 'a3'))),
  'the other two are folded into it and marked done (never answered on their own)');
select tests.ok(public.customer_burst((select id from ev where k = 'a1')) ->> 'status' = 'folded'
  and public.customer_burst((select id from ev where k = 'a3')) ->> 'into' = (select id from ev where k = 'a2')::text,
  'a worker holding a folded message is told so and does nothing');
select tests.ok(public.customer_burst((select id from ev where k = 'a2')) = (:'b'::jsonb),
  'asking again (a retry after a stall) gives the same burst');
select tests.ok((select folded_into is null and status = 'processing' from public.webhook_events where id = (select id from ev where k = 'echo'))
  and (select folded_into is null from public.webhook_events where id = (select id from ev where k = 'other'))
  and (select folded_into is null from public.webhook_events where id = (select id from ev where k = 'tap')),
  'our own outbound echo, another customer''s text and a tap are never folded');

-- The cap: a customer who keeps typing is answered inbound_debounce_max_ms after the first message of the burst.
insert into ev values
  ('c1', pg_temp.inbound('c1', '+96170000303', 'text', 'first')),
  ('c2', pg_temp.inbound('c2', '+96170000303', 'text', 'still typing'));
update public.webhook_events set status = 'processing', attempts = 1 where id in (select id from ev where k in ('c1', 'c2'));
update public.webhook_events set received_at = clock_timestamp() - interval '9 seconds' where id = (select id from ev where k = 'c1');
update public.webhook_events set received_at = clock_timestamp() - interval '300 milliseconds' where id = (select id from ev where k = 'c2');
select tests.ok(public.customer_burst((select id from ev where k = 'c1')) -> 'texts' = '["first", "still typing"]'::jsonb,
  'past the cap the burst is answered at once, even 0.3 s after the last message');

-- A leader that was held back (its turn busy) and a newer message: the newer one leads and carries everything.
insert into ev values
  ('d1', pg_temp.inbound('d1', '+96170000304', 'text', 'one')),
  ('d2', pg_temp.inbound('d2', '+96170000304', 'text', 'two'));
update public.webhook_events set status = 'processing', attempts = 1, received_at = clock_timestamp() - interval '5 seconds'
where id in (select id from ev where k in ('d1', 'd2'));
update public.webhook_events set received_at = clock_timestamp() - interval '4 seconds' where id = (select id from ev where k = 'd2');
update public.webhook_events set received_at = clock_timestamp() - interval '6 seconds' where id = (select id from ev where k = 'd1');
select tests.ok(public.customer_burst((select id from ev where k = 'd2')) -> 'texts' = '["one", "two"]'::jsonb,
  'd2 leads d1');
update public.webhook_events set status = 'failed' where id = (select id from ev where k = 'd2');
insert into ev values ('d3', pg_temp.inbound('d3', '+96170000304', 'text', 'three'));
update public.webhook_events set status = 'processing', attempts = 1, received_at = clock_timestamp() - interval '3 seconds'
where id = (select id from ev where k = 'd3');
select public.customer_burst((select id from ev where k = 'd3')) as d3 \gset
select tests.ok((:'d3'::jsonb) -> 'texts' = '["one", "two", "three"]'::jsonb
  and (select count(*) = 2 from public.webhook_events where folded_into = (select id from ev where k = 'd3')),
  'a newer message folds the held-back leader and what it had folded');

-- A leader being answered (told to lead, its turn not failed) is never folded into a newer burst: no burst twice.
insert into ev values ('lead1', pg_temp.inbound('lead1', '+96170000309', 'text', 'add 2 shawarma'));
update public.webhook_events set status = 'processing', attempts = 1, received_at = clock_timestamp() - interval '9 seconds'
where id = (select id from ev where k = 'lead1');
select public.customer_burst((select id from ev where k = 'lead1')) as lead1 \gset
select tests.ok((:'lead1'::jsonb) -> 'texts' = '["add 2 shawarma"]'::jsonb
  and (select burst_led_at is not null from public.webhook_events where id = (select id from ev where k = 'lead1')),
  'a leader alone and is marked as leading');
insert into ev values ('lead2', pg_temp.inbound('lead2', '+96170000309', 'text', 'and a pepsi'));
update public.webhook_events set status = 'processing', attempts = 1, received_at = clock_timestamp() - interval '3 seconds'
where id = (select id from ev where k = 'lead2');
select public.customer_burst((select id from ev where k = 'lead2')) as lead2 \gset
select tests.ok((:'lead2'::jsonb) -> 'texts' = '["and a pepsi"]'::jsonb
  and (select folded_into is null from public.webhook_events where id = (select id from ev where k = 'lead1')),
  'a newer message never folds a leader being answered: "add 2 shawarma" is never processed twice');

-- STOP answered alone is marked, so a burst led at the same moment never folds it (no second confirmation).
insert into ev values ('stop1', pg_temp.inbound('stop1', '+96170000310', 'text', 'STOP'));
update public.webhook_events set status = 'processing', attempts = 1, received_at = clock_timestamp() - interval '9 seconds'
where id = (select id from ev where k = 'stop1');
select public.customer_burst((select id from ev where k = 'stop1'), true) as st1 \gset
insert into ev values ('stop2', pg_temp.inbound('stop2', '+96170000310', 'text', 'and hi'));
update public.webhook_events set status = 'processing', attempts = 1, received_at = clock_timestamp() - interval '9 seconds'
where id = (select id from ev where k = 'stop2');
select public.customer_burst((select id from ev where k = 'stop2')) as st2 \gset
select tests.ok((:'st1'::jsonb) ->> 'status' = 'single' and (:'st2'::jsonb) -> 'texts' = '["and hi"]'::jsonb
  and (select folded_into is null from public.webhook_events where id = (select id from ev where k = 'stop1')),
  'STOP answered alone is never folded into a burst led at the same moment');

-- One burst per number we answer from: texts to two of our numbers never fold together.
insert into ev values ('n1', pg_temp.inbound('n1', '+96170000316', 'text', 'to the sandbox'));
insert into ev values ('n2', pg_temp.inbound('n2', '+96170000316', 'text', 'to the US number'));
update public.webhook_events set status = 'processing', attempts = 1, received_at = clock_timestamp() - interval '9 seconds'
where id in (select id from ev where k in ('n1', 'n2'));
update public.webhook_events set phone_number_id = '15550009999' where id = (select id from ev where k = 'n2');
select public.customer_burst((select id from ev where k = 'n1')) as nb1 \gset
select tests.ok((:'nb1'::jsonb) -> 'texts' = '["to the sandbox"]'::jsonb
  and (select folded_into is null from public.webhook_events where id = (select id from ev where k = 'n2')),
  'texts to two of our numbers are two conversations, never one burst');

-- A message whose bot turn has begun is replayed as it was: never folded into a newer burst, never waits.
insert into ev values
  ('e1', pg_temp.inbound('e1', '+96170000305', 'text', 'begun')),
  ('e2', pg_temp.inbound('e2', '+96170000305', 'text', 'later'));
update public.webhook_events set status = 'processing', attempts = 1, received_at = clock_timestamp() - interval '4 seconds'
where id in (select id from ev where k in ('e1', 'e2'));
select public.customer_turn_begin('+96170000305', 'wamid.fc.e1', 'text');
select tests.ok(public.customer_burst((select id from ev where k = 'e1')) -> 'texts' = '["begun"]'::jsonb,
  'a turn that began replays its own text without waiting');
select public.customer_burst((select id from ev where k = 'e2')) as e2 \gset
select tests.ok((:'e2'::jsonb) -> 'texts' = '["later"]'::jsonb
  and (select folded_into is null from public.webhook_events where id = (select id from ev where k = 'e1')),
  'and a later message does not swallow it');

-- The window is config: 0 switches the debounce off.
savepoint no_debounce;
insert into ev values ('f1', pg_temp.inbound('f1', '+96170000306', 'text', 'now'));
update public.webhook_events set status = 'processing', attempts = 1, received_at = clock_timestamp() where id = (select id from ev where k = 'f1');
insert into public.app_config (key, value, effective_from, note) values ('inbound_debounce_ms', '0', now(), 'test');
select tests.ok(public.customer_burst((select id from ev where k = 'f1')) ->> 'status' = 'single',
  'inbound_debounce_ms = 0: answered at once');
rollback to savepoint no_debounce;

-- webhook_defer: back on the queue for exactly the wait, the claim's attempt given back; only that attempt can do it.
insert into ev values ('g1', pg_temp.inbound('g1', '+96170000307', 'text', 'wait for me'));
update public.webhook_events set status = 'processing', attempts = 2 where id = (select id from ev where k = 'g1');
select q.msg_id as g1msg from pgmq.q_webhook_inbound q where (q.message ->> 'event_id')::bigint = (select id from ev where k = 'g1') \gset
select tests.ok(not public.webhook_defer(:g1msg, (select id from ev where k = 'g1'), 1, 1.5), 'another attempt cannot defer it');
select public.webhook_defer(:g1msg, (select id from ev where k = 'g1'), 2, 1.5) as deferred \gset
select tests.ok(:'deferred'::boolean
  and (select status = 'queued' and attempts = 1 from public.webhook_events where id = (select id from ev where k = 'g1'))
  and (select vt between clock_timestamp() + interval '1 second' and clock_timestamp() + interval '1.6 seconds'
       from pgmq.q_webhook_inbound where msg_id = :g1msg),
  'deferred: queued again in 1.5 s and the attempt is not spent');
select tests.ok(not public.webhook_defer(:g1msg, (select id from ev where k = 'g1'), 2, 1.5), 'a repeat changes nothing');

-- Design for scale (§39.14 rule 2): the burst lookup reads the waiting-texts index, not the event log.
set local enable_seqscan = off;
create function pg_temp.plan(p_sql text) returns text language plpgsql as $$
declare r record; o text := '';
begin
  for r in execute 'explain ' || p_sql loop o := o || r."QUERY PLAN" || E'\n'; end loop;
  return o;
end $$;
select tests.ok(pg_temp.plan($q$select max(w.received_at) from public.webhook_events w
  where app_private.inbound_phone(w.payload) = '96170000301' and w.status in ('queued', 'processing', 'failed')
    and (w.payload -> 'message' ->> 'type') = 'text'$q$) like '%webhook_events_pending_text_idx%',
  'the burst lookup uses webhook_events_pending_text_idx');
reset enable_seqscan;

-- 2. Opening times ----------------------------------------------------------------------------------------------------------
\set va '20000000-0000-0000-0000-00000000000a'
insert into public.places (id, name_ar, name_en, name_fr, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-FCTOWN', 'ضيعة', 'Fctown', 'Fctown', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.581 33.681)', 'test'),
  ('LB-CHF-FCOUT', 'الدامور', 'Damour Test', 'Damour Test', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.50 33.70)', 'test');
select public.place_set_service_status('LB-CHF-FCTOWN', 'on', 'test');
update public.vendors set delivery_enabled = true, listing_status = 'active', paused_until = null, town_id = 'LB-CHF-FCTOWN'
where id = :'va';
insert into public.vendors (id, slug, name_ar, name_en, business_type, claim_status, orderable, source, place_id, location,
  delivery_radius_km, town_id, listing_status) values
  ('20000000-0000-0000-0000-0000000000f1', 'vendor-fc-d', 'محل دي', 'Vendor D', 'restaurant', 'claimed', true, 'merchant', 'gpFCD',
   'SRID=4326;POINT(35.585 33.682)', 5, 'LB-CHF-FCTOWN', 'active');
\set vd '20000000-0000-0000-0000-0000000000f1'

-- Hours: 12:00-23:00 every day (Beirut), and a closure on Tuesday 20 October 2026.
insert into public.vendor_hours (vendor_id, weekday, opens, closes) select :'va', d, '12:00', '23:00' from generate_series(0, 6) d;
select tests.ok(app_private.vendor_opens_at(:'va', '2026-10-19 09:00+03') = '2026-10-19 12:00+03',
  'closed on Monday morning: opens at 12:00 the same day');
select tests.ok(app_private.vendor_opens_at(:'va', '2026-10-19 15:00+03') is null, 'open at 15:00: no opening to wait for');
insert into public.vendor_closures (vendor_id, day, reason) values (:'va', '2026-10-20', 'test');
select tests.ok(app_private.vendor_opens_at(:'va', '2026-10-19 23:30+03') = '2026-10-21 12:00+03',
  'after closing on Monday, with Tuesday closed: Wednesday at 12:00');
delete from public.vendor_closures where vendor_id = :'va';
update public.vendors set paused_until = '2026-10-19 10:00+03' where id = :'va';
select tests.ok(app_private.vendor_opens_at(:'va', '2026-10-19 09:00+03') = '2026-10-19 12:00+03',
  'a pause that ends before the hours: the hours decide');
update public.vendors set paused_until = '2026-10-19 13:30+03' where id = :'va';
select tests.ok(app_private.vendor_opens_at(:'va', '2026-10-19 09:00+03') = '2026-10-19 13:30+03',
  'a pause that ends inside the hours: the end of the pause');
delete from public.vendor_hours where vendor_id = :'va';

-- Now-based: a shop with no hours paused for 3 hours, another for 1 hour.
update public.vendors set paused_until = now() + interval '3 hours' where id = :'va';
select public.vendor_opening(array[:'va', :'vd']::uuid[]) as op \gset
select tests.ok((:'op'::jsonb) -> 0 ->> 'open_now' = 'false'
  and ((:'op'::jsonb) #>> '{0,opens,opens_at}')::timestamptz = now() + interval '3 hours'
  and (:'op'::jsonb) #>> '{0,opens,hm}' = to_char((now() + interval '3 hours') at time zone 'Asia/Beirut', 'HH24:MI')
  and ((:'op'::jsonb) #>> '{0,opens,in_days}')::int
      = ((now() + interval '3 hours') at time zone 'Asia/Beirut')::date - (now() at time zone 'Asia/Beirut')::date
  and (:'op'::jsonb) -> 1 ->> 'open_now' = 'true' and (:'op'::jsonb) -> 1 -> 'opens' = 'null'::jsonb,
  'vendor_opening: a paused shop opens when its pause ends (Beirut time), an open one has nothing to wait for');
update public.vendors set paused_until = 'infinity' where id = :'vd';
select tests.ok(public.vendor_opening(array[:'vd']::uuid[]) -> 0 -> 'opens' = 'null'::jsonb,
  'an indefinite pause (missed orders): no opening time is promised');
select tests.ok(jsonb_array_length(public.vendor_opening(array_fill(:'va'::uuid, array[30]))) = 20, 'at most 20 shops per call');

-- 3. "Shops near you are closed now" ----------------------------------------------------------------------------------------
select (public.customer_turn_begin('+96170000311', 'wamid.fc.x1', 'text', 'Near') #>> '{customer,id}') as x1 \gset
select (public.customer_turn_begin('+96170000312', 'wamid.fc.x2', 'text', 'Outside') #>> '{customer,id}') as x2 \gset
select (public.customer_turn_begin('+96170000313', 'wamid.fc.x3', 'text', 'Stopper') #>> '{customer,id}') as x3 \gset
select (public.customer_turn_begin('+96170000314', 'wamid.fc.x4', 'text', 'Quiet') #>> '{customer,id}') as x4 \gset
select tests.ok(public.shops_closed_near(:'x1') ->> 'status' = 'no_point', 'no saved pin: nothing to say yet');
insert into public.addresses (customer_id, place_id, pin, source, is_default, last_used_at) values
  (:'x1', 'LB-CHF-FCTOWN', 'SRID=4326;POINT(35.581 33.681)', 'pin', true, now()),
  (:'x2', 'LB-CHF-FCOUT', 'SRID=4326;POINT(35.50 33.70)', 'pin', true, now()),
  (:'x3', 'LB-CHF-FCOUT', 'SRID=4326;POINT(35.50 33.70)', 'pin', true, now()),
  (:'x4', 'LB-CHF-FCTOWN', 'SRID=4326;POINT(35.581 33.681)', 'pin', true, now());
update public.vendors set paused_until = now() + interval '1 hour' where id = :'vd';
select public.shops_closed_near(:'x1') as cn \gset
select tests.ok((:'cn'::jsonb) ->> 'status' = 'all_closed' and (:'cn'::jsonb) #>> '{first,vendor_id}' = :'vd'
  and ((:'cn'::jsonb) #>> '{first,opens,opens_at}')::timestamptz = now() + interval '1 hour'
  and ((:'cn'::jsonb) ->> 'shops')::int = 2,
  'every shop near the pin is closed: named with the one that opens first');
-- No cap on how many shops are looked at (§39.14 rule 2): 40 more closed shops right next to the pin and the one open shop
-- further out still make it "open".
insert into public.vendors (id, slug, name_ar, name_en, business_type, claim_status, orderable, source, place_id, location,
  delivery_radius_km, town_id, listing_status, paused_until)
select ('20000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, 'vendor-fc-many-' || g, 'محل ' || g, 'Many ' || g,
  'restaurant', 'claimed', true, 'merchant', 'gpFCM' || g, 'SRID=4326;POINT(35.5811 33.6811)', 5, 'LB-CHF-FCTOWN', 'active',
  now() + interval '2 hours'
from generate_series(1, 40) g;
update public.vendors set paused_until = null, location = 'SRID=4326;POINT(35.62 33.681)' where id = :'vd';
select tests.ok(public.shops_closed_near(:'x1') ->> 'status' = 'open'
  and (public.shops_closed_near(:'x1') ->> 'shops')::int = 42,
  'forty closed shops at the pin and one open 3.6 km away: open (no nearest-40 cap)');
delete from public.vendors where slug like 'vendor-fc-many-%';
update public.vendors set location = 'SRID=4326;POINT(35.585 33.682)' where id = :'vd';
select tests.ok(public.shops_closed_near(:'x1') ->> 'status' = 'open', 'one open shop: nothing to say');
select tests.ok(public.shops_closed_near(:'x2') ->> 'status' = 'outside', 'a pin outside the delivery area: the waitlist answers it');
-- The test shop takes any pin (DECISIONS §35): while one this customer can see is orderable, nothing is "outside".
insert into public.vendors (id, slug, name_ar, name_en, business_type, claim_status, orderable, source, place_id, location,
  delivery_radius_km, town_id, listing_status, is_test) values
  ('20000000-0000-0000-0000-0000000000f9', 'vendor-fc-test', 'محل تجربة', 'Test Grill FC', 'restaurant', 'claimed', true,
   'merchant', 'gpFCT', 'SRID=4326;POINT(35.585 33.682)', 5, 'LB-CHF-FCTOWN', 'active', true);
select tests.ok(public.waitlist_state(:'x2') ->> 'status' = 'test_shop', 'a visible test shop: the pin goes on as usual');
update public.vendors set pickup_enabled = true, delivery_enabled = false where id = '20000000-0000-0000-0000-0000000000f9';
select tests.ok(public.waitlist_state(:'x2') ->> 'status' = 'outside', 'a pickup-only test shop does not take the pin');
delete from public.vendors where id = '20000000-0000-0000-0000-0000000000f9';
select tests.ok(public.waitlist_state(:'x2') ->> 'status' = 'outside', 'without one: the waitlist');

-- 4. "Remind me when it opens" --------------------------------------------------------------------------------------------
select public.whatsapp_seen('+96170000311', '597907523413541');
select public.whatsapp_seen('+96170000314', '597907523413541');
select tests.ok(public.shop_reminder_set(:'x1', :'vd') ->> 'status' = 'open_now', 'an open shop: open now, no reminder');
select public.shop_reminder_set(:'x1', :'va') as r1 \gset
select tests.ok((:'r1'::jsonb) ->> 'status' = 'set' and ((:'r1'::jsonb) ->> 'new')::boolean
  and (select due_at = now() + interval '3 hours' and vendor_id = :'va' from app_private.shop_reminders where id = ((:'r1'::jsonb) ->> 'reminder_id')::uuid),
  'Remind me: due at the shop''s next opening, read by the server');
select tests.ok(public.shop_reminder_set(:'x1', :'va') ->> 'new' = 'false'
  and (select count(*) = 1 from app_private.shop_reminders where customer_id = :'x1' and vendor_id = :'va'),
  'tapping again keeps one reminder per customer and shop');
update public.vendors set paused_until = now() + interval '30 hours' where id = :'vd';
select tests.ok(public.shop_reminder_set(:'x1', :'vd') ->> 'status' = 'beyond_window'
  and not exists (select 1 from app_private.shop_reminders where customer_id = :'x1' and vendor_id = :'vd'),
  'an opening after the 24-hour window closes is not promised (WhatsApp would not let us send it)');
update public.vendors set paused_until = 'infinity' where id = :'vd';
select tests.ok(public.shop_reminder_set(:'x1', :'vd') ->> 'status' = 'no_time', 'no known opening: no reminder');
select tests.ok(public.shop_reminder_set(:'x1', '20000000-0000-0000-0000-00000000000c') ->> 'status' = 'unknown'
  and public.shop_reminder_set(:'x1', '20000000-0000-0000-0000-00000000000b') ->> 'status' = 'unknown',
  'a shop that is not on Alo King, or not orderable: unknown');
update public.vendors set paused_until = now() + interval '2 hours' where id = :'vd';
select public.shop_reminder_set(:'x1', null) as rany \gset
select tests.ok((:'rany'::jsonb) ->> 'status' = 'set'
  and (select due_at = now() + interval '2 hours' from app_private.shop_reminders where customer_id = :'x1' and vendor_id is null),
  '"any shop near me": due when the first one opens');
select tests.ok(public.shop_reminder_set(:'x2', null) ->> 'status' = 'none', 'any shop, with none near the pin: none');

-- The tick: due, open, window open: one service message.
update app_private.shop_reminders set due_at = now() - interval '1 minute' where customer_id = :'x1' and vendor_id = :'va';
update public.vendors set paused_until = null where id = :'va';
select app_private.customer_waits_tick() as t1 \gset
select tests.ok((:'t1'::jsonb) ->> 'reminders_sent' = '1'
  and (select payload ->> 'kind' = 'shop_open' and payload ->> 'vendor_id' = :'va' and purpose = 'customer_message'
       and target = '+96170000311' and order_id is null
       from public.outbound_messages where dedupe_key = 'shop_reminder:' || ((:'r1'::jsonb) ->> 'reminder_id')),
  'a due reminder for an open shop queues one customer message (kind shop_open)');
select tests.ok(app_private.customer_waits_tick() ->> 'reminders_sent' = '0'
  and (select count(*) = 1 from public.outbound_messages where dedupe_key like 'shop_reminder:%' and target = '+96170000311'),
  'never twice');
-- Still closed when due: moved to the next opening inside the window; beyond it, dropped.
select public.shop_reminder_set(:'x4', :'vd') as r4 \gset
update app_private.shop_reminders set due_at = now() - interval '1 minute' where id = ((:'r4'::jsonb) ->> 'reminder_id')::uuid;
update public.vendors set paused_until = now() + interval '45 minutes' where id = :'vd';
select app_private.customer_waits_tick();
select tests.ok((select due_at = now() + interval '45 minutes' and sent_at is null and dropped_at is null
  from app_private.shop_reminders where id = ((:'r4'::jsonb) ->> 'reminder_id')::uuid),
  'the shop paused again: the reminder moves to the new opening');
update app_private.shop_reminders set due_at = now() - interval '1 minute' where id = ((:'r4'::jsonb) ->> 'reminder_id')::uuid;
update public.vendors set paused_until = now() + interval '30 hours' where id = :'vd';
select app_private.customer_waits_tick();
select tests.ok((select drop_reason = 'closed' from app_private.shop_reminders where id = ((:'r4'::jsonb) ->> 'reminder_id')::uuid)
  and not exists (select 1 from public.outbound_messages where dedupe_key = 'shop_reminder:' || ((:'r4'::jsonb) ->> 'reminder_id')),
  'reopening after the window would close: dropped silently');
-- The window closed by the time it is due: dropped silently, nothing queued.
update public.vendors set paused_until = now() + interval '1 hour' where id = :'vd';
select public.shop_reminder_set(:'x4', :'vd') as r5 \gset
update app_private.shop_reminders set due_at = now() - interval '1 minute' where id = ((:'r5'::jsonb) ->> 'reminder_id')::uuid;
update public.vendors set paused_until = null where id = :'vd';
update app_private.whatsapp_windows set last_inbound_at = now() - interval '25 hours' where phone_e164 = '+96170000314';
select app_private.customer_waits_tick();
select tests.ok((select drop_reason = 'window' from app_private.shop_reminders where id = ((:'r5'::jsonb) ->> 'reminder_id')::uuid)
  and not exists (select 1 from public.outbound_messages where dedupe_key = 'shop_reminder:' || ((:'r5'::jsonb) ->> 'reminder_id')),
  'outside the 24-hour window at send time: dropped, never a template');
-- "Forget my history" after asking: dropped.
update public.vendors set paused_until = now() + interval '1 hour' where id = :'vd';
select public.shop_reminder_set(:'x1', :'vd') as r6 \gset
update app_private.shop_reminders set due_at = now() - interval '1 minute', created_at = now() - interval '1 hour'
where id = ((:'r6'::jsonb) ->> 'reminder_id')::uuid;
select public.customer_forget(:'x1', 'history');
select app_private.customer_waits_tick();
select tests.ok((select drop_reason = 'forgotten' from app_private.shop_reminders where id = ((:'r6'::jsonb) ->> 'reminder_id')::uuid),
  'forget my history: a waiting reminder is dropped');

-- 5. A shop link ------------------------------------------------------------------------------------------------------------
update public.vendors set paused_until = now() + interval '1 hour' where id = :'vd';
select tests.ok(public.shop_for_link(:'x1', 'vendor-fc-d') @> jsonb_build_object('status', 'orderable', 'vendor_id', :'vd', 'open_now', false)
  and public.shop_for_link(:'x1', ' VENDOR-A ') @> jsonb_build_object('status', 'orderable', 'vendor_id', :'va', 'open_now', true),
  'a shop link by slug (any case): the orderable shop, open or not');
select tests.ok(public.shop_for_link(:'x1', null, :'vd') ->> 'vendor_id' = :'vd', 'by id (the reminder''s See the menu button)');
select tests.ok(public.shop_for_link(:'x1', 'no-such-shop') ->> 'status' = 'unknown'
  and public.shop_for_link(:'x1', 'vendor-b') ->> 'status' = 'unknown', 'an unknown or unorderable shop: unknown');
update public.vendors set town_id = 'LB-CHF-FCTOWN' where id = '20000000-0000-0000-0000-00000000000c';
insert into public.app_config (key, value, effective_from, note) values
  ('pilot_merchant_place_ids', '["LB-CHF-FCTOWN"]', now() - interval '1 second', 'test');
select tests.ok(public.shop_for_link(:'x1', 'vendor-c') @> '{"status": "unclaimed", "slug": "vendor-c", "place_en": "Fctown"}'::jsonb
  and not (public.shop_for_link(:'x1', 'vendor-c') ? 'open_now'),
  'a shop that is not on Alo King yet: unclaimed, names and village only (§39.3)');

-- 6. The waitlist outside the delivery area -----------------------------------------------------------------------------------
select public.waitlist_state(:'x2') as ws \gset
select tests.ok((:'ws'::jsonb) @> '{"status": "outside", "place_id": "LB-CHF-FCOUT", "place_en": "Damour Test", "pickup": true, "joined": false}'::jsonb,
  'outside: the place by name, with pickup when a shop that takes pickup is within pickup_search_km');
update public.vendors set pickup_enabled = false where id = :'va';
select tests.ok(public.waitlist_state(:'x2') ->> 'pickup' = 'false', 'no pickup shop near: no Pick up instead');
select tests.ok(public.waitlist_state(:'x1') ->> 'status' = 'delivered', 'a place we deliver to: nothing to wait for');
select tests.ok(public.waitlist_state(:'x1', 'LB-CHF-FCOUT') ->> 'status' = 'no_point'
  and public.waitlist_state(:'x1', null, (select id from public.addresses where customer_id = :'x2')) ->> 'status' = 'no_point',
  'a place or an address that is not the customer''s own is refused');
select tests.ok(public.waitlist_state(:'x2', null, (select id from public.addresses where customer_id = :'x2')) ->> 'place_id' = 'LB-CHF-FCOUT',
  'the address just pinned decides, whatever the default address is');
select public.waitlist_join(:'x2', 'LB-CHF-FCOUT') as wj \gset
select tests.ok((:'wj'::jsonb) ->> 'status' = 'joined' and public.waitlist_join(:'x2') ->> 'status' = 'already'
  and (select count(*) = 1 from app_private.place_waitlist where customer_id = :'x2' and place_id = 'LB-CHF-FCOUT'),
  'Tell me when you do: one dated opt-in for the place');
select tests.ok(not (select marketing_opt_in from public.customers where id = :'x2'),
  'the opt-in is never marketing consent');
select public.waitlist_join(:'x3');
select public.whatsapp_seen('+96170000312', '597907523413541');
select public.whatsapp_seen('+96170000313', '597907523413541');
select tests.ok(app_private.customer_waits_tick() ->> 'waitlist_notified' = '0', 'nothing while the place is off');
-- STOP after joining.
update app_private.place_waitlist set created_at = now() - interval '1 hour' where customer_id = :'x3';
select public.customer_marketing_set(:'x3', false);
-- The place switches on.
select public.place_set_service_status('LB-CHF-FCOUT', 'on', 'test');
select app_private.customer_waits_tick() as t2 \gset
select tests.ok((:'t2'::jsonb) ->> 'waitlist_notified' = '1' and (:'t2'::jsonb) ->> 'waitlist_opted_out' = '1'
  and (select payload @> '{"kind": "waitlist_open", "place_en": "Damour Test"}'::jsonb and target = '+96170000312'
       from public.outbound_messages where dedupe_key like 'waitlist:%' and target = '+96170000312')
  and not exists (select 1 from public.outbound_messages where dedupe_key like 'waitlist:%' and target = '+96170000313'),
  'the place switches on: one notice to who asked; STOP after joining is honoured');
select tests.ok(app_private.customer_waits_tick() ->> 'waitlist_notified' = '0'
  and (select count(*) = 1 from public.outbound_messages where dedupe_key like 'waitlist:%'), 'once');
select tests.ok(public.waitlist_join(:'x2') ->> 'status' = 'delivered', 'joining a place that is on: delivered');

-- Outside the window, the notice waits for the approved UTILITY template; a template Meta filed as MARKETING never carries it.
select public.place_set_service_status('LB-CHF-FCOUT', 'off', 'test');
select (public.customer_turn_begin('+96170000315', 'wamid.fc.x5', 'text', 'Late') #>> '{customer,id}') as x5 \gset
insert into public.addresses (customer_id, place_id, pin, source, is_default, last_used_at)
values (:'x5', 'LB-CHF-FCOUT', 'SRID=4326;POINT(35.50 33.70)', 'pin', true, now());
select public.waitlist_join(:'x5');
insert into public.whatsapp_numbers (phone_number_id, role, waba_id, active) values ('15550008888', 'customer', '900000000088', true);
insert into public.whatsapp_templates (waba_id, name, language, category, status)
values ('900000000088', 'alo_waitlist_open', 'ar', 'MARKETING', 'approved');
select public.place_set_service_status('LB-CHF-FCOUT', 'on', 'test');
select app_private.customer_waits_tick();
select tests.ok((select notified_at is null and checked_at is not null from app_private.place_waitlist where customer_id = :'x5')
  and not exists (select 1 from public.outbound_messages where dedupe_key like 'waitlist:%' and target = '+96170000315'),
  'no window and no approved UTILITY template (Meta filed it as MARKETING): it waits, nothing is sent');
update public.whatsapp_templates set category = 'UTILITY' where waba_id = '900000000088' and name = 'alo_waitlist_open';
select app_private.customer_waits_tick();
select tests.ok(exists (select 1 from public.outbound_messages where dedupe_key like 'waitlist:%' and target = '+96170000315'),
  'once the UTILITY template is approved, the notice goes as that template');

-- "Delete my data": both kinds of rows go.
select public.shop_reminder_set(:'x4', null);
select public.whatsapp_seen('+96170000314', '597907523413541');
update public.vendors set paused_until = now() + interval '1 hour' where id in (:'va', :'vd');
select tests.ok(public.shop_reminder_set(:'x4', :'va') ->> 'status' = 'set', 'set again');
select public.customer_waits_forget(:'x4') as f4 \gset
select tests.ok((:'f4'::jsonb) ->> 'reminders' <> '0'
  and not exists (select 1 from app_private.shop_reminders where customer_id = :'x4'), 'its reminders go');
-- customer_forget('all') (the bot's "delete my data") removes them in its own transaction, never best effort.
select public.customer_forget(:'x2', 'all');
select tests.ok(not exists (select 1 from app_private.place_waitlist where customer_id = :'x2'),
  'delete my data removes the waitlist rows with everything else');

-- STOP after "Remind me": the reminder is dropped, never sent.
select public.shop_reminder_set(:'x4', :'va');
update app_private.shop_reminders set created_at = now() - interval '1 hour', due_at = now() - interval '1 minute'
where customer_id = :'x4' and sent_at is null and dropped_at is null;
select public.customer_marketing_set(:'x4', false);
select app_private.customer_waits_tick();
select tests.ok((select drop_reason = 'stopped' from app_private.shop_reminders where customer_id = :'x4' order by created_at desc limit 1),
  'STOP after Remind me: dropped (stopped), nothing sent');
-- Joining the waitlist again after STOP is a new opt-in, even before the tick has run.
select public.place_set_service_status('LB-CHF-FCOUT', 'off', 'test');
select public.waitlist_join(:'x3');
select tests.ok((select created_at >= (select marketing_opt_out_at from public.customers where id = :'x3') and notified_at is null and opted_out_at is null
                 from app_private.place_waitlist where customer_id = :'x3'),
  'a join after STOP counts from now');

-- 7. Security -----------------------------------------------------------------------------------------------------------------
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('customer_burst', 'webhook_defer', 'vendor_opening', 'shops_closed_near',
    'shop_reminder_set', 'shop_for_link', 'waitlist_state', 'waitlist_join', 'customer_waits_forget')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
         or not has_function_privilege('service_role', p.oid, 'execute') or not p.prosecdef)
), 'the new RPCs are security definer, service role only');
select tests.ok(not has_table_privilege('authenticated', 'app_private.shop_reminders', 'select')
  and not has_table_privilege('anon', 'app_private.place_waitlist', 'select'), 'the new tables are private');
select tests.ok(not exists (select 1 from cron.job where jobname = 'customer-waits-tick')
  and pg_get_functiondef('app_private.tick_minute()'::regprocedure) like '%customer_waits_tick%',
  'reminders and the waitlist are a step of the minute tick (isolated, alerted), not a cron job of their own');
select tests.ok(has_function_privilege('service_role', 'app_private.inbound_phone(jsonb)', 'execute'),
  'the service role can run the function its webhook_events index calls');

rollback;
