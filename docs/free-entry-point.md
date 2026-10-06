# Free entry point tracking (flow item M4, observation only)

**What Meta says** (`docs/research/Meta Whatsapp USD rate card.md`, "Free entry point windows"): if a customer messages us from a Click-to-WhatsApp ad or a Facebook Page call-to-action button, **on the Android or iOS app (desktop and web are not supported)**, a normal 24-hour customer-service window opens, and **if we reply within 24 hours with any message, a 72-hour free entry point (FEP) window opens from the time we replied**. While it is open every message we send that customer is free, whatever its category (templates included). The customer-service window is independent: when it closes only templates can be sent, but those are free too until the FEP window ends.

**What we record.** Every inbound message that carries a Meta `referral` (ad click) is stored once in `fep_referrals` (message id, customer phone, ad source type/id/url, headline, click id, when it arrived, and the 72-hour window). The ad body text is not stored. The first-touch fields on `customers` (`acquisition_source` and friends) are unchanged. **Nothing about sending changes**: the bot answers exactly as before; this only measures.

**The tracked window is an upper bound.** Meta opens the window only when our reply is actually delivered; a handoff turn or a failed reply would give a tracked window that never existed in Meta's books (and a re-click while a window is open does not reopen it). **Window start is approximate.** The window really starts when our reply is delivered; the bot replies within seconds, so the window is taken to open when the referral is processed (a few seconds early: the tracked window ends slightly before Meta's). We cannot see whether the customer used the mobile app or desktop (desktop clicks do not open a window): `message_free_share_daily` therefore also reports Meta's own label.

## Reading it (service role / SQL editor)
- `customer_fep_windows`: the latest window per customer and whether it is `active` now.
- `message_free_share_daily` (per day, Asia/Beirut), built from `message_billing_log` (see `docs/billing-log.md`; needs the status events enabled in Kapso):
  - `billable` / `free`: Meta's `pricing.billable`;
  - `free_entry_point`: messages Meta itself labelled `pricing.type = free_entry_point`;
  - `free_other`: free for another reason (for example inside the customer-service window);
  - `in_tracked_window`: messages sent inside a window we recorded (independent of Meta's label, so a mismatch between the two columns is itself a finding);
  - `share_free_pct` and `share_free_entry_point_pct`: over messages that carry a pricing object.

## Privacy
Rows contain the customer's phone and the ad ids. "Delete my data" deletes the customer's rows; a scheduled purge deletes rows older than 90 days. RLS is on with no anon/authenticated access.

## Not done on purpose
No change to sending, no "send more because it is free" logic, and no use of the click id for anything but the record. Using the window to send templates (for example outside the customer-service window) is a product decision for the owner, and any promotion would still need `marketing_opt_in`.
