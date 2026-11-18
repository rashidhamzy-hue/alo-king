<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

### QA1: the whole system on staging, 17 November 2026 (Opus 5.5); no migration (0235 stays free)
Branch `claude/pensive-archimedes-8q67nh`, one pull request. Every check, with its evidence: **`docs/QA1.md`**. In short:
- **Works on staging, seen today:** staging at 0234; the minute cron and the scheduled workflows green; all 18 website pages and 41 console pages at
  390 px in Arabic and English (no error, no sideways scroll, every website page under 100 KB on a first visit: `scripts/qa/pages.mjs`); one
  order each by typed WhatsApp (AK-1056), the website basket confirmed on WhatsApp (AK-1057, the same price, fee and ledger as AK-1056) and a
  voice note from evals (AK-1058, change for $100 kept), each delivered, cash recorded, ledger 0.00, no duplicated message; STOP; the Chouf
  listings (want, remove, restore from the console, claim from WhatsApp); 10 search requests (10 of 10 right item in the first five; fact
  filters never offer an unconfirmed item); the first 15 November voice note gets PD1's honest answer; the label switch is off.
- **Fixed here (failing test first):** the `web` workflow, red on `main` since #109 (its live check read the words before LD1); the hourly
  probe, which made no order for 36 hours (it did not answer B1c's «أي واحد بدك؟»); **every number and switch on the console's Settings
  page was refused on staging** (the page sent a JSON string; the test kit hid it, and now behaves as PostgREST does). And the Inbox, an order's story and Exceptions showed most bot messages as raw JSON; they show the words now. And a lapsed card's notice went as the approved template, without its Reopen button; inside the window it is the message with the button again.
- **Fixed on staging (data):** `settings.catalog.product_link`, empty since K1 (RUNBOOK A3): without it the website could sign nobody in, had
  no WhatsApp button and the Food pages no "Claim it" link. Production needs the same step.
- **Wrong, not fixed here (proposed B1e, `docs/QA1.md` section 9):** "protein bars with no sugar", the second 15 November voice note, is read
  as no line and answered with the returning-customer welcome and a restriction line in the wrong language (`evals/cases/qa1_dropped_line.json`).
  The sim-test showed the model inventing "we don't deliver to Botmeh" once (sim-021).
- **The two model runs (once each):** language gate held (wrong 0, F1 0.916; USD 0.19); sim-test limit 50: 24 of 50 passed, 0 silences
  after a hand-off, one reply in another language (sim-021); USD 1.05 of 2.
- **Staging left as found**, except `product_link` (above) and the test orders AK-1056 to AK-1060. The QA console account
  (`qa1-check@example.com`) is blocked and banned again; its password was random and never stored.

### Founder test (QA1)
About 20 minutes, on your own phone, on staging. Nothing here reaches a real customer. **What happens by itself on staging:** two test riders
accept and deliver every staging order within a few minutes and "pay" cash; you watch that happen in the console (a person picking and
delivering by hand needs T1's rider phone).

1. **Order on WhatsApp with a voice note (5 min).** On your phone open https://alo-king-web-staging.rashid-hamzy.workers.dev and tap the green
   WhatsApp button: it opens the staging customer line with "Hello, I would like to order" typed. Send it, then a **voice note** in your own
   words, for example «بدي كرتونة مي تنورين وقهوة نجار، عبعقلين». You should see, within about a minute: if it is your first message on this
   line, the welcome with the privacy line; possibly «أي واحد بدك؟» with buttons (tap one); for a new place, a request for your location and
   then the house and floor; then **the order card**: the lines with prices, delivery $1.00 (Baakline), the total in dollars and in lira, and
   a **تأكيد الطلب** button. Tap it: «✅ تأكد طلبك …». A few minutes later «🛵 طلبك … صار عالطريق» and the payment message.
2. **Order on the website (6 min).** On the same site: search «labneh» or open an aisle, tap **Add to basket** on two items worth $5 or more,
   open the basket (top right), **Checkout**. "Confirm your number on WhatsApp": tap it, WhatsApp opens with a code typed (ALO-…), send it,
   you get «✅ تأكّد رقمك», go back to the page (it updates by itself). Choose your place (or paste a map link), house and floor, cash, **Place
   the order**. The page says "Waiting for your Confirm"; within a minute **the card arrives on WhatsApp**; tap Confirm there. The website page
   turns into the order's tracking page.
3. **See both in the console (3 min).** https://alo-king-console-staging.rashid-hamzy.workers.dev, sign in with your account. **Orders**: both
   orders, one from WhatsApp and one from the website, with the same kind of card and fee. Open one: its history (confirmed by you, offered,
   accepted, …).
4. **Pick and deliver one (3 min).** On **Dispatch** (or the order's drawer) watch your order go offered → accepted → on the road →
   delivered, cash recorded, by the test rider; then **Money → Ledger**: the cash in, the goods, and the $1.00 delivery fee moved to the rider
   (never company revenue). To try a setting: **Settings → Cash caps → Hard cap**, ask to change it with a reason: it must say "Waiting for a
   second person" (and the Approve page must not let you approve your own request; reject it there to leave it as it was).
5. **Check the Food page (3 min).** https://alo-king-web-staging.rashid-hamzy.workers.dev/food: places in the Chouf "not on Alo King yet", each
   with its kind, village and distance and a map link, **no** phone, rating, menu, hours or photo; nothing can be ordered. Open one: "I want to
   order from here" thanks you; "Is this your place? Claim it" opens WhatsApp with «Claim …» typed.

**What to send back** (in one message to the coordinator): for each step "as written", or what differed, with a screenshot and the time it
happened (the order code AK-… helps). In particular: a step that took more than two minutes to answer, a reply in a language you did not
write in, a price or fee that differs between WhatsApp and the website, anything that scrolls sideways on your phone, and any Arabic that
reads wrong.
