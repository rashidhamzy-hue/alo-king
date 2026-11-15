-- Alo King Chouf, session OPS1, part 1 (migration 0140). Two things, both seen on staging on 15 November 2026.
--
-- A. The hourly probe orders AK-1043 (08:08 UTC) and AK-1044 (09:41 UTC) stopped at "confirmed" with no delivery and no offer.
--    Cause: every probe order is cash on delivery. The two probe riders collected the cash at each door and nothing ever handed
--    it in, so after about 19 orders each held more than settings.cash_cap.soft_usd (150): 152.67 and 157.67 at 11:21 UTC.
--    dispatch_order() skips a rider who is over the soft cap, found nobody, answered 'no_rider' every minute, and the order waited.
--    The cap did what CLAUDE.md invariant 5 says it must and is not touched. The probe was missing the last step of a rider's round.
--    probe_remit_cash() is that step: a probe rider with no job in hand declares a hub drop (declare_cash_drop, as a rider does)
--    and the probe's own ops lead confirms it (confirm_cash_drop, the same function the console calls). Same ledger entries as a
--    real drop. It acts only on parties marked is_probe, only while settings.probe.enabled is true (false in production), and
--    only when a probe ops lead exists (staging's prepare-staging.sql creates one; no migration does). The Worker calls it from
--    the probe step of its minute cron, which exists only where PROBE_MODE is "on" (staging).
--    It never touches a real rider's cash: the rider must be is_probe, and a test proves a real rider's balance stays.
--    heartbeat_alerts() now says why a probe order is stuck: how many riders are on shift and how many have room for it.
--
-- B. The model provider refused calls on 15 November ("You have reached your specified API usage limits ... 2026-12-01") and the
--    code treated it as any other error: a hand-off, an "agent_error" row, no alert. An account refusal (usage limit, billing,
--    invalid or revoked key) means every customer turn will fail until a person acts, so it is its own exception kind,
--    'model_account', with the reason as its ref (one open exception per reason):
--      raise_model_account(reason, detail)   raises it, or counts another refusal on the one that is open.
--      resolve_model_account()               the cron's minute job: resolved once a model run has succeeded after the last refusal.
--      settings.push_alerts                  'model_account' is high priority: pushed as soon as it opens.
--      settings.alert_repeat_minutes         {"model_account": 30}: neither the WhatsApp ops alert nor the push repeats it more
--                                            often than every 30 minutes while it stays open (every other kind keeps ten).
--    claim_exception_pushes() (0158) pushes an exception once, ever, and stays as it is. claim_alert_pushes() is the same claim
--    plus the repeat: a kind that has a repeat time is claimed again when that time has passed since its last push and it is
--    still open (acknowledged and resolved ones stay quiet); the age limit for a first push does not apply to such a kind,
--    because it is still open. The console's push job now calls claim_alert_pushes().
--    NUMBERING: this file sorts before D5's 0158, which was applied on staging first. So a fresh database (tests, production)
--    runs 0140 before 0158. Everything here that 0158 also makes is created "if not exists" with 0158's own shape, so either
--    order ends the same, and nothing here redefines a function 0158 would later replace.
--    The Worker words the alert and wraps the model client (packages/agents/src/model-account.ts); nothing here sends.

-- ---------- A. the probe hands its cash in ----------
create or replace function probe_remit_cash() returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_ops uuid; r record; n record; v_drop uuid; v_riders int := 0; v_usd numeric := 0;
begin
  if coalesce(setting('probe')->>'enabled', 'false') <> 'true' then return jsonb_build_object('skipped', 'probe_disabled'); end if;
  select id into v_ops from parties where is_probe and role = 'ops_lead' and not is_blocked order by created_at limit 1;
  if v_ops is null then return jsonb_build_object('skipped', 'no_probe_ops_lead'); end if;
  for r in select p.id from parties p
            where p.is_probe and p.role = 'driver' and not p.is_blocked
              and not exists (select 1 from deliveries d where d.driver_id = p.id and d.status in ('offered', 'accepted', 'in_progress'))
            order by p.created_at loop
    select * into n from driver_cash_native(r.id);
    continue when coalesce(n.usd, 0) <= 0 and coalesce(n.lbp, 0) <= 0;
    v_drop := declare_cash_drop(r.id, 'hub', greatest(coalesce(n.usd, 0), 0), greatest(coalesce(n.lbp, 0), 0), null, null);
    perform confirm_cash_drop(v_drop, v_ops);
    v_riders := v_riders + 1; v_usd := v_usd + greatest(coalesce(n.usd, 0), 0);
  end loop;
  return jsonb_build_object('riders', v_riders, 'usd', v_usd);
end $$;

-- 0090's heartbeat_alerts, with one change: a stuck probe order says how many riders are on shift and how many could take it.
create or replace function heartbeat_alerts() returns jsonb language sql stable as $$
  with s as (select setting('heartbeat') h, setting('probe') p),
  open_now as (select shop_open_now() as is_open, shop_opened_at() as opened_at),
  a as (
    -- the hourly test order did not finish (one case per order)
    select 'probe_stuck' as kind, o.id::text as ref, jsonb_build_object('order', o.short_code, 'status', o.status,
             'minutes', round(extract(epoch from now() - o.created_at) / 60),
             'riders_on_shift', (select count(*) from driver_shifts sh where sh.ended_at is null),
             'riders_with_room', (select count(*) from driver_shifts sh
                                   where sh.ended_at is null
                                     and not exists (select 1 from deliveries d where d.driver_id = sh.driver_id and d.status in ('offered', 'accepted', 'in_progress'))
                                     and driver_can_take(sh.driver_id, case when o.payment_method = 'cod' then o.total_usd else 0 end) = 'ok')) as detail
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

-- ---------- B. the model provider refuses for an account reason ----------
insert into settings(key, value) values ('alert_repeat_minutes', '{"model_account": 30}') on conflict (key) do nothing;

-- 0158 inserts this row with "on conflict do nothing": whichever file runs first makes it, and the other leaves it.
insert into settings(key, value) values ('push_alerts', jsonb_build_object(
  'high_priority_kinds', jsonb_build_array('allergen_complaint', 'rider_off', 'pick_empty', 'delivery_problem', 'payment_proof', 'scheduled_stock_short', 'turn_failed', 'model_account'),
  'max_age_minutes', 120))
on conflict (key) do nothing;
update settings set value = jsonb_set(value, '{high_priority_kinds}', coalesce(value->'high_priority_kinds', '[]'::jsonb) || '"model_account"'::jsonb)
 where key = 'push_alerts' and not coalesce(value->'high_priority_kinds', '[]'::jsonb) @> '"model_account"'::jsonb;

create table if not exists exception_pushes (
  exception_id uuid primary key references ops_exceptions(id) on delete cascade,
  claimed_at   timestamptz not null default now()
);
alter table exception_pushes add column if not exists pushes int not null default 1;
alter table exception_pushes add column if not exists last_pushed_at timestamptz not null default now();
alter table exception_pushes enable row level security;

-- One open exception per reason. A second refusal does not open another: it is counted on the first, with the time of the latest.
create or replace function raise_model_account(p_reason text, p_detail jsonb default '{}') returns uuid language plpgsql set search_path = public, pg_temp as $$
declare v uuid;
begin
  if p_reason is null or p_reason not in ('usage_limit', 'billing', 'invalid_key') then raise exception 'UNKNOWN_REASON %', p_reason; end if;
  v := raise_ops_exception('model_account', p_reason, jsonb_build_object('reason', p_reason, 'first_seen_at', now()) || coalesce(p_detail, '{}'::jsonb));
  update ops_exceptions set detail = detail || jsonb_build_object('last_refused_at', now(), 'refusals', coalesce((detail->>'refusals')::int, 0) + 1) where id = v;
  return v;
end $$;

-- Over, once a model run with tokens and a good outcome has been recorded after the last refusal. Called by the minute cron.
create or replace function resolve_model_account() returns int language sql set search_path = public, pg_temp as $$
  with done as (
    update ops_exceptions x set status = 'resolved', resolved_at = now(), detail = x.detail || jsonb_build_object('cleared_at', now(), 'cleared_by', 'model_ok')
     where x.kind = 'model_account' and x.status <> 'resolved'
       and exists (select 1 from agent_runs r where r.created_at > coalesce((x.detail->>'last_refused_at')::timestamptz, x.created_at)
                    and r.outcome = 'ok' and coalesce(r.input_tokens, 0) > 0)
    returning 1)
  select count(*)::int from done $$;

-- 0008's ops_exceptions_due: the ten-minute repeat is now per kind (settings.alert_repeat_minutes), and still ten for any kind not listed.
create or replace function ops_exceptions_due() returns setof ops_exceptions language sql set search_path = public, pg_temp as $$
  update ops_exceptions e set last_alert_at = now()
   where e.status = 'open'
     and (e.last_alert_at is null
          or e.last_alert_at < now() - make_interval(mins => coalesce((setting('alert_repeat_minutes')->>e.kind)::int, 10)))
  returning e.* $$;

-- 0158's claim, with the repeat for kinds that have a repeat time. Claims inside the same statement, under the row lock.
create or replace function claim_alert_pushes(p_limit int default 20) returns setof ops_exceptions language plpgsql set search_path = public, pg_temp as $$
declare cfg jsonb := coalesce(setting('push_alerts'), '{}'::jsonb);
        rep jsonb := coalesce(setting('alert_repeat_minutes'), '{}'::jsonb);
begin
  return query
  with due as (
    select e.id from ops_exceptions e
     where e.status = 'open'
       and e.kind in (select jsonb_array_elements_text(coalesce(cfg->'high_priority_kinds', '[]'::jsonb)))
       and (
            (not exists (select 1 from exception_pushes x where x.exception_id = e.id)
             and (e.created_at > now() - make_interval(mins => coalesce((cfg->>'max_age_minutes')::int, 120)) or (rep->>e.kind) is not null))
         or exists (select 1 from exception_pushes x
                     where x.exception_id = e.id and (rep->>e.kind) is not null
                       and x.last_pushed_at < now() - make_interval(mins => (rep->>e.kind)::int)))
     order by e.created_at limit greatest(1, least(p_limit, 50))
     for update of e skip locked),
  claimed as (
    insert into exception_pushes(exception_id) select id from due
    on conflict (exception_id) do update set pushes = exception_pushes.pushes + 1, last_pushed_at = now()
    returning exception_id)
  select e.* from ops_exceptions e join claimed c on c.exception_id = e.id order by e.created_at;
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
