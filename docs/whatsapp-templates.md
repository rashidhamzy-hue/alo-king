# WhatsApp templates (Kapso number `1384772384720496`, WABA `3060015327535526`)

Source of truth for the templates Alo King sends outside the 24h window. Create them with the Kapso connector (`whatsapp_templates` → `create`, Meta payload format) and keep this file in sync.

| Template | Language | Category | Meta id | Status (checked 2026-10-06 in Kapso; synced 2026-10-05 09:27 -03, quality UNKNOWN) |
|---|---|---|---|---|
| `alo_verify_code` | `ar`, `en_US` | AUTHENTICATION | – | **Not created.** Meta rejects creation: error 10 / subcode 2388185 "This WhatsApp Business account does not have permission to create message template" (authentication category only; marketing works). Needs the WABA's authentication-template permission / business verification fixed in Meta Business Manager. |
| `alo_offer_ar` | `ar` | MARKETING | 1639972467727677 | PENDING review (has the quick reply "إيقاف العروض") |
| `alo_offer_en` | `en_US` | MARKETING | 28756538297317477 | PENDING review. **Superseded, do not use:** created without the opt-out quick reply and Meta won't accept a second `en_US` version under the same name. |
| `alo_offer_en_optout` | `en_US` | MARKETING | 1418989513781578 | PENDING review (has the quick reply "Stop offers"). This is the English broadcast template. |

