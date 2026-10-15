-- Rollback of 20261016000000_merchant_site_photos.sql: back to the `website` source. merchant_site rows are deleted (the
-- previous demo-photos script copies the website images again as `website`).
select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'rollback: item photo source merchant_site', true);

alter table public.menu_item_photos
  drop constraint menu_item_photos_path_source,
  drop constraint menu_item_photos_source_check,
  drop constraint menu_item_photos_storage_path_check;

delete from public.menu_item_photos where source = 'merchant_site';

alter table public.menu_item_photos
  add constraint menu_item_photos_storage_path_check
    check (storage_path ~ '^(merchant|website|illustrative)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  add constraint menu_item_photos_source_check check (source in ('merchant', 'website', 'illustrative')),
  add constraint menu_item_photos_path_source check (storage_path like source || '/%');

comment on column public.menu_item_photos.source is null;

create or replace function app_private.vendors_drop_demo_photos() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.claim_status = 'claimed' and old.claim_status is distinct from 'claimed' and not app_private.vendor_is_demo(new.id) then
    delete from public.menu_item_photos where vendor_id = new.id and source in ('illustrative', 'website');
  end if;
  return new;
end;
$$;
revoke all on function app_private.vendors_drop_demo_photos() from public;
