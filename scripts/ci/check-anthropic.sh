#!/usr/bin/env bash
# Proves the Anthropic key works and that both model ids the Worker uses exist, with a 5-token call each (a fraction of a cent).
# Reads ANTHROPIC_API_KEY, MODEL_FAST and MODEL_SMART from the environment. Never prints the key or the model's reply.
# It cannot see or set the monthly spend limit: that is a console setting (docs/HANDOFF.md, task 0.7).
set -uo pipefail
: "${ANTHROPIC_API_KEY:?}" "${MODEL_FAST:?}" "${MODEL_SMART:?}"
rc=0
for model in "$MODEL_FAST" "$MODEL_SMART"; do
  body=$(jq -n --arg m "$model" '{model: $m, max_tokens: 5, messages: [{role: "user", content: "ping"}]}')
  code=$(curl -sS -o /tmp/anthropic.json -w '%{http_code}' https://api.anthropic.com/v1/messages \
    -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" -d "$body" || true)
  if [ "$code" = "200" ]; then echo "model $model: ok"
  else echo "model $model: HTTP $code $(jq -r '.error.type + ": " + .error.message' /tmp/anthropic.json 2>/dev/null | head -c 200)"; rc=1; fi
done
rm -f /tmp/anthropic.json
exit $rc
