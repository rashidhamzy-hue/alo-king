-- Alo King Chouf: build plan 1.17 (session B3). Voice-note limits by sender role, read from settings.voice_limits (0011), and
-- the hourly budget per sender enforced across turns, not only inside one burst. Each processed note is recorded once (by its
-- WhatsApp message id, so a retried turn counts it once); the budget is the sum of the last hour, minus the notes of the turn
-- being decided. The reply to a note over a limit is written by code (packages/core/src/voice-policy.ts): nothing is dropped
-- in silence, and voice never moves money (invariant 18).

create table if not exists voice_usage (
  wa_message_id text primary key,
  party_id      uuid not null references parties(id),
  line          wa_line not null,
  role          text not null,
  seconds       int not null check (seconds > 0),
  at            timestamptz not null default now()
);
create index if not exists voice_usage_party_time on voice_usage (party_id, at);

create or replace function voice_budget(p_party uuid, p_exclude text[] default '{}') returns jsonb language sql stable as $$
  select jsonb_build_object(
    'limits', coalesce(setting('voice_limits'), '{}'::jsonb),
    'used', coalesce((select sum(seconds) from voice_usage
                        where party_id = p_party and at > now() - interval '1 hour' and not wa_message_id = any(coalesce(p_exclude, '{}'))), 0)::int)
$$;

create or replace function record_voice_usage(p_party uuid, p_line wa_line, p_role text, p_wamid text, p_seconds int) returns void language sql as $$
  insert into voice_usage(wa_message_id, party_id, line, role, seconds) values (p_wamid, p_party, p_line, p_role, greatest(1, p_seconds))
  on conflict (wa_message_id) do nothing
$$;

do $$ declare r text;
begin
  alter table voice_usage enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table voice_usage from %I', r); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
