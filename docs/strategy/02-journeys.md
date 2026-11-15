# Alo King strategy, part 2: the five journeys

Planning chat, 15 November 2026. "Today" is `main` at 711c2ca and staging, checked read-only. Session names are the ones used in the session plan (part 6). Readiness is for real orders, out of 10.

| Journey | Readiness | The gap that matters most |
|---|---|---|
| Customers | 6 | A hand-off silences the chat; no pictures; no self-service after confirmation |
| Vendors | 2 | Shapes only; correct for now |
| Riders | 5 | Logic built and tested; nothing proven on a real phone; no joining, terms or training |
| Dark store | 4 | No lots, bins, purchase orders, temperature log or packing rules; no real costs |
| Operations | 5 | Alerts wake nobody; one admin; no reports |

---

## 1. Customers

| Step | Today | World-class | What goes wrong, and the recovery | AI |
|---|---|---|---|---|
| First contact | Any message goes to the Concierge. No welcome, no privacy line | One welcome on the first message ever: what we do, hours, three buttons (Order, Browse, Do you deliver to me?), one privacy line | Outside the area: a polite "not yet", the village logged as demand. Closed: the order is kept for opening (built, K1) | Language detected from the first message |
| Discovery | Search by words (the chat's matcher). WhatsApp catalog built in code; waits on Meta steps and approved pictures (0 of 291) | Catalog in the chat, the website, and "what do you have for..." answered from the catalog | Item not sold: said plainly, logged (`log_demand`, built), nearest thing offered once | Search words per item, built automatically (1.23) |
| Building the order | Text and voice notes; item F1 0.91, zero wrong products on the gate. Open: a size-only line read as a product; «بدي أغراض لمجدرة» read as off-topic | Text, voice, catalog cart and a photo of a handwritten list all end in the same card; "the usual" in one tap | Unclear item: one question with buttons, never two in a row. Wrong item on the card: Edit | Reading, matching, the question |
| Place | Pin decides village and fee; house and floor asked once; saved places | The same, plus approved local landmarks on the rider's card | No pin (older customers): village and landmark in words, the rider phones. Pin outside the area: "not yet" | Address words read into fields |
| Time | Now, or a delivery window (W1) | Fixed rounds for far villages, shown as the default there | Window full: never offered (built). Round missed: next round offered | Times in words read by code, not the model |
| Card and confirm | Card with lines, fee, total, address, payment; Confirm, Edit, Cancel. The agent cannot confirm | Add two one-tap choices: if an item is missing (best match, ask me, remove) and "which note will you pay with?" | Stale price or stock at confirm: re-quoted and said (built) | None: code only |
| Payment | Cash in USD or LBP at the day's rate; Whish and OMT by screenshot, read by vision, confirmed by a person; late and over payments handled (F1) | The same now; Whish Pay link when the merchant account exists | Wrong amount: held for a person. Unreadable picture: asked again. A forged screenshot: the person checks the Whish app, never the picture alone | Screenshot reading (proposal only) |
| Tracking | Status answer on request; "on the way" and "delay" templates pending at Meta; no tracking page | One message per stage at most (budget 4 per order in settings; measured 14 across both lines); a tracking link (WEB2) | Template not approved: the stage is sent only inside the open window, and the tracking link carries the rest | Delivery promise learned from measured times (L1) |
| Delivery | "Rider at the door" template approved; door wait 8 or 12 minutes; cash collected by button | A four-digit handover code for prepaid and gift orders | No answer: rider waits, phones, then failed delivery and the return flow (built); the fee is charged (setting) | None |
| Problems | Complaint cases, refunds and credit exist in SQL; a missing item at the shelf is told to the customer. No self-service; the hand-off lock | Missing item recorded by the picker: automatic credit within a limit. Anything else: a photo and a case beside the chat (HO1) | Allergen complaint: high-priority exception (built) | Reply drafted for the person |
| Cancel | Before confirmation: button. After: "too late here, write to us" | Free until picking starts, self-service; after that the customer sees exactly what can be refunded | Paid and cancelled: becomes credit (built), paid out on request | Cancel words recognised by code |
| Refund | Credit by default; payout function exists; second approval above $20 | The same; refund to the original method when asked | A wrong refund: second approver (Hussein) | None |
| Reorder and loyalty | "Same as last time" re-priced (`repeat_plan`); stated memory with forget commands; feedback asked 10 minutes after delivery | "The usual" button; restock reminders only for opted-in customers; stamp card after four clean weeks | A remembered item now out of stock: named first | Memory proposes, the customer confirms |

**Build order:** HO1 (never stranded) → SIM1's findings into lane B → T1 friends' test → CX1 (welcome and privacy line, missing-item preference, "which note", self-service cancel until picking, handover code, pickup at the hub) → PIX and the Meta catalog steps → WEB2 (cart, checkout, tracking) → "the usual" and the list photo after pilot week 2 → stamp card after four clean weeks.

---

## 2. Vendors (designed now, built at the first signed vendor)

| Step | Today | World-class | What goes wrong, and the recovery | AI |
|---|---|---|---|---|
| Signing up | Nothing public; `approve_merchant()` is the only door | A sign-up page and a "I have a shop" path on WhatsApp that collect name, village, owner, hours and a menu photo. Inbound only; no outreach | A stranger claims someone's shop: one visit by Bassem before approval | None |
| Terms | Not written | Commission, who pays for a cooked and undelivered order, settlement day; accepted by a tap, stored | Dispute later: the stored acceptance | None |
| Menu and modifiers | Import from a link (`menu-fetch.ts`), approved by a person; no options tables | Photo, PDF or link in; items, prices, options (size, extras, without) proposed; the vendor confirms on WhatsApp; ops approves; a staff test order before going live | A price read wrong: the vendor's confirm step; nothing live without approval | Menu extraction, search words |
| Declarations | Food-facts tables exist | Allergens and halal as the vendor declares them, labelled as such | A wrong declaration: liability wording from the lawyer | None; never inferred |
| Receiving orders | Old templates removed; adapters exist | A card with Accept, Accept in X minutes, Can't make an item. Reminder at 2 minutes, ops phones at 4, customer offered another choice at the limit | Phone off: ops calls; repeated misses pause the vendor automatically | None |
| Prep and handover | Fulfilments per source | "Ready" button; the rider timed to the kitchen | Food ready, no rider: ops alert; who pays is in the terms | Prep time learned per vendor |
| Changes by message | Nothing | "Closed tomorrow", "no brown bread", "40 minutes tonight": read into one proposed change, confirmed by a tap, undo for 10 minutes. Prices and new dishes go to ops | Misread message: nothing changes without the tap | Message to proposal (narrow function) |
| Statements and payouts | Ledger accounts for merchant payable and commission | Weekly statement and payout by Whish; when the vendor's driver collects, the commission is owed to us | Disagreement: the statement lists every order | Statement text from SQL facts |
| Performance and growth | Nothing | Weekly report by message: orders, acceptance time, missed orders, what customers asked for that the menu lacks | None | "Customers asked 14 times for X" |

**Decision:** no vendor machinery before pilot week 4. Two things earlier: the sign-up page (in DS1 and UX3) and suppliers who behave like vendors without the machinery (bakery, butcher, water gallons, gas), bought by the dark store on order. **Build order:** sign-up page → E1 (menus with options, kitchen card, escalation) → E2 (changes by message, vendor's own delivery) → E3 (combined orders).

---

## 3. Riders

| Step | Today | World-class | What goes wrong, and the recovery | AI |
|---|---|---|---|---|
| Joining | Added by a workflow; no application, no documents | A short application (page or WhatsApp): ID, licence, bike papers, insurance; Bassem meets each one | False papers: photo of each document kept in the private bucket | Document photo read into fields (proposal) |
| Terms | Not written | One page, accepted by a tap: fees and tips are theirs, cash cap, cash drops, shortfalls recorded and never deducted, location only during a job, conduct at the door | Later dispute: the stored acceptance | None |
| Training | None | Six screens and one practice job with the test order; a pass mark before the first real job | Fails the practice: repeats it | A helper on the staff line for "how do I" |
| Shift | Start and close by button; statement | The same, with the float counted at start | Forgets to close: closed by ops with a named person (today `close_shift` records nobody) | None |
| Dispatch and batching | Offer for 90 seconds; up to 3 orders, 8 minutes of detour; "no rider" alert every 5 minutes | Rounds per village, on-demand in the core ring; offers ranked by position and fairness | Nobody accepts: ops reassigns, customer told honestly | Rules now; learned ranking later |
| Route and ETA | Ring estimates in `travel_times`; nothing measured | Times measured per village and hour; the pin link and landmark on the job card | Road closed, snow, a security pause: the village switch | ETA from our own deliveries (L1) |
| Pickup | Cash cap checked at pickup; a generic error when over | A plain "hand in cash at the hub first" | Wrong bag: the bag label (order code, village, chilled) | None |
| Proof of delivery | Delivered and cash amount by button | Plus the handover code for prepaid orders | Customer denies receiving: the code and the timeline | None |
| Cash | USD and LBP counted separately; soft 150, hard 200; shortfall over $0.25 recorded, never deducted | The note the customer will pay with on the job card, so change is ready | Damaged or doubtful note: the damaged-note path (built) | None |
| Daily close | Statement: cash held, earnings, hand-over | Earnings shown live through the shift; prepaid fees paid out at close | Count differs: recorded for review, the rider signs by tap | None |
| Earnings | 100% of fees and tips; guarantee setting at 0 | The eight-week guarantee as a weekly top-up: guaranteed hours times the rate, less earnings, capped | Idle riders: hours follow demand, shown in the weekly report | None |
| Safety and help | Incident flow built (rider off, transfer, cash received); no pages on the console | An SOS word, a night rule, insulated bags, insurance, a named person to call | Accident mid-job: transfer to a second rider (built), customer told by template | Voice note turned into text for ops |

**Build order:** prove the buttons on real phones with a second test number (T1) → RD1 (application, terms, training, guarantee report, rounds, handover code, the note for change, the plain cash-cap message, the village pause) → L1 (timeline and measured times) → insurance and legal status (part 4, with the lawyer). A rider web page only above about 10 riders or when staff-line messages cost real money.

---

## 4. The dark store and logistics

| Step | Today | World-class for one small hub | What goes wrong, and the recovery | AI |
|---|---|---|---|---|
| Assortment and prices | 291 items; no supplier cost entered; margin 20% is a placeholder | 60 to 120 fast movers on the shelf; the rest next day, bought on order | A price moves: change above 10% needs approval (built) | Margin warnings from cost history |
| Suppliers and purchase orders | Suppliers, payments and credit notes exist; no purchase order | An evening proposal per supplier; the founder approves; sent as a message or PDF | Short delivery: receive what came, credit note (built) | Quantities proposed from sales rate and lead time |
| Receiving | `receive_goods` with cost and expiry; label scan built | Invoice photo read into lines; expiry and lot per line; put-away bin suggested | Unknown item: starts product intake | Invoice and label reading (proposals) |
| Shelf locations | None | Bins by zone, aisle, shelf; the pick list in walking order | Item in the wrong bin: corrected at the next count | None |
| Cold chain | Nothing recorded | Generator subscription and a UPS; fridge temperature logged twice a day by a photo of the thermometer; chilled picked last into an insulated bag | Out of range or a long cut: hold all chilled items in one tap (`hold_product` exists), write off by rule | Thermometer photo read into a number |
| Counts | `count_stock`, adjustments with approval | Ten bins a day, chosen by value and by recent "missing at pick" | Count differs: adjustment with a reason and a second person above the limit | None |
| Expiry | An expiry date per receipt; no lots, so first-to-expire cannot be enforced | Lots; the pick list names the earliest lot; an expired lot cannot be picked | Near expiry: listed daily for markdown or removal | None |
| Picking | On the staff line: start, missing, substitute, done; no console page | Console pick queue (D4b); scan to pick by phone camera later | Shelf empty: written off, recount raised (built) | None |
| Packing | No rules | A short checklist on "done": chilled bag, eggs and bread on top, bag label printed or written | Damaged in the bag: photo, case, credit | None |
| Substitutions | Flow built, switched off | The customer's preference from the card; "ask me" uses the built flow with a picture | No answer in 5 minutes: removed (built) | Substitutes ranked by what customers accepted |
| Losses and theft | Adjustments logged with who | Weekly loss report by category and by person; two people for write-offs above a limit | A pattern at one picker: shown, a person decides | Outlier flags (statistics) |
| Replenishment | `unmet_demand` view | Reorder point per item; the evening proposal | Stock-out of a fast mover: counted as lost sales in the report | Statistics now |
| Forecasting | None | Day-of-week averages after eight weeks; seasons (Ramadan, summer) by hand | A bad forecast: the founder approves every order anyway | Learning model only when averages are measurably worse |
| Cash at the hub | Drawer cannot go below zero; day open and close | A locked box, a daily drop, two-person count (part 4) | Count differs: over or short recorded at close | None |
| Recalls | `recall_orders` built | The same | A recalled lot: customers listed by lot | None |

**Build order:** real costs for the fast movers (founder, Bassem) → D4b (pick queue page) → WH1a before the shadow run (lots and expiry rule, bins, temperature log, packing checklist, simple purchase orders) → WH1b during the pilot (camera scanning, invoice reading, reorder proposals, count plan) → forecasting after eight weeks of data.

---

## 5. Operations

| Area | Today | World-class | What goes wrong, and the recovery | AI |
|---|---|---|---|---|
| Console | 27 pages; Today is an exception inbox (D5); plain look; 24 pages in English only | Six groups, a command bar, comparisons on every number (DS1, UX2) | Console down: the staff line still works; the paper fallback | None |
| Alerts | WhatsApp message to the staff line; push built but off; `agent_handoff` not high priority; no uptime check for Alo King | Every alert has an owner, a timer and one action; push to the phone; a quiet-hours rule | The owner does not react: second person at 5 minutes | Grouping of related alerts |
| Hand-off inbox | Chats page with release; the lock | Cases beside the chat with timers and a drafted reply (HO1, part 5) | A person goes quiet: the bot resumes after 10 minutes | Reply draft; the person sends |
| Staff roles | Admin, ops lead, picker; one admin; Hussein has no account; staff added by workflow | A deputy trained; Hussein as second approver; riders and vendors see only their own statement | The founder is unreachable: the deputy and the paper fallback | None |
| Daily routine | Day open checklist, day close, nightly report at 21:40 | Open (rate, float, temperature, staff), two checks, close; the daily summary replaces checking | A day that does not close to zero: traced before the next opens | Summary text from SQL facts |
| Weekly routine | Nothing | Thirty minutes on eight numbers: orders, repeat, margin, on-time, missing items, rider earnings, stranded chats, AI cost | A number crosses a stop condition: the gate applies | "What changed this week" |
| Reports | Day close, margin, demand and AI cost as views; no page | AN1's reports with comparisons and CSV | None | None |
| Founder assistant | Planned (AN1b) | Read-only questions over the reports; every suggestion is a link to a form | A wrong answer: it can only read | The assistant itself |

**Build order:** HO1's case functions → OPS1 (push secrets, `agent_handoff` and case kinds as high priority, three free uptime checks, Hussein's account, Sentry on the console and the website) → DS1 shell → D4b → AN1 (daily summary first) → UX2 → AN1b.

---

## Sessions named in this part
SIM1 simulated customer test · HO1 never-stranded hand-off · OPS1 alerts that wake someone · T1 friends' test · CX1 customer pack · PIX pictures · DS1 design system and flagship screens · WEB2 cart and checkout · UX2 and UX3 remaining pages · D4b pick queue and rider pages · RD1 rider pack · WH1a and WH1b warehouse · L1 places and measured times · AN1 and AN1b reports and assistant · E1 to E3 vendors.
