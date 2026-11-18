<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

### HO1: the never-stranded hand-off, 15 November 2026 (Opus 5.5)
Hand-off lane, branch `claude/confident-albattani-a84wbj`, one pull request. Migrations 0135-0137 (0138 held, unused). Specification:
`docs/strategy/05-console-website-design-handoff.md` section D. Baseline (SIM1, the old behaviour): 96 hand-offs, 89 customers left
in silence, 176 messages unanswered. **The principle now in code: a person is added to a chat; the bot is never removed. A technical
failure is not a hand-off.** `conversations.human_handoff` is no longer read by the turn code, and 0135 cleared every lock.

| Item | What HO1 built | Tested by |
| --- | --- | --- |
| The case record | 0135: `handoffs` is the case (kind, topic, order, source, state open/claimed/resolved, who and when, call-back, after hours, late, outcome, complaint link); one open case per chat and kind; `support_cases` view; `conversations.bot_paused_until`; `settings.support` (3/5/15 minutes, pause 10, reminder 10, unanswered 2, credit 5/10/2). Functions `open_case`, `claim_case`, `staff_replied`, `release_pause`, `resolve_case`, `request_callback`, `case_remind`; `open_turn` also returns the pause and the open cases; `release_handoff` (0045) now ends the pause. Older rows: open ones stay open, flagged late, ladder already run (seen in the Inbox, nobody woken) | `test/db/handoff-ho1.test.ts` (21) |
| The nine lock reasons | Model unavailable, agent error: the turn is queued again once after 60 s (`RetryTurnLater`, the Durable Object), then the fixed technical line with Browse and Talk to a person and an ops exception `technical`. Did not finish: one fixed question with three buttons. Hourly cap: a fixed menu (browse, my order, a person), no model call. Button, window, substitution error: the error line with a "try again" button that repeats the tap, and a `technical` exception. "A problem with my delivery", the planner, the model's `handoff_human`, the customer asking: a case. No case is ever a lock | same file; `concierge-flow`, `no-reply-sp2`, `ordering-b2`, `ordering-b3` updated to the new behaviour |
| "I want a person" by code | `packages/agents/src/person-request.ts`, before any model: Lebanese Arabic, Arabizi, English, French; plus "chase" ("when will someone answer?", "is anyone there?") while a case is open. Cases first in `evals/cases/person_request.json` (65: the SIM1 customers' own words and invented ones, 16 must-not-match) | `evals/test/person-request.test.ts`; the four forms open a case and the bot then answers a price question |
| The customer's lines | `messages(...).support` in ar, en, fr: opened (with a call-me-back button when asked for a person), reminder (at most every 10 minutes; in between the Concierge answers, told the request is open), still on it at 5 minutes (Keep ordering, Call me back, Voice note), resumed after a quiet claim, after hours (the real opening time), resolved. A food fact the model hands off is not a case: the fixed "not confirmed in our records" line (invariant 15) | `messages.rules.test.ts` (rules and snapshots), `arabic-review.test.ts` |
| Arabic for a person | `docs/ARABIC_REVIEW.md`: every new Arabic line with its English, a column for the reader's initials. Model-written; **not read by a person yet** (gate A needs it) | the test keeps the file in step with `ar.ts` |
| Timers and the alarm | 0136 `case_timers_due()` on the gateway's minute cron, open hours only: 0 `support_case`, 3 min `support_case_unclaimed`, 5 min `support_case_founder` and "still on it" to the customer, 15 min late; a claim gone quiet for 10 minutes returns the chat to the bot (which says so) and the case to the ladder. Each step closes the previous one, so a case has one open exception; a claim or a reply closes it. `customer_unanswered()`: any customer message with no reply of any kind for 2 minutes in open hours raises a `customer_unanswered` exception once. All five kinds are in `settings.push_alerts` (high priority: pushed by D5's console cron, and on the staff line by `ops_exceptions_due`) | ladder, after-hours, alarm tests in `handoff-ho1` |
| Safe automatic credit | 0137 `auto_credit_missing_item()`: a missing line the picker recorded on a prepaid order is credited only within the three limits; over one, a refund case for a person and no money moves. `pick_remove_line` (0107's text) calls it. Every decision in `auto_credits` with the picker; `case_metrics()` counts them; the Inbox lists them per picker for the spot check | a real pick through `start_pick`/`pick_item_missing`, books balanced |
| The Inbox | `apps/console/src/pages/inbox.ts`: open cases by timer (kind, order, last message, who has it); one case shows the chat, the order and a reply drafted by code from the read-only `case_context()` (no model; edited, then sent through the gateway in one tap, which renews the pause); claim, give back, resolve with an outcome and one closing line. Today's "waiting" count and the exceptions page now read open cases; `kinds.ts` names the new exception kinds | `apps/console/test/inbox.test.ts`, `exceptions.test.ts` updated, shell check |
| The simulator | `evals/sim/driver.ts`: "after a hand-off" is now an open case (or the old lock), so a silent turn after a case is still counted; `report.ts` groups case kinds and counts the case's exception as the alert | `evals/sim/test` (36) |

Files outside the session's list, and why: `packages/agents/src/concierge-tools.ts` and `pipeline.ts` (the two places that wrote the lock),
`packages/agents/src/support.ts` and `person-request.ts` (new), `apps/gateway/src/index.ts` (the cron steps and the one-minute requeue),
`apps/console/src/pages/{index,today,exceptions}.ts` and `kinds.ts` (they read `human_handoff`), `evals/sim/{driver,report}.ts` (the
measure), the tests above. No price source, gateway allowlist, prompt or confirmation path changed.

**Not built, and why.** Push by audience (3 minutes to the ops lead only, 5 to the founder and deputy): push goes to every admin and ops
lead, as D5 built it; who gets which tier is OPS1's (roles). The model's own hand-off reason is classified by code
(`kindOfReason`); "below the minimum" and "cancel refused" are left to B1a as asked (they open an ordinary case today). The
spot-check tab for automatic credits is a section of the Inbox, not the approvals spot-check page.

**Proven here (CI, no key):** every "Done when" item of section D except the last, each with its test. **Not proven:** the
simulated-customer run (below); WhatsApp and Kapso (the buttons and the 60-second requeue on the live Durable Object); a push reaching a
phone; the Arabic read by a person; 0135-0137 on the staging database (applied only in the test database until the next deploy).

**The simulated-customer run: zero silences after a hand-off.** [`sim-test` run 43711132002](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43711132002),
limit 150, HO1's code (3637be6; the two later commits only fix a test's escaping and merge `main`), `claude-haiku-5-5` as the Concierge,
15 Nov 11:58-12:22 UTC, **$3.45** (the key's limit no longer refused calls; SIM1's follow-up ran just before). Dispatched on the branch so the result could land in this one pull request.

| | SIM1 baseline (500, old code) | HO1 (first 150) |
| --- | --- | --- |
| conversations with a hand-off | 96 (19.2%) | 27 (18.0%): person 8, complaint 8, refund 6, order problem 5, payment 2 |
| an ops alert raised for it | 94 | 27 (`support_case`) |
| **customers left in silence after a hand-off** | **89** | **0** |
| **follow-up messages with no reply** | **176** | **0** |
| person / complaint / refund scenarios passed | 0 of 42 | 2 of 16 |
| all conversations passed | 16.6% | 20.0% |

What still fails in the person scenarios is the judge's "goal not reached" (no person ever answers in a simulation) and the ordering
classes B1 owns. The one `no_reply` turn in the run (sim-103, a tap on a kept night order) had no hand-off: the class SIM1 already
reported (sim-009, sim-014), for the ordering lane. The full report is the run's `sim-results` artifact.
