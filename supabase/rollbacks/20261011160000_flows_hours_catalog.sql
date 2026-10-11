-- Rollback for 20261011160000_flows_hours_catalog.sql. The migration itself deletes no data: the guard matches
-- the DELETE statements inside vendor_hours_set() and catalog_sync_record(), which run later. This file
-- removes what the migration created; vendors.cash_currencies and vendor_members.display_name are kept
-- (dropping them would lose merchant data).
select cron.unschedule('hours-tick');
-- Lift the pauses the hours tick set, so no branch stays closed by hours that no longer exist.
update public.vendors set paused_until = null, pause_reason = null where pause_reason = 'closed (hours)';
-- The config rows stay: dated rows are never deleted once in effect (dated_row_guard), and nothing reads them after this.
drop function if exists public.catalog_synced(uuid);
drop function if exists public.catalog_sync_record(uuid, jsonb);
drop function if exists public.catalog_desired(uuid);
drop table if exists public.catalog_sync_items;
drop function if exists public.flow_kill_gate();
drop function if exists public.flow_submit(text, text, jsonb);
drop function if exists public.flow_open(text, text, text, uuid, uuid, jsonb);
drop function if exists app_private.merchant_flow_data(uuid, text);
drop function if exists app_private.flow_enabled(text);
drop table if exists public.flow_submissions;
drop table if exists public.flow_sends;
drop function if exists app_private.vendor_hours_set(uuid, time, time, smallint[]);
drop function if exists app_private.hours_tick();
drop function if exists app_private.vendor_next_window(uuid, timestamptz);
drop function if exists app_private.vendor_next_open(uuid, timestamptz);
drop function if exists app_private.vendor_open_at(uuid, timestamptz);
drop table if exists public.vendor_hours;
