---
name: alo-supabase-migrations
description: Use when creating or reviewing Supabase Postgres migrations, row-level security, roles, indexes, triggers, RPCs, queues, the ledger schema, rollback files, or tenant isolation in Alo King.
---

# Alo King Supabase migrations

Only project: `alo-king-staging` (`tzugbbatfbvrfzxuacqx`, eu-central-1). The guard hook blocks every other ref; `kabsi-prod` is never touched. The production project is created at pilot.

## Where things go
- New file per change in `supabase/migrations/YYYYMMDDHHMMSS_name.sql`. Never edit an applied migration.
- `supabase/migrations_legacy/` is reference only: never applied, never copied wholesale. Re-implement its good ideas (DECISIONS §2).
- A migration that drops or deletes data (`DROP TABLE|COLUMN|SCHEMA`, `TRUNCATE`, `DELETE FROM`) ships with `supabase/rollbacks/<same name>`; `scripts/check-migrations.sh` fails CI otherwise.
- CI dry-runs pending migrations against staging; the automerge job applies them after merge. Do not apply by hand with `execute_sql` or `apply_migration`; the repo is the source of truth.
- Schema tasks in Phases 1 and 2 run one at a time (§10): check open PRs touching `supabase/migrations/` first.

## Design rules
- Explicit names for tables, constraints, indexes, policies and functions; `created_at`/`updated_at`; actor columns where changes are audited.
- Money: numeric amounts with an explicit currency; USD and LBP recorded on every money row with the rate locked on the order. Payments, refunds, COD cash, fees, settlements and merchant credit are rows in one append-only double-entry ledger; balances are views, never edited (§20).
- No hard-coded business numbers: exchange rate, VAT, fee bands, COD cap and message rates live in dated tables or config.
- Vendors: seed fields marked `source = seed` until the merchant confirms; unclaimed vendors have `public_page = false` and no ratings; Google data keeps `place_id` only where §15 says so.
- PostGIS for delivery radius and distance checks; places carry `service_status`.
- Queue: pgmq plus pg_cron; one RPC per business operation; hot-path read models; indexes checked with `EXPLAIN ANALYZE`.
- Idempotency: unique constraints on provider event IDs and idempotency keys; state changes are conditional updates on the current state.

## Row-level security (answer for every table)
Who can select, insert, update, delete? How are customer ownership, merchant membership (owner, manager, cashier, kitchen), driver assignment and operator access proven? Can a client change `vendor_id`, `customer_id`, role, amount or status? Can a tenant infer another's rows from counts, errors or IDs? `anon` never reads personal data; service-role-only RPCs are revoked from `anon` and `authenticated`. The front end never reads `vendors` with `select('*')`.

## Before merging
Dry-run passes in CI; RLS tests as anonymous, customer, merchant, driver and operator; generated types updated; lock and backfill risk named; deployment order for functions and front end stated; rollback or forward fix written.

## Report
Migration file, schema changes, constraints and indexes, RLS explanation, backfill, compatibility, tests, deployment order, rollback, risks.
