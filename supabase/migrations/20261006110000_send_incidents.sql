-- Send-failure incidents (Meta 131042 payment eligibility, 130429 rate limit): one row per kind, an atomic recorder with a backoff ladder, and the broadcast pause.
-- Service role only. Orders and replies are never paused by this; only broadcasts check send_paused_until().
create table if not exists public.send_incidents (
  kind text primary key check (kind in ('payment', 'rate_limit')),
  level integer not null default 0,
  failures integer not null default 0,
  first_at timestamptz,
  last_at timestamptz,
  last_code integer,
  paused_until timestamptz,
  alerted_at timestamptz,
  alert_ok boolean
);
alter table public.send_incidents enable row level security;

-- Records one failure. A new incident starts after 24 quiet hours (counted from the end of the last pause). Climbing a rung of the backoff ladder happens only for a failure that arrives after the previous
-- pause ran out (failures already in flight during a pause do not escalate). Returns whether to alert the admin: once per incident, retried at most hourly if the alert itself could not be delivered.
-- Ladder (minutes): rate_limit 5, 15, 60, 180, 360; payment 60, 360, 1440, 1440, 1440.
create or replace function public.record_send_failure(p_kind text, p_code integer default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.send_incidents; n timestamptz := now(); fresh boolean; ladder integer[]; do_alert boolean := false;
begin
  if p_kind not in ('payment', 'rate_limit') then raise exception 'bad kind'; end if;
  insert into public.send_incidents(kind) values (p_kind) on conflict (kind) do nothing;
  select * into r from public.send_incidents where kind = p_kind for update;
  fresh := r.last_at is null or n - greatest(r.last_at, coalesce(r.paused_until, r.last_at)) > interval '24 hours'; -- 24 quiet hours counted from the end of the last pause, so the ladder can climb
  if fresh then r.level := 0; r.failures := 0; r.first_at := n; r.paused_until := null; r.alerted_at := null; r.alert_ok := null; end if;
  r.failures := r.failures + 1; r.last_at := n; r.last_code := p_code;
  ladder := case p_kind when 'rate_limit' then array[5, 15, 60, 180, 360] else array[60, 360, 1440, 1440, 1440] end;
  if r.paused_until is null or n >= r.paused_until then
    r.level := least(r.level + 1, 5);
    r.paused_until := n + make_interval(mins => ladder[r.level]);
  end if;
  if r.alerted_at is null or (r.alert_ok is distinct from true and r.alerted_at < n - interval '1 hour') then do_alert := true; r.alerted_at := n; r.alert_ok := null; end if;
  update public.send_incidents set level = r.level, failures = r.failures, first_at = r.first_at, last_at = r.last_at, last_code = r.last_code,
         paused_until = r.paused_until, alerted_at = r.alerted_at, alert_ok = r.alert_ok where kind = p_kind;
  return jsonb_build_object('alert', do_alert, 'level', r.level, 'paused_until', r.paused_until, 'failures', r.failures);
end $$;

-- Until when broadcasts are paused (null when they are not).
create or replace function public.send_paused_until() returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select max(paused_until) from public.send_incidents where paused_until > now() $$;

revoke all on public.send_incidents from anon, authenticated;
revoke all on function public.record_send_failure(text, integer) from public, anon, authenticated;
revoke all on function public.send_paused_until() from public, anon, authenticated;
grant execute on function public.record_send_failure(text, integer) to service_role;
grant execute on function public.send_paused_until() to service_role;
