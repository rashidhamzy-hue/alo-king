#!/usr/bin/env bash
# Builds supabase/seed/places/*.csv from the sources fetch.sh downloaded (DECISIONS §16).
# Usage: DB_URL=postgresql://... scripts/places/build.sh <work dir> [out dir]
# DB_URL is a throwaway PostGIS database (the workflow's service container), never staging.
set -euo pipefail
WORK="${1:?usage: build.sh <work dir> [out dir]}"
OUT="${2:-supabase/seed/places}"
: "${DB_URL:?set DB_URL to a throwaway PostGIS database}"
case "$DB_URL" in *supabase.co* | *supabase.com* | *pooler*) echo "build refuses hosted databases"; exit 1 ;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
psqlq() { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
PG="PG:$(python3 -c 'import sys,urllib.parse as u; p=u.urlparse(sys.argv[1]); print(f"host={p.hostname} port={p.port or 5432} dbname={p.path[1:]} user={p.username} password={p.password}")' "$DB_URL")"

psqlq -c "drop schema if exists raw cascade; create schema raw; create extension if not exists postgis; create extension if not exists postgis_raster;"

# COD-AB layers: the files or layers whose name says adm2 / adm3.
load_level() { # $1 = level
  local lvl="$1" src layer
  # lbn_admbnda_adm3_cdr.shp, lbn_admin3.shp, ...; not the *_em, line or point variants.
  src=$(find "$WORK/codab" -regextype posix-extended -iregex ".*adm(in|bnda_adm)?_?${lvl}(_[a-z]+_[0-9]+)?\.(shp|geojson|json)" \
    ! -iname '*_em.*' ! -iname '*line*' ! -iname '*point*' | sort | head -1)
  if [ -n "$src" ]; then
    ogr2ogr -f PostgreSQL "$PG" "$src" -nln "raw.adm${lvl}" -nlt PROMOTE_TO_MULTI -t_srs EPSG:4326 -lco GEOMETRY_NAME=geom -overwrite
    return
  fi
  for ds in $(find "$WORK/codab" \( -iname '*.gdb' -o -iname '*.gpkg' -o -iname '*.geojson' -o -iname '*.json' \) | sort); do
    layer=$(ogrinfo -ro -q "$ds" 2>/dev/null | sed -nE 's/^[0-9]+: ([^ ]+).*/\1/p' | grep -iE "adm(in)?_?${lvl}" | grep -viE 'line|point|_em$' | head -1 || true)
    if [ -n "$layer" ]; then
      ogr2ogr -f PostgreSQL "$PG" "$ds" "$layer" -nln "raw.adm${lvl}" -nlt PROMOTE_TO_MULTI -t_srs EPSG:4326 -lco GEOMETRY_NAME=geom -overwrite
      return
    fi
  done
  echo "no adm${lvl} layer found under $WORK/codab:"; find "$WORK/codab" | head -50; exit 1
}
load_level 2
load_level 3

cas=$(ls "$WORK"/cas.* 2>/dev/null | head -1 || true)
if [ -n "$cas" ]; then ogr2ogr -f PostgreSQL "$PG" "$cas" -nln raw.cas -overwrite || echo "CAS file not readable; skipped"; fi

psqlq <<SQL
create table raw.osm (osm_id bigint, lat double precision, lon double precision, place text, name text, name_ar text,
  name_en text, name_fr text, int_name text, alt_name text, old_name text, loc_name text, official_name text, population text);
\copy raw.osm from '$WORK/osm.csv' with (format csv, header true)
create table raw.curated (name_en text, name_ar text, name_fr text, aliases text, kind text, parent_name_en text,
  lat double precision, lon double precision, note text);
\copy raw.curated from '$HERE/curated.csv' with (format csv, header true)
create table raw.review (ref text, name_ar text, name_en text, type text, district text, sub_region text, municipality text,
  lat double precision, lon double precision, elevation_m text, confidence text);
\copy raw.review from '$HERE/review-set.csv' with (format csv, header true)
SQL

if ls "$WORK"/dem/*.tif >/dev/null 2>&1; then
  raster2pgsql -s 4326 -t 200x200 -I "$WORK"/dem/*.tif raw.dem | psqlq >/dev/null
else
  psqlq -c "create table raw.dem (rid serial, rast raster);"
fi

psqlq -f "$HERE/build.sql"

mkdir -p "$OUT"
psqlq -c "\copy (select * from out.districts order by code) to '$OUT/districts.csv' with (format csv, header true)"
psqlq -c "\copy (select * from out.zones order by pcode) to '$OUT/zones.csv' with (format csv, header true)"
psqlq -c "\copy (select * from out.places order by id) to '$OUT/places.csv' with (format csv, header true)"

# Report for the PR and for Claude's review of missing places and duplicates (§16).
{
  echo "# Places build report"
  echo
  echo "Built $(date -u +%F) by \`.github/workflows/places-build.yml\`."
  echo
  sed 's/^/- /' "$WORK/sources.txt" 2>/dev/null || true
  echo
  echo "## Totals"
  psqlq -A -F ' | ' -c "select 'places' as what, count(*)::text as n from out.places union all select 'zones', count(*)::text from out.zones
    union all select 'zones without a place (snapping only)', count(*)::text from out.zones where not inhabited
    union all select 'places without an Arabic name', count(*)::text from out.places where name_ar is null
    union all select 'places without an English name', count(*)::text from out.places where name_en is null
    union all select 'places with a parent', count(*)::text from out.places where parent_id is not null
    union all select 'winter-risk places', count(*)::text from out.places where winter_risk" | sed '$d'
  echo
  echo "## Places by kind"
  psqlq -A -F ' | ' -c "select kind, count(*) from out.places group by 1 order by 2 desc" | sed '$d'
  echo
  echo "## Places by district"
  psqlq -A -F ' | ' -c "select district_code, count(*) from out.places group by 1 order by 1" | sed '$d'
  echo
  echo "## Review set (Gazetteer report): matches"
  psqlq -A -F ' | ' -c "select count(*) filter (where id is not null) || ' of ' || count(*) || ' matched' from b.report_review" | sed '$d'
  echo
  echo "### Not matched"
  psqlq -A -F ' | ' -c "select ref, review_name from b.report_review where id is null order by ref" | sed '$d'
  echo
  echo "### Matched more than 1 km away, or elevation off by more than 150 m"
  psqlq -A -F ' | ' -c "select ref, review_name, id, distance_m, elevation_m, review_elevation from b.report_review
    where id is not null and (distance_m > 1000 or abs(elevation_m - nullif(review_elevation, '')::int) > 150) order by ref" | sed '$d'
  echo
  echo "## Same name in the same district"
  psqlq -A -F ' | ' -c "select district_code, coalesce(name_en, name_ar), count(*) from out.places group by 1, 2 having count(*) > 1 order by 3 desc, 1, 2 limit 100" | sed '$d'
  echo
  echo "## Same Arabic name in one district (separate villages more than 1.5 km apart)"
  psqlq -A -F ' | ' -c "select id, other_id, name_ar, distance_m from b.report_dups" | sed '$d'
  echo
  echo "## Places made from a zone with no OSM place (review: real village or uninhabited land)"
  psqlq -A -F ' | ' -c "select id, district_code, name_en, name_ar, elevation_m from b.report_zone_places" | sed '$d'
  echo
  echo "## Zones without a place (first 400)"
  psqlq -A -F ' | ' -c "select pcode, district_code, name_en, name_ar, elevation_min_m, elevation_max_m from b.report_empty_zones limit 400" | sed '$d'
} > "$OUT/report.md"
echo "places: $(($(wc -l < "$OUT/places.csv") - 1)), zones: $(($(wc -l < "$OUT/zones.csv") - 1))"
