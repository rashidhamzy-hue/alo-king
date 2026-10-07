#!/usr/bin/env bash
# Loads the places seed (supabase/seed/places/*.csv, built by .github/workflows/places-build.yml) into
# the database at DB_URL: staging after each deploy, or the throwaway test database in CI.
# An unchanged seed (same SHA-256 as the last load) is skipped unless FORCE=1. Never deletes a place
# and never changes a place's service status (DECISIONS §16).
set -euo pipefail
: "${DB_URL:?set DB_URL}"
DIR="${SEED_DIR:-supabase/seed/places}"
run() { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

if [ ! -f "$DIR/places.csv" ]; then
  echo "places seed: no $DIR/places.csv yet; nothing to load"
  exit 0
fi
sha=$(cat "$DIR/districts.csv" "$DIR/zones.csv" "$DIR/places.csv" | sha256sum | cut -c1-64)
if [ "${FORCE:-}" != "1" ] && [ "$(run -tAc "select count(*) from app_private.seed_loads where name = 'places' and sha256 = '$sha'")" = "1" ]; then
  echo "places seed: unchanged (${sha:0:12}); skipped"
  exit 0
fi
run --single-transaction <<SQL
truncate app_private.seed_districts, app_private.seed_zones, app_private.seed_places;
\copy app_private.seed_districts from '$DIR/districts.csv' with (format csv, header true)
\copy app_private.seed_zones from '$DIR/zones.csv' with (format csv, header true)
\copy app_private.seed_places from '$DIR/places.csv' with (format csv, header true)
select 'places seed loaded: ' || app_private.places_load_seed('$sha')::text;
truncate app_private.seed_districts, app_private.seed_zones, app_private.seed_places;
SQL
