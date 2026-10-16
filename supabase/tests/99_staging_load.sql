-- Session 5e (16 October): no background job more often than every 30 seconds; the catalogue reconcile queues only
-- shops whose menu changed since their last successful sync; dispatch can see when the next held message is due.
begin;

select tests.ok(not exists (
    select 1 from cron.job
    where schedule ~ '^[0-9]+ seconds$' and split_part(schedule, ' ', 1)::int < 30),
  'no pg_cron job runs more often than every 30 seconds');
select tests.ok(exists (select 1 from cron.job where jobname = 'tick-30s' and schedule = '30 seconds')
  and exists (select 1 from cron.job where jobname = 'tick-minute' and schedule = '* * * * *'),
  'the 30-second and one-minute ticks are scheduled');
select tests.ok(not exists (select 1 from cron.job where jobname in ('dispatch-kick', 'order-escalation', 'order-monitor',
    'recovery-tick', 'customer-bot-tick', 'claims-tick', 'hours-tick', 'availability-restore', 'gift-expire')),
  'the jobs they replace are gone');
select tests.ok((select schedule from cron.job where jobname = 'catalog-reconcile') = '*/10 * * * *',
  'the catalogue reconcile runs every 10 minutes, not every minute');
select tests.ok((select command from cron.job where jobname = 'catalog-nightly') like '%(false,%'
  and (select command from cron.job where jobname = 'catalog-weekly-full') like '%(true,%',
  'the nightly catalogue run is a diff; the forced full re-send is weekly');
select tests.ok(exists (select 1 from cron.job where jobname = 'cron-history-prune'), 'pg_cron history is pruned');

-- Each tick runs every step, even when one fails.
select tests.ok((app_private.tick_30s() ->> 'ok')::boolean and (app_private.tick_minute() ->> 'ok')::boolean,
  'the ticks run');

-- The reconcile: a catalogue that can be written, two claimed shops, one synced at its current version.
insert into public.whatsapp_catalogs (waba_id, catalog_id, transport)
  values ('900000000099', '1234567890099', 'graph') on conflict do nothing;
insert into public.vendors (id, slug, name_en, business_type, claim_status, public_page, orderable, source, place_id, location)
values ('5e000000-0000-0000-0000-000000000001', 'load-test-a', 'Load Test A', 'restaurant', 'claimed', true, true, 'merchant',
        'gp5eA', 'SRID=4326;POINT(35.55 33.68)'),
       ('5e000000-0000-0000-0000-000000000002', 'load-test-b', 'Load Test B', 'restaurant', 'claimed', true, true, 'merchant',
        'gp5eB', 'SRID=4326;POINT(35.55 33.68)');
delete from app_private.catalog_sync_queue;
insert into app_private.catalog_shop_synced (vendor_id, menu_version)
  select id, menu_version from public.vendors where id = '5e000000-0000-0000-0000-000000000001';
select app_private.catalog_reconcile();
select tests.ok(not exists (select 1 from app_private.catalog_sync_queue where vendor_id = '5e000000-0000-0000-0000-000000000001'),
  'a shop synced at its current menu version is not queued');
select tests.ok(exists (select 1 from app_private.catalog_sync_queue where vendor_id = '5e000000-0000-0000-0000-000000000002'),
  'a shop that never synced is queued');

delete from app_private.catalog_sync_queue;
update public.vendors set menu_version = menu_version + 1 where id = '5e000000-0000-0000-0000-000000000001';
delete from app_private.catalog_sync_queue;
select app_private.catalog_reconcile();
select tests.ok(exists (select 1 from app_private.catalog_sync_queue where vendor_id = '5e000000-0000-0000-0000-000000000001'),
  'a shop whose menu changed since its last sync is queued');

-- A successful sync records the version it covered.
update app_private.catalog_sync_queue set queued_at = now() - interval '1 minute';
select public.catalog_sync_finish('5e000000-0000-0000-0000-000000000001', now(), null);
select tests.ok((select s.menu_version = v.menu_version from app_private.catalog_shop_synced s
  join public.vendors v on v.id = s.vendor_id where s.vendor_id = '5e000000-0000-0000-0000-000000000001'),
  'a successful sync records the menu version it covered');

-- The next held inbound message.
select tests.ok(public.webhook_next_due() is null or public.webhook_next_due() >= 0, 'webhook_next_due answers');
select pgmq.send('webhook_inbound', '{"event_id": -1}'::jsonb, 7);
select tests.ok(public.webhook_next_due() between 5 and 7, 'a message coming back in 7 s is due in about 7 s');
set local role service_role;
select tests.ok(public.webhook_next_due() is not null, 'dispatch (service role) can read it');

rollback;
