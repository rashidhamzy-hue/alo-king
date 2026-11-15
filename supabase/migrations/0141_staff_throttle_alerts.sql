-- Alo King Chouf, session OPS1, part 2 (migration 0141): staff and roles, the sign-in throttle, and what wakes a phone.
--
-- 1. set_staff(): add a staff member, change a role or name, block or unblock. One function, admin only, every change logged
--    in staff_changes with before and after. Until now staff were made by a workflow script that wrote to parties directly
--    (apps/console/scripts/staff.sh). The console reads the party on every request, so a block ends access at once.
--      * Only roles admin, ops_lead and picker; never a customer, a rider, a merchant or a probe party (NOT_STAFF).
--      * Nobody blocks or changes the role of their own party (CANNOT_CHANGE_SELF), so an admin is never the last one by their own
--        hand: any admin acting on another admin is, by acting, a second one.
--      * A blocked party cannot act (require_role). A blocked staff member loses push subscriptions through 0158's trigger.
--    The sign-in account itself (the Supabase Auth user, the emailed link) is made by the console Worker with the service key;
--    this function only decides who is staff and in what role.
-- 2. The sign-in throttle. signin_attempts holds failures per KEY, where a key is "e:" or "i:" plus 64 hex characters: a keyed hash
--    of the email or of the address, made by the Worker (HMAC with the session secret). No email address and no IP address is
--    ever stored, and a raw one is refused (BAD_KEY). Defaults (settings.signin_throttle, data): 5 failures per email and 20 per
--    address within 15 minutes lock that key for 15 minutes. A good sign-in clears the email's count; the address keeps its own.
-- 3. What wakes a phone (settings.push_alerts, data): hand-offs to a person (agent_handoff, model_capacity), the dead-letter queue
--    (dead_letter: a message that failed every retry), a stalled probe and a silent customer line join the kinds 0158 and 0140 set.
--    raise_dead_letter() is the Worker's call for each message in the dead-letter queue (one open exception per hour, counted).
--    Complaint cases: allergen and delivery problems were already there; HO1 adds its hand-off case kinds to the same list.
--    0140 may have run before 0158 on a fresh database: the row is made by whichever runs first and appended to here.

-- ---------- 1. staff ----------
create table if not exists staff_changes (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  by_party   uuid not null references parties(id),
  party_id   uuid not null references parties(id),
  action     text not null check (action in ('add', 'role', 'rename', 'block', 'unblock')),
  before     jsonb,
  after      jsonb not null
);
create index if not exists staff_changes_party on staff_changes(party_id, id);

create or replace function set_staff(p_by uuid, p_party uuid, p_name text, p_role text, p_blocked boolean default false)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_name text := btrim(coalesce(p_name, '')); v_old parties%rowtype; v_party uuid := p_party; v_action text; v_before jsonb; v_after jsonb;
begin
  perform require_role(p_by, array['admin']);
  if p_role is null or p_role not in ('admin', 'ops_lead', 'picker') then raise exception 'UNKNOWN_ROLE %', p_role; end if;
  if v_name = '' or length(v_name) > 80 then raise exception 'NAME_REQUIRED'; end if;
  v_after := jsonb_build_object('role', p_role, 'name', v_name, 'blocked', coalesce(p_blocked, false));
  if v_party is null then
    insert into parties(role, display_name, is_blocked) values (p_role::party_role, v_name, coalesce(p_blocked, false)) returning id into v_party;
    insert into staff_changes(by_party, party_id, action, before, after) values (p_by, v_party, 'add', null, v_after);
    return jsonb_build_object('party_id', v_party, 'changed', true, 'action', 'add');
  end if;
  select * into v_old from parties where id = v_party for update;
  if not found or v_old.is_probe or v_old.role::text not in ('admin', 'ops_lead', 'picker') then raise exception 'NOT_STAFF'; end if;
  v_before := jsonb_build_object('role', v_old.role, 'name', v_old.display_name, 'blocked', v_old.is_blocked);
  if v_party = p_by and (p_role <> v_old.role::text or coalesce(p_blocked, false) <> v_old.is_blocked) then raise exception 'CANNOT_CHANGE_SELF'; end if;
  v_action := case when coalesce(p_blocked, false) and not v_old.is_blocked then 'block'
                   when not coalesce(p_blocked, false) and v_old.is_blocked then 'unblock'
                   when p_role <> v_old.role::text then 'role'
                   when v_name is distinct from v_old.display_name then 'rename' end;
  if v_action is null then return jsonb_build_object('party_id', v_party, 'changed', false); end if;
  update parties set role = p_role::party_role, display_name = v_name, is_blocked = coalesce(p_blocked, false) where id = v_party;
  insert into staff_changes(by_party, party_id, action, before, after) values (p_by, v_party, v_action, v_before, v_after);
  return jsonb_build_object('party_id', v_party, 'changed', true, 'action', v_action);
