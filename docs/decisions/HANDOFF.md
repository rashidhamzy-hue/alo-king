# Handoff — 7 October 2026 (end of the decision review chat)

**Read first:** `docs/decisions/DECISIONS.md` (in the project: `claude/DECISIONS-LEBANON-REBUILD-2026-10.md`). It is final and overrides everything else.

## State
- **Decisions:** sections 0–25 are complete. Phase 0 is GO.
- **Repo:** `rashidhamzy-hue/alo-king`, branch `rebuild/lebanon` (the default branch), private. `main` is legacy and frozen.
- **Services ready:**
  - Supabase `alo-king-staging` (`tzugbbatfbvrfzxuacqx`, eu-central-1, free plan)
  - Vercel `alo-king` (fra1)
  - Sentry projects `alo-king-functions` and `javascript-tanstackstart-react`
  - Kapso project "Alo King"
- **GitHub secrets set:** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `ANTHROPIC_API_KEY`, `SENTRY_AUTH_TOKEN`, `KAPSO_API_KEY`, `GOOGLE_PLACES_SERVER_KEY`. Variable: `SUPABASE_PROJECT_REF`.
- **Build sessions never ask the owner (§25).** Judgement calls go to `docs/decisions/LOG.md`, and owner-only tasks become GitHub issues labelled `owner`.

## Progress
- **Phase 0: done (7 October).** PRs #61–#66 merged automatically. CI runs typecheck, lint, tests, build, secret scan, a migration dry-run against staging and a Claude review. Guard hooks are in place. `check-setup` runs daily, which also keeps staging from pausing.
  - check-setup confirmed that the Supabase, Anthropic, Google and Kapso keys work.
  - The Sentry token is an org token: enough for releases and source maps, but it can't list projects.
  - Kapso "Alo King" has no WhatsApp number yet (#67).
  - `ORS_API_KEY` and `OPENAI_API_KEY` aren't set yet (#76, #77).
- **Session 1 (Phase 1a): done (7 October).** PRs #79 (schema core), #80 (webhook intake, review hardening) and #81 (deploy list fix) merged automatically; migrations and `whatsapp-webhook` are live on staging. The deploy list is now `supabase/functions-deploy.txt` (the CLI broke on a file inside `supabase/functions/`).
  - Schema: operators (admin/operator), customers, brands, vendors (no ratings; unclaimed never public or orderable; per-field seed provenance), `vendor_private`, `vendor_members` (owner/manager/cashier/kitchen), audit log, RLS with explicit grants on every table. Conventions are in `supabase/migrations/README.md`.
  - Dated tables seeded from DECISIONS: USD/LBP rate (89,500), VAT (11%), fee bands ($2/$3/$4.50 to 3/6/10 km), price list (§20.4), Meta message rates, config (COD cap $150 and the other §20-22 limits). The admin changes a value by inserting a newer row.
  - Ledger: append-only double-entry with the locked rate and USD and LBP on every entry; `ledger_post` and `ledger_reverse` (service role only); balance views. Phase 6 builds payments and settlement on it.
  - Webhook intake: edge function `whatsapp-webhook` (HMAC signature, fail closed without `KAPSO_WEBHOOK_SECRET`), `webhook_intake` RPC (dedupe, persist, pgmq `webhook_inbound`), `webhook_claim`/`webhook_finish` for consumers. Not yet registered in Kapso: needs the sandbox number (#67); registering it and setting the secret is done in session 3 or 4.
  - CI now also runs every migration plus `supabase/tests` (RLS as each role, ledger, dated tables, intake; 159 checks) on a throwaway Supabase Postgres, and `deno check` on deployed functions.
  - Review hardening (from #79's Claude review): no backdated dated rows through the API, strict ledger idempotency and 4-decimal amounts, audited customer consent, invoker-only public lookups (Supabase security advisor clean).
  - Open for later sessions: `orders` FK on the ledger (Phase 2); radius checks in session 2 use `least(delivery_radius_km, max_delivery_km())`; Sentry in edge functions with the first queue consumer (session 3); vendor coordinates are hidden from clients until a member-only read is added with the dashboard.
- **Next: session 2 (Phase 1b).** The full session list, with the model and effort for each, is in DECISIONS §10 "Which model".

## How to start each build session
At claude.ai/code, start a new session on repo `rashidhamzy-hue/alo-king`, branch `rebuild/lebanon`. Pick the model and effort from §10, then send:

> Read docs/decisions/HANDOFF.md, DECISIONS.md and LOG.md. Do session N from DECISIONS §10 ("Which model"). Never ask me; follow §25. When done, update HANDOFF.md "Progress" in your last PR and reply with what merged and the open `owner` issues.

## Planning chat (claude.ai, Alo King project)
Use it for strategy, research and decisions. It cannot run code. Decisions it makes are written into DECISIONS.md by the next build session, or uploaded to the project directly.

## Owner to-do (Rasheed)
0. **Kapso:** connect a sandbox or test number to the "Alo King" project (#67), and revoke the old Mapbox token (#68).
1. **Whish:** send the extra questions in §20.6 (#69) and get the API documents and a sandbox key.
2. **SARL** (about 17 October). The same week:
   - open a fresh-USD bank account
   - open Alo King's Whish business account
   - apply to Tap (Claude prepares the text, §22.5)
3. **Lawyer:** one letter covering §20.1 (collection model, BdL Decision 13790), the merchant credit in §20.3, and §21.6 (drivers).
4. **Lines:** Alfa or touch postpaid lines; Meta business portfolio in the company name, with all three owners as admins.
5. **Domain:** buy `aloking.com`, then the browser Google key, Search Console, Bing Webmaster and a Google Business Profile (§24.5).
6. **Before launch:** set Google Cloud spending limits (§19).
7. **Later:** record the 50 voice notes, including 8 in French or Arabic-French.
