# Customer experience on WhatsApp: every scenario, decided (16 October 2026)

**Status:** binding, as an extension of DECISIONS.md (§39.14 points here). Written by Claude for Rasheed on 16 October, walking the app as a customer. Where a line repeats an earlier decision it cites the section and changes nothing. **NEW** marks a decision made here. Where this file and DECISIONS.md disagree, DECISIONS.md wins and the conflict is logged in LOG.md.

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

1. **Language:** reply in the language of the customer's last message (Arabic, English, French, Arabizi → reply in Arabic script unless they write Arabizi only, then English letters are fine). Buttons in the same language. Never mix two languages in one line. **NEW**
2. **Item titles** in one language: the shop's own name if it is Latin, else English; Title Case, never ALL CAPS; sizes once ("Soft Drink 1.5 L"). The Arabic name goes in the description (catalogue) or under the title (web menu). **NEW**
3. **Item description**, never empty, never "Menu": shop · village; Arabic name; what is in it (the menu's text, else the dish library marked "usually"); allergens and estimated calories when known, marked "estimated" (§32.3, §39.5); "Extras chosen after you add it" when the item has options. **NEW**
4. **Prices** always as `$6.50 · 581,750 LBP` on totals (dual currency at the rate locked on the order, product rules); item prices in USD only. Western digits in every language. **NEW**
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
| 11 | Outside the boundary (Damour, Chehim) | "We don't deliver to Damour yet." Buttons: **Tell me when you do** (dated waitlist, opt-in), **Pick up instead** (if a shop is within `pickup_search_km`). **NEW** waitlist |
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
| 24 | Opens an item in the web menu | Large photo, title, Arabic name, description, price, required choices (size), optional add-ons with limits and prices, "Goes well with" (2–3 items from the same shop, rule-based), allergens and estimated calories, quantity, **Add · $7.50**. **NEW** |
| 25 | Adds from the native catalogue an item that has options | After the cart arrives, the bot asks the required choices one at a time (list or buttons), then offers its add-ons once. **NEW** (replaces the `item_options` Flow until #182) |
| 26 | Wants "no onions", "extra spicy" | **Add a note** per item, up to 80 characters, shown on the merchant's card; never changes the price. **NEW** |
| 27 | Asks "does it have nuts?" | Merchant-declared only; otherwise "not confirmed by the shop" + offer to ask the shop on this order (§32.3) |

### 3.5 Basket
| # | Situation | We do |
|---|---|---|
| 28 | Adds an item from a second shop | "Your basket is from Eatout. Start a new one from SEVEN?" **Start new** / **Keep Eatout**. One shop per order (§30.4). **NEW** wording |
| 29 | Below the shop's minimum order | "Add $2.50 more to order from Eatout" + 3 suggested items from that shop. **NEW** |
| 30 | Changes quantity or removes an item | From the basket message (buttons) or the web menu; one basket for every path (§39.12) |
| 31 | Price changed since the catalogue | Server price wins, difference shown before confirming (§39.12, §30.1.1) |
| 32 | Leaves and comes back hours later | Basket kept 24 h; one reminder at 30 min, never at night (§29.3) |
| 33 | One upsell | At most one, from the shop's own bought-together items, never on reorders (§29.3) |

### 3.6 Checkout
| # | Situation | We do |
|---|---|---|
| 34 | Ready to order | One summary: items with choices and notes, subtotal, delivery fee, total in USD and LBP, ETA range, address, payment. Buttons: **Confirm**, **Change**. Only Confirm places the order. |
| 35 | Pays cash | Currency USD or LBP (built), then **NEW**: "Do you need change?" **Exact**, **$20**, **$50**, **$100**, or LBP; the answer goes on the driver's card (§27.8 #17 float) |
| 36 | Over the COD cap ($150, or $50 before a first delivered order, §29.4) | Offer the Whish link once online payment is live (§20.1); until then "orders above $50/$150 are paid online, coming soon" and split suggestion. |
| 37 | Promo or referral | §30.3.7 discount line shown in the summary |
| 38 | Tip | After delivery, buttons $1 / $2 / Other; 100% to whoever delivered (§27.8 #18). Not at checkout in the pilot. **NEW** (keeps checkout short) |
| 39 | Pickup instead of delivery | Pickup code, shop address and opening time (built) |

### 3.7 After ordering
| # | Situation | We do |
|---|---|---|
| 40 | Waiting for the shop | "Sent to Eatout. They usually confirm in under a minute." Accepted → ETA range (built) |
| 41 | Shop rejects or doesn't answer | Apology, reason in plain words, and the 3 closest shops with the same dish as buttons, basket rebuilt on one tap where items match. **NEW** for the rebuild |
| 42 | "Where is my order?" any time | Status + ETA + driver's WhatsApp when on the way (built, §27.9) |
| 43 | Running late | Told once the slip passes 10 min (§27.8 #2), with the new range |
| 44 | Wants to cancel | Free until accepted and 60 s after; later a request to the shop (§30.3.6) |
| 45 | Wants to tell the shop something | During an active order, a typed message is passed to the shop as an order note; the shop's own number is never shared. **NEW** |
| 46 | Driver can't find the house | Live-location button for the customer; driver calls (§27.8) |
| 47 | Customer not answering at the door | §27.8 #12 |

### 3.8 Delivered, and problems
| # | Situation | We do |
|---|---|---|
| 48 | Food arrives | Delivery code when required (§27.6); then "Enjoy!" + **Received** / **Problem**; rating 30 min later (built) |
| 49 | Missing or wrong item | **Problem** → which item (list) → optional photo → the server decides by §20.1: the shop resends it, or a refund to the original online payment; for cash orders a discount line on the next order (expires in 60 days, like §30.3.7, not stored money). **NEW** for cash orders |
| 50 | Cold, spilled, very late (more than 30 min past the ETA range) | Apology; a config `late_credit_usd` discount line on the next order, once per order; charged per §20.1. **NEW** |
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
- The header catalogue icon stays off (§39.13); the cart stays on.

## 6. Investor demo path (6 minutes, Rasheed's phone)
1. "Hi" → welcome → **Order** → pin in Baakleen.
2. "What are you craving?" → Burgers → SEVEN Burgers → cover → **Open menu**.
3. In the web menu: a burger with a size and two add-ons, a note "no onions", fries from "Goes well with" → **Continue in WhatsApp**.
4. Summary in USD and LBP → cash in USD → change for $50 → **Confirm**.
5. On the merchant side (same phone, `#merchant`): accept → ready → out for delivery → delivered with the code.
6. Customer: **Received** → tip $1 → rating → "The usual?" on the next "hi".
7. Bonus: type "shawarma" → results from three shops in one message; ask for an unclaimed shop → "Ask them to join".

## 7. Build placement
- Session **5f**: §§2, 3.1 #1–7, 3.3 #16 and #21, 3.4, 3.5 #28–29, 3.6 #35 and #38, 3.7 #41 and #45, 3.8 #49–50, §§4–6. Each NEW line gets a test (unit, SQL or a simulator scenario); the 5-scenario smoke suite runs once at the end (§36 test diet).
- After API credit (5c items): AI parts of #4, #5, #17, #18.
- After Meta verification (#182): Flows on the same data.