Wire-up:
- `claim-vendor` reads `KAPSO_OTP_TEMPLATE` / `KAPSO_OTP_LANG`. Leave `KAPSO_OTP_TEMPLATE` empty until `alo_verify_code` is APPROVED; claims then go to manual admin review.
- `kapso-brain` broadcasts pick the template **per customer language** (`customers.language`, set from the customer's first clear text message: Arabic script/Arabizi → `ar`, clearly English → `en`, anything else stays unset and is treated as Arabic):
  - `KAPSO_PROMO_TEMPLATE_AR` (default `alo_offer_ar`) and `KAPSO_PROMO_TEMPLATE_EN` (default `alo_offer_en_optout`). The old `KAPSO_PROMO_TEMPLATE` / `KAPSO_PROMO_LANG` are no longer read.
  - If the customer wrote to us in the last 24 hours (window open), the broadcast goes first as a plain message with an opt-out line, and falls back to the template if that send fails. Outside the window only the template is sent. Both templates carry a quick reply whose payload is `OPTOUT`; tapping it (or typing STOP / "Stop offers" / "إيقاف العروض") sets `marketing_opt_in = false` immediately.
  - The language is fixed by the first clear text message and is not updated later; a customer who starts in Arabic keeps the Arabic template. If a template is not approved and the customer is outside the 24h window the send fails, nothing is delivered and the cost is credited back.
  - Consent is re-checked at send time (`marketing_opt_in = true`); customers who opted out in the meantime are skipped and credited back. Marketing only ever goes to opted-in customers (see CLAUDE.md hard rules).

## Payloads
All payloads below are in Meta's creation format and are checked against the categorization rules by `supabase/functions/kapso-brain/templates.test.ts` (one body variable inside fixed text, an opt-out on marketing templates, library format and no URL / media / emoji on authentication, nothing promotional on utility).

### alo_verify_code (AUTHENTICATION), not created yet
```json
{ "name": "alo_verify_code", "language": "en_US", "category": "AUTHENTICATION",
  "components": [
    { "type": "BODY", "add_security_recommendation": true },
    { "type": "FOOTER", "code_expiration_minutes": 10 },
    { "type": "BUTTONS", "buttons": [{ "type": "OTP", "otp_type": "COPY_CODE", "text": "Copy code" }] } ] }
```
```json
{ "name": "alo_verify_code", "language": "ar", "category": "AUTHENTICATION",
  "components": [
    { "type": "BODY", "add_security_recommendation": true },
    { "type": "FOOTER", "code_expiration_minutes": 10 },
    { "type": "BUTTONS", "buttons": [{ "type": "OTP", "otp_type": "COPY_CODE", "text": "نسخ الرمز" }] } ] }
```

### alo_offer_ar (MARKETING, `ar`), pending
```json
{ "name": "alo_offer_ar", "language": "ar", "category": "MARKETING",
  "components": [
    { "type": "BODY", "text": "مرحباً 👋 عرض جديد من أصحاب المطاعم على ألو كينغ:\n\n{{1}}\n\nاطلب الآن برسالة وحدة هون.\nلإيقاف العروض اكتب STOP", "example": { "body_text": [["خصم 10% على البرغر اليوم من مطعم السنوبر"]] } },
    { "type": "BUTTONS", "buttons": [{ "type": "QUICK_REPLY", "text": "إيقاف العروض" }] } ] }
```

### alo_offer_en_optout (MARKETING, `en_US`), pending
```json
{ "name": "alo_offer_en_optout", "language": "en_US", "category": "MARKETING",
  "components": [
    { "type": "BODY", "text": "Hi 👋 A new offer from restaurants on Alo King:\n\n{{1}}\n\nOrder here in one message.\nReply STOP to opt out.", "example": { "body_text": [["10% off burgers today at Al-Sanawbar"]] } },
    { "type": "BUTTONS", "buttons": [{ "type": "QUICK_REPLY", "text": "Stop offers" }] } ] }
```

### alo_order_update (UTILITY), PROPOSED, not created
For order status updates to a customer whose 24-hour window has closed (today those updates are dropped, reason "24h window closed"). Strictly about the customer's own order, no offer, no reorder prompt, no upsell, no link. Do not add any promotional sentence later: Meta then approves it as MARKETING (and bills it as marketing).
```json
{ "name": "alo_order_update", "language": "en_US", "category": "UTILITY",
  "components": [
    { "type": "BODY", "text": "Update on your Alo King order {{1}} from {{2}}: {{3}}. Thank you.", "example": { "body_text": [["#AB12CD", "Al Tahouneh Restaurant", "it is on the way"]] } } ] }
```
```json
{ "name": "alo_order_update", "language": "ar", "category": "UTILITY",
  "components": [
    { "type": "BODY", "text": "تحديث عن طلبك رقم {{1}} من {{2}}: {{3}}. شكراً لك.", "example": { "body_text": [["#AB12CD", "مطعم الطاحونة", "طلبك بالطريق إليك"]] } } ] }
```
Variable {{3}} must come from a fixed set of status phrases (accepted, on the way, delivered, cancelled), never free text.

## Vendor claim review (while `KAPSO_OTP_TEMPLATE` is empty)
`claim-vendor` creates a `pending_review` claim and sends the admin an interactive card (business, claimant, phone, evidence) with **Approve** / **Reject** buttons. The admin number is the Supabase secret `ADMIN_WHATSAPP_PHONE` (digits, e.g. `961...`; set it in the Supabase dashboard, never in chat or the repo).
- The card is an in-window message: the admin must have messaged the Alo King number in the last 24h, otherwise delivery fails and the claim is reviewed in `/admin` instead (`claim_audit_log` records `admin_notify_failed`).
- `kapso-brain` accepts `CLAIM|OK|<id>` / `CLAIM|NO|<id>` taps only from that number and calls `decide_claim`: approve = `finalize_claim` (merchant role, claimed profile) + link the claimant's phone as `vendors.owner_whatsapp_phone` (never overwriting a different existing owner number); reject = status `rejected`.
- Dry runs (`x-selftest`) never decide real claims (they reply `[dry run] would approve/reject …`), and the `x-selftest-admin` override that lets tests act as the admin only works on the `kapso-brain-test` staging copy. Taps from any other number get no reply but are audit-logged (`unauthorized_attempt`).
- Every request, notification and decision (also the `/admin` UI via `review_claim`) is written to `claim_audit_log` with actor (masked admin phone or admin user id) and source.

## Review against Meta's categorization rules (6 Oct 2026)
Rules used (Meta "Template categorization", mirrored in the Kapso WhatsApp docs): **marketing** is anything promotional or persuasive, anything with mixed content (for example an order update with a promo), cart-abandonment or retargeting messages "even if requested by users", and templates whose content is unclear (only `{{1}}`); **utility** must be non-promotional AND specific to the user's order/account (it may not recommend, upsell, cross-sell or carry offers); **authentication** is the most restrictive: library format, a one-time-password button, no URLs, media or emojis, parameters up to 15 characters. Since April 2025 a template submitted as utility that Meta judges promotional is **approved as marketing** (billed as marketing), not rejected.

| Template | Verdict | Notes |
|---|---|---|
| `alo_offer_ar`, `alo_offer_en_optout` | **Correct as MARKETING** | Sales/awareness offer; one variable inside fixed text; example given; opt-out by quick reply and the typed STOP. Still PENDING (a day after submission). Merchant text goes into `{{1}}` unmoderated: see risks. |
| `alo_offer_en` | **Superseded, delete when convenient** | No opt-out quick reply; kept pending only because Meta would not take a second `en_US` version under the same name. Never use it. |
| `alo_verify_code` | **Payload complies; creation blocked** | Library format, copy-code button, no free text, URL, media or emoji; our 6-digit code is far below the 15-character limit; `claim-vendor` sends the code in the body variable and the `url`-type button parameter, which is Meta's required shape. Meta rejects creation (error 10, subcode 2388185, no permission to create templates for this account). **Owner action in Meta Business Settings / WhatsApp Manager** (account permission or verification); not fixable in code. Until then claims are reviewed by hand. |
| Utility templates | **None exist** | In-window order updates are free-form messages (no template, no category). A utility template only matters outside the 24-hour window; a clean draft is proposed above. |

### Risks found, with what to do (nothing below changes behaviour yet)
1. **Merchant offer text is not moderated.** Meta's Commerce Policy prohibits promoting alcohol, tobacco, unverified medical claims and prize promotions in marketing templates; a violating template can be paused and hurts the number's quality rating for everyone. `contains_alcohol` exists on menu items, but a broadcast draft is not checked. Add a draft check before sending (spec: `docs/merchant-products-spec.md`, section 4.2). Needs an owner decision on the word list (Arabic terms need care).
2. **Category drift is invisible until billed.** If Meta re-categorizes a template, cost changes silently. The billing log (M3) stores the template name and the category Meta charged; this query shows any mismatch:
   ```sql
   select template_name, pricing_category, count(*) from message_billing_log
   where message_type = 'template' and status = 'sent' group by 1, 2;
   ```
   `alo_offer_*` must show `marketing` only.
3. **Things that look like service but are marketing.** Reorder nudges, cart-recovery reminders and "sorry for the delay, here is a credit" messages are marketing even when the customer asked for them, so outside the 24-hour window they need a marketing template, `marketing_opt_in`, and an opt-out. Inside the window they are plain messages (charged as service messages from Oct 2026 per Meta's announcement, see `docs/message-audit.md`).
4. **Promo parameters.** Meta rejects line breaks, tabs and four or more spaces inside a template variable; `promoAttempts` collapses whitespace and clips to 900 characters (tested).
5. **Marketing per-user limits.** Meta may not deliver a marketing template to someone who received many recently (error 131049, not billed). Our own caps are in `docs/merchant-products-spec.md`, section 5.
