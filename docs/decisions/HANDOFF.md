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

## Build order (DECISIONS §7)
| Phase | Work | Model |
|---|---|---|
| 0 | Repo reset, CI and automerge, `check-setup` | Opus 5.5 |
| 1 | Schema, places, categories, vendor import | Opus 5.5 |
| 2 | Order lifecycle, notifications, order channels (§23) | Opus 5.5 |
| 3 | Bot and AI, claims | Sonnet 5.5; Opus for the hard parts |
| 4 | Website revamp (§24) | Sonnet 5.5 |
| 5 | Delivery modes (§21) | Sonnet 5.5 |
| 6 | Payments, ledger, settlement, Send Home (§20, §22) | Opus 5.5 |
| 7 | Simulator and evals | Sonnet 5.5 |
| 8 | Growth tools and credit | Sonnet 5.5 |

Fable 5.1 does one security review before the pilot.

## Owner to-do (Rasheed)
1. **Whish:** send the extra questions in §20.6 and get the API documents and a sandbox key.
2. **SARL** (about 17 October). The same week:
   - open a fresh-USD bank account
   - open Alo King's Whish business account
   - apply to Tap (Claude prepares the text, §22.5)
3. **Lawyer:** one letter covering §20.1 (collection model, BdL Decision 13790), the merchant credit in §20.3, and §21.6 (drivers).
4. **Lines:** Alfa or touch postpaid lines; Meta business portfolio in the company name, with all three owners as admins.
5. **Domain:** buy `aloking.com`, then the browser Google key, Search Console, Bing Webmaster and a Google Business Profile (§24.5).
6. **Before launch:** set Google Cloud spending limits (§19).
7. **Later:** record the 50 voice notes, including 8 in French or Arabic-French.
