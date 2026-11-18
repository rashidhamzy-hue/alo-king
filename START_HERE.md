# Start here (for Rashid)

This repository is the whole project: code, database, tests, plan and rules. Staging works; the next milestone is the friends' test.

## Read in this order
1. `docs/STATUS.md`: where we are. Its first table is the path to the friends' test: each step, who does it, its state and the exact clicks.
2. `docs/RULES.md`: every rule and setting value in one table, each with the decision that set it.
3. `CLAUDE.md`: the 21 rules that may not be broken. Claude Code reads it automatically.
4. `docs/DECISIONS.md`: your decisions and the coordinator's, newest last.
Then as needed: `docs/BUILD_PLAN.md` (the roadmap), `docs/NEXT_SESSIONS.md` (session rules and gates), `docs/RUNBOOK.md` (accounts, deploys, the
WhatsApp catalogue), `docs/COST_MODEL.md`.

## What you do, in short
- **Approve** (console, **Approve**): pictures, then label readings, then names. Hussein is the second approver where the page says so.
- **The label day** (with Bassem): write a purchase order, receive the van, photograph every pack on the console's **Label day photos** page.
- **The menus** for the friends' test: photograph them; a session builds the rest.
- **Set up the WhatsApp catalogue** once the pictures are approved (`docs/RUNBOOK.md`, "WhatsApp catalog").
- Look at **Screens** (console, More) for every screenshot a session made, each beside the design reference's screen.

## Sessions
The coordinator starts build sessions (at most three at once). Each reads `CLAUDE.md`, `docs/STATUS.md` and `docs/RULES.md` in full, builds one bundle,
writes its report to `docs/log/<session>.md` and updates `docs/STATUS.md` only where its facts changed. Prompts and gates: `docs/NEXT_SESSIONS.md`.

## Never, on any environment, until Hussein says so in writing
- Connect the two +961 numbers or send to a real customer.
- Turn on marketing, or remove either marketing lock.
- Take or move real money.
- Message a business from the prospect list (`research/prospects/` in the private `media` bucket).
- Create a paid Google Cloud resource.
- Rewrite git history (not before the repository goes private).

## Secrets
Never in the repository, never in a chat, never in a Claude Code prompt. Cloudflare: `wrangler secret put NAME --env staging`. Supabase and GitHub
Actions keep the rest. The names are at the bottom of `wrangler.jsonc`.
