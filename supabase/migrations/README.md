# Migrations

Fresh baseline for `alo-king-staging` (DECISIONS §2). The old migrations are in `../migrations_legacy/` as reference only and are never applied.

- One new file per change: `YYYYMMDDHHMMSS_short_name.sql`.
- CI dry-runs every pending migration against staging; the automerge workflow applies them after merge.
- A migration that drops or truncates data (`DROP TABLE`, `DROP COLUMN`, `DROP SCHEMA`, `TRUNCATE`, `DELETE FROM`) must ship with `../rollbacks/<same file name>` or CI fails (`scripts/check-migrations.sh`).
