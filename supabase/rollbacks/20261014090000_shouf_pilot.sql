-- Rollback for 20261014090000_shouf_pilot.sql (session D, DECISIONS §38).
-- The migration deletes the 2,044 nationwide seed vendors (source seed_2026_10). They are not restored by SQL:
-- restore the file and reload it, which recreates them unclaimed exactly as the first import did:
--   git show 0ada003:supabase/seed/vendors/source/alo_king_master_lebanon_vendors_cleaned.csv \
--     > supabase/seed/vendors/source/alo_king_master_lebanon_vendors_cleaned.csv
--   DB_URL=... FORCE=1 scripts/load-seed.sh
-- (after running this file, which puts the loader back to its 20261008090300 form). Claims, menus and photos of the
-- Shouf merchants are lost with them; run the statements below only before any Shouf merchant claims.
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'rollback of session D (DECISIONS §38)', false);

drop function if exists public.sim_market(text, boolean);
drop function if exists app_private.shouf_load_seed(text);
drop function if exists public.lost_driver_calls_metric(integer);
drop function if exists public.order_lost_driver_call(uuid);
alter table public.orders drop column if exists lost_driver_calls;
alter table public.addresses drop constraint if exists addresses_relation_needs_landmark,
  drop column if exists landmark_relation, drop column if exists has_elevator;
drop type if exists public.landmark_relation;

-- OSM data and the promotion rules as before (20261008090100), re-created before the columns they used go.
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
      v_is_shared := r.people >= v_shared;
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

drop function if exists app_private.osm_load_seed(text);
drop table if exists app_private.seed_osm_landmarks, app_private.seed_osm_aliases;
delete from public.landmarks where source = 'osm';
delete from public.place_aliases where source = 'osm';
alter table public.place_aliases drop column if exists osm_key, drop column if exists source;
alter table public.landmarks drop column if exists confidence, drop column if exists osm_ref;
alter table public.landmarks drop constraint landmarks_source_check;
alter table public.landmarks add constraint landmarks_source_check check (source in ('seed', 'operator', 'learned'));

-- Photos (objects in the vendor-photos bucket are deleted with the Storage API or the dashboard first).
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "confirmed vendor photos are public" on storage.objects';
    execute 'drop policy if exists "vendor staff and operators read vendor photos" on storage.objects';
  end if;
end;
$$;
drop function if exists app_private.vendor_photo_is_public(text);
drop function if exists app_private.vendor_photo_staff_can_read(text);
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

-- Pilot villages and door thresholds: dated rows in force cannot be deleted, so newer rows put the old values back
-- (an empty pilot list; places keep their current status, switch them by hand if needed). The two unused keys
-- (lost_driver_calls_target, seed_photo_max_px) stay, read by nothing.
drop function if exists app_private.pilot_places_apply();
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('pilot_place_ids', '[]', now(), 'rollback of session D', null),
  ('loc_door_max_accuracy_m', '30', now(), 'rollback of session D (back to DECISIONS §28.1)', null),
  ('loc_door_radius_m', '25', now(), 'rollback of session D (back to DECISIONS §28.1)', null);

-- The loader as in 20261008090300 (the source checks below go back first, so no shouf row may remain).
drop function if exists app_private.vendors_load_seed(text, text, text);
drop function if exists app_private.seed_vendor_rows();
alter table app_private.seed_vendors drop column if exists town_id;
create function app_private.seed_vendor_rows()
returns table (
  place_id text, slug text, name_ar text, name_en text, branch_label text, business_type text,
  phone_seed text, phone_seed_mobile boolean, address_seed text, brand_slug text, brand_name_en text,
  brand_name_ar text, links text, import_labels text, location extensions.geography, tags text[]
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
          where exists (select 1 from public.cuisine_tags c where c.tag = t and c.active) order by t)
  from app_private.seed_vendors v
  where not exists (select 1 from public.vendor_removed_places r where r.place_id = v.place_id);
