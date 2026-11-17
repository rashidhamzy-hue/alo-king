# The website, page by page (session S1, 14 November 2026)

A real ordering channel on the same products, prices, stock, fees, order states and ledger as WhatsApp (founder decision of
14 November; conflict register C4). It is a client of the commerce core (`docs/SYSTEM_PLAN.md` section 1). It owns no price,
no stock figure and no order state (invariant 19).

## The redesign of 15 November (session DS1)
The page-by-page decisions are now `docs/strategy/05-console-website-design-handoff.md`, section B; where this file differs, that one wins.
Built by DS1 on the design system (`packages/ui`, Tailwind v4 compiled in the Astro build, our own fonts): the frame with the crown and
Order on WhatsApp on every page, home with "Do we deliver to you?", category with filters, search that follows the typing, and product.
**17 November, session DS2:** the pages wear the founder's design reference (`docs/DECISIONS.md`, "Design reference, 17 November 2026"):
the warm band and the ink delivery check on home, pill buttons, WhatsApp green on the WhatsApp buttons only, the product card with its
action on the picture's corner, the "not confirmed yet" tag on the product page, an ink footer. Same data, same reads, same tests.
Restaurants are not shown (Phase 8). The reference's pages that do not exist yet are listed with their session in `docs/HANDOFF.md`, DS2.
One small script (`public/site.js`) makes the delivery check and the search quicker; every page works without it. A gallery of every
component is at `/gallery` on staging. Cart, checkout and tracking are WEB2's; what DS1 left out is a table in `docs/HANDOFF.md`, DS1.

## Shape
- A third Cloudflare Worker, `apps/web/`, **Astro 6 with the Cloudflare adapter, rendered on the server** (RESEARCH_REGISTER b).
  HTML first: every page works with JavaScript off except the live tracking refresh. Islands only for the cart counter and tracking.
- Arabic (right to left) and English from day one, French strings in the same files; the language follows the visitor's choice,
  kept in a cookie; `dir="rtl"` and logical CSS properties, one stylesheet.
- Installable (manifest, icons, a service worker that caches the shell and the catalog pages for reading offline; ordering always needs the network).
- It connects to the database as `web_channel` (execute on a short list of functions), never with the service key.
- Fast on phones: pages under 100 KB before pictures; pictures from the public `catalog` bucket at 400 px and 1200 px; catalog
  pages cached at the edge for 60 seconds, price and stock re-read at the cart and at checkout by `quote_order`.
- No customer passwords. Identity is the phone, proved once by WhatsApp (below).
- Domain and address: the founder's choice (founder list). Until then `alo-king-web-staging.<account>.workers.dev`.

## Identity and consent
1. Browsing and the cart need no identity (an anonymous session cookie: `web_sessions`).
2. At the first checkout the page shows **"Confirm your number on WhatsApp"**: a button that opens our customer number with a
   code already typed (`ALO-7K3Q`). The customer taps send. The customer-line turn recognises the code by code (no model), links
   the session to that person, records consent and replies "✅ your number is confirmed, go back to the site".
3. From then on the device is signed in (90 days, revocable from the account page and from WhatsApp with "sign out").
This keeps invariant 17 (the customer messaged us first), costs no SMS, and makes order history shared between chat and web.

