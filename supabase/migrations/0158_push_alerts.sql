-- Alo King Chouf, session D5 (console cockpit). Migrations 0158-0159.
--
-- 0158: web push for the console (docs/CONSOLE.md "The shell", docs/RESEARCH_REGISTER.md (f)).
--   Push is an extra, never the only alarm: the WhatsApp ops alert (ops_exceptions_due) and the console's exception list are
--   untouched. This only adds a second way for a *new high-priority* exception to reach a phone that has the console installed.
--
--   push_subscriptions   one row per browser endpoint, owned by exactly one staff party (the endpoint is unique: a phone passed to
--                        someone else is re-owned on their next save, never shared). Only an admin or ops lead can hold one,
--                        because only they see the exception list.
--   A subscription goes when its owner stops being able to use the console: blocked, or no longer an admin or ops lead (trigger),
--   or the party row is deleted (cascade). The sender also joins parties, so a row the trigger somehow missed is never sent to.
--   exception_pushes     one row per exception ever claimed for a push: the primary key is the "once per exception". The claim
--                        inserts before anything is sent, so a crash between claim and send loses a push (at most once), never
--                        repeats one. WhatsApp, which keeps its own ten-minute repeat, is the alarm that does not get lost.
--   settings.push_alerts which kinds are high priority, and how old an exception may be and still be pushed (so switching push
--                        on after a quiet week does not announce last week). Data, not code: a kind is added with one row.
--
-- Nothing here is sent from SQL. The console Worker's cron calls claim_exception_pushes(), then push_targets(), then sends.

create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  party_id     uuid not null references parties(id) on delete cascade,
  endpoint     text not null unique check (endpoint like 'https://%' and length(endpoint) <= 1000),
  p256dh       text not null check (length(p256dh) between 20 and 200),
  auth         text not null check (length(auth) between 8 and 100),
  user_agent   text,
  failures     int not null default 0,
  last_error   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_party on push_subscriptions(party_id);

create table if not exists exception_pushes (
  exception_id uuid primary key references ops_exceptions(id) on delete cascade,
  claimed_at   timestamptz not null default now()
);

insert into settings(key, value) values ('push_alerts', jsonb_build_object(
  'high_priority_kinds', jsonb_build_array('allergen_complaint', 'rider_off', 'pick_empty', 'delivery_problem', 'payment_proof', 'scheduled_stock_short', 'turn_failed'),
  'max_age_minutes', 120))
on conflict (key) do nothing;

-- Save (or re-own) this browser's subscription. Idempotent on the endpoint.
create or replace function save_push_subscription(p_party uuid, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare v uuid;
begin
  perform require_role(p_party, array['admin', 'ops_lead']);
  insert into push_subscriptions(party_id, endpoint, p256dh, auth, user_agent)
    values (p_party, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update set party_id = excluded.party_id, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, failures = 0, last_error = null, last_seen_at = now()
  returning id into v;
  return v;
end $$;

-- Turn push off on this browser. Only the owner can: another party's endpoint is left alone.
create or replace function remove_push_subscription(p_party uuid, p_endpoint text) returns boolean language plpgsql set search_path = public, pg_temp as $$
declare n int;
begin
  delete from push_subscriptions where endpoint = p_endpoint and party_id = p_party;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Who may be sent to now: a live subscription whose owner is still an admin or ops lead and not blocked.
create or replace function push_targets() returns table (endpoint text, p256dh text, auth text, party_id uuid)
language sql stable set search_path = public, pg_temp as $$
  select s.endpoint, s.p256dh, s.auth, s.party_id
    from push_subscriptions s join parties p on p.id = s.party_id
   where not p.is_blocked and p.role in ('admin', 'ops_lead') and s.failures < 5 $$;

-- The push service said the endpoint is gone (404, 410): drop it. Any other failure is counted, and five in a row retire it.
create or replace function push_endpoint_result(p_endpoint text, p_gone boolean, p_error text default null) returns void language plpgsql set search_path = public, pg_temp as $$
begin
  if p_gone then delete from push_subscriptions where endpoint = p_endpoint;
  elsif p_error is null then update push_subscriptions set failures = 0, last_error = null, last_seen_at = now() where endpoint = p_endpoint;
  else update push_subscriptions set failures = failures + 1, last_error = left(p_error, 200) where endpoint = p_endpoint;
  end if;
end $$;

-- New high-priority exceptions that nobody has been pushed about yet, claimed in the same statement so two overlapping runs cannot
-- both get one. Returns the exceptions themselves (the Worker words the notification; no customer detail is needed or sent).
create or replace function claim_exception_pushes(p_limit int default 20) returns setof ops_exceptions language plpgsql set search_path = public, pg_temp as $$
declare cfg jsonb := coalesce(setting('push_alerts'), '{}'::jsonb);
begin
  return query
  with due as (
    select e.id from ops_exceptions e
     where e.status = 'open'
       and e.kind in (select jsonb_array_elements_text(coalesce(cfg->'high_priority_kinds', '[]'::jsonb)))
       and e.created_at > now() - make_interval(mins => coalesce((cfg->>'max_age_minutes')::int, 120))
       and not exists (select 1 from exception_pushes x where x.exception_id = e.id)
     order by e.created_at limit greatest(1, least(p_limit, 50))
     for update of e skip locked),
  claimed as (insert into exception_pushes(exception_id) select id from due on conflict do nothing returning exception_id)
  select e.* from ops_exceptions e join claimed c on c.exception_id = e.id order by e.created_at;
end $$;

-- A staff member who is blocked, or is no longer an admin or ops lead, keeps no subscription.
create or replace function parties_drop_push() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.is_blocked or new.role not in ('admin', 'ops_lead') then delete from push_subscriptions where party_id = new.id; end if;
  return new;
end $$;
drop trigger if exists parties_drop_push on parties;
create trigger parties_drop_push after update of role, is_blocked on parties for each row execute function parties_drop_push();

-- Table lock-down, as for every later table: no client role reads or writes; the server role goes through the functions above.
do $$ declare t text; r text;
begin
  foreach t in array array['push_subscriptions', 'exception_pushes'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table %I to service_role', t); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
