# G1 audit, 14 November 2026 (session S1, Fable 5.2)

Read: every document named in the S1 prompt, all 70 migrations (the latest body of each of the 332 SQL functions was indexed by
script; the money, send, role and timer functions were read in full), `apps/`, `packages/`, and the tests for money, permissions
and sending. Staging (`alo-king-staging`) was read with read-only queries and the security advisor. Nothing was deployed, sent or
changed. Nothing here is fixed: each finding names the session that fixes it (`docs/NEXT_SESSIONS.md`).

**Checks run in this session, on commit `471d99e` (main, 14 Nov 13:03 +02:00).**
- `npm run typecheck`: clean.
- `npm test`: 930 passed, 40 skipped (live-only), **1 failed**: `apps/console/test/sign-in.test.ts:152` (audit-log order). It passed
  when run alone (15 of 15). It is a timing fault in the log's file names, not a product fault: finding G1-16.
- Staging, read 14 Nov about 12:30 UTC: 70 migrations applied (last 0093); 14 orders, all `closed`; ledger sum 0.0000 and no
  unbalanced transaction; no open ops exception; `settings.marketing = {"enabled": false}`; no function or table grant to `anon`
  or `authenticated`; no outbox key twice; templates 3 approved, 6 pending; 20 pictures proposed, 0 approved; 470 food facts
  proposed (258 from web pages, 212 from Open Food Facts), 0 approved; `research_loads` holds 580 rows, so **research-load has run**;
  0 delivery-window plans; 0 search-word jobs; AI cost per probe order $0.0019 (`ai_cost_daily`); the hub drawer holds 0.
- Security advisor: 322 functions without a fixed `search_path` (warning), leaked-password protection off (warning), 98 tables
  with row level security and no policy (information: that is the design, only the server role reads them).

## Section 1. Status of every capability

Statuses: **production-proven** (none: no production exists), **staging-proven** (ran on live staging, run or query named),
**built and test-covered**, **partial**, **designed only**, **not started**, **blocked** (by what).

### Ordering (customer line)
| Capability | Status | Evidence |
| --- | --- | --- |
| Typed order to card, confirm tap, close | staging-proven | Probe orders AK-1001, AK-1005, AK-1008 (HANDOFF B3, B4); 14 closed orders on staging, ledger 0 |
| Founder's own phone order end to end (0.13) | partial | First attempt 13 Nov failed four ways, all fixed and replayed (`test/db/live-order-b4.test.ts`); the retry from his phone is not recorded as done |
| Language pack and planner (1.22), zero wrong on replay | staging-proven | Live runs 43500022007, 43504902606; `evals/language/zero-wrong.test.ts`; a live run can still produce an unseen reading |
| Pin decides the village; house and floor asked once | staging-proven | Migration 0074; AK-1008 |
| Answers without the model, repeat last order, memory commands, off-topic line | built and test-covered | 0014, 0015, 0019; `test/db/ordering-b2.test.ts`, `evals/cases/` |
| Money and neutrality guard on model text (tool and gateway) | built and test-covered | `packages/agents/src/output-guard.ts`; `gateway.ts` `preflight()`; live refusal rate unmeasured |
| Order kept after closing, offered at opening | built and test-covered | 0087, `test/db/after-hours-k1.test.ts`; applied on staging, not seen live |
| Payment screenshot to ops queue, person confirms | built and test-covered | 0018, `payment-proof.ts`; real Whish and OMT receipts never read |
| Voice notes (Kapso transcript, limits by role) | built and test-covered | 0057, 0059, `stt.ts`; accuracy unscored (V1 waits for the 51 notes) |
| WhatsApp catalog: feed, product lists, carts | blocked (Meta steps A to C, approved pictures, feed password secret) | 0085, `catalog-feed.ts`, `test/db/catalog-k1.test.ts` |
| Customer chooses a delivery window | partial | Database and card built (0040-0041, `test/db/scheduled-orders.test.ts`); `turn.ts` does not read `list_reply` or call it; 0 plans on staging |
| Reply speed under 10 s | not started (measured only) | `turn_waits`: p50 15.9 s, p90 19.4 s; `BUFFER_SECONDS` 6 in `wrangler.jsonc`; pre-turn calls `turn.ts:63-91` |
| Search words for a new item (1.23) | built and test-covered | 0076, 0080; 0 jobs on staging: never run on a real new item |
| Basket builder ("dinner for 5 children") | not started | Brief, "A smarter Concierge" |
| Prices in LBP on request | partial | COD in LBP at the day's rate exists; no fixed answer to "how much in lira" |