## Day one (class A, sessions WEB1 then WEB2)
| Page | What it does | Core functions | Tests |
| --- | --- | --- | --- |
| `/` Home | What Alo King is, where it delivers (from `villages`), opening hours (`service_info`), categories, "order on WhatsApp" | `catalog_categories`, `service_info` | Hours and villages come from the database; closed state shown |
| `/c/<category>` Category | Products with approved picture or a neutral placeholder, name in the page language, size, price, in stock or not; sub-groups for drinks | `catalog_list` | Only active, placed products; no unapproved picture; out of stock shown, not hidden |
| `/p/<sku>` Product | Picture, names, size, price, stock, **approved food facts with their status and source credit**; "unknown" shown as not verified, never as safe; no ratings, no "healthy" | `product_food_facts`, `product_image_for_customer` | A proposed fact never renders; Open Food Facts credit appears with its facts and pictures (invariants 14, 15) |
| `/search?q=` Search | The same matcher as the chat (`catalog_pack_search`), in Arabic, Arabizi, English, French; misses logged as demand | `catalog_lookup`, `log_demand` | "labne", "لبنة", "labneh" find the same product; a miss is logged once |
| `/cart` Cart | Lines, quantities, remove; prices re-read; stale price or sold-out item named; one source per cart | `cart_set_line`, `cart_view`, `plan_cart` | Same totals as the same basket in chat; a sold-out item is named and removed |
| `/checkout` Checkout | Step 1 number (above). Step 2 place: saved places, or a new one by **map pin or "send my location on WhatsApp"**, then house and floor; the pin decides the village and fee. Step 3 when: now or a delivery window. Step 4 payment: cash on delivery (Whish or OMT by screenshot through WhatsApp). Step 5 the order card, the same content as the WhatsApp card, and **Confirm** | `locate_pin`, `save_customer_pin`, `set_place_details`, `open_delivery_windows`, `checkout_quote`, `create_order_from_quote`, `confirm_order_checked` | Out-of-area pin refused politely; closed shop offers a window or keeps the cart; confirm twice confirms once; first-order cash cap and dues applied as in chat |
| `/o/<code>` Tracking | Status steps (confirmed, being prepared, on the way, delivered), the window or ETA from the database, what changed (missing or substituted items), a "talk to a person" link to WhatsApp. No address, no phone | `order_status_for` behind a signed, expiring link | A wrong or expired signature shows nothing; no personal data in the page |
| `/orders` History | Past orders, each with "order again" (re-priced, missing items named first) | `repeat_plan` | Only the signed-in person's orders |
| `/account` | Saved places, language, what we remember (show, forget, stop: the memory commands), sign out everywhere | `customer_memory_view`, `forget_customer_memory`, `set_memory_pref` | Forget on the web forgets in chat |
| `/privacy`, `/terms` | The lawyer's text | none | Present in ar and en before launch |

**Confirmation (C1 as decided for WEB2, 17 November):** step 5 does not confirm on the page: it sends the order card to the customer's
WhatsApp (through the gateway), and the tap there confirms, exactly as for a chat order. The page then shows the tracking view.
**Built by WEB2 (17 November; `docs/HANDOFF.md`, WEB2):** `/cart`, `/signin`, `/checkout`, `/o/<code>?k=<signed link>`, `/orders`, `/account`, `/how`.
Function names differ from the table above where the build reused C4's: `cart_set_line`, `cart_view`, `checkout_quote` and `web_place_order`
(over `checkout_order`), `web_order_page`, `web_orders`, `web_order_again`, `web_account`, `web_save_pin`, `web_windows`, `web_service_facts`.

Every confirmed web order gets the same WhatsApp status messages as a chat order, because the customer's code message opened
the window; outside the window the approved utility templates apply. The website never sends a message itself: the gateway does (invariant 1).

## After day one
| Page or feature | Class | Waits for |
| --- | --- | --- |
| Live rider position on the tracking page | B | Rider consent in the terms; position sampled during the job only (SYSTEM_PLAN 5) |
| Pay with Whish Pay or card on the checkout | B then C | A merchant account and a signed gateway (SYSTEM_PLAN 9) |
| Send home: buyer abroad, recipient in Lebanon, gift note | C | Card gateway; recipient fields (BUILD_PLAN 9.1) |
| Vendor pages and menus with options | B | The first signed vendor (Phase 8) |
| The web assistant (the Concierge in a chat box) | B | The WhatsApp Concierge proven in the pilot; it would be the same agent on another surface, not a second agent |
| Loyalty count on the account page | B | LOY1 |

## Abuse and safety
- Rate limits per session and per IP on search, cart and checkout (Cloudflare rules plus a counter in the session).
- A cash order from a new number is capped by `settings.first_order` (already built, 1.16) and confirmed only after the
  WhatsApp code, so there is no anonymous cash order.
- Signed tracking links expire 48 hours after delivery. No order code is guessable (random suffix on the link, not the short code alone).
- Content security policy with no inline script; forms carry a CSRF token; cookies are `Secure`, `HttpOnly`, `SameSite=Lax`.

## Cost
Cloudflare Workers on the existing paid plan ($5 a month covers 10 million requests); pictures in Supabase Storage's public
bucket behind Cloudflare's cache; no new subscription. See `docs/COST_MODEL.md`.

## Done when
A basket placed on the website by a verified phone is picked, delivered, paid in cash and closed, shows on the tracking page at
each step, appears in the console like any order with channel `web`, and the day closes with zero unexplained balance.
