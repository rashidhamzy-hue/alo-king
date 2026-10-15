-- Rollback for 20261015200000_meta_catalogue.sql (session 5d, DECISIONS §39.12). Run by hand on staging only if that
-- migration must be undone: stops the reconcile and nightly jobs, drops the catalogue queue, product sets, the simulated
-- catalogue opt-ins, whatsapp_catalogs and the new functions, restores dispatch_kick, catalog_desired, catalog_sync_record
-- and catalog_synced as in 20261011090200 / 20261011160000, and puts back the foreign key of catalog_sync_items (rows of
-- items that no longer exist are deleted first). Lost on purpose: the queue, the product set ids and the record of which
-- catalogue each item went to (the next sync after a re-apply sends everything again). Products already on Meta stay there
-- until a sync hides them. Config rows stay (dated rows are never deleted): add a newer `catalog_enabled` = false row.
begin;

select cron.unschedule('catalog-reconcile');
select cron.unschedule('catalog-nightly');

drop trigger if exists vendors_catalog_sync on public.vendors;
drop trigger if exists vendor_photos_catalog_sync on public.vendor_photos;

create or replace function app_private.dispatch_kick() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := (select value from app_private.runtime_settings where key = 'functions_base_url');
  v_secret text := (select value from app_private.runtime_settings where key = 'dispatch_secret');
begin
  if v_url is null then
    return null;
  end if;
  if not exists (select 1 from public.outbound_messages where status in ('queued', 'sending') and available_at <= now())
     and not exists (select 1 from public.ops_alerts where sent_at is null and send_attempts < 10)
     and not exists (select 1 from public.webhook_events where status in ('queued', 'failed') and attempts < 5) then
    return null;
  end if;
  return net.http_post(
    url := v_url || '/dispatch?forceFunctionRegion=eu-central-1',
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-dispatch-secret', v_secret),
    timeout_milliseconds := 10000
  );
end;
$$;
revoke all on function app_private.dispatch_kick() from public;

drop function if exists public.cart_merge(uuid, text, jsonb, boolean);
drop function if exists public.sim_catalog(text, boolean);
drop function if exists public.catalog_for_number(text, text);
drop function if exists public.catalog_products(uuid, text, uuid, uuid[], integer);
drop function if exists public.catalog_best_sellers(uuid, integer);
drop function if exists public.catalog_product_set(uuid, text, text);
drop function if exists public.catalog_sync_claim(integer);
drop function if exists public.catalog_sync_finish(uuid, timestamptz, text);
drop function if exists public.catalog_sync_state(uuid);
drop function if exists public.catalog_image(uuid);
drop function if exists public.whatsapp_catalog_record(text, text, text, boolean, text);
drop function if exists app_private.catalog_reconcile();
drop function if exists app_private.catalog_vendor_changed();
drop function if exists app_private.catalog_photo_changed();
drop function if exists app_private.catalog_enqueue_all(boolean, text);
drop function if exists app_private.catalog_enqueue(uuid, text, boolean);
drop table if exists app_private.sim_catalog_customers;
drop table if exists app_private.catalog_product_sets;
drop table if exists app_private.catalog_sync_queue;
drop table if exists public.whatsapp_catalogs;

create or replace function public.catalog_desired(p_vendor_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'retailer_id', i.id,
      'name', left(coalesce(i.name_ar, i.name_en, i.name_fr), 150),
      'name_en', i.name_en,
      'description', left(coalesce(i.description, ''), 500),
      'price_minor', round(i.price_usd * 100)::int,
      'currency', 'USD',
      'availability', case when app_private.menu_item_orderable(i.id, 1) then 'in stock' else 'out of stock' end,
      'product_set', v.id,
      'has_options', exists (select 1 from public.menu_option_groups g where g.item_id = i.id),
      'section', coalesce(s.name_ar, s.name_en, 'Menu'))
    order by s.sort_order nulls last, i.sort_order, i.id), '[]')
  from public.menu_items i
  join public.vendors v on v.id = i.vendor_id
  left join public.menu_sections s on s.id = i.section_id
  where i.vendor_id = p_vendor_id and v.claim_status = 'claimed' and v.orderable;
$$;

create or replace function public.catalog_sync_record(p_vendor_id uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  insert into public.catalog_sync_items (item_id, vendor_id, content_hash, synced_at)
  select (x ->> 'retailer_id')::uuid, p_vendor_id, x ->> 'hash', now()
  from jsonb_array_elements(coalesce(p_items, '[]')) x
  where exists (select 1 from public.menu_items i where i.id = (x ->> 'retailer_id')::uuid and i.vendor_id = p_vendor_id)
  on conflict (item_id) do update set content_hash = excluded.content_hash, synced_at = now();
  get diagnostics n = row_count;
  delete from public.catalog_sync_items c where c.vendor_id = p_vendor_id
    and not exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]')) x where (x ->> 'retailer_id')::uuid = c.item_id);
  return n;
end;
$$;

create or replace function public.catalog_synced(p_vendor_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(c.item_id, c.content_hash), '{}') from public.catalog_sync_items c where c.vendor_id = p_vendor_id;
$$;

delete from public.catalog_sync_items c where not exists (select 1 from public.menu_items i where i.id = c.item_id);
alter table public.catalog_sync_items drop column if exists visible, drop column if exists catalog_id;
alter table public.catalog_sync_items
  add constraint catalog_sync_items_item_id_fkey foreign key (item_id) references public.menu_items (id) on delete cascade;

commit;
