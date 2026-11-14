-- 0091 (session A4, audit 14 Nov item 3): measure how long replies take. Lane B owns the fix; this is the instrument.
--
-- agent_latency: per day (Beirut), agent, model and turn path (agent_runs.trace->>'path'), the runs, p50 / p90 / max of
--   latency_ms (the turn alone: from runTurn's start to the run being recorded) and the mean tokens per run.
-- turn_waits: per Concierge turn, three numbers a customer would recognise:
--   wait_ms   the inbound event stored by the webhook -> the turn starting (includes BUFFER_SECONDS, the burst buffer)
--   turn_ms   latency_ms
--   reply_ms  the inbound event stored -> the run recorded (the reply has gone to the gateway by then)
--   The turn's start is created_at - latency_ms. Its inbound event is the sender's last one stored at or before that start,
--   within two minutes. The first numbers are in docs/HANDOFF.md (session A4).
-- Read-only views over agent_runs and wa_inbound_events. No client role can read them.

create or replace view agent_latency as
  select (r.created_at at time zone 'Asia/Beirut')::date as day, r.agent, r.model, coalesce(r.trace->>'path', '-') as path,
         count(*)::int as runs,
         round(percentile_cont(0.5) within group (order by r.latency_ms))::int as p50_ms,
         round(percentile_cont(0.9) within group (order by r.latency_ms))::int as p90_ms,
         max(r.latency_ms) as max_ms,
         round(avg(r.input_tokens))::int as in_tokens,
         round(avg(r.output_tokens))::int as out_tokens
    from agent_runs r
   where r.latency_ms is not null
   group by 1, 2, 3, 4;

create or replace view turn_waits as
  select r.id as run_id, r.conversation_id, r.trace->>'path' as path, r.created_at, e.received_at,
         round(extract(epoch from (r.created_at - make_interval(secs => r.latency_ms / 1000.0)) - e.received_at) * 1000)::int as wait_ms,
         r.latency_ms as turn_ms,
         round(extract(epoch from r.created_at - e.received_at) * 1000)::int as reply_ms,
         e.payload->'message'->>'type' as message_type
    from agent_runs r
    join conversations c on c.id = r.conversation_id
    cross join lateral (
      select ev.received_at, ev.payload from wa_inbound_events ev
       where ev.line = c.line and ev.event = 'whatsapp.message.received'
         and ev.received_at <= r.created_at - make_interval(secs => r.latency_ms / 1000.0)
         and ev.received_at > r.created_at - make_interval(secs => r.latency_ms / 1000.0) - interval '2 minutes'
         and exists (select 1 from party_identities i where i.party_id = c.party_id and i.line = c.line
                      and (i.wa_user_id = ev.payload->'message'->>'from_user_id'
                           or i.phone_e164 = '+' || regexp_replace(coalesce(ev.payload->'message'->>'from', ''), '\D', '', 'g')))
       order by ev.received_at desc limit 1) e
   where r.agent = 'concierge' and r.latency_ms is not null;

do $$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table agent_latency from %I', r);
      execute format('revoke all on table turn_waits from %I', r);
    end if;
  end loop;
end $$;
