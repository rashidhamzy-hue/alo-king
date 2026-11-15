#!/usr/bin/env bash
# BK0: decrypt a copy, restore it into the scratch Postgres, and hold the result to the manifest.
#   scripts/backup/restore-run.sh BUNDLE.tar.gpg WORKDIR
# Environment: BACKUP_PASSPHRASE, RESTORE_DATABASE_URL (a local scratch database that exists and is empty), PG_BIN (directory of a
# pg_restore at least as new as the server that made the copy; default: the one on PATH).
set -euo pipefail
bundle=${1:?bundle}; work=${2:?workdir}
here=$(cd "$(dirname "$0")" && pwd)
bin() { if [ -n "${PG_BIN:-}" ]; then echo "$PG_BIN/$1"; else echo "$1"; fi; }
node "$here/restore.mjs" decrypt --in "$bundle" --out "$work"
node "$here/restore.mjs" prepare --manifest "$work/manifest.json"
# The dump carries "CREATE SCHEMA public"; the scratch database already has one (and any extension installed into it by `prepare`).
"$(bin pg_restore)" --list "$work/dump" | grep -Ev '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' > "$work/restore.list"
# --disable-triggers: the migrations' own triggers (the ledger balance, the settings locks) guard live writes, not a faithful reload.
# --exit-on-error: a restore that skipped something is a failed restore.
"$(bin pg_restore)" --exit-on-error --no-owner --no-privileges --disable-triggers --use-list "$work/restore.list" --dbname "$RESTORE_DATABASE_URL" "$work/dump"
echo "pg_restore finished" >&2
node "$here/restore.mjs" verify --manifest "$work/manifest.json"
