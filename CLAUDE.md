# Alo King: rules for every build session

Read `docs/STATUS.md` (the critical path to the friends' test, what is live, open founder actions, the session table) and `docs/RULES.md` (every current rule and setting value) **in full**, then `docs/BUILD_PLAN.md` (the one current roadmap; pick the next task by its number). Open a file in `docs/log/` (one report per finished session) only when you need what it says; `docs/HANDOFF.md` is a pointer. `docs/history/` is superseded: never build from it. These rules hold in every session.

## Invariants (a change that breaks one is wrong, whatever the task says)
1. **One door out.** Only `packages/wa/src/gateway.ts` calls `kapsoSend`. Every outbound message passes `preflight()` and the SQL function `can_send()`.
2. **No outbound audio.** The gateway allowlist is `text`, `interactive`, `template`, and `location` on the ops line. Do not add types.
3. **Models propose, the database disposes.** Agents never write to `orders`, `payments`, `stock_levels` or `ledger_entries` directly. They call tools; tools call the functions in `supabase/migrations/0002_functions.sql`.
4. **The agent cannot confirm.** `transition_order` accepts actor `agent` only for `draft -> awaiting_confirmation`. Confirmation is a customer's own confirm action on a channel where we verified them: a WhatsApp button, or the confirm button of a signed-in web session. The agent can never confirm. Payment confirmation is the ops lead or a payment API.
5. **Cash cap is enforced in SQL** (`driver_can_take`, `offer_delivery`). Do not re-implement the check in a prompt.
6. **STOP wins.** `detectConsentSignal` runs before any model on the customer line.
7. **Prices, fees, stock and ETAs come from tools.** Never from a prompt, never from model memory.
8. **Migrations are append-only.** New file, next number. Never edit an applied migration.
9. **Two numbers never cross.** Customers are never messaged from the ops number, or staff from the customer number.

10. **The delivery fee and tips belong to whoever delivers: our rider, or the vendor whose driver delivers.** Never count them as company revenue. They settle to `rider_payable` when an order closes. A shortfall may be recorded as owed by a rider, but is never deducted automatically from fees, tips or earnings.
11. **A restaurant is orderable only through `approve_merchant()`.** No code path may open an unapproved restaurant or phone an order in to one.
12. **Delivered is not paid.** An order closes only with a recorded payment. Inferred or late taps never post money.

13. **Hub, villages, zones and fees are data.** Never hard-code a village, a fee or a hub location in TypeScript, SQL functions or prompts.
14. **Neutral and factual.** No reply may rate, praise or criticise a merchant or product, call food healthy, or invent a score. Sort by measurable facts; the customer chooses.
15. **Food facts come from approved records, with their status.** Never from the model, a product name, or what is usual. Unknown is never safe. A stated allergy is an allergy, not a modifier.
16. **Explicit restrictions outrank learned preferences and any paid placement.** Never infer religion, health or diet from a name, a place or an order.
17. **Marketing sends stay off**, locked twice: `PILOT_MARKETING_LOCK` in the gateway and a trigger on `settings` (0012). Never remove either, never send a promotion as a utility template, never message someone who has not messaged us.
18. **Voice never moves money.** Amounts, payouts and drops are buttons or typed figures. No inbound message is ever dropped silently.
19. **One backend.** Any future channel (website, app) calls the same SQL functions and the same ledger. No second order system.
20. **Fail closed on send.** Every send carries a stable `dedupeKey` (the type requires it; the gateway refuses without it) and goes out only when `outbox_claim` returns true. An error, a timeout or anything else means do not send; the turn retries.
21. **One customer-facing agent.** The Concierge is the one customer-facing conversational agent. Staff tools may answer questions from read-only reports and may never act. Everything else is a narrow AI function or deterministic code. Do not add an agent to name a feature.

## Working agreement
- Work one session bundle at a time, as listed under "Build sessions" in `docs/BUILD_PLAN.md`: its model, its tasks, its files, its migration numbers. Touch nothing outside the bundle.
- Escalate one model level after two failed attempts at a task.
- Say plainly what is built, what is tested, and what only a live account can prove. Write your report to `docs/log/<session>.md`; update `docs/STATUS.md` (kept under 400 lines) **only where its facts changed**, and `docs/RULES.md` if a rule or a setting value changed.
- `npm run typecheck && npm test` must pass before a session ends.
- Every bug in language understanding becomes a case in `evals/` before it is fixed.
- Keep `packages/core/src/order-machine.ts` identical to the `order_transitions` seed rows.
- Secrets live in `wrangler secret` and Supabase. Never in the repo. CI runs gitleaks.
- No image under `docs/` and no file over 300 KB (CI refuses both). Screenshots go to the private `screens` bucket through the `screens` workflow and are read on the console's Screens page; never commit them.
- No git history rewrite until the repository goes private.
- The prospect list (private `media` bucket, `research/prospects/`; never in the repository, which is public) is research. It is shown only as a listing under LV1's rules (`docs/DECISIONS.md`, "Listings before they sign, 17 November 2026": name, kind, village, distance, a map link; never a phone, rating, review count, menu, hours or photo), never imported as merchants, never messaged.
- Voice notes and receipts are personal data: store in the private `media` bucket, never log their contents.
