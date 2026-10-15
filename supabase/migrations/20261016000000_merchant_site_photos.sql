-- Item photos copied from a shop's own online menu are `merchant_site` (Rasheed, 15 October: the 8 menus he found,
-- most with item photos). It replaces `website`, which only Fred's Food used: its rows are deleted here and the next
-- demo-photos run copies them again under merchant_site/ and deletes the old Storage objects (objects without a row).
-- A merchant_site photo, like an illustrative one, goes when the shop is claimed: the merchant confirms their own (§15).
-- Rollback: supabase/rollbacks/20261016000000_merchant_site_photos.sql.

select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'item photo source website renamed merchant_site (DECISIONS §39.12)', true);

alter table public.menu_item_photos
  drop constraint menu_item_photos_path_source,
  drop constraint menu_item_photos_source_check,
  drop constraint menu_item_photos_storage_path_check;

delete from public.menu_item_photos where source = 'website';

alter table public.menu_item_photos
  -- <source>/<vendor id>/<item id>.<ext> in the private bucket menu-item-photos.
  add constraint menu_item_photos_storage_path_check
    check (storage_path ~ '^(merchant|merchant_site|illustrative)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  -- merchant: the merchant's own; merchant_site: copied from the shop's own online menu or website; illustrative: drawn
  -- for the demo. Google place photos are never item photos (§38.1).
  add constraint menu_item_photos_source_check check (source in ('merchant', 'merchant_site', 'illustrative')),
  add constraint menu_item_photos_path_source check (storage_path like source || '/%');

comment on column public.menu_item_photos.source is
  'merchant: the merchant''s own; merchant_site: copied from the shop''s own online menu or website (demo shops); illustrative: drawn for the demo. Never a Google place photo (DECISIONS §38.1).';

-- Illustrative and merchant_site photos go when the shop is claimed (the merchant confirms their own, §15), or leaves demo
-- mode. Their Storage objects are deleted by the next demo-photos run (objects without a row).
create or replace function app_private.vendors_drop_demo_photos() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.claim_status = 'claimed' and old.claim_status is distinct from 'claimed' and not app_private.vendor_is_demo(new.id) then
    delete from public.menu_item_photos where vendor_id = new.id and source in ('illustrative', 'merchant_site');
  end if;
  return new;
end;
$$;
revoke all on function app_private.vendors_drop_demo_photos() from public;
