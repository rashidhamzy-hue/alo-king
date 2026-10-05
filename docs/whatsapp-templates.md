# WhatsApp templates (Kapso number `1384772384720496`, WABA `3060015327535526`)

Source of truth for the templates Alo King sends outside the 24h window. Create them with the Kapso connector (`whatsapp_templates` → `create`, Meta payload format) and keep this file in sync.

| Template | Language | Category | Meta id | Status (2026-10-05) |
|---|---|---|---|---|
| `alo_verify_code` | `ar`, `en_US` | AUTHENTICATION | – | **Not created.** Meta rejects creation: error 10 / subcode 2388185 "This WhatsApp Business account does not have permission to create message template" (authentication category only; marketing works). Needs the WABA's authentication-template permission / business verification fixed in Meta Business Manager. |
| `alo_offer_ar` | `ar` | MARKETING | 1639972467727677 | PENDING review (has the quick reply "إيقاف العروض") |
| `alo_offer_en` | `en_US` | MARKETING | 28756538297317477 | PENDING review. **Superseded, do not use:** created without the opt-out quick reply and Meta won't accept a second `en_US` version under the same name. |
| `alo_offer_en_optout` | `en_US` | MARKETING | 1418989513781578 | PENDING review (has the quick reply "Stop offers"). This is the English broadcast template. |

Wire-up:
- `claim-vendor` reads `KAPSO_OTP_TEMPLATE` / `KAPSO_OTP_LANG`. Leave `KAPSO_OTP_TEMPLATE` empty until `alo_verify_code` is APPROVED; claims then go to manual admin review.
- `kapso-brain` broadcasts pick the template **per customer language** (`customers.language`, set from the customer's first clear text message: Arabic script/Arabizi → `ar`, clearly English → `en`, anything else stays unset and is treated as Arabic):
  - `KAPSO_PROMO_TEMPLATE_AR` (default `alo_offer_ar`) and `KAPSO_PROMO_TEMPLATE_EN` (default `alo_offer_en_optout`). The old `KAPSO_PROMO_TEMPLATE` / `KAPSO_PROMO_LANG` are no longer read.
  - If the customer wrote to us in the last 24 hours (window open), the broadcast goes first as a plain message with an opt-out line, and falls back to the template if that send fails. Outside the window only the template is sent. Both templates carry a quick reply whose payload is `OPTOUT`.
  - Consent is re-checked at send time (`marketing_opt_in = true`); customers who opted out in the meantime are skipped and credited back. Marketing only ever goes to opted-in customers (see CLAUDE.md hard rules).

## Payloads

### alo_verify_code (AUTHENTICATION)
```json
{ "name": "alo_verify_code", "language": "en_US", "category": "AUTHENTICATION",
  "components": [
    { "type": "BODY", "add_security_recommendation": true },
    { "type": "FOOTER", "code_expiration_minutes": 10 },
    { "type": "BUTTONS", "buttons": [{ "type": "OTP", "otp_type": "COPY_CODE", "text": "Copy code" }] } ] }
```
Same for `"language": "ar"` with the button text `نسخ الرمز`.

### alo_offer_ar (MARKETING, `ar`)
Body:
```
مرحباً 👋 عرض جديد من أصحاب المطاعم على ألو كينغ:

{{1}}

اطلب الآن برسالة وحدة هون.
لإيقاف العروض اكتب STOP
```
Sample `{{1}}`: `خصم 10% على البرغر اليوم من مطعم السنوبر`. Button: QUICK_REPLY `إيقاف العروض`.

### alo_offer_en_optout (MARKETING, `en_US`)
Body:
```
Hi 👋 A new offer from restaurants on Alo King:

{{1}}

Order here in one message.
Reply STOP to opt out.
```
Sample `{{1}}`: `10% off burgers today at Al-Sanawbar`. Button: QUICK_REPLY `Stop offers`.
