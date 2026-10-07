-- Phase 1b places and categories (DECISIONS §16, §17): governorates, districts, cadastral zones, the
-- all-Lebanon places list, pin snapping and place search, category labels and cuisine tags, and the
-- vendor's town link. The places data itself is a seed file built in GitHub Actions
-- (`.github/workflows/places-build.yml`) and loaded by `places_load_seed()` after each deploy.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Name normalisation ------------------------------------------------------------------------------------
-- One matching form for Arabic, English, French and Arabizi spellings: lower case, no accents, no Arabic
-- diacritics, unified alef/ya/ta marbuta, articles (al-, el-, ech-, ال) dropped, punctuation removed.
-- Used for search, aliases and duplicate detection, never for display.
create function app_private.normalize_place_name(p text) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    translate(
      lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))),
      'أإآٱىةؤئـ' || chr(1611) || chr(1612) || chr(1613) || chr(1614) || chr(1615) || chr(1616) || chr(1617) || chr(1618),
      'اااايهوي'
    ),
    '(^|[\s-])ال', '\1', 'g'),
    '(^|[\s-])(el|al|ech|ach|ej|ez|ed|es|er|et|en|ad|as|ash|ar|at|az)[\s''-]+', '\1', 'g'),
    '[^[:alnum:]\s]', ' ', 'g'),
    '\s+', ' ', 'g')), '');
$$;
revoke all on function app_private.normalize_place_name(text) from public;
grant execute on function app_private.normalize_place_name(text) to anon, authenticated, service_role;

-- Enums -------------------------------------------------------------------------------------------------
create type public.place_kind as enum ('city', 'town', 'village', 'hamlet', 'neighbourhood');
create type public.service_status as enum ('off', 'on', 'paused');
create type public.zone_type as enum (
  'coastal', 'lower_mountain', 'middle_mountain', 'high_mountain', 'inland_valley', 'semi_arid'
);
create type public.field_confidence as enum ('verified', 'high', 'medium');
-- Item-level categories (§17), used by the menu tables in Phase 3.
create type public.meal_time as enum ('breakfast', 'lunch', 'dinner', 'late_night');
create type public.allergen as enum ('gluten', 'nuts', 'dairy', 'eggs', 'sesame', 'fish', 'shellfish', 'soy');

-- Administrative structure (§16): 9 governorates, 26 districts ------------------------------------------
create table public.governorates (
  code text primary key check (code ~ '^[a-z_]+$'),
  name_ar text not null,
  name_en text not null,
  name_fr text not null,
  sort_order smallint not null
);

create table public.districts (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  governorate_code text not null references public.governorates (code),
  name_ar text not null,
  name_en text not null,
  name_fr text not null,
  -- OCHA COD-AB P-code, filled by the seed load.
  pcode text unique,
  boundary extensions.geometry(multipolygon, 4326),
  constraint districts_code_gov_unique unique (code, governorate_code)
);
create index districts_boundary_idx on public.districts using gist (boundary);

-- Cadastral zones (OCHA COD-AB admin 3): every zone, inhabited or not, for pin snapping.
create table public.cadastral_zones (
  pcode text primary key,
  district_code text not null references public.districts (code),
  name_ar text,
  name_en text,
  name_fr text,
  boundary extensions.geometry(multipolygon, 4326) not null,
  elevation_min_m integer,
  elevation_max_m integer,
  -- false for the zones with no populated place in them (about 340, §16): pin snapping only.
  inhabited boolean not null default true,
  source text not null,
  updated_at timestamptz not null default now(),
  constraint cadastral_zones_has_name check (coalesce(name_ar, name_en) is not null)
);
create index cadastral_zones_boundary_idx on public.cadastral_zones using gist (boundary);
create index cadastral_zones_district_idx on public.cadastral_zones (district_code);

