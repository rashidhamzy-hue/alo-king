#!/usr/bin/env bash
# Applies every migration to a throwaway Supabase Postgres, then runs supabase/tests/*.sql.
# Never point this at staging: it inserts test users and helper functions.
# Usage: DB_URL=postgresql://postgres:postgres@localhost:54322/postgres scripts/db-test.sh
set -euo pipefail
: "${DB_URL:?set DB_URL to a throwaway database}"
case "$DB_URL" in
  *supabase.co* | *supabase.com* | *pooler*) echo "db-test refuses hosted databases"; exit 1 ;;
esac

run() { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

for f in supabase/migrations/*.sql; do
  echo "migrate $(basename "$f")"
  run --single-transaction -f "$f" >/dev/null
done

fail=0
for f in supabase/tests/*.sql; do
  out=$(run -f "$f" 2>&1 >/dev/null) || { echo "$out" | grep -vE '^NOTICE:  ok - ' ; echo "FAIL $(basename "$f")"; fail=1; continue; }
  n=$(echo "$out" | grep -c 'NOTICE:  ok - ' || true)
  echo "pass $(basename "$f") ($n checks)"
done
exit "$fail"
