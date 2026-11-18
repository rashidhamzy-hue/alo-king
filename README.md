# Alo King Chouf

A WhatsApp-first dark store and delivery network for the Chouf, Lebanon. Customers order in Lebanese Arabic, Arabizi or voice notes (or on the
website); language models read the message, the database decides everything else.

**Status (18 November 2026):** everything runs on **staging only** (Supabase, three Cloudflare Workers, Kapso's US test number). Nothing has run with
real customers, real money or the two +961 numbers. The code for the friends' test is built; what blocks it now is approvals, the label day and
stock. The path, with owners and exact clicks, is the first table of `docs/STATUS.md`.

## Read in this order
| File | What it is |
| --- | --- |
| `CLAUDE.md` | The 21 invariants and the working agreement; they hold in every session |
| `docs/STATUS.md` | The critical path to the friends' test, what is live on staging, open founder actions, the session table, migration numbers |
| `docs/RULES.md` | Every current rule and setting value, with the decision that set it |
| `docs/BUILD_PLAN.md` | The roadmap by phase and task number, and the sessions still open |
| `docs/NEXT_SESSIONS.md` | Session rules, gates A, B and C, prompts for the sessions still to run |
| `docs/DECISIONS.md` | The founder's and coordinator's decisions, newest last |
| `docs/log/` | One report per finished session. Open one only when you need it |
| `docs/history/` | Superseded material. Never build from it |

## Layout
```
apps/gateway/            Cloudflare Worker: Kapso webhooks, conversation object, cron, customer turn, ops-line turn
apps/console/            The staff console (a Worker; HTML pages, no framework): orders, pick, dispatch, approvals, stock, money, settings, screens
apps/web/                The customer website (Astro on a Worker): catalogue, search, basket, checkout, order page, account, Food listings
packages/wa/             Kapso contract and client; the gateway that is the only door out
packages/core/           State-machine mirror, cash rules, parsers, dispatch scoring, screenshot-name rules
packages/agents/         The Concierge, prompts, order card, fixed messages, reading and planning
packages/commerce/       The one commerce core every channel calls
packages/search/         Search by words and, when switched on, by meaning
packages/ui/             The design system: tokens (the one palette), components, fonts; HTML functions for the console, Astro components for the website
supabase/migrations/     0001-0240: schema, rules, functions (append-only; the next is 0241)
supabase/seed/           Catalogue (291 items), aliases, villages and zones, delivery windows, the Chouf listings
test/ , apps/*/test      Tests: the real migrations in PGlite, the console's pages, the website, CI rules; test/pg runs a real Postgres
scripts/                 CI checks, label and image tools, screenshots (scripts/screens), staging helpers
evals/                   Language gate, simulated customers, search evaluation
templates/               WhatsApp templates submitted to Meta
```

## Run
```
npm ci
npm run typecheck && npm test
```
`npm test` needs Postgres 16 with pgvector for the seven `test/pg` files (or set `TEST_DATABASE_URL`); the rest run in-process.
Database on a real Postgres or a Supabase branch:
```
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
DATABASE_URL=... scripts/check_permissions.sh     # scratch database only: it creates roles
```
Deploys run from GitHub Actions (`deploy-staging` after a merge to `main`; `console`, `web`). Never from a branch. `docs/RUNBOOK.md` has the steps.

## Not in the repository
Screenshots (the private Supabase bucket `screens`; the console's **Screens** page lists them), the Chouf prospect list with phones and ratings
(private `media` bucket, `research/prospects/`), voice notes and receipts, and every secret.
