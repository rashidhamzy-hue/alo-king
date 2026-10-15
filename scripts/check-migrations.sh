#!/usr/bin/env bash
# Fails when a new or changed migration drops or deletes data without a rollback file (DECISIONS §10).
# Usage: scripts/check-migrations.sh <base-ref>
set -euo pipefail
base="${1:-origin/rebuild/lebanon}"
# Trigger events (`before truncate`, `or truncate`) are removed before matching, so every TRUNCATE
# statement counts wherever it appears (top level, DO blocks, EXECUTE strings) and trigger definitions do not.
pattern='\b(drop[[:space:]]+(table|column|schema|materialized[[:space:]]+view)|truncate|delete[[:space:]]+from)\b'
status=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  # strip SQL line comments before matching
  # grep -c reads all of its input: with `grep -q` and pipefail a large file made sed die of SIGPIPE and
  # the pipeline read as "no match".
  if [ "$(sed -E 's/--.*$//; s/(before|after|or)[[:space:]]+truncate//Ig' "$f" | grep -ciE "$pattern" || true)" != 0 ]; then
    rb="supabase/rollbacks/$(basename "$f")"
    if [ -f "$rb" ]; then
      echo "ok   $f drops or deletes data; rollback $rb present"
    else
      echo "FAIL $f drops or deletes data but $rb is missing"
      status=1
    fi
  fi
done < <(git diff --name-only --diff-filter=AM "$base"...HEAD -- 'supabase/migrations/*.sql')
[ "$status" = 0 ] && echo "migration guard: ok"
exit "$status"
