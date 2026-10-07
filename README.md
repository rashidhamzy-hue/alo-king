# Alo King (ألو كينغ)

WhatsApp-native food and essentials ordering for Lebanon. This branch, `rebuild/lebanon`, is the rebuild; `main` is legacy and frozen.

Start with `docs/decisions/DECISIONS.md` (the single source of truth), then `CLAUDE.md`.

## Develop
```sh
pnpm install
cp .env.example .env.local   # optional: defaults point at alo-king-staging
pnpm dev
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Where things run
- Front end: TanStack Start on Vercel (`alo-king`, functions in `fra1`).
- Database and edge functions: Supabase `alo-king-staging` (`tzugbbatfbvrfzxuacqx`, eu-central-1).
- CI, automerge and staging deploys: `.github/workflows/ci.yml`. Secret checks: `check-setup.yml`.
- Old working docs and the original Lovable brief: `docs/legacy/` (input only).
