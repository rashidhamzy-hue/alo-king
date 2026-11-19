#!/usr/bin/env bash
# Works out the two values the website Worker needs to read the catalog as the role web_channel, and writes them to the JSON file given as
# $1 (mode 600): SUPABASE_ANON_KEY (the project's public API key, which the API gateway wants in the `apikey` header) and WEB_CHANNEL_JWT.
# Nothing is printed except which route was used. Sources, in order:
#   the anon key       the Management API (SUPABASE_ACCESS_TOKEN, which the deploy already holds)
#   the JWT secret     the repository secret SUPABASE_JWT_SECRET if the founder set it, else the Management API's PostgREST config
# If the secret cannot be had either way, this stops and writes the exact steps to the run's summary: it is the one value only the
# founder can read, in the Supabase dashboard.
set -euo pipefail
out="${1:?usage: token.sh <output.json>}"
: "${SUPABASE_ACCESS_TOKEN:?}" "${SUPABASE_PROJECT_REF:?}"
api="https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF"
auth=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")
summary="${GITHUB_STEP_SUMMARY:-/dev/stderr}"

anon=$(curl -fsS "${auth[@]}" "$api/api-keys" | jq -r '[.[] | select(.name == "anon") | .api_key][0] // ([.[] | select(.type == "publishable") | .api_key][0]) // empty' || true)
if [ -z "$anon" ]; then echo "could not read the project's anon (public) key through the Management API" >&2; exit 1; fi
echo "::add-mask::$anon"

secret="${SUPABASE_JWT_SECRET:-}"; route="repository secret SUPABASE_JWT_SECRET"
if [ -z "$secret" ]; then
  secret=$(curl -fsS "${auth[@]}" "$api/postgrest" | jq -r '.jwt_secret // empty' || true)
  route="Management API (PostgREST config)"
fi
if [ -z "$secret" ] || [ "$secret" = "null" ]; then
  cat >> "$summary" <<'MSG'
### The website needs one value only the founder can read: the project's JWT secret

The Worker reads the catalog as the database role `web_channel`, through a token signed with the project's JWT secret. The Management API did not return
the secret, so it has to be copied by hand once:

1. Supabase dashboard, project **lhgkvvdckwbfpdsftzqp** (staging), **Project Settings**, then **JWT Keys** (older dashboards: **API**, then **JWT Settings**).
2. Open the **Legacy JWT Secret** tab and press **Reveal**, then copy the secret. (Do not rotate it: rotating signs everything out.)
3. GitHub, this repository, **Settings**, **Secrets and variables**, **Actions**, **New repository secret**. Name: `SUPABASE_JWT_SECRET`. Value: the secret. **Add secret**.
4. GitHub, **Actions**, workflow **web**, **Run workflow** on `main`.

Nothing else is needed: the workflow makes the token from it and keeps it as a Worker secret. The secret never appears in a log.
MSG
  echo "the JWT secret is not available: see the run summary for the steps" >&2
  exit 3
fi
echo "::add-mask::$secret"
jwt=$(SUPABASE_JWT_SECRET="$secret" node "$(dirname "$0")/mint-token.mjs")
echo "::add-mask::$jwt"
umask 077
jq -n --arg a "$anon" --arg j "$jwt" '{SUPABASE_ANON_KEY: $a, WEB_CHANNEL_JWT: $j}' > "$out"
echo "token made for role web_channel (JWT secret from the $route)"
