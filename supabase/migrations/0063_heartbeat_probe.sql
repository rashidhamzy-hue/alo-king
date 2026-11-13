-- 0063 (session A2, task 4.10): silence is the failure nobody reports.
--
-- 1. Heartbeats. The cron writes one every run; the webhook writes one per line on every stored event.
-- 2. The probe: an hourly test order on STAGING, placed by a test customer and delivered by a test rider, through the same
--    conversation object, turn code, SQL and gateway as a real order. Probe parties are marked is_probe. Messages to them are
--    claimed in the outbox and logged like any other, but never handed to Kapso: can_send() answers 'probe_sink'.
--    Two locks keep it off in production: settings.probe.enabled (false here) and PROBE_MODE=on in the Worker's vars (staging only).
--    The same test rider delivers the 0.13 demo order: the founder orders from his own phone, the probe rider does the riding.
-- 3. heartbeat_alerts(): what the cron raises as an ops exception, alerts on, and reports to Sentry.
-- Kapso account enforcement events arrive on a project webhook (index.ts) and use the same exception queue.

create table if not exists heartbeats (name text primary key, at timestamptz not null default now(), detail jsonb not null default '{}');
alter table heartbeats enable row level security;

create or replace function beat(p_name text, p_detail jsonb default '{}') returns void language sql as $$
  insert into heartbeats(name, at, detail) values (p_name, now(), p_detail)
  on conflict (name) do update set at = now(), detail = excluded.detail $$;

alter table parties add column if not exists is_probe boolean not null default false;

insert into settings(key, value) values
  ('probe', '{"enabled": false, "every_minutes": 60, "stuck_after_minutes": 30, "order_text": "بدي علبتين لبنة ليبان ليه وربطتين خبز", "pin": null}'),
  ('heartbeat', '{"inbound_silence_hours": 6, "inbound_min_week": 20, "cron_gap_minutes": 5, "quality_ok": ["GREEN", "UNKNOWN"]}')
on conflict (key) do nothing;

-- The gate. Marketing first (0012's lock is unchanged), then probes, then every check that was there before.
create or replace function can_send(p_party uuid, p_line wa_line, p_category msg_category, p_is_template boolean)
returns text language plpgsql stable as $$
begin
  if p_category = 'marketing' and coalesce(setting('marketing')->>'enabled', 'false') <> 'true' then
    return 'marketing_disabled';
  end if;
  if exists (select 1 from parties where id = p_party and is_probe) then
    return case when coalesce(setting('probe')->>'enabled', 'false') = 'true' then 'probe_sink' else 'probe_disabled' end;
  end if;
  return can_send_checked(p_party, p_line, p_category, p_is_template);
end $$;

-- What a probe party was last sent and has not answered yet. The Worker reads the buttons in it and taps the next one.
create table if not exists probe_answers (dedupe_key text primary key, action text not null, at timestamptz not null default now());
alter table probe_answers enable row level security;

create or replace function probe_pending() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', x.dedupe_key, 'party_id', x.party_id, 'line', x.line, 'payload', x.payload,
           'wa_user_id', (select wa_user_id from party_identities i where i.party_id = x.party_id and i.line = x.line limit 1),
           'role', (select role from parties p where p.id = x.party_id))), '[]'::jsonb)
    from (select distinct on (o.party_id, o.line) o.* from wa_outbox o join parties p on p.id = o.party_id
           where p.is_probe and o.status = 'sent' and o.created_at > now() - interval '1 hour'
           order by o.party_id, o.line, o.created_at desc) x
   where coalesce(setting('probe')->>'enabled', 'false') = 'true'
     and not exists (select 1 from probe_answers a where a.dedupe_key = x.dedupe_key) $$;

create or replace function probe_answered(p_key text, p_action text) returns boolean language sql as $$
  insert into probe_answers(dedupe_key, action) values (p_key, p_action) on conflict do nothing returning true $$;

