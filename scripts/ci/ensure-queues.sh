#!/usr/bin/env bash
# Creates the staging queue and its dead-letter queue if they do not exist. wrangler deploy does not create queues.
# Exit codes: 0 both exist; 2 Cloudflare says this plan cannot have queues (the workflow then deploys without the queue
# and records that Workers Paid is needed); anything else is a real failure.
set -uo pipefail
status=0
for q in ak-inbound-staging ak-inbound-staging-dlq; do
  out=$(${WRANGLER:-npx wrangler} queues create "$q" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then echo "queue $q created"; continue; fi
  # Cloudflare says "already taken ... [code: 11009]" (seen live on 13 Nov); older wording was "already exists".
  if echo "$out" | grep -qiE "already (taken|exists)|code: 11009"; then echo "queue $q exists"; continue; fi
  if echo "$out" | grep -qiE "paid plan|workers paid|upgrade your plan|10[0-9]{3}.*(plan|paid)"; then echo "queue $q: this plan cannot create queues"; echo "$out" | head -5; status=2; continue; fi
  echo "queue $q failed:"; echo "$out" | head -20; exit 1
done
exit $status
