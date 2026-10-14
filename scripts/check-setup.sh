#!/usr/bin/env bash
# Proves each GitHub Actions secret and variable works, without printing any secret (DECISIONS §9).
# Every check is read-only and free: no message is sent, nothing is written, no paid API SKU is called.
# Output: one line per check on stdout, and a Markdown table in $GITHUB_STEP_SUMMARY when set.
# Exit code: 1 if any required check fails.
set -uo pipefail

ALLOWED_REF="tzugbbatfbvrfzxuacqx"
KABSI_REF="ynjdqjlmdwjgbfezevxy"
KABSI_US_NUMBER="12014835474"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILED=0

row() { # status name detail
  printf '%-4s %-28s %s\n' "$1" "$2" "$3"
  printf '| %s | `%s` | %s |\n' "$1" "$2" "$3" >>"$SUMMARY"
}
pass() { row "PASS" "$1" "$2"; }
fail() { row "FAIL" "$1" "$2"; FAILED=1; }
note() { row "INFO" "$1" "$2"; }
skip() { row "SKIP" "$1" "$2"; }

# curl wrapper: body goes to $TMP/body, prints only the HTTP status code.
http() { curl -sS -o "$TMP/body" -w '%{http_code}' --max-time 30 "$@" 2>/dev/null || echo "000"; }

{
  echo "## check-setup"
  echo
  echo "| Result | Item | Detail |"
  echo "|---|---|---|"
} >>"$SUMMARY"

# 1. Project ref variable
REF="${SUPABASE_PROJECT_REF:-}"
if [ -z "$REF" ]; then
  fail "SUPABASE_PROJECT_REF" "variable not set"
elif [ "$REF" = "$KABSI_REF" ]; then
  fail "SUPABASE_PROJECT_REF" "points at kabsi-prod; must be $ALLOWED_REF"
  REF=""
elif [ "$REF" != "$ALLOWED_REF" ]; then
  fail "SUPABASE_PROJECT_REF" "is '$REF'; expected $ALLOWED_REF"
  REF=""
else
  pass "SUPABASE_PROJECT_REF" "$REF (alo-king-staging)"
fi

# 2. Supabase management token
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  fail "SUPABASE_ACCESS_TOKEN" "secret not set"
elif [ -z "$REF" ]; then
  fail "SUPABASE_ACCESS_TOKEN" "not tested: project ref missing or wrong"
else
  code=$(http -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "https://api.supabase.com/v1/projects/$REF")
  if [ "$code" = "200" ]; then
    name=$(jq -r '.name // "?"' "$TMP/body")
    region=$(jq -r '.region // "?"' "$TMP/body")
    status=$(jq -r '.status // "?"' "$TMP/body")
    if [ "$region" = "eu-central-1" ] && [ "$status" = "ACTIVE_HEALTHY" ]; then
      pass "SUPABASE_ACCESS_TOKEN" "reads project '$name', region $region, status $status"
    else
      fail "SUPABASE_ACCESS_TOKEN" "token works but project '$name' is region $region, status $status"
    fi
    code=$(http -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "https://api.supabase.com/v1/projects/$REF/functions")
    [ "$code" = "200" ] && note "staging edge functions" "$(jq 'length' "$TMP/body") deployed"
  else
    fail "SUPABASE_ACCESS_TOKEN" "management API returned HTTP $code for $REF"
  fi
fi

