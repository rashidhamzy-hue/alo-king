-- Rollback of 20261016100000_staging_load.sql: the jobs go back to their own schedules (5, 15 and 30 seconds, one
-- minute), the reconcile back to every catalogue shop every 10 minutes. No data is lost: the
-- migration only adds catalog_shop_synced (dropped here) and prunes pg_cron's run history.
select cron.unschedule(j) from unnest(array['tick-30s', 'tick-minute', 'cron-history-prune']) j
where exists (select 1 from cron.job where jobname = j);

select cron.schedule('dispatch-kick', '5 seconds', 'select app_private.dispatch_kick()');
select cron.schedule('order-escalation', '5 seconds', 'select app_private.order_escalation_tick()');
select cron.schedule('order-monitor', '15 seconds', 'select app_private.order_monitor_tick()');
select cron.schedule('recovery-tick', '15 seconds', 'select app_private.recovery_tick()');
select cron.schedule('customer-bot-tick', '30 seconds', 'select app_private.customer_bot_tick()');
select cron.schedule('claims-tick', '* * * * *', 'select app_private.claims_tick()');
select cron.schedule('hours-tick', '* * * * *', 'select app_private.hours_tick()');
select cron.schedule('availability-restore', '* * * * *', 'select app_private.availability_tick()');
select cron.schedule('gift-expire', '* * * * *', 'select app_private.gift_requests_expire()');

create or replace function app_private.catalog_reconcile() returns integer
language plpgsql security definer set search_path = ''
as $$
begin
  if not coalesce((public.config_value('catalog_enabled') #>> '{}')::boolean, false) then
    return 0;
  end if;
  if (extract(minute from now())::int % greatest(1, public.config_numeric('catalog_reconcile_min')::int)) <> 0 then
    return 0;
  end if;
  return app_private.catalog_enqueue_all(false, 'reconcile');
end;
$$;
select cron.schedule('catalog-reconcile', '* * * * *', 'select app_private.catalog_reconcile()');

drop function if exists app_private.tick_30s();
drop function if exists app_private.tick_minute();
drop function if exists app_private.tick_steps(text, text[]);
drop function if exists public.webhook_next_due();
-- catalog_sync_finish as in 20261015230100 (it no longer records the synced version), then the table.
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
drop table if exists app_private.catalog_shop_synced cascade;
