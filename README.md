# Alo King Chouf

A WhatsApp-first dark store and delivery network for the Chouf, Lebanon. Customers order in Lebanese Arabic, Arabizi or
voice notes; language models read the message, the database decides everything else.

**Status (12 November 2026):** planning is closed; implementation starts at Phase 0. The database layer and the rider flow
are built and tested. Nothing has run against a live WhatsApp, Supabase or Cloudflare account yet. Not launch-ready.

## Read in this order
| File | What it is |
| --- | --- |
| `CLAUDE.md` | Rules that hold in every session |
| `docs/HANDOFF.md` | Business rules and status: built and tested, built but untested, needs a live account |
| `docs/BUILD_PLAN.md` | The one current roadmap: Phases 0-7 to a paid grocery pilot, Phase 8 restaurants |
| `docs/COST_MODEL.md` | Cost assumptions and results |
| `TEST_REPORT.txt` | Captured test run for this tree |
| `docs/history/` | Superseded material. Not current. |

## Layout
```
apps/gateway/            Cloudflare Worker: Kapso webhooks, conversation object, cron, customer turn, rider turn
packages/wa/             Kapso contract and client; the gateway that is the only door out
packages/core/           State-machine mirror, cash rules, cash-message parser, dispatch scoring, merchant channels
packages/agents/         Concierge, prompts, order card, rider job cards, menu import, speech checks
supabase/migrations/     0001-0011: schema, rules, rider flow, reliability, learning, founder decisions
supabase/seed/           Catalog (291 items), aliases, draft villages and zones, estimated travel times
test/db/                 Tests that run the real migrations in an in-process Postgres (PGlite)
scripts/                 Alias enrichment, village coordinates, travel times, permission check
templates/               WhatsApp templates to submit to Meta
evals/                   Voice-note evaluation harness
```

## Run
```
npm install
npx tsc --noEmit
npx vitest run
```
Database on a real Postgres or Supabase branch:
```
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
psql "$DATABASE_URL" -f supabase/seed/load_catalog.sql -f supabase/seed/load_aliases.sql -f supabase/seed/villages.sql -f supabase/seed/travel_times_estimate.sql
DATABASE_URL=... scripts/check_permissions.sh     # scratch database only: it creates roles
```
Deploy (`wrangler deploy`) is Phase 0 of the build plan.

## Added 12 November 2026 (final handoff)
- `docs/RUNBOOK.md`: deploy, roll back, recover.
- `docs/TOOLS.md`: which developer tools and open-source libraries are used, deferred or rejected.
- `.github/workflows/ci.yml`: typecheck, tests, permission check, secret scan, dependency scan.
- `supabase/migrations/0012_pilot_locks.sql`: marketing locked off; outbox lease always has a value.
- `data/prospects/`: the founder's Chouf business list, original and cleaned. Research only; see its README.

## New here?
Open `START_HERE.md`.
