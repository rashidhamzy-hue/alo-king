#!/usr/bin/env bash
# Loads the approved seeds. Needs DATABASE_URL (and PGPASSWORD). Safe to run on every deploy.
#
# 1. The catalog, aliases, villages and estimated travel times: once, into an empty catalog. (load_catalog.sql inserts aliases
#    without a conflict clause, so it must not run twice.)
# 2. supabase/seed/proposed_pilot_settings.sql, which the founder approved on 14 Nov 2026 (docs/DECISIONS.md "Proposed, not yet
#    confirmed" -> confirmed): the 25 served villages and the small-order fee. It runs ONCE per database, in one transaction with a
#    marker row (settings key `seed_applied:proposed_pilot_settings`). Not on every deploy: both values are data the console can
#    change (zones page, fee setting), and a deploy must never put an approved default back over a later decision.
#    To load it again on purpose, delete the marker row. The step then prints what is in the database now.
# 3. supabase/seed/delivery_windows.sql: the founder's delivery windows and calendar, once, with its own marker (see below).
set -euo pipefail
: "${DATABASE_URL:?}"
PSQL="psql $DATABASE_URL -v ON_ERROR_STOP=1 -q -At"

have=$($PSQL -c "select count(*) from products")
if [ "$have" != "0" ]; then
  echo "catalog seeds skipped: $have products already loaded"
else
  for f in load_catalog load_aliases villages travel_times_estimate; do
    echo "seed $f"
    $PSQL -f "supabase/seed/$f.sql" >/dev/null
  done
fi

marker="seed_applied:proposed_pilot_settings"
done_already=$($PSQL -c "select count(*) from settings where key = '$marker'")
if [ "$done_already" = "0" ]; then
  echo "seed proposed_pilot_settings (approved by the founder, 14 Nov 2026)"
  { cat supabase/seed/proposed_pilot_settings.sql
    echo "insert into settings(key, value) values ('$marker', jsonb_build_object('applied_at', now())) on conflict (key) do nothing;"
  } | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -1 -f - >/dev/null
else
  echo "seed proposed_pilot_settings skipped: already applied once (the console owns these values now)"
fi

# 3. supabase/seed/delivery_windows.sql (founder's windows and the 2026-2027 calendar, 14 Nov 2026, session A6): ONCE, the same way,
#    marker `seed_applied:delivery_windows`. Later edits on /windows are never overwritten. The file adds a row only when no plan (or
#    no calendar entry of that kind, name and first day) exists, so a database where a person already entered windows is not doubled.
marker="seed_applied:delivery_windows"
done_already=$($PSQL -c "select count(*) from settings where key = '$marker'")
if [ "$done_already" = "0" ]; then
  echo "seed delivery_windows (founder's decision, 14 Nov 2026)"
  { cat supabase/seed/delivery_windows.sql
    echo "insert into settings(key, value) values ('$marker', jsonb_build_object('applied_at', now())) on conflict (key) do nothing;"
  } | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -1 -f - >/dev/null
else
  echo "seed delivery_windows skipped: already applied once (/windows owns these rows now)"
fi

$PSQL -c "select 'products: ' || count(*) from products"
$PSQL -c "select 'villages: ' || count(*) || ', served: ' || count(*) filter (where is_served) from villages"
$PSQL -c "select 'small_order_fee: ' || value::text from settings where key = 'small_order_fee'"
$PSQL -c "select 'stock rows: ' || count(*) from stock_levels"
$PSQL -c "select 'window plans: ' || count(*) filter (where active) || ', calendar entries: ' || (select count(*) from delivery_calendar) || ' (closed: ' || (select count(*) from delivery_calendar where closed) || ')' from delivery_window_plans"
