<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

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
- Supabase egress is not read by `usage-check.yml`: the dashboard's usage report refuses the Supabase access token (HTTP 401) and the documented API has no figure. The weekly run says "left off"; read egress by hand (dashboard, Organization, Usage) until a way exists. (session A5)
- `CATALOG_FEED_PASSWORD` is not a repository secret yet (the Worker keeps the value set in Cloudflare; `deploy-staging` only sets it when the secret exists), and `SUPABASE_PLAN` is not a repository variable (the usage check assumes the free plan until it is). (session A5)
- If Kapso redirects media outside `kapso.ai`, the picture or note is refused; add the host in `packages/wa/src/media.ts` if a real message shows it. (session A5)
- Ops line safety condition: do not register a picker on staging until the hourly probe also picks (a probe picker that taps start and done), or the probe order sticks in `confirmed` and raises `probe_stuck`. (session C2)
- Test infrastructure session: build the migrated database once per CI run and restore per file (`apps/console/test/kit.ts`, `test/db/flow-kit.ts`); this is what reaches the 60% CI-minutes cut. Workflow changes alone gave about 25%. (session A6)
- Watch the next days' runs for the daily CI minute figure and a docs-only pull request, neither seen yet. (session A6)
- Kapso API shows no credit balance, so "alert below an amount" cannot be built; only the paused-sends check exists (blocked, nothing to do). (session A2)

#### Lane B ordering / agents

