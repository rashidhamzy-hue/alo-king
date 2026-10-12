#!/usr/bin/env bash
# Builds the site against the fixture mock and serves both, for the website quality checks.
#   scripts/web/qa-serve.sh start [live|prelaunch]   |   scripts/web/qa-serve.sh stop
# Ports: mock Supabase 4020, site 4010. PIDs in .qa-pids (git-ignored).
set -euo pipefail
cd "$(dirname "$0")/../.."
case "${1:-start}" in
  stop)
    [ -f .qa-pids ] && xargs -r kill < .qa-pids 2>/dev/null || true
    rm -f .qa-pids ;;
  start)
    mode="${2:-live}"
    [ -f .qa-pids ] && xargs -r kill < .qa-pids 2>/dev/null || true
    rm -f .qa-pids
    if [ "${SKIP_BUILD:-}" != "1" ]; then
      VITE_SUPABASE_URL=http://127.0.0.1:4020 VITE_WHATSAPP_NUMBER=96170000000 NITRO_PRESET=node-server pnpm build >/dev/null
    fi
    nohup node scripts/web/mock-supabase.mjs 4020 "$mode" >/dev/null 2>&1 & echo $! >> .qa-pids
    # SITE_INDEXING=on in the checks, so the pages are measured the way production will serve them.
    SITE_INDEXING="${SITE_INDEXING:-on}" PORT=4010 nohup node .output/server/index.mjs >/dev/null 2>&1 & echo $! >> .qa-pids
    nohup node scripts/web/compress-proxy.mjs 4011 4010 >/dev/null 2>&1 & echo $! >> .qa-pids
    for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:4011/en && break; sleep 1; done
    echo "serving http://127.0.0.1:4010 (plain) and http://127.0.0.1:4011 (compressed), mock: $mode" ;;
esac
