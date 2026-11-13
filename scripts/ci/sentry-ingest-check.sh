#!/usr/bin/env bash
# Posts one info-level event straight to the Sentry ingest endpoint using the DSN in wrangler.jsonc (a public client key).
# Proves the DSN is valid and accepted, independent of the Worker. All runs group into one issue ("deploy-staging ingest check").
set -uo pipefail
dsn=$(node scripts/ci/wrangler-var.mjs SENTRY_DSN) || exit 1
key=$(sed -E 's#^https://([^@]+)@.*#\1#' <<<"$dsn"); host=$(sed -E 's#^https://[^@]+@([^/]+)/.*#\1#' <<<"$dsn"); project=$(sed -E 's#.*/([0-9]+)$#\1#' <<<"$dsn")
id=$(openssl rand -hex 16); now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
body=$(printf '{"event_id":"%s","sent_at":"%s"}\n{"type":"event"}\n{"event_id":"%s","timestamp":"%s","level":"info","platform":"other","environment":"staging","message":"deploy-staging ingest check","fingerprint":["deploy-staging-ingest-check"],"tags":{"source":"ci"}}\n' "$id" "$now" "$id" "$now")
code=$(printf '%s' "$body" | curl -sS -o /tmp/sentry.out -w '%{http_code}' -X POST "https://$host/api/$project/envelope/" \
  -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_key=$key, sentry_client=alo-king-ci/1" -H 'Content-Type: application/x-sentry-envelope' --data-binary @- || true)
echo "- Sentry ingest ($host, project $project): HTTP $code, event $id"
[ "$code" = "200" ] || { echo "Sentry did not accept the event:"; head -c 300 /tmp/sentry.out; echo; exit 1; }
