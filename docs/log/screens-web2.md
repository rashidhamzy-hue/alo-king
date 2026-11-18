<!-- Moved from docs/screens/web2/README.md on 18 November 2026 by session DOC2. The text is unchanged; the images it links to are now in the private screens bucket (console, Screens page, session web2). -->

# WEB2: the website's ordering pages beside the design reference (17 November 2026)

Ours: `web2-*`, at 390 and 1280 px, in English and Arabic, from `SCREENS=<folder> npx vitest run test/screens/web2.test.ts` (the real pages,
built and served in the Worker runtime over the real migrations and the seed catalogue; invented customers and orders; no picture is approved in
the seed, so cards show the placeholder). Converted to WebP. Long pages are cut at 2,400 px. The reference's screens are DS2's, in
`../ds2/` (`ref-web-*`, English only: the reference has no Arabic). `web-weights.txt`: what each page downloads on a first visit, measured by
the browser with nothing cached (all under 100 KB; the test also checks that nothing scrolls sideways at 390 px).

| Page | Ours | The reference's screen | What differs, on purpose |
|---|---|---|---|
| Basket `/cart` | `web2-cart-{390,1280}-{en,ar}` | `../ds2/ref-web-cart-{390,1280}` | A page, not a drawer (works with no script). No "cheaper same-size swap" (no read gives it yet). The fee shows once a village is chosen; the pin at checkout decides the real one |
| Sign-in `/signin` (code waiting) | `web2-signin-…` | `../ds2/ref-web-signin-…` | The code is typed alone (`ALO-XXXXXX`), as docs/WEBSITE.md says; the page reloads itself until the message arrives |
| Checkout `/checkout` | `web2-checkout-…` | `../ds2/ref-web-checkout-…` | No card, Apple Pay, Google Pay or Whish Pay (they wait for the company); no tip, gift or pickup (not day one; pickup is off). The order card is the WhatsApp card's own words. "Send the order to my WhatsApp": the Confirm is the tap there |
| Order, waiting `/o/<code>` | `web2-order-waiting-…` | `../ds2/ref-web-order-…` | "Card AK-xxxx" on WhatsApp brings the card again. No cancel button on the page (the card's Cancel on WhatsApp does it) |
| Order, confirmed | `web2-order-confirmed-…` | `../ds2/ref-web-order-…` | Status words from DS2's label table; the handover code of a prepaid order; no "Something wrong?" reports yet |
| History `/orders` | `web2-orders-…` | `../ds2/ref-web-account-…` (Orders tab) | WhatsApp and website orders together, each with "Order again" |
| Account `/account` | `web2-account-…` | `../ds2/ref-web-account-…` | No favourites or rewards (none at launch) |
| How it works `/how` | `web2-how-…` | `../ds2/ref-web-how-…` | Our numbers from settings; no Send home, rewards or FAQ |
| Aisle, after "Add to basket" | `web2-aisle-added-…` | `../ds2/ref-web-aisle-…` | The add is a form with no script; the page comes back with "Added to your basket" |
