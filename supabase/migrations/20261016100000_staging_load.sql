-- Session 5e (16 October, Rasheed): the free staging instance must not stall during an investor demo.
--
-- 1. No background job runs more often than every 30 seconds. The five jobs that ran every 5 or 15 seconds
--    (dispatch-kick, order-escalation, order-monitor, recovery-tick, customer-bot-tick) become one job, `tick-30s`, and
--    the four one-minute jobs (claims-tick, hours-tick, availability-restore, gift-expire) become `tick-minute`. Each
--    step runs in its own sub-transaction, so one failing step never stops the others; a failure raises an operator alert.
--    Staging only in intent (DECISIONS §36): the cut-over (session 14) restores the 5 s / 15 s cadence on production,
--    where §23 (backup at 15 s, call at 45 s) and §27.5 (orders checked every 15 s) need it. The escalation layers keep their
--    configured delays; on a 30-second tick each layer fires up to 30 s after its time. Replies are not slower: every
--    inbound message still kicks `dispatch` from the webhook, and a message held back as `busy` is now waited for inside
--    the same dispatch run (webhook_next_due) instead of by the next kick.
-- 2. The catalogue reconcile works only on shops that changed: a shop is queued when its menu_version differs from the
--    version its last successful sync saw (or it never synced), every 10 minutes, instead of computing every shop's
--    whole catalogue every 10 minutes. Item availability that changes with time already bumps menu_version
--    (availability restores, stock reaching zero); the daily stock reset and any drift on Meta's side are caught by the
--    nightly full sync, which stays as DECISIONS §39.12 sets it (03:20 Beirut, outside demo hours).
-- 3. pg_cron's run history (cron.job_run_details, no index, a row per run) is pruned nightly to two days.

-- 1. Ticks -----------------------------------------------------------------------------------------------------------------
-- Runs each step in its own sub-transaction; a failing step is reported (the result, a warning, and one operator alert
-- per step per hour) and never stops the others.
create function app_private.tick_steps(p_tick text, p_steps text[]) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb := '{}';
  v_failed text[] := '{}';
  v_step text;
  v_out jsonb;
begin
  foreach v_step in array p_steps loop
    begin
      execute format('select to_jsonb(app_private.%I())', v_step) into strict v_out;
      r := r || jsonb_build_object(v_step, v_out);
    exception when others then
      v_failed := v_failed || v_step;
      raise warning '%: % failed: %', p_tick, v_step, sqlerrm;
      begin
        perform app_private.ops_alert(p_tick || ':' || v_step || ':' || to_char(now(), 'YYYYMMDDHH24'), 'tick_failed',
          'warning', left(format('Background job %s, step %s failed: %s', p_tick, v_step, sqlerrm), 300), null, null);
      exception when others then
        raise warning '%: could not raise the alert for %: %', p_tick, v_step, sqlerrm;
      end;
    end;
  end loop;
  return jsonb_build_object('ok', cardinality(v_failed) = 0, 'failed', to_jsonb(v_failed), 'steps', r);
end;
$$;
revoke all on function app_private.tick_steps(text, text[]) from public;

create function app_private.tick_30s() returns jsonb
language sql security definer set search_path = ''
as $$
  select app_private.tick_steps('tick-30s', array['order_escalation_tick', 'order_monitor_tick', 'recovery_tick',
    'customer_bot_tick', 'dispatch_kick']);
$$;
revoke all on function app_private.tick_30s() from public;

create function app_private.tick_minute() returns jsonb
language sql security definer set search_path = ''
as $$
  select app_private.tick_steps('tick-minute', array['claims_tick', 'hours_tick', 'availability_tick', 'gift_requests_expire']);
$$;
revoke all on function app_private.tick_minute() from public;

select cron.unschedule(j) from unnest(array['dispatch-kick', 'order-escalation', 'order-monitor', 'recovery-tick',
  'customer-bot-tick', 'claims-tick', 'hours-tick', 'availability-restore', 'gift-expire']) j
where exists (select 1 from cron.job where jobname = j);
select cron.schedule('tick-30s', '30 seconds', 'select app_private.tick_30s()');
select cron.schedule('tick-minute', '* * * * *', 'select app_private.tick_minute()');

