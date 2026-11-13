#!/usr/bin/env bash
# Loads the approved seeds, once, into an empty catalog. (load_catalog.sql inserts aliases without a conflict clause, so it must not run twice.)
# Approved = the catalog and aliases (founder-confirmed, 291 items), and the draft villages, zones and estimated travel times
# that README.md lists. NOT loaded, on purpose: supabase/seed/proposed_pilot_settings.sql waits for the founder's written yes
# (docs/DECISIONS.md "Proposed, not yet confirmed").
# Needs DATABASE_URL (and PGPASSWORD).
set -euo pipefail
: "${DATABASE_URL:?}"
PSQL="psql $DATABASE_URL -v ON_ERROR_STOP=1 -q -At"
have=$($PSQL -c "select count(*) from products")
if [ "$have" != "0" ]; then
  echo "seeds skipped: $have products already loaded"
  exit 0
fi
for f in load_catalog load_aliases villages travel_times_estimate; do
  echo "seed $f"
  $PSQL -f "supabase/seed/$f.sql" >/dev/null
done
$PSQL -c "select 'products: ' || count(*) from products"
$PSQL -c "select 'villages: ' || count(*) || ', served: ' || count(*) filter (where is_served) from villages"
$PSQL -c "select 'stock rows: ' || count(*) from stock_levels"
