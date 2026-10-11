-- Builds the all-Lebanon places seed (DECISIONS §16) inside a throwaway PostGIS database.
-- Inputs, loaded by scripts/places/build.sh:
--   raw.adm2, raw.adm3  OCHA COD-AB districts and cadastral zones (ogr2ogr, columns lower case)
--   raw.cas             optional CAS cadastral names and P-codes
--   raw.osm             OpenStreetMap place nodes (Overpass, flattened to CSV)
--   raw.dem             Copernicus GLO-30 terrain model tiles (raster2pgsql)
--   raw.curated         scripts/places/curated.csv  (§16's named special places and alias examples)
--   raw.alias_corrections scripts/places/alias-corrections.csv (OSM aliases that belong to another place)
--   raw.review          scripts/places/review-set.csv (the Gazetteer report's places: review and test set)
-- Outputs: out.districts, out.zones, out.places, and b.report_* tables for report.md.
\set ON_ERROR_STOP on
create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists postgis_raster;
drop schema if exists b cascade;
drop schema if exists out cascade;
create schema b;
create schema out;

-- Same rules as app_private.normalize_place_name() in the places migration.
create function b.norm(p text) returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    translate(lower(unaccent(coalesce(p, ''))), 'أإآٱىةؤئـ' || chr(1611) || chr(1612) || chr(1613) || chr(1614) || chr(1615) || chr(1616) || chr(1617) || chr(1618), 'اااايهوي'),
    '(^|[\s-])ال', '\1', 'g'),
    '(^|[\s-])(el|al|ech|ach|ej|ez|ed|es|er|et|en|ad|as|ash|ar|at|az)[\s''-]+', '\1', 'g'),
    '[^[:alnum:]\s]', ' ', 'g'), '\s+', ' ', 'g')), '')
$$;
create function b.slug(p text) returns text language sql immutable as $$
  select upper(btrim(regexp_replace(lower(unaccent(coalesce(p, ''))), '[^a-z0-9]+', '-', 'g'), '-'))
$$;
create function b.is_arabic(p text) returns boolean language sql immutable as $$
  select coalesce(p ~ '[؀-ۿ]', false)
$$;
-- CAS zones named "Litige" are disputed cadastral areas, not villages: kept for pin snapping only.
create function b.is_litige(p text) returns boolean language sql immutable as $$
  select coalesce(p ~* '^\s*litige', false)
