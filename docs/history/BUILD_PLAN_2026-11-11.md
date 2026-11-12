> **HISTORIC. Do not build from this file.** It is the original step list and the session notes up to 12 November 2026, kept for the record. Its step numbers, statuses and test counts are out of date. The current roadmap is `docs/BUILD_PLAN.md`; the current status is `docs/HANDOFF.md`.

# Build plan

Each step ends with something a person can test on a phone. Do not start a step before the one above it works.

| # | Step | Done when |
|---|------|-----------|
| 0 | Accounts: Meta business verification, two +961 numbers on Kapso, Supabase project, Cloudflare account | Both numbers send and receive in the Kapso inbox |
| 1 | Apply migrations, load `supabase/seed`, deploy the gateway, register one Kapso webhook per number | A WhatsApp message appears in `wa_inbound_events` once, even when Kapso retries |
| 2 | Compliance gateway live; consent capture on first contact; STOP handling | `can_send` refuses a marketing send to a fresh number; STOP is honoured with no model call |
| 3 | Concierge, text only, dark-store catalog, COD, ops lead dispatches by hand | 20 typed test orders end in a correct confirmation card |
| 4 | Voice notes: second transcript, checks, eval harness with the 38 sample notes hand-corrected | Item-level accuracy on the eval set is at or above 90%, with zero invented items |
| 5 | Picker console (web), stock reservations, substitutions | Out-of-stock items cannot be confirmed; picker marks ready from the console |
| 6 | Drivers on the ops number: shift start, job offer buttons, arrived/delivered, COD entry, cash cap and drops | A driver at 150 USD stops receiving COD jobs; at 200 USD receives none until a drop is confirmed |
| 7 | Landmarks: load `supabase/seed/villages.sql` (42 villages around the Baakline-Baqaata corridor, draft rings), fetch coordinates, seed landmarks, location pins, travel-time matrix, automatic assignment and batching | Assignment matches what the ops lead would have picked on 9 of 10 test orders |
| 8 | Transfers: Whish and OMT screenshots through Vision, ops lead confirmation | A reused screenshot is refused; a confirmed transfer releases the order |
| 9 | Merchants: menu photo onboarding, merchant order buttons, payables and payouts | One restaurant goes from menu photo to a delivered order and a payout line |
| 10 | Fleet logs, risk rules, analyst digest, opt-in marketing with approved campaigns | Nightly digest arrives; a campaign cannot send without a named approver |

Launch gate: steps 0 to 6 complete, plus one week of shadow operation where the ops lead reviews every confirmation card.

## Status, 11 November 2026

Done and tested in this repository:
- Steps 1 to 3 in code: gateway, Compliance Gateway, consent and STOP, the Concierge loop, its five tools, the order card, and the Durable Object turn (`apps/gateway/src/turn.ts`). 30 tests pass, including a full text order from buffer to order card.
- `0003_concierge.sql`: `search_catalog`, `resolve_place`, `quote_order`, `create_order_from_quote`, `handle_order_button`, `touch_conversation`, `save_customer_pin`, `travel_minutes`. Smoke-tested on Postgres 16.
- Alias dictionary: 2,233 aliases for all 291 SKUs (`scripts/enrich_catalog_aliases.ts`, a reviewed lexicon; edit and re-run).
- 42 villages and provisional ring-based travel times from Baakline and Baqaata.

Still to do before step 3 can be tested on a phone:
1. `supabase db push`, then the four seed files in this order: `load_catalog.sql`, `load_aliases.sql`, `villages.sql`, `travel_times_estimate.sql`.
2. Set an exchange rate (`insert into fx_rates(lbp_per_usd) values (...)`) and real stock levels. With no rate, quotes return `no_exchange_rate`; with zero stock, everything is out of stock.
3. Geography, on a machine with internet: `OSM_CONTACT=you@example.com node scripts/fetch_village_coords.mjs > supabase/seed/village_coords.sql`, check every line on a map, run it, then `node scripts/build_travel_times.mjs > supabase/seed/travel_times_osrm.sql` and run that. It replaces the ring estimates and never overwrites observed times.
4. Have a dialect speaker read `supabase/seed/product_aliases.csv` once. Fix the lexicon in the script, not the CSV.
5. Wire a second speech provider in `turn.ts` (today the Kapso transcript is the only reading, guarded by the loop and rate checks).
6. Ops line: `processTurn` ignores it until the Ops Copilot is built (step 6).

## Status, 12 November 2026

Built and tested (67 tests; `test/db/*` run against the real migrations in PGlite):
- 0004 hardening, 0005 `plan_order` (SQL only), 0006 rider flow, 0007 reliability, markets, learning, menu import.
- `apps/gateway/src/ops-turn.ts` rider conversation; `index.ts` direct path, in-flight recovery, dedupe, cron.
- `packages/core/src/cash-parse.ts`, `merchant-channel.ts`; `packages/agents/src/job-card.ts`, `menu-fetch.ts`.

Changed on purpose: `delivered` no longer requires a payment; `closed` does (0002). Confirm taps call `confirm_order_checked`.

Next, in order:
1. Wire the Concierge to `plan_order` (one forced extraction call, then SQL; tool loop only when `next = 'ask'`). Convert `concierge-flow.test.ts` to PGlite.
2. Kitchen side of the ops line: order card to merchants, Accept / Ready buttons, `pushWithFallback`.
3. Picker flow; staff console; per-role RLS.
4. Switch functions from `setting()` to `setting_for(market, key)`; nearest-hub lookup.
5. Wire `learnTravelTime` to rider taps; nightly menu re-check from `source_integrations`.

Not covered by tests: `scheduled()`, the live webhook path, the per-rider advisory lock (needs two connections on real Postgres).
Catalog: by-weight reference prices are per 100 g on some items (AK-0042 shows 0.67). Check every by-weight SKU.

### Added later on 12 November (second review)
- 0008: outbox claim is a 60-second lease; `receive_return` (restock or write off returned goods); `ops_exceptions` queue; explicit `service_role` grants.
- Menu import follows redirects by hand and validates every hop.
- `scripts/check_permissions.sh` proves the server role works and client roles are locked out. Run it against a Supabase branch before launch.
- `TEST_REPORT.txt` is the captured run for this tree (70 tests).
- Known and not fixed: riders are offered a job as soon as an order is confirmed, which can mean waiting at a restaurant. Tie the offer to kitchen acceptance and prep time when the kitchen flow is built. No data-retention policy yet. Second speech-to-text provider not wired.
