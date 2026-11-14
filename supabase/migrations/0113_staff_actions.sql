-- Alo King Chouf, session D4 (console): the console's action log as a table (audit finding G1-16).
--
-- Until now each log entry was an object in the private `media` bucket named by the millisecond, so two entries in one
-- millisecond sorted "done" before "intent" and the log could not be queried. This is the same log, written by one
-- function, in order by a sequence, append-only.
--
--   Log first or nothing (3.1): the console writes the "intent" entry before it asks the database to do anything, and does
--   nothing if this function fails. The "done" entry follows. "event" is for sign-in, sign-out and the like.
--   Append-only: a trigger refuses update, delete and truncate, and the console's database layer has no insert verb at all:
--   the only way in is log_staff_action().
--   What goes in `args` is the console's choice: ids, amounts, lengths. Never a password, a message body, a voice note or a
--   receipt (CLAUDE.md: personal data is not logged).

create table staff_actions (
  seq         bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  environment text,
  party_id    uuid references parties(id),       -- null only for an event nobody was signed in for (a refused sign-in)
  user_id     text,
  role        text,
  action      text not null check (length(btrim(action)) > 0),
  phase       text not null check (phase in ('intent', 'done', 'event')),
  ref         text,                              -- ties an intent to its outcome
  args        jsonb,
  ok          boolean,
  result      text,
  error       text
);
create index staff_actions_party on staff_actions(party_id, seq desc);
create index staff_actions_ref on staff_actions(ref) where ref is not null;
create index staff_actions_action on staff_actions(action, seq desc);

create or replace function staff_actions_append_only() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'STAFF_ACTIONS_APPEND_ONLY: the action log is never changed or deleted';
end $$;
create trigger staff_actions_no_change before update or delete on staff_actions
  for each row execute function staff_actions_append_only();
create trigger staff_actions_no_truncate before truncate on staff_actions
  for each statement execute function staff_actions_append_only();

-- The one writer. Returns the entry's sequence number. A party that is not a staff role cannot have a non-event entry.
create or replace function log_staff_action(p_party uuid, p_user text, p_role text, p_environment text, p_action text, p_phase text,
                                            p_ref text default null, p_args jsonb default null, p_ok boolean default null,
                                            p_result text default null, p_error text default null)
returns bigint language plpgsql set search_path = public, pg_temp as $$
declare v_seq bigint;
begin
  if p_phase not in ('intent', 'done', 'event') then raise exception 'BAD_PHASE %', p_phase; end if;
  if p_party is null and p_phase <> 'event' then raise exception 'PARTY_REQUIRED: only an event may have no one signed in'; end if;
  if p_party is not null and not exists (select 1 from parties where id = p_party and role in ('admin', 'ops_lead', 'picker')) then
    raise exception 'NOT_STAFF';
  end if;
  insert into staff_actions(environment, party_id, user_id, role, action, phase, ref, args, ok, result, error)
    values (left(p_environment, 40), p_party, left(p_user, 80), left(p_role, 20), left(btrim(p_action), 80), p_phase, left(p_ref, 40),
            p_args, p_ok, left(p_result, 400), left(p_error, 400))
    returning seq into v_seq;
  return v_seq;
end $$;

alter table staff_actions enable row level security;
do $$ declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table staff_actions from %I', r); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert on table staff_actions to service_role;
  end if;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
