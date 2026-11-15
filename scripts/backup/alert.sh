#!/usr/bin/env bash
# BK0: tell a person that a backup is stale or a restore check failed, in the two places that already reach people:
#   raise KIND REF MESSAGE   one open ops exception per kind and environment (raise_ops_exception: asking again changes nothing),
#                            which the Worker's alert cron sends to the ops line and the console lists; and one Sentry error event.
#   clear KIND REF           resolves that exception once the check is green again (the Sentry issue closes itself or is closed by a person).
# KIND is backup_stale or restore_check_failed. REF is the environment (staging|production).
# Environment: DATABASE_URL (+ PGPASSWORD) for the exception; SENTRY_DSN (a public client key; default: the staging DSN in wrangler.jsonc)
# for the event; SENTRY_ALERT_DRY_RUN=1 prints the Sentry envelope instead of posting it (the tests).
# Either half may fail on its own (a Sentry outage, a database that is down); the script fails only when neither got through.
# The message carries ages, counts and names only: never a passphrase, a key, a row or a connection string.
set -uo pipefail
cmd=${1:-}; kind=${2:-}; ref=${3:-}
case "$kind" in backup_stale|restore_check_failed) ;; *) echo "alert.sh: KIND must be backup_stale or restore_check_failed" >&2; exit 2 ;; esac
[ -n "$ref" ] || { echo "alert.sh: REF is missing" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)

if [ "$cmd" = clear ]; then
  [ -n "${DATABASE_URL:-}" ] || { echo "alert.sh clear: no DATABASE_URL, nothing to resolve" >&2; exit 0; }
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -At -v kind="$kind" -v ref="$ref" <<'SQL' >/dev/null || { echo "could not resolve the exception (left open)" >&2; exit 0; }
update ops_exceptions set status = 'resolved', resolved_at = now() where kind = :'kind' and ref = :'ref' and status <> 'resolved';
SQL
  echo "exception $kind/$ref resolved if it was open"
  exit 0
fi
[ "$cmd" = raise ] || { echo "usage: alert.sh raise|clear KIND REF [MESSAGE]" >&2; exit 2; }
message=${4:-"$kind"}
got=0

# 1. the ops exception
if [ -n "${DATABASE_URL:-}" ]; then
  detail=$(jq -nc --arg m "$message" --arg run "${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}" '{message: $m, run: $run}')
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -At -v kind="$kind" -v ref="$ref" -v detail="$detail" <<'SQL' >/dev/null; then got=1; echo "ops exception $kind/$ref is open"; else echo "::warning::could not raise the ops exception (database unreachable?)" >&2; fi
select raise_ops_exception(:'kind', :'ref', :'detail'::jsonb);
SQL
else echo "::warning::no DATABASE_URL: no ops exception raised" >&2; fi

# 2. the Sentry event
dsn=${SENTRY_DSN:-}
# Staging's DSN is the one in wrangler.jsonc. Production has its own project (build plan 4.2) and its own SENTRY_DSN_PRODUCTION variable:
# a production alert is never sent to the staging project by default.
if [ -z "$dsn" ] && [ "$ref" = staging ]; then dsn=$(node "$here/../ci/wrangler-var.mjs" SENTRY_DSN 2>/dev/null || true); fi
if [ -n "$dsn" ]; then
  key=$(sed -E 's#^https://([^@]+)@.*#\1#' <<<"$dsn"); host=$(sed -E 's#^https://[^@]+@([^/]+)/.*#\1#' <<<"$dsn"); project=$(sed -E 's#.*/([0-9]+)$#\1#' <<<"$dsn")
  id=$(openssl rand -hex 16); now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  event=$(jq -nc --arg id "$id" --arg ts "$now" --arg m "$message" --arg k "$kind" --arg r "$ref" \
    '{event_id: $id, timestamp: $ts, platform: "other", level: "error", logger: "backup", message: ($k + " (" + $r + "): " + $m), environment: $r, tags: {kind: $k, backup_environment: $r}, fingerprint: ["backup", $k, $r]}')
  body=$(printf '{"event_id":"%s","sent_at":"%s"}\n{"type":"event"}\n%s\n' "$id" "$now" "$event")
  if [ "${SENTRY_ALERT_DRY_RUN:-}" = "1" ]; then printf '%s\n' "$body"; got=1
  else
    code=$(printf '%s' "$body" | curl -sS -o /dev/null -w '%{http_code}' -X POST "https://$host/api/$project/envelope/" \
      -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_key=$key, sentry_client=alo-king-backup/1" -H 'Content-Type: application/x-sentry-envelope' --data-binary @- || true)
    if [ "$code" = "200" ]; then got=1; echo "Sentry event $id sent"; else echo "::warning::Sentry did not accept the event (HTTP $code)" >&2; fi
  fi
else echo "::warning::no Sentry DSN for $ref: no event sent" >&2; fi

[ "$got" = 1 ] || { echo "::error::nobody could be told: neither the ops exception nor the Sentry event went out" >&2; exit 1; }
