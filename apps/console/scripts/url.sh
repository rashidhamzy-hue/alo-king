#!/usr/bin/env bash
# Prints the staging console's address: from the deploy log when there is one, else from the account's workers.dev subdomain.
set -euo pipefail
log="${RUNNER_TEMP:-/tmp}/deploy.log"
url=""
[ -f "$log" ] && url=$(grep -oE 'https://alo-king-console-staging\.[a-z0-9-]+\.workers\.dev' "$log" | head -1 || true)
if [ -z "$url" ]; then
  : "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}"
  sub=$(curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" | jq -r '.result.subdomain // empty')
  [ -n "$sub" ] || { echo "could not work out the console address" >&2; exit 1; }
  url="https://alo-king-console-staging.$sub.workers.dev"
fi
echo "$url"
