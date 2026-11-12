# Start here (for Rashid)

This folder is the whole project: code, database, tests, plan and rules. It replaces every earlier file and the earlier
attempt. Nothing else is needed to start.

## Read in this order
1. This page.
2. `CLAUDE.md`: the 21 rules that may not be broken. Claude Code reads it automatically.
3. `docs/HANDOFF.md`: what is built, what is only tested, what needs a live account.
4. `docs/BUILD_PLAN.md`: every task, and the "Build sessions" table that says what to run, in what order, on which model.
5. `docs/DECISIONS.md`: founder decisions, and the ones still waiting for his yes.
Then as needed: `docs/RUNBOOK.md`, `docs/TOOLS.md`, `docs/COST_MODEL.md`.

## Starting clean from the earlier attempt
Keep the accounts. Retire what was built in them. Do not reuse old tables, old Workers or old code.

| Account | Keep | Retire | Then |
| --- | --- | --- | --- |
| GitHub | The organisation | The old repository: archive it, do not delete it yet | New private repository from this folder. Protect `main`. |
| Supabase | The organisation | The old project: pause it. Delete it once the new staging has passed task 0.13 | A NEW project for staging. Do not drop tables in the old one and reuse it: old grants, policies and extensions would survive. |
| Cloudflare | The account, Workers Paid | Old Workers, queues and Durable Object namespaces | `wrangler deploy --env staging` creates the new ones with the names in `wrangler.jsonc`. |
| Kapso | The account and the US test number | Old webhooks, old flows and automations, and any marketing template | Point the test number's webhook at the new staging Worker. It becomes the staging customer line. A second test number is needed for the staging ops line. |
| WhatsApp templates | Utility templates that match task 4.3 (order cancelled, rider at the door, payment received) | Every marketing template. Marketing is locked off for the pilot | Re-check the wording of the kept ones against 4.3. |
| Sentry | The organisation | The old project's DSN | A new project; scrub message text and phone numbers before sending. |
| Anthropic | The account | Old keys | One new key per environment, each with a monthly limit. |

Rotate every secret the earlier attempt used: Supabase service key, Kapso API key and webhook secrets, Anthropic key,
Sentry token. Treat anything that was ever in the old repository or the old database as leaked.

The old catalog, menu and tables are not migrated. The catalog in `supabase/seed/` (291 items) is the source.

## Day one, by hand (about an hour)
```
unzip alo-king-scaffold.zip && cd alo-king
git init -b main && git add -A && git commit -m "Baseline scaffold, 12 November 2026"
npm ci
npx tsc --noEmit        # clean
npx vitest run          # 96 pass
gh repo create <org>/alo-king --private --source . --push
```
Open the Actions tab. Four jobs must go green: test, permissions-check, secrets-and-dependencies, pilot-locks.
If one is red, fix that before anything else. CI has never run on GitHub; the same checks pass locally.

## Then the sessions
Open `docs/BUILD_PLAN.md` at "Build sessions". Start session A1 (Sonnet). As soon as CI is green, start B1 and C1 (both Opus)
in their own worktrees beside it. The table says what each owns. Three sessions at once is the limit.

The first proof is task 0.13: a real WhatsApp order on staging, with `scripts/staging_evidence.sql` showing that the order
states, the stock and the ledger are all correct. Save the output under `docs/evidence/` and send it to Hussein.

## Never, on any environment, until Hussein says so in writing
- Connect the two +961 numbers or send to a real customer.
- Turn on marketing, or remove either marketing lock.
- Take or move real money.
- Message a business from `data/prospects/`.
- Create a paid Google Cloud resource.

## Secrets
Never in the repository, never in a chat, never in a Claude Code prompt. `wrangler secret put NAME --env staging`.
The names are at the bottom of `wrangler.jsonc`.
