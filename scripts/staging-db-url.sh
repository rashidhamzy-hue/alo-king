#!/usr/bin/env bash
# Prints the session-pooler connection URL for alo-king-staging (GitHub runners have no IPv6 for the
# direct host). Needs SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD and SUPABASE_PROJECT_REF.
# The output contains the password: callers must mask it and never echo it.
set -euo pipefail
[ "${SUPABASE_PROJECT_REF:-}" = "tzugbbatfbvrfzxuacqx" ] || {
  echo "refusing: project ref is not alo-king-staging" >&2
  exit 1
}
cfg=$(curl -fsS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/database/pooler")
host=$(jq -r '[.[] | select(.database_type == "PRIMARY")][0].db_host // .[0].db_host' <<<"$cfg")
user=$(jq -r '[.[] | select(.database_type == "PRIMARY")][0].db_user // .[0].db_user' <<<"$cfg")
pass=$(jq -rn --arg p "$SUPABASE_DB_PASSWORD" '$p | @uri')
printf 'postgresql://%s:%s@%s:5432/postgres?sslmode=require' "$user" "$pass" "$host"
