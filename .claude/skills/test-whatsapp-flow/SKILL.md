---
name: test-whatsapp-flow
description: Dry-run the Alo King WhatsApp bot on alo-king-staging (customer order, merchant order card and escalation, owner edits, broadcasts) without sending real messages. Use after changing the bot or before a release; the Phase 7 simulator replaces it.
---

# Test the WhatsApp flows (dry run on staging)

**State:** the legacy `kapso-brain` is not deployed to `alo-king-staging` yet; it is ported in Phases 1-3 and added to `supabase/functions/DEPLOY`. Until then there is nothing to call. From Phase 7 the simulator suite (`pnpm run sim`, run by CI after every merge) is the main test; this skill stays for ad hoc checks.

## Rules
- Only `alo-king-staging` (`https://tzugbbatfbvrfzxuacqx.supabase.co`); the guard hook blocks every other project.
- Only test phones `961700000001..961700000099`; `send.sh` refuses anything else.
- Dry-run mode (`x-selftest: <token>` from a short-lived `selftest_tokens` row) returns the payloads instead of sending them through Kapso. It still writes to the staging database and spends model tokens.
- Nothing from Kabsi: not its number, its Kapso project or its database.

## Use
```sh
export SELFTEST_TOKEN=t-<random>   # inserted with an expiry of 3 hours
.claude/skills/test-whatsapp-flow/send.sh 961700000001 text "بدي منقوشة زعتر عالباكلين"
.claude/skills/test-whatsapp-flow/send.sh 961700000001 reply "CONFIRM|<id>" "Confirm"
```
`show.py` prints each outgoing message with button IDs and title lengths.

## Cases (expected results follow DECISIONS, not the legacy docs)
- Order: one summary card per turn; totals in USD and LBP at the locked rate; fee from the band for the road distance; no order until the customer confirms; a second confirm tap does nothing.
- Address: location pin requested first; outside the merchant's radius is refused politely.
- Languages: Arabic, English, French, Arabizi and mixed messages each get a reply in the latest language.
- Merchant: order card with Accept / Reject / prep time; escalation at 15 s, 45 s and 75-90 s (backdate `created_at` to test); duplicate taps safe.
- Owner edits: a price change is a proposal until the owner taps confirm.
- Broadcast: preview with reach and cost from Alo King Credit; only opted-in customers; STOP stops at once.

## Cleanup
Expire the token; cancel test orders; remove rows for `961700000%` phones; restore any vendor fields changed for the test.
