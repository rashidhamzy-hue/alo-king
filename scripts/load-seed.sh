#!/usr/bin/env bash
# Loads the seeds into the database at DB_URL: staging after each deploy, or the throwaway test database
# in CI. Each seed is skipped when unchanged (same SHA-256 as the last load) unless FORCE=1.
# 1. Places (supabase/seed/places/*.csv, built by .github/workflows/places-build.yml). Never deletes a
#    place and never changes a place's service status (DECISIONS §16).
# 2. Vendors (supabase/seed/vendors/source/*.csv, the vendor file, §15.2): normalised by
#    scripts/vendors/build-seed.ts (Node 22), then loaded unclaimed; merchant-confirmed fields are never
#    overwritten. Runs after the places so every vendor gets its town.
set -euo pipefail
: "${DB_URL:?set DB_URL}"
DIR="${SEED_DIR:-supabase/seed/places}"
VENDOR_FILE="${VENDOR_FILE:-$(ls supabase/seed/vendors/source/*.csv 2>/dev/null | head -1 || true)}"
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
\copy app_private.seed_vendors from '$out/vendors.csv' with (format csv, header true)
\copy app_private.seed_vendor_exclusions from '$out/exclusions.csv' with (format csv, header true)
select 'vendor seed loaded: ' || app_private.vendors_load_seed('$sha')::text;
truncate app_private.seed_vendors, app_private.seed_vendor_exclusions;
SQL
rm -rf "$out"
}

load_places
load_vendors