$$;
-- Same phonetic key as app_private.place_phonetic_key() (Ba3qlin = Baakline = Baaqline = بعقلين).
create function b.phon(p text) returns text
language sql
immutable
parallel safe
as $$
  select nullif(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    translate(
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        coalesce(b.norm(p), ''),
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
-- Similarity of two names in any script (best of the pairs).
create function b.namesim(a1 text, a2 text, b1 text, b2 text) returns real language sql immutable as $$
  select greatest(
    case when char_length(b.phon(coalesce(a1, a2))) >= 3
          and b.phon(coalesce(a1, a2)) in (b.phon(b1), b.phon(b2)) then 0.9 else 0 end,
    case when b.norm(a2) is not null and b.norm(a2) = b.norm(b2) then 1 else 0 end,
    coalesce(similarity(b.norm(a1), b.norm(b1)), 0), coalesce(similarity(b.norm(a1), b.norm(b2)), 0),
    coalesce(similarity(b.norm(a2), b.norm(b1)), 0), coalesce(similarity(b.norm(a2), b.norm(b2)), 0))
$$;

-- 1. COD-AB columns differ between releases (ADM3_EN/ADM3_AR or adm3_name/adm3_name1): detect them.
create function b.col(p_table text, p_regex text) returns text language sql stable as $$
  select column_name::text from information_schema.columns
  where table_schema = 'raw' and table_name = p_table and column_name ~* p_regex
  order by column_name limit 1
$$;

do $$
declare
  t text;
  lvl int;
  c_pcode text; c_en text; c_ar text; c_fr text; c_name text; c_name1 text; c_parent text;
begin
  foreach t in array array['adm2', 'adm3'] loop
    lvl := right(t, 1)::int;
    c_pcode := b.col(t, format('^adm%s_?pcode$', lvl));
    c_en := b.col(t, format('^adm%s_?en$', lvl));
    c_ar := b.col(t, format('^adm%s_?ar$', lvl));
    c_fr := b.col(t, format('^adm%s_?fr$', lvl));
    c_name := b.col(t, format('^adm%s_?name$', lvl));
    c_name1 := b.col(t, format('^adm%s_?name_?1$', lvl));
    c_parent := b.col(t, format('^adm%s_?pcode$', lvl - 1));
    if c_pcode is null then
      raise exception 'raw.% has no adm%_pcode column; columns: %', t, lvl,
        (select string_agg(column_name, ', ') from information_schema.columns where table_schema = 'raw' and table_name = t);
    end if;
    execute format($q$
      create table b.%1$s as
      select %2$I::text as pcode, %3$s::text as parent_pcode,
        %4$s::text as n1, %5$s::text as n2, %6$s::text as n3, %7$s::text as n4,
        st_multi(st_makevalid(st_transform(geom, 4326)))::geometry(multipolygon, 4326) as geom
      from raw.%1$I
    $q$, t, c_pcode, coalesce(quote_ident(c_parent), 'null'),
      coalesce(quote_ident(c_en), 'null'), coalesce(quote_ident(c_ar), 'null'),
      coalesce(quote_ident(c_name), 'null'), coalesce(quote_ident(c_name1), 'null'));
    execute format('alter table b.%I add column fr text', t);
    if c_fr is not null then
      execute format('update b.%1$I x set fr = r.%2$I from raw.%1$I r where r.%3$I::text = x.pcode', t, c_fr, c_pcode);
    end if;
  end loop;
end;
$$;

-- English and Arabic names whichever column holds them.
create table b.adm2n as
select pcode, parent_pcode, geom,
  (select n from unnest(array[n1, n3, n4, n2]) n where n is not null and not b.is_arabic(n) limit 1) as name_en,
  (select n from unnest(array[n2, n4, n3, n1]) n where b.is_arabic(n) limit 1) as name_ar
from b.adm2
where pcode ~* '^LB';
-- COD-AB also carries disputed-border polygons ("Conflict", P-code 0): not cadastral zones.
create table b.adm3n as
select pcode, parent_pcode, geom, fr as name_fr,
  (select n from unnest(array[n1, n3, n4, n2]) n where n is not null and not b.is_arabic(n) limit 1) as name_en,
  (select n from unnest(array[n2, n4, n3, n1]) n where b.is_arabic(n) limit 1) as name_ar
from b.adm3
where nullif(pcode, '0') is not null and coalesce(n1, n3, '') !~* '^conflict';

-- 2. Districts: COD-AB names to our 3-letter codes (first match wins; "bint jbeil" before "jbeil").
create table b.district_patterns (ord int, code text, pattern text);
insert into b.district_patterns values
  (1, 'BNJ', 'bint|bent'), (2, 'WBQ', 'west|gharb|western'), (3, 'MND', 'mini|danni|denni|dinni'),
  (4, 'BEY', 'beirut|bayrut|beyrouth'), (5, 'BAB', 'baabda'), (6, 'MTN', 'metn|meten|matn'),
  (7, 'CHF', 'chouf|shouf'), (8, 'ALY', 'aley|alay'), (9, 'KSR', 'kes|kas|kis'), (10, 'JBL', 'jbeil|jubail|byblos'),
  (11, 'TRP', 'tripoli|trabl|tarabl'), (12, 'ZGH', 'zgh'), (13, 'BSH', 'bcharr|bsharr|becharr|bsherr'),
  (14, 'BAT', 'batroun'), (15, 'KOR', 'koura|kura'), (16, 'AKR', 'akkar'), (17, 'ZHL', 'zahl'),
  (18, 'RSH', 'rach|rash'), (19, 'BLB', 'baalbe'), (20, 'HRM', 'hermel'), (21, 'SAI', 'saida|sidon|sayda'),
  (22, 'JZN', 'jezz|jizz'), (23, 'TYR', 'tyr|sour|^sur'), (24, 'NBT', 'naba'), (25, 'MRJ', 'marj'), (26, 'HSB', 'hasba|hasb');

create table b.districts as
select distinct on (a.pcode) a.pcode, p.code, a.name_en, a.geom
from b.adm2n a
join b.district_patterns p on b.norm(a.name_en) ~ p.pattern
order by a.pcode, p.ord;

do $$
declare
  v_missing text;
  v_dup text;
begin
  select string_agg(coalesce(name_en, pcode), ', ') into v_missing from b.adm2n a
  where not exists (select 1 from b.districts d where d.pcode = a.pcode);
  select string_agg(code, ', ') into v_dup from (select code from b.districts group by code having count(*) > 1) x;
  if v_missing is not null or v_dup is not null or (select count(distinct code) from b.districts) <> 26 then
    raise exception 'district mapping failed. unmatched: %; duplicated codes: %; matched: %', v_missing, v_dup,
      (select string_agg(code || '=' || name_en, ', ') from b.districts);
  end if;
end;
$$;

-- 3. Cadastral zones with their district (by parent P-code, else by location) and CAS names.
create table b.zones as
select z.pcode, z.name_en, z.name_ar, z.name_fr,
  coalesce(d.code, (select d2.code from b.districts d2 where st_covers(d2.geom, st_pointonsurface(z.geom)) limit 1)) as district_code,
  z.geom
from b.adm3n z
left join b.districts d on d.pcode = z.parent_pcode;
create index on b.zones using gist (geom);

do $$
declare
  c_pcode text := b.col('cas', 'pcode');
  c_ar text := (select column_name from information_schema.columns where table_schema = 'raw' and table_name = 'cas'
                and column_name ~* '(ar|arab)' and column_name !~* 'pcode' order by column_name limit 1);
begin
  if c_pcode is not null and c_ar is not null then
    execute format('update b.zones z set name_ar = coalesce(z.name_ar, c.%I) from raw.cas c where c.%I::text = z.pcode', c_ar, c_pcode);
  end if;
exception when undefined_table then
  null;
end;
$$;

-- Elevation range per zone from the terrain model.
alter table b.zones add column elevation_min_m int, add column elevation_max_m int;
-- Lebanon spans -0 to ~3,090 m; anything outside -450..3,100 is a nodata or void pixel.
create function b.elev(v double precision) returns int language sql immutable as $$
  select case when v between -450 and 3100 then round(v)::int end
$$;
update b.zones z set elevation_min_m = s.mn, elevation_max_m = s.mx
from (
  select x.pcode, b.elev(min(x.mn)) as mn, b.elev(max(x.mx)) as mx
  from (
    select z2.pcode, (st_summarystats(st_clip(r.rast, z2.geom, true), 1, true)).min as mn,
      (st_summarystats(st_clip(r.rast, z2.geom, true), 1, true)).max as mx
    from b.zones z2 join raw.dem r on st_intersects(r.rast, z2.geom)
  ) x
  where x.mn between -450 and 3100 and x.mx between -450 and 3100
  group by x.pcode
) s
where s.pcode = z.pcode;

-- 4. OSM place nodes inside Lebanon's zones.
create table b.p as
select o.osm_id::text as osm_id,
  case o.place
    when 'city' then 'city' when 'town' then 'town' when 'village' then 'village'
    when 'suburb' then 'neighbourhood' when 'quarter' then 'neighbourhood' when 'neighbourhood' then 'neighbourhood'
    else 'hamlet' end as kind,
  o.place as osm_place,
  coalesce(nullif(o.name_ar, ''), case when b.is_arabic(o.name) then o.name end) as name_ar,
  coalesce(nullif(o.name_en, ''), nullif(o.int_name, ''), case when not b.is_arabic(o.name) then nullif(o.name, '') end, nullif(o.name_fr, '')) as name_en,
  nullif(o.name_fr, '') as name_fr,
  array_remove(string_to_array(concat_ws(';', o.alt_name, o.old_name, o.loc_name, o.official_name, o.int_name, o.name), ';'), '') as aliases,
  nullif(o.population, '')::text as population,
  z.pcode as zone_pcode, z.district_code,
  st_setsrid(st_makepoint(o.lon, o.lat), 4326) as geom,
  'osm'::text as origin,
  null::text as parent_hint
from raw.osm o
join b.zones z on st_covers(z.geom, st_setsrid(st_makepoint(o.lon, o.lat), 4326))
where coalesce(nullif(o.name, ''), nullif(o.name_ar, ''), nullif(o.name_en, '')) is not null;
create index on b.p using gist (geom);

-- 5. Curated places (§16): merge into a matching OSM place within 1.5 km, else add.
update b.p p
set aliases = p.aliases || string_to_array(c.aliases, ';') || array[p.name_en, c.name_fr],
  name_en = c.name_en,
  name_ar = coalesce(p.name_ar, c.name_ar),
  kind = case when c.kind = 'neighbourhood' and c.parent_name_en <> '' then 'neighbourhood' else p.kind end,
  parent_hint = nullif(c.parent_name_en, ''),
  origin = 'osm+curated'
from raw.curated c
where p.osm_id = (
  select p2.osm_id from b.p p2
  where st_dwithin(p2.geom::geography, st_setsrid(st_makepoint(c.lon, c.lat), 4326)::geography, 3000)
    and b.namesim(p2.name_en, p2.name_ar, c.name_en, c.name_ar) >= 0.45
    -- Never into its own parent (Dawha Aramoun is not Aramoun).
    and not (c.parent_name_en <> '' and b.namesim(p2.name_en, p2.name_ar, c.parent_name_en, null) >= 0.8)
  order by b.namesim(p2.name_en, p2.name_ar, c.name_en, c.name_ar) desc limit 1);

insert into b.p (osm_id, kind, osm_place, name_ar, name_en, name_fr, aliases, zone_pcode, district_code, geom, origin, parent_hint)
select null, c.kind, null, c.name_ar, c.name_en, nullif(c.name_fr, ''), string_to_array(c.aliases, ';'),
  z.pcode, z.district_code, st_setsrid(st_makepoint(c.lon, c.lat), 4326), 'curated', nullif(c.parent_name_en, '')
from raw.curated c
join b.zones z on st_covers(z.geom, st_setsrid(st_makepoint(c.lon, c.lat), 4326))
where not exists (
  select 1 from b.p p2
  where st_dwithin(p2.geom::geography, st_setsrid(st_makepoint(c.lon, c.lat), 4326)::geography, 3000)
    and b.namesim(p2.name_en, p2.name_ar, c.name_en, c.name_ar) >= 0.45
    and not (c.parent_name_en <> '' and b.namesim(p2.name_en, p2.name_ar, c.parent_name_en, null) >= 0.8));

-- A zone whose own village is not among its places (Jdeidet el-Chouf holds Boqaata but no Jdeidet node;
-- Kfarhim and Bebnine have no OSM place at all) gets one named after the zone at a point inside it
-- (centroid confidence medium; a quarter in Beirut). Listed in the report for review.
insert into b.p (osm_id, kind, osm_place, name_ar, name_en, name_fr, aliases, zone_pcode, district_code, geom, origin, parent_hint)
select null, case when z.district_code = 'BEY' then 'neighbourhood' else 'village' end, null,
  z.name_ar, z.name_en, z.name_fr, '{}', z.pcode, z.district_code, st_pointonsurface(z.geom), 'zone', null
from b.zones z
where z.district_code is not null and coalesce(z.name_en, z.name_ar) is not null
  and not b.is_litige(z.name_en)
  and not exists (select 1 from b.p p where p.zone_pcode = z.pcode
                  and b.namesim(p.name_en, p.name_ar, z.name_en, z.name_ar) >= 0.4)
  -- The village is already there as a place just across the zone line (Chattaha, Jabaa, Miriata).
  and not exists (select 1 from b.p p where p.district_code = z.district_code
                  and st_dwithin(p.geom::geography, st_pointonsurface(z.geom)::geography, 3000)
                  and b.namesim(p.name_en, p.name_ar, z.name_en, z.name_ar) >= 0.8);

-- Same name twice within 300 m (a node mapped twice): keep the more important one.
delete from b.p a using b.p c
where a.ctid <> c.ctid and st_dwithin(a.geom::geography, c.geom::geography, 300)
  and b.norm(coalesce(a.name_en, a.name_ar)) = b.norm(coalesce(c.name_en, c.name_ar))
  and (array_position(array['city', 'town', 'village', 'neighbourhood', 'hamlet'], a.kind),
       coalesce(a.osm_id, '~'))
    > (array_position(array['city', 'town', 'village', 'neighbourhood', 'hamlet'], c.kind),
       coalesce(c.osm_id, '~'));

-- The same place under two spellings within 1.5 km in one district (same Arabic name or phonetic key:
-- Adliyeh / Palais de Justice, Ras Beirut twice, Tripoli / Trablous et-Tell): keep one, curated first,
-- then the more important kind; the other's names become aliases. Farther apart, same-name villages
-- stay separate records (§16).
create table b.dup as
select a.ctid as drop_ctid, (
    select c.ctid from b.p c
    where c.ctid <> a.ctid and c.district_code = a.district_code
      and st_dwithin(a.geom::geography, c.geom::geography, 1500)
      and (b.norm(a.name_ar) = b.norm(c.name_ar) or b.namesim(a.name_en, a.name_ar, c.name_en, c.name_ar) >= 0.9)
      and (a.origin not like '%curated', array_position(array['city', 'town', 'village', 'neighbourhood', 'hamlet'], a.kind),
           coalesce(a.osm_id, '~'))
        > (c.origin not like '%curated', array_position(array['city', 'town', 'village', 'neighbourhood', 'hamlet'], c.kind),
           coalesce(c.osm_id, '~'))
    order by (c.origin not like '%curated'), array_position(array['city', 'town', 'village', 'neighbourhood', 'hamlet'], c.kind),
      coalesce(c.osm_id, '~')
    limit 1) as keep_ctid
from b.p a;
delete from b.dup where keep_ctid is null;
-- A kept place that is itself dropped would chain; resolve to the final keeper.
update b.dup d set keep_ctid = d2.keep_ctid from b.dup d2 where d.keep_ctid = d2.drop_ctid;
update b.p k set aliases = k.aliases || x.names
from (
  select d.keep_ctid, array_agg(n) filter (where n is not null) as names
  from b.dup d join b.p p on p.ctid = d.drop_ctid
  cross join lateral unnest(array[p.name_en, p.name_fr] || p.aliases) n
  group by d.keep_ctid
) x
where k.ctid = x.keep_ctid;
delete from b.p p using b.dup d where p.ctid = d.drop_ctid;

-- 6. Identity: the anchor of each zone is the place named like the zone (its municipality village).
alter table b.p add column pid serial, add column anchor boolean not null default false;
update b.p p set anchor = true
from (
  select distinct on (p2.zone_pcode) p2.pid
  from b.p p2 join b.zones z on z.pcode = p2.zone_pcode
  where p2.kind <> 'neighbourhood' and not b.is_litige(z.name_en)
    and b.namesim(p2.name_en, p2.name_ar, z.name_en, z.name_ar) >= 0.4
  order by p2.zone_pcode, b.namesim(p2.name_en, p2.name_ar, z.name_en, z.name_ar) desc,
    array_position(array['city', 'town', 'village', 'hamlet'], p2.kind), p2.pid
) a
where a.pid = p.pid;

-- 7. IDs: LB-<district>-<NAME>; a repeated name in a district takes its zone, then its OSM id.
alter table b.p add column id text;
update b.p p set id = 'LB-' || p.district_code || '-' || coalesce(nullif(b.slug(p.name_en), ''), 'N' || p.osm_id, 'P' || p.pid);
with dup as (
  select pid, row_number() over (partition by id order by anchor desc,
    array_position(array['city', 'town', 'village', 'neighbourhood', 'hamlet'], kind), osm_id, pid) as rn
  from b.p
)
update b.p p set id = p.id || '-' || coalesce(nullif(b.slug(z.name_en), ''), z.pcode)
from dup d, b.zones z
where d.pid = p.pid and d.rn > 1 and z.pcode = p.zone_pcode;
with dup as (
  select pid, row_number() over (partition by id order by osm_id, pid) as rn from b.p
)
update b.p p set id = p.id || '-' || coalesce('N' || p.osm_id, 'P' || p.pid)
from dup d where d.pid = p.pid and d.rn > 1;

-- 8. Parents: a curated hint names the parent; other non-anchor places hang under their zone's anchor;
-- a neighbourhood without one takes the nearest city or town within 5 km.
alter table b.p add column parent_id text;
update b.p p set parent_id = (
  select q.id from b.p q
  where q.pid <> p.pid and q.district_code = p.district_code
    and b.namesim(q.name_en, q.name_ar, p.parent_hint, null) >= 0.5
  order by b.namesim(q.name_en, q.name_ar, p.parent_hint, null) desc, q.geom <-> p.geom limit 1)
where p.parent_hint is not null;
update b.p p set parent_id = a.id
from b.p a
where p.parent_id is null and not p.anchor and a.anchor and a.zone_pcode = p.zone_pcode and a.pid <> p.pid
  and p.kind not in ('city');
update b.p p set parent_id = (
  select q.id from b.p q where q.kind in ('city', 'town') and q.pid <> p.pid
    and st_dwithin(q.geom::geography, p.geom::geography, 5000)
  order by q.geom <-> p.geom limit 1)
where p.parent_id is null and p.kind = 'neighbourhood';

-- 9. Elevation, zone type, winter risk (§16 rules; LOG.md has the thresholds).
alter table b.p add column elevation_m int, add column zone_type text, add column winter_risk boolean;
update b.p p set elevation_m = b.elev(st_value(r.rast, p.geom))
from raw.dem r where st_intersects(r.rast, p.geom);
update b.p p set zone_type = case
    when p.elevation_m is null then null
    when p.district_code = 'HRM' or (p.district_code = 'BLB' and st_x(p.geom) > 36.3) then 'semi_arid'
    when p.district_code in ('ZHL', 'WBQ', 'RSH', 'BLB') and coalesce(p.elevation_m, 0) < 1200 then 'inland_valley'
    when coalesce(p.elevation_m, 0) < 250 then 'coastal'
    when p.elevation_m < 800 then 'lower_mountain'
    when p.elevation_m < 1300 then 'middle_mountain'
    else 'high_mountain' end,
  winter_risk = coalesce(p.elevation_m >= 1200, false)
    or b.norm(p.name_en) ~ '(faraya|kfardebian|ehden|bcharr|tannourine|mzaar|faqra|cedars|laqlouq|ainata|sannine)';

-- 10. Sub-regions from the review set (§16 example sub-regions), by zone.
alter table b.p add column sub_region text, add column municipality text;
update b.p p set municipality = coalesce(z.name_en, z.name_ar) from b.zones z where z.pcode = p.zone_pcode and not b.is_litige(z.name_en);
create table b.review_match as
select r.ref, r.name_en as review_name, r.sub_region, r.lat, r.lon, r.elevation_m as review_elevation,
  (select p.pid from b.p p
   where st_dwithin(p.geom::geography, st_setsrid(st_makepoint(r.lon, r.lat), 4326)::geography, 3000)
     and b.namesim(p.name_en, p.name_ar, r.name_en, r.name_ar) >= 0.35
   order by b.namesim(p.name_en, p.name_ar, r.name_en, r.name_ar) desc,
     p.geom <-> st_setsrid(st_makepoint(r.lon, r.lat), 4326) limit 1) as pid
from raw.review r;
update b.p p set sub_region = s.sub_region
from (
  select distinct on (p2.zone_pcode) p2.zone_pcode, m.sub_region
  from b.review_match m join b.p p2 on p2.pid = m.pid
  where m.sub_region !~ '/' and m.sub_region <> ''
  order by p2.zone_pcode, m.ref
) s
where s.zone_pcode = p.zone_pcode;

-- 11. Outputs.
create table out.districts as
select code, pcode, st_astext(st_simplifypreservetopology(geom, 0.0005), 5) as boundary_wkt
from b.districts;

create table out.zones as
select z.pcode, z.district_code, z.name_ar, z.name_en, z.name_fr, z.elevation_min_m, z.elevation_max_m,
  exists (select 1 from b.p p where p.zone_pcode = z.pcode) as inhabited,
  st_astext(st_multi(st_simplifypreservetopology(z.geom, 0.0002)), 5) as boundary_wkt
from b.zones z
where z.district_code is not null
order by z.pcode;

create table out.places as
select p.id, case when p.anchor then p.zone_pcode end as pcode, p.zone_pcode,
  p.name_ar, p.name_en, p.name_fr,
  array_to_string(array(
    select distinct a from unnest(p.aliases) a
    where btrim(a) <> '' and b.norm(a) is distinct from b.norm(p.name_en) and b.norm(a) is distinct from b.norm(p.name_ar)
      and not exists (
        select 1 from raw.alias_corrections x
        where x.district_code = p.district_code and b.norm(x.name_ar) = b.norm(p.name_ar) and b.norm(x.alias) = b.norm(a)
      )
    order by a), ';') as aliases,
  p.kind, p.district_code, p.municipality, p.sub_region, p.zone_type, p.elevation_m, p.winter_risk,
  round(st_y(p.geom)::numeric, 6) as lat, round(st_x(p.geom)::numeric, 6) as lon,
  null::text as boundary_wkt,
  p.parent_id,
  jsonb_strip_nulls(jsonb_build_object(
    'name_ar', case when p.name_ar is null then null when p.anchor then 'high' else 'medium' end,
    'name_en', case when p.name_en is null then null else 'medium' end,
    'centroid', case when p.origin like 'osm%' then 'high' else 'medium' end,
    'origin', p.origin,
    'elevation_m', case when p.elevation_m is null then null else 'high' end,
    'kind', 'medium',
    'parent_id', case when p.parent_id is null then null else 'medium' end,
    'sub_region', case when p.sub_region is null then null else 'medium' end
  )) as confidence,
  p.osm_id
from b.p p
where p.district_code is not null
order by p.id;
-- A place that is its whole zone (anchor) carries the zone polygon for snapping.
update out.places o set boundary_wkt = z.boundary_wkt from out.zones z where o.pcode = z.pcode;

-- 12. Report tables.
create table b.report_counts as
select district_code, kind, count(*) as n from out.places group by 1, 2 order by 1, 2;
create table b.report_review as
select m.ref, m.review_name, o.id, o.name_en, o.elevation_m, m.review_elevation,
  round(st_distance(st_setsrid(st_makepoint(m.lon, m.lat), 4326)::geography,
    st_setsrid(st_makepoint(o.lon, o.lat), 4326)::geography))::int as distance_m
from b.review_match m left join b.p p on p.pid = m.pid left join out.places o on o.id = p.id
order by o.id nulls first, m.ref;
create table b.report_zone_places as
select p.id, p.district_code, p.name_en, p.name_ar, p.elevation_m from b.p p where p.origin = 'zone' order by p.district_code, p.id;
create table b.report_empty_zones as
select pcode, district_code, name_en, name_ar, elevation_min_m, elevation_max_m from out.zones where not inhabited order by district_code, name_en;

-- 13. §16 acceptance: the build fails rather than publish a seed that misses these.
create table b.report_dups as
select a.id, c.id as other_id, a.district_code, a.name_ar,
  round(st_distance(st_setsrid(st_makepoint(a.lon, a.lat), 4326)::geography,
    st_setsrid(st_makepoint(c.lon, c.lat), 4326)::geography))::int as distance_m
from out.places a join out.places c
  on a.id < c.id and a.district_code = c.district_code and b.norm(a.name_ar) = b.norm(c.name_ar)
order by distance_m;
do $$
declare
  v_missing text;
begin
  select string_agg(n, ', ') into v_missing
  from unnest(array['بقعاتا', 'السمقانية', 'جديدة الشوف', 'كفر حيم']) n
  where not exists (select 1 from out.places o where o.district_code = 'CHF' and b.norm(o.name_ar) = b.norm(n));
  if v_missing is not null then
    raise exception '§16 places missing: %', v_missing;
  end if;
  if not exists (select 1 from out.places where name_ar = 'عرمون' and district_code = 'ALY') then
    raise exception 'Aramoun was merged into Dawha Aramoun';
  end if;
  if exists (select 1 from out.places where b.is_litige(name_en)) then
    raise exception 'a disputed (Litige) zone became a place';
  end if;
  if exists (
    select 1 from out.places o join raw.alias_corrections x
      on x.district_code = o.district_code and b.norm(x.name_ar) = b.norm(o.name_ar)
    where b.norm(x.alias) = any (array(select b.norm(a) from unnest(string_to_array(o.aliases, ';')) a))
  ) then
    raise exception 'a corrected alias is still on its place';
  end if;
  if exists (select 1 from b.report_dups where distance_m <= 1500) then
    raise exception 'same place twice: %', (select string_agg(id || '=' || other_id, ', ') from b.report_dups where distance_m <= 1500);
  end if;
end;
$$;
