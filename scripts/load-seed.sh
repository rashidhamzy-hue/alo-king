#!/usr/bin/env bash
# Loads the seeds into the database at DB_URL: staging after each deploy, or the throwaway test database
# in CI. Each seed is skipped when unchanged (same SHA-256 as the last load) unless FORCE=1.
# 1. Places (supabase/seed/places/*.csv, built by .github/workflows/places-build.yml). Never deletes a
#    place and never changes a place's service status (DECISIONS §16).
# 2. Vendors: the Shouf pilot file (supabase/seed/shouf/source/, DECISIONS §38) normalised by
#    scripts/vendors/build-shouf.ts (Node 22) with its draft menus, then loaded unclaimed; merchant-confirmed
#    fields are never overwritten. Runs after the places so every vendor gets its village; switches the pilot
#    villages on. The nationwide file (supabase/seed/vendors/source/, §15.2) is loaded only when present
#    (it was removed by session D; Rasheed's national dataset replaces it later).
# 3. OpenStreetMap landmarks and place aliases for the pilot area (supabase/seed/shouf/osm/, fetched by
#    scripts/shouf/osm-fetch.mjs), when present.
set -euo pipefail
: "${DB_URL:?set DB_URL}"
DIR="${SEED_DIR:-supabase/seed/places}"
VENDOR_FILE="${VENDOR_FILE:-$(ls supabase/seed/vendors/source/*.csv 2>/dev/null | head -1 || true)}"
SHOUF_DIR="${SHOUF_DIR:-supabase/seed/shouf}"
run() { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
loaded() { [ "${FORCE:-}" != "1" ] && [ "$(run -tAc "select count(*) from app_private.seed_loads where name = '$1' and sha256 = '$2'")" = "1" ]; }

load_places() {
if [ ! -f "$DIR/places.csv" ]; then
  echo "places seed: no $DIR/places.csv yet; nothing to load"
  return 0
fi
sha=$(cat "$DIR/districts.csv" "$DIR/zones.csv" "$DIR/places.csv" | sha256sum | cut -c1-64)
if loaded places "$sha"; then
  echo "places seed: unchanged (${sha:0:12}); skipped"
  return 0
fi
run --single-transaction <<SQL
truncate app_private.seed_districts, app_private.seed_zones, app_private.seed_places;
\copy app_private.seed_districts from '$DIR/districts.csv' with (format csv, header true)
\copy app_private.seed_zones from '$DIR/zones.csv' with (format csv, header true)
\copy app_private.seed_places from '$DIR/places.csv' with (format csv, header true)
select 'places seed loaded: ' || app_private.places_load_seed('$sha')::text;
truncate app_private.seed_districts, app_private.seed_zones, app_private.seed_places;
SQL
}

load_vendors() {
if [ -z "$VENDOR_FILE" ] || [ ! -f "$VENDOR_FILE" ]; then
  echo "vendor seed: no file in supabase/seed/vendors/source/ yet; nothing to load"
  return 0
fi
local sha out
sha=$(cat "$VENDOR_FILE" scripts/vendors/normalize.ts scripts/vendors/build-seed.ts | sha256sum | cut -c1-64)
if loaded vendors "$sha"; then
  echo "vendor seed: unchanged (${sha:0:12}); skipped"
  return 0
fi
out=$(mktemp -d)
node --experimental-strip-types --no-warnings scripts/vendors/build-seed.ts "$VENDOR_FILE" "$out"
run --single-transaction <<SQL
truncate app_private.seed_vendors, app_private.seed_vendor_exclusions;
\copy app_private.seed_vendors (place_id, slug, name_ar, name_en, branch_label, business_type, cuisine_tags, lat, lon, phone_seed, phone_seed_mobile, address_seed, brand_slug, brand_name_en, brand_name_ar, links, import_labels) from '$out/vendors.csv' with (format csv, header true)
\copy app_private.seed_vendor_exclusions from '$out/exclusions.csv' with (format csv, header true)
select 'vendor seed loaded: ' || app_private.vendors_load_seed('$sha')::text;
truncate app_private.seed_vendors, app_private.seed_vendor_exclusions;
SQL
rm -rf "$out"
}

load_shouf() {
if [ ! -f "$SHOUF_DIR/source/01_shouf_merchants_315.csv" ]; then
  echo "shouf seed: no $SHOUF_DIR/source/01_shouf_merchants_315.csv; nothing to load"
  return 0
fi
local sha out
sha=$(cat "$SHOUF_DIR"/source/01_shouf_merchants_315.csv "$SHOUF_DIR"/source/03_shouf_digital_menus.json \
  $(ls "$SHOUF_DIR"/source/04_owner_menu_photos_*.json 2>/dev/null) \
  scripts/vendors/normalize.ts scripts/vendors/shouf.ts scripts/vendors/shouf-menus.ts scripts/vendors/build-shouf.ts | sha256sum | cut -c1-64)
if loaded vendors_shouf "$sha"; then
  echo "shouf seed: unchanged (${sha:0:12}); skipped"
  return 0
fi
out=$(mktemp -d)
node --experimental-strip-types --no-warnings scripts/vendors/build-shouf.ts "$SHOUF_DIR/source" "$out"
run --single-transaction <<SQL
truncate app_private.seed_vendors, app_private.seed_vendor_exclusions, app_private.seed_menu_drafts;
\copy app_private.seed_vendors (place_id, slug, name_ar, name_en, branch_label, business_type, cuisine_tags, lat, lon, phone_seed, phone_seed_mobile, address_seed, brand_slug, brand_name_en, brand_name_ar, links, import_labels, town_id) from '$out/vendors.csv' with (format csv, header true)
\copy app_private.seed_vendor_exclusions from '$out/exclusions.csv' with (format csv, header true)
\copy app_private.seed_menu_drafts (place_id, kind, sections, source_url, captured_at) from '$out/menus.csv' with (format csv, header true)
select 'shouf seed loaded: ' || app_private.shouf_load_seed('$sha')::text;
truncate app_private.seed_vendors, app_private.seed_vendor_exclusions, app_private.seed_menu_drafts;
SQL
rm -rf "$out"
}

load_osm() {
local dir="$SHOUF_DIR/osm"
if [ ! -f "$dir/landmarks.csv" ] || [ ! -f "$dir/place_aliases.csv" ]; then
  echo "osm seed: no $dir/landmarks.csv yet; nothing to load"
  return 0
fi
local sha
sha=$(cat "$dir/landmarks.csv" "$dir/place_aliases.csv" | sha256sum | cut -c1-64)
if loaded osm_pilot "$sha"; then
  echo "osm seed: unchanged (${sha:0:12}); skipped"
  return 0
fi
run --single-transaction <<SQL
truncate app_private.seed_osm_landmarks, app_private.seed_osm_aliases;
\copy app_private.seed_osm_landmarks from '$dir/landmarks.csv' with (format csv, header true)
\copy app_private.seed_osm_aliases from '$dir/place_aliases.csv' with (format csv, header true)
select 'osm seed loaded: ' || app_private.osm_load_seed('$sha')::text;
truncate app_private.seed_osm_landmarks, app_private.seed_osm_aliases;
SQL
}

load_places
load_vendors
load_shouf
load_osm
