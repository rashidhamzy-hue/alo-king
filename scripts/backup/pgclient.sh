#!/usr/bin/env bash
# BK0: make sure pg_dump and pg_restore of exactly the server's major version are on the runner, and print the directory.
#   PG_BIN=$(scripts/backup/pgclient.sh 17)
# A pg_dump older than its server refuses to run, and a pg_restore older than the dump refuses to read it, so the client is matched
# to the server (and the restore container to the copy) by major version. GitHub's ubuntu runners ship one or two of them; the
# others come from the PostgreSQL project's own apt repository (apt.postgresql.org), the documented way.
set -euo pipefail
major=${1:?major version, e.g. 17}
[[ "$major" =~ ^[0-9]{2}$ ]] || { echo "pgclient.sh: '$major' is not a Postgres major version" >&2; exit 2; }
dir=/usr/lib/postgresql/$major/bin
if [ ! -x "$dir/pg_dump" ] || [ ! -x "$dir/pg_restore" ]; then
  {
    sudo apt-get update -qq
    sudo apt-get install -y -qq postgresql-common
    sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
    sudo apt-get install -y -qq "postgresql-client-$major"
  } >&2
fi
[ -x "$dir/pg_dump" ] && [ -x "$dir/pg_restore" ] || { echo "pgclient.sh: no pg_dump $major after install" >&2; exit 1; }
echo "$dir"
