# WhatsApp templates (Kapso number `1384772384720496`, WABA `3060015327535526`)

Source of truth for the templates Alo King sends outside the 24h window. Create them with the Kapso connector (`whatsapp_templates` → `create`, Meta payload format) and keep this file in sync.

| Template | Language | Category | Meta id | Status (2026-10-05) |
|---|---|---|---|---|
| `alo_verify_code` | `ar`, `en_US` | AUTHENTICATION | – | **Not created.** Meta rejects creation: error 10 / subcode 2388185 "This WhatsApp Business account does not have permission to create message template" (authentication category only; marketing works). Needs the WABA's authentication-template permission / business verification fixed in Meta Business Manager. |
| `alo_offer_ar` | `ar` | MARKETING | 1639972467727677 | PENDING review (has the quick reply "إيقاف العروض") |
| `alo_offer_en` | `en_US` | MARKETING | 28756538297317477 | PENDING review. **Created without the opt-out quick reply**; Meta will not accept a second `en_US` version under the same name, so adding the button means editing it in WhatsApp Manager or creating a new name. |

Wire-up:
- `claim-vendor` reads `KAPSO_OTP_TEMPLATE` / `KAPSO_OTP_LANG`. Leave `KAPSO_OTP_TEMPLATE` empty until `alo_verify_code` is APPROVED; claims then go to manual admin review.
- `kapso-brain` broadcasts read `KAPSO_PROMO_TEMPLATE` / `KAPSO_PROMO_LANG` (one language per value). Marketing templates must only go to opted-in customers (see CLAUDE.md hard rules).

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

### alo_offer_en (MARKETING, `en_US`)
Body:
```
Hi 👋 A new offer from restaurants on Alo King:

{{1}}

Order here in one message.
Reply STOP to opt out.
```
Sample `{{1}}`: `10% off burgers today at Al-Sanawbar`. Button: QUICK_REPLY `Stop offers` (not yet on the live template).