-- Time for the hourly test order? Only when the last one is finished (or given up on) and the hour has passed.
create or replace function probe_due() returns jsonb language sql stable as $$
  select case when coalesce(setting('probe')->>'enabled', 'false') <> 'true' then null else (
    select jsonb_build_object('party_id', p.id, 'wa_user_id', i.wa_user_id, 'text', setting('probe')->>'order_text')
      from parties p join party_identities i on i.party_id = p.id and i.line = 'customer'
     where p.is_probe and p.role = 'customer'
       -- the last test order message, whether or not it became an order yet (a turn can ask a question instead)
       and not exists (select 1 from wa_inbound_events e where e.idempotency_key like 'probe:%' and e.line = 'customer'
                        and e.payload->'message'->>'type' = 'text'
                        and e.received_at > now() - make_interval(mins => (setting('probe')->>'every_minutes')::int))
       and not exists (select 1 from orders o where o.customer_id = p.id
                        and (o.created_at > now() - make_interval(mins => (setting('probe')->>'every_minutes')::int)
                             or (o.status not in ('closed','cancelled','failed_delivery','returned')
                                 and o.created_at > now() - make_interval(mins => 3 * (setting('probe')->>'stuck_after_minutes')::int))))
     limit 1) end $$;

-- What is wrong right now. The caller keys each alert so it is raised once (per order, per hour or per day).
create or replace function heartbeat_alerts() returns jsonb language sql stable as $$
  with s as (select setting('heartbeat') h, setting('probe') p),
  hours as (select setting('hours') v),
  open_now as (select (now() at time zone (v->>'tz'))::time between (v->>'open')::time and (v->>'close')::time as is_open from hours),
  a as (
    -- the hourly test order did not finish
    select 'probe_stuck' as kind, o.id::text as ref, jsonb_build_object('order', o.short_code, 'status', o.status, 'minutes', round(extract(epoch from now() - o.created_at) / 60)) as detail
      from orders o join parties p on p.id = o.customer_id, s
     where p.is_probe and (s.p->>'enabled') = 'true' and o.status not in ('closed','cancelled','failed_delivery','returned')
       and o.created_at < now() - make_interval(mins => (s.p->>'stuck_after_minutes')::int)
    union all
    -- the probe should have ordered by now and has not (the cron or the turn path is broken)
    select 'probe_silent', to_char(now(), 'YYYY-MM-DD"T"HH24'), jsonb_build_object('last_order_at', max(o.created_at))
      from s, parties p left join orders o on o.customer_id = p.id
     where p.is_probe and p.role = 'customer' and (s.p->>'enabled') = 'true'
     group by s.p, p.created_at   -- a probe set up a minute ago has not had time to order yet
     having coalesce(max(o.created_at), p.created_at) < now() - make_interval(mins => 3 * (s.p->>'every_minutes')::int)
    union all
    -- real customers usually write, and nobody has for hours, while we are open: the webhook may be dead
    select 'inbound_silent', to_char(now(), 'YYYY-MM-DD"T"HH24'), jsonb_build_object('last', max(e.received_at), 'week', count(*))
      from s, open_now, wa_inbound_events e
     where open_now.is_open and e.line = 'customer' and e.event = 'whatsapp.message.received' and e.idempotency_key not like 'probe:%'
       and e.received_at > now() - interval '7 days'
     group by s.h having count(*) >= (s.h->>'inbound_min_week')::int
                    and max(e.received_at) < now() - make_interval(hours => (s.h->>'inbound_silence_hours')::int)
    union all
    -- the cron itself came back after a gap (its absence while dead is Sentry's cron monitor)
    select 'cron_gap', to_char(now(), 'YYYY-MM-DD"T"HH24'), jsonb_build_object('gap_minutes', round(extract(epoch from (b.at - (b.detail->>'previous')::timestamptz)) / 60))
      from heartbeats b, s
     where b.name = 'cron' and b.detail ? 'previous'
       and b.at - (b.detail->>'previous')::timestamptz > make_interval(mins => (s.h->>'cron_gap_minutes')::int))
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'ref', ref, 'detail', detail)), '[]'::jsonb) from a $$;

-- The cron's own beat keeps the previous one, so a gap can be seen once it is running again.
create or replace function cron_beat() returns void language sql as $$
  insert into heartbeats(name, at, detail) values ('cron', now(), '{}')
  on conflict (name) do update set detail = jsonb_build_object('previous', heartbeats.at), at = now() $$;

do $$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table heartbeats from %I', r);
      execute format('revoke all on table probe_answers from %I', r);
    end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