end $$;

-- ---------- 2. the sign-in throttle ----------
insert into settings(key, value) values ('signin_throttle', '{"email_failures": 5, "ip_failures": 20, "window_minutes": 15, "lock_minutes": 15}') on conflict (key) do nothing;

create table if not exists signin_attempts (
  key_hash         text primary key check (key_hash ~ '^[ei]:[0-9a-f]{64}$'),
  failures         int not null default 0,
  first_failure_at timestamptz,
  locked_until     timestamptz,
  updated_at       timestamptz not null default now()
);
alter table signin_attempts enable row level security;

-- Allowed unless one of the keys is locked now. Answers how long to wait, so the page can say so.
create or replace function signin_allowed(p_keys text[]) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select case when max(locked_until) > now()
              then jsonb_build_object('allowed', false, 'retry_after_s', ceil(extract(epoch from (max(locked_until) - now())))::int)
              else jsonb_build_object('allowed', true) end
    from signin_attempts where key_hash = any(p_keys) $$;

-- One failed attempt on each key. The window starts at the first failure; a failure after the window starts a new one.
create or replace function signin_failed(p_keys text[]) returns void language plpgsql set search_path = public, pg_temp as $$
declare k text; cfg jsonb := coalesce(setting('signin_throttle'), '{}'::jsonb); v_win interval; v_lock interval; v_max int; r signin_attempts%rowtype;
begin
  v_win := make_interval(mins => coalesce((cfg->>'window_minutes')::int, 15));
  v_lock := make_interval(mins => coalesce((cfg->>'lock_minutes')::int, 15));
  foreach k in array coalesce(p_keys, '{}') loop
    if k !~ '^[ei]:[0-9a-f]{64}$' then raise exception 'BAD_KEY'; end if;
    v_max := case left(k, 1) when 'e' then coalesce((cfg->>'email_failures')::int, 5) else coalesce((cfg->>'ip_failures')::int, 20) end;
    insert into signin_attempts(key_hash, failures, first_failure_at) values (k, 0, now()) on conflict (key_hash) do nothing;
    select * into r from signin_attempts where key_hash = k for update;
    if r.first_failure_at is null or r.first_failure_at < now() - v_win then r.failures := 0; r.first_failure_at := now(); end if;
    r.failures := r.failures + 1;
    update signin_attempts set failures = r.failures, first_failure_at = r.first_failure_at, updated_at = now(),
           locked_until = case when r.failures >= v_max then now() + v_lock else locked_until end
     where key_hash = k;
  end loop;
  delete from signin_attempts where updated_at < now() - interval '2 days';
end $$;

create or replace function signin_ok(p_key text) returns void language sql set search_path = public, pg_temp as $$
  delete from signin_attempts where key_hash = p_key and p_key like 'e:%' $$;

-- ---------- 3. what wakes a phone ----------
insert into settings(key, value) values ('push_alerts', jsonb_build_object(
  'high_priority_kinds', jsonb_build_array('allergen_complaint', 'rider_off', 'pick_empty', 'delivery_problem', 'payment_proof', 'scheduled_stock_short', 'turn_failed', 'model_account'),
  'max_age_minutes', 120))
on conflict (key) do nothing;
update settings s set value = jsonb_set(s.value, '{high_priority_kinds}',
    (select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
       from jsonb_array_elements_text(coalesce(s.value->'high_priority_kinds', '[]'::jsonb) ||
            '["agent_handoff", "model_capacity", "dead_letter", "heartbeat:probe_stuck", "heartbeat:inbound_silent"]'::jsonb) x))
 where s.key = 'push_alerts';

-- The dead-letter queue (OPS1, item 5). One exception per hour with a running count, so a bad hour is one push, not a flood; the ops
-- line repeats it every ten minutes while it is open. The Worker calls this for each message that lands in the dead-letter queue.
create or replace function raise_dead_letter(p_line text, p_event text) returns uuid language plpgsql set search_path = public, pg_temp as $$
declare v uuid;
begin
  v := raise_ops_exception('dead_letter', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24'),
                           jsonb_build_object('line', left(coalesce(p_line, ''), 20), 'event', left(coalesce(p_event, ''), 60), 'first_at', now()));
  update ops_exceptions set detail = detail || jsonb_build_object('count', coalesce((detail->>'count')::int, 0) + 1, 'last_at', now()) where id = v;
  return v;
end $$;

-- ---------- grants: every new table and function is for the server role only ----------
do $$ declare t text; r text;
begin
  foreach t in array array['staff_changes', 'signin_attempts'] loop
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
