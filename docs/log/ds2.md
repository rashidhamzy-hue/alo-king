<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

### DS2: the design reference applied, 17 November 2026 (Fable 5.2); no migration

The founder's design reference (a React app on demo data, made in Lovable) was applied as a **pattern, never code**: it was unpacked outside
the repository and nothing of it is committed. `docs/DECISIONS.md`, "Design reference, 17 November 2026" (this session's first commit) records
the coordinator's decisions; decision 11 stands (no React in the console, Astro on the website, `packages/ui` the one component set).
A restyle: the same data, the same functions, the same write paths. Screenshots: `docs/screens/ds2/` (`README.md` there pairs each
restyled page with the reference's screen).

**Built.**
- **Tokens and fonts** (`packages/ui/tokens.css`, still the one file; both apps read it): ink `#0E0F12`, gold `#C9A227`, gold-deep `#8A6A12`
  (was `#7A5C0C`), paper `#FAF8F3`, green `#14663B` only for available and done, **WhatsApp green `#25D366` only on WhatsApp actions**; the
  reference's card, quiet fill, warm tint, line, status blues and purples, radii (16 px rows, 24 px cards and pill buttons, 28 px panels),
  shadows and the pressed lower edge of a filled button. IBM Plex Sans and IBM Plex Sans Arabic stay our own subset files.
- **The status label table** (`packages/ui/src/status.ts`): the database's ids, unchanged, each with staff words and customer words in
  Arabic and English, a tone and an icon; `statusPill()` draws it. A test holds the table to `packages/core/src/order-machine.ts`, id for id.
- **Shared components**, as `packages/ui` functions and Astro components that wrap them: button (primary, gold, soft, ghost, WhatsApp,
  danger, on ink; three sizes), field (label, hint, the refusal in words), chip, status pill, timer chip, KPI tile, card, tabs (pills),
  drawer, toast with Undo, empty state, the "not confirmed yet" fact row, price with unit price, stepper, the preview notice. All are in
  both galleries (`/gallery` on staging).
- **The reference's rules for staff screens are in `packages/ui` and its tests** (`test/ui/ds2.test.ts`): no tap target under 44 px; no
  script listens for a swipe; a toast carries Undo and no script asks "are you sure"; a timer and a status always carry an icon and words.
- **Website** (home, aisle, product, search, gallery, privacy, terms, offline): the warm band with the promise, the delivery check on ink,
  category tiles, the trust strip, pill search, WhatsApp-green buttons, the product card with its action on the picture's corner and the
  price first, the product page's facts with the "not confirmed yet" tag and fact rows, an ink footer. Restaurants are not shown.
- **Console frame**: a full-height ink sidebar from 900 px, a paper top bar with the search pill, the test-data strip drawn with the
  preview notice, and a phone bar **by role**: admin Today, Orders, Inbox, Approve; lead Today, Orders, Inbox, Dispatch (`/rider-jobs`);
  picker Pick, Stock, Intake (`/capture`); More for all. Today is one tap away for a picker (the crown, and More).
- **LB1's pages** (photographing, label approvals) and every older console page take the look from the stylesheet. Their markup, data
  attributes and actions are untouched, so the capture script and its tests did not move.

**Tested.** `npm run typecheck` passes. `npm test` on the session's machine: 2,614 tests pass and none fails; the seven files under
`test/pg` that need a real Postgres with pgvector could not start there (the machine's Postgres has no `vector` extension, the same before
DS2; DS2 touches no SQL). CI runs them.
- New: `test/ui/ds2.test.ts` (18 tests: the brand values; one token file; our own fonts; WhatsApp green only on chat buttons; the status
  table against the order machine and the decided words; the four staff-screen rules; fact row, price, stepper, field, toast).
- Changed on purpose, three tests: the phone bar by role (`apps/console/test/shell.test.ts`: the three bars, and one place current at a
  time); the 44 px test now reads any height token from the sheet; "green is only the ok colour" also allows `whatsapp`.
- Every other test passes unchanged, including the product card's price, the crown's markup, the LB1 capture and label queue tests.
- In a browser (`SCREENS=<folder> npx vitest run test/screens/ds2.test.ts`, not in CI: it needs Chromium): nothing scrolls sideways at
  360 or 390 px on any website page, in Arabic and English, nor at 390 px on the console pages photographed. Weights below.

**The 100 KB budget: met as the repository has always measured it; one page is over on a first visit.**
- The standing check (`test/screens/web.test.ts`, DS1) passes for every page. But it weighs pages one after another in one browser, so
  after the home page the fonts are already cached and are not counted again.
- DS2's check weighs each page on a first visit (nothing cached; HTML, stylesheet, script and fonts, uncompressed; `docs/screens/ds2/web-weights.txt`).
  Every page is under 100 KB **except the Arabic aisle page: 115.4 KB** (HTML 36 KB for 28 cards, stylesheet 31 KB, script 3 KB, four
  font files 45.5 KB). It was about 112 KB before DS2 by the same arithmetic (the stylesheet was 27.8 KB): DS2 added 3.2 KB to it.
  Arabic home 96.4 KB, Arabic product 88.9 KB, English aisle 92.2 KB (99.6 KB before DS2), English home 73.3 KB.
- What DS2 did about it: styles only some pages show moved to `components.more.css` (the main sheet went 38.3 to 31.0 KB), and the
  language switch no longer downloads the Arabic font for one word on an English or French page (10.5 KB less on each).
- What would bring the Arabic aisle under 100 KB (not done: each changes markup or behaviour, so it is WEB2's with a test): draw each
  icon once per page and reference it from the cards (about 8 KB while cards show the placeholder); show 24 cards and a "more" link;
  or a digits-only Latin font for Arabic pages (about 15 KB).

**Not proven, and what differs from the reference (say so to the founder).**
- **Not seen on a phone or on staging.** Screenshots are from Chromium on this machine, with seed data and no approved picture.
- **Font weights.** The reference draws headings at 700; we serve 400 and 600 only, because a third weight (about 12 KB per script) would
  put the Arabic home page over 100 KB. Chips, status pill, tabs, toast, preview notice, loading, error, timeline, dialog, stepper and
  cart bar are in `components.more.css`, which a website page imports only when it shows one (WEB2: cart and order pages).
- **Gold-deep on tinted fills.** `#8A6A12` is 4.77:1 on paper and 4.54:1 on the soft gold fill, but 4.29:1 on the quiet grey fill and
  4.32:1 on the warm tint. No text is gold there (a hovered table row uses the soft gold fill instead).
- **Dark theme.** The reference has none. DS1's dark values are kept, with dark members for the new tokens (looked at on home and product; the committed DS2 screenshots are light, as the reference is).
- **Unit price.** The component and the card show one when given; the website's reads (`web_catalog_*`) carry none, so no page shows it
  yet. WEB2 adds it to the read (`product_unit_price()` exists, PD1).
- **Undo.** The toast with Undo exists; no console action offers Undo yet, because taking an action back is a logged server action per
  page (UX2a). The console's flash line is styled as the toast.
- **Status words on Today and Orders.** Those pages still word statuses themselves ("being picked", "card sent, waiting for the
  customer's tap"); UX2a moves them to the label table. The customer words in Arabic were read by the coordinator on 17 November (`docs/ARABIC_REVIEW.md`, "DS2").
- **The crown.** Still DS1's original drawing, now ink on a gold tile as the reference's logo; it still waits for the founder's approval.
- **The reference zip had no `src/data/vendors.json`** (the kitchens list). It was run with an empty list to photograph it, so its Food
  screens show no kitchens; that matches the launch decision, and no restaurant screen was needed here.
- **The review note itself was not in this session's prompt** (only its decisions were). The split of UX2 into UX2a and UX2b below is
  read from the reference's own documents (`docs/FOR_RASHID.md`, `docs/OPS.md`). **The coordinator accepted it on 17 November, with Riders
  added to UX2b; the Arabic aisle page's weight is left to WEB2.**

**Every reference screen, and the session that builds it.** DS2 restyled what exists; the rest is un-parked.

| Reference screen | Where it stands | Session |
|---|---|---|
| Home `/`: promise, delivery check, categories, trust strip | Restyled | DS2 |
| Home: village picker and "Delivering to", product rails, "most ordered" | Not built (WEB2 put the village choice on the basket; rails and "most ordered" have no read yet) | Later (UX3) |
| Home: the three WhatsApp ways (type, voice note, photo of a list), "No app needed" | Not built (the photo of a list is BK1) | UX3 |
| Home: Ask Alo King, the assistant in search | Not built | WEB3 |
| Home: Food door, open kitchens, vendor strip | Not shown at launch (invariant 11) | Later, Phase 8 (E1, E2) |
| Home: Send home hero for a visitor abroad | Not built | Later (SH1) |
| Groceries `/aisles` (all aisles with pictures) | Home lists the categories as tiles; no page of its own | WEB2 |
| Aisle `/c/:slug` | Restyled (filters as built: brand, sold by, sort, in stock) | DS2; sub-type chips, unit-price sort: WEB2 |
| Product `/product/:sku` | Restyled, with the "not confirmed yet" tag | DS2; add to basket, favourite, similar item, "tell me when it's back", delivery and payment block: WEB2 |
| Search `/search` | Restyled | DS2 |
| Basket (drawer and `/cart`), the basket bar | **Built** as a page (`/cart`), with the stepper; no drawer | WEB2 |
| Checkout `/checkout` | **Built** (no card, Whish Pay, gift, tip or pickup) | WEB2 |
| Order `/order/:id` (timeline, lapse clock, code, cancel) | **Built** as `/o/<code>?k=<signed link>` (timeline, code, lapse minutes; cancel is the card's own button on WhatsApp) | WEB2 |
| Account `/account`, sign-in `/signin` | **Built** (no favourites or rewards) | WEB2 |
| Pay `/pay/:id` (preview of the hosted page) | Not built | Later (PAY1) |
| How it works `/how` | **Built** (from settings; UX3 may add the FAQ) | WEB2 |
| Sell on Alo King `/for-vendors`, claiming a listing | Not built; behind a switch | UX3 (page), later Phase 8 (E1) for claims |
| Ride with Alo King `/join/rider` | Not built | UX3 (page), RD1 (the application) |
| Send home `/send-home` | Not built | Later (SH1) |
| Food `/vendors`, `/vendors/:id`, menus | Not shown at launch | Later, Phase 8 (E1, E2) |
| Privacy, terms, offline, gallery (no reference screen) | Restyled | DS2 |
| Staff shell: sidebar, top bar, phone bar by role, command bar, bell | Restyled; the bar follows the role | DS2 |
| Today `/ops` | Built (UX2a) | UX2a |
| Inbox `/ops/inbox` | Built (UX2a) | UX2a |
| Orders `/ops/orders` (saved views, drawer) | Built (UX2a) | UX2a |
| Pick `/ops/pick` (queue, runner, packing checklist) | Built (UX2a) | UX2a |
| Dispatch `/ops/dispatch` (runs, cash drop, pickup shelf) | Built (UX2a) | UX2a |
| Stock `/ops/stock` (low, out, use soon, not ready) | Built (UX2a), without "not ready to sell" (the readiness page has it) | UX2a |
| Approve `/ops/approve` (tabs, one card at a time) | Built (UX2b): names, pictures, label readings, second approvals | UX2b |
| Intake `/ops/intake` (progress board, photograph, check) | Built (UX2b): Progress, Photograph, Label approvals and Readiness on one frame | UX2b |
| Money `/ops/money` | Built (UX2b): Ledger, To confirm, Cash drops, Refunds | UX2b |
| Settings `/ops/settings` (people, village pause, hours, alerts, log) | Built (UX2b): hours, minimum, fees, timers, caps, pickup, escalation, limits, switches, the log; people, zones, windows, templates and alerts are linked | UX2b |
| Riders `/ops/riders` (roster, shifts, applicants) | Built (UX2b): roster, shifts (start and end), cash against the caps, written terms on file; the weekly shift grid and applicants wait for RD1 | UX2b (the page); RD1 (applications, shift grid) |
| Reports `/ops/reports` | No page | Later (AN1) |
| Vendors `/ops/vendors` | Hidden from navigation | Later, Phase 8 (E1) |

### Founder actions (DS2)
1. **Look at the pages.** Open `docs/screens/ds2/README.md` on GitHub: each restyled page beside the reference's screen. After the
   staging deploy, open the website and the console on your phone; `/gallery` on each shows every component.
2. **Say what to change.** Colours, radii and fonts are one file (`packages/ui/tokens.css`); a change there reaches both apps.
3. **Decide the heading weight.** The reference uses weight 700; we serve 600 to keep the Arabic home page under 100 KB. If you want
   700, say which you prefer: a heavier page, or 700 in place of 600.
4. ~~Read the Arabic status words.~~ Done by the coordinator, 17 November ("RA 17 Nov"; `preparing` and `ready` changed).
5. ~~Confirm the build order.~~ Accepted by the coordinator, 17 November: UX2a = Today, Inbox, Orders, Pick, Dispatch, Stock; UX2b =
   Approve, Intake, Money, Settings, Riders.
