# Alo King Chouf: implementation baseline

Date: 12 November 2026. Planning is closed. This file is the status and the business rules.
The roadmap is `docs/BUILD_PLAN.md`. Rules the code must never break are in `CLAUDE.md`. Costs are in `docs/COST_MODEL.md`.
Everything needed is in this repository. The original Master Blueprint is not, on purpose: where any older document or
conversation disagrees with these files, these files win. `docs/history/` is superseded material.

## Business rules (founder decisions, final for now)

1. **Riders keep 100% of delivery fees and 100% of tips. No hourly wage.**
   The delivery fee is collected on the rider's behalf. It is not Alo King revenue.
   In the ledger it lands in `revenue_delivery` at payment and moves to `rider_payable:<driver>` when the order closes
   (`settle_rider_earnings`, migration 0009). `rider_statement()` shows cash held, earnings, and what to hand over.
   `settings.rider_pay` holds the shares and a `min_guarantee_per_hour_usd` (0 today) for a possible future guarantee.
2. **Only onboarded restaurants are orderable.** A restaurant needs accepted terms, an approved menu with prices, and a
   contracted commission. `approve_merchant()` is the only way to open one; a trigger keeps unapproved ones closed.
   There are no signed partners yet. The dark store is the whole launch catalog until there are.
   A customer asking for an unsigned restaurant is told it is not available yet. Nobody phones the order in.
3. **The service area and the hub are not decided.** The hub will likely be in Baakline, Baqaata or between them, possibly
   near VCC Baakline. That is a planning reference, not a confirmed property. `supabase/seed/villages.sql`, the zones and
   their fees are a draft and stay data, never code: see "Hub and zones" in `docs/BUILD_PLAN.md`.
   Final zones wait for: hub location, measured travel times, rider earnings, and later restaurant coverage.
4. **Neutral, factual, no ratings.** Alo King helps customers find available options that match a request. It never rates,
   praises or criticises a merchant or product, and never calls food healthy. Sorting is by measurable facts. The customer decides.
5. **Food facts only from approved records.** Allergens, ingredients, halal, vegetarian, vegan, fasting and nutrition are stated
   only from approved records, with their status. Unknown is never safe. Nothing is inferred about a person's religion or health.
6. **Explicit restrictions outrank everything**, including learned habits and any paid placement. Customers control what is saved.
7. **No marketing sends.** Switched off in the database. The customer number is never used for promotions. See the build plan.
8. **Small-order fee** is supported as a setting and is company income, separate from the rider's fee. Amount and threshold undecided.
9. **Restaurants:** conversations start during the pilot or earlier; nothing unsigned is orderable. The goal is all of Chouf.
10. **Website and diaspora orders** are Phase 9, after the pilot. WhatsApp-first until then.
11. **Voice notes** are welcome within configurable limits per sender role; voice never authorises money.
12. Unchanged from before: no tobacco or alcohol; nothing branded Tawfeer; Joud and Super Value stay out; COD in USD or LBP
   at the daily rate; Whish and OMT confirmed by a person; rider cash cap soft 150, hard 200; text and interactive
   messages only, never outbound audio; opt-out always wins.

## How to run

```
npm install
npx tsc --noEmit
npx vitest run          # about 1,000 tests (40 live-only skipped); apps/console/test/* drive the console's pages; test/db/* run the real migrations in PGlite;
                        # test/pg/* start a throwaway Postgres 16 (or use TEST_DATABASE_URL) and the Worker in workerd
DATABASE_URL=... scripts/check_permissions.sh    # on a scratch Postgres, and on a Supabase branch before launch
```

## Status