# 3. Database password (through the session pooler: GitHub runners have no IPv6 for the direct host)
if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  fail "SUPABASE_DB_PASSWORD" "secret not set"
elif [ -z "$REF" ] || [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  fail "SUPABASE_DB_PASSWORD" "not tested: needs the project ref and access token to find the pooler"
else
  code=$(http -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "https://api.supabase.com/v1/projects/$REF/config/database/pooler")
  host=""; user=""
  if [ "$code" = "200" ]; then
    host=$(jq -r '[.[] | select(.database_type == "PRIMARY")][0].db_host // .[0].db_host // empty' "$TMP/body")
    user=$(jq -r '[.[] | select(.database_type == "PRIMARY")][0].db_user // .[0].db_user // empty' "$TMP/body")
  fi
  if [ -z "$host" ]; then
    host="aws-0-eu-central-1.pooler.supabase.com"; user="postgres.$REF"
  fi
  if out=$(PGPASSWORD="$SUPABASE_DB_PASSWORD" PGCONNECT_TIMEOUT=15 psql "host=$host port=5432 dbname=postgres user=$user sslmode=require" \
      -XAtq -c "select count(*) from information_schema.tables where table_schema = 'public'" 2>"$TMP/pgerr"); then
    pass "SUPABASE_DB_PASSWORD" "connected through the pooler; public tables: $out"
    mig=$(PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "host=$host port=5432 dbname=postgres user=$user sslmode=require" \
      -XAtq -c "select count(*) from supabase_migrations.schema_migrations" 2>/dev/null || echo 0)
    note "staging migrations" "$mig applied"
  else
    reason=$(grep -oE 'password authentication failed|timeout|could not translate host name|Tenant or user not found' "$TMP/pgerr" | head -1)
    fail "SUPABASE_DB_PASSWORD" "connection failed: ${reason:-see psql error class}"
  fi
fi

# 4. Anthropic
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  fail "ANTHROPIC_API_KEY" "secret not set"
else
  code=$(http -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" "https://api.anthropic.com/v1/models?limit=100")
  if [ "$code" = "200" ]; then
    want="claude-sonnet-5-5 claude-haiku-4-5-20251001"
    missing=""
    for m in $want; do jq -e --arg m "$m" '.data | any(.id == $m)' "$TMP/body" >/dev/null || missing="$missing $m"; done
    if [ -z "$missing" ]; then
      pass "ANTHROPIC_API_KEY" "valid; models available: $want"
    else
      fail "ANTHROPIC_API_KEY" "valid, but models not listed:$missing"
    fi
  else
    fail "ANTHROPIC_API_KEY" "models API returned HTTP $code"
  fi
fi

# 5. Sentry
if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then
  fail "SENTRY_AUTH_TOKEN" "secret not set"
else
  base="https://sentry.io"; org=""
  case "$SENTRY_AUTH_TOKEN" in
    sntrys_*) # org auth token: the middle part is a public base64 JSON payload (org slug and region URL)
      payload="${SENTRY_AUTH_TOKEN#sntrys_}"; payload="${payload%_*}"
      json=$(printf '%s' "$payload" | base64 -d 2>/dev/null || printf '%s==' "$payload" | base64 -d 2>/dev/null || true)
      org=$(printf '%s' "$json" | jq -r '.org // empty' 2>/dev/null)
      region=$(printf '%s' "$json" | jq -r '.region_url // empty' 2>/dev/null)
      [ -n "$region" ] && base="$region" ;;
  esac
  case "$org" in kabsi*) fail "SENTRY_AUTH_TOKEN" "token belongs to org '$org' (Kabsi)";; esac
  code=$(http -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" "$base/api/0/projects/")
  if [ "$code" = "200" ]; then
    slugs=$(jq -r '[.[].slug] | join(" ")' "$TMP/body")
    missing=""
    for p in alo-king-functions javascript-tanstackstart-react; do
      echo " $slugs " | grep -q " $p " || missing="$missing $p"
    done
    if [ -z "$missing" ]; then
      pass "SENTRY_AUTH_TOKEN" "valid; sees alo-king-functions and javascript-tanstackstart-react"
    else
      fail "SENTRY_AUTH_TOKEN" "valid, but cannot see:$missing"
    fi
  elif [ -n "$org" ]; then
    code=$(http -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" "$base/api/0/organizations/$org/releases/?per_page=1")
    if [ "$code" = "200" ]; then
      pass "SENTRY_AUTH_TOKEN" "valid org token for '$org' (release and source-map scope; cannot list projects)"
    else
      fail "SENTRY_AUTH_TOKEN" "org token for '$org' rejected: HTTP $code"
    fi
  else
    fail "SENTRY_AUTH_TOKEN" "projects API returned HTTP $code"
  fi
fi

# 6. Kapso (fixed base URL; never taken from anywhere else)
if [ -z "${KAPSO_API_KEY:-}" ]; then
  fail "KAPSO_API_KEY" "secret not set"
else
  code=$(http -H "X-API-Key: $KAPSO_API_KEY" "https://api.kapso.ai/platform/v1/whatsapp/phone_numbers")
  if [ "$code" = "200" ]; then
    digits=$(jq -r '[(.data // .)[]? | (.display_phone_number // .phone_number // "") | gsub("[^0-9]"; "")] | .[]' "$TMP/body" 2>/dev/null)
    count=$(printf '%s\n' "$digits" | grep -c . || true)
    masked=$(printf '%s\n' "$digits" | grep . | sed -E 's/.*(....)$/…\1/' | paste -sd ' ' -)
    if printf '%s\n' "$digits" | grep -qx "$KABSI_US_NUMBER"; then
      fail "KAPSO_API_KEY" "key sees Kabsi's US number: it belongs to the Kabsi.co project, not Alo King"
    else
      pass "KAPSO_API_KEY" "valid; $count WhatsApp number(s) connected ${masked:+($masked)}"
    fi
  else
    fail "KAPSO_API_KEY" "platform API returned HTTP $code"
  fi
fi

# 7. Google Places (Place Details with field mask "id" is the free IDs-only SKU). Live Google lookups are off
# unless the database config google_places_enabled is exactly true: while it is off (the default) or cannot be read,
# the key is never sent to Google and the check reports "skipped".
google_on="false"
if [ -n "$REF" ] && [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  code=$(http -X POST -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d '{"query": "select public.config_value('"'"'google_places_enabled'"'"') #>> '"'"'{}'"'"' as v"}' \
    "https://api.supabase.com/v1/projects/$REF/database/query")
  if [ "$code" = "200" ] || [ "$code" = "201" ]; then
    [ "$(jq -r '.[0].v // "false"' "$TMP/body" 2>/dev/null)" = "true" ] && google_on="true"
  fi
fi
if [ "$google_on" != "true" ]; then
  skip "GOOGLE_PLACES_SERVER_KEY" "skipped: google_places_enabled is off, so Google is not called"
elif [ -z "${GOOGLE_PLACES_SERVER_KEY:-}" ]; then
  fail "GOOGLE_PLACES_SERVER_KEY" "secret not set"
else
  code=$(http -H "X-Goog-Api-Key: $GOOGLE_PLACES_SERVER_KEY" -H "X-Goog-FieldMask: id" \
    "https://places.googleapis.com/v1/places/ChIJN1t_tDeuEmsRUsoyG83frY4")
  if [ "$code" = "200" ]; then
    pass "GOOGLE_PLACES_SERVER_KEY" "valid for Places API (New) (free IDs-only call)"
  else
    msg=$(jq -r '.error.status // empty' "$TMP/body" 2>/dev/null)
    fail "GOOGLE_PLACES_SERVER_KEY" "Places API (New) returned HTTP $code ${msg}"
  fi
fi

# 8. Deepgram (DECISIONS §38.4, §38.6): a transcription candidate for the voice-note eval. Listing the key's
# projects is read-only and free. Not required until the eval runs, so a missing key is only noted.
if [ -z "${DEEPGRAM_API_KEY:-}" ]; then
  note "DEEPGRAM_API_KEY" "not set yet (owner issue: add the key created on 14 October; the transcription eval reads it)"
else
  code=$(http -H "Authorization: Token $DEEPGRAM_API_KEY" "https://api.deepgram.com/v1/projects")
  if [ "$code" = "200" ]; then
    n=$(jq -r '(.projects // []) | length' "$TMP/body" 2>/dev/null)
    pass "DEEPGRAM_API_KEY" "valid; sees ${n:-0} Deepgram project(s)"
  else
    fail "DEEPGRAM_API_KEY" "Deepgram API returned HTTP $code"
  fi
fi

# 9. Secrets for later phases: presence only
for s in OPENAI_API_KEY:3 ORS_API_KEY:1 VERCEL_TOKEN:none; do
  name="${s%%:*}"; phase="${s##*:}"
  if [ -n "${!name:-}" ]; then
    note "$name" "set"
  elif [ "$phase" = "none" ]; then
    note "$name" "not set (not needed: Vercel deploys through its Git integration)"
  else
    note "$name" "not set yet (needed in Phase $phase)"
  fi
done

echo
if [ "$FAILED" = "1" ]; then
  echo "check-setup: at least one required check failed"
  exit 1
fi
echo "check-setup: all required checks passed"
