---
name: merchant-onboarding
description: Walk a restaurant/grocery owner through onboarding on Alo King (claim the business, complete the profile and menu, link the WhatsApp owner console, go live, broadcast credit). Use when asked to onboard, claim, or set up a merchant.
---

# Merchant onboarding

Vendors are pre-seeded in `vendors` (never `select('*')`; use `VENDOR_COLUMNS`). Onboarding turns one into a claimed, live, WhatsApp-manageable business.

1. **Claim** (site `/claim/<slug>`, edge function `claim-vendor`, JWT required, 5 attempts/day/user):
   - `start` with owner name + phone. If `KAPSO_OTP_TEMPLATE` is set and the vendor has a WhatsApp/primary phone, a 6-digit code is sent with the **code in both the body and button parameters**; `verify` calls `finalize_claim` (creates `staff_profiles` merchant role, `vendor_profiles.claimed_at`, `vendor_private`).
   - Otherwise the claim is `pending_review`: an admin approves in `/admin` (`review_claim`).
2. **Profile** (`/merchant/profile`): hours (drive `vendor_is_open`, Asia/Beirut), delivery villages, min order, prep time, allergen policy, contacts. Aim for a high `vendor_completeness` score.
3. **Menu** (`/merchant/menu`, import via `merchant-ai` `extract_menu`): check prices (USD stored; LBP at 89,500 is display only), customizations, allergens (`allergens_reviewed` gates allergy recommendations), photos. AI output is proposals the owner approves; macros/allergens are estimates.
4. **Link WhatsApp** (Profile → "Manage by WhatsApp"): `create_owner_link_code` gives `ALO-XXXXXX` (30 min). The owner sends it from their phone to the Alo King number; `kapso-brain` sets `vendors.owner_whatsapp_phone`. One number per vendor. Then they can change prices, mark sold out, pause, see today's numbers, and draft broadcasts by text or voice.
5. **Go live**: `vendors.is_live = true` (the bot only offers live vendors when `ALO_DEMO_MODE=false`). Check `vendor_is_open` isn't false and `accepts_orders` is true.
6. **Marketing**: new customers are asked to opt in after their first order; broadcasts go only to opted-in customers, cost $0.05/msg from `broadcast_credits_usd` (default $10), each with an opt-out. Marketing templates must be APPROVED first.
7. **Verify** with `test-whatsapp-flow` using test phones only, then undo test data (see that skill's cleanup).

Rules: never ask owners to paste API keys, OTPs or card numbers in chat; don't edit another vendor's data; prices are always set server-side.
