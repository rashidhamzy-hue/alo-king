#!/usr/bin/env bash
# Data freeze guard (DECISIONS §31). Until the data finalisation session (session D) the places list, the
# vendor import and their tables stay exactly as they are on staging. A pull request fails when it
#   1. touches a frozen path (the places and vendor seeds, their build scripts, the places-build workflow), or
#   2. adds or changes a migration that renames, drops or retypes a frozen table or one of its columns,
# unless its title starts with `Data:` (reserved for session D). Adding a column with a default is allowed
# (§31) and is not matched here.
# Usage: PR_TITLE=... scripts/data-freeze.sh <base-sha> [head-ref]
#        PR_TITLE=... scripts/data-freeze.sh -          (file list on stdin, migrations read from disk; tests)
set -euo pipefail

title="${PR_TITLE:-}"
if [[ "$title" == Data:* ]]; then
  echo "data freeze: title starts with 'Data:' (session D); guard skipped"
  exit 0
fi

if [ "${1:-}" = "-" ]; then
  files=$(cat)
else
  base="${1:?base sha required}"
  head="${2:-HEAD}"
  # --no-renames lists both sides of a move, so moving a frozen file out of its folder is still caught.
  files=$(git diff --name-only --no-renames "$base...$head")
fi

frozen_paths_re='^(supabase/seed/places/|supabase/seed/vendors/|scripts/places/|scripts/vendors/|\.github/workflows/places-build\.yml$)'
# Places, zones, districts, aliases, landmarks and the vendor tables, plus the seed staging tables behind them.
frozen_tables='(public\.)?(governorates|districts|cadastral_zones|places|place_aliases|landmarks|vendors|vendor_private|vendor_links|vendor_import_exclusions|vendor_removed_places|brands)|app_private\.seed_[a-z_]+'

status=0
hits=$(printf '%s\n' "$files" | grep -E "$frozen_paths_re" || true)
if [ -n "$hits" ]; then
  echo "FAIL frozen paths changed (DECISIONS §31):"
  printf '  %s\n' $hits
  status=1
fi

while IFS= read -r f; do
  [[ "$f" == supabase/migrations/*.sql ]] || continue
  [ -f "$f" ] || continue
  # One statement per line after stripping comments, so `alter table x ... rename column` spanning lines matches.
  body=$(sed -E 's/--.*$//' "$f" | tr '\n' ' ' | tr ';' '\n')
  bad=$(printf '%s\n' "$body" | grep -iE "\balter[[:space:]]+table[[:space:]]+(if[[:space:]]+exists[[:space:]]+)?(only[[:space:]]+)?($frozen_tables)\b.*\b(rename|drop[[:space:]]+column|drop[[:space:]]+constraint|alter[[:space:]]+column.*\btype\b|set[[:space:]]+data[[:space:]]+type)\b" || true)
  bad+=$(printf '%s\n' "$body" | grep -iE "\bdrop[[:space:]]+table[[:space:]]+(if[[:space:]]+exists[[:space:]]+)?($frozen_tables)\b" || true)
  if [ -n "$bad" ]; then
    echo "FAIL $f restructures a frozen table (DECISIONS §31):"
    printf '%s\n' "$bad" | sed -E 's/[[:space:]]+/ /g; s/^ //' | cut -c1-200 | sed 's/^/  /'
    status=1
  fi
done < <(printf '%s\n' "$files")

[ "$status" = 0 ] && echo "data freeze: ok"
exit "$status"
