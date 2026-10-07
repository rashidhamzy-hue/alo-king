# kapso-brain persona suite

Scripted customers (Arabic, English, Arabizi, typo-heavy, voice note, changes mind, two vendors, closed vendor, cancels, asks for a human, prompt injection) that drive the **staging** copy `kapso-brain-test` in dry-run mode. Replies come back as payloads (nothing is sent to WhatsApp); DB writes are real but only for test phones `961700000…`.

Assertions per persona: universal (button/list limits, ≤3 messages per turn and ≤25 per persona, no secret/prompt leak, USD+LBP on every priced message, never an unconfirmed order, order prices recomputed from `menu_items`) plus persona-specific ones. Each assertion carries the roadmap item that makes it required (see `docs/legacy/whatsapp-flow-spec.md` §8); with `--phase N` items ≤N must pass, later ones show as ⏳ pending.

```
# 1. staging deploy: Actions → "Deploy Supabase edge functions" → staging=true on your branch
# 2. a live selftest token (insert into selftest_tokens, expires in hours)
# 3. closed-vendor fixture: run the SETUP block of fixtures/closed-vendor.sql (TEARDOWN afterwards)
SELFTEST_TOKEN=… bun supabase/functions/kapso-brain/tests/run.ts --phase 0
```

The persona runs are LLM-driven, so scripts retry with nudges; a one-off miss is worth re-running before treating it as a regression. Never put real secrets, OTPs or customer data in fixtures.

## One-off capped live check (`live.ts`)
`SELFTEST_TOKEN=… bun tests/live.ts <phase> --state /tmp/live-state.json` drives staging (dry run: nothing is sent to WhatsApp, model calls are REAL and cost money) in phases `ab` / `b2` / `c1` / `c2` / `e` / `f` / `g` / `report` / `d`. Every call first reads the estimated spend of the test phones (`?job=spend`, from `ai_call_log`) and refuses to continue at 90% of `CAP_USD` (default 1.5). Staging-only request headers (honoured only on `kapso-brain-test` with a selftest token, dry run): `x-selftest-model` (Haiku 4.5 / Sonnet 5.5), `x-selftest-cheap: true`, `x-selftest-budget`, `x-selftest-admin`. Run `report` before `d` ("delete my data" nulls the phone on that customer's AI-log rows).

## Latency and calls-per-turn run (`latency-live.ts`)
`SELFTEST_TOKEN=… bun tests/latency-live.ts [--out file.json]` drives staging once (dry run, real model for the model-bound turns, test phones only) through the numbered menu, numbered replies, Edit taps, typed edits, multi-item natural language (EN / Arabizi), search-first and one model-bound turn plus an order to confirm. It records the function's own `turn_timing` per turn (handler time excludes Kapso's 5 s buffer window and real send latency), asserts the latency targets (**taps: under 1.5 s and no model call; free text that resolves server-side: at most one model call**), and prints calls per turn, handler p50/p95 per kind, and cost per order from `ai_call_log`. Hard cap `CAP_USD` (default 1.50), checked from `ai_call_log` before every turn; it aborts at 90%.

## Message audit (`message-audit.ts`)
`SELFTEST_TOKEN=… bun tests/message-audit.ts [--model] [--out file.json]` counts the outgoing business messages one confirmed order costs per path (numbered menu, tap flow, reorder; free text with `--model`). Dry run on staging, test phones only, no model call without `--model`. Seed first: `customers` rows for `96170000090001`-`96170000090004` with a saved profile (name, village, address, coordinates, consent, language). The results and the target are in `docs/legacy/message-audit.md`.