- **Lane B (open; found by M1's gate run 43675197868, main's code):** (a) a size-only reading line becomes a product: g0752 «baddi zet Lina 3abbed shams, l 2annine l z8ire 0.85» read as «zet Lina» / «3abbed shams» / «l 2annine l z8ire», and the planner (`plan_order_core_0078`, unchanged by M1) matched the third line to AK-0121 (7Up 330 ml); add the reading to `evals/language/zero-wrong.json` when fixing. (b) The reading judges «شو بتحب تطبخ اليوم؟ بدي أغراض لمجدرة» off-topic in 3 of the last 4 language-pack runs (`evals/cases/off_topic`, live "stay on the job"). (session M1)
- **SP2 (fixed in #63, see "SP2: no-reply turns" above; found by M1, coordinator 15 Nov): the ask loop could end a turn with no reply**, which hands the customer to a person with nothing sent. Two causes in `packages/agents/src/concierge.ts`: a step stops at `max_tokens` (1024, `request()`) with no text and no tool call; or the model calls `extract_order`, `runAskLoop` answers «the reading for this turn is already recorded; it is in `reading`» (while `reading` can be null), and the model ends the turn, sometimes writing «I'll reply once I've checked the catalog» outside a tool. Seen in 5 live cases over 4 language-pack runs (43642090610, 43644483826, 43649220096, 43657020370; `evals/live` `steps` trace). Likely fix: answer `extract_order` in the ask loop with "answer now through reply", and retry once (or raise the cap) when a step stops at `max_tokens` with no tool call. Recorded case: `sesame-allergy-no-reply` in `evals/cases/live_wording_attempts.json`. (session M1)
- Pound total on the order card and receipt should be a setting, not hard-coded either way, pending lawyer item 4; not built. (session R4)
- Known limit: the deterministic card path does not check restrictions against food facts; a stated restriction only travels on order notes. Case `sponsored-fails-restriction` needs 1.11 and 8.12. (session B2)
- Known limit: the output guard has one known false positive («أحسن تبعتلنا الموقع» read as a quality word), and food-fact unlock is per attribute group, not per product. (session B2)
- Found, not changed: `fold_text` (0003) has misaligned strings (ة to ي, ى to ا, ؤ to ه, ئ to و), so «قهوة» and «قهوه» fold apart; `catalog_tokens` works around it. (session B3)
- WEB2 (`turn.ts`): a customer message containing `ALO-` goes to `claimLinkCode` before any model; "sign out" calls `revokeWebSessions`; `confirm_on_whatsapp` sends the card to WhatsApp; token-first wrappers `locate_pin`, `save_customer_pin`, `set_place_details`, `open_delivery_windows` (0156-0157), added to the grant lists. (session C4)
- WEB1 (done and live on staging, pull requests #60 and #62): see "WEB1" above. Still open: a Cloudflare rate-limiting rule on `/search` and the cart routes; the domain; the lawyer's privacy and terms text; Arabic and French wording read by a person. (session WEB1)
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
- No page changes a catalog placement (`catalog_placements` has no editing function); readiness says "not placed" without a link. One function and one form. (session D4)
- Console could show `catalog_feed_report().not_placed`. (session K1)
- Pictures page: show the vision check's reasons (CONSOLE.md "extend"), not in D4's row. (session D4)
- Names page: keys and "Approve all shown" are built (D5); swipe was left out on purpose (see D5).
- No SQL function exists for disputing a cash drop, rejecting a menu import, or adding staff from the console (staff are added by workflow only). (session D1)
- Sign-in has no throttle of its own; only Supabase Auth's per-IP limits, which count Cloudflare's IP. (session D1)
- Console tests flake under load: each test builds its DB inside the test (add `beforeAll` with a longer timeout), `today.test.ts` measures lateness against the clock, `sign-in.test.ts` hook timeouts at 10 s. (sessions B3, B4, A6)
- `docs/CONSOLE.md` not updated for I1's page. (session I1)

#### Founder / Rasheed

- Rotate the three Kapso webhook signing secrets once before the pilot (and after anyone who might have seen one leaves). It is one click and no code: Actions, `deploy-staging`, Run workflow, branch `main`, tick "Make new Kapso webhook signing secrets". It is a switch on the whole deploy workflow, so the run also applies migrations and redeploys the Worker from `main`: pick a quiet hour. Check the run summary for three lines, "webhook ready ... signed test event accepted" (customer, ops, project). Steps and failure handling: `docs/RUNBOOK.md` "Rotating the webhook signing secrets". Nothing is known to have leaked; no session has run it, because it is a deploy. (session PUB1)
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
- A5: the public `catalog` bucket holds no picture yet (nothing is approved); the first approval on the pictures page is the first copy and the first real proof of `syncCatalogPictures`. `outbox_mark_from_status` (0116) and the Kapso media redirect need a real message. (session A5)
- Scheduled windows: a tap on a real list, a card after hours, a full window. Windows now exist on staging (A6 seed) but nothing has been tried by a customer. (sessions C3, W1, A6)
- WhatsApp catalog end to end: feed fetch by Meta, `link` required or not, picture size rules, commerce settings (icon, cart) through Kapso, a real cart below the minimum, `select * from place_rechecks` on staging. (session K1)
- Money paths (late payment, overpayment approval, damaged note, drawer refusals, COD over/short) are proven on PGlite only. (session F1)
- Console actions (any form), the end-of-shift message and chat replies reaching a phone, the founder's day-close message. (sessions D1, D3, D4)
- 1.23: proven on staging 14 Nov with one test product (see "A5: infra, live results"); a real new product from the founder is still unseen. (sessions B4, A5)
- Brave search request shape (never called), a person approving a picture. (session P1)
- C1's food facts, demand, receiving and recall functions on real data. (session C1)
- A real customer's ask-path turn (a line not found or ambiguous) still makes two model calls; not seen on staging. (session SP1)
- Intake pipeline: no research run, spot check or rule switch on staging; web search tool pairing `claude-haiku-5-5` with `web_search_20250305`. (session I1)
- C4: `web_channel` role grants on staging and a JWT with `role: web_channel` through PostgREST. (session C4)
- Cloudflare: load, queue retry, free-plan CPU limits against a real turn; plan not known. (section D, Phase 0 facts)
- Speed from a phone in Chouf (server side measured: p50 5.6 s on staging after SP1); speech accuracy on the hand-corrected voice notes; a shadow run with staff placing real orders reconciling to zero. (sessions SP1, section D)

#### Other

- G1-23 / M1 (**built in #54, not merged**; the nightly report is left for the ops number, see "Session M1"): service messages that staff or code start have no template and fail outside the 24-hour window: what changed at the shelf, the substitute question, a delay, the founder's nightly report (21:40 Beirut). One utility template per event in ar, en, fr. (sessions C2, D2; AUDIT-G1)
- M1 (**built in #54, not merged**): move W1's texts (`CARD_TEXT` in `order-card.ts`, `ANSWER.status`) with the rest of the message design. (session W1)
- H1: `supabase/seed/proposed_pilot_settings.sql` header still says "not applied automatically" and the small-order fee "has no effect until task 1.16". (sessions B2, A5)
- `close_shift(driver)` without `p_force_by` still records no acting party. (sessions D1, D2)
- Tracking-page map for the website: Mapbox free tier (50,000 loads) or MapTiler Flex ($30), never OSM's own tile servers; choice not yet made. (session R4)
