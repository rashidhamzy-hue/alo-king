# Customer side: reorder, opt-out, acquisition source

## Reorder
- A returning customer (has a non-cancelled, non-rejected order) who sends a bare greeting ("hi", "مرحبا", …) gets a card: their last order's items + vendor, buttons **Reorder last order** (`REORDER|<order id>`) and **See Full Menu**. No prices on the card.
- Tapping Reorder (or typing "reorder" / "same again" / "نفس الطلب") builds a **new summary** via `prepareOrder`: every line is **re-priced from the database** (current prices, availability, vendor open, delivery village, minimum, COD cap) and the customer still has to tap **Confirm**. The order must belong to the same phone. If something is no longer available the customer is told and asked what they'd like instead.

## Opt-out (consent)
Handled **first**, before any other routing, and clears `marketing_opt_in` immediately (`opted_out_at` set):
- the promo template quick reply (payload `OPTOUT`, any WhatsApp payload shape) or a tap whose title is "Stop offers" / "إيقاف العروض"
- a message consisting only of STOP / unsubscribe / إيقاف / ايقاف / وقف / توقف / "Stop offers" / "إيقاف العروض" (typed "cancel" does not opt out). A linked owner's typed words still go to the owner bot; their button taps count.
The customer gets a bilingual confirmation. Re-subscribing only happens through the explicit opt-in prompt after an order. Broadcasts re-check `marketing_opt_in` at send time.

## Acquisition source (first touch)
`customers.acquisition_source` (`ctwa` | `qr`), `acquisition_ref` (jsonb), `acquisition_at`. Set once, never overwritten.
- **Click-to-WhatsApp**: the inbound message's `referral` object → `{source_type, source_id, source_url, headline, ctwa_clid}`.
- **QR deep link**: a message that is exactly `ORDER_<VILLAGE>_<MERCHANT>_<TABLE>` (also `EXPRESS_…_PICKUP`, `REORDER_…`) → `{code, kind, village, merchant, location}`. The bot replies as to a greeting; it does not bind the session to the vendor yet.
