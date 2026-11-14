#!/usr/bin/env bash
# Posts one cron check-in straight to the Sentry ingest endpoint using the DSN in wrangler.jsonc (a public client key).
# Proves the DSN is valid and accepted, independent of the Worker. A check-in, not an event (A4, audit item 2): an event
# opened a "deploy-staging ingest check" issue that grew by one every deploy. The monitor "deploy-ingest-check-staging"
# is created by the first check-in (monitor_config) and, with a yearly schedule, never reports a miss between deploys.
# SENTRY_CHECK_DRY_RUN=1 prints the envelope instead of posting it (used by test/ci/sentry-smoke.test.ts).
set -uo pipefail
dsn=$(node scripts/ci/wrangler-var.mjs SENTRY_DSN) || exit 1
key=$(sed -E 's#^https://([^@]+)@.*#\1#' <<<"$dsn"); host=$(sed -E 's#^https://[^@]+@([^/]+)/.*#\1#' <<<"$dsn"); project=$(sed -E 's#.*/([0-9]+)$#\1#' <<<"$dsn")
id=$(openssl rand -hex 16); now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
body=$(printf '{"sent_at":"%s"}\n{"type":"check_in"}\n{"check_in_id":"%s","monitor_slug":"deploy-ingest-check-staging","status":"ok","environment":"staging","monitor_config":{"schedule":{"type":"interval","value":1,"unit":"year"},"checkin_margin":1440,"max_runtime":5,"timezone":"UTC"}}\n' "$now" "$id")
if [ "${SENTRY_CHECK_DRY_RUN:-}" = "1" ]; then printf '%s\n' "$body"; exit 0; fi
code=$(printf '%s' "$body" | curl -sS -o /tmp/sentry.out -w '%{http_code}' -X POST "https://$host/api/$project/envelope/" \
  -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_key=$key, sentry_client=alo-king-ci/1" -H 'Content-Type: application/x-sentry-envelope' --data-binary @- || true)
echo "- Sentry ingest ($host, project $project): HTTP $code, check-in $id (monitor deploy-ingest-check-staging)"
[ "$code" = "200" ] || { echo "Sentry did not accept the check-in:"; head -c 300 /tmp/sentry.out; echo; exit 1; }
