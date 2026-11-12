# Runbook: deploy, roll back, recover

Status: written 12 November 2026 from the code. Nothing here has been run on live accounts yet; each step is marked proven
when it has been done once on staging (build plan Phase 0 and Phase 4).

## Environments
| | Staging | Production |
| --- | --- | --- |
| Supabase | its own project (or a branch of production once production exists) | its own project, point-in-time recovery on |
| Cloudflare | Worker `alo-king-gateway-staging`, queue `ak-inbound-staging` | Worker `alo-king-gateway`, queue `ak-inbound` |
| Kapso | test numbers | the two +961 numbers |
| Anthropic | key with a low monthly limit | key with its own limit |

No key is shared between the two. Staging never holds a production secret.

## Secrets
All secrets are set with `wrangler secret put <NAME> --env <staging|production>`. The list is at the bottom of `wrangler.jsonc`.
`.dev.vars` is for a developer's own machine and is git-ignored. CI runs gitleaks on every push.
If a secret leaks: rotate it at the provider first, then `wrangler secret put`, then check provider logs for use.

## Deploy
1. Pull request green: typecheck, tests, permission check, secret scan, dependency scan.
2. Database first: `supabase db push` to staging. Migrations are append-only, so a new Worker never needs an old schema.
3. `wrangler deploy --env staging`. Send the staging test order. Check the card arrives and the ledger sums to zero.
4. Same two steps for production, in the same order, in a quiet hour. Watch `ops_exceptions` and Worker errors for 15 minutes.

## Roll back
- Worker: `wrangler rollback --env production` returns to the previous version in seconds. Do this first, ask questions after.
- Database: never drop or edit an applied migration. Write a new migration that undoes the change. If data was damaged, use
  point-in-time recovery to a new project, compare, and repair forward.

## When something is down
| What failed | What the system does | What a person does |
| --- | --- | --- |
| Database unreachable | The gateway refuses to send (outbox claim fails closed). Inbound webhooks are stored by the queue and retried. | Check Supabase status. Orders by phone on paper; enter them afterwards (build plan 4.9). |
| Kapso or Meta down | Sends fail, the outbox row is marked failed, the turn retries up to 3 times, then an ops exception opens. | Tell riders by phone. Do not resend by hand from another number. |
| Anthropic down | The turn fails and retries; after 3 tries the customer is handed to a person. | Ops answers from the Kapso inbox. |
| Cron silent | Timers, waiting orders and unpaid deliveries are not chased. | Heartbeat alert (4.10). Redeploy. |
| A message was sent twice | Should not happen: one claim per dedupe key. | Find the `wa_outbox` rows for the order, open an issue with both rows. |

## Recovery drill (before the paid pilot)
Restore production to a new project from point-in-time recovery, run `scripts/check_permissions.sh` against it, and compare
the ledger total. Record how long it took. Build plan task 4.8.

## What must never be done to fix an incident
Turn on marketing. Send from the ops number to a customer. Edit a ledger row. Mark an order paid without the payment.
Give a rider's cash figure from memory. Each has a database rule that will refuse it; do not work around the rule.
