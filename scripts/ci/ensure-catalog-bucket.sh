#!/usr/bin/env bash
# Creates the PUBLIC `catalog` bucket (approved product pictures only; migration 0115) if it does not exist, then proves three things:
#   1. the bucket is public (Meta reads the pictures without a key) and only takes pictures: jpeg, png, webp, 5 MB at most;
#   2. the private `media` bucket is still private (receipts and voice notes live there: CLAUDE.md);
#   3. an anonymous reader cannot list the public bucket, and nothing in it is a receipt or a voice note by name.
# What goes into the bucket is decided by the database (catalog_picture_work) and done by the Worker; this script only makes the bucket.
# Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment. Never prints the key.
set -euo pipefail
: "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_KEY:?}"
api="$SUPABASE_URL/storage/v1"
auth=(-H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY")
tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
want='{"id":"catalog","name":"catalog","public":true,"file_size_limit":5242880,"allowed_mime_types":["image/jpeg","image/png","image/webp"]}'

code=$(curl -sS -o "$tmp" -w '%{http_code}' "${auth[@]}" "$api/bucket/catalog" || true)
if [ "$code" = "200" ]; then
  echo "bucket catalog exists"
else
  echo "creating bucket catalog (public, pictures only)"
  code=$(curl -sS -o "$tmp" -w '%{http_code}' -X POST "${auth[@]}" -H 'Content-Type: application/json' -d "$want" "$api/bucket" || true)
  case "$code" in
    200|201|409) echo "bucket catalog ready" ;;
    *) if grep -qi "already exists\|duplicate" "$tmp"; then echo "bucket catalog already exists"; else echo "bucket create failed: HTTP $code"; cat "$tmp"; exit 1; fi ;;
  esac
fi
# Make an existing bucket match (idempotent): public, pictures only, 5 MB.
code=$(curl -sS -o "$tmp" -w '%{http_code}' -X PUT "${auth[@]}" -H 'Content-Type: application/json' \
  -d '{"public":true,"file_size_limit":5242880,"allowed_mime_types":["image/jpeg","image/png","image/webp"]}' "$api/bucket/catalog" || true)
[ "$code" = "200" ] || { echo "bucket catalog update failed: HTTP $code"; cat "$tmp"; exit 1; }

# 1. read it back
curl -sS -f "${auth[@]}" "$api/bucket/catalog" -o "$tmp"
python3 - "$tmp" <<'PY'
import json, sys
b = json.load(open(sys.argv[1]))
assert b.get("public") is True, "FAIL: bucket catalog is not public"
assert sorted(b.get("allowed_mime_types") or []) == ["image/jpeg", "image/png", "image/webp"], "FAIL: bucket catalog takes more than pictures"
assert 0 < (b.get("file_size_limit") or 0) <= 5242880, "FAIL: bucket catalog has no 5 MB limit"
print("bucket catalog is public, pictures only, 5 MB at most")
PY

# 2. media must be private
curl -sS -f "${auth[@]}" "$api/bucket/media" -o "$tmp"
python3 - "$tmp" <<'PY'
import json, sys
assert json.load(open(sys.argv[1])).get("public") is False, "FAIL: bucket media is public"
print("bucket media is private")
PY

# 3. an anonymous reader cannot list the public bucket, and no name in it looks like a receipt or a voice note
anon=$(curl -sS -o "$tmp" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"prefix":"","limit":1}' "$api/object/list/catalog" || true)
case "$anon" in 400|401|403|404) echo "anonymous listing of catalog refused ($anon)" ;; *) echo "FAIL: anonymous listing of catalog answered $anon"; exit 1 ;; esac
curl -sS -f "${auth[@]}" -X POST -H 'Content-Type: application/json' -d '{"prefix":"","limit":1000}' "$api/object/list/catalog" -o "$tmp"
python3 - "$tmp" <<'PY'
import json, re, sys
names = [o["name"] for o in json.load(open(sys.argv[1])) if o.get("id")]
# WEB4b (0252): each public picture also has a JPEG copy for the WhatsApp catalogue feed, <sku>-<image id>.feed.jpg (catalog-jpegs workflow)
bad = [n for n in names if not re.fullmatch(r"AK-[0-9]{4}-[0-9a-f-]{36}(\.feed\.jpg|\.(jpg|png|webp))", n)]
assert not bad, f"FAIL: {len(bad)} object(s) in catalog are not product pictures by name (the Worker's hourly pass removes strays)"
print(f"catalog holds {len(names)} picture(s), every one named like a product picture")
PY