### Hub, riders, money
| Capability | Status | Evidence |
| --- | --- | --- |
| Rider flow (offer, accept, pickup, deliver, collect, drop) | staging-proven with test riders | Probe riders close an order every hour; no real rider phone yet |
| Dispatch race, slot race | built and test-covered | `test/pg/dispatch-race.test.ts`, `test/pg/slot-race.test.ts` (real Postgres) |
| Picker flow, missing item, substitution, returns by button | built and test-covered | 0031-0034; pick flow off on staging (no picker registered); `offer_substitutes` false |
| Refunds, customer credit, second approval | built and test-covered | 0030, 0046, 0081; `apps/console/test/refunds.test.ts`, `approvals.test.ts` |
| Suppliers, receiving, moving average cost, margin | built and test-covered | 0024; no real receipt entered anywhere |
| Rider earnings (100% of fees and tips), LBP settlement | built and test-covered | 0009, 0010, `test/db/rider-settlement.test.ts` |
| Day close, drawer count, deposits, petty cash, expenses | built and test-covered | 0047; pages opened on staging, no action posted |
| Recall, product hold, complaint cases | built and test-covered | 0025, 0048 |
| Scheduled dispatch in time for the window | built and test-covered | 0041 |
| Warehouse: scan to pick, lots, FEFO, bins, cycle counts | not started | Receipts record an expiry date (0024); no lot, bin or scan |
| Vendor (restaurant) orders, kitchen flow, settlement | designed only | BUILD_PLAN Phase 8; `merchant-channel.ts` and the Deliverect shape exist untested |
| Vendor-operated delivery, couriers | not started | `deliveries.driver_id` only |
| Combined orders (hub plus vendors) | partial | `fulfilments` one per source, `offer_delivery` makes one pickup stop per source (0002); no fee rule, no timing, no partial failure |

### Console
| Capability | Status | Evidence |
| --- | --- | --- |
| Sign-in, roles, audit before action | staging-proven (sign-in and page loads) | Console run 43562442212; actions proven on PGlite only |
| 26 pages (today, payments, riders, exceptions, returns, refunds, catalog, fx, zones, merchants, pictures, day open/close, receiving, money, approvals, food facts, intake, cases, search words) | built and test-covered | `apps/console/test/` |
| Names review, product readiness, windows and calendar, pick queue, rider incidents | not started | HANDOFF C2, C3, brief |
| Mobile-first, installable, push | not started | Plain server pages today |
| Founder assistant, analytics dashboard | not started | |

### Product data
| Capability | Status | Evidence |
| --- | --- | --- |
| Research files loaded as proposals | staging-proven | 580 `research_loads`, 258 web-page facts, 20 proposed pictures (of 202 items with candidates: most failed the vision check or the fetch; the run summary has the reasons) |
| Approved pictures, facts, Arabic names | not started (people) | 0 approved; names still in `data/proposals/names.json` |
| Per-item intake queue (automatic, through the API) | not started | One-off scripts in `scripts/images/`, `scripts/product-data/` |
| Label scan at intake | built and test-covered | 0049; reader on staging, no real label read |

