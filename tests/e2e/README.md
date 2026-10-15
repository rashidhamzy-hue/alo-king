# Staging conversation simulator (DECISIONS §36)

`staging-e2e` (`.github/workflows/staging-e2e.yml`) posts signed Kapso-shaped webhook events to the deployed
`whatsapp-webhook` on alo-king-staging. The bot answers simulated `+999…` numbers; `dispatch` records those
messages in `sim_outbox` instead of sending them (config `sim_sink_enabled`, on in staging only). Each scenario
in `scenarios/*.yaml` sends messages and asserts the replies and the database.

Runs after every staging deploy (a job in `ci.yml`) and on demand: Actions → staging-e2e → Run workflow (optional
`only` = scenario names). Output: the job summary, the `e2e-transcripts` artifact, and an issue labelled `e2e`
(opened or updated on failure, closed when everything passes).

## Writing a scenario

```yaml
name: my-scenario # lowercase, dashes
personas:
  cust: { role: customer, cc: "961" } # a fresh +999961… number per run
  merchant: { role: merchant } # the fixed simulated merchant
steps:
  - say: { as: cust, text: "Order" } # or tap / pin / voice / sql / wait_s / include
    expect:
      - { to: cust, kind: list, text_any: ["Grill"], buttons: ["ps:"] }
    db:
      - sql: select status from public.orders where id = '{{vars.order_id}}'
        row: { status: placed }
```

- `tap` picks an option from what the bot last sent that persona: `id`, `id_prefix`, `id_re`, `title` or `index`.
- `expect` items are met by any message in the step window; `none: persona` asserts silence; `capture` stores a
  regex group in `vars`. `lang: ar|en|fr` checks the language of the reply.
- `db.row` values: plain values, `~regex`, `>=2`, `null`; `save` stores a column in `vars`.
- A template (sent outside the 24-hour window; on staging a dry run, DECISIONS §39.8) has `kind: template`; its text
  reads `[template <name>/<lang>] <body as the person sees it>` and its quick replies are options (payload as id).
  Close a persona's window with `update app_private.whatsapp_windows set last_inbound_at = now() - interval '25 hours'`.
- `include: { part: order-to-placed, as: cust, lat: 33.68, lon: 35.55, qty: 2 }` expands `_parts/<part>.yaml`
  with `$AS`, `$LAT`, ... replaced.
- A failed step stops its scenario. A scenario that fails on two consecutive runs with no code change is flaky:
  quarantine it with a reason in `docs/decisions/LOG.md` and fix the flakiness before adding scenarios (§36).

## Running locally before a merge

Staging runs the scenarios after every deploy; a session can run them first on its own machine. Start
`supabase/postgres:17.6.1.011` (host network), apply every migration, `scripts/load-seed.sh` and
`supabase/test-fixtures/alo-test-grill.sql`, write `functions_base_url` into `app_private.runtime_settings`, start
PostgREST as `authenticator`, serve `whatsapp-webhook` and `dispatch` with Deno (`SUPABASE_URL` pointing at a proxy that
maps `/rest/v1/*` to PostgREST and `/functions/v1/<name>` to each function, `E2E_WEBHOOK_SECRET` set), then run
`pnpm exec tsx tests/e2e/run.ts` with `DB_URL=…?sslmode=disable` (no TLS on a local database), `WEBHOOK_URL` and
`E2E_WEBHOOK_SECRET`. Nothing reaches Kapso: every number is a `+999` simulator number.
