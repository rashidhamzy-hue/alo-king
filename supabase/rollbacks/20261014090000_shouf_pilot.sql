-- Rollback for 20261014090000_shouf_pilot.sql (session D, DECISIONS §38).
-- The migration deletes the 2,044 nationwide seed vendors (source seed_2026_10). They are not restored by SQL:
-- restore the file and reload it, which recreates them unclaimed exactly as the first import did:
--   git show 0ada003:supabase/seed/vendors/source/alo_king_master_lebanon_vendors_cleaned.csv \
--     > supabase/seed/vendors/source/alo_king_master_lebanon_vendors_cleaned.csv
--   DB_URL=... FORCE=1 scripts/load-seed.sh
-- (after running this file, so the loader is back to its 20261008090300 form). Claims, menus and photos of the
-- Shouf merchants are lost with them; run the statements below only before any Shouf merchant claims.
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'rollback of session D (DECISIONS §38)', false);

drop function if exists app_private.shouf_load_seed(text);
drop function if exists public.lost_driver_calls_metric(integer);
drop function if exists public.order_lost_driver_call(uuid);
alter table public.orders drop column if exists lost_driver_calls;
alter table public.addresses drop constraint if exists addresses_relation_needs_landmark,
  drop column if exists landmark_relation, drop column if exists has_elevator;
drop type if exists public.landmark_relation;

-- OSM data and the promotion rules as before (osm rows deleted first, so the old check constraint holds).
drop function if exists app_private.osm_load_seed(text);
drop table if exists app_private.seed_osm_landmarks, app_private.seed_osm_aliases;
delete from public.landmarks where source = 'osm';
delete from public.place_aliases where source = 'osm';
alter table public.place_aliases drop column if exists osm_key, drop column if exists source;
alter table public.landmarks drop column if exists confidence, drop column if exists osm_ref;
alter table public.landmarks drop constraint landmarks_source_check;
alter table public.landmarks add constraint landmarks_source_check check (source in ('seed', 'operator', 'learned'));
-- promote_landmarks / promote_place_aliases: re-run their definitions from 20261008090100 (the osm branches
-- are inert once no osm row and no source column exist; re-create them before dropping the column above
-- if the database still runs the nightly job).

-- Photos (objects in the vendor-photos bucket are deleted with the Storage API or the dashboard first).
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "confirmed vendor photos are public" on storage.objects';
    execute 'drop policy if exists "vendor staff and operators read vendor photos" on storage.objects';
  end if;
end;
$$;
drop function if exists public.vendor_photos_remove_seed(uuid);
drop function if exists public.vendor_photo_decide(uuid, boolean, uuid);
drop table if exists public.vendor_photos;

-- Seed drafts and the Shouf vendors.
drop table if exists app_private.seed_menu_drafts;
delete from public.menu_drafts where source = 'seed';
drop index if exists public.menu_drafts_one_seed_idx;
alter table public.menu_drafts drop constraint menu_drafts_source_check;
alter table public.menu_drafts add constraint menu_drafts_source_check
  check (source in ('photo', 'pdf', 'link', 'instagram', 'text', 'fixture'));
delete from public.vendors v where v.source = 'seed_shouf_2026_10'
  and not exists (select 1 from public.orders o where o.vendor_id = v.id);
delete from public.vendor_import_exclusions where source = 'seed_shouf_2026_10';
delete from public.vendor_links where source !~ '^(seed_[0-9]{4}_[0-9]{2}|merchant|admin)$';
delete from app_private.seed_loads where name in ('vendors_shouf', 'osm_pilot');

-- Pilot villages: the config rows end; places keep their current status (switch them by hand if needed).
drop function if exists app_private.pilot_places_apply();
delete from public.app_config where effective_from = '2026-10-14 00:00+03'
  and key in ('pilot_place_ids', 'loc_door_max_accuracy_m', 'loc_door_radius_m', 'lost_driver_calls_target', 'seed_photo_max_px');

-- The loader as in 20261008090300.
drop function if exists app_private.vendors_load_seed(text, text, text);
drop function if exists app_private.seed_vendor_rows();
alter table app_private.seed_vendors drop column if exists town_id;
-- Re-run the `seed_vendor_rows` and `vendors_load_seed` definitions from 20261008090300_vendor_import.sql here.
alter table public.vendor_links drop constraint vendor_links_source_check;
alter table public.vendor_links add constraint vendor_links_source_check
  check (source ~ '^(seed_[0-9]{4}_[0-9]{2}|merchant|admin)$');
alter table public.vendors drop constraint vendors_source_check;
alter table public.vendors add constraint vendors_source_check
  check (source ~ '^(seed_[0-9]{4}_[0-9]{2}|google_live|merchant|admin)$');

select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);
