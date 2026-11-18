<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

### SIM1: simulated customers, 15 November 2026 (Opus 5.5)
Evals lane, branch `claude/gallant-feynman-yhrzow`, pull requests #65 (tooling, merged) and the report's. No migration; no product file changed.
Files: `evals/sim/**`, `.github/workflows/sim-test.yml`, `docs/SIM_REPORT_2026-11-15.md`, `evals/cases/sim_*.json`, this section, the SIM1 row.
- **Built and tested (CI, no key):** 500 seeded scenarios (`evals/sim/scenarios.json`: the brief's 14 categories, ar 225, Arabizi 125, en 75,
  fr 50, mixed 25; 125 voice notes at transcript level, 50 bursts; five seeds regenerate the same scripts); a GET-only copy of staging's
  catalogue and settings (no parties, chats, orders or media); the fetch guard (staging GET-only and closed after the copy, Kapso recorded and
  never called); the real conversation object, turn code, tools and gateway; per-turn checks; the budget guard; the report. `evals/sim/test`
  (36 tests) includes a whole run with stand-in models against a fake staging: GET only during the copy, nothing sent.
- **Run on main** (`sim-test` 43696512658, code `afc8f81`; smoke run 43696258577 before it): 500 conversations, **463 judged, 77 passed (16.6%)**.
  **Spend $11.40 in all** ($0.13 smoke + $11.27), against USD 33. The key behind `ANTHROPIC_API_KEY_SIM` has its own usage limit and stopped
  at that point until 1 December: the last 37 conversations and every repeat of a failing seed could not run, so how often a failure repeats is
  not measured. Staging: 32 GET requests, nothing else; Kapso: 3,372 sends recorded, none sent.
- **What held on every turn:** no order confirmed without the customer's tap, no card total unlike the database, no amount in model text that
  no tool returned, nothing sent after STOP.
- **The ten fixes, owners** (`docs/SIM_REPORT_2026-11-15.md`): (1) the minimum order said by code with its amount, one rule with the small-order
  fee (55% of conversations; ordering lane, message design); (2) no silence after a hand-off (89 of 96 handed-off customers; hand-off);
  (3) the status shortcut must not answer "no open order" while a basket is being built (ordering lane); (4) the basket changes only by what the
  customer picked (ordering lane); (5) a first order without a map pin (address 0 of 34; ordering lane, L1); (6) replies in the customer's
  language, Arabizi included (message design); (7) line length and Latin digits in model text (message design); (8) greetings and thanks are
  not off-topic (ordering lane); (9) a refused cancel gets a fixed answer, not a `button_error` hand-off (ordering lane, hand-off); (10) no
  catalogue claim without a tool result (ordering lane). Failing cases: `evals/cases/sim_<class>.json` (12 classes), not fixed here.
- **Second sample** (asked for after the report): not started. Spend is under USD 25, but the key cannot call before 1 December, so it could
  not finish by 16 Nov 20:00 UTC. Needs the key's usage limit raised (or another key as `ANTHROPIC_API_KEY_SIM`) and a seed input on `sim-test`.
- **Only a live account can prove:** everything outside the turn code: WhatsApp and Kapso, the webhook queue and burst timing, real audio, the cron
  alerting ops, and the WhatsApp catalogue (not connected on staging; the Concierge called it "not ready").
