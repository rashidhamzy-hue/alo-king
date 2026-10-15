#!/usr/bin/env bash
# Registers the Kapso webhook on every given WhatsApp number of the Alo King project, all with ONE signing secret, and
# stores that secret as the whatsapp-webhook function secret KAPSO_WEBHOOK_SECRET (never printed). One secret for all
# numbers: the function verifies every delivery with the same key, so the sandbox and the US test number (and later the
# company numbers) must be registered together; registering one alone would break the others.
# The URL pins the function region (CLAUDE.md): ?forceFunctionRegion=eu-central-1. Kapso only at https://api.kapso.ai.
# Usage: KAPSO_API_KEY=… SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=tzugbbatfbvrfzxuacqx scripts/kapso/webhooks.sh <phone_number_id>...
set -euo pipefail
[ "${SUPABASE_PROJECT_REF:-}" = "tzugbbatfbvrfzxuacqx" ] || { echo "::error::only alo-king-staging"; exit 1; }
[ $# -ge 1 ] || { echo "::error::no phone number ids"; exit 1; }
for id in "$@"; do [[ "$id" =~ ^[0-9]{6,20}$ ]] || { echo "::error::bad phone number id"; exit 1; }; done

base="https://api.kapso.ai/platform/v1/whatsapp"
url="https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/whatsapp-webhook?forceFunctionRegion=eu-central-1"
# Kapso's error bodies are printed (they carry no secret); a success body is only parsed, never printed.
k() {
  local out code
  out=$(mktemp)
  code=$(curl -sS --proto '=https' --max-redirs 0 -o "$out" -w '%{http_code}' -H "X-API-Key: $KAPSO_API_KEY" \
    -H 'content-type: application/json' "$@")
  if [ "$code" -ge 300 ]; then echo "Kapso answered $code: $(head -c 600 "$out")" >&2; rm -f "$out"; return 1; fi
  cat "$out"; rm -f "$out"
}

umask 077
secret=$(openssl rand -hex 32)
echo "::add-mask::$secret"
for pn in "$@"; do
  num="$base/phone_numbers/${pn}/webhooks"
  echo "number ${pn}: remove earlier webhooks for this URL (per-number and project scope)"
  for scope in "$num" "$base/webhooks"; do
    existing=$(k "$scope" || echo '[]')
    for id in $(printf '%s' "$existing" | jq -r --arg u "$url" '(.data // .) | (if type=="array" then . else [] end) | .[] | select(.url == $u) | select((.phone_number_id // "") == "" or .phone_number_id == "'"$pn"'") | .id'); do
      k -X DELETE "$scope/$id" >/dev/null && echo "   removed $id"
    done
  done
  body=$(jq -n --arg u "$url" --arg s "$secret" '{whatsapp_webhook: {url: $u, secret_key: $s, payload_version: "v2", active: true,
    buffer_enabled: false,
    events: ["whatsapp.message.received", "whatsapp.message.sent", "whatsapp.message.delivered",
             "whatsapp.message.read", "whatsapp.message.failed", "whatsapp.contact.marketing_preference_changed"]}}')
  if k -X POST "$num" -d "$body" > created.json; then
    scope=phone_number
  else
    k -X POST "$base/webhooks" -d "$(printf '%s' "$body" | jq --arg p "$pn" '.whatsapp_webhook.phone_number_id = $p')" > created.json
    scope=project
  fi
  returned=$(jq -r '(.data // .) | .secret_key // empty' created.json)
  id=$(jq -r '(.data // .) | .id // empty' created.json)
  rm -f created.json
  if [ -n "$returned" ] && [ "$returned" != "$secret" ]; then
    echo "::error::Kapso replaced the signing secret for ${pn}; one secret for all numbers is required"; exit 1
  fi
  echo "number ${pn}: webhook ${id} (${scope} scope) registered"
done
supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" "KAPSO_WEBHOOK_SECRET=$secret" >/dev/null
echo "KAPSO_WEBHOOK_SECRET updated for $# number(s)"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$url" -H 'content-type: application/json' -d '{}')
echo "unsigned request answered $code"
[ "$code" = "401" ] || [ "$code" = "403" ] || { echo "::error::expected 401/403 for an unsigned request, got $code"; exit 1; }
