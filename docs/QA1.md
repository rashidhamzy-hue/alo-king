# QA1: the whole system on staging, 17 November 2026

Session QA1 (Opus, high). Since 15 November about twenty sessions merged into each other (PD1, B1d, SR1, LB1, LD1, AR1, DS2, CFG1, SELL1,
LV1, UX2a, WEB2, UX2b, UX3). This file is the read-only audit, written before any fix, then what was fixed in the same pull request.
Every check reads **pass**, **fixed** (broken, now fixed here with a failing test first) or **open** (with the reason and who acts).

How it was done. Staging only, never a real customer's number. Orders were placed as the staging probe customer (`is_probe`, its messages
end at `can_send`'s `probe_sink` and never reach WhatsApp): a message in Kapso's own shape was stored in `wa_inbound_events` and the
gateway's minute cron delivered it exactly as a real webhook is delivered (`stale_inbound_events`), so the turn code, the outbox, the
cron and the database are the real ones; the probe riders tapped as they do every hour. The website and the console were driven by a
browser (Playwright, 390 px). The console was signed in with a QA-only staging admin (`qa1-check@example.com`, random password never
stored, blocked again at the end of the session, as the console's own smoke check does). The evidence queries are
`scripts/staging_evidence.sql`'s.

## 1. Staging itself

| Check | Result | Evidence |
| --- | --- | --- |
| Staging is at the last migration | **pass** | `schema_migrations` ends at 0234 (`join_decisions`); `deploy-staging` run 44146496785 on `main` (d26da23) green at 18:20 |
| The minute cron ran in the last hour without error | **pass** | `heartbeats.cron` beats every minute; Sentry monitor `gateway-cron-staging` status ok, last check-in 18:45 |
| Scheduled workflows | **pass** | `backup` (17 Nov, ran 09:25 for its 01:30 slot: GitHub's queue), `restore-check`, `usage-check`, `intake`: all green; none ran red in the last week |
| Sentry, last 24 hours | **pass** (two expected alarms) | Only `raiseAlarm` 06:00 (`heartbeat:inbound_silent`: nobody wrote overnight) and 09:00 (`heartbeat:probe_silent`, the probe stall below). No code error |
| The hourly probe order | **fixed** | No probe order since 16 Nov 06:52 (36 hours) and `probe_silent` open since 09:00. The probe's order text says «ربطة خبز الفورنو», which since B1c is asked «أي واحد بدك؟» with three `pick:` buttons; the probe tapped only the card and rider buttons, so it stopped there every hour. Fix: the probe taps the first product offered, as a person would (`packages/wa/src/probe.ts`; test `test/db/heartbeat.test.ts`, "answers the which-one question"). Takes effect at the next deploy of `main` |
| The `web` workflow, red on `main` since #109 (UX3's report) | **fixed** | Not a deploy fault: the Worker deploys and the pages answer. The live check `apps/web/scripts/smoke.sh` still looked for the words before LD1 ("not verified", "declared"), and since LD1 the first product of the first aisle says "Not confirmed yet". Run 44109738282: `FAIL: product page shows no fact status`. Fix: the check is `apps/web/scripts/fact-status.sh` and accepts LD1's words and every source's words; test `test/web/pages-web1.test.ts`, "the live smoke's fact-status check" (failed on `/p/AK-0020` before the fix). Green again at the next merge's `web` run |
| picomatch ignore (`osv-scanner.toml`) | **pass** | The one entry, GHSA-fc5q-39xc-vjpf, expires 2026-12-17 (held by `test/ci/osv-ignore.test.ts`). No fixed release exists on 17 Nov: the latest are 4.0.7 (24 Aug 2026) and 2.3.2, the versions installed, so there is nothing to upgrade to. The next session after 17 Dec, or the first to see a fixed picomatch, upgrades and deletes the entry |

## 2. Every page at 390 px, Arabic and English (a script, not by hand)

`scripts/qa/pages.mjs` loads each page in a fresh browser (an empty cache, so the weight is a first visit's), at 390 px, in Arabic and in
English, and records the HTTP status, any page or console error, sideways scroll, and the bytes of everything but pictures (the page, its
stylesheets, scripts and fonts). Run it again with:
`node scripts/qa/pages.mjs --web <site> --console <console>` (the console part signs in only with `QA_CONSOLE_EMAIL` and
`QA_CONSOLE_PASSWORD` in the environment).

| Site | Loads | Result |
| --- | --- | --- |
| Website: home, search, basket, checkout, sign-in, orders, account, How it works, privacy, terms, Food list, a Food place, its remove page, join as a rider, for vendors, offline, an aisle, a product (18 pages × 2 languages) | 36 | **pass**: all 200, no error, no sideways scroll; every page under 100 KB on a first visit. Heaviest: the Arabic aisle (`/c/fruits_vegetables`) 95.6 KB, the English aisle 89.5 KB; the rest 31 to 83 KB |
| Console: all 41 pages of the navigation, signed in as an admin (Today, Inbox, Orders, Pick, Rider jobs, Stock, Approve, Capture, More, Approvals, Auto approvals, Cases, Catalog, Day close, Day open, Exceptions, Food facts, FX, Intake, Label queue, Listings, Merchants, Money, Cash drops, Names, Payments, Pictures, Readiness, Receiving, Refunds, Returns, Rider incidents, Riders, Applicants, Search words, Settings, Staff, Templates, Windows, Zones, Install) | 82 | **pass**: all 200, no error, no sideways scroll, none bounced to sign-in |

## 3. One order end to end through each path

All four with the staging test customer and the probe riders, in Baakline. Each order was checked with the staging-evidence queries
(`scripts/staging_evidence.sql`): moves the order table does not allow, stock lines off, duplicated messages, the order's ledger and the whole ledger.

| Path | Order | Result | What happened |
| --- | --- | --- | --- |
| WhatsApp, typed | AK-1056 | **pass** | «بدي كرتونة مي تنورين وقهوة نجار، عبعقلين» → card ($5.26 + $1.00 fee = $6.26, 560,000 LBP) → `awaiting_confirmation` by `agent` → `confirmed` by `customer` (the tap) → offered, accepted, picked, on the road, delivered, cash $6.26 recorded → `closed` in 5 minutes. Payment-received template sent. 0 moves not allowed, 0 stock lines off, order ledger 0.00 |
| Website basket | AK-1057 | **pass** after a staging setting (below) | Two items added on `/search`, basket, checkout; sign-in by the code sent from WhatsApp («✅ تأكّد رقمك»); pin by pasted coordinates (Baakline), house and floor; cash with a $10 note → order page "Waiting for your Confirm" → the gateway's cron sent the card to WhatsApp within the minute (English, the page's language) → the WhatsApp tap confirmed it → delivered, cash recorded, `closed`. **Same lines, prices, fee, total and ledger as AK-1056** (WEB2's done-when, now on staging) |
| WhatsApp voice note (evals `vn-01`) | AK-1058 | **pass** | The note «… كيلو بطاطا وربطتين خبز وبعتلي صرافة مية دولار عبعقلين حد الفرن» as Kapso delivers it (audio with its transcript): read, «ربطتين خبز» asked «أي واحد بدك؟» (tapped the first: the count 2 kept), the $5 minimum said with the amount missing ($1.56, then $3.57 after a typed addition), then the card at $7.82 with "change for a $100 note" and the place saved on the website → confirmed → `closed`. Voice seconds recorded (`voice_usage`) |
| Order again | | **pass** (offered) | After the closed orders the chat offers "the same order as last time at today's prices" (`repeat_offer`); the website's `/orders` lists WhatsApp and website orders together (page check above). Not tapped through to a fourth order |
| Pick, dispatch, delivered, cash, ledger | all three | **pass** | Pick queue off on staging (`picking.console_queue` false): the rider confirms the pick. Dispatch offered within a minute of each confirmation; the probe riders' cash stayed under the cap. Each ledger: cash +total, goods −subtotal, fee −1.00, then the fee moved to the rider's payable (invariant 10); **whole ledger 0.00**; **0 duplicated messages** in the whole outbox |
| The handover code | | **open** | Pickup is off on staging (`pickup.enabled` false) and no order was a gift, so no order needed a code. CX1 and CFG1's tests hold it; T1 turns pickup on for the friends' test |
| The website's WhatsApp number on staging | | **fixed (staging data)** | The checkout said "Our WhatsApp address is not set yet, so signing in is not possible yet": `settings.catalog.product_link` was empty (RUNBOOK, WhatsApp catalog, step A3, never done). It also hid the Food pages' "Claim it" link (`listing_chat_link`). Set on staging from the customer line's number in Kapso, as A3 says; the number is in the database only, never in the repository. Production needs the same step (RUNBOOK) |

## 4. Rules across sessions

| Check | Result | What happened |
| --- | --- | --- |
| Two-person rules (CFG1, UX2b) | **fixed** | Asking for a two-person change on the console's Settings page (the hard cash cap, 150 → 140) failed on staging: "The database refused: VALUE_INVALID: a number is needed". Every number and every switch on that page was refused, two-person or not: the page sent `JSON.stringify(value)`, which PostgREST hands a `jsonb` parameter as a JSON string. The test kit cast the text to a number, so the tests passed. Fix: the kit passes `json`/`jsonb` arguments as PostgREST does (the seven Settings tests then failed, every other console test passed), and the page sends the value itself. The rule in SQL (`decide_approval`: `SAME_PERSON`) is unchanged and tested. The console workflow deploys a pull request's console to staging, so this was checked live before the merge: the same request now says "Waiting for a second person", the Approvals page shows the asker "waiting for someone else" with Withdraw only, and the withdrawal left the cap at $150 |
| STOP | **pass** | «STOP» answered by code with one line ("Done. We won't send you messages anymore."), no model call, transactional and marketing opt-outs recorded (`stop_keyword`). «START» answered "Offers are turned on. Thank you!" and opted in to marketing only; transactional comes back with the next confirmed card. See "Wording to look at" |
| The 20-minute reminder and a lapsed card reopened (CFG1) | **pass** (reminder); **fixed** (the Reopen button); reopen **pass** | AK-1059, made 19:17 and left unconfirmed: at 19:38 the cron sent one notice «طلبك AK-1059 بعدو ناطر تأكيدك. فيك تأكّدو أو تعدّلو من الرسالة يلي فوق.» (`customer_notices`: `confirm_reminder`, `sent:text`). (Its card itself was never sent: QA1 had paused the probe for a minute, and `can_send` refuses every send to a probe party while it is paused (`probe_disabled`). The turn opened a support case instead of going silent, as it must; the case was closed afterwards.) At 20:18 AK-1059 lapsed (`timeout:awaiting_confirmation`) and the customer was told, but **as the approved template `ak_order_cancelled_v1`, which has no button: the Reopen button reached nobody** once Meta approved that template. `sendNotice` preferred an approved template over the free message. Fixed: a reopenable notice goes as the free message with Reopen; only when the window is closed does the template go (`apps/gateway/src/index.ts`; test `test/db/cfg1.test.ts`, "2b", failed before). The Reopen tap (`order:reopen:<AK-1059>`, sent as the customer would press it) made **AK-1060**, linked (`reopened_from`), the same basket at today's prices, its card saying «رجعنا فتحنا طلبك من AK-1059، بأسعار اليوم» and needing its own Confirm |
| The label switch off (SELL1) | **pass** | `sell_requires_label` is `{"enabled": false}`; every packaged item is orderable (the orders above); the Readiness and Intake pages load (page check) |
| The Inbox (UX2a, HO1) | **fixed** | Seen while closing a test case: each case's last message read `us: {"type":"interactive","interactive":{"type":"button","body":{"text":"وصلك طلبك…` instead of the words. The same in the case's chat, an order's story and Exceptions. Fixed for all four (section 8) |
| Chouf listings (LV1): want, remove, restore, claim | **pass** | On `/food/<place>`: "I want to order from here" → "Thanks. We've noted…" and a `demand_signals` row (`web_listing`). "Remove this listing" as the owner → "Done. The page is hidden" → the page answers 404 and leaves the list. Console, Food places, Hidden and requests → "Restore the page" with a reason → "Restored: the page is back, and the request is closed" → 200 again. "Claim it" opens WhatsApp with «Claim <place>»; sent from the test customer → a `listing_claims` row with a staff case, and the fixed reply «وصلتنا رسالتك بخصوص …». Nothing about the place changed |

## 5. Search on staging

| Check | Result | What happened |
| --- | --- | --- |
| The two 15 November voice notes | **1 pass, 1 open** | "I want snacks with no sugar for 5 kids" (as a voice note): PD1's honest answer word for word ("I can't confirm the sugar for our snacks yet.", the items named No or Zero Sugar with prices) and a demand row (snacks, sugar, 5, kids). **"protein bars with no sugar": wrong.** The live reading returned no line and one restriction, so the turn took the returning-customer path: "Welcome to Alo King 👑 … the same order as last time", then «سجّلنا «no sugar» على طلبك، ولازم المطبخ يأكّد…» in Arabic to an English message, about an order that did not exist; no demand row. Written as `evals/cases/qa1_dropped_line.json`; the fix is proposed below (a reading change needs its own language gate and sim-test) |
| 10 requests from `evals/search/requests.json` | **pass** | s017 to s021, s036, s038 to s040, s065 (English, Arabic, French, Latin letters) through `web_catalog_search`, the website's and the chat's one search: **10 of 10 have the expected item in the first five** by words. With their fact filters, 9 of 10 return "none pass": right, since no food fact is approved on staging yet, so nothing unconfirmed is offered. «أكل قطط» with `species` alone returns only cat litter (fact-complete) and not the cat foods (not fact-complete); the chat's reading adds the life stages for "food" words, so the chat says nothing fits rather than offer litter. Approving the pet foods' life stage (a person, label day) makes them findable |

## 6. Not proven lines of the sessions since 15 November

Read from each session's HANDOFF section. "Proven" means seen on staging today; "open" says who or what proves it.

| Session | Line | Now |
| --- | --- | --- |
| PD1 | the two voice notes answered on staging (gate A item) | one **proven**, one **wrong** (section 5) |
| PD1 | founder actions 1 to 5 (names, facts, shelf visit, supplier sheet, claims check); the `enrich` run | open: the founder's |
| B1d | wrong products at most 8 of 150 | open (measured by T1's 150 run; this run's limit 50 is not comparable) |
| SR1 | search by meaning off (the Cloudflare token lacks Workers AI) | open: founder action (SR1) |
| SR1 | the sim-test gate (silence after a hand-off) | **proven** (LB1's run and this one: 0 of 8 hand-offs) |
| SR1, LD1, SELL1, LV1, CFG1, UX3 | Arabic, English and French lines unread | open: `docs/ARABIC_REVIEW.md` |
| LB1 | the real Batch API, real pack reading, the capture page on a real phone | open: label day (founder) |
| LD1 | the live site; Rich Results | live site **proven** (pages, JSON-LD on every product page); Rich Results test open (founder, any public address works) |
| AR1, CFG1, SELL1, LV1, UX2a, WEB2, UX2b, UX3 | "applied only in the test database until the next staging deploy" (0221 to 0234) | **proven**: staging at 0234 |
| DS2, UX2a, UX2b, UX3 | never seen on staging | **proven** at 390 px in Arabic and English by the page check (section 2); on a real phone: the founder test |
| CFG1 | the reminder reaching a phone, the Reopen button, the cron's minute | see section 4 (reminder and reopen) |
| SELL1 | nothing label-ready; turning the switch on | open: the founder's, after the label day |
| LV1 | a claim reaching a real WhatsApp | claim **proven** through the gateway on staging; a real phone in the founder test |
| UX2a | the pickup shelf form (`hub_handover`) not driven by a test | open (pickup off on staging) |
| WEB2 | no card on a real WhatsApp; "Card AK-xxxx" outside the window | card through the gateway **proven** (AK-1057); a real phone in the founder test; outside the window open |
| UX3 | a real code from a real WhatsApp | through the gateway **proven** (the sign-in code); a real phone in the founder test |
| UX3 | picomatch ignore expires 2026-12-17 | **pass** (section 1) |

## 7. The two model runs (once each, after the fixes)

| Run | What | Result | Spend |
| --- | --- | --- | --- |
| Live language gate | `language-pack`, `after`, on the branch at 468d7b1, run [44154796255](https://github.com/rashidhamzy-hue/alo-king/actions/runs/44154796255), claude-haiku-5-5, 990 cases | **holds**: wrong products **0** (precision 1.000), F1 **0.916** (SR1's run: 0.915); Lebanese Arabic 0.917, Latin letters 0.895, English 0.966, French 0.940, mixed 0.933 | **USD 0.19** (cap 5), in `model_costs` |
| Simulated customers | `sim-test`, limit 50, budget USD 2, repeats 0, on the branch at 468d7b1, run [44154789374](https://github.com/rashidhamzy-hue/alo-king/actions/runs/44154789374) | 50 run and judged, **24 passed (48%)** (LB1's run on main: 26, 52%); **0 customers left in silence** after 8 hand-offs; code-checked classes 0 except **one reply in another language** (sim-021, below); judge: goal not reached 22, repeated question 14, unnatural dialect 11, dead end 8, wrong product 6 (LB1: 12), invented fact 5. The judge moves by about eight a run on the same code (rule 12), so only the code-checked classes compare | **USD 1.05** (cap 2): Concierge 0.15, customer 0.54, judge 0.37; in `model_costs` |

sim-021 (Latin letters, at night, Botmeh): the model said twice «Ma fi tawseel la Botmeh» ("we don't deliver to Botmeh") while the code's own
line said «✅ إيه منوصّل على بطمة … $1.50», then "Not yet: we don't deliver to Botmeh, and we're closed now until 08:00." in English. The words
are the model's, not a fixed line: an invented service-area fact (invariant 7) and a language slip. For the next ordering session, with the
run's failing cases (artifact `sim-results`).

## 8. Fixed in this pull request (each with its failing test first)

| What | Where | Test |
| --- | --- | --- |
| The `web` workflow red since #109 | `apps/web/scripts/fact-status.sh`, `smoke.sh` | `test/web/pages-web1.test.ts`, "the live smoke's fact-status check" |
| The hourly probe stopped at «أي واحد بدك؟» | `packages/wa/src/probe.ts` | `test/db/heartbeat.test.ts`, "answers the which-one question" |
| Every number and switch on the Settings page refused on staging | `apps/console/src/pages/settings.ts`; `apps/console/test/kit.ts` (PostgREST's handling of `jsonb`) | `apps/console/test/ux2b-settings-page.test.ts` (7 tests failed with the faithful kit, pass with the fix) |
| The website could not sign anyone in on staging; no "Claim it" link | staging `settings.catalog.product_link` (data, RUNBOOK A3) | the website path above |
| A lapsed card's notice lost its Reopen button once the cancel template was approved | `apps/gateway/src/index.ts` (`sendNotice`) | `test/db/cfg1.test.ts`, "2b. the Reopen button with the cancel template approved" |
| The Inbox, an order's story and Exceptions showed most bot messages as raw JSON (`us: {"type":"interactive",…`): the gateway records any message that is not plain text as its WhatsApp body, 110 of 158 bot messages on staging in two days | `apps/console/src/message-words.ts`, used by `inbox.ts`, `orders.ts`, `exceptions.ts` | `apps/console/test/inbox.test.ts`, "shows a bot message with buttons, a template or a location as words" (failed in the list, the case and the order's story before the fix) |
| A check of every page, repeatable | `scripts/qa/pages.mjs` | run twice above |

No migration was needed (0235 stays free).

## 9. Open, and proposed sessions (each more than a fix here)

1. **Done by B1e, 18 November** (`docs/log/b1e.md`). **B1e, a line the reading drops** (Opus, high; `packages/agents/src/` reading and planner, `evals/`): "protein bars with no sugar" read as
   no line and one restriction (`evals/cases/qa1_dropped_line.json`). A tidy rule cannot be added safely without the turn's context
   ("I'm diabetic, no sugar please" also has no line); the turn should ask, or search the words left, when an order message has a restriction
   and no line, and never answer it with the returning-customer welcome. Same session: the restriction line («سجّلنا … على طلبك») in the
   customer's language and never "on your order" when there is none; sim-021's invented "we don't deliver to Botmeh". Done when the case
   passes live, the language gate holds and one limit-50 sim-test shows no wrong-language reply.
2. **Wording to look at** (message design, a person's read): «START» says "Offers are turned on" while marketing sends are locked off
   (invariant 17); after a claim the case ladder sends "We are still on it; a person from our team will answer you. Keep ordering, get a
   call back, or leave a voice note?" six minutes later, in English, to a vendor whose claim was answered in Arabic.
3. **A person picking and delivering on staging** (T1): the probe riders take every staging order within a minute and the pick queue is
   off (`picking.console_queue`, not on the Settings page), so nobody can pick or act for a rider by hand on staging. T1 turns the pick queue
   on and brings the rider phone.
4. **The pet foods' life stage** (data, the label day): until it is approved the chat finds no cat or dog food.
5. **`test/pg`** needs pgvector; this container's Postgres 16 has none, so those seven files run only in CI (as before).
