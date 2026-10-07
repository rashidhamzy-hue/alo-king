-- Phase 1b places seed loading and spelling-tolerant search (DECISIONS §16).
-- 1. A phonetic key so Arabizi, French, English and Arabic spellings of one place meet
--    (Ba3qlin = Baakline = بعقلين, Ba2aata = Bakaata = بقعاتا, Beit el Din = Beiteddine = بيت الدين).
-- 2. Staging tables and `places_load_seed()`: scripts/load-seed.sh copies supabase/seed/places/*.csv
--    into the staging tables and calls it after every deploy; an unchanged seed is skipped by its hash.
--    Loading never changes a place's service status and never deletes a place.

-- Phonetic key: consonant skeleton of the normalised name. Lebanese Arabizi digits map to letters
-- (2 = qaf/hamza, 3 = ain, 7 = ha, 5 = kha, 9 = sad, 6 = ta), sh/ch = s, q/c/k = k, vowels, ain,
-- glides and word-final h are dropped, doubled letters collapse. Lossy by design: it finds candidates,
-- the trigram score ranks them.
create function app_private.place_phonetic_key(p text) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    translate(
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        coalesce(app_private.normalize_place_name(p), ''),
        'kh', 'x', 'g'), 'gh', 'g', 'g'), '(sh|ch)', 's', 'g'), '(th|dh)', 't', 'g'),
      -- Arabic consonants and Arabizi digits to Latin; ain, waw, ya, hamza, alef and 3 are dropped.
      'بتثجحخدذرزسشصضطظغفقكلمنهqc275968عويءا3',
      'bttjhxddrzsssdtzgfkklmnhkkkhxstg'
    ),
    -- word-final h (ة, ه, -eh, -ieh)
    'h(\s|$)', '\1', 'g'),
    '[aeiouyw''\s]', '', 'g'),
    '(.)\1+', '\1', 'g'),
    '[^a-z]', '', 'g'), '');
$$;
revoke all on function app_private.place_phonetic_key(text) from public;
grant execute on function app_private.place_phonetic_key(text) to anon, authenticated, service_role;

alter table public.places add column phonetic_text text not null default '';

create or replace function app_private.places_prepare() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_names text[];
begin
  -- South and Nabatieh load paused for security (§16); every other place loads off.
  if tg_op = 'INSERT' then
    if new.governorate_code in ('south', 'nabatieh') then
      new.service_status := 'paused';
      new.paused_reason := 'security';
    else
      new.service_status := 'off';
      new.paused_reason := null;
    end if;
  end if;
  v_names := array[new.name_ar, new.name_en, new.name_fr] || new.aliases;
  new.search_text := coalesce(array_to_string(array(
    select distinct app_private.normalize_place_name(n) from unnest(v_names) n
    where app_private.normalize_place_name(n) is not null
  ), ' | '), '');
  -- Keys shorter than 3 letters match too much to be useful.
  new.phonetic_text := coalesce('|' || array_to_string(array(
    select distinct app_private.place_phonetic_key(n) from unnest(v_names) n
    where char_length(app_private.place_phonetic_key(n)) >= 3
  ), '|') || '|', '');
  return new;
end;
$$;
update public.places set aliases = aliases;

create or replace function public.search_places(
  p_query text,
  p_district_code text default null,
  p_limit integer default 10
)
returns table (
  id text, name_ar text, name_en text, name_fr text, kind public.place_kind, district_code text,
  label_en text, label_ar text, service_status public.service_status, score real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select app_private.normalize_place_name(p_query) as n,
      app_private.place_phonetic_key(p_query) as k
  ),
  hits as (
    select p.*, d.name_en as district_en, d.name_ar as district_ar,
      greatest(
        extensions.word_similarity(q.n, p.search_text),
        case when char_length(q.k) >= 3 and p.phonetic_text like '%|' || q.k || '|%' then 0.9 else 0 end
      )::real as s
    from public.places p
    join public.districts d on d.code = p.district_code
    cross join q
    where q.n is not null
      and (p_district_code is null or p.district_code = p_district_code)
      and (q.n operator(extensions.<%) p.search_text
           or p.search_text like '%' || q.n || '%'
           or (char_length(q.k) >= 3 and p.phonetic_text like '%|' || q.k || '|%'))
  )
  select h.id, h.name_ar, h.name_en, h.name_fr, h.kind, h.district_code,
    case when h.name_is_shared then coalesce(h.name_en, h.name_ar) || ' (' || h.district_en || ')' else coalesce(h.name_en, h.name_ar) end,
    case when h.name_is_shared then coalesce(h.name_ar, h.name_en) || ' (' || h.district_ar || ')' else coalesce(h.name_ar, h.name_en) end,
    h.service_status, h.s
  from hits h
  order by h.s desc, (h.kind in ('city', 'town')) desc, h.id
  limit least(greatest(p_limit, 1), 50);
$$;

-- The switch accepted the service role only through auth.role(), which reads a claim that not every
-- PostgREST version sets; the database role itself is the reliable signal (the function runs as invoker).
create or replace function public.place_set_service_status(
  p_place_id text,
  p_status public.service_status,
  p_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_admin boolean := app_private.is_admin();
begin
  if not v_admin and current_user not in ('service_role', 'postgres') then
    raise exception 'only the admin switches places' using errcode = 'insufficient_privilege';
  end if;
  if p_status = 'paused' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'a paused place needs a reason' using errcode = 'check_violation';
  end if;
  perform set_config('app.actor_kind', case when v_admin then 'operator' else 'service' end, true);
  perform set_config('app.audit_reason', coalesce(p_reason, 'service status ' || p_status::text), true);
  update public.places
  set service_status = p_status,
      paused_reason = case when p_status = 'paused' then p_reason end
  where id = p_place_id;
  if not found then
    raise exception 'unknown place %', p_place_id using errcode = 'no_data_found';
  end if;
end;
$$;

-- Seed staging (filled by scripts/load-seed.sh with \copy; emptied on every load) --------------------
create table app_private.seed_districts (code text, pcode text, boundary_wkt text);
create table app_private.seed_zones (
  pcode text, district_code text, name_ar text, name_en text, name_fr text,
  elevation_min_m integer, elevation_max_m integer, inhabited boolean, boundary_wkt text
);
create table app_private.seed_places (
  id text, pcode text, zone_pcode text, name_ar text, name_en text, name_fr text, aliases text, kind text,
  district_code text, municipality text, sub_region text, zone_type text, elevation_m integer, winter_risk boolean,
  lat double precision, lon double precision, boundary_wkt text, parent_id text, confidence text, osm_id text
);
create table app_private.seed_loads (
  name text primary key,
  sha256 text not null,
  loaded_at timestamptz not null default now(),
  counts jsonb not null
);
revoke all on table app_private.seed_districts, app_private.seed_zones, app_private.seed_places, app_private.seed_loads
  from public, anon, authenticated;

create function app_private.places_load_seed(p_sha256 text, p_source text default 'seed_places')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counts jsonb;
  n_zones integer;
  n_places integer;
  n_parents integer;
  n_districts integer;
begin
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'places seed ' || left(p_sha256, 12), true);

  if (select count(*) from app_private.seed_places) = 0 then
    raise exception 'the places seed is empty' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from app_private.seed_places s where not exists (select 1 from public.districts d where d.code = s.district_code)) then
    raise exception 'the places seed names an unknown district' using errcode = 'foreign_key_violation';
  end if;

  update public.districts d
  set pcode = s.pcode,
      boundary = extensions.st_multi(extensions.st_geomfromtext(s.boundary_wkt, 4326))
  from app_private.seed_districts s
  where s.code = d.code;
  get diagnostics n_districts = row_count;

  insert into public.cadastral_zones (pcode, district_code, name_ar, name_en, name_fr, boundary,
    elevation_min_m, elevation_max_m, inhabited, source, updated_at)
  select s.pcode, s.district_code, nullif(s.name_ar, ''), nullif(s.name_en, ''), nullif(s.name_fr, ''),
    extensions.st_multi(extensions.st_makevalid(extensions.st_geomfromtext(s.boundary_wkt, 4326))),
    s.elevation_min_m, s.elevation_max_m, coalesce(s.inhabited, true), p_source, now()
  from app_private.seed_zones s
  on conflict (pcode) do update
    set district_code = excluded.district_code, name_ar = excluded.name_ar, name_en = excluded.name_en,
        name_fr = excluded.name_fr, boundary = excluded.boundary, elevation_min_m = excluded.elevation_min_m,
        elevation_max_m = excluded.elevation_max_m, inhabited = excluded.inhabited, source = excluded.source,
        updated_at = now();
  get diagnostics n_zones = row_count;

  -- Places: everything but status. The insert trigger sets status (off, or paused for South/Nabatieh).
  insert into public.places (id, pcode, zone_pcode, name_ar, name_en, name_fr, aliases, kind, governorate_code,
    district_code, municipality, sub_region, zone_type, elevation_m, winter_risk, centroid, boundary,
    confidence, osm_id, source)
  select s.id, nullif(s.pcode, ''), nullif(s.zone_pcode, ''), nullif(s.name_ar, ''), nullif(s.name_en, ''),
    nullif(s.name_fr, ''), coalesce(string_to_array(nullif(s.aliases, ''), ';'), '{}'), s.kind::public.place_kind,
    d.governorate_code, s.district_code, nullif(s.municipality, ''), nullif(s.sub_region, ''),
    nullif(s.zone_type, '')::public.zone_type, s.elevation_m, coalesce(s.winter_risk, false),
    extensions.st_setsrid(extensions.st_makepoint(s.lon, s.lat), 4326)::extensions.geography,
    case when nullif(s.boundary_wkt, '') is not null
      then extensions.st_multi(extensions.st_makevalid(extensions.st_geomfromtext(s.boundary_wkt, 4326))) end,
    coalesce(nullif(s.confidence, '')::jsonb, '{}'), nullif(s.osm_id, ''), p_source
  from app_private.seed_places s
  join public.districts d on d.code = s.district_code
  on conflict (id) do update
    set pcode = excluded.pcode, zone_pcode = excluded.zone_pcode, name_ar = excluded.name_ar,
        name_en = excluded.name_en, name_fr = excluded.name_fr, aliases = excluded.aliases, kind = excluded.kind,
        governorate_code = excluded.governorate_code, district_code = excluded.district_code,
        municipality = excluded.municipality, sub_region = excluded.sub_region, zone_type = excluded.zone_type,
        elevation_m = excluded.elevation_m, winter_risk = excluded.winter_risk, centroid = excluded.centroid,
        boundary = excluded.boundary, confidence = excluded.confidence, osm_id = excluded.osm_id,
        source = excluded.source;
  get diagnostics n_places = row_count;

  -- Parents once every place exists; a parent missing from the seed is left empty.
  update public.places p
  set parent_id = case when exists (select 1 from public.places q where q.id = s.parent_id) then nullif(s.parent_id, '') end
  from app_private.seed_places s
  where s.id = p.id and p.parent_id is distinct from
    (case when exists (select 1 from public.places q where q.id = s.parent_id) then nullif(s.parent_id, '') end);
  get diagnostics n_parents = row_count;

  v_counts := jsonb_build_object(
    'districts', n_districts,
    'zones', n_zones,
    'places', n_places,
    'parents_changed', n_parents,
    'not_in_seed', (select count(*) from public.places p where not exists (select 1 from app_private.seed_places s where s.id = p.id)),
    'shared_names_changed', public.places_refresh_shared_names(),
    'vendors_relinked', public.vendors_relink_towns()
  );

  insert into app_private.seed_loads (name, sha256, loaded_at, counts)
  values ('places', p_sha256, now(), v_counts)
  on conflict (name) do update set sha256 = excluded.sha256, loaded_at = excluded.loaded_at, counts = excluded.counts;
  return v_counts;
end;
$$;
revoke all on function app_private.places_load_seed(text, text) from public, anon, authenticated;
