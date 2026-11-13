#!/usr/bin/env bash
# Lets Supabase Auth send emailed links back to the console: adds <console>/auth/callback to the staging project's redirect
# allow list (Management API). Adds only; never removes another address. Idempotent.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?}" "${SUPABASE_PROJECT_REF:?}" "${CONSOLE_URL:?}"
api="https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth"
auth=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")
cfg=$(curl -sS --fail-with-body "${auth[@]}" "$api")
want="$CONSOLE_URL/auth/callback"
have=$(jq -r '.uri_allow_list // ""' <<<"$cfg")
if tr ',' '\n' <<<"$have" | grep -qxF "$want"; then
  echo "- Auth redirect already allowed: $want" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; echo "redirect already allowed"; exit 0
fi
new=$(jq -rn --arg h "$have" --arg w "$want" 'if $h == "" then $w else $h + "," + $w end')
curl -sS --fail-with-body -X PATCH "${auth[@]}" -H 'Content-Type: application/json' --data-binary "$(jq -n --arg l "$new" '{uri_allow_list: $l}')" "$api" >/dev/null
echo "- Auth redirect allowed: $want" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; echo "redirect added"
