#!/usr/bin/env bash
# Creates the private `media` bucket (voice notes, payment screenshots, receipts) if it does not exist, then proves it is private.
# Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment. Never prints the key.
# Voice notes and receipts are personal data: the bucket must never be public (CLAUDE.md).
set -euo pipefail
: "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_KEY:?}"
api="$SUPABASE_URL/storage/v1"
auth=(-H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY")

code=$(curl -sS -o /tmp/bucket.json -w '%{http_code}' "${auth[@]}" "$api/bucket/media" || true)
if [ "$code" = "200" ]; then
  echo "bucket media exists"
else
  echo "creating bucket media (private)"
  # 20 MB: far above the voice limits (3 min customer, 5 min merchant) and the largest photo WhatsApp delivers.
  body='{"id":"media","name":"media","public":false,"file_size_limit":20971520}'
  code=$(curl -sS -o /tmp/bucket.json -w '%{http_code}' -X POST "${auth[@]}" -H 'Content-Type: application/json' -d "$body" "$api/bucket" || true)
  case "$code" in
    200|201) echo "bucket media created" ;;
    409) echo "bucket media already exists" ;;
    *) if grep -qi "already exists\|duplicate" /tmp/bucket.json; then echo "bucket media already exists"; else echo "bucket create failed: HTTP $code"; cat /tmp/bucket.json; exit 1; fi ;;
  esac
fi

# Prove it: read the bucket back and refuse to continue if it is public.
curl -sS -f "${auth[@]}" "$api/bucket/media" -o /tmp/bucket.json
public=$(python3 -c 'import json;print(str(json.load(open("/tmp/bucket.json")).get("public")).lower())')
if [ "$public" != "false" ]; then echo "FAIL: bucket media is public"; exit 1; fi
echo "bucket media is private"
# And prove an anonymous reader gets nothing: an object path in a private bucket answers 400/404 without the key.
anon=$(curl -sS -o /dev/null -w '%{http_code}' "$api/object/public/media/_probe" || true)
case "$anon" in 400|401|403|404) echo "anonymous read refused ($anon)" ;; *) echo "FAIL: anonymous read answered $anon"; exit 1 ;; esac
