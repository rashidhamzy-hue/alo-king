-- Session D, the Shouf data load (DECISIONS §38.1–38.2, §38.3 rows "address fields" and "Google Maps terms").
-- 1. The 2,044 nationwide seed vendors (source seed_2026_10) are deleted; the Shouf file replaces them.
-- 2. Seed sources may name their file (`seed_shouf_2026_10`); the vendor loader takes the source, the
--    load name and a town per row (the Shouf village).
-- 3. The pilot villages are a dated config row; `pilot_places_apply()` switches them on and every other
--    place that is on, off (paused places stay paused; the staging "Test location" aside).
-- 4. Draft menus from the seed (`menu_drafts.source = seed`), never orderable until the merchant approves.
-- 5. Seed photos: copied into the private `vendor-photos` bucket by scripts/shouf/copy-photos.mjs; shown only
--    after the merchant confirms them on a claimed, public vendor; removed on request. The Google URL itself
--    is never stored, only its hash (so a removed photo is never copied again).
-- 6. OpenStreetMap landmarks and place aliases for the pilot area (source `osm`, low confidence).
-- 7. Address fields and the lost-driver-calls metric (§38.3: landmark_relation, floor, has_elevator,
--    lost_driver_calls, door point within 60 m at 25 m accuracy, target under 0.5 per delivery).
-- The Shouf rows themselves are loaded by scripts/load-seed.sh (staging after each deploy, CI's throwaway
-- database), never by this migration. Rollback: supabase/rollbacks/20261014090000_shouf_pilot.sql.

select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'session D: Shouf-first pilot (DECISIONS §38)', false);

-- 1. Nationwide seed vendors -----------------------------------------------------------------------------
-- Only rows nothing else depends on: an order or a ledger account would keep its vendor (none on staging).
delete from public.vendors v
where v.source = 'seed_2026_10'
  and not exists (select 1 from public.orders o where o.vendor_id = v.id)
  and not exists (select 1 from public.ledger_accounts a where a.vendor_id = v.id);
delete from public.vendor_import_exclusions where source = 'seed_2026_10';
delete from public.brands b where not exists (select 1 from public.vendors v where v.brand_id = b.id);
delete from app_private.seed_loads where name = 'vendors';

-- 2. Seed sources and the loader ------------------------------------------------------------------------
alter table public.vendors drop constraint vendors_source_check;
alter table public.vendors add constraint vendors_source_check
  check (source ~ '^(seed(_[a-z]+)?_[0-9]{4}_[0-9]{2}|google_live|merchant|admin)$');
alter table public.vendor_links drop constraint vendor_links_source_check;
alter table public.vendor_links add constraint vendor_links_source_check
  check (source ~ '^(seed(_[a-z]+)?_[0-9]{4}_[0-9]{2}|merchant|admin)$');
comment on column public.vendors.source is
  'seed_<yyyy>_<mm> or seed_<file>_<yyyy>_<mm> for imports (seed_shouf_2026_10: the Shouf pilot file, §38), google_live, merchant or admin.';

alter table app_private.seed_vendors add column town_id text;

drop function app_private.vendors_load_seed(text, text);
drop function app_private.seed_vendor_rows();

create function app_private.seed_vendor_rows()
returns table (
  place_id text, slug text, name_ar text, name_en text, branch_label text, business_type text,
  phone_seed text, phone_seed_mobile boolean, address_seed text, brand_slug text, brand_name_en text,
  brand_name_ar text, links text, import_labels text, location extensions.geography, tags text[], town_id text
)
language sql
stable
set search_path = ''
as $$
  select v.place_id, v.slug, v.name_ar, v.name_en, v.branch_label, v.business_type, v.phone_seed,
    v.phone_seed_mobile, v.address_seed, v.brand_slug, v.brand_name_en, v.brand_name_ar, v.links, v.import_labels,
    case when v.lat is not null and v.lon is not null
      then extensions.st_setsrid(extensions.st_makepoint(v.lon, v.lat), 4326)::extensions.geography end,
    array(select t from unnest(coalesce(nullif(v.cuisine_tags, ''), '{}')::text[]) t
          where exists (select 1 from public.cuisine_tags c where c.tag = t and c.active) order by t),
    (select p.id from public.places p where p.id = nullif(v.town_id, ''))
  from app_private.seed_vendors v
  where not exists (select 1 from public.vendor_removed_places r where r.place_id = v.place_id);
$$;
revoke all on function app_private.seed_vendor_rows() from public, anon, authenticated;

-- As in 20261008090300 (§15.2: unclaimed, not orderable, not public; only fields still `seed` are refreshed),
-- plus: the source may name its file, the load is recorded under p_load_name, and a row's town (when the
-- file gives one that exists) is used instead of the pin's nearest place.
create function app_private.vendors_load_seed(p_sha256 text, p_source text default 'seed_2026_10', p_load_name text default 'vendors')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seed_fields constant text[] := array['name_ar', 'name_en', 'branch_label', 'business_type', 'cuisine_tags', 'location'];
  v_all_seed jsonb := (select jsonb_object_agg(f, 'seed') from unnest(v_seed_fields || array['town_id', 'phone', 'address']) f);
  n_brands integer;
  n_new integer;
  n_updated integer;
  n_towns integer;
  n_private integer;
  n_links integer;
  n_excluded integer;
  n_removed integer;
  n_claimed integer;
