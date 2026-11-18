# WEB4a: the website looks like the reference, stage 1 (the frame and the home page)

Session WEB4a (Opus, high), 18 November 2026. Branch `claude/pensive-hopper-2hw0pg`. Migration 0243. No simulation, no live model call.
The decisions this session took are in `docs/DECISIONS.md`, "WEB4a, the website looks like the reference (stage 1)", 1 to 11.

**State: stage 1 merged; WEB4a stage 1 waiting for the founder.** Stage 2 (aisles, an aisle, the product page and search in the reference's
layout, keeping SELL1's "coming soon", LD1's facts and JSON-LD, SR1's search) starts in the same chat after the founder's reply, with his
corrections first.

## Built

- **The method, as decided.** `@astrojs/react` 7.1.9 and React 19.3.1 (exact versions) in the website; the reference's components copied for
  their look into `apps/web/src/components/ref/` (`ui.tsx`: logo, crown, price, buttons, the WhatsApp glyph, section heads; `Frame.tsx`:
  header, village picker, footer, phone bottom bar; `Home.tsx`: the home page) and rendered on the server from the Astro pages. **No client
  directive anywhere**: Astro's island loader is an inline script, which the content security policy forbids, and React in the browser for
  three widgets would be unused weight. What must react is the site's own small script (`public/site.js`): the picker's search box, "Use my
  location", the live search. The basket count and total are drawn by the server.
- **One palette.** `packages/ui/styles/theme.ref.css` maps every class name of the reference's Tailwind theme (`bg-ink`, `bg-accent-soft`,
  `text-muted-foreground`, `rounded-3xl`, `shadow-card`, `shadow-lift`, the radius scale) onto `packages/ui/tokens.css`. A second,
  unprefixed Tailwind sheet (`apps/web/src/styles/ref.css`, theme and utilities only, no second reset) compiles the reference's classes.
  New tokens: the category tones (no green one), the example chat's WhatsApp colours (`whatsapp-chat-*`), `primary-deep`, `shadow-lift`,
  `weight-bold`. No colour value is written anywhere else. The console's sheet carries the new tokens and uses none.
- **Arabic mirrored, not flipped by hand.** Every left/right of the reference became start/end (`ms`, `me`, `ps`, `pe`, `start-`, `end-`,
  `text-start`, `rounded-ss`/`se`); arrows that point the way of reading are mirrored (`rtl:-scale-x-100`); letter-spacing is reset in Arabic.
  Checked in Arabic, English and French at 390 and 1440 px on every page (no sideways scroll: `test/screens/web4a.test.ts`).
- **The frame (every page).** Header: the logo, Food and Groceries (desktop), search (wide screens), the "Deliver to" village chip, the
  language, Order on WhatsApp, account, and **the basket with its count and items total** (desktop; `cart_view`). Footer on ink with the
  chat, Shop / More / Good to know, the hours from the database. The phone's bottom bar (Home, Food, Groceries, Search, You) and above it the
  basket bar with count, total and "add X to reach the minimum" (the minimum from settings). Headings at 700 (a third font weight, website
  only).
- **The home page.** The hero on the warm field with **"Delivering to <village> · time · fee"** (from the database; "Open now" or "Closed,
  opens HH:MM" before a village is chosen), the bold "The Chouf, delivered.", the search box, the two doors (groceries with the item count;
  Food places, the listings before they sign), **"Or order on WhatsApp"** (type it, voice note), and on desktop the example chat (labelled
  as an example; three real items at their real prices, the real fee, no order code, no clock times). Then the **category photo rail**, the
  trust strip, "Fresh every day" photo tiles, product rails (dairy and eggs, bakery, fruit and vegetables, pantry staples) **from
  `web_home_extras`**, the WhatsApp ordering panel, the remaining aisles as photo tiles with Food places, "Do we deliver to you?" with the
  picker inline, and the restaurant owners' strip. **"Most ordered" appears only once the shop has 30 days of orders.** **The Ask Alo King
  strip is behind `settings.web.ask_alo_king`, off.**
