#!/usr/bin/env bash
# Makes sure each staging line has a Kapso webhook pointing at the staging Worker, with a signing secret that
#   - is generated here, from the system random source, and masked in the log;
#   - is stored only as a Worker secret (wrangler secret put) and inside Kapso, which needs it to sign;
#   - is never written to a file, never printed, never kept in the repository.
# An existing webhook whose Worker secret is still present is left alone, so a normal deploy does not rotate anything.
# ROTATE=true makes new secrets for both. A secret that is missing from the Worker is also remade.
# Proof: one signed event ("smoke.test") is posted to the Worker. It must answer 200, which shows the signature check
# passed with the new secret and that the Worker can write to Supabase (the event is stored in wa_inbound_events).
#
# Needs: KAPSO_API_KEY WORKER_URL PHONE_NUMBER_ID_CUSTOMER PHONE_NUMBER_ID_OPS (+ CLOUDFLARE_* for wrangler). Optional: ROTATE, WRANGLER_CONFIG.
# Exit: 0 customer line is done (the ops line may have been skipped: see its summary line); non-zero: customer line failed.
set -uo pipefail
: "${KAPSO_API_KEY:?}" "${WORKER_URL:?}" "${PHONE_NUMBER_ID_CUSTOMER:?}" "${PHONE_NUMBER_ID_OPS:?}"
API="${KAPSO_API_BASE:-https://api.kapso.ai/platform/v1}/whatsapp/phone_numbers"
CFG="${WRANGLER_CONFIG:-wrangler.jsonc}"
ROTATE="${ROTATE:-false}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
WRANGLER="${WRANGLER:-npx wrangler}"
# Message events the gateway handles (apps/gateway/src/index.ts, route()). Buffering stays off: the conversation object buffers.
EVENTS='["whatsapp.message.received","whatsapp.message.delivered","whatsapp.message.read","whatsapp.message.failed","whatsapp.contact.marketing_preference_changed","whatsapp.contact.identity_changed"]'

kapso() { curl -sS --fail-with-body -H "X-API-Key: $KAPSO_API_KEY" -H 'Content-Type: application/json' "$@"; }

worker_secret_names() { $WRANGLER secret list --env staging --config "$CFG" --format json 2>/dev/null | jq -r '.[].name' 2>/dev/null; }

ensure_webhook() {  # line phone_number_id secret_name
  local line="$1" pnid="$2" name="$3" url="$WORKER_URL/webhooks/kapso/$1" id list present
  list=$(kapso "$API/$pnid/webhooks") || { echo "$line: could not list webhooks: $list"; return 1; }
  id=$(jq -r --arg u "$url" '(.data // .)[]? | select(.url == $u) | .id' <<<"$list" | head -1)
  present=$(worker_secret_names | grep -cx "$name" || true)
  if [ -n "$id" ] && [ "$present" -ge 1 ] && [ "$ROTATE" != "true" ]; then
    # The event list can grow (4.1 added identity_changed). Bring it up to date without touching the secret.
    local have; have=$(jq -c --arg u "$url" '[(.data // .)[]? | select(.url == $u) | .events // [] | sort[]]' <<<"$list")
    if [ "$have" != "$(jq -c 'sort' <<<"$EVENTS")" ]; then
      kapso -X PATCH "$API/$pnid/webhooks/$id" --data-binary "$(jq -n --argjson ev "$EVENTS" '{whatsapp_webhook: {events: $ev}}')" >/dev/null \
        || { echo "$line: could not update the event list"; return 1; }
      echo "$line: webhook $id event list updated"; echo "- $line webhook events updated: $(jq -r 'join(", ")' <<<"$EVENTS")" >> "$SUMMARY"
    fi
    echo "$line: webhook $id exists and the Worker has its secret: nothing to do"
    echo "- $line webhook present (id $id), secret untouched" >> "$SUMMARY"
    return 0
  fi

  local SECRET; SECRET=$(openssl rand -hex 32); export SECRET
  echo "::add-mask::$SECRET"
  # 1. Worker first, so the first signed delivery already has a secret to check against.
  printf '%s' "$SECRET" | $WRANGLER secret put "$name" --env staging --config "$CFG" >/dev/null 2>&1 \
    || { echo "$line: could not store $name in the Worker"; unset SECRET; return 1; }
  # 2. Then Kapso. The secret goes through the environment into jq, never through a command line.
  local body res
  if [ -n "$id" ]; then
    body=$(jq -n --argjson ev "$EVENTS" --arg u "$url" '{whatsapp_webhook: {url: $u, events: $ev, secret_key: env.SECRET, active: true, payload_version: "v2"}}')
    res=$(kapso -X PATCH "$API/$pnid/webhooks/$id" --data-binary "$body") || { echo "$line: update failed: $res"; unset SECRET; return 1; }
    echo "$line: webhook $id updated with a new secret"
  else
    body=$(jq -n --argjson ev "$EVENTS" --arg u "$url" '{whatsapp_webhook: {kind: "kapso", url: $u, events: $ev, secret_key: env.SECRET, active: true, payload_version: "v2"}}')
    res=$(kapso -X POST "$API/$pnid/webhooks" --data-binary "$body") || { echo "$line: create failed: $res"; unset SECRET; return 1; }
    id=$(jq -r '(.data // .).id // empty' <<<"$res")
    echo "$line: webhook ${id:-?} created"
  fi
  unset body

  # 3. Prove it with one signed event.
  local sig code ok=0 i
  sig=$(printf '%s' '{}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(require("crypto").createHmac("sha256",process.env.SECRET).update(d).digest("hex")))')
  for i in 1 2 3 4 5 6; do
    code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$url" -H "X-Webhook-Event: smoke.test" -H "X-Idempotency-Key: smoke-${GITHUB_RUN_ID:-local}-$line-$i" -H "X-Webhook-Signature: $sig" --data-binary '{}' || true)
    [ "$code" = "200" ] && { ok=1; break; }; sleep 5
  done
  unset SECRET sig
  if [ "$ok" != "1" ]; then echo "$line: signed test event answered $code, expected 200"; return 1; fi
  echo "$line: signed test event accepted (signature check and Supabase write both worked)"
  echo "- $line webhook ready (id ${id:-?}); signed test event accepted" >> "$SUMMARY"
}

