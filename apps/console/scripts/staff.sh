#!/usr/bin/env bash
# Adds, changes or removes a console staff member on STAGING. Run by the console workflow (action add-staff / remove-staff).
#   add-staff:    a staff party (role admin | ops_lead | picker) and a Supabase Auth user whose app_metadata.party_id names it,
#                 then Supabase emails a link to choose a password (it lands on <console>/auth/callback).
#   remove-staff: blocks the party and bans the Auth user. The console reads both on every request, so access ends at once.
# This is provisioning, like scripts/staging/prepare-staging.sql: the console itself has no way to create staff.
set -euo pipefail
here=$(dirname "$0"); . "$here/lib.sh"
: "${ACTION:?}" "${STAFF_EMAIL:?}"
email=$(tr '[:upper:]' '[:lower:]' <<<"$STAFF_EMAIL" | xargs)
[[ "$email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || { echo "not an email address"; exit 1; }
user=$(find_user "$email")
party=""
[ -n "$user" ] && party=$(jq -r '.app_metadata.party_id // empty' <<<"$user")

if [ "$ACTION" = "remove-staff" ]; then
  [ -n "$user" ] || { echo "no such staff account"; exit 1; }
  [ -n "$party" ] && sb PATCH "/rest/v1/parties?id=eq.$party" '{"is_blocked": true}' >/dev/null
  sb PUT "/auth/v1/admin/users/$(jq -r .id <<<"$user")" '{"ban_duration": "876000h"}' >/dev/null
  echo "- staff account removed: party blocked, sign-in banned" | tee -a "$SUMMARY"
  exit 0
fi

: "${STAFF_ROLE:?}" "${STAFF_NAME:?}" "${CONSOLE_URL:?}"
case "$STAFF_ROLE" in admin|ops_lead|picker) ;; *) echo "role must be admin, ops_lead or picker"; exit 1 ;; esac
patch=$(jq -n --arg r "$STAFF_ROLE" --arg n "$STAFF_NAME" '{role: $r, display_name: $n, is_blocked: false}')
if [ -n "$party" ] && [ "$(sb GET "/rest/v1/parties?id=eq.$party&select=id" | jq length)" = "1" ]; then
  sb PATCH "/rest/v1/parties?id=eq.$party" "$patch" >/dev/null
  echo "- staff party updated ($STAFF_ROLE)" | tee -a "$SUMMARY"
else
  party=$(sb POST "/rest/v1/parties" "$patch" | jq -r '.[0].id')
  [ -n "$party" ] && [ "$party" != "null" ] || { echo "could not create the party"; exit 1; }
  echo "- staff party created ($STAFF_ROLE)" | tee -a "$SUMMARY"
fi
meta=$(jq -n --arg p "$party" '{party_id: $p}')
if [ -n "$user" ]; then
  sb PUT "/auth/v1/admin/users/$(jq -r .id <<<"$user")" "$(jq -n --argjson m "$meta" '{app_metadata: $m, ban_duration: "none"}')" >/dev/null
  echo "- sign-in account linked to the party" | tee -a "$SUMMARY"
else
  sb POST "/auth/v1/admin/users" "$(jq -n --arg e "$email" --argjson m "$meta" '{email: $e, email_confirm: true, app_metadata: $m}')" >/dev/null
  echo "- sign-in account created" | tee -a "$SUMMARY"
fi
# The password link. Supabase's built-in mail only reaches members of the Supabase organization and a few an hour;
# for anyone else, set up SMTP in Supabase (Authentication, Emails) or use "Send password recovery" in the dashboard.
if sb POST "/auth/v1/recover?redirect_to=$(jq -rn --arg u "$CONSOLE_URL/auth/callback" '$u|@uri')" "$(jq -n --arg e "$email" '{email: $e}')" >/dev/null; then
  echo "- email sent with a link to choose a password (valid one hour); it opens $CONSOLE_URL/auth/callback" | tee -a "$SUMMARY"
else
  echo "::warning::Supabase did not send the password email (see the error above). The account exists; send the link from the Supabase dashboard."
  echo "- **password email not sent**: Supabase dashboard, Authentication, Users, this user, Send password recovery" >> "$SUMMARY"
fi