### Where the build stands (14 November 2026, after H1)
- **On `main`:** Phase 0 (A1), ordering B1 to B4, hub C1 to C4, console D1 to D4, infra A2, A4, A5 and A6, pictures P1 and P2, product data N1, catalog K1, audit S1, reply speed SP1, G1 fixes F1, research R1 to R4, delivery windows W1, intake I1 and the commerce core C4 (pull requests 1 to 57). Per-session records: `docs/history/HANDOFF_sessions_2026-11-13_14.md`.
- **Open pull requests at the time of writing:** M1 (message design, #54: its language-pack gate is not held; the decision it needs is in that pull request) and an A5 follow-up (#51). Nothing else waits to merge.
- **Wave order** is in `docs/BUILD_PLAN.md` ("Waves"): waves 1 and 2 are done, H1 is this hygiene pass, wave 3 is M1, I1 (merged) and C4 (merged).
- **Tests:** `npx tsc --noEmit` clean; `npx vitest run` 1,202 passed and 43 live-only skipped on 14 November (local, before H1's last edits; CI runs the suite on every pull request). `TEST_REPORT.txt` is gone: CI is the record.
- **Everything live is staging only.** Nothing has run with real customers, real money or the two +961 numbers.

### H1: repository hygiene, 14 November 2026 (Sonnet 5.5)
Done: the repository is public (founder's choice, until the build is done), so personal data came out of the tree and the cleanup followed. No behaviour changed; no migration; no secrets.
- **Personal data.** Kapso fixtures: location pins and a place name replaced by fakes, the business WhatsApp number replaced by a fake; the fixture test now also refuses any 11 or 12 digit number that is not a fake, any pin with five decimals and any plus code, and the exporter scrubs pins and place names. Tests and evals: one real customer pin and one real name replaced by fakes. The business line is no longer written in RUNBOOK, SYSTEM_BRIEF, HANDOFF or a test (it is in the Kapso dashboard). `TEST_REPORT.txt` and the one-off fixture generator deleted. Searched the whole tree for phone numbers, emails and personal names: what remains are fake test numbers (`+961 70 000 0xx` and counter-built ones), `example.com`-style addresses, companies' own published contact numbers in `docs/RESEARCH_REGISTER.md` (Whish, areeba, MontyPay), the founder's and the ops lead's first names in the documents, the Cloudflare account subdomain in staging URLs, and Meta and Kapso account identifiers (WABA and phone number ids); none is a customer or a rider.
- **Prospect list.** The three CSVs and their README were copied to the private `media` bucket under `research/prospects/` by the workflow `prospects-upload` (read back and compared byte for byte, anonymous read refused), then removed from the tree; `data/prospects/` is git-ignored.
- **Cleanup.** Merged branches deleted by the workflow `delete-merged-branches` (the git proxy of the build environment refuses `git push --delete`); dead code `buildKeyterms` and `probeLine` removed (nothing used them); `scripts/clean_prospects.py` removed with its input; dependencies updated inside their ranges (lockfile; `postgres` stays pinned at 3.4.9, 4.x is a major); finished session records moved to `docs/history/`; the AN1b row in `docs/BUILD_PLAN.md` now reads migrations 0198-0199, after AN1.
- **What remains visible in git history until the repository is private again** (history was not rewritten, on purpose): the three prospect CSVs (about 800 Google Maps business listings with their phone numbers and ratings, from the commit that added them); the customer line's number in HANDOFF, RUNBOOK, the Kapso fixtures, `scripts/fixtures/from-kapso-messages.mjs` and `test/db/heartbeat.test.ts` (first in commits 5d8316f, 622d48e, 203c83d, 27c60de); the real location pins and the plus code in the early Kapso fixtures (5d8316f); a real customer's pin and a real name in the B4 tests, the eval case, HANDOFF and SYSTEM_BRIEF (commits e2f3b10, ed3185b, f7b847e, 137fa2f, 11e38ae); and the deleted `TEST_REPORT.txt` versions. Real Lebanese customer or rider phone numbers were searched for in every revision outside the prospect files and migrations: none found. Making the repository private again hides all of this; rewriting history is a separate, deliberate step nobody has asked for.
- **Blocked or left, and why.** Remote branches that are not merged stay: `language-pack-out/*` and `product-data-out/*` (workflow outputs, never merged; four of the `language-pack-out` runs are cited by pull request #54) and the branches of the open pull requests. Files under `data/research` and `data/proposals`: see "Data files" below.


PLACEHOLDER_DATA_FILES

### Open requests carried forward

Collected by H1 from every finished session record (`docs/history/HANDOFF_sessions_2026-11-13_14.md`) and checked against later sessions: an item is here only if nothing later shows it done. "A3" is the production session; "WEB1", "WEB2", "D4b", "D5" and "M1" are in `docs/BUILD_PLAN.md`.

#### Lane A infra

- A2: build the Anthropic client in `apps/gateway/src/index.ts` with `maxRetries: 0`, because `turn.ts` retries capacity failures itself. No later section says it was done. (session B1)
- Lane A: wire `deps.stt` once the founder picks a second speech provider and its key exists (`settings.stt.second_provider`); `STT_API_KEY` is not set. (session B3; Phase 0 table)
- Lane A: let the gateway re-check only the model's words of a reply that also carries code-written prices (e.g. `authored.text`). (session B3)
- Whoever owns `package.json`: `npm run eval` points at `tsx evals/run.ts`, which cannot load the prompt's `.md` import; change it to `vitest run evals/live` with `ALO_LIVE_EVAL=1`. (session B2)
- A3 (G1-13): staff sign-in settings and SMTP for staff invitations are not done; the founder chose Resend for staff email, but no section shows it built. Until then invitation mail only reaches Supabase org members. (sessions A5, D3, R4; D1)
- A3 (G1-14): replace "narrow production key" with a separate production Kapso project and key; webhook signing secrets are readable by any read key. (session R4; F)
- A3 (G1-20): Supabase Pro with daily backups and one tried restore before real money; also still to do: a production project. (sessions R4, section D)
- A3 (4.11): correct `docs/COST_MODEL.md` (AI cost per order $0.012) against `ai_cost_daily` (probe about $0.0018 an order, upper bound). (session A4)
- A3: read Meta's policy section 4.7 and the opt-in page in full before the paid pilot; Kapso docs were only 100,000 of about 992,000 characters read, so retention and the transcription provider are unconfirmed. (session R4)
- `staging-new-product.yml` (A5's item 8, proof of search words for a new product) cannot be dispatched until it is on main; no result is recorded. (session A5)
- A5's egress reader for `usage-check.yml` reads an undocumented dashboard report defensively; a red weekly run is the signal to fix it. (session A5)
- If Kapso redirects media outside `kapso.ai`, the picture or note is refused; add the host in `packages/wa/src/media.ts` if a real message shows it. (session A5)
- Ops line safety condition: do not register a picker on staging until the hourly probe also picks (a probe picker that taps start and done), or the probe order sticks in `confirmed` and raises `probe_stuck`. (session C2)
- Test infrastructure session: build the migrated database once per CI run and restore per file (`apps/console/test/kit.ts`, `test/db/flow-kit.ts`); this is what reaches the 60% CI-minutes cut. Workflow changes alone gave about 25%. (session A6)
- Watch the next days' runs for the daily CI minute figure and a docs-only pull request, neither seen yet. (session A6)
- Kapso API shows no credit balance, so "alert below an amount" cannot be built; only the paused-sends check exists (blocked, nothing to do). (session A2)

#### Lane B ordering / agents

- Pound total on the order card and receipt should be a setting, not hard-coded either way, pending lawyer item 4; not built. (session R4)
- Known limit: the deterministic card path does not check restrictions against food facts; a stated restriction only travels on order notes. Case `sponsored-fails-restriction` needs 1.11 and 8.12. (session B2)
- Known limit: the output guard has one known false positive («أحسن تبعتلنا الموقع» read as a quality word), and food-fact unlock is per attribute group, not per product. (session B2)
- Found, not changed: `fold_text` (0003) has misaligned strings (ة to ي, ى to ا, ؤ to ه, ئ to و), so «قهوة» and «قهوه» fold apart; `catalog_tokens` works around it. (session B3)
- WEB2 (`turn.ts`): a customer message containing `ALO-` goes to `claimLinkCode` before any model; "sign out" calls `revokeWebSessions`; `confirm_on_whatsapp` sends the card to WhatsApp; token-first wrappers `locate_pin`, `save_customer_pin`, `set_place_details`, `open_delivery_windows` (0156-0157), added to the grant lists. (session C4)
- WEB1: read functions for catalog pages (0154-0155) with the same grant rule; the Worker's `web_channel` JWT secret; check `pg_has_role('authenticator','web_channel','member')` on staging. (session C4)
- Whoever next changes `turn.ts`'s catalog-cart path: mark those cards `channel = 'catalog'` (today `whatsapp`). (session C4)

#### Lane C hub

- Switch on `settings.picking.offer_substitutes` (still false) together with C2's picker tests that assume it off; B3 left it to "the next hub session". (sessions C2, B3, C3)
- Ops line (`apps/gateway/src/ops-turn.ts`): `rider_picked_up` raises `CASH_CAP hard_cap at pickup`; the rider gets a generic error. Catch it with a plain "hand in cash at the hub first" message, and catch `wrong_line`. (session F1)
- Known limit: the ops-line voice note is not copied to the `media` bucket; a person must listen in the ops number's inbox. (session C3)
- Rider-incident transfer: no "pick up from a rider" stop on the job card (goods come back to the hub). (session C2)

#### Lane D console

- Console pages for C2's items: pick queue (`pick_queue`, `pick_list`), rider incidents (`mark_rider_off`, `call_off_stranded`, `receive_rider_cash`, `riders_on_shift`), and the `count_needed` and `pick_empty` exception actions "were not built". (sessions C2, D2)
- Console action for exception kind `scheduled_day_changed` (detail: slot and its orders), and the schedule actions telling the customer; windows, calendar and slot pages are built. (session C3)
- "Go without this line" button on the `scheduled_stock_short` exception calling `drop_scheduled_line(order, product, by, reason)`, then telling the customer. Only SQL can call it today. (sessions W1, C3)
- `apps/console/src/pages/approvals.ts` : kind `payment` should read "Overpaid transfer", not "Refund". (session F1)
- `app.ts` `explain()`: plain words for `EXCEEDS_OWED`, an "advance" checkbox on the receiving pay form (`pay_supplier_checked` needs the two new args), and day-close columns for `over_short_usd`, `short_owed_usd`, `cod_flags`. (session F1)
- Console: show `orders.channel` on the orders page. (session C4)
- No page changes a catalog placement (`catalog_placements` has no editing function); readiness says "not placed" without a link. One function and one form. (session D4)
- Console could show `catalog_feed_report().not_placed`. (session K1)
- Pictures page: show the vision check's reasons (CONSOLE.md "extend"), not in D4's row. (session D4)
- Keyboard and swipe on the names page belong to the cockpit shell, D5. (session D4)
- No SQL function exists for disputing a cash drop, rejecting a menu import, or adding staff from the console (staff are added by workflow only). (session D1)
- Sign-in has no throttle of its own; only Supabase Auth's per-IP limits, which count Cloudflare's IP. (session D1)
- Console tests flake under load: each test builds its DB inside the test (add `beforeAll` with a longer timeout), `today.test.ts` measures lateness against the clock, `sign-in.test.ts` hook timeouts at 10 s. (sessions B3, B4, A6)
- `docs/CONSOLE.md` not updated for I1's page. (session I1)

#### Founder / Rasheed

- Send the 0.13 message from his own phone to the staging customer number (READY TO SEND); then any session runs the `staging-evidence` workflow. S1 notes the phone retest "is not recorded anywhere as done". (sessions A2, S1)
- 0.9 Meta ownership and verification: BLOCKED on the Meta Business Portfolio admin (steps 1 to 5, including one real click-to-WhatsApp ad click so a payload with `referral` is saved). (section E)
- 0.12 Meta billing guard: BLOCKED on the billing owner (Kapso credits or card; a few dollars of Kapso credits are needed for the staging ops line either way). Real traffic does not start before this. (section E)
- Meta and Cloudflare steps of RUNBOOK "WhatsApp catalog" A to C (password, link, catalog, hourly feed, catalog id into `settings.catalog`, sets, icon and cart). Until then `show_catalog` answers `catalog_not_ready`. (session K1)
- Add Account > Billing > Edit to the `CLOUDFLARE_API_TOKEN` secret, set repository variable `CLOUDFLARE_BILLING_EMAIL`, rerun `cloudflare-spend-limit`; until then there is no hard stop or spend alert on Cloudflare. (session A6)
- Sign in to the console once: run `console` workflow action `add-staff` for his email and set a password. The emailed link flow is not proven live. (sessions D1)
- Set `BRAVE_SEARCH_API_KEY` (adds brand-site and web image search) and take intake photographs on a plain background (5.15); Open Food Facts alone gave 2 of 291 pictures. (session P1)
- Decide each of the 282 name proposals on `/names` (loaded by D4) and have Arabic names, all model-written, read by an Arabic reader; the checks cannot tell a wrong word from a right one. (sessions N1, D4)
- Arabic-reader sample for auto-approvals: `record_arabic_reader_sample` needs 50 checked with no error before model-written Arabic can ever auto-approve. (session I1)
- Approve pictures on the console pictures page; none of the proposed pictures is approved, so the catalog feed is empty. (sessions K1, S1)
- Confirm food-fact proposals at intake against the real pack (5.15); none is approved, and no real label photo has been read. (sessions N1, D3)
- Upload the 51 voice notes to `media/voice_eval/shouf-51/` (RUNBOOK "Voice notes for the evaluation"); V1 starts when the check query answers 51. (session A4)
- Privacy notice: say Kapso transcribes voice notes through ElevenLabs, which may keep transcripts up to three years, or choose a second provider and score both on the 38 notes (5.8). (session B3)
- Set the monthly spend limit on the staging Anthropic key (console only) and use a separate key for production; confirm API web search is enabled for the organisation (I1's identity step). (sessions A1 table, I1)
- Send the written questions to Whish, areeba, MontyPay and Tap (only he can; no answers exist). Tap goes last, only to ask. (session R4)
- Windows data: the seeded Ramadan, Lent and holiday plans are labels only (`calendar_kind` null); decide whether to add kind plans on `/windows` (needed before February 2027), and correct the "expected" Islamic dates when decrees are published. Martyrs' Day and Eid office-closure days are unconfirmed. (session A6)
- GitHub plan and minutes: confirm the plan (Free 2,000 minutes, 1,671 used in two days), or choose GitHub Team (3,000 minutes, one seat), or merge fewer, larger pull requests. Sentry Team about $29 a month if two people need it. (sessions R4, A6, I1)
- Second Kapso test number is needed before two riders at once, a rider and ops lead on different phones, or testing templates on the ops line. (session A1)
- Remove the two leftover Kapso functions (`whatsapp-flow-...-data-...`) by deleting the two Flows or data endpoints in the Kapso dashboard. (session A1)
- If he prefers the card straight after the pin, drop the one-time house-and-floor question (`place_has_details` in `completePending`, one condition). (session B4)
- Confirm the decisions written down "for the founder": C2 (), C3 (757-763), D2 (524-530), F1 (961-969), D4 (997-1003), W1 (1091), I1 (1114-1119, including whether to research the 291 existing items again through the API, about $15).
- R4 records Hussein as the second approver; no section shows his staff account added (gap, not stated as a request). (session R4)

#### Lawyer / accountant

- Lawyer question 4: whether the 2019 Ministry of Economy circular on pound price display still binds shops. (session R4)
- Lawyer question 8: Open Food Facts share-alike (ODbL; attribution is stored in every proposal's `detail`). (session R4)
- Accountant: no item addressed to an accountant appears in HANDOFF.

#### Live proof needed

- Real Kapso webhook payloads captured by our own Worker (`capture-kapso-fixtures` after 0.13; also real payloads without a phone, real image payloads and whether `media_url` needs the API key). (sessions A2, B1, B2, D)
- Typing indicator, a second speech provider, a real click-to-WhatsApp ad referral payload. (session B3)
- Real ops-line buttons on a real phone (sandbox buttons never proven; no picker has used the ops line). (sessions A2, C2)
- Meta approval of nine utility templates (three Arabic, three English, three French), and rates on the first bill (4.4); the Lebanon rate cards disagree (0.0091 or 0.0105 USD), the first bill decides. (sessions A2, A4, S1)
- A4's live checks after deploy not recorded: the 12 open `heartbeat:probe_silent` cases close, the two Sentry cron monitors appear, `ai_cost_daily` fills, language-specific templates. (session A4)
- A5's live results ("Live (after the merge; results below once read)") were never written: 0115, 0116, public `catalog` bucket, seeds, usage check. (session A5)
- Scheduled windows: a tap on a real list, a card after hours, a full window. Windows now exist on staging (A6 seed) but nothing has been tried by a customer. (sessions C3, W1, A6)
- WhatsApp catalog end to end: feed fetch by Meta, `link` required or not, picture size rules, commerce settings (icon, cart) through Kapso, a real cart below the minimum, `select * from place_rechecks` on staging. (session K1)
- Money paths (late payment, overpayment approval, damaged note, drawer refusals, COD over/short) are proven on PGlite only. (session F1)
- Console actions (any form), the end-of-shift message and chat replies reaching a phone, the founder's day-close message. (sessions D1, D3, D4)
- 1.23: the fast model's search words for a real new product; no product has been added on staging. (session B4)
- Brave search request shape (never called), a person approving a picture. (session P1)
- C1's food facts, demand, receiving and recall functions on real data. (session C1)
- A real customer's ask-path turn (a line not found or ambiguous) still makes two model calls; not seen on staging. (session SP1)
- Intake pipeline: no research run, spot check or rule switch on staging; web search tool pairing `claude-haiku-5-5` with `web_search_20250305`. (session I1)
- C4: `web_channel` role grants on staging and a JWT with `role: web_channel` through PostgREST. (session C4)
- Cloudflare: load, queue retry, free-plan CPU limits against a real turn; plan not known. (section D, Phase 0 facts)
- Speed from a phone in Chouf (server side measured: p50 5.6 s on staging after SP1); speech accuracy on the hand-corrected voice notes; a shadow run with staff placing real orders reconciling to zero. (sessions SP1, section D)

#### Other

- G1-23 / M1: service messages that staff or code start have no template and fail outside the 24-hour window: what changed at the shelf, the substitute question, a delay, the founder's nightly report (21:40 Beirut). One utility template per event in ar, en, fr. (sessions C2, D2; AUDIT-G1)
- M1: move W1's texts (`CARD_TEXT` in `order-card.ts`, `ANSWER.status`) with the rest of the message design. (session W1)
- H1: `supabase/seed/proposed_pilot_settings.sql` header still says "not applied automatically" and the small-order fee "has no effect until task 1.16". (sessions B2, A5)
- `close_shift(driver)` without `p_force_by` still records no acting party. (sessions D1, D2)
- Tracking-page map for the website: Mapbox free tier (50,000 loads) or MapTiler Flex ($30), never OSM's own tile servers; choice not yet made. (session R4)

### A. Built and covered by automated tests
| Area | Where | Notes |
| --- | --- | --- |
| Schema, state machine, ledger, consent | migrations 0001-0003 | `order-machine.ts` is checked against the table in a test |
| Hardening: skipped-step taps, per-currency cash, exposure cap, timers, indexed search | 0004 | |
| Rider flow: shift, dispatch, batching, accept, pickup, arrive, deliver, collect, no-answer, prepaid confirm | 0006, `apps/gateway/src/ops-turn.ts` | Rider messages are parsed by code, no model |
| Hub flow on the ops line: pick, missing item, substitute, refunds and credit, rider offered at pick start, returns by button, rider incident | 0030-0035, `apps/gateway/src/ops-turn.ts` | Session C2 (history record); staff messages are parsed by code, no model |
| Scheduled orders: windows and a calendar as data, capacity held at the tap, cut-offs, changes, rescheduling, the rider in time for the window | 0040-0041, `packages/agents/src/order-card.ts` | Session C3 (history record); the customer side is lane B's to wire |
| Reliability: turn keys, outbox lease, inbound reconciliation, exception queue | 0007, 0008, `apps/gateway/src/index.ts` | Lease means at-least-once after a crash, by design |
| Stale-quote and address checks at confirmation | 0007 `confirm_order_checked` | |
| Returned goods after a failed delivery | 0008 `receive_return` | Chilled, frozen, fresh are written off unless cleared |
| Learning: customer memory, alias promotion, eval capture | 0007 | |
| Menu import from a link, merchant approval | 0007, 0009, `packages/agents/src/menu-fetch.ts` | A person approves every import |
| Rider earnings: fees and tips to the rider, kept from USD then LBP cash, remainder from the hub | 0009, 0010, `test/db/rider-settlement.test.ts` | Acceptance test: customer pays fully in lira, books reconcile |
| Marketing kill switch; voice-note policy (customer line); neutrality and food-facts prompt rules | 0011, `packages/core/src/voice-policy.ts`, `prompts/concierge.md` | The rules are enforced on model text by the output guard since B2 (1.10) |
| Pilot locks: the gateway refuses to send unless the outbox claim returns true; marketing cannot be switched on by a settings write | 0012, `packages/wa/src/gateway.ts`, `packages/wa/test/gateway-outbox.test.ts` | Both were real defects found in review on 12 Nov; see below |
| CI, secret and dependency scanning, staging and production Worker environments, runbook | `.github/workflows/ci.yml`, `wrangler.jsonc`, `docs/RUNBOOK.md` | Written and dry-run locally; not yet run on GitHub or Cloudflare |
| Cash message parser, job cards, merchant channel adapters | `packages/core`, `packages/agents` | |

Two defects fixed on 12 November 2026, both confirmed in the code before the fix:
- The gateway sent the message when the outbox claim returned a database error. The Concierge test's fake database had no
  `outbox_claim`, so every test send had been going out through that hole. It now throws `OutboxUnavailable` and the turn retries.
- Migration 0011 seeded the marketing switch with "do nothing on conflict", so a database that already had it on kept it on.
  0012 forces it off and a trigger rejects any write that enables it. The gateway also refuses marketing in code.

Outbound send audit, 12 November 2026. Every path that sends was read. Before the audit, five ops alerts had no key and
two reply paths sent unkeyed when a turn key was missing. Now `dedupeKey` is required by the type, the gateway refuses a send
without one, and every path has a stable key:

| Path | Key | Stable across a retry? |
| --- | --- | --- |
| Customer replies (`turn.ts`) | turn key + message index | Yes. The turn key is the sorted inbound message ids. |
| Rider replies (`ops-turn.ts`) | turn key + message index | Yes |
| Ops alerts raised inside a rider turn (cash drop, no answer, error) | turn key + alert name + recipient | Yes |
| Rider job offer | `offer:` + delivery id | Yes |
| No rider available | `norider:` + order + 5-minute bucket | Yes within the bucket; repeats by design after it |
| Offer expired, cash reminder, unpaid, exception due, returns pending, door wait | event id + time bucket + recipient | Yes within the bucket |
| Customer notices (on the way, rider waiting) | notice + order | Yes |
| Give-up alert after three failed attempts | `giveup:` + turn key | Yes |

Known limit: reply keys use the message's position in the turn. If a retried turn produces its replies in a different order,
a different sentence could be skipped as "already sent". The turn record (`begin_turn`, `finish_turn`) makes this rare; task 4.5
tests a crash in the middle of a turn. Templates do not exist yet; when 4.3 adds them, each is keyed on order + event.

### B. Built, not covered end to end (written and type-checked; no test drives them)
- Deliverect adapter: shape only. Needs a partner account.
- Market tables (`markets`, `market_settings`, `setting_for`): schema only. Functions still read global settings.

### C. Still to build
See `docs/BUILD_PLAN.md`: Phases 0 to 7 lead to a paid grocery pilot; Phase 8 is restaurants; Phase 9 is the website and diaspora
orders; later items (nutrition calculation, advertising, forecasting) each have a trigger. Scheduled orders (2.8) are built in the database and the card (C3); the customer cannot choose a window until lane B wires it.
The console exists (D1, D2, above). D1's proposed functions are migration 0045. The 1.23 review-list page can be built: B4 merged its functions (`search_word_reviews_open`, `resolve_search_word_review`).
Ordering lane: B1, B2, B3 and B4 are done (history record). 0.13: retry after B4's deploy (the flow now asks the pin, then house and floor, then sends the card). 1.22's zero-wrong gate is met on the replay of live readings (B4). K1 is done (history record): the leftovers, audit items 4 and 5, and 1.21 in code; the catalog waits on Rasheed's Meta steps (RUNBOOK) and on approved pictures.
Hub lane: C1, C2 and C3 are done (history record). Console lane: D1 and D2 are done (history record). Commerce core: C4 is done (history record); the website (WEB1, WEB2) builds on it.
Use its task numbers (0.1, 1.2, ...) for branches and pull requests.

### D. Needs a live account or real conditions (cannot be finished in code alone)
- Kapso: real webhook payloads captured by our own Worker (A2 built fixtures from real message objects and Kapso's documented envelope), typing indicator.
- Meta: approval of the nine submitted utility templates (three Arabic, A2, 4.3; three English and three French, A4); the rates on the first bill (4.4). Which messages are billed is now recorded per message from Meta's status webhooks (4.12).
- Supabase: staging project `alo-king-staging` (`lhgkvvdckwbfpdsftzqp`, eu-central-1) exists and was empty on 13 Nov; `deploy-staging` fills it (Phase 0 facts below). Still to do: turn on point-in-time recovery before real money (paid plan), and a production project.
- Cloudflare: deploy and the one-minute cron trigger are in place (Phase 0 facts below); the hourly probe order proves the cron and the Durable Object alarms doing real work on staging (A2). Still to prove: load, queue retry.
- Speed: time from message to card, measured on a phone in Chouf. The server side is measured (A4, `turn_waits`): typed text p50 15.9 s on staging, 14 Nov.
- Speech: accuracy on the hand-corrected voice notes.
- A shadow run: staff place real orders end to end, and stock, rider cash, rider earnings and the ledger reconcile to zero
  unexplained balance at day close.

### E. Meta account steps (cannot be done from code; written by session A1, 13 November 2026)

#### 0.9 Meta ownership and verification: status BLOCKED on the Meta Business Portfolio admin
What Kapso shows (read 13 Nov): WhatsApp Business Account `1086076707594153`, number (see the Kapso dashboard), display name "Alo King" (approved without review),
phone_number_id `1378974041965966`, status CONNECTED, quality rating UNKNOWN (no traffic yet), messaging limit TIER_250 (250 customers a day),
WABA review APPROVED, not an official business account. What Kapso cannot show: which Meta business portfolio owns the WABA, and whether the business is verified.
The person who is an admin of the Meta business portfolio does these, in order:
1. Open business.facebook.com, Business settings, Accounts, WhatsApp accounts, select `1086076707594153`. Read **Owned by**. It must be Alo King's own portfolio
   (the one in the company's legal name). If it names anyone else (Kapso, a personal portfolio, an earlier attempt), the number does not survive a change of provider:
   write that name in the pull request or an issue and do not start verification yet. Ownership is fixed first.
2. Business settings, Business info: legal name, address, phone, website and email exactly as they appear on the company documents.
3. Security Center, Business verification, Start verification. Have ready: the company registration certificate or commercial register extract, a document that
   proves the address (bank statement or utility bill in the company name), and the business phone or email on the same domain as the website. Submit. Record the date submitted and the status Meta shows.
4. Business settings, People: at least two admins with full control, two-factor authentication on for both. Business settings, Partners: Kapso is listed with access to the WABA; leave it.
5. Click-to-WhatsApp data: Kapso documents that the ad `referral` (source id, ad click id, headline) arrives inside the `whatsapp.message.received` payload when present.
   Proof needs one real click on an ad that opens a chat with the customer line (a test ad from Alo King's ad account, small budget, ended after one click).
   Afterwards: Kapso dashboard, WhatsApp, Data, Ads (CTWA) shows the click; run the `capture-kapso-fixtures` workflow; the saved payload must contain a `referral` object.
   If it does not, task 1.13 cannot be built as written: say so in the pull request.
Done when: step 1 names Alo King's portfolio, verification is submitted (date written here), and one payload with `referral` is saved under `test/fixtures/kapso/`.

#### 0.12 Meta billing guard: status BLOCKED on the billing owner
Since 1 October 2026 replies are billed after 1,000 free a month per number, and an account with nothing to charge stops sending when the allowance runs out.
Two ways to pay, chosen per WhatsApp Business Account and hard to change later (switching from Kapso credits to a Meta card means a new WABA and a number migration):
- **Kapso credits.** Kapso pays Meta and charges the project's credits at Meta's published USD price. You can connect with a zero balance, but once the balance is at or below zero
  Kapso pauses sends on every number in the account (reason `service_credits_exhausted`; the send API answers HTTP 402).
- **Pay Meta directly.** A card in Meta Billing Hub for the WABA. Meta controls the rules if a payment fails.
Steps, by whoever holds the billing login:
1. Kapso dashboard, project settings, the WhatsApp billing card: read which mode WABA `1086076707594153` is in and, if it is not USD, the FX margin shown. If a payment source is already attached, say which in the pull request and stop.
2. If it is **Kapso credits**: add credits. At about USD 0.07 to 0.09 of Meta fees per order (`docs/COST_MODEL.md`), USD 50 covers many times over the 100+ shadow-run orders. Write the date and amount here.
3. If it is **direct**: business.facebook.com, Billing Hub (Payments), Payment methods, add a card to WhatsApp account `1086076707594153`. Write the date and the last four digits here, never the whole number.
4. **The staging ops line uses Kapso credits whichever mode the customer line is in.** Kapso bills service messages sent from its sandbox number to the project's credits, at the recipient market's rate,
   and rejects them with HTTP 402 when the balance is too low. So even with direct billing, put a few dollars of credits on the project, or the staging ops line cannot send.
Done when: a payment source is attached to the WABA (step 2 or 3) and the project holds some credits (step 4), both with dates written here. Real traffic does not start before this is done.


### F. Standing facts from the Phase 0 live runs (the run table and the task table are in the history record)

**Things the live runs showed that the plan did not know.**
- **Rolling back across a secret change reverts the secret set.** The drill rolled back one version; that version was created in the middle of the webhook step, so it had the customer signing secret but not yet the ops one. After a rollback, check `wrangler secret list` and run `deploy-staging` with "rotate" ticked if a secret is missing.
- **The Kapso connector returns webhook signing secrets in plain text** to anything with read access to the project. They were seen once by the build session, then replaced by the drill's rotation. Anything with Kapso read scope can read them: this matters for the decision in `docs/TOOLS.md` about the Kapso plugin and key scopes.
- The Supabase CLI is pinned (3.1.0). Bump it on purpose and re-run the deploy; `latest` failed once on a rate limit and v2 and v3 differ on `db push`.

**Staging ops line.** The Kapso sandbox number (`597907523413541`) is wired as the ops line, and a webhook for it was accepted. Kapso documents that the sandbox can send interactive messages (buttons) but not templates,
and only to one registered phone. Buttons are therefore not a blocker, and **a second test number is not needed for the 0.13 demo on one phone** (the customer line and the sandbox are different
business numbers). It **is** needed before: two riders at once, a rider and an ops lead on different phones, or testing the approved templates of task 4.3 on the ops line.
Sending a button from the sandbox is not proven live: it needs a registered phone (6-character code sent to the sandbox number) and is part of 0.13. The sandbox bills service messages to Kapso credits (0.12, step 4).

**Kapso leftovers.** Two functions remain in the Kapso project (`whatsapp-flow-...-data-...`). Kapso refused to delete them: each is still referenced by a WhatsApp Flow data endpoint.
They go when those two Flows or their data endpoints are removed in the Kapso dashboard (WhatsApp, Flows). They do nothing and are not connected to the Worker.

**Connectors.** The Supabase, Cloudflare and Kapso connectors available to build sessions are write-capable and account-wide (`docs/TOOLS.md`). This session used them to read and verify only.


## The AI architecture, stated once
One conversational agent, the Concierge. Around it: narrow AI functions (vision extraction for labels, menus and receipts;
speech-to-text; later, optional summaries) and deterministic services in SQL and TypeScript (stock, dispatch, cash, settlement,
refunds, ranking, timers, alerts). "Ops Copilot", "Business Analyst" and "Food Intelligence" are names for functions and reports,
not agents. A new agent is added only when a measured job cannot be done by the Concierge, a function or code.

## The milestone that matters
A real customer sends a Lebanese WhatsApp order, gets the right card, confirms, receives the right goods, pays, and
inventory, rider cash, rider earnings and the company ledger all reconcile. Everything in C and D is ordered toward that.

## Cost model
`docs/COST_MODEL.md`. With riders on fees and tips, Alo King's income is grocery margin and contracted commission only.
Rider earnings per hour is the number to watch.
