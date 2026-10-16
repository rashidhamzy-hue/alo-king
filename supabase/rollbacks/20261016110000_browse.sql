-- Rollback of 20261016110000_browse.sql: no categories, covers or browse functions. Redeploy the dispatch function from
-- before session 5e PR 3 together with it (this one calls browse_shops after every pin). Roll back
-- 20261016120000_photo_sources.sql first when it is applied (its cover function and check use vendor_covers).
-- The two app_config rows stay: config rows are dated and never deleted, and nothing reads them without this migration.
-- What is lost: each shop's categories (recomputed from its menu on re-apply) and the demo shops' covers (made again by
-- the next demo-photos run; their objects stay in Storage until that run's clean-up).
select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'rollback: browsing through the bot (session 5e)', true);

drop function public.catalog_products_for(uuid[], text);
drop function public.catalog_shop_menu(uuid, text);
drop function public.shop_card(uuid);
drop function public.browse_shops(uuid, double precision, double precision, integer);

drop table public.vendor_covers;

drop trigger vendors_browse_refresh on public.vendors;
drop function app_private.vendors_browse_refresh();
drop function app_private.vendor_browse_refresh(uuid);
drop table app_private.vendor_browse_categories;
drop table public.browse_categories;