-- 2. Catalogue: only shops that changed ----------------------------------------------------------------------------------
-- The menu_version each shop's last successful sync saw.
create table app_private.catalog_shop_synced (
  vendor_id uuid primary key references public.vendors (id) on delete cascade,
  menu_version bigint not null,
  synced_at timestamptz not null default now()
);
alter table app_private.catalog_shop_synced enable row level security;
revoke all on app_private.catalog_shop_synced from public, anon, authenticated;

create or replace function public.catalog_sync_finish(p_vendor_id uuid, p_queued_at timestamptz, p_error text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  q app_private.catalog_sync_queue%rowtype;
begin
  select * into q from app_private.catalog_sync_queue where vendor_id = p_vendor_id for update;
  if q.vendor_id is null then
    return;
  end if;
  if p_error is null then
    -- The version this sync covered: the shop's version now (a change after the claim also re-queued the shop).
    insert into app_private.catalog_shop_synced (vendor_id, menu_version, synced_at)
    select v.id, v.menu_version, now() from public.vendors v where v.id = p_vendor_id
    on conflict (vendor_id) do update set menu_version = excluded.menu_version, synced_at = excluded.synced_at;
    if q.queued_at <= p_queued_at then
      delete from app_private.catalog_sync_queue where vendor_id = p_vendor_id;
    else
      update app_private.catalog_sync_queue set next_at = now(), attempts = 0, last_error = null, leased_until = null
      where vendor_id = p_vendor_id;
    end if;
    return;
  end if;
  update app_private.catalog_sync_queue
  set last_error = left(p_error, 500), leased_until = null,
      next_at = now() + make_interval(secs => least(3600, 30 * power(2, least(q.attempts, 7))))
  where vendor_id = p_vendor_id;
  if q.attempts = 5 then
    perform app_private.ops_alert('catalog_sync_failed:' || p_vendor_id || ':' || to_char(now() at time zone 'Asia/Beirut', 'YYYYMMDD'),
      'catalog_sync_failed', 'warning', left('Catalogue sync failed 5 times in a row: ' || p_error, 300), null, p_vendor_id);
  end if;
end;
$$;
revoke all on function public.catalog_sync_finish(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.catalog_sync_finish(uuid, timestamptz, text) to service_role;

-- Every 10 minutes: shops whose menu changed since their last successful sync, and shops that left the catalogue but
-- still have visible products (their products are hidden). One small query; nothing is computed per product here.
create or replace function app_private.catalog_reconcile() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n int := 0;
  v uuid;
begin
  if not coalesce((public.config_value('catalog_enabled') #>> '{}')::boolean, false) then
    return 0;
  end if;
  for v in
    select x.id from public.vendors x
    left join app_private.catalog_shop_synced s on s.vendor_id = x.id
    where x.claim_status = 'claimed' and x.orderable and x.listing_status = 'active'
      and (s.vendor_id is null or s.menu_version is distinct from x.menu_version)
    union
    select distinct c.vendor_id from public.catalog_sync_items c
    join public.vendors x on x.id = c.vendor_id
    where c.visible and not (x.claim_status = 'claimed' and x.orderable and x.listing_status = 'active')
  loop
    perform app_private.catalog_enqueue(v, 'reconcile: changed', false);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function app_private.catalog_reconcile() from public;

select cron.schedule('catalog-reconcile', '*/10 * * * *', 'select app_private.catalog_reconcile()');

-- 3. Run history -------------------------------------------------------------------------------------------------------------
select cron.schedule('cron-history-prune', '41 2 * * *',
  $c$delete from cron.job_run_details where end_time < now() - interval '2 days'$c$);

-- 4. Inbound: how long until the next held or retried message is due ----------------------------------------------------
-- dispatch waits for it inside the same run when it is due before the run's budget ends (a `busy` message comes back
-- 5 s later), so replies do not wait for the 30-second tick.
create function public.webhook_next_due() returns numeric
language sql stable security definer set search_path = ''
as $$
  select round(greatest(0, extract(epoch from (min(q.vt) - clock_timestamp())))::numeric, 2)
  from pgmq.q_webhook_inbound q;
$$;
revoke all on function public.webhook_next_due() from public, anon, authenticated;
grant execute on function public.webhook_next_due() to service_role;
