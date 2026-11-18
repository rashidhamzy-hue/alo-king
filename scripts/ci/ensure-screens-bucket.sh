#!/usr/bin/env bash
# Creates the private `screens` bucket (screenshots of the console and the website, invented data only) if it does not exist, then proves it is private.
# Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment. Never prints the key. DOC2: screenshots live here, not in the repository.
set -euo pipefail
: "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_KEY:?}"
api="$SUPABASE_URL/storage/v1"
auth=(-H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY")
tmp=$(mktemp)
code=$(curl -sS -o "$tmp" -w '%{http_code}' "${auth[@]}" "$api/bucket/screens" || true)
if [ "$code" = "200" ]; then
  echo "bucket screens exists"
else
  echo "creating bucket screens (private)"
  body='{"id":"screens","name":"screens","public":false,"file_size_limit":10485760}'
  code=$(curl -sS -o "$tmp" -w '%{http_code}' -X POST "${auth[@]}" -H 'Content-Type: application/json' -d "$body" "$api/bucket" || true)
  case "$code" in
    200|201) echo "bucket screens created" ;;
    409) echo "bucket screens already exists" ;;
    *) if grep -qi "already exists\|duplicate" "$tmp"; then echo "bucket screens already exists"; else echo "bucket create failed: HTTP $code"; cat "$tmp"; exit 1; fi ;;
  esac
fi
curl -sS -f "${auth[@]}" "$api/bucket/screens" -o "$tmp"
public=$(python3 -c 'import json,sys;print(str(json.load(open(sys.argv[1])).get("public")).lower())' "$tmp")
if [ "$public" != "false" ]; then echo "FAIL: bucket screens is public"; exit 1; fi
echo "bucket screens is private"
anon=$(curl -sS -o /dev/null -w '%{http_code}' "$api/object/public/screens/_probe" || true)
case "$anon" in 400|401|403|404) echo "anonymous read refused ($anon)" ;; *) echo "FAIL: anonymous read answered $anon"; exit 1 ;; esac