-- Places: every delivery destination (§16) -------------------------------------------------------------
create table public.places (
  id text primary key check (id ~ '^LB-[A-Z]{3}-[A-Z0-9]+(-[A-Z0-9]+)*$'),
  pcode text,
  zone_pcode text references public.cadastral_zones (pcode),
  name_ar text,
  name_en text,
  name_fr text,
  aliases text[] not null default '{}',
  kind public.place_kind not null,
  governorate_code text not null,
  district_code text not null,
  municipality text,
  sub_region text,
  zone_type public.zone_type,
  elevation_m integer,
  winter_risk boolean not null default false,
  centroid extensions.geography(point, 4326) not null,
  boundary extensions.geometry(multipolygon, 4326),
  parent_id text references public.places (id) on delete set null,
  service_status public.service_status not null default 'off',
  paused_reason text,
  -- Per-field confidence (§16): {"name_ar": "verified", "centroid": "high", "elevation_m": "medium", ...}
  confidence jsonb not null default '{}' check (jsonb_typeof(confidence) = 'object'),
  osm_id text,
  source text not null,
  -- Same normalised English name exists elsewhere: customers see the district with the name (§16).
  name_is_shared boolean not null default false,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint places_has_name check (coalesce(name_ar, name_en) is not null),
  constraint places_district_fk foreign key (district_code, governorate_code)
    references public.districts (code, governorate_code),
  constraint places_paused_has_reason check ((service_status = 'paused') = (paused_reason is not null)),
  constraint places_not_own_parent check (parent_id is distinct from id)
);
create index places_centroid_idx on public.places using gist (centroid);
create index places_boundary_idx on public.places using gist (boundary) where boundary is not null;
create index places_zone_idx on public.places (zone_pcode);
create index places_district_idx on public.places (district_code);
create index places_parent_idx on public.places (parent_id) where parent_id is not null;
create index places_on_idx on public.places (district_code) where service_status = 'on';
create index places_search_idx on public.places using gin (search_text extensions.gin_trgm_ops);

create function app_private.places_prepare() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_gov text;
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
  new.search_text := coalesce(array_to_string(array(
    select distinct n from unnest(array[
      app_private.normalize_place_name(new.name_ar),
      app_private.normalize_place_name(new.name_en),
      app_private.normalize_place_name(new.name_fr)
    ] || array(select app_private.normalize_place_name(a) from unnest(new.aliases) a)) n
    where n is not null
  ), ' | '), '');
  return new;
end;
$$;
create trigger places_prepare before insert or update on public.places
  for each row execute function app_private.places_prepare();
create trigger places_touch before update on public.places
  for each row execute function app_private.touch_updated_at();
-- Switching a place on, off or paused is one admin action in the audit log (§16).
create trigger places_audit_status after update of service_status, paused_reason on public.places
  for each row execute function app_private.audit_row();

-- Category labels (§17) ---------------------------------------------------------------------------------
create table public.business_type_labels (
  business_type public.business_type primary key,
  name_ar text not null,
  name_en text not null,
  name_fr text not null,
  sort_order smallint not null
);

