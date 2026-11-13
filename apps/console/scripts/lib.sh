#!/usr/bin/env bash
# Shared helpers for the console workflow. Keys travel in header files (mode 600), never on a command line or in a log.
set -euo pipefail
: "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_KEY:?}"
umask 077
HDR="${RUNNER_TEMP:-/tmp}/supabase-headers"
printf 'apikey: %s\nAuthorization: Bearer %s\n' "$SUPABASE_SERVICE_KEY" "$SUPABASE_SERVICE_KEY" > "$HDR"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
# sb METHOD PATH [JSON]  -> body on stdout; fails on HTTP >= 400 with the body on stderr
sb() {
  local method=$1 path=$2 data=${3:-}
  local out; out=$(mktemp)
  local code
  if [ -n "$data" ]; then
    code=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" -H @"$HDR" -H 'Content-Type: application/json' -H 'Prefer: return=representation' --data-binary "$data" "$SUPABASE_URL$path")
  else
    code=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" -H @"$HDR" "$SUPABASE_URL$path")
  fi
  if [ "$code" -ge 400 ]; then echo "HTTP $code from $method ${path%%\?*}: $(head -c 400 "$out")" >&2; rm -f "$out"; return 1; fi
  cat "$out"; rm -f "$out"
}
# find_user EMAIL -> the Auth user as JSON, or nothing
find_user() {
  local email; email=$(tr '[:upper:]' '[:lower:]' <<<"$1")
  local page=1
  while :; do
    local body; body=$(sb GET "/auth/v1/admin/users?page=$page&per_page=200")
    local hit; hit=$(jq -c --arg e "$email" '.users[]? | select((.email // "" | ascii_downcase) == $e)' <<<"$body" | head -1)
    if [ -n "$hit" ]; then echo "$hit"; return 0; fi
    [ "$(jq '.users | length' <<<"$body")" -lt 200 ] && return 0
    page=$((page + 1))
  done
}
