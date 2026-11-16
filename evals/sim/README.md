# Simulated customers (SIM1)

About 500 conversations between a simulated customer and the real Concierge, each checked by code on every turn and graded by a
judge, ending in a ranked failure report (`docs/SIM_REPORT_<date>.md`) and failing cases (`evals/cases/sim_<class>.json`).
Nothing here changes product code.

## How it runs
- **Workflow:** `.github/workflows/sim-test.yml`, manual (`workflow_dispatch`), key `secrets.ANTHROPIC_API_KEY_SIM` only.
- **Database:** PGlite in the job with every migration on the ref, then a read-only copy of staging's catalogue and settings
  (`staging.ts`: products, offers, stock, search words, language pack, categories, villages, zones, travel times, delivery windows,
  settings, the exchange rate, approved food facts). Read with GET only; no parties, chats, orders or media; a column that points
  at a person is emptied; a phone-like setting is replaced by `+99900000000`.
- **The guard** (`guard.ts`) sits on `fetch`: staging is GET-only and closed after the copy; Kapso is never called (every send is
  recorded and answered with an invented id); only the model API may be reached. `test/guard.test.ts` proves it, including a whole
  run against a fake staging.
- **The turn code** is driven as `test/db/flow-kit.ts` drives it (`driver.ts`): the conversation Durable Object, the real turn
  code, tools and gateway, with the Concierge on `MODEL_FAST` from `wrangler.jsonc` behind a metered client.
- **The customer** (`customer.ts`): `MODEL_SMART` (Sonnet 5.5), one cached persona and goal per conversation. It sees only texts,
  buttons and list rows, and answers with a text, a burst, a tap, a pin or a voice note. Voice is tested at transcript level: code
  turns what the customer says into a noisy transcript in Kapso's shape. At most 12 customer turns.
- **The judge** (`judge.ts`): Sonnet 5.5, one call per conversation, JSON only. LB1: it also reads the basket the conversation held after each turn (`basket.ts`: `BASKET NOW: ...` under each reply), so a customer's own additions are not counted as the shop's wrong products.
- **Test budget** (LB1, `docs/NEXT_SESSIONS.md` rule 12): one run per session, limit 50 by default, 150 only at a gate check; `scripts/ci/sim-ceiling.mjs` refuses to start above the monthly ceiling (`settings.sim_monthly_cap_usd`).
- **Checks on every turn** (`checks.ts`, `driver.ts`): no reply; silence after a hand-off; an order confirmed without the
  customer's own tap; a card total unlike the database's; an amount in model text no tool returned; a reply in another language;
  the message rules (M1's rules test); a turn error; anything sent after STOP.
- **Budget** (`budget.ts`): each call priced from its usage and `model_prices`; the first 20 conversations calibrate the estimate;
  no new conversation above USD 27; every call refused at USD 33. Money left: each failing seed runs three more times.
- **The clock:** night scenarios run on their own database with `settings.hours.tz` moved so the database's time reads 02:xx,
  then the morning after; day scenarios run inside opening hours.

## Scenarios
`scenarios.json` is `makeScenarios()` (`scenarios.ts`), seeded; `test/scenarios.test.ts` checks the file equals the generator's
output and that seeds regenerate the same scripts. Regenerate after changing the generator:
`SIM_WRITE_SCENARIOS=1 npx vitest run evals/sim/test/scenarios.test.ts`.

## Locally
A dry run with stand-in models and the repository seeds (no key, no network):
```
ALO_SIM=1 SIM_MOCK=1 SIM_LIMIT=12 SIM_OUT=/tmp/sim npx vitest run evals/sim/sim.live.test.ts --silent=false
```