begin
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'vendor seed ' || left(p_sha256, 12), true);
  if p_source !~ '^seed(_[a-z]+)?_[0-9]{4}_[0-9]{2}$' then
    raise exception 'seed source must look like seed_2026_10 or seed_shouf_2026_10' using errcode = 'invalid_parameter_value';
  end if;
  if p_load_name !~ '^vendors(_[a-z]+)?$' then
    raise exception 'load name must look like vendors or vendors_shouf' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from app_private.seed_vendors) = 0 then
    raise exception 'the vendor seed is empty' using errcode = 'no_data_found';
  end if;

  select count(*) into n_removed from app_private.seed_vendors v
  where exists (select 1 from public.vendor_removed_places r where r.place_id = v.place_id);

  insert into public.brands (slug, name_ar, name_en)
  select distinct on (s.brand_slug) s.brand_slug, nullif(s.brand_name_ar, ''), nullif(s.brand_name_en, '')
  from app_private.seed_vendor_rows() s where nullif(s.brand_slug, '') is not null and coalesce(nullif(s.brand_name_ar, ''), nullif(s.brand_name_en, '')) is not null
  order by s.brand_slug, s.place_id
  on conflict (slug) do nothing;
  get diagnostics n_brands = row_count;

  insert into public.vendors (slug, name_ar, name_en, branch_label, business_type, cuisine_tags, claim_status,
    orderable, public_page, source, field_sources, place_id, location, town_id, brand_id)
  select
    case when exists (select 1 from public.vendors x where x.slug = s.slug)
      then left(s.slug, 48) || '-' || lower(regexp_replace(right(s.place_id, 10), '[^A-Za-z0-9]', '', 'g'))
      else s.slug end,
    nullif(s.name_ar, ''), nullif(s.name_en, ''), nullif(s.branch_label, ''), s.business_type::public.business_type,
    s.tags, 'unclaimed', false, false, p_source, v_all_seed, s.place_id, s.location, s.town_id,
    (select b.id from public.brands b where b.slug = nullif(s.brand_slug, ''))
  from app_private.seed_vendor_rows() s
  where not exists (select 1 from public.vendors v where v.place_id = s.place_id);
  get diagnostics n_new = row_count;

  update public.vendors v
  set name_ar = case when coalesce(v.field_sources ->> 'name_ar', case when v.source ~ '^seed_' then 'seed' end) = 'seed' then nullif(s.name_ar, '') else v.name_ar end,
      name_en = case when coalesce(v.field_sources ->> 'name_en', case when v.source ~ '^seed_' then 'seed' end) = 'seed' then nullif(s.name_en, '') else v.name_en end,
      branch_label = case when coalesce(v.field_sources ->> 'branch_label', case when v.source ~ '^seed_' then 'seed' end) = 'seed' then nullif(s.branch_label, '') else v.branch_label end,
      business_type = case when coalesce(v.field_sources ->> 'business_type', case when v.source ~ '^seed_' then 'seed' end) = 'seed' then s.business_type::public.business_type else v.business_type end,
      cuisine_tags = case when coalesce(v.field_sources ->> 'cuisine_tags', case when v.source ~ '^seed_' then 'seed' end) = 'seed' then s.tags else v.cuisine_tags end,
      location = case when coalesce(v.field_sources ->> 'location', case when v.source ~ '^seed_' then 'seed' end) = 'seed' then s.location else v.location end,
      brand_id = coalesce(v.brand_id, (select b.id from public.brands b where b.slug = nullif(s.brand_slug, '')))
  from app_private.seed_vendor_rows() s
  where v.place_id = s.place_id and v.claim_status = 'unclaimed'
    and coalesce(nullif(s.name_ar, ''), nullif(s.name_en, ''), v.name_ar, v.name_en) is not null
    and (v.name_ar, v.name_en, v.branch_label, v.business_type, v.cuisine_tags, v.location) is distinct from (
      case when coalesce(v.field_sources ->> 'name_ar', case when v.source ~ '^seed_' then 'seed' end) = 'seed' then nullif(s.name_ar, '') else v.name_ar end,
      case when coalesce(v.field_sources ->> 'name_en', case when v.source ~ '^seed_' then 'seed' end) = 'seed' then nullif(s.name_en, '') else v.name_en end,
      case when coalesce(v.field_sources ->> 'branch_label', case when v.source ~ '^seed_' then 'seed' end) = 'seed' then nullif(s.branch_label, '') else v.branch_label end,
      case when coalesce(v.field_sources ->> 'business_type', case when v.source ~ '^seed_' then 'seed' end) = 'seed' then s.business_type::public.business_type else v.business_type end,
      case when coalesce(v.field_sources ->> 'cuisine_tags', case when v.source ~ '^seed_' then 'seed' end) = 'seed' then s.tags else v.cuisine_tags end,
      case when coalesce(v.field_sources ->> 'location', case when v.source ~ '^seed_' then 'seed' end) = 'seed' then s.location else v.location end);
  get diagnostics n_updated = row_count;

  -- The file's town wins over the pin's nearest place while the town is still `seed`.
  update public.vendors v set town_id = s.town_id
  from app_private.seed_vendor_rows() s
  where v.place_id = s.place_id and v.claim_status = 'unclaimed' and s.town_id is not null
    and v.town_id is distinct from s.town_id and coalesce(v.field_sources ->> 'town_id', 'seed') = 'seed';
  get diagnostics n_towns = row_count;
  select count(*) into n_claimed from app_private.seed_vendor_rows() s join public.vendors v on v.place_id = s.place_id where v.claim_status <> 'unclaimed';

  insert into public.vendor_private (vendor_id, phone_seed, phone_seed_mobile, address_seed, import_labels)
  select v.id, nullif(s.phone_seed, ''), s.phone_seed_mobile, nullif(s.address_seed, ''),
    coalesce(nullif(s.import_labels, '')::jsonb, '{}')
  from app_private.seed_vendor_rows() s join public.vendors v on v.place_id = s.place_id
  where v.claim_status = 'unclaimed'
  on conflict (vendor_id) do update
    set phone_seed = case when (select coalesce(vv.field_sources ->> 'phone', case when vv.source ~ '^seed_' then 'seed' end) from public.vendors vv where vv.id = excluded.vendor_id) = 'seed'
          then excluded.phone_seed else vendor_private.phone_seed end,
        phone_seed_mobile = case when (select coalesce(vv.field_sources ->> 'phone', case when vv.source ~ '^seed_' then 'seed' end) from public.vendors vv where vv.id = excluded.vendor_id) = 'seed'
          then excluded.phone_seed_mobile else vendor_private.phone_seed_mobile end,
        address_seed = case when (select coalesce(vv.field_sources ->> 'address', case when vv.source ~ '^seed_' then 'seed' end) from public.vendors vv where vv.id = excluded.vendor_id) = 'seed'
          then excluded.address_seed else vendor_private.address_seed end,
        import_labels = excluded.import_labels
    where (vendor_private.phone_seed, vendor_private.phone_seed_mobile, vendor_private.address_seed, vendor_private.import_labels)
      is distinct from (excluded.phone_seed, excluded.phone_seed_mobile, excluded.address_seed, excluded.import_labels);
  get diagnostics n_private = row_count;

  insert into public.vendor_links (vendor_id, kind, url, status, source)
  select v.id, (l ->> 'kind')::public.vendor_link_kind, l ->> 'url', (l ->> 'status')::public.vendor_link_status, p_source
  from app_private.seed_vendor_rows() s join public.vendors v on v.place_id = s.place_id
  cross join lateral jsonb_array_elements(coalesce(nullif(s.links, '')::jsonb, '[]')) l
  where v.claim_status = 'unclaimed' and l ->> 'url' ~ '^https://[^\s]+$' and char_length(l ->> 'url') <= 500
  on conflict (vendor_id, kind, url) do update
    set status = case when excluded.status = 'unsafe' then 'unsafe'::public.vendor_link_status else vendor_links.status end
    where vendor_links.status is distinct from
      (case when excluded.status = 'unsafe' then 'unsafe'::public.vendor_link_status else vendor_links.status end);
  get diagnostics n_links = row_count;

  insert into public.vendor_import_exclusions (place_id, name, reason, source)
  select distinct on (e.place_id) e.place_id, e.name, e.reason, p_source
  from app_private.seed_vendor_exclusions e
  where nullif(e.place_id, '') is not null
    and not exists (select 1 from public.vendors v where v.place_id = e.place_id)
  order by e.place_id
  on conflict (place_id) do update set name = excluded.name, reason = excluded.reason, source = excluded.source;
  get diagnostics n_excluded = row_count;

  insert into app_private.seed_loads (name, sha256, loaded_at, counts)
  values (p_load_name, p_sha256, now(), jsonb_build_object(
    'brands_new', n_brands, 'vendors_new', n_new, 'vendors_updated', n_updated, 'towns_set', n_towns, 'claimed_untouched', n_claimed,
    'private_rows', n_private, 'links', n_links, 'exclusions', n_excluded, 'removed_skipped', n_removed))
  on conflict (name) do update set sha256 = excluded.sha256, loaded_at = excluded.loaded_at, counts = excluded.counts;
  return (select counts from app_private.seed_loads where name = p_load_name);