# Project webhook (4.10): Meta enforcement on the WhatsApp account and number lifecycle. One per project, payload v2.
PROJECT_EVENTS='["whatsapp.account.disabled","whatsapp.account.restricted","whatsapp.account.reinstated","whatsapp.account.violation","whatsapp.phone_number.offboarded","whatsapp.phone_number.disconnected","whatsapp.phone_number.reconnected","whatsapp.phone_number.deleted"]'
ensure_project_webhook() {
  local url="$WORKER_URL/webhooks/kapso/project" name=KAPSO_WEBHOOK_SECRET_PROJECT base="${KAPSO_API_BASE:-https://api.kapso.ai/platform/v1}" list id present
  list=$(kapso "$base/whatsapp/webhooks?per_page=100") || { echo "project: could not list webhooks: $list"; return 1; }
  id=$(jq -r --arg u "$url" '(.data // .)[]? | select(.url == $u) | .id' <<<"$list" | head -1)
  present=$(worker_secret_names | grep -cx "$name" || true)
  if [ -n "$id" ] && [ "$present" -ge 1 ] && [ "$ROTATE" != "true" ]; then
    echo "project: webhook $id exists and the Worker has its secret: nothing to do"; echo "- project webhook present (id $id)" >> "$SUMMARY"; return 0
  fi
  local SECRET; SECRET=$(openssl rand -hex 32); export SECRET; echo "::add-mask::$SECRET"
  printf '%s' "$SECRET" | $WRANGLER secret put "$name" --env staging --config "$CFG" >/dev/null 2>&1 || { echo "project: could not store $name"; unset SECRET; return 1; }
  local body res
  if [ -n "$id" ]; then
    body=$(jq -n --argjson ev "$PROJECT_EVENTS" --arg u "$url" '{whatsapp_webhook: {url: $u, events: $ev, secret_key: env.SECRET, active: true, payload_version: "v2"}}')
    res=$(kapso -X PATCH "$base/whatsapp/webhooks/$id" --data-binary "$body") || { echo "project: update failed: $res"; unset SECRET; return 1; }
  else
    body=$(jq -n --argjson ev "$PROJECT_EVENTS" --arg u "$url" '{whatsapp_webhook: {kind: "kapso", url: $u, events: $ev, secret_key: env.SECRET, active: true, payload_version: "v2"}}')
    res=$(kapso -X POST "$base/whatsapp/webhooks" --data-binary "$body") || { echo "project: create failed: $res"; unset SECRET; return 1; }
    id=$(jq -r '(.data // .).id // empty' <<<"$res")
  fi
  local sig code ok=0 i
  sig=$(printf '%s' '{}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(require("crypto").createHmac("sha256",process.env.SECRET).update(d).digest("hex")))')
  for i in 1 2 3 4 5 6; do
    code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$url" -H "X-Webhook-Event: smoke.test" -H "X-Idempotency-Key: smoke-${GITHUB_RUN_ID:-local}-project-$i" -H "X-Webhook-Signature: $sig" --data-binary '{}' || true)
    [ "$code" = "200" ] && { ok=1; break; }; sleep 5
  done
  unset SECRET sig
  [ "$ok" = "1" ] || { echo "project: signed test event answered $code, expected 200"; return 1; }
  echo "project: webhook ${id:-?} ready, signed test event accepted"; echo "- project webhook ready (id ${id:-?}): account enforcement and number events" >> "$SUMMARY"
}

rc=0
ensure_webhook customer "$PHONE_NUMBER_ID_CUSTOMER" KAPSO_WEBHOOK_SECRET_CUSTOMER || rc=1
if ensure_project_webhook; then :; else
  echo "::warning::project webhook (account enforcement events) is not ready; recorded in the summary"
  echo "- **project webhook NOT ready**: enforcement events will not reach us; see the step log" >> "$SUMMARY"
fi

# Ops line: the Kapso sandbox. A failure here is recorded, not fatal: the customer line is the one that must work.
if ensure_webhook ops "$PHONE_NUMBER_ID_OPS" KAPSO_WEBHOOK_SECRET_OPS; then :; else
  echo "::warning::ops line webhook is not ready (see log); recorded in the summary"
  echo "- **ops line webhook NOT ready**: see the step log; the staging ops line needs attention" >> "$SUMMARY"
fi
exit $rc
