# kapso-brain persona suite

Scripted customers (Arabic, English, Arabizi, typo-heavy, voice note, changes mind, two vendors, closed vendor, cancels, asks for a human, prompt injection) that drive the **staging** copy `kapso-brain-test` in dry-run mode. Replies come back as payloads (nothing is sent to WhatsApp); DB writes are real but only for test phones `961700000…`.

Assertions per persona: universal (button/list limits, ≤3 messages per turn and ≤25 per persona, no secret/prompt leak, USD+LBP on every priced message, never an unconfirmed order, order prices recomputed from `menu_items`) plus persona-specific ones. Each assertion carries the roadmap item that makes it required (see `docs/whatsapp-flow-spec.md` §8); with `--phase N` items ≤N must pass, later ones show as ⏳ pending.

```
# 1. staging deploy: Actions → "Deploy Supabase edge functions" → staging=true on your branch
# 2. a live selftest token (insert into selftest_tokens, expires in hours)
# 3. closed-vendor fixture: run the SETUP block of fixtures/closed-vendor.sql (TEARDOWN afterwards)
SELFTEST_TOKEN=… bun supabase/functions/kapso-brain/tests/run.ts --phase 0
```

The persona runs are LLM-driven, so scripts retry with nudges; a one-off miss is worth re-running before treating it as a regression. Never put real secrets, OTPs or customer data in fixtures.