### Platform and safety
| Capability | Status | Evidence |
| --- | --- | --- |
| One door out, fail-closed outbox, dedupe keys | built and test-covered, staging-proven for the probe | `packages/wa/test/gateway-outbox.test.ts`; 0 duplicate keys on staging |
| Marketing locked twice | staging-proven | `gateway.ts` `PILOT_MARKETING_LOCK`; trigger 0012; setting read on staging |
| Permissions: no client role reaches anything | staging-proven | Query above; `scripts/check_permissions.sh` in `deploy-staging` |
| Deploy, rollback, secret rotation | staging-proven | Runs 43394134487, 43396822066, drill 43394402493 |
| Heartbeats, alarms, Sentry, latency and cost views, message meter | staging-proven | 0090-0092; no open alarm at read time |
| Queue retry path | built and test-covered | `test/db/queue-retry-a4.test.ts` |
| Utility templates in ar, en, fr | partial | 3 approved, 6 pending at Meta |
| Production environment, +961 numbers, Meta verification, PITR | blocked (company papers, numbers, paid Supabase plan) | HANDOFF E, AUDIT-2026-11-14 item 14 |
| Website, web checkout, tracking link, card payments | not started | BUILD_PLAN Phase 9 |
| Loyalty, referrals | designed only | First-contact codes stored (0056); no reward |
| Markets (expansion as data) | designed only | `markets`, `market_settings`, `setting_for` exist; functions read global settings |
| Retention job, privacy notice, outage and staff routines | not started | AUDIT-2026-11-14 item 15 |

## Section 2. Attack audit

Severity: **High** = money can be lost or misrecorded, or a customer harmed, in ordinary use. **Medium** = needs a mistake, an
outage or a second failure. **Low** = tidy-up. Sessions: `F1` (G1 fixes, Opus), `SP1` (reply speed), `W1` (windows), `A5`
(infra), `D4` (console), `M1` (messages), `A3` (production), `I1` (intake).

### Money
| # | Sev | Finding | Evidence | Fix in |
| --- | --- | --- | --- | --- |
| G1-01 | High | **A rider can record up to $1 less than the total on every cash order and nothing flags it.** The difference is posted to `cash_over_short` as "Rounding and FX difference". On a $16 basket that leaves about $2.50, a dollar is 40% of the margin | `post_cod_collection` (0052): `if abs(v_equiv - o.total_usd) > 1 then raise` | F1: tolerance from `settings.over_short` (lira-note rounding only), the rest to `rider_receivable` with a risk flag; over/short per rider on the day close |
| G1-02 | High | **The drawer can go below zero** by three roads: base `pay_supplier` (0024) and cash `pay_out_credit` (0030) called directly; `pay_rider_earnings` step 3 "the hub pays the rest" (0010); `record_damaged_note` on a hub drop (0004). The console uses the checked wrappers, the base functions stay open (brief, point 2) | Function bodies; D3's note in HANDOFF | F1: `perform drawer_can_pay()` inside the four base bodies; two fixture lines in `test/db/refunds.test.ts` and `receiving-margin.test.ts` |
| G1-03 | High | **`record_damaged_note` writes the ledger with no role check, no request key and no bound on the amount.** A double tap posts twice; a negative amount adds cash | 0004, body read in full | F1 |
| G1-04 | High | **A transfer that arrives after the 30-minute timer is lost to the books.** `run_timers` cancels `awaiting_payment` after 30 minutes; `payment_expected` then returns nothing, so the customer's screenshot is not queued; `confirm_payment` raises `ORDER_CANCELLED_REFUND_NEEDED`. The money is in Whish or OMT and no function records it | 0004 `run_timers`, 0018 `payment_expected`, 0052 `confirm_payment` | F1: a proof for an order cancelled by timeout in the last 24 hours is queued as "late payment"; the ops lead books it to customer credit (or reopens the order if stock allows) |
| G1-05 | Medium | An overpaid transfer of any size is booked to `cash_over_short`, as income, and a mistyped amount is accepted | `confirm_payment` (0052): only `UNDERPAID` is checked | F1: the surplus becomes customer credit; an amount more than 5% over the total needs the second approval |
| G1-06 | Medium | `confirm_payment`, `review_payment_proof` and `pay_rider_earnings` check the role but not `is_blocked`; the later functions do. A removed ops lead's party id still passes these three | 0052, 0018, 0010 | F1: `require_role()` (0045) everywhere a person acts |
| G1-07 | Medium | `declare_cash_drop` takes any party and any amount, including negative; `grant_customer_credit`, `apply_customer_credit`, `open_complaint` and the pick functions rely on their callers for the role | 0004, 0030, script output | F1: checks in the base functions (defence in depth; today only the server role calls them) |
| G1-08 | Medium | `pay_supplier` recognises a repeat by matching the ledger memo text, and never compares the payment with what is owed | 0024 | F1: request key; refuse above the balance unless marked as an advance |
| G1-09 | Low | The cash cap is checked at the offer on the total before picking (known, C2) | `offer_delivery` (0002) | F1: re-check at pickup |
| G1-10 | Low | Rider earnings paid when a shift is force-closed leave a `rider_receivable` with no automatic deduction (by decision 8 in DECISIONS, proposed). Recorded, not a defect | `close_shift` (0004) | Founder list (lawyer) |