end;
$$;
revoke all on function app_private.vendors_load_seed(text, text, text) from public, anon, authenticated;

-- 3. Pilot villages ----------------------------------------------------------------------------------------
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('pilot_place_ids', '["LB-CHF-BAAKLINE", "LB-CHF-BAKAATA", "LB-CHF-BAROUK", "LB-CHF-DEIR-AL-QAMAR", "LB-CHF-SEMQANIEH", "LB-CHF-BATLOUN", "LB-CHF-KFAR-NABRAKH", "LB-CHF-KFARHIM", "LB-CHF-DAMIT", "LB-CHF-AIN-OUZAIN", "LB-CHF-MAASSER-EL-SHOUF", "LB-CHF-JDEIDET-EL-CHOUF"]',
   '2026-10-14 00:00+03', 'Shouf pilot: the 12 villages switched on; every other place stays off (DECISIONS §38.1)', null),
  ('loc_door_max_accuracy_m', '25', '2026-10-14 00:00+03', 'Door point: driver GPS accuracy at Delivered (DECISIONS §38.3, was 30)', null),
  ('loc_door_radius_m', '60', '2026-10-14 00:00+03', 'Door point: deliveries within this distance agree (DECISIONS §38.3, was 25)', null),
  ('lost_driver_calls_target', '0.5', '2026-10-14 00:00+03', 'Lost-driver calls per delivery stay below this (DECISIONS §38.3)', null),
  ('seed_photo_max_px', '800', '2026-10-14 00:00+03', 'Longest side of a seed photo copied into Storage (DECISIONS §38.1)', null);

