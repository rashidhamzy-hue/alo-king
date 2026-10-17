# Customer experience on WhatsApp: every scenario, decided (16 October 2026)

**Status:** adopted by DECISIONS §39.14 (16 October 2026), amended by §39.15 (see §9 below). Every line marked **NEW** is decided. Written by Claude for Rasheed on 16 October, walking the app as a customer. Where a line repeats an earlier decision it cites the section and changes nothing. Where this file and DECISIONS.md disagree, DECISIONS.md wins.

**The bar:** a customer in the Shouf should feel they are using Toters, Talabat or Deliveroo, inside WhatsApp, with no app to download. Every screen looks finished, every message is short and in their language, and every tap leads somewhere.

## 1. What WhatsApp lets us show, and what we build on top

| Surface | What it can show | Our use |
|---|---|---|
| Native catalogue item screen (Meta) | One photo, title, price, description, one link, "Add to cart" | Quick add from product messages. No add-ons, no sections, no recommendations: Meta's limit for every business. |
| Multi-product message | Up to 30 items in 10 sections, header text | A shop's menu and search results, grouped (§39.13). |
| Buttons and lists | 3 buttons; 10 rows per list | Every choice in the chat (§29.3). |
| Web menu opened from a CTA-URL button | Anything: cover, tabs, photos, add-ons, recommendations, nutrition, cart | **The Toters-grade menu (NEW, implements the §29.3 "web basket" and §5 handoff).** Opens inside WhatsApp's own browser. |
| WhatsApp Flows | Forms and screens with images, choices, checkboxes | Same data as the web menu, after Meta verification (#182). |

**NEW:** the web menu is the main way to browse a full menu; the native catalogue is the quick add; the chat is where the order is confirmed, tracked and supported. Everything ends in one server basket.

## 2. Writing and visual rules (every message, every item)

1. **Language:** reply in the language of the customer's last message: Arabic or Arabizi → Arabic script; English → English; French → French. Buttons in the same language. Never mix two languages in one line. **NEW**
2. **Item titles** in one language: the shop's own name if it is Latin, else English; Title Case, never ALL CAPS; sizes once ("Soft Drink 1.5 L"). The Arabic name goes in the description (catalogue) or under the title (web menu). **NEW**
3. **Item description**, never empty, never "Menu": shop · village; Arabic name; what is in it (the menu's text, else the dish library marked "usually"); allergens only when the merchant declared them (`merchant_verified`), or for grocery items from Open Food Facts labelled "estimated" (§39.5), never from the dish library; calories and macros may be shown as "estimated" (§32.3); "Extras chosen after you add it" when the item has options. **NEW**
4. **Prices** always as `$6.50 · <LBP at the locked rate>` on totals (dual currency at the rate locked on the order, product rules); item prices in USD only. Western digits in every language. **NEW**
5. **Messages:** at most 3 short lines before the buttons; at most one emoji; no walls of text; no internal words ("vendor", "basket id", "draft"). **NEW**
6. **Photos:** real only (§39.13); square 800×800, same treatment; an item without a photo stays out of the catalogue and shows a clean text row in the web menu.
7. **Links shown to customers** are aloking.com links only, never a Supabase or Kapso URL. **NEW**
8. **Speed:** a tap gets its reply within 2 s; a voice note gets "listening…" within 2 s (§30.1.6).

## 3. The journey, scenario by scenario

### 3.1 First contact
| # | Customer does | We do |
|---|---|---|
| 1 | Sends "hi", "marhaba", "bonjour", "salut", a sticker, "?" | One welcome: "Order food and groceries in the Shouf, right here on WhatsApp. No app needed." Buttons: **Order**, **My orders**, **Help**. **NEW** wording |
| 2 | Arrives from an aloking.com shop page or a QR on a shop | The `wa.me` text carries the shop ("Order from Eatout"); we open that shop straight after the location step. **NEW** |
| 3 | Arrives from "Ask them to join" or a friend's referral link | Referral per §30.3.7; join links per §39.3 |
| 4 | Sends a voice note before AI credit exists | "I can't listen to voice notes yet. Tap Order or type the dish." + Order button. After credit: §30.1.6. **NEW** wording |
| 5 | Sends a photo (a dish, a menu, a screenshot from Instagram) | Before credit: "Nice! Tell me the dish or the shop, or tap Order." After credit: the AI names the dish and searches it. **NEW** |
| 6 | Sends five messages in a row | One reply to all of them (2 s debounce). **NEW** |
| 7 | Writes after 23:00 or when every shop is closed | "Shops near you are closed now. Eatout opens at 12:00." Buttons: **Remind me when it opens**, **See menus**. The reminder is one service message inside the 24-hour window. **NEW** |

### 3.2 Where to deliver
| # | Situation | We do |
|---|---|---|
| 8 | First order | Ask for the location pin; typed village or landmark also works (§28). Then one question for the building or landmark ("Near the church, 2nd floor"). |
| 9 | Has saved addresses | Confirm on every order: "Home in Baakleen, or somewhere else today?" (§39.6) |
| 10 | At a relative's house tonight | New pin; "Save it as 'Teta's house'?" only with a yes (§39.6) |
| 11 | Outside the boundary (Damour, Chehim) | "We don't deliver to Damour yet." Buttons: **Tell me when you do**, **Pick up instead** (if a shop is within `pickup_search_km`). **NEW** waitlist: the tap stores a dated opt-in for that place; when the place switches on, one approved utility template the customer requested goes out, STOP honoured, and it is never reused for marketing |
| 12 | Abroad, ordering for family (Send Home) | §22 in full; the agent asks "for you or someone else?" only on §22.1 conditions |
| 13 | Expat visiting with a foreign number | A normal local order to the confirmed address; never infer from the country code (§39.6) |
| 14 | Pin far from the typed place | One check question (§27.8 #10) |

### 3.3 Finding food
| # | Situation | We do |
|---|---|---|
| 15 | Doesn't know what to eat | "What are you craving?" categories, then "Shops near you" with fee, distance, open now (§39.13) |
| 16 | Knows the shop | Shop cover, one line (cuisine · village · fee · open until), **Open menu** (web menu) and the best sections as a product message. **NEW**: the Open menu button |
| 17 | Types a dish ("shawarma", "manoushe kishk", "burger") | Search across every shop delivering here, one product message grouped by shop (§39.13); after credit, Arabizi and voice too (§39.6) |
| 18 | Budget ("under $10", "shi rkhis") | After credit: filters by server price. Before credit: the categories path. |
| 19 | Diet ("vegetarian", "no gluten") | Only merchant-declared flags filter (§32.3); otherwise "this shop hasn't confirmed it", never "safe" |
| 20 | Asks for a shop that isn't on Alo King | "Not on Alo King yet" + **Ask them to join** + the closest open alternatives (§39.3) |
| 21 | Shop closed now | Shown last, greyed, with "opens 12:00" and **Remind me**; no scheduled orders in the pilot (scheduled Send Home stays per §22.2 #9). **NEW** |
| 22 | Shop busy (kitchen at capacity) | Longer ETA shown before confirming (§32.5); paused shops are not listed |
| 23 | Item sold out | Not shown; if it was in the basket, the confirmation names it (§30.1.1) |

### 3.4 Choosing an item
| # | Situation | We do |
|---|---|---|
| 24 | Opens an item in the web menu | Large photo, title, Arabic name, description, price, required choices (size), optional add-ons with limits and prices, one "Goes well with" item from the shop's bought-together data (server-priced, never on a reorder), allergens per §2 item 3, quantity, **Add · <price>**. **NEW** (overrides §29.3's one suggestion per order, see §8) |
| 25 | Adds from the native catalogue an item that has options | After the cart arrives, the bot asks the required choices one at a time (list or buttons), then offers its add-ons once. **NEW** (replaces the `item_options` Flow until #182) |
| 26 | Wants "no onions", "extra spicy" | **Add a note** per item, up to 80 characters, shown on the merchant's card; never changes the price. **NEW** |
| 27 | Asks "does it have nuts?" | Merchant-declared only; otherwise "not confirmed by the shop" + offer to ask the shop on this order (§32.3) |

### 3.5 Basket
| # | Situation | We do |
|---|---|---|
| 28 | Adds an item from a second shop | "Your basket is from Eatout. Start a new one from SEVEN?" **Start new** / **Keep Eatout**. One shop per order (§30.4). **NEW** wording |
| 29 | Below the shop's minimum order | "Add $2.50 more to order from Eatout" + up to 3 of that shop's items that close the gap, server-priced. **NEW** (overrides §29.3, see §8) |
| 30 | Changes quantity or removes an item | From the basket message (buttons) or the web menu; one basket for every path (§39.12) |
| 31 | Price changed since the catalogue | Server price wins, difference shown before confirming (§39.12, §30.1.1) |
| 32 | Leaves and comes back hours later | Basket kept for `basket_keep_hours` (config); one reminder at 30 min, never at night (§29.3) |
| 33 | One upsell | At most one, from the shop's own bought-together items, never on reorders (§29.3) |

### 3.6 Checkout
| # | Situation | We do |
|---|---|---|
| 34 | Ready to order | One summary: items with choices and notes, subtotal, delivery fee, total in USD and LBP, ETA range, address, payment. Buttons: **Confirm**, **Change**. Only Confirm places the order. |
| 35 | Pays cash | Currency USD or LBP (built), then **NEW**: "Do you need change?" **Exact**, **$20**, **$50**, **$100**, or LBP; the answer goes on the driver's card (§27.8 #17 float) |
| 36 | Over the COD cap ($150, or $50 before a first delivered order, §29.4) | Offer the Whish link once online payment is live (§20.1); until then the message shows the cap from config and says online payment is coming soon. Never suggest splitting the order (the cap is a cash-custody control, §21.4). |
| 37 | Promo or referral | §30.3.7 discount line shown in the summary |
| 38 | Tip | At checkout (one optional row, default none) or after delivery (buttons with amounts from config, Other), 100% to whoever delivered (§27.8 #18). A tip is a ledger entry through the order's payment path: cash entered by the driver at the door, or the Whish/Tap link when online payment is live. |
| 39 | Pickup instead of delivery | Pickup code, shop address and opening time (built) |

### 3.7 After ordering
| # | Situation | We do |
|---|---|---|
| 40 | Waiting for the shop | "Sent to Eatout. They usually confirm in under a minute." Accepted → ETA range (built) |
| 41 | Shop rejects or doesn't answer | Apology, reason in plain words, and the 3 closest shops with the same dish as buttons, basket rebuilt on one tap where items match. **NEW** for the rebuild |
| 42 | "Where is my order?" any time | Status + ETA + driver's WhatsApp when on the way (built, §27.3, §27.8) |
| 43 | Running late | Told once the slip passes 10 min (§27.8 #2), with the new range |
| 44 | Wants to cancel | Free until accepted and 60 s after; later a request to the shop (§30.3.6) |
| 45 | Wants to tell the shop something | During an active order, a typed message is passed to the shop as an order note; the shop's own number is never shared. **NEW** |
| 46 | Driver can't find the house | Live-location button for the customer; driver calls (§27.8) |
| 47 | Customer not answering at the door | §27.8 #12 |

### 3.8 Delivered, and problems
| # | Situation | We do |
|---|---|---|
| 48 | Food arrives | Delivery code when required (§27.6); then "Enjoy!" + **Received** / **Problem**; rating 30 min later (built) |
| 49 | Missing or wrong item | **Problem** → which item (list) → optional photo → the server decides by §20.1: the shop resends it, or a refund to the original online payment; **NEW** for cash orders: a discount line on the next order, recorded in the ledger, no cash value, not stored money, expiring after a configured number of days, charged to the merchant only when the merchant caused it, otherwise funded by Alo King (§20.1) |
| 50 | Cold, spilled, or very late (past the ETA range by the configured threshold) | Handover photo decides (§27.8 #14). Online orders: refund to the original payment per §20.1. **NEW** for cash orders: a `late_discount_usd` discount line on the next order (amount and the lateness threshold in dated config), once per order, same ledger rules as #49. |
| 51 | Wants a human | Handoff with Rasheed as the named human (§30.6) |
| 52 | Reorders | "The usual?" button with last order and its current server price (§30.1.5) |

### 3.9 Trust and privacy
| # | Situation | We do |
|---|---|---|
| 53 | "What do you remember about me?" | Shows the remembered facts; delete any or all with one tap (§39.6) |
| 54 | STOP, "delete my data" | Immediate (built) |
| 55 | Marketing | Only to customers who opted in, approved templates, STOP honoured (product rules) |

## 4. The web menu (`aloking.com/m/<shop>`), in detail (NEW)
- **Opened** from an **Open menu** CTA-URL button in the chat. The link is signed, short-lived (24 h) and bound to the customer's phone and current basket; no login, no app.
- **Top:** shop cover photo, logo or crown fallback, name, cuisine · village, delivery fee to the confirmed address, ETA range, open until. "Not on Alo King yet" shops never get a web menu.
- **Body:** sticky section tabs; item rows with photo right, title, one-line description, price; items without photos as clean text rows; sold-out items hidden.
- **Item sheet:** as §3.4 #24.
- **Cart bar:** sticky "View basket · 3 items · $18.50"; the basket screen shows items, notes, subtotal and the fee; **Continue in WhatsApp** saves the server basket and returns to the chat, where the bot sends the §3.6 summary. Price and total are always the server's.
- **Languages:** Arabic (RTL) and English, chosen from the chat language; French by the same files when ready.
- **Quality bar:** loads under 1.5 s on 4G, works at 360 px width, no layout shift, the same design system as the site (§39.11).
- **Same data** later drives the Flows (#182), so modifiers, sections and photos live in the database, not in the page.

## 5. The native catalogue, polished to its limit (NEW)
- Titles and descriptions per §2 items 2–3; `brand` = shop name; `link` = the item's aloking.com page (noindex in demo mode), never the image URL.
- Only items with a real photo sync; best sellers with photos first; one product set per shop.
- ~~The header catalogue icon stays off (§39.13); the cart stays on.~~ Reversed on 16 October: the icon and the cart both stay on (§39.15.2); reversed again on 17 October (§39.15.11): icon off, cart on.

## 6. Investor demo path (6 minutes, Rasheed's phone)
1. "Hi" → welcome → **Order** → pin in Baakleen.
2. "What are you craving?" → Burgers → SEVEN Burgers → cover → **Open menu**.
3. In the web menu: a burger with a size and two add-ons, a note "no onions", fries from "Goes well with" → **Continue in WhatsApp**.
4. Summary in USD and LBP → cash in USD → change for a $50 note → **Confirm**.
5. On the merchant side (same phone, `#merchant`): accept → ready → out for delivery → delivered with the code.
6. Customer: **Received** → tip $1 → rating → "The usual?" on the next "hi".
7. Bonus: type "shawarma" → results from three shops in one message; ask for an unclaimed shop → "Ask them to join".

## 7. Build placement
- Session **5f**: §§2, 3.1 #1–7, 3.3 #16 and #21, 3.4, 3.5 #28–29, 3.6 #35 and #38, 3.7 #41 and #45, 3.8 #49–50, §§4–6. Each NEW line gets a test (unit, SQL or a simulator scenario); the 5-scenario smoke suite runs once at the end (§36 test diet).
- After API credit (5c items): AI parts of #4, #5, #17, #18.
- After Meta verification (#182): Flows on the same data.

## 8. Overrides and new money rules for §39.14 to adopt
- **§29.3 upsell:** the web menu shows one bought-together "Goes well with" item per item sheet (§3.4 #24), and a below-minimum basket shows up to 3 items that close the gap (§3.5 #29); the chat still sends at most one upsell per order and none on reorders.
- **§27.8 #14 and §20.1, cash orders only:** missing, wrong, damaged or late cash orders get a ledger-recorded next-order discount line (§3.8 #49–50); online orders keep refunds to the original payment.
- **New config keys (dated):** `late_discount_usd`, `late_threshold_min`, `discount_expiry_days`, tip amounts, `basket_keep_hours`.
- **Waitlist:** a customer-requested utility notice when a place switches on (§3.2 #11).
- Everything else marked **NEW** is copy, layout or flow and needs only its LOG.md line.

## 9. Amendments after the 16 October live test (DECISIONS §39.15)
- **#11 outside the boundary:** demo testers get three demo addresses instead (§39.15.3); everyone else keeps the waitlist and pickup buttons. The waitlist notice is never marketing (§39.14).
- **#28 second shop, and carts from several shops:** a cart is never partly dropped. A cart from several shops asks which shop first and keeps the rest as saved carts; a cart meeting another shop's basket offers **Switch to B**, **Keep A**, **Do both** (§39.15.2).
- **Every error message carries a button** (Try again, Change address, Help). Routing problems never stop a checkout: the place-level road distance is the fallback (§39.15.1).
- **The header catalogue icon is off (17 October, §39.15.11):** customers shop through the location-first bot, Explore and the web shop menu, with ice breakers and `/order`, `/explore` commands always one tap away; the cart stays on. Titles still name the shop and carts from several shops are still split.
- **Native catalogue item (§5):** title "<Item> · <Shop>", the item part in one language, Title Case; description starts with shop · village; no photo credits in descriptions or captions; `link` = the item's public page `/<lang>/i/<item id>` with its credit, nutrition (estimated), allergens (declared only), extras and "Goes well with", and an **Add in WhatsApp** button that returns to the chat with the item (§39.15.2).
- **Counts and reach:** every count equals what opens; items Meta has not approved, or without a photo, follow as a list, so nothing is unreachable (§39.15.2).
- **Product carousel** (10 swipeable cards) for "Popular near you" and the one "Goes well with" in chat (§39.15.2).
- **Demo testers** anywhere in the world, with the shop side played by the demo autopilot when Rasheed doesn't tap (§39.15.3).
- **AI and voice:** switch on for owners and demo testers as soon as the API credit works and the evals show zero safety failures; for everyone at the §32.4 targets (§39.15.9). The AI parts of #4, #5, #17 and #18 then run.
- **17 October 18:24 (DECISIONS §39.15.13): the customer app lives inside WhatsApp.** No website for customers: the native chat path (product messages, native cart) is primary now; the full app (home, shops, shop page, item page with options, basket) is a dynamic WhatsApp Flow that goes live when Meta verifies the business (#182). The header catalogue icon stays on. §4's web menu is a last-resort "Full menu" row only, until the Flow app is live.
