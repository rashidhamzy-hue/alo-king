# Alo King (ألو كينغ)

WhatsApp-native food and delivery platform for the Shouf region, Lebanon. See `AGENTS.md` for architecture rules (also binding); this file adds stack, constants and workflow.

## Stack
- **Frontend:** TanStack Start (React, Vite, SSR) + Tailwind + shadcn/ui, built with Lovable. Bun (`bun.lock`). Scripts: `build`, `lint`, `test` (vitest).
- **Backend:** external Supabase project `hnjkietmwvkgbyrcnweq` (Postgres + RLS + Edge Functions). Never enable Lovable Cloud. The frontend uses only the publishable key via `src/lib/supabase.ts`.
- **WhatsApp:** Kapso gateway (`api.kapso.ai`) → `kapso-brain` edge function, which runs the customer bot and the owner ("Alo King Business") bot using the Anthropic API.
- **Edge functions** live in `supabase/functions/<name>/index.ts` (Deno). `verify_jwt` is set in `supabase/config.toml`:
  | function | verify_jwt | purpose |
  |---|---|---|
  | `kapso-brain` | false | WhatsApp webhook (own secret / selftest token auth) |
  | `demo-chat` | false | public website demo chat |
  | `claim-vendor` | true | vendor claim + OTP |
  | `merchant-ai` | true | merchant dashboard AI |
- **Migrations** are in `supabase/migrations/`. The repo is the source of truth for functions; push to `main` touching `supabase/functions/**` deploys them (`.github/workflows/deploy-functions.yml`, secret `SUPABASE_ACCESS_TOKEN`).

## Constants (single source: `src/lib/config.ts`; mirrored in edge functions)
- LBP rate: **89,500 LBP per USD**
- Delivery fee: **$2.00**
- Cash-on-delivery cap: **$150** (also enforced in the `orders_guard` DB trigger)
- Timezone: **Asia/Beirut** (open-hours logic, "today" summaries)

## Hard rules
- **Never read the `vendors` table with `select('*')` from the frontend.** Anon/authenticated only have column-level SELECT; use `VENDOR_COLUMNS` from `src/lib/config.ts`. `select('*')` fails or leaks intent.
- Schema and RLS are owned in Supabase; change them through new files in `supabase/migrations/`, never ad hoc.
- Don't rewrite pushed git history (Lovable sync).
- Service-role code (edge functions) must never ship to the frontend.