-- Switches the pilot villages on and every other place that is on, off. Paused places (security, §16) stay
-- paused and a paused pilot village is not switched on; the staging-only
-- "Test location" (LB-TST-LOCATION, §35) is left as it is. Called by this migration and by the Shouf load.
create function app_private.pilot_places_apply() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids text[] := array(select jsonb_array_elements_text(public.config_value('pilot_place_ids')));
  n_on integer;
  n_off integer;
begin
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'Shouf pilot villages (DECISIONS §38.1)', true);
  update public.places set service_status = 'on' where id = any (v_ids) and service_status = 'off';
  get diagnostics n_on = row_count;
  update public.places set service_status = 'off'
  where not (id = any (v_ids)) and id <> 'LB-TST-LOCATION' and service_status = 'on';
  get diagnostics n_off = row_count;
  return jsonb_build_object('switched_on', n_on, 'switched_off', n_off,
    'on', (select count(*) from public.places where id = any (v_ids) and service_status = 'on'),
    'missing', (select count(*) from unnest(v_ids) i where not exists (select 1 from public.places p where p.id = i)));
end;
$$;
revoke all on function app_private.pilot_places_apply() from public, anon, authenticated;
select app_private.pilot_places_apply();

-- 4. Draft menus from the seed -----------------------------------------------------------------------------
alter table public.menu_drafts drop constraint menu_drafts_source_check;
alter table public.menu_drafts add constraint menu_drafts_source_check
  check (source in ('photo', 'pdf', 'link', 'instagram', 'text', 'fixture', 'seed'));
create unique index menu_drafts_one_seed_idx on public.menu_drafts (vendor_id) where source = 'seed';

create table app_private.seed_menu_drafts (place_id text, kind text, sections text);
revoke all on table app_private.seed_menu_drafts from public, anon, authenticated;

-- 5. Seed photos -----------------------------------------------------------------------------------------
create table public.vendor_photos (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  -- Object name in the private `vendor-photos` bucket.
  storage_path text not null unique check (storage_path ~ '^(seed|merchant)/[0-9a-f-]{36}/[0-9a-f]{16,64}\.(jpg|png|webp)$'),
  source text not null check (source in ('seed', 'merchant')),
  -- pending: copied from the seed, waiting for the merchant; confirmed: the merchant kept it; removed: the
  -- merchant (or an operator, on request) removed it; the object is deleted by the next copy run.
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'removed')),
  -- SHA-256 of the seed URL: a removed photo is never copied again. The URL itself is not kept.
  origin_hash text check (origin_hash ~ '^[0-9a-f]{64}$'),
  bytes integer check (bytes > 0),
  sort_order integer not null default 0,
  decided_by uuid references public.vendor_members (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_photos_seed_hash check (source <> 'seed' or origin_hash is not null)
);
create unique index vendor_photos_origin_idx on public.vendor_photos (vendor_id, origin_hash) where origin_hash is not null;
create index vendor_photos_vendor_idx on public.vendor_photos (vendor_id, status, sort_order);
create trigger vendor_photos_touch before update on public.vendor_photos
  for each row execute function app_private.touch_updated_at();
create trigger vendor_photos_audit after insert or update or delete on public.vendor_photos
  for each row execute function app_private.audit_row();
alter table public.vendor_photos enable row level security;
revoke all on table public.vendor_photos from public, anon, authenticated;
grant all on table public.vendor_photos to service_role;
grant select on table public.vendor_photos to authenticated;
create policy vendor_photos_read on public.vendor_photos for select to authenticated
  using ((select app_private.is_operator()) or app_private.has_vendor_role(vendor_id, array['owner', 'manager']::public.member_role[]));