-- Cuisine tags: extendable by the admin only (§17).
create table public.cuisine_tags (
  tag text primary key check (tag ~ '^[a-z][a-z0-9_]*$'),
  name_ar text not null,
  name_en text not null,
  name_fr text not null,
  sort_order smallint not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create trigger cuisine_tags_audit after insert or update or delete on public.cuisine_tags
  for each row execute function app_private.audit_row();

-- Vendors: town link and tag check ----------------------------------------------------------------------
alter table public.vendors add column town_id text references public.places (id) on delete set null;
create index vendors_town_idx on public.vendors (town_id) where town_id is not null;

create function app_private.vendors_check_cuisine_tags() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bad text;
begin
  select t into v_bad from unnest(new.cuisine_tags) t
  where not exists (select 1 from public.cuisine_tags c where c.tag = t and c.active)
  limit 1;
  if v_bad is not null then
    raise exception 'unknown cuisine tag %', v_bad using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger vendors_check_cuisine_tags before insert or update of cuisine_tags on public.vendors
  for each row execute function app_private.vendors_check_cuisine_tags();

-- Pin snapping (§16): the cadastral zone containing the pin, then the nearest place in that zone.
-- Outside every zone (sea, border strip, missing polygon): the nearest place within p_fallback_m.
-- Returns no row when nothing is close enough; the bot then asks for district and place from lists.
create function public.place_for_point(
  p_point extensions.geography,
  p_zone_radius_m double precision default 5000,
  p_fallback_m double precision default 3000
)
returns table (place_id text, zone_pcode text, distance_m double precision, method text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_geom extensions.geometry := p_point::extensions.geometry;
  v_zone text;
begin
  select z.pcode into v_zone from public.cadastral_zones z
  where extensions.st_covers(z.boundary, v_geom)
  order by z.pcode limit 1;

  if v_zone is not null then
    return query
      select p.id, v_zone, extensions.st_distance(p.centroid, p_point), 'zone'::text
      from public.places p
      where p.zone_pcode = v_zone and extensions.st_dwithin(p.centroid, p_point, p_zone_radius_m)
      order by
        (p.boundary is not null and p.kind = 'neighbourhood' and extensions.st_covers(p.boundary, v_geom)) desc,
        p.centroid operator(extensions.<->) p_point
      limit 1;
    if found then
      return;
    end if;
  end if;

  return query
    select p.id, v_zone, extensions.st_distance(p.centroid, p_point), 'nearest'::text
    from public.places p
    where extensions.st_dwithin(p.centroid, p_point, p_fallback_m)
    order by p.centroid operator(extensions.<->) p_point
    limit 1;
end;
$$;

-- Place search for lists, the address Flow and the AI's place hints. Typed names in any of the four
-- languages; same-name places come back with their district in the label (§16).
create function public.search_places(
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
  with q as (select app_private.normalize_place_name(p_query) as n)
  select p.id, p.name_ar, p.name_en, p.name_fr, p.kind, p.district_code,
    case when p.name_is_shared then coalesce(p.name_en, p.name_ar) || ' (' || d.name_en || ')' else coalesce(p.name_en, p.name_ar) end,
    case when p.name_is_shared then coalesce(p.name_ar, p.name_en) || ' (' || d.name_ar || ')' else coalesce(p.name_ar, p.name_en) end,
    p.service_status,
    extensions.word_similarity(q.n, p.search_text)
  from public.places p
  join public.districts d on d.code = p.district_code
  cross join q
  where q.n is not null
    and (p_district_code is null or p.district_code = p_district_code)
    and (q.n operator(extensions.<%) p.search_text or p.search_text like '%' || q.n || '%')
  order by extensions.word_similarity(q.n, p.search_text) desc,
    (p.kind in ('city', 'town')) desc, p.id
  limit least(greatest(p_limit, 1), 50);
$$;

-- Admin switches a place on, off or paused (§16). Runs as the caller: the places_admin_update policy
-- decides, and the places_audit_status trigger records it with the reason.
create function public.place_set_service_status(
  p_place_id text,
  p_status public.service_status,
  p_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not app_private.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'only the admin switches places' using errcode = 'insufficient_privilege';
  end if;
  if p_status = 'paused' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'a paused place needs a reason' using errcode = 'check_violation';
  end if;
  perform set_config('app.actor_kind', case when app_private.is_admin() then 'operator' else 'service' end, true);
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

-- Re-derives each vendor's town from its location (after a places seed load, or for one vendor).
create function public.vendors_relink_towns(p_vendor_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.vendors v
  set town_id = s.place_id
  from (
    select v2.id, (select f.place_id from public.place_for_point(v2.location) f) as place_id
    from public.vendors v2
    where v2.location is not null and (p_vendor_id is null or v2.id = p_vendor_id)
  ) s
  where v.id = s.id and v.town_id is distinct from s.place_id
    and coalesce(v.field_sources ->> 'town_id', 'seed') = 'seed';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- A new or moved vendor pin gets its town, unless the merchant set the town itself.
create function app_private.vendors_link_town() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.location is not null
     and (tg_op = 'INSERT' and new.town_id is null
          or tg_op = 'UPDATE' and new.location is distinct from old.location and new.town_id is not distinct from old.town_id
             and coalesce(new.field_sources ->> 'town_id', 'seed') = 'seed') then
    new.town_id := (select f.place_id from public.place_for_point(new.location) f);
  end if;
  return new;
end;
$$;
create trigger vendors_link_town before insert or update of location on public.vendors
  for each row execute function app_private.vendors_link_town();

-- Marks names that exist in more than one place, after a seed load.
create function public.places_refresh_shared_names()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.places p
  set name_is_shared = s.shared
  from (
    select id, count(*) over (partition by app_private.normalize_place_name(coalesce(name_en, name_ar))) > 1 as shared
    from public.places
  ) s
  where p.id = s.id and p.name_is_shared is distinct from s.shared;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Row-level security ------------------------------------------------------------------------------------
alter table public.governorates enable row level security;
alter table public.districts enable row level security;
alter table public.cadastral_zones enable row level security;
alter table public.places enable row level security;
alter table public.business_type_labels enable row level security;
alter table public.cuisine_tags enable row level security;

revoke all on table public.governorates, public.districts, public.cadastral_zones, public.places,
  public.business_type_labels, public.cuisine_tags from public, anon, authenticated;
grant all on table public.governorates, public.districts, public.cadastral_zones, public.places,
  public.business_type_labels, public.cuisine_tags to service_role;

-- Geography and categories are public reference data (OCHA, CAS, OSM with attribution).
grant select on table public.governorates, public.districts, public.cadastral_zones, public.places,
  public.business_type_labels, public.cuisine_tags to anon, authenticated;
create policy governorates_read on public.governorates for select to anon, authenticated using (true);
create policy districts_read on public.districts for select to anon, authenticated using (true);
create policy cadastral_zones_read on public.cadastral_zones for select to anon, authenticated using (true);
create policy places_read on public.places for select to anon, authenticated using (true);
create policy business_type_labels_read on public.business_type_labels for select to anon, authenticated using (true);
create policy cuisine_tags_read on public.cuisine_tags for select to anon, authenticated using (true);

-- Cuisine tags: the admin adds, renames or retires tags; nobody deletes one in use.
grant insert, update on table public.cuisine_tags to authenticated;
create policy cuisine_tags_admin_insert on public.cuisine_tags for insert to authenticated
  with check ((select app_private.is_admin()));
create policy cuisine_tags_admin_update on public.cuisine_tags for update to authenticated
  using ((select app_private.is_admin())) with check ((select app_private.is_admin()));

-- Places: only the admin changes service status (through place_set_service_status, which sets the reason).
grant update (service_status, paused_reason) on table public.places to authenticated;
create policy places_admin_update on public.places for update to authenticated
  using ((select app_private.is_admin())) with check ((select app_private.is_admin()));

-- Clients may read a vendor's town (a public page shows it).
grant select (town_id) on table public.vendors to anon, authenticated;

revoke all on function public.place_for_point(extensions.geography, double precision, double precision) from public;
revoke all on function public.search_places(text, text, integer) from public;
revoke all on function public.place_set_service_status(text, public.service_status, text) from public, anon;
revoke all on function public.vendors_relink_towns(uuid) from public, anon, authenticated;
revoke all on function public.places_refresh_shared_names() from public, anon, authenticated;
grant execute on function public.place_for_point(extensions.geography, double precision, double precision) to authenticated, service_role;
grant execute on function public.search_places(text, text, integer) to anon, authenticated, service_role;
grant execute on function public.place_set_service_status(text, public.service_status, text) to authenticated, service_role;
grant execute on function public.vendors_relink_towns(uuid) to service_role;
grant execute on function public.places_refresh_shared_names() to service_role;
revoke all on function app_private.places_prepare() from public;
revoke all on function app_private.vendors_check_cuisine_tags() from public;
revoke all on function app_private.vendors_link_town() from public;

-- Reference data ----------------------------------------------------------------------------------------
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS §16-§17, 8 October 2026', false);

insert into public.governorates (code, name_ar, name_en, name_fr, sort_order) values
  ('beirut', 'بيروت', 'Beirut', 'Beyrouth', 1),
  ('mount_lebanon', 'جبل لبنان', 'Mount Lebanon', 'Mont-Liban', 2),
  ('keserwan_jbeil', 'كسروان - جبيل', 'Keserwan-Jbeil', 'Kesrouan-Jbeil', 3),
  ('north', 'الشمال', 'North', 'Nord', 4),
  ('akkar', 'عكار', 'Akkar', 'Akkar', 5),
  ('beqaa', 'البقاع', 'Beqaa', 'Békaa', 6),
  ('baalbek_hermel', 'بعلبك - الهرمل', 'Baalbek-Hermel', 'Baalbek-Hermel', 7),
  ('south', 'الجنوب', 'South', 'Sud', 8),
  ('nabatieh', 'النبطية', 'Nabatieh', 'Nabatieh', 9);

insert into public.districts (code, governorate_code, name_ar, name_en, name_fr) values
  ('BEY', 'beirut', 'بيروت', 'Beirut', 'Beyrouth'),
  ('BAB', 'mount_lebanon', 'بعبدا', 'Baabda', 'Baabda'),
  ('MTN', 'mount_lebanon', 'المتن', 'Matn', 'Metn'),
  ('CHF', 'mount_lebanon', 'الشوف', 'Chouf', 'Chouf'),
  ('ALY', 'mount_lebanon', 'عاليه', 'Aley', 'Aley'),
  ('KSR', 'keserwan_jbeil', 'كسروان', 'Keserwan', 'Kesrouan'),
  ('JBL', 'keserwan_jbeil', 'جبيل', 'Jbeil', 'Jbeil'),
  ('TRP', 'north', 'طرابلس', 'Tripoli', 'Tripoli'),
  ('ZGH', 'north', 'زغرتا', 'Zgharta', 'Zghorta'),
  ('BSH', 'north', 'بشري', 'Bcharre', 'Bcharré'),
  ('BAT', 'north', 'البترون', 'Batroun', 'Batroun'),
  ('KOR', 'north', 'الكورة', 'Koura', 'Koura'),
  ('MND', 'north', 'المنية - الضنية', 'Minieh-Danniyeh', 'Minieh-Denniyé'),
  ('AKR', 'akkar', 'عكار', 'Akkar', 'Akkar'),
  ('ZHL', 'beqaa', 'زحلة', 'Zahle', 'Zahlé'),
  ('WBQ', 'beqaa', 'البقاع الغربي', 'West Beqaa', 'Békaa-Ouest'),
  ('RSH', 'beqaa', 'راشيا', 'Rashaya', 'Rachaya'),
  ('BLB', 'baalbek_hermel', 'بعلبك', 'Baalbek', 'Baalbek'),
  ('HRM', 'baalbek_hermel', 'الهرمل', 'Hermel', 'Hermel'),
  ('SAI', 'south', 'صيدا', 'Saida', 'Saïda'),
  ('JZN', 'south', 'جزين', 'Jezzine', 'Jezzine'),
  ('TYR', 'south', 'صور', 'Tyre', 'Tyr'),
  ('NBT', 'nabatieh', 'النبطية', 'Nabatieh', 'Nabatieh'),
  ('MRJ', 'nabatieh', 'مرجعيون', 'Marjayoun', 'Marjayoun'),
  ('HSB', 'nabatieh', 'حاصبيا', 'Hasbaya', 'Hasbaya'),
  ('BNJ', 'nabatieh', 'بنت جبيل', 'Bint Jbeil', 'Bint Jbeil');

insert into public.business_type_labels (business_type, name_ar, name_en, name_fr, sort_order) values
  ('restaurant', 'مطعم', 'Restaurant', 'Restaurant', 1),
  ('fast_food', 'وجبات سريعة', 'Fast food', 'Restauration rapide', 2),
  ('cafe', 'مقهى', 'Café', 'Café', 3),
  ('bakery_manakish', 'فرن ومناقيش', 'Bakery & manakish', 'Boulangerie et manakish', 4),
  ('sweets_pastry', 'حلويات', 'Sweets & pastry', 'Pâtisserie', 5),
  ('ice_cream', 'بوظة', 'Ice cream', 'Glaces', 6),
  ('grocery_supermarket', 'سوبرماركت', 'Supermarket', 'Supermarché', 7),
  ('minimarket', 'دكان', 'Minimarket', 'Épicerie', 8),
  ('butcher', 'ملحمة', 'Butcher', 'Boucherie', 9),
  ('poultry', 'دجاج', 'Poultry', 'Volaille', 10),
  ('fish_market', 'سمك', 'Fish market', 'Poissonnerie', 11),
  ('produce', 'خضار وفواكه', 'Fruit & vegetables', 'Fruits et légumes', 12),
  ('roastery_nuts', 'محمصة', 'Roastery & nuts', 'Torréfaction et fruits secs', 13),
  ('home_essentials', 'مياه وغاز', 'Water & gas', 'Eau et gaz', 14),
  ('other_food', 'غير ذلك', 'Other food', 'Autre', 15);

insert into public.cuisine_tags (tag, name_ar, name_en, name_fr, sort_order) values
  ('lebanese', 'لبناني', 'Lebanese', 'Libanais', 1),
  ('mezze', 'مازة', 'Mezze', 'Mezzé', 2),
  ('grills_mashawi', 'مشاوي', 'Grills', 'Grillades', 3),
  ('shawarma', 'شاورما', 'Shawarma', 'Shawarma', 4),
  ('falafel', 'فلافل', 'Falafel', 'Falafel', 5),
  ('manakish', 'مناقيش', 'Manakish', 'Manakish', 6),
  ('saj', 'صاج', 'Saj', 'Saj', 7),
  ('kaak', 'كعك', 'Kaak', 'Kaak', 8),
  ('broasted_chicken', 'بروستد', 'Broasted chicken', 'Poulet broasté', 9),
  ('burgers', 'برغر', 'Burgers', 'Burgers', 10),
  ('pizza', 'بيتزا', 'Pizza', 'Pizza', 11),
  ('italian', 'إيطالي', 'Italian', 'Italien', 12),
  ('sushi_japanese', 'سوشي وياباني', 'Sushi & Japanese', 'Sushi et japonais', 13),
  ('chinese', 'صيني', 'Chinese', 'Chinois', 14),
  ('asian', 'آسيوي', 'Asian', 'Asiatique', 15),
  ('armenian', 'أرمني', 'Armenian', 'Arménien', 16),
  ('syrian_aleppan', 'سوري وحلبي', 'Syrian & Aleppan', 'Syrien et alépin', 17),
  ('seafood', 'بحري', 'Seafood', 'Fruits de mer', 18),
  ('healthy_salads', 'صحي وسلطات', 'Healthy & salads', 'Sain et salades', 19),
  ('breakfast', 'فطور', 'Breakfast', 'Petit-déjeuner', 20),
  ('brunch', 'برانش', 'Brunch', 'Brunch', 21),
  ('sandwiches', 'سندويشات', 'Sandwiches', 'Sandwichs', 22),
  ('crepes_waffles', 'كريب ووافل', 'Crêpes & waffles', 'Crêpes et gaufres', 23),
  ('lebanese_sweets', 'حلو عربي', 'Lebanese sweets', 'Douceurs libanaises', 24),
  ('cakes', 'قوالب حلوى', 'Cakes', 'Gâteaux', 25),
  ('booza_ice_cream', 'بوظة', 'Booza & ice cream', 'Booza et glaces', 26),
  ('specialty_coffee', 'قهوة مختصة', 'Specialty coffee', 'Café de spécialité', 27),
  ('fresh_juices', 'عصير طازج', 'Fresh juices', 'Jus frais', 28),
  ('vegan', 'نباتي صرف', 'Vegan', 'Végétalien', 29),
  ('kids', 'للأطفال', 'Kids', 'Enfants', 30);

select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);
