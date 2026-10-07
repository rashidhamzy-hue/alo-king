# Migrations

Fresh baseline for `alo-king-staging` (DECISIONS §2). The old migrations are in `../migrations_legacy/` as reference only and are never applied.

- One new file per change: `YYYYMMDDHHMMSS_short_name.sql`.
- CI dry-runs every pending migration against staging; the automerge workflow applies them after merge.
- A migration that drops or truncates data (`DROP TABLE`, `DROP COLUMN`, `DROP SCHEMA`, `TRUNCATE`, `DELETE FROM`) must ship with `../rollbacks/<same file name>` or CI fails (`scripts/check-migrations.sh`).

## Conventions (Phase 1a)

- Every table enables row-level security and starts from `revoke all ... from anon, authenticated`, then grants exactly what its policies allow. Policy helpers live in `app_private` (not exposed by the API): `is_operator()`, `is_admin()`, `has_vendor_role(vendor, roles)`, `is_vendor_member(vendor)`.
- Security-definer RPCs in `public` are revoked from `public`, `anon` and `authenticated` and granted to `service_role`, unless they check the caller themselves.
- Audited tables attach `app_private.audit_row()`. Server code acting for someone sets `app.actor_kind` and `app.audit_reason` with `set_config(..., true)`.
- Business numbers (rate, VAT, fee bands, prices, message rates, config) are rows in dated tables: never updated; a change is a new row with a later `effective_from`; read them with `usd_lbp_rate()`, `vat_rate()`, `delivery_fee_usd()`, `max_delivery_km()`, `price_usd()`, `config_numeric()`.
- Money moves only through `ledger_post()` and `ledger_reverse()` (service role). Balances are the views `ledger_account_balances` and `merchant_credit_balances`.

## Tests

`supabase/tests/*.sql` run after every migration on a throwaway Supabase Postgres (CI job `db-tests`, or locally with `DB_URL=... scripts/db-test.sh` against `supabase/postgres:17.6.1.011` in Docker). They test row-level security as anonymous, customer, owner, cashier, operator and admin, plus the ledger and dated-table rules. Add tests for every new table and RPC.
