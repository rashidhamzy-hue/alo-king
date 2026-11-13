# Runbook: deploy, roll back, recover

Status: written 12 November 2026, revised 13 November 2026 (session A1) around the `deploy-staging` workflow. A step is marked
**proven** only when it has run on staging and the run is named in the table "Proven on staging" at the bottom. Production
steps stay unproven until Phase 4 (task 4.2).

## Environments
| | Staging | Production |
| --- | --- | --- |
| Supabase | project `alo-king-staging`, ref `lhgkvvdckwbfpdsftzqp`, eu-central-1 | its own project, point-in-time recovery on |
| Cloudflare | Worker `alo-king-gateway-staging`, queues `ak-inbound-staging` and `-dlq` | Worker `alo-king-gateway`, queue `ak-inbound` |
| Kapso | customer line: +1 203 660 2328 (phone_number_id 1378974041965966); ops line: the Kapso sandbox (597907523413541) | the two +961 numbers |
| Sentry | project `alo-king-gateway` (org google-nfc-card-dl, EU) | its own project at 4.2 |
| Anthropic | key with a low monthly limit | key with its own limit |

No key is shared between the two. Staging never holds a production secret.

## Secrets
Staging secrets are set by the `deploy-staging` workflow from GitHub repository secrets (`wrangler secret bulk`); nobody types them
into a terminal. The names are at the bottom of `wrangler.jsonc`. Production secrets will be set the same way by its own workflow (4.2).
`.dev.vars` is for a developer's own machine and is git-ignored. CI runs gitleaks on every push.

**The webhook signing secrets** (`KAPSO_WEBHOOK_SECRET_CUSTOMER`, `KAPSO_WEBHOOK_SECRET_OPS`) are not repository secrets. The workflow
makes them from the system random source, stores them only as Worker secrets, and gives them to Kapso, which needs them to sign.
They are never printed or written to a file. A normal deploy leaves them alone.

**Rotate a webhook secret:** Actions, `deploy-staging`, Run workflow, tick "Make new Kapso webhook signing secrets". The run makes new secrets
for both lines, stores them in the Worker and in Kapso, then posts one signed test event that must be accepted. If that step fails, run it again.
**Rotate any other secret:** change it at the provider first (Anthropic console, Kapso, Supabase), then update the repository secret
(Settings, Secrets and variables, Actions), then run `deploy-staging`. Then look at the provider's logs for use of the old one.
**If a secret leaks:** rotate it at the provider first, then as above, then check provider logs for use.

## Deploy
`deploy-staging` runs by hand and on `main` after `ci` passes. In order:
1. Database job: link the project, `supabase db push --include-all`, check every migration file is recorded, run `scripts/check_permissions.sh` with `EXISTING=1`
   (changes nothing), load the approved seeds into an empty catalog only, create and check the private `media` bucket.
2. Worker job: create the queues, `wrangler deploy --env staging`, set the Worker secrets, prove the Anthropic key and both model ids, create or check
   the Kapso webhooks and post a signed test event, smoke-test the Worker and send one test error to Sentry.
3. Open the run's summary page: every step writes one line there. Then send the staging test order (task 0.13): the card arrives and the ledger sums to zero.
Production: the same two jobs, in the same order, in a quiet hour, from its own workflow (4.2). Watch `ops_exceptions` and Sentry for 15 minutes.

## Roll back
- Worker: `npx wrangler rollback --env <staging|production>` returns to the previous version in seconds. Do this first, ask questions after.
  The `staging-drill` workflow runs it on staging. If a secret changed since the previous version, Cloudflare may refuse; the drill records what it does.
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

## Proven on staging
Runs are on the repository's Actions page. "Not yet" means written and tested locally only.

| Step | Proven | By |
| --- | --- | --- |
| Deploy: database job (migrations, permission check, seeds, bucket) | Not yet | `deploy-staging` |
| Deploy: Worker job (queues, deploy, secrets, webhooks, smoke test) | Not yet | `deploy-staging` |
| Roll back the Worker | Not yet | `staging-drill` |
| Rotate one secret (webhook signing secrets) | Not yet | `staging-drill`, or `deploy-staging` with the rotate box ticked |
| Recovery drill: restore from point-in-time recovery | Not yet. Needs production and a paid Supabase plan (4.8) | |
