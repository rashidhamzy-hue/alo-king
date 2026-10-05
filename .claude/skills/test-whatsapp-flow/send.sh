#!/bin/bash
# Send one simulated WhatsApp event to kapso-brain in dry-run mode and print the replies it would send.
# usage: SELFTEST_TOKEN=... send.sh <phone> text "<message>"
#        SELFTEST_TOKEN=... send.sh <phone> reply "<button id>" "<button title>"
set -euo pipefail
URL="https://hnjkietmwvkgbyrcnweq.supabase.co/functions/v1/kapso-brain"
: "${SELFTEST_TOKEN:?set SELFTEST_TOKEN to a live row of selftest_tokens}"
case "$1" in 961700000*) ;; *) echo "use a test phone starting with 961700000" >&2; exit 2;; esac
ID="wamid.t4.$RANDOM$RANDOM$(date +%s%N)"
if [ "$2" = "text" ]; then
  BODY=$(python3 -c 'import json,sys;print(json.dumps({"message":{"id":sys.argv[1],"from":sys.argv[2],"type":"text","text":{"body":sys.argv[3]}}}))' "$ID" "$1" "$3")
else
  BODY=$(python3 -c 'import json,sys;print(json.dumps({"message":{"id":sys.argv[1],"from":sys.argv[2],"type":"interactive","interactive":{"type":"button_reply","button_reply":{"id":sys.argv[3],"title":sys.argv[4]}}}}))' "$ID" "$1" "$3" "$4")
fi
curl -sS -m 120 -X POST "$URL" -H "x-selftest: $SELFTEST_TOKEN" -H "content-type: application/json" -d "$BODY" | python3 "$(dirname "$0")/show.py"
