-- 0090 (session A4, audit 14 Nov item 1): the heartbeat alarms stop crying wolf.
--
-- Seen on staging: "heartbeat:probe_silent" opened a new ops exception every hour the shop was closed (12 open on 14 Nov),
-- each with its own Sentry event and ops message, and nobody resolved them. Three causes, three fixes:
--   1. The probe orders only while the shop is open (outside hours its message gets the "we're closed" reply, no order).
--      probe_silent now needs the shop open AND three probe periods since the later of: the last probe order, the probe's
--      creation, and the moment the shop last opened. Opening hours that run past midnight are handled.
--   2. The ref was the hour ('2026-11-14T05'), so every hour of one silence was a new case. Conditions now carry a stable
--      ref (probe_silent: 'probe', inbound_silent: 'customer_line', cron_gap: 'cron'); probe_stuck stays per order.
--      The unique open index on ops_exceptions(kind, ref) then makes one problem one case.
--   3. clear_heartbeat_alarms(): the cron passes what is wrong now; every open heartbeat case not in that list is resolved
--      with detail.cleared_at. Only kinds starting 'heartbeat:' are touched: Kapso events, failed turns and the rest stay
--      with a person.
-- heartbeat_alerts() is 0063's text with these changes; nothing else in it moved.

create or replace function shop_open_now() returns boolean language sql stable as $$
  select case when (v->>'open')::time <= (v->>'close')::time
              then (now() at time zone (v->>'tz'))::time between (v->>'open')::time and (v->>'close')::time
              else (now() at time zone (v->>'tz'))::time >= (v->>'open')::time or (now() at time zone (v->>'tz'))::time <= (v->>'close')::time end
    from (select setting('hours') v) h $$;

-- The last moment the shop opened (today's opening if it has passed, else yesterday's), as a timestamp.
create or replace function shop_opened_at() returns timestamptz language sql stable as $$
  select (case when (now() at time zone (v->>'tz'))::time >= (v->>'open')::time
               then (now() at time zone (v->>'tz'))::date else (now() at time zone (v->>'tz'))::date - 1 end
          + (v->>'open')::time) at time zone (v->>'tz')
    from (select setting('hours') v) h $$;

create or replace function heartbeat_alerts() returns jsonb language sql stable as $$
  with s as (select setting('heartbeat') h, setting('probe') p),
  open_now as (select shop_open_now() as is_open, shop_opened_at() as opened_at),
  a as (
    -- the hourly test order did not finish (one case per order)
    select 'probe_stuck' as kind, o.id::text as ref, jsonb_build_object('order', o.short_code, 'status', o.status, 'minutes', round(extract(epoch from now() - o.created_at) / 60)) as detail
      from orders o join parties p on p.id = o.customer_id, s
     where p.is_probe and (s.p->>'enabled') = 'true' and o.status not in ('closed','cancelled','failed_delivery','returned')
       and o.created_at < now() - make_interval(mins => (s.p->>'stuck_after_minutes')::int)
    union all
    -- the probe should have ordered by now and has not (the cron or the turn path is broken). Only while open, and only
    -- once the shop has been open for three probe periods: the probe is not expected to order while closed.
    select 'probe_silent', 'probe', jsonb_build_object('last_order_at', max(o.created_at), 'opened_at', max(open_now.opened_at))
      from s, open_now, parties p left join orders o on o.customer_id = p.id
     where p.is_probe and p.role = 'customer' and (s.p->>'enabled') = 'true' and open_now.is_open
     group by s.p, p.created_at
    having greatest(coalesce(max(o.created_at), p.created_at), max(open_now.opened_at))
           < now() - make_interval(mins => 3 * (s.p->>'every_minutes')::int)
    union all
    -- real customers usually write, and nobody has for hours, while we are open: the webhook may be dead
    select 'inbound_silent', 'customer_line', jsonb_build_object('last', max(e.received_at), 'week', count(*))
      from s, open_now, wa_inbound_events e
     where open_now.is_open and e.line = 'customer' and e.event = 'whatsapp.message.received' and e.idempotency_key not like 'probe:%'
       and e.received_at > now() - interval '7 days'
     group by s.h having count(*) >= (s.h->>'inbound_min_week')::int
                    and max(e.received_at) < now() - make_interval(hours => (s.h->>'inbound_silence_hours')::int)
    union all
    -- the cron itself came back after a gap (its absence while dead is Sentry's cron monitor)
    select 'cron_gap', 'cron', jsonb_build_object('gap_minutes', round(extract(epoch from (b.at - (b.detail->>'previous')::timestamptz)) / 60))
      from heartbeats b, s
     where b.name = 'cron' and b.detail ? 'previous'
       and b.at - (b.detail->>'previous')::timestamptz > make_interval(mins => (s.h->>'cron_gap_minutes')::int))
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'ref', ref, 'detail', detail)), '[]'::jsonb) from a $$;

-- p_active: heartbeat_alerts()'s output. Every open heartbeat case that is not in it is over: resolved by the system, with a note.
create or replace function clear_heartbeat_alarms(p_active jsonb) returns int language sql as $$
  with done as (
    update ops_exceptions x set status = 'resolved', resolved_at = now(), detail = x.detail || jsonb_build_object('cleared_at', now(), 'cleared_by', 'heartbeat')
     where x.kind like 'heartbeat:%' and x.status <> 'resolved'
       and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_active) = 'array' then p_active else '[]'::jsonb end) a
                        where 'heartbeat:' || (a->>'kind') = x.kind and a->>'ref' = x.ref)
    returning 1)
  select count(*)::int from done $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