What held: every ledger transaction balances (trigger `ledger_must_balance`, and staging sums to zero); refunds are capped by what
was paid and by the revenue still booked; the rider's fee is never taken back; credit on an abandoned draft returns when the draft
expires (60 minutes); double confirmation of a payment is a no-op; a reused transfer reference is refused.

### Permissions
| # | Sev | Finding | Evidence | Fix in |
| --- | --- | --- | --- | --- |
| G1-11 | Medium | **322 functions have no fixed `search_path`** (the earlier audit said 277). None is security definer, so the risk is low today; it becomes real the day one is | Advisor, 14 Nov | F1, first migration; `check_permissions.sh` fails on a new one |
| G1-12 | Medium | **One key opens everything.** All access is `service_role`: the gateway, the console, GitHub Actions and the data scripts hold the same key. The website must not be a fourth holder of it | `scripts/check_permissions.sh`; workflows | C4: a `web_channel` database role that can execute only the listed commerce functions; SYSTEM_PLAN section 1 |
| G1-13 | Medium | Staff sign-in: leaked-password protection off, no throttle of its own, built-in mail (a few an hour, organisation members only) (brief, point 6) | Advisor; HANDOFF D1 | A5 (settings, with the founder's SMTP choice) |
| G1-14 | Medium | Kapso webhook signing secrets are readable through any key with read scope; rotate before production and use a narrow production key (brief, point 5) | HANDOFF F | A3 |
| G1-15 | Low | The webhook's "right number" check is skipped when the payload carries no `phone_number_id` | `apps/gateway/src/index.ts`, the `first?.phone_number_id &&` line | A5 |
| G1-16 | Low | The console's action log names files by millisecond; two entries in one millisecond sort "done" before "intent", and the test fails (once in this session). The log is also not queryable | `apps/console/src/app.ts:175`; `sign-in.test.ts:152` | D4: a `staff_actions` table written by one function, with a sequence |
| G1-17 | Low | Media is fetched from any https host that is not Meta's (a denylist). The address comes from a signed webhook, so this needs a leaked secret first | `payment-proof.ts:33-41`, `stt.ts:81` | A5: allow only Kapso's hosts |

What held: on staging no client role can call a function or read a table; the console has no insert, update or delete
(`no-direct-writes.test.ts`); the acting party always comes from the session; CSRF, Origin and a strict content security policy are in place.

### Recovery
| # | Sev | Finding | Evidence | Fix in |
| --- | --- | --- | --- | --- |
| G1-18 | Medium | A message that went out but could not be marked sent (three failed writes) is sent again after the 60-second lease. Known and accepted as at-least-once; nothing alerts on it | `gateway.ts`, "outbox_mark_failed_after_send" is only logged | A5: Sentry event, and mark from the status webhook's message id |
| G1-19 | Medium | Reply keys are turn key plus position. A retried turn that words its replies in another order can skip a sentence (known limit) | HANDOFF, send audit | SP1: key model replies by turn and content hash |
| G1-20 | Medium | No restorable database: point-in-time recovery is off (free plan) and no restore has been tried | HANDOFF D; BUILD_PLAN 4.8 | A3, blocked on the paid plan |
| G1-21 | Low | A retried turn issues a second card and cancels the first draft (customer sees one) | HANDOFF A2 | SP1 |
| G1-22 | Low | A scheduled order whose fresh goods never arrive waits for a person; there is no "go without that line" before picking | HANDOFF C3 | W1 |

What held: inbound events are stored before anything else and retried by the queue (tested by A4); a crash mid-turn is replayed
(`test/pg/worker-e2e.test.ts`); a silent rider raises `rider_dark` (`run_timers`) and `mark_rider_off` hands the orders on with
the cash counted; the last place in a window is won by exactly one of two taps.

### Send path
| # | Sev | Finding | Evidence | Fix in |
| --- | --- | --- | --- | --- |
| G1-23 | Medium | **Service messages that staff or code start have no template**, so they fail outside the 24-hour window: what changed at the shelf, the substitute question, a delay, the kept order, a window reminder, the founder's nightly report | HANDOFF C2, D2; `can_send` returns `window_closed_use_template` | M1: one utility template per event, in ar, en, fr; submit early |
| G1-24 | Low | The typing indicator calls Kapso from `index.ts`, outside the gateway. It sends no message, so invariant 1 holds in letter; it is still a second place that talks to Kapso | `apps/gateway/src/index.ts:67` | A5: move it into `packages/wa` behind one function |
| G1-25 | Low | "Two numbers never cross" holds because conversations, consent and addresses are per line, not by an explicit check of role against line in `can_send` | 0002 `can_send` | F1: one explicit check |

What held: `kapsoSend` has one caller; a send without a key is refused by type and at run time; only an explicit `true` from
`outbox_claim` sends; an error or timeout throws and the turn retries; marketing is refused in code and by trigger, and the
trigger rejects every spelling of "on"; STOP is read before any model; templates need a transactional opt-in.

### The brief's "Points for the audit"
| Point | Result | Fix in |
| --- | --- | --- |
| 1 Diet labels from inference | **Confirmed.** `scripts/product-data/lib/facts.mjs:157` proposes vegan and vegetarian from `ingredients_analysis_tags` with basis `off_ingredient_analysis`. It stays a proposal, and `review_proposed_fact` already refuses to confirm an Open Food Facts field without our own evidence. Missing: the review page does not show the basis prominently, and nothing marks "inferred" apart from the basis string | D4: show "inferred from the ingredient list, not printed on the pack"; I1: the automatic-approval table never auto-approves diet labels |
| 2 Drawer below zero | Confirmed: G1-02 | F1 |
| 3 Nutri-Score, NOVA, eco-score, "high in" | **Pass.** No such field is fetched, stored or shown (searched every script, package and migration). The Open Food Facts credit is in each proposal's `detail` and in the feed description for its pictures | F1: a test that fails if those field names appear |
| 4 Market-sensitive web research | Pass in the data (the market is stored; a `web_page` row cannot be approved, by check constraint). Missing as an explicit rule: when a label photo and a web source disagree, the page must say so and take the label | D4 with I1 |
| 5 Kapso secrets and key scope | Open: G1-14 | A3 |
| 6 SMTP | Open: G1-13 | A5, founder decision |
| 7 Stuck hourly test order | **Fixed by B4** (`probe_due` releases the handoff and raises `probe_handoff_released`); tested, and no stuck alarm on staging at read time | none |
| 8 Catalog pictures from a public bucket | **Open.** The feed signs week-long links into the private bucket (`catalog-feed.ts`); Meta wants a stable address. Pictures are 1200 px, above the 500 by 500 minimum | A5: public bucket `catalog` holding only approved pictures, copied on approval, removed on withdrawal |
| 9 Source of every picture kept | Pass: source and page are check constraints (0050, 0070); withdrawing a picture takes effect at once | none |
| 10 Which model the extraction escalates to | **There is no escalation.** `MODEL_SMART` is never used at run time (searched `apps/`, `packages/`); it refuses the forced tool choice. A reading that fails goes to a question or a person | SP1 records this in the prompt and code comment; no second model on the hot path |
| 11 Weekly Supabase usage check | Not built | A5: a scheduled workflow that reads database size, storage and egress and fails above 70% of the plan |

Founder decisions still open, recorded and not decided: the speech provider (Kapso's, which may keep transcripts up to three
years, or another after V1 scores the 51 notes); `supabase/seed/proposed_pilot_settings.sql`.
