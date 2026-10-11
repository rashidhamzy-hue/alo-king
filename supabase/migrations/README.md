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

## Conventions (Phase 1b)

- Geography is public reference data: `governorates`, `districts`, `cadastral_zones`, `places`, `business_type_labels`, `cuisine_tags` are readable by anyone. Places are switched only with `place_set_service_status()` (admin, audited).
- Points are `geography(point, 4326)`; polygons are `geometry(multipolygon, 4326)` for fast containment. Snap a pin with `place_for_point()`; search names with `search_places()` (normalised by `app_private.normalize_place_name()`).

## Conventions (Phase 2)

- Orders change status only through `app_private.order_set_status()` (called by `order_accept`, `order_reject`, `order_progress`, `order_assign_driver`, the cancel functions and the router). A trigger enforces `app_private.order_transition_ok()` for every writer; every change writes one `order_events` row.
- Client-callable RPCs are `security invoker` wrappers in `public` over definer functions in `app_private` that check the caller (`app_private.order_actor()`: member role, operator, or the server acting for a member id).
- Prices are written only by `basket_price()` and `order_place()` from the menu; the client sends item and option IDs and quantities. `order_place()` re-checks the menu version, availability, pause, radius (road km from the route cache), COD caps and daily quantities, locks the rate and snapshots the order fee.
- `scripts/db-race-test.sh` runs real concurrent sessions after the SQL tests (last units, duplicate confirmation, accept vs reject, accept vs cancel).
- Merchant notifications: `order_dispatch` holds each order's escalation stage; `outbound_messages` is the outbox (deduplicated by `dedupe_key`) the `dispatch` edge function drains with `outbox_claim` / `outbox_finish`; `ops_alerts` are operator alerts (Telegram). Timers are pg_cron jobs `order-escalation` (5 s), `order-monitor` (15 s) and `dispatch-kick` (5 s, pg_net). Merchant changes typed on WhatsApp are `merchant_proposals` applied only by `merchant_proposal_decide` (the confirming tap).
