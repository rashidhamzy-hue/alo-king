-- Phase 1b vendor import (DECISIONS §15). The vendor file is normalised by scripts/vendors/build-seed.ts
-- (names split, categories, exclusions, phones, links, brands) and loaded by `vendors_load_seed()`:
-- - every imported vendor is unclaimed, not orderable and has no public page (§15.2);
-- - every imported field is marked `seed` in field_sources (a seed vendor with no mark counts as seed);
--   a re-import updates only fields still `seed` on vendors still unclaimed, so a merchant's confirmation is never overwritten (§15.1, §18.2);
-- - a place_id in vendor_removed_places is never imported again (§15.1, §18.1 K).

alter table public.vendor_private
  add column phone_seed_mobile boolean,
  add column import_labels jsonb not null default '{}' check (jsonb_typeof(import_labels) = 'object');
comment on column public.vendor_private.phone_seed_mobile is
  'Seed phone is a Lebanese mobile (3, 70, 71, 76, 78, 79, 81): a WhatsApp claim code can be tried. Confirmed only when a message delivers (§15.2).';

create type public.vendor_link_kind as enum ('website', 'instagram', 'facebook', 'menu');
-- unchecked: imported, never shown; ok: checked live; dead/parked: expired or parked domain; unsafe: hijacked.
create type public.vendor_link_status as enum ('unchecked', 'ok', 'dead', 'parked', 'unsafe');

-- Links from the seed and from merchants. Shown to anyone only once checked `ok` and confirmed by the
-- merchant (Phase 3/4); until then internal.
create table public.vendor_links (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  kind public.vendor_link_kind not null,
  url text not null check (url ~ '^https://[^\s]+$' and char_length(url) <= 500),
  status public.vendor_link_status not null default 'unchecked',
  source text not null check (source ~ '^(seed_[0-9]{4}_[0-9]{2}|merchant|admin)$'),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_links_unique unique (vendor_id, kind, url)
);
create index vendor_links_vendor_idx on public.vendor_links (vendor_id);
create trigger vendor_links_touch before update on public.vendor_links
  for each row execute function app_private.touch_updated_at();

-- Rows of the vendor file that were not imported, with the reason (§15.2), for review.
create table public.vendor_import_exclusions (
  place_id text primary key,
  name text not null,
  reason text not null,
  source text not null,
  created_at timestamptz not null default now()
);

alter table public.vendor_links enable row level security;
alter table public.vendor_import_exclusions enable row level security;
revoke all on table public.vendor_links, public.vendor_import_exclusions from public, anon, authenticated;
grant all on table public.vendor_links, public.vendor_import_exclusions to service_role;
grant select on table public.vendor_links, public.vendor_import_exclusions to authenticated;
create policy vendor_links_read on public.vendor_links for select to authenticated
  using (
    (select app_private.is_operator())
    or app_private.has_vendor_role(vendor_id, array['owner', 'manager']::public.member_role[])
  );
create policy vendor_import_exclusions_operator_read on public.vendor_import_exclusions for select to authenticated
  using ((select app_private.is_operator()));

-- Seed staging (filled by scripts/load-seed.sh) ---------------------------------------------------------
create table app_private.seed_vendors (
  place_id text, slug text, name_ar text, name_en text, branch_label text, business_type text, cuisine_tags text,
  lat double precision, lon double precision, phone_seed text, phone_seed_mobile boolean, address_seed text,
  brand_slug text, brand_name_en text, brand_name_ar text, links text, import_labels text
);
create table app_private.seed_vendor_exclusions (place_id text, name text, reason text);
revoke all on table app_private.seed_vendors, app_private.seed_vendor_exclusions from public, anon, authenticated;

-- Staged rows to consider: not removed at the owner's request; tags limited to the active tag list.
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
