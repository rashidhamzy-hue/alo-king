-- Session 5d follow-up (DECISIONS §39.12): the catalogue sync's fifth-failure alert, and a missing product set that no
-- longer holds a shop's updates.
--
-- 1. catalog_sync_finish wrote its alert with columns ops_alerts does not have (message; no dedupe_key or summary), so
--    the fifth failure in a row raised an error instead of an alert and the backoff update rolled back with it. The
--    alert now goes through app_private.ops_alert, once per shop per day.
-- 2. "catalogue product set not created" is a soft failure: the shop's products are all sent, only its product set is
--    missing (Meta refuses an empty set while it is still ingesting the products). A change to such a shop runs at once
--    instead of waiting out the backoff, so its availability and prices are never held behind the set.

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
  -- A shop whose only failure is its product set runs at once (its products are not held behind the set).
  -- clock_timestamp: a change in the same transaction as a claim still counts as newer than that claim.
  insert into app_private.catalog_sync_queue (vendor_id, reason, force, queued_at)
  values (p_vendor_id, left(p_reason, 80), coalesce(p_force, false), clock_timestamp())
  on conflict (vendor_id) do update set reason = excluded.reason, force = app_private.catalog_sync_queue.force or excluded.force,
    queued_at = clock_timestamp(),
    next_at = case when coalesce(app_private.catalog_sync_queue.leased_until, '-infinity') < now()
                        and coalesce(app_private.catalog_sync_queue.last_error, 'catalogue product set not created')
                            = 'catalogue product set not created'
                   then least(app_private.catalog_sync_queue.next_at, now()) else app_private.catalog_sync_queue.next_at end;
end;
$$;