-- The merchant keeps or removes one photo (owner or manager, by WhatsApp tap or the portal, both through the server).
create function public.vendor_photo_decide(p_photo_id uuid, p_keep boolean, p_member_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor uuid;
  v_member uuid;
begin
  select p.vendor_id into v_vendor from public.vendor_photos p where p.id = p_photo_id and p.status <> 'removed';
  if v_vendor is null then
    raise exception 'unknown photo' using errcode = 'no_data_found';
  end if;
  v_member := app_private.menu_editor(v_vendor, p_member_id);
  update public.vendor_photos
  set status = case when p_keep then 'confirmed' else 'removed' end, decided_by = v_member, decided_at = now()
  where id = p_photo_id;
  return jsonb_build_object('photo_id', p_photo_id, 'status', case when p_keep then 'confirmed' else 'removed' end);
end;
$$;
revoke all on function public.vendor_photo_decide(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.vendor_photo_decide(uuid, boolean, uuid) to service_role;

-- Every seed photo of a vendor removed at once: the business asked (§15.1), claimed or not. Server side only (the
-- admin console and the removal flow call it through an edge function).
create function public.vendor_photos_remove_seed(p_vendor_id uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.vendor_photos set status = 'removed', decided_at = now()
  where vendor_id = p_vendor_id and source = 'seed' and status <> 'removed';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.vendor_photos_remove_seed(uuid) from public, anon, authenticated;
grant execute on function public.vendor_photos_remove_seed(uuid) to service_role;

-- The bucket is private. Anyone may read an object only when it is a confirmed photo of a claimed vendor
-- with a public page; staff of the vendor and operators read their pending photos with signed URLs.
-- Skipped where the storage schema does not exist (the CI database).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets'
             and column_name = 'allowed_mime_types') then
    execute $q$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('vendor-photos', 'vendor-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
      on conflict (id) do nothing$q$;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "confirmed vendor photos are public" on storage.objects';
    execute $q$create policy "confirmed vendor photos are public" on storage.objects for select to anon, authenticated
      using (bucket_id = 'vendor-photos' and exists (
        select 1 from public.vendor_photos p join public.vendors v on v.id = p.vendor_id
        where p.storage_path = storage.objects.name and p.status = 'confirmed'
          and v.claim_status = 'claimed' and v.public_page and v.listing_status = 'active'))$q$;
    execute 'drop policy if exists "vendor staff and operators read vendor photos" on storage.objects';
    execute $q$create policy "vendor staff and operators read vendor photos" on storage.objects for select to authenticated
      using (bucket_id = 'vendor-photos' and exists (
        select 1 from public.vendor_photos p
        where p.storage_path = storage.objects.name and p.status <> 'removed'
          and ((select app_private.is_operator()) or app_private.has_vendor_role(p.vendor_id, array['owner', 'manager']::public.member_role[]))))$q$;
  end if;
end;
$$;

-- 6. OpenStreetMap landmarks and place aliases (pilot area) -------------------------------------------------
alter table public.landmarks drop constraint landmarks_source_check;
alter table public.landmarks add constraint landmarks_source_check check (source in ('seed', 'operator', 'learned', 'osm'));
alter table public.landmarks add column osm_ref text unique check (osm_ref ~ '^(node|way|relation)/[0-9]+$');
-- 0-1. OSM landmarks start low (0.3); deliveries confirm them like learned ones (§28.1).
alter table public.landmarks add column confidence numeric(3, 2) check (confidence between 0 and 1);
alter table public.place_aliases add column source text not null default 'learned' check (source in ('learned', 'osm'));
alter table public.place_aliases add column osm_key text check (osm_key in ('name', 'alt_name', 'loc_name', 'old_name', 'official_name', 'short_name'));

create table app_private.seed_osm_landmarks (osm_ref text, kind text, name_ar text, name_en text, aliases text, lat double precision, lon double precision);
create table app_private.seed_osm_aliases (osm_ref text, alias text, lang text, osm_key text, lat double precision, lon double precision);
revoke all on table app_private.seed_osm_landmarks, app_private.seed_osm_aliases from public, anon, authenticated;

create function app_private.osm_load_seed(p_sha256 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pilot text[] := array(select jsonb_array_elements_text(public.config_value('pilot_place_ids')));
  n_landmarks integer;
  n_aliases integer;
begin
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'OSM pilot seed ' || left(p_sha256, 12), true);
  insert into public.landmarks (place_id, name_ar, name_en, aliases, kind, point, source, status, shared, confidence, osm_ref)
  select (select f.place_id from public.place_for_point(pt) f), nullif(s.name_ar, ''), nullif(s.name_en, ''),
    coalesce(nullif(s.aliases, '')::text[], '{}'), s.kind, pt, 'osm', 'unconfirmed', true, 0.3, s.osm_ref
  from app_private.seed_osm_landmarks s
  cross join lateral (select extensions.st_setsrid(extensions.st_makepoint(s.lon, s.lat), 4326)::extensions.geography as pt) p
  where coalesce(nullif(s.name_ar, ''), nullif(s.name_en, '')) is not null and s.kind ~ '^[a-z_]+$'
    and s.osm_ref ~ '^(node|way|relation)/[0-9]+$'
  on conflict (osm_ref) do update
    set name_ar = excluded.name_ar, name_en = excluded.name_en, aliases = excluded.aliases, kind = excluded.kind,
        point = excluded.point, place_id = excluded.place_id
    where landmarks.source = 'osm' and (landmarks.name_ar, landmarks.name_en, landmarks.aliases, landmarks.kind, landmarks.point)
      is distinct from (excluded.name_ar, excluded.name_en, excluded.aliases, excluded.kind, excluded.point);
  get diagnostics n_landmarks = row_count;

  -- An OSM place node's names become aliases of the pilot village its point falls in (the village's own node,
  -- and hamlets or neighbourhoods inside it); nodes that fall in any other place are skipped.
  insert into public.place_aliases (place_id, alias, lang, status, shared, source, osm_key)
  select distinct on (f.place_id, app_private.normalize_place_name(s.alias))
    f.place_id, trim(s.alias), nullif(s.lang, '')::public.lang_code, 'confirmed', true, 'osm', s.osm_key
  from app_private.seed_osm_aliases s
  cross join lateral public.place_for_point(extensions.st_setsrid(extensions.st_makepoint(s.lon, s.lat), 4326)::extensions.geography) f
  where f.place_id = any (v_pilot)
    and char_length(trim(s.alias)) between 2 and 80
    and coalesce(app_private.normalize_place_name(s.alias), '') <> ''
    and s.osm_key in ('name', 'alt_name', 'loc_name', 'old_name', 'official_name', 'short_name')
  order by f.place_id, app_private.normalize_place_name(s.alias), s.osm_key
  on conflict (place_id, normalized_alias) do nothing;
  get diagnostics n_aliases = row_count;

  insert into app_private.seed_loads (name, sha256, loaded_at, counts)
  values ('osm_pilot', p_sha256, now(), jsonb_build_object('landmarks', n_landmarks, 'aliases', n_aliases,
    'landmarks_total', (select count(*) from public.landmarks where source = 'osm'),
    'aliases_total', (select count(*) from public.place_aliases where source = 'osm')))
  on conflict (name) do update set sha256 = excluded.sha256, loaded_at = excluded.loaded_at, counts = excluded.counts;
  return (select counts from app_private.seed_loads where name = 'osm_pilot');
end;
$$;
revoke all on function app_private.osm_load_seed(text) from public, anon, authenticated;

-- OSM landmarks stay shared (usable as hints) and are confirmed by deliveries like learned ones; OSM place
-- aliases (alt_name, loc_name, old_name) count as confirmed and are never demoted by the evidence count.
create or replace function app_private.promote_landmarks() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r numeric := public.config_numeric('loc_landmark_radius_m');
  v_min numeric := public.config_numeric('loc_landmark_min_customers');
  v_shared numeric := public.config_numeric('loc_shared_min_people');
  r record;
  n integer := 0;
  v_status public.knowledge_status;
  v_is_shared boolean;
begin
  for r in
    select l.id, l.source, l.status, l.shared, l.support_people,
      count(distinct e.supporter_key) filter (where e.supporter_kind = 'customer' and extensions.st_dwithin(e.point, l.point, v_r)) as customers,
      count(distinct e.supporter_key) filter (where e.supporter_kind in ('merchant', 'driver', 'operator') and (e.point is null or extensions.st_dwithin(e.point, l.point, v_r))) as onsite,
      count(distinct e.supporter_key) filter (where e.supporter_kind <> 'system' and (e.point is null or extensions.st_dwithin(e.point, l.point, v_r))) as people,
      count(*) filter (where e.point is not null and not extensions.st_dwithin(e.point, l.point, v_r)) as against,
      count(*) filter (where e.point is not null and extensions.st_dwithin(e.point, l.point, v_r)) as supporting
    from public.landmarks l
    left join public.location_evidence e on e.landmark_id = l.id
    group by l.id
  loop
    if r.source in ('seed', 'operator') then
      v_status := 'confirmed';
      v_is_shared := true;
    else
      v_status := case when r.customers >= v_min or r.onsite >= 1 then 'confirmed' else 'unconfirmed' end;
      if r.against >= 2 and r.against >= r.supporting then
        v_status := 'unconfirmed';
        perform app_private.flag_for_review('landmarks', r.id::text, 'contradicting pins');
      end if;
      v_is_shared := r.source = 'osm' or r.people >= v_shared;
    end if;
    if (r.status, r.shared, r.support_people) is distinct from (v_status, v_is_shared, r.people::integer) then
      update public.landmarks set status = v_status, shared = v_is_shared, support_people = r.people where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

create or replace function app_private.promote_place_aliases() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min numeric := public.config_numeric('loc_alias_min_customers');
  v_shared numeric := public.config_numeric('loc_shared_min_people');
  n integer;
begin
  with s as (
    select a.id,
      count(distinct e.supporter_key) filter (where e.supporter_kind = 'customer') as customers,
      count(distinct e.supporter_key) filter (where e.supporter_kind <> 'system') as people
    from public.place_aliases a
    left join public.location_evidence e on e.place_alias_id = a.id
    where a.source <> 'osm'
    group by a.id
  )
  update public.place_aliases a
  set status = case when s.customers >= v_min then 'confirmed' else 'unconfirmed' end::public.knowledge_status,
      shared = s.people >= v_shared, support_people = s.people
  from s
  where a.id = s.id
    and (a.status, a.shared, a.support_people) is distinct from
        (case when s.customers >= v_min then 'confirmed' else 'unconfirmed' end::public.knowledge_status, s.people >= v_shared, s.people::integer);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 7. Address fields and lost-driver calls (§38.3) ---------------------------------------------------------
-- How the door relates to the landmark the customer named: "next to the pharmacy", "behind the church".
create type public.landmark_relation as enum ('at', 'next_to', 'opposite', 'behind', 'above', 'below', 'near', 'after', 'before');
alter table public.addresses
  add column landmark_relation public.landmark_relation,
  add column has_elevator boolean,
  add constraint addresses_relation_needs_landmark check (landmark_relation is null or landmark_id is not null);
comment on column public.addresses.has_elevator is 'Stated by the customer; null = unknown. With floor, feeds the stairs fee (§29.2) once shown before checkout.';

-- Calls a driver made because they could not find the door. The pilot target is under 0.5 per delivery.
alter table public.orders add column lost_driver_calls smallint not null default 0 check (lost_driver_calls between 0 and 50);

create function public.order_lost_driver_call(p_order_id uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.orders set lost_driver_calls = lost_driver_calls + 1
  where id = p_order_id and fulfilment = 'delivery' and lost_driver_calls < 50
  returning lost_driver_calls into n;
  if n is null then
    raise exception 'not a delivery order' using errcode = 'no_data_found';
  end if;
  return n;
end;
$$;
revoke all on function public.order_lost_driver_call(uuid) from public, anon, authenticated;
grant execute on function public.order_lost_driver_call(uuid) to service_role;

-- Lost-driver calls per delivered order over the last p_days, against the target in config.
create function public.lost_driver_calls_metric(p_days integer default 30) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'days', p_days,
    'deliveries', count(*),
    'lost_driver_calls', coalesce(sum(o.lost_driver_calls), 0),
    'per_delivery', round(coalesce(sum(o.lost_driver_calls), 0)::numeric / nullif(count(*), 0), 3),
    'target', public.config_numeric('lost_driver_calls_target'),
    'ok', coalesce(sum(o.lost_driver_calls), 0)::numeric / nullif(count(*), 0) < public.config_numeric('lost_driver_calls_target'))
  from public.orders o
  where o.status = 'delivered' and o.fulfilment = 'delivery' and o.updated_at > now() - make_interval(days => greatest(p_days, 1));
$$;
revoke all on function public.lost_driver_calls_metric(integer) from public, anon, authenticated;
grant execute on function public.lost_driver_calls_metric(integer) to service_role;

-- 8. The Shouf load -------------------------------------------------------------------------------------
-- Called by scripts/load-seed.sh after the vendor rows and the draft menus are staged.
create function app_private.shouf_load_seed(p_sha256 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pilot text[] := array(select jsonb_array_elements_text(public.config_value('pilot_place_ids')));
  v_vendors jsonb;
  n_towns integer;
  n_drafts integer;
  n_drafts_updated integer;
  n_grocery integer;
  v_places jsonb;
  r record;
begin
  v_vendors := app_private.vendors_load_seed(p_sha256, 'seed_shouf_2026_10', 'vendors_shouf');

  -- A merchant whose file row names no pilot village gets the nearest one (by the village's centre).
  update public.vendors v
  set town_id = (select p.id from public.places p where p.id = any (v_pilot)
                 order by p.centroid operator(extensions.<->) v.location limit 1)
  where v.source = 'seed_shouf_2026_10' and v.claim_status = 'unclaimed' and v.location is not null
    and (v.town_id is null or not (v.town_id = any (v_pilot)))
    and coalesce(v.field_sources ->> 'town_id', 'seed') = 'seed';
  get diagnostics n_towns = row_count;

  -- The two catalogue shops are supermarkets (§38.2.3), whatever the type the file gave.
  update public.vendors v set business_type = 'grocery_supermarket'
  where v.source = 'seed_shouf_2026_10' and v.business_type <> 'grocery_supermarket'
    and coalesce(v.field_sources ->> 'business_type', 'seed') = 'seed'
    and exists (select 1 from app_private.seed_menu_drafts d where d.place_id = v.place_id and d.kind = 'supermarket');
  get diagnostics n_grocery = row_count;

  -- Draft menus: one seed draft per unclaimed vendor; refreshed only while nothing in it is approved.
  for r in select d.place_id, d.sections::jsonb as sections from app_private.seed_menu_drafts d loop
    perform app_private.menu_draft_check(r.sections);
  end loop;
  insert into public.menu_drafts (vendor_id, source, status, sections, warnings, model)
  select v.id, 'seed', 'draft',
    (select jsonb_agg(s || jsonb_build_object('approved', false)) from jsonb_array_elements(d.sections::jsonb) s),
    '["seed: every price is from a public listing; the merchant confirms each section"]'::jsonb, null
  from app_private.seed_menu_drafts d join public.vendors v on v.place_id = d.place_id
  where v.claim_status = 'unclaimed'
  on conflict (vendor_id) where source = 'seed' do nothing;
  get diagnostics n_drafts = row_count;
  update public.menu_drafts m
  set sections = (select jsonb_agg(s || jsonb_build_object('approved', false)) from jsonb_array_elements(d.sections::jsonb) s)
  from app_private.seed_menu_drafts d join public.vendors v on v.place_id = d.place_id
  where m.vendor_id = v.id and m.source = 'seed' and m.status = 'draft' and v.claim_status = 'unclaimed'
    and m.sections is distinct from (select jsonb_agg(s || jsonb_build_object('approved', false)) from jsonb_array_elements(d.sections::jsonb) s);
  get diagnostics n_drafts_updated = row_count;

  v_places := app_private.pilot_places_apply();

  update app_private.seed_loads
  set counts = counts || jsonb_build_object('towns_nearest_village', n_towns, 'grocery_set', n_grocery,
    'drafts_new', n_drafts, 'drafts_updated', n_drafts_updated, 'places', v_places,
    'vendors_total', (select count(*) from public.vendors where source = 'seed_shouf_2026_10'),
    'whatsapp_candidates', (select count(*) from public.vendors v join public.vendor_private p on p.vendor_id = v.id
                            where v.source = 'seed_shouf_2026_10' and p.phone_seed_mobile))
  where name = 'vendors_shouf';
  return (select counts from app_private.seed_loads where name = 'vendors_shouf');
end;
$$;
revoke all on function app_private.shouf_load_seed(text) from public, anon, authenticated;

-- 9. The staging simulator and the test market (DECISIONS §36, §38.2.3) -----------------------------------
-- Switches the staging test market (alo-test-market, made by the staging fixture from Coop Baakleen's draft
-- catalogue) on for the simulated merchant persona, or off again. Refuses unless the simulator sink is on (staging
-- only) and the number is a +999 simulator number; the real Shouf merchants are never touched.
create function public.sim_market(p_merchant_phone text, p_on boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_market uuid;
begin
  if not app_private.sim_sink_on() then
    return jsonb_build_object('status', 'sink_off');
  end if;
  if not app_private.is_sim_phone(p_merchant_phone) then
    return jsonb_build_object('status', 'not_a_sim_phone');
  end if;
  select v.id into v_market from public.vendors v where v.slug = 'alo-test-market' and v.is_test;
  if v_market is null then
    return jsonb_build_object('status', 'no_test_market');
  end if;
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'simulator test market (DECISIONS §38.2.3)', true);
  if p_on then
    insert into public.vendor_members (vendor_id, user_id, phone_e164, role, status, display_name)
    values (v_market, app_private.auth_user_for_phone(p_merchant_phone), p_merchant_phone, 'owner', 'active', 'Simulated merchant')
    on conflict (vendor_id, phone_e164) do update set status = 'active', role = 'owner', user_id = excluded.user_id;
    insert into public.vendor_private (vendor_id, owner_mobile, kitchen_whatsapp)
    values (v_market, p_merchant_phone, p_merchant_phone)
    on conflict (vendor_id) do update set owner_mobile = excluded.owner_mobile, kitchen_whatsapp = excluded.kitchen_whatsapp;
    update public.vendor_order_channels set target = p_merchant_phone, channel = 'whatsapp'
    where vendor_id = v_market and role = 'primary';
    if not found then
      insert into public.vendor_order_channels (vendor_id, channel, role, target)
      values (v_market, 'whatsapp', 'primary', p_merchant_phone);
    end if;
    update public.vendor_order_channels set enabled = true where vendor_id = v_market and role = 'primary' and not enabled;
    update public.vendors set orderable = true where id = v_market and not orderable;
  else
    update public.vendors set orderable = false where id = v_market and orderable;
    update public.vendor_members set status = 'revoked' where vendor_id = v_market and status <> 'revoked';
  end if;
  return jsonb_build_object('status', 'ok', 'vendor_id', v_market, 'orderable', p_on);
end;
$$;
revoke all on function public.sim_market(text, boolean) from public, anon, authenticated;
grant execute on function public.sim_market(text, boolean) to service_role;

select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);
