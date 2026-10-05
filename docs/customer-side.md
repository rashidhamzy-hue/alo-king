# Customer side: reorder, opt-out, acquisition source

## Reorder
- A returning customer (has a non-cancelled, non-rejected order) who sends a bare greeting ("hi", "مرحبا", …) gets a card: their last order's items + vendor, buttons **Reorder last order** (`REORDER|<order id>`) and **See Full Menu**. No prices on the card.
- Tapping Reorder (or typing "reorder" / "same again" / "نفس الطلب") builds a **new summary** via `prepareOrder`: every line is **re-priced from the database** (current prices, availability, vendor open, delivery village, minimum, COD cap) and the customer still has to tap **Confirm**. The order must belong to the same phone. If something is no longer available the customer is told and asked what they'd like instead.

## Opt-out (consent)
Handled ahead of owner/customer routing (only the link-code and claim-review taps come earlier) and clears `marketing_opt_in` immediately (`opted_out_at` set):
- the promo template quick reply (payload `OPTOUT`, any WhatsApp payload shape) or a tap whose title is "Stop offers" / "إيقاف العروض"
- a message consisting only of STOP / unsubscribe / إيقاف / ايقاف / وقف / توقف / "Stop offers" / "إيقاف العروض" (typed "cancel" does not opt out). A linked owner's typed STOP still goes to the owner bot, but the same number's customer record is opted out as well.
The customer gets a bilingual confirmation. Re-subscribing only happens through the explicit opt-in prompt after an order. Broadcasts re-check `marketing_opt_in` at send time.

## Acquisition source (first touch)
`customers.acquisition_source` (`ctwa` | `qr`), `acquisition_ref` (jsonb), `acquisition_at`. Set once, never overwritten.
- **Click-to-WhatsApp**: the inbound message's `referral` object → `{source_type, source_id, source_url, headline, ctwa_clid}`.
- **QR deep link**: a message that is exactly `ORDER_<VILLAGE>_<MERCHANT>_<TABLE>` (also `EXPRESS_…_PICKUP`, `REORDER_…`) → `{code, kind, village, merchant, location}`. The bot replies as to a greeting; it does not bind the session to the vendor yet.
- The stored opt-out write is checked: if it fails the customer is asked to retry (and the message is not marked processed), never told "Done".
- A later explicit `OPTIN|1` tap (even on an old message) re-subscribes: that is a fresh, explicit opt-in.

## Notes on stored data
- `acquisition_ref` can hold the click-to-WhatsApp `ctwa_clid` and ad URL/headline: pseudonymous identifiers, treated as personal data under Law 81/2018. They are never logged or sent to the LLM; keep them only as long as attribution needs them (suggest ≤ 12 months), and delete them with the customer's record on request.
- Source is self-reported for QR codes (anyone can type `ORDER_X_Y_T1`): don't use it for commissions or payouts.
- `customers` is service-role only: RLS is on with no policies, and the table grants for `anon`/`authenticated` are revoked (migration `customers_lockdown`).
