-- Alo King Chouf, session OPS1, part 3 (migration 0142): template health, for the console's Settings page; and the cron's age for /health.
--
-- One row per WhatsApp template we keep, saying where it stands and what happens to its message while it cannot be used.
--   state     approved            Meta approved it and it is filed as utility: it may be sent (template_sendable, 0121).
--             pending             draft or submitted: Meta has not decided.
--             moved_to_marketing  Meta filed it as marketing, approved or not. Never sent (CLAUDE.md invariant 17).
--             not_usable          rejected or paused.
--   fallback  none_needed                    the template is sendable.
--             free_text_in_24h_window        customer line: the same words as free text, which the gate lets out only inside the
--                                            customer's 24-hour window; outside it the message is skipped and logged (agent_runs,
--                                            outcome 'skipped', reason template_not_utility). Never a promotion in its place.
--             text_to_the_registered_phone   ops line: Kapso's sandbox holds no templates; the message goes as text to the one
--                                            registered phone (docs/DECISIONS.md, the staff line during testing).
--   skips_7d  how many messages of this template were skipped in the last seven days.
-- Read by the console with the service key; no public role may select it.

create or replace view template_health as
select t.name, t.line::text as line, t.language, t.category::text as category, t.status,
       case when t.category::text = 'marketing' then 'moved_to_marketing'
            when t.status = 'approved' and t.category::text = 'utility' then 'approved'
            when t.status in ('draft', 'submitted') then 'pending'
            else 'not_usable' end as state,
       case when t.status = 'approved' and t.category::text = 'utility' then 'none_needed'
            when t.line::text = 'ops' then 'text_to_the_registered_phone'
            else 'free_text_in_24h_window' end as fallback,
       (select count(*)::int from agent_runs r
         where r.agent = 'compliance_gateway' and r.outcome = 'skipped' and r.trace->>'template' = t.name
           and r.created_at > now() - interval '7 days') as skips_7d
  from wa_templates t;

do $$ declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table template_health from %I', r); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant select on table template_health to service_role; end if;
end $$;

-- Seconds since the minute cron last beat (cron_beat, 0063); null when it never has. The gateway's GET /health answers 200 only while this
-- is five minutes or less: the cron sends the alerts, retries lost events and runs the probe, so a silent cron is an outage. A free
-- uptime check watches /health (docs/HANDOFF.md, founder actions).
create or replace function cron_age_seconds() returns int language sql stable set search_path = public, pg_temp as $$
  select floor(extract(epoch from now() - at))::int from heartbeats where name = 'cron' $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