$$;
revoke all on function app_private.seed_vendor_rows() from public, anon, authenticated;

create function app_private.vendors_load_seed(p_sha256 text, p_source text default 'seed_2026_10')
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
  n_private integer;
  n_links integer;
  n_excluded integer;
  n_removed integer;
  n_claimed integer;
begin
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'vendor seed ' || left(p_sha256, 12), true);
  if p_source !~ '^seed_[0-9]{4}_[0-9]{2}$' then
    raise exception 'seed source must look like seed_2026_10' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from app_private.seed_vendors) = 0 then
    raise exception 'the vendor seed is empty' using errcode = 'no_data_found';
  end if;

  select count(*) into n_removed from app_private.seed_vendors v
  where exists (select 1 from public.vendor_removed_places r where r.place_id = v.place_id);

  -- Brands (chains), by slug.
  insert into public.brands (slug, name_ar, name_en)
  select distinct on (s.brand_slug) s.brand_slug, nullif(s.brand_name_ar, ''), nullif(s.brand_name_en, '')
  from app_private.seed_vendor_rows() s where nullif(s.brand_slug, '') is not null and coalesce(nullif(s.brand_name_ar, ''), nullif(s.brand_name_en, '')) is not null
  order by s.brand_slug, s.place_id
  on conflict (slug) do nothing;
  get diagnostics n_brands = row_count;

  -- New vendors. A slug already used by another vendor gets the place_id's tail.
  insert into public.vendors (slug, name_ar, name_en, branch_label, business_type, cuisine_tags, claim_status,
    orderable, public_page, source, field_sources, place_id, location, brand_id)
  select
    case when exists (select 1 from public.vendors x where x.slug = s.slug)
      then left(s.slug, 48) || '-' || lower(regexp_replace(right(s.place_id, 10), '[^A-Za-z0-9]', '', 'g'))
      else s.slug end,
    nullif(s.name_ar, ''), nullif(s.name_en, ''), nullif(s.branch_label, ''), s.business_type::public.business_type,
    s.tags, 'unclaimed', false, false, p_source, v_all_seed, s.place_id, s.location,
    (select b.id from public.brands b where b.slug = nullif(s.brand_slug, ''))
  from app_private.seed_vendor_rows() s
  where not exists (select 1 from public.vendors v where v.place_id = s.place_id);
  get diagnostics n_new = row_count;

  -- Existing unclaimed vendors: refresh only the fields still marked seed.
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
  select count(*) into n_claimed from app_private.seed_vendor_rows() s join public.vendors v on v.place_id = s.place_id where v.claim_status <> 'unclaimed';

  -- Internal seed fields (phone for the claim code, address), for unclaimed vendors only.
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

  -- Links: added or re-flagged; never removed here (a stale unchecked link is never shown anyway).
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
  values ('vendors', p_sha256, now(), jsonb_build_object(
    'brands_new', n_brands, 'vendors_new', n_new, 'vendors_updated', n_updated, 'claimed_untouched', n_claimed,
    'private_rows', n_private, 'links', n_links, 'exclusions', n_excluded, 'removed_skipped', n_removed))
  on conflict (name) do update set sha256 = excluded.sha256, loaded_at = excluded.loaded_at, counts = excluded.counts;
  return (select counts from app_private.seed_loads where name = 'vendors');
end;
$$;
revoke all on function app_private.vendors_load_seed(text, text) from public, anon, authenticated;
alter table public.vendor_links drop constraint vendor_links_source_check;
alter table public.vendor_links add constraint vendor_links_source_check
  check (source ~ '^(seed_[0-9]{4}_[0-9]{2}|merchant|admin)$');
alter table public.vendors drop constraint vendors_source_check;
alter table public.vendors add constraint vendors_source_check
  check (source ~ '^(seed_[0-9]{4}_[0-9]{2}|google_live|merchant|admin)$');

select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);
