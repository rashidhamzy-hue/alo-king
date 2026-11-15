# Runbook: deploy, roll back, recover

Status: written 12 November 2026, revised 13 November 2026 (session A1) around the `deploy-staging` workflow. A step is marked
**proven** only when it has run on staging and the run is named in the table "Proven on staging" at the bottom. Production
steps stay unproven until Phase 4 (task 4.2).

## Environments
| | Staging | Production |
| --- | --- | --- |
| Supabase | project `alo-king-staging`, ref `lhgkvvdckwbfpdsftzqp`, eu-central-1 | its own project, point-in-time recovery on |
| Cloudflare | Worker `alo-king-gateway-staging`, queues `ak-inbound-staging` and `-dlq` | Worker `alo-king-gateway`, queue `ak-inbound` |
| Kapso | customer line: the Kapso US number (shown in the Kapso dashboard; phone_number_id 1378974041965966); ops line: the Kapso sandbox (597907523413541) | the two +961 numbers |
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
The steps, what the run does and how to check it are in "Rotating the webhook signing secrets" below.
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
  The `staging-drill` workflow runs it on staging. Cloudflare did not refuse after a secret change; it rolled the secrets back with the code (see "What the drill taught" below).
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

## What may never be committed
The repository is public until the build ends, and the log of a public repository's checks is public too. Nothing below may be in a file, a
test, a fixture, a comment, a commit message or a pull request. Git keeps every old version, so a value deleted in a later commit is still published.