- **The village picker** (decision 4): served villages only, grouped by zone with time and fee, searchable, a `<details>` that opens with no
  script; inline on the home page and the basket; a page at `/village`. **It replaces the basket's village dropdown and the home page's.**
  "Use my location" appears only where the phone can give a position, asks only on the tap, and keeps the village only
  (`/village/locate` → `web_locate_village`, 0243: `locate_pin`, the checkout's rule; nothing stored, no distance returned).
- **Category photos** (decision 8): 15 codes plus the Food door, WebP 480 and 160 px in `apps/web/public/categories/` (527 KB for all 32;
  a page loads only what it shows), lazy below the fold, credited on How it works (`#photos`). Two of the reference's photos showed other
  companies' brands and were swapped for the reference's own unbranded ones.
- **One primary action per screen (the founder's test).** The checkout, and an order page until the order ends, draw the frame in "focus": no
  basket, no WhatsApp order button, no village chip, no bottom bar, no footer chat button. While the card waits for the WhatsApp tap, "Open
  WhatsApp" is the page's one button and "talk to a person" a plain link.
- **Migration 0243** (`web_home_extras`, `web_locate_village`, granted to `web_channel`; the client, `scripts/check_permissions.sh` and the
  list test name them).
- Words: 100 `w4_` keys in Arabic, English and French (`apps/web/src/lib/i18n-web4a.ts`), listed in `docs/ARABIC_REVIEW.md` ("WEB4a"),
  **not yet read by an Arabic reader**.
- The console's Screens page reads `web4a-` screenshots as the website's (beside `ref-web-*`) and `fr` as a language
  (`packages/core/src/screens.mjs`).

## Tested (free tests only)

- `test/db/web4a.test.ts` (new): the rails are the aisle's own cards in its order, in stock first; no "most ordered" before 30 days of
  orders, then a count over the last 30; the Ask switch is off unless set; "Use my location" returns the village (or the served villages
  near it, or "outside") and stores nothing, never a distance.
- `test/web/pages-web1.test.ts`: the picker lists every served village, a POST keeps the village's id only and the home page then answers
  with its fee and time; "Use my location" sets the village or says outside or failed, refuses another site's form, never stores the
  position; the frame's reads are the catalogue's, the home's and `web_service_facts` only; the site's own pictures are WebP and lazy.
- `test/web/web2-pages.test.ts`: the checkout and a waiting order show no basket and no bottom bar, and one WhatsApp button.
- `test/ci/web4a-words.test.ts` (new): the Arabic review table equals the dictionary; no rating, praise, health or "popular" word; no
  village, fee or time written in.
- `test/screens/web4a.test.ts` (new, browser; run here with Chromium, and by the `screens` workflow): home at 390 and 1440 px in Arabic,
  English and French, a first visit and a visitor with a village and a basket (the chip names the village; the header shows "4 · $x.xx"),
  dark at 390, the picker open; every page of the site in the three languages at 390 and 1440 px with no sideways scroll; the waiting
  order and the checkout with no basket and no bottom bar; every picture of the site's own WebP, lazy below the fold; weights written.
- `npm run typecheck && npm test`: see the pull request. The `test/pg/*` suites need a Postgres server with the `vector` extension, which
  this sandbox lacks (migration 0212 stops there); they are not touched by this change and run in CI.

### Tests changed because they pinned the old look

| Test | Was | Now |
| --- | --- | --- |
| `pages-web1` "home shows the closed state" | "Closed now" | "Closed, opens 10:00" (the reference's words, the time from the database) |
| `pages-web1` "the Worker's connection" | only the four catalogue functions | those, `web_home_extras` and `web_service_facts` (the frame's villages and hours) |
| `pages-web1` "a page weighs under 100 KB" | under 100 KB | weight written to `dist/web-weights.txt`; the site's own pictures WebP, lazy, served as `image/webp` |
| `pages-web1` DS1 "every page carries the crown…" | `class="ak-crown"`; fonts 400 and 600 | the reference logo's crown drawing; fonts 400, 600 and 700 |
| `pages-web1` DS1 "Do we deliver to you?" | a `<select>` and `?village=n` | the picker: every served village a button, POST `/village`, the id in the cookie, the answer on the home page |
| `pages-web1` LV1 and UX3 weights | under 100 KB | reported (`dist/lv1-weights.txt`, `dist/ux3-weights.txt`); pictures WebP and lazy |
| `web2-pages` 8 | under 100 KB | reported (`dist/web2-weights.txt`) |
| `test/ui/ds2.test.ts` font faces | 6 on the website | 9 (the third weight) |
| `test/ui/design-system.test.ts` green tokens | only `ok*` and `whatsapp` | also `whatsapp-chat-*` (the example chat is a picture of WhatsApp) |
| `test/screens/{ds2,web,web2,lv1,ux3}.test.ts` | under 100 KB | reported |
| `packages/commerce/test/client.test.ts` | the grant files to 0233 | and 0243 (as its comment asks of a later website migration) |

## First-visit weights (stage 1)

Measured by Chromium, nothing cached, the page and everything it loads, uncompressed (what the browser decodes; the transfer is compressed
and much smaller: the stylesheet is 69 KB here and about 14 KB on the wire). From `test/screens/web4a.test.ts` on the seed catalogue (no
product pictures approved in the seed, so a product rail weighs nothing in pictures).

| Page (390 px) | Arabic | English |
| --- | --- | --- |
| `/` | 624.1 KB | 612.0 KB |
| `/c/dairy_eggs` | 196.2 KB | 186.8 KB |
| `/p/AK-0042` | 176.8 KB | 167.8 KB |
| `/search?q=labneh` | 176.1 KB | 167.5 KB |
| `/cart` | 191.5 KB | 182.5 KB |
| `/checkout` | 130.7 KB | 122.8 KB |
| `/signin` | 181.1 KB | 172.2 KB |
| `/orders` | 187.3 KB | 178.7 KB |
| `/account` | 179.2 KB | 170.7 KB |
| `/how` | 200.1 KB | 178.8 KB |
| `/food` | 183.1 KB | 173.8 KB |
| `/join/rider` | 178.5 KB | 169.1 KB |
| `/for-vendors` | 178.4 KB | 169.3 KB |
| `/village` | 196.9 KB | 190.1 KB |
| `/privacy` | 158.9 KB | 152.8 KB |
| `/terms` | 158.8 KB | 152.8 KB |
| `/o/<code>` | 140.2 KB | 132.3 KB |

The home page at 1440 px: Arabic 886.5 KB, English 874.4 KB, French 875.2 KB (more photos in view: the rail and the six fresh tiles). French at 390 px: 612.8 KB.

The home page carries most of it in category photos (the doors load at once; the rail and tiles are lazy, so a phone that does not scroll
loads less than this; the test scrolls nothing but Chromium loads lazy pictures within its own distance of the screen).

## Not proven (only a live account or a person can)

- The look on staging with staging's data (the merge deploys it: deploy-staging applies 0243, then `web.yml` deploys the Worker).
- "Use my location" on a real phone (the permission prompt, a real position near a village).
- The Arabic of the new words (an Arabic reader; `docs/ARABIC_REVIEW.md`, "WEB4a").
- The founder's verdict on the compare set.

## Founder actions (WEB4a)

1. **Look at stage 1 and reply in the WEB4a chat** (the session waits): the website on staging,
   `https://alo-king-web-staging.rashid-hamzy.workers.dev`, on a phone and a laptop; and the console, **More**, **Screens**, chip **WEB4A**:
   `web4a-home` at 390 and 1440 px, Arabic and English (French under "Also"), each beside the reference's home; `web4a-home-returning`
   (a visitor with a village and a basket); `web4a-picker` (the village picker open); the other pages' frame in Arabic. Reply "as it is",
   or what to change. Stage 2 starts after your corrections.
2. Optional: switch on the Ask strip later with `settings.web.ask_alo_king = true` (it opens WhatsApp with the question typed). Off today.
