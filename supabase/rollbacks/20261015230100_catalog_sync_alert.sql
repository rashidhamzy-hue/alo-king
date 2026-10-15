-- Rollback of 20261015230100_catalog_sync_alert.sql: the previous catalog_sync_finish and catalog_enqueue. Nothing is
-- dropped; the enum value 'catalog_sync_failed' (20261015230000) stays, as Postgres cannot remove an enum value, and
-- any alerts already raised with it stay too. Note the previous catalog_sync_finish raises an error on the fifth
-- failure in a row (its alert insert does not match public.ops_alerts).
begin;
create or replace function app_private.catalog_enqueue(p_vendor_id uuid, p_reason text, p_force boolean default false) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.whatsapp_catalogs c where c.transport is not null) then
    return;
  end if;
  -- A shop being deleted (its photos cascade first) is never queued.
  if not exists (select 1 from public.vendors v where v.id = p_vendor_id) then
    return;
  end if;
  -- A taken row (lease) or one in backoff after a failure keeps its time; queued_at moving on makes it run again after.
  -- clock_timestamp: a change in the same transaction as a claim still counts as newer than that claim.
  insert into app_private.catalog_sync_queue (vendor_id, reason, force, queued_at)
  values (p_vendor_id, left(p_reason, 80), coalesce(p_force, false), clock_timestamp())
  on conflict (vendor_id) do update set reason = excluded.reason, force = app_private.catalog_sync_queue.force or excluded.force,
    queued_at = clock_timestamp(),
    next_at = case when coalesce(app_private.catalog_sync_queue.leased_until, '-infinity') < now()
                        and app_private.catalog_sync_queue.last_error is null
                   then least(app_private.catalog_sync_queue.next_at, now()) else app_private.catalog_sync_queue.next_at end;
end;
$$;

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
    insert into public.ops_alerts (kind, severity, vendor_id, message)
    values ('catalog_sync_failed', 'warning', p_vendor_id, left('Catalogue sync failed 5 times: ' || p_error, 500));
  end if;
end;
$$;
commit;