| Never | Use instead |
| --- | --- |
| A real phone number: a customer, a rider, staff, a prospect, anyone. Also the business lines' own numbers | An invented number from `scripts/ci/personal-data-allow.json`. The standard block is `+961 70 000 xxx` (for example `+961 70 000 001`) |
| A real location pin (a customer's home) or a plus code, which is as exact as a pin | A village centre (data, three decimals is enough for a test), or one of the invented pins in the same file |
| A real e-mail address | `example.com`, `example.org`, `example.net`, or a name ending `.test`, `.example`, `.invalid` |
| A secret: an API key, token, signing secret, password, private key, the contents of `.dev.vars` | Nothing. Secrets live in Supabase, `wrangler secret` and repository secrets only. The webhook signing secrets are never even in a repository secret: the deploy makes them and only the Worker and Kapso hold them |
| A customer's or rider's real name, message, address or order | An invented person. A real conversation is read on the Kapso or console screens, never copied here |
| A voice note, a receipt, a photograph | The private `media` bucket. Never log what is in them |
| The prospect list (about 800 business listings), or any rating from it | It is in the private `media` bucket under `research/prospects/`. It is research: never imported as merchants, never messaged |

**What checks this.** `scripts/ci/no-personal-data.mjs` fails on: a phone number of 11 to 13 digits that is not in an invented range; a latitude
and longitude pair inside Lebanon with more than three decimals that is not a village centre or a listed invented pin; a plus code; an e-mail
address that is not a documented example; and anything gitleaks flags. It runs in three places:
- **Before every commit.** `npm install` points `core.hooksPath` at `.githooks`, whose `pre-commit` runs the check on what is staged. If gitleaks is
  missing, the hook installs the pinned one into `.tools/` (checksum verified) and runs it; if that cannot be done it says so and runs the other rules.
  `git commit --no-verify` skips the hook. Do not: CI is the backstop, but a pushed value is already public.
- **In CI**, job `secrets-and-dependencies` (one of the required check names), over the whole tree, with gitleaks required. The same job first plants one of each
  kind in a temporary folder and fails unless every one is refused (`--self-test`), so a check that stopped working cannot pass quietly.
- **In the test suite**: `test/ci/no-personal-data.test.ts` (each planted example, each near miss, the whole tree), `test/ci/fixtures-invented.test.ts`
  (every phone number and pin in a test, fixture or eval comes from the invented ranges, with no exemption by file) and `test/ci/pre-commit-hook.test.ts`.

A finding names the file, the line and the rule, never the value. Run it by hand with `npm run check:personal-data` (add `-- --staged` for what is staged).

**If it fails and the value is invented:** add it to `scripts/ci/personal-data-allow.json` with a note saying why it cannot be a person, or better, take a
number from a listed range. A range is at most 1,000 numbers wide unless no operator can assign it. Do not loosen a rule to get past a finding: a change
to that file is read line by line. A barcode is not a phone number: a product code is recognised by its check digit, by being called a barcode or code
on its line, or by sitting in `supabase/seed/catalog.csv`; a GitHub Actions run number is an 11-digit number from 40 to 89 billion, or on a line that
says "run" or "job". **If it fails and the value is real:** take it out of the tree; treat it as published (a person's number or a pin: tell them; a secret: rotate it
at the provider first, see "If a secret leaks"); then ask whether the history must be rewritten. That is a deliberate decision of the founder, never
a side effect of a fix (H1 left the old history alone on purpose, and lists what it still shows).

**The pinned tools.** gitleaks and osv-scanner are installed by `scripts/ci/install-tool.mjs` at the exact versions in `scripts/ci/tools.json`
(today gitleaks 8.21.2 and osv-scanner 2.7.1). Each download is compared with the SHA-256 recorded there before it is unpacked or run; a different hash
deletes the file and fails. No workflow downloads either tool by any other route and none asks for "latest" (`test/ci/pinned-tools.test.ts`). To move to a
new version: download the release and its published checksums file, check that they agree, put the new URL and hash in `tools.json`, and run the test suite.

## Rotating the webhook signing secrets
Three secrets sign what Kapso sends the Worker: `KAPSO_WEBHOOK_SECRET_CUSTOMER`, `KAPSO_WEBHOOK_SECRET_OPS` and `KAPSO_WEBHOOK_SECRET_PROJECT` (the account
and number events). Nobody types them: `scripts/ci/ensure-webhooks.sh` makes each one from the system random source, stores it as a Worker secret first, then
gives it to Kapso, then posts one signed `smoke.test` event that the Worker must accept (HTTP 200: the signature check and the write to Supabase both worked).
It never prints or writes a secret. Rotate when a person who could have seen one leaves, when a log or a screen share might have shown one, and once before the
pilot. None is known to have leaked: they exist only in the Worker and in Kapso, and CI's gitleaks scan of the whole history finds none.
1. GitHub, this repository, Actions, **deploy-staging**, Run workflow, branch **main**, tick **Make new Kapso webhook signing secrets**, Run. The option is
   a switch on the whole deploy workflow, so the run also applies migrations, redeploys the Worker from `main` and sets the other Worker secrets from the
   repository secrets. Pick a quiet hour, and make sure `main` is the code you mean to have running.
2. Open the run summary. Each line must read "webhook ready (id ...); signed test event accepted": one for `customer`, one for `ops`, one for `project`.
3. If a line says the signed test event answered something other than 200, or that the Worker or Kapso refused the secret, run the workflow again with the box
   ticked straight away. The Worker takes the new secret before Kapso does, so a run that stops between the two leaves Kapso signing with the old one and its
   deliveries refused until a run finishes. A line that is not "accepted" after two runs: stop, do not deploy anything else, and read the Worker's
   logs and the Kapso webhook delivery list for that line.
4. Afterwards `npx wrangler secret list --env staging` must show all three names. After any rollback check this too: a rollback returns the Worker to
   the secrets that version had, which can be the old set or miss one; a run with the box ticked repairs both.
5. A normal deploy, with the box not ticked, leaves existing secrets alone: it only makes one that is missing.
Production will rotate the same way from its own workflow (4.2); there is no production Worker yet.

## Backups and Restore (session BK0, 15 November 2026)
**What is copied.** Every night at 01:30 UTC the `backup` workflow dumps the `public` schema and the migration record of the staging database (through the session
pooler, from one snapshot), encrypts it with gpg (symmetric AES-256) and stores it in the private Cloudflare R2 bucket `ak-backups`, folder `staging/`. If the Cloudflare
token has no R2 rights the copy goes to the private Supabase bucket `media`, folder `backups/`, and the run's summary says so (`docs/HANDOFF.md`, Founder actions).
14 nightly copies and 8 weekly copies (the first copy of each ISO week) are kept; older ones are deleted after the new one has been read back and its checksum matched.
Each copy holds the dump and a manifest: row counts per table, the number of migrations recorded, the ledger total. **Not in it:** the files in Supabase Storage (voice
notes, receipts: personal data, left where they are) and Supabase's own `auth` schema (unused: staff and customers are rows in `parties`). Free plans only: R2's free
allowance is far above a few megabytes a night; no paid plan is needed.

**Who can read a copy.** Only whoever holds the passphrase. It is the repository secret `BACKUP_PASSPHRASE` (for staging) and exists **only with the founder**, in
their password manager. It is never written to a file, a log or a chat, and nobody else, and no model, is given it. Lose it and every copy is unreadable: keep two
copies of it (password manager and a sealed paper copy). Change it only by setting the secret again and making a new copy; old copies still need the old one.
Production will use its own, `BACKUP_PASSPHRASE_PRODUCTION`.

**Checks that run by themselves.**
- `backup` at 14:00 UTC every day checks the newest copy is younger than 36 hours. If not (or there is none, or the store cannot be read) it raises the ops
  exception `backup_stale` and sends a Sentry event, and the run is red. A copy that is fresh again resolves the exception.
- `restore-check`, Mondays 03:30 UTC, restores the newest copy into a throwaway Postgres container of the same major version and checks: migrations recorded equals
  the manifest, every table's row count equals the manifest, the ledger sums to zero, every ledger transaction balances. A failure raises `restore_check_failed`
  and sends a Sentry event. Both workflows can be run by hand (Actions, Run workflow); the environment is a choice, staging by default.

**Restore (the steps a person follows).** A restore always goes into a **new, empty** database, never over the live one.
1. Decide what you are restoring into: a new Supabase project (production: its own; staging: a scratch project) or a local Postgres of the same major version as the copy
   (the index says which; the workflow summary prints it). Never restore over a live project: make a new one and compare first.
2. Get the copy. R2: Cloudflare dashboard, R2, `ak-backups`, folder `staging/`, download the newest `.tar.gpg` (its name is its UTC time; `index.json` lists them all).
   Fallback store: Supabase dashboard, Storage, `media`, folder `backups/staging/`. Do not use a link anyone else can open; download it to your own computer only.
3. Fetch the passphrase from the founder's password manager. In a terminal, from a repository checkout (`npm ci` once), put it in the environment without typing it into the
   command line history:
   ```bash
   read -rs BACKUP_PASSPHRASE && export BACKUP_PASSPHRASE
   ```
4. Decrypt and unpack, into an empty folder:
   ```bash
   node scripts/backup/restore.mjs decrypt --in 20261116T013000Z.tar.gpg --out ./restore-work
   ```
   `restore-work/dump` is a `pg_dump` custom-format archive and `restore-work/manifest.json` says what it must contain.
5. Create the empty database and load it. `pg_restore` must be the same major version as the manifest's `pg_major` or newer. In a new Supabase project use its connection
   string (Settings, Database; the database password is the project's):
   ```bash
   export RESTORE_DATABASE_URL=postgres://postgres:PASSWORD@localhost:5432/restore_check    # a local, empty database
   node scripts/backup/restore.mjs prepare --manifest restore-work/manifest.json
   pg_restore --list restore-work/dump | grep -Ev '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' > restore-work/restore.list
   pg_restore --exit-on-error --no-owner --no-privileges --disable-triggers --use-list restore-work/restore.list --dbname "$RESTORE_DATABASE_URL" restore-work/dump
   node scripts/backup/restore.mjs verify --manifest restore-work/manifest.json
   ```
   `scripts/backup/restore-run.sh BUNDLE WORKDIR` does steps 4 and 5 in one go. `restore.mjs prepare` and `verify` refuse any database that is not on localhost, so a restore into a
   new Supabase project is: restore into a local Postgres first and run `verify`; then load the same `dump` into the new project with `pg_restore` (same flags, its connection
   string, skip `prepare`). The dump carries the schema, so the migrations are not run again. Then run `scripts/check_permissions.sh` against the new project and read what it says.
6. Check before anyone uses it: `verify` says "every check passed", and compare the ledger total with the last staging evidence. Then point the Worker's secrets
   (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) at the new project (the deploy workflow does it from the repository secrets) and re-create the `media` bucket (`scripts/ci/ensure-media-bucket.sh`);
   the files in it are not in the copy.
7. Delete `restore-work` and your downloaded copy when done. Write down how long it took.
If the passphrase is wrong, `gpg` says "decryption failed: Bad session key" and nothing is written. There is no way round it: that is the point of it.

## What must never be done to fix an incident
Turn on marketing. Send from the ops number to a customer. Edit a ledger row. Mark an order paid without the payment.
Give a rider's cash figure from memory. Each has a database rule that will refuse it; do not work around the rule.

## WhatsApp catalog (build plan 1.21, written by session K1, 14 Nov 2026)
Rasheed's steps, once per environment (staging first). Code side is built and tested (`docs/HANDOFF.md`, K1); nothing below has
been done yet. Meta moves its labels now and then: if a button is named differently, the purpose of each step is written after it.

**A. The feed's password and link (before Meta can read the feed).**
1. Make a long random password (a password manager's generator, 32 characters, letters and digits). Keep it in the password manager as "Alo King catalog feed (staging)".
2. Cloudflare dashboard → Workers & Pages → `alo-king-gateway-staging` → Settings → Variables and Secrets → Add → Type: Secret →
   Variable name `CATALOG_FEED_PASSWORD` → Value: the password → Deploy. *(Purpose: the Worker answers `GET /catalog/feed.csv` only with
   user `meta` and this password; without the secret the route answers 404.)* Also add it as a GitHub repository secret of the same
   name (Settings → Secrets and variables → Actions → New repository secret), so lane A can put it in `deploy-staging` (request in
   `docs/HANDOFF.md`). Until then a `wrangler rollback` to a version older than the secret drops it: set it again here after a rollback.
3. Supabase dashboard → project `alo-king-staging` → SQL Editor → New query → paste, with the customer line's number in international
   form without `+` (for example `96170000000`; the real one is in the Kapso dashboard, not in this repository) → Run:
   ```sql
   update settings set value = value || '{"product_link": "https://wa.me/<CUSTOMER_LINE_NUMBER>?text={sku}"}' where key = 'catalog';
   ```
   *(Purpose: Meta's feed wants a link per product and we have no website; the link opens our WhatsApp chat. Until it is set the feed answers 503.)*
4. Check: open `https://alo-king-gateway-staging.rashid-hamzy.workers.dev/catalog/feed.csv` in a browser, sign in as `meta` with the
   password. The first line is `id,title,description,availability,condition,price,link,image_link,brand,product_type,custom_label_0`.
   Only items with a picture approved on the console's pictures page are listed; on 14 Nov that is none, so the file is that one line.
   `select catalog_feed_report();` in the SQL Editor says how many are in the feed and how many still lack a picture.

**B. The catalog in Commerce Manager.**
1. Open `business.facebook.com/commerce` → top left, choose the Alo King business portfolio → **+ Add catalog** (or **Create a catalog**).
2. Catalog type: **E-commerce** (online products) → **Next** → **Upload product info** → Catalog owner: the Alo King portfolio →
   Catalog name `Alo King Chouf (staging)` → **Create** → **View catalog**.
3. In the catalog: left menu **Catalog** → **Data sources** → **Add items** → **Data feed** → **Next** → **Scheduled feed** (or
   **Use a URL**) → paste the feed address from A4 → **Add login details**: username `meta`, the password → **Next**.
4. Schedule: **Hourly** (the shortest Meta allows for a scheduled feed) → Currency **USD** → **Next** → name `alo-king-feed` → **Upload**.
   Wait for the first fetch; **Data sources** → `alo-king-feed` → **Issues** lists anything Meta refused (send a screenshot to the next K session).
5. Copy the **Catalog ID** (Catalog → **Settings**, or the number in the address bar after `/catalog/`). Supabase SQL Editor → Run, with that number:
   ```sql
   update settings set value = value || '{"catalog_id": "PASTE_THE_ID"}' where key = 'catalog';
   ```
   *(Purpose: the Concierge's catalog messages name this catalog, and a cart from any other catalog is refused.)*
6. One set per category (what Meta calls a collection inside a catalog): left menu **Catalog** → **Sets** → **Create set** →
   **Filter**: `custom_label_0` **is** `fruits_vegetables` → name it with the Arabic category name → **Create**. Repeat for the 15 codes,
   in the display order: fruits_vegetables, meat_poultry, deli_ready_meals, dairy_eggs, frozen_food, bakery, water_drinks,
   breakfast_cereal, snacks_sweets, pantry_staples, canned_jarred, cooking_baking, cleaning_household, personal_care, baby_pet
   (names in `select code, name_ar from catalog_categories order by sort_order;`).

**C. Connect it to the WhatsApp number, with the cart on.**
1. `business.facebook.com/wa/manage` → choose the WhatsApp account of the customer line → **Account tools** → **Catalog** →
   **Choose a catalog** → `Alo King Chouf (staging)` → **Connect catalog**.
2. Catalog visibility and the cart are per number. Meta's tools: in the same **Catalog** page (or **Phone numbers** → the customer
   number → **Settings** → **Catalog**) switch on **Show catalog icon in chat header** and **Show add to cart buttons**. The API route
   is `POST /<phone_number_id>/whatsapp_commerce_settings?is_catalog_visible=true&is_cart_enabled=true` through Kapso's Meta proxy;
   it has not been tried (no catalog existed on 14 Nov). Either is fine: it is one switch, done once.
3. Check from a phone that has messaged the staging number: the chat header shows a shop icon; open it, add an item, **View cart**,
   **Send**. The bot answers with the order card (or the pin request, for a first order). Nothing is confirmed until **تأكيد الطلب**.

**Which products Meta refuses.** Meta's commerce policy bars tobacco, alcohol, medicines and supplements with health claims, among
others; the catalog has none (business rule 12). An item Meta rejects is shown in Data sources → Issues; it stays orderable by text.

## Proven on staging
Runs are on the repository's Actions page. "Not yet" means written and tested locally only.

| Step | Proven | By |
| --- | --- | --- |
| Deploy: database job (migrations, permission check, seeds, bucket) | **Yes**, 13 Nov 2026, first deploy and a repeat deploy | `deploy-staging` runs 43394134487 and 43396822066 |
| Deploy: Worker job (queues, deploy, secrets, webhooks, smoke test) | **Yes**, first deploy and a repeat deploy | the same two runs |
| Roll back the Worker | **Yes**, 13 Nov 2026: rolled back one version, the Worker still answered, then redeployed | `staging-drill` run 43394402493 |
| Rotate one secret (webhook signing secrets) | **Yes**: new secrets in the Worker and in Kapso, a signed test event accepted on both lines | `staging-drill` run 43394402493 |
| Sentry receives a Worker error | **Not confirmed.** Delivery to Sentry's ingest is proven (HTTP 200, flush true); the event is not visible in the project. See `docs/HANDOFF.md` 0.8. Since A4 (14 Nov) the deploy proves Sentry with a check-in to the monitors `deploy-smoke-staging` and `deploy-ingest-check-staging`, not an error, so it no longer opens issues | `deploy-staging` run 43396822066 |
| Nightly encrypted backup (to R2) and the restore check from it (BK0) | **Yes**, 15 Nov 2026, staging: a copy in R2, restored into a Postgres 17 container, 107 migrations, 127 tables, ledger 0.00. The alerts and the Supabase fallback are not yet exercised live | `backup` run 43703456354, `restore-check` run 43708874550 |
| Recovery drill: restore from point-in-time recovery | Not yet. Needs production and a paid Supabase plan (4.8) | |

**What the drill taught.** `wrangler rollback` goes to the previous *version*, and a secret change is a version. If the version you roll back to predates a secret, the Worker loses it. After any rollback run `npx wrangler secret list --env <env>` and compare with the list at the top of this file;
if a secret is missing, run `deploy-staging` with "rotate" ticked (webhook secrets) or set it from the repository secret by running the deploy again.

## Voice notes for the evaluation (5.8, session V1): upload by Rasheed
Written by session A4, 14 November 2026. The 51 real Shouf voice notes go into the **private** `media` bucket of the staging Supabase
project, never into the repository, a chat, a public link or a shared drive. They are personal data (people's voices). Session V1 reads
them from the bucket with the service key and writes its drafts back beside them; nothing it commits contains audio.

**Where:** bucket `media`, folder `voice_eval/shouf-51/`. Exactly this folder: V1 reads it and nothing else.

**Before you start**
1. Collect the 51 notes as audio files on your computer, in one folder. From a phone: in WhatsApp, open the chat, long-press the
   voice note, Share, and save it to Files (iPhone) or to Downloads (Android); or on Android copy them from
   `WhatsApp/Media/WhatsApp Voice Notes/`. From WhatsApp Web or Desktop: open the chat, hover the note, the arrow, Download.
2. Keep the files as they are: `.opus`, `.ogg`, `.m4a`, `.mp3`, `.aac` and `.wav` are all fine. Do not convert, trim or join them.
   Each file must be under 20 MB (the bucket's limit; a 3-minute note is well under 1 MB).
3. Rename any file whose name contains a person's name or a phone number. Use `note-01.opus` to `note-51.opus` (keep each file's own
   extension). If you know which village or situation a note is from, do not put it in the name either: V1 does not need it.

**Upload (Supabase dashboard, about five minutes)**
1. Sign in at supabase.com, open the project **alo-king-staging**, then **Storage** in the left menu.
2. Open the bucket **media**. It must show a lock or "Private". If it says "Public", stop and do not upload (see "If something is
   wrong" below).
3. Click **Create folder**, name it `voice_eval`, open it, then create the folder `shouf-51` inside it and open that.
4. Click **Upload files**, select all 51 files at once, and wait until each shows as uploaded.
5. Do not click "Get URL" or "Share" on any file. A signed link lets anyone who has it hear the note.

**Check (one query)**
Open **SQL Editor**, paste this and click Run:

```sql
select count(*) as notes, pg_size_pretty(sum((metadata->>'size')::bigint)) as total
  from storage.objects where bucket_id = 'media' and name like 'voice_eval/shouf-51/%';
```

`notes` must be **51**. Then delete the copies on your computer's Downloads folder if you do not need them there.

**Then:** V1 can start; it checks the same count before it reads anything. Nothing else needs to be told to anyone.

**If something is wrong**
- The bucket is missing or shows "Public": run the `deploy-staging` workflow (it creates the bucket private and fails if it is
  public, `scripts/ci/ensure-media-bucket.sh`), then upload.
- A file was uploaded by mistake (wrong note, a name in the file name): select it in the folder and Delete. It is gone from storage.
- Fewer than 51: upload the missing ones into the same folder; a file with the same name is refused, so nothing doubles.
- Never put the notes, their transcripts or a link to them in GitHub, an issue, a pull request or a chat with a model outside V1.
