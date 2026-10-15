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
- Merchant notifications: `order_dispatch` holds each order's escalation stage; `outbound_messages` is the outbox (deduplicated by `dedupe_key`) the `dispatch` edge function drains with `outbox_claim` / `outbox_finish`; `ops_alerts` are operator alerts, mirrored to Slack through `slack_messages` (§32.1). Timers are pg_cron jobs `order-escalation` (5 s), `order-monitor` (15 s) and `dispatch-kick` (5 s, pg_net). Merchant changes typed on WhatsApp are `merchant_proposals` applied only by `merchant_proposal_decide` (the confirming tap).

## Conventions (session 5, claims)

- Claims and registrations are `vendor_claims` rows driven only by server functions (`claim_start`, `claim_verify_code`, `claim_add_document`, `claim_decide`, `vendor_register`, `vendor_from_google`, `member_recover_*`). Claim codes are 6 digits, sent only to the shop's own seed number, and stored as salted SHA-256 hashes. An approved claim makes the claimant an active `owner` with a phone login (`app_private.auth_user_for_phone`, linked in `app_private.phone_logins`). `claims-tick` (pg_cron, every minute) closes objection windows and expires stale claims.

## Conventions (session 5, smart menu and nutrition)

- The Lebanese dish library (`dish_library`, `nutrition_ingredients`) is generated from `supabase/seed/nutrition/` by `scripts/nutrition/library.ts`; `scripts/nutrition/library.test.ts` fails if the migration's LIBRARY block differs. A library change is a new migration with the regenerated rows.
- `menu_item_nutrition` holds per-item values with a source per value (`merchant_verified`, `estimated`, `unknown`). Estimates come only from `menu_nutrition_estimate` (library recipe × portion answer); merchants confirm with `menu_nutrition_confirm` or edit with `menu_nutrition_set`. Allergens and diet tags are written only by `menu_item_dietary_set`.
- Menu drafts (`menu_drafts`) reach the menu only through `menu_draft_approve_section`, one section per merchant tap.

## Conventions (session 5, Flows, hours and catalogue)

- A WhatsApp Flow is opened only by `flow_open` (server-built initial data, a random token tied to the phone, context stored in `flow_sends`) and applied only by `flow_submit` (token once, payload re-validated against that context; prices recomputed by `basket_add_item`). Each Flow is sent only when its switch in `flows_enabled` is on and its kill-gate has not stopped it (`flow_enabled`); a token expires after `flow_token_ttl_min`.
- Opening hours live in `vendor_hours` (Beirut time; closing before opening = past midnight; no rows = always open). `hours-tick` (every minute) pauses an orderable vendor outside its hours with reason `closed (hours)` and resumes it; a merchant's own pause is never touched.
- The Meta catalogue is built from `catalog_desired` (retailer_id = our item id, one product set per branch) and diffed against `catalog_sync_items`; carts are re-priced from the menu (`catalog_enabled` is false until cut-over).

## Conventions (session 5, merchant WhatsApp extras)

- Per-branch operating state lives in `vendor_ops` (kitchen capacity, generator mode, same-price confirmation), not on the frozen `vendors` table. It is changed only by `merchant_proposal_decide`, after the member's tap. Who may propose and confirm each kind is `app_private.proposal_roles()`: staff are owner only, capacity, same price and `needs_power` are owner or manager, and the rest are any kitchen role.
- Kitchen capacity: `orders_capacity_eta` lengthens a new order's prep time when the queue (`placed`, `accepted`, `preparing`) is at or above `max_active_orders`. `orders_capacity_after` pauses new orders at `kitchen_pause_factor` × capacity (reason `kitchen full (auto)`) and lifts only that pause once the queue is below the capacity.
- Generator mode hides `needs_power` items through `available`, records them in `app_private.power_hidden_items`, and "power back" restores exactly those.
- `staff_shift_touch` is called on every member message. A non-owner silent for `shift_gap_hours` gets the handover (open orders, items off, open complaints).
- Substitutions: the preference is asked at checkout for `substitution_business_types` and copied onto the order. `order_substitution_offer` prices the substitute from the menu (COD orders, within the COD cap). `order_substitution_decide` is the customer's tap: it swaps or removes the line and recomputes the totals, with LBP at the locked rate.
- `order_card_image` returns the data for the gold card image (null while `order_card_image_enabled` is false). The dispatch function renders it with resvg and the fonts in `supabase/functions/_shared/fonts`.
