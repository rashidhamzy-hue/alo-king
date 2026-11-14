# Alo King: the system plan for Rashid

Nov 14, 2026 · @Hussein Slim

## How to use this doc

This is one message for Rashid that covers what comes after the eight sessions of 13 and 14 Nov.

1.  **When to send it:** now. All eight sessions merged on 14 Nov.

2.  **What to run:** one Fable 5.2 session, alone, at the start of a fresh usage window, with the prompt in the last section. It reads the whole repo and this doc, audits what is built, and writes the plan and the prompts for every session after it. It writes no product code.

3.  **What it produces:** docs/SYSTEM_PLAN.md (how Alo King grows and learns), audit findings, an updated docs/BUILD_PLAN.md with the next sessions (model, files, migration numbers, what runs in parallel), and the prompts to paste for each one.

4.  **Then:** the next sessions run on Opus or Sonnet, two or three at a time on the 100 USD plan, exactly as the plan orders them.

Everything here follows the rules already in CLAUDE.md: Postgres owns money, stock and order state; the AI proposes and deterministic code executes; food facts only from real sources, approved by a person; one gateway for every outbound message; marketing off for the pilot.

## Where things stand (repo of 14 Nov, after the eight sessions)

All eight sessions merged: K1 (catalog in code, kept orders, saved-place recheck), C3 (scheduled delivery in the database), A4 (alarms, costs, latency views, English and French templates), D3, P2 (research loader) and R1 to R3 (research files for all 291 items). Typecheck is clean; 931 tests pass per A4.

What the review found, in order of importance:

1.  **Replies are too slow.** A4 measured typed messages on staging at 15.9 seconds median and 19.4 at the 90th percentile; the founder's 07:00 message took 21.8 seconds. The target is under 10. Causes, measured: a fixed 6-second wait for more messages on every text, about 2 seconds of database calls before the model starts, and a second model call on the "ask" path. This is the first fix after the audit.

2.  **Research files are uneven.** Of 291 items, 202 have picture candidates, 86 nutrition, 56 ingredients, 44 allergen quotes and 14 diet labels. 93 items are matched only as "unsure" and give no facts. The loader has to run on staging (research-load) before anything appears in the console.

3.  **Nothing customer-facing is approved yet:** 0 pictures and 0 food facts approved, names still in a file, so the catalog feed is empty.

4.  **Built but not wired:** customers cannot choose a delivery window yet (lane B request from C3); the catalog waits on Meta steps (RUNBOOK "WhatsApp catalog" A to C) and a feed password secret (lane A request).

5.  **Open requests between lanes** are listed in HANDOFF under K1, C3 and A4. The Fable session must turn every one into a task.

6.  **Already in the database and worth reusing:** orders already carry fulfilments, one per source, so a multi-vendor order is possible without redesign; markets and market_settings exist as schema for expansion; the Deliverect adapter exists as a shape.

7.  **Missing for a professional warehouse:** no pick-by-scan, no lot or expiry tracking per batch, no shelf or bin locations, no FEFO.

## New founder decisions (14 Nov, from the founder's brief to ChatGPT)

The founder also gave ChatGPT a long planning brief. These are its decisions and requirements that are new; the Fable session treats them as founder decisions and records each in docs/DECISIONS.md, with a conflict register where an older decision disagrees.

| New decision                                                                  | What it means                                                                                                                              | Conflict with earlier plans                         | Recommended handling                                                                                                                                                                                                                                                                                                                                  |
|-------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **A customer website at launch**, a real ordering channel, not a landing page | Browse, search, cart, checkout, tracking, history, reorder, on the same products, prices, stock, fees, order states and ledger as WhatsApp | The build plan had the website in Phase 9           | Build a **channel-independent commerce core** first (the SQL functions already are most of it) and the website as a client of it. Day one: catalog, search, cart, cash-on-delivery checkout, tracking, history (the brief's option B). Card payment when a provider approves the company. The web AI assistant after the WhatsApp Concierge is proven |
| **Vendor-operated and third-party delivery**                                  | A restaurant open until 4 am with its own drivers keeps receiving orders after Alo King's riders stop at 11 pm                             | Only Alo King riders today                          | A delivery-provider abstraction on each fulfilment: who delivers, who owns the fee, who is responsible. Build the model now; activate vendor delivery with restaurants (Phase 8)                                                                                                                                                                      |
| **One cart, one vendor at first**                                             | Multi-vendor carts later                                                                                                                   | The founder's combined orders (groceries plus food) | Not a real conflict: fulfilments already allow several sources per order. Keep one source per cart at launch; activate combined orders when data shows demand, with the cost of the extra pickup known                                                                                                                                                |
| **AI acts alone on approved low-risk actions**                                | Powerful automation within written limits                                                                                                  | Consistent with "AI proposes, code executes"        | One table of allowed automatic actions with limits; everything else needs a person (see "When approval can be automatic")                                                                                                                                                                                                                             |
| **One owner-operator, exception-based**                                       | The founder must not watch every transaction                                                                                               | None                                                | Every page and alert is built around exceptions; a daily summary replaces checking                                                                                                                                                                                                                                                                    |
| **Console redesign as the founder's cockpit, installable on a phone**         | Mobile-first, role-aware, an installable web app (PWA), push alerts where supported                                                        | The console is plain server pages today             | Keep the Cloudflare Worker and the SQL permissions; redesign the pages and add the PWA layer. Never weaken audit-before-action                                                                                                                                                                                                                        |
| **Founder AI assistant in the console**                                       | "What went wrong today?", "Which deliveries are at risk?", "How much did we make yesterday?"                                               | None                                                | Read-only tools over existing SQL views; any change it suggests needs the founder's tap                                                                                                                                                                                                                                                               |
| **Vendor commands by message**                                                | "Closed tomorrow", "out of brown bread", "prep time 40 minutes tonight", a new menu photo                                                  | None                                                | A narrow function on the staff line that turns the message into a proposed change, confirms it with the vendor in one tap, logs it, and can be undone                                                                                                                                                                                                 |
| **Warehouse at professional level**                                           | Pick-by-scan, a five-item order needs five scans or an authorised exception; lots, expiry, FEFO, bins, cycle counts                        | Not built                                           | Phone-camera scanning in the console first (cheapest), dedicated scanners only if speed requires                                                                                                                                                                                                                                                      |
| **Live tracking for customers**                                               | A signed tracking link with status and, when authorised, the rider's position                                                              | Not built                                           | Status page first; live position only with rider consent, sampled sparingly                                                                                                                                                                                                                                                                           |
| **Diaspora "send home"**                                                      | Buyer abroad, recipient in Lebanon, card payment, gift orders                                                                              | Phase 9                                             | Research which card processors will actually serve a Lebanese company before designing checkout; never assume Stripe                                                                                                                                                                                                                                  |
| **National expansion without rewrites**                                       | Areas, hubs, zones, providers and prices as data                                                                                           | markets exists as schema only                       | Move village, hub and fee logic onto markets before the second area, not before launch                                                                                                                                                                                                                                                                |
| **A full cost model per operation**                                           | Cost of every step and every order type at 10 to 1,000 orders a day, dark store versus restaurant                                          | docs/COST_MODEL.md is older                         | An editable spreadsheet (CSV in the repo) fed by ai_cost_daily and real prices; A4's first figure is about \$0.002 of AI per order, not \$0.012                                                                                                                                                                                                       |

### What is not adopted from the brief

- **Eight separate documents and a nine-region competitor survey in one session.** On a 100 USD plan that would spend several usage windows producing documents instead of progress, and the 12 Nov innovation review already covers competitors. The Fable session researches only questions that change a decision (listed in its prompt).

- **Rebuilding anything that works** to follow a framework. The brief itself says to extend what exists; the session must justify any replacement.

## The principle: a system that grows

Alo King is not a launch with 291 products. It is a system that will keep receiving new products, new vendors, new menus, new villages, new riders and new customers, every week, for years. Everything done once by hand for the first 291 items must become a repeatable pipeline that runs the same way for the 292nd item and for the hundredth restaurant.

Four rules follow from that:

1.  **One intake pipeline per kind of thing.** A product, a vendor, a menu item, a supplier invoice, a voice note: each enters through one pipeline that does every step in the same order (described in the next section). No special cases for the first batch: the 291 items go through the same pipeline as item 292.

2.  **Every step proposes; a person approves; code executes.** Pictures, names, categories, search words, food facts and costs arrive as proposals with their source. Nothing reaches a customer until a person approves it in the console, and nothing the AI writes changes money, stock or order state.

3.  **The system learns from everything it handles, through proposals.** Every order, miss, substitution, delivery, voice note, label photo and invoice produces something it learns from. Learning never edits live behaviour directly: it produces a proposal, an eval case or a review item, and only an approved change or a change that passes the eval gate goes live (section 4).

4.  **Nothing silent.** A step that fails, or an item the system cannot handle, lands on a review list with a reason. It is never guessed and never dropped.

## Intake pipelines

Today these steps exist as one-off jobs: N1's Open Food Facts run, P1 and P2's picture runs, the R1 to R3 research sessions, B3 and B4's search words. The next stage turns them into **one per-item queue** that starts when an item is added, retries what fails, and shows each item's readiness in the console. The 291 current items run through it like any new one.

<img src="media/image1.png" style="width:6in;height:2.30357in" alt="product intake · 8 steps, one approval" />

product intake · 8 steps, one approval

### Product pipeline

| Step              | What happens                                                                                                            | Exists today                                            | To build                                                                                                                             |
|-------------------|-------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| 1 New item        | Added in the console, found on a supplier invoice, or scanned at receiving                                              | Console catalog page, receiving (D2)                    | One product_intake_jobs queue, started by every new product                                                                          |
| 2 Identity        | Arabic and English names, brand, size, unit, customer category, barcode                                                 | N1 proposals (one-off), 15 approved categories          | Run per item, not per batch                                                                                                          |
| 3 Search words    | Words in Lebanese Arabic, Arabizi, English and French, tested with sample phrases; misses go to the review list         | 1.23, automatic (B4, D3)                                | Already per item: keep                                                                                                               |
| 4 Picture         | Open Food Facts, then store and brand pages, then a photo taken at intake; vision check; uniform white background       | P1, P2, R1-R3 (one-off)                                 | Per item, through the API from GitHub or the Worker, not through Claude Code sessions; approved pictures in a public bucket for Meta |
| 5 Food facts      | Ingredients, allergens with the literal quote, nutrition, diet labels, storage, origin, each with its source and market | N1, R1-R3 (one-off); label reading at intake (5.15)     | Per item; the label photo at intake always wins over web sources                                                                     |
| 6 Price and cost  | Cost from the supplier invoice, selling price, margin check                                                             | Receiving and suppliers (C1, D2)                        | Invoice reading (below)                                                                                                              |
| 7 Person approves | Field by field in the console; allergens only against the real pack                                                     | Pictures (3.18), food facts (5.15), search words (1.23) | One "product readiness" page that lists what each item still lacks                                                                   |
| 8 Live            | Orderable by the bot; in the WhatsApp catalog when it has an approved picture                                           | K1                                                      | Feed updates on approval                                                                                                             |

Research by Claude Code sessions (R1-R3) was right for using spare allowance once. It does not scale: each new item must be researched automatically through the API, for a few cents, with the same rules as data/research/README.md.

### Vendor and menu pipeline (Phase 8, restaurants and other vendors)

1.  **Signed first.** Only a vendor with a signed agreement is orderable (existing rule). The agreement records hours, zones, preparation time and commission.

2.  **Menu intake.** The vendor sends the menu as photos, a PDF or a link. A model extracts items, options and prices as proposals; staff or the vendor approve them line by line.

3.  **Same item steps.** Every approved menu item goes through steps 3, 4 and 7 above: search words, the vendor's own photo first, approval.

4.  **Food facts from the vendor.** Allergens and diet labels for restaurant dishes come only from the vendor's own written statement, stored as vendor_declared, never researched or guessed.

5.  **Changes.** A new menu photo produces a difference (new, removed, re-priced items) for approval, not a silent overwrite.

6.  **Test order** from staff before the vendor goes live.

### Supplier invoice pipeline (فاتورة)

1.  At receiving, staff photograph the supplier's invoice in the console.

2.  A model reads supplier, date, each line's item, quantity, unit cost and barcode when printed. It proposes; it never moves stock.

3.  Each line is matched to a product by barcode, then by search words. An unknown line starts the product pipeline as a new item.

4.  Staff confirm the received quantities; stock moves only through receive_goods. The cost updates the product's cost history, and a price change beyond a set margin goes to the founder for a decision.

5.  The supplier's price history feeds buying decisions and the margin report.

### Agents: no new ones

Alo King has **one conversational agent, the Concierge**, which talks to customers. Everything else that uses AI is a narrow function inside code: the language-pack builder (search words), speech to text, payment-receipt reading, label reading at intake, menu extraction, the picture check, and the product-data mapping. Pickers, riders and ops talk to code, not to a model.

The intake pipelines above are **workflows, not agents**. Each step calls one narrow function, checks its output, and stops at a person's approval. A separate "onboarding agent" or "product agent" would add a second voice that can improvise, which is exactly what must not touch prices, stock or food facts. The rule in HANDOFF.md stays: a new agent is added only when a measured job cannot be done by the Concierge, a function or code.

The one likely candidate, later: when restaurants message the ops line with menu changes and staff cannot keep up (Phase 8, measured by the review backlog), a **merchant assistant** on the ops line that collects the change and passes it to the menu pipeline for approval. Not before restaurants are live.

### Review pages the console still needs

- **Names review:** the 282 proposed Arabic and English names and sizes, approve or correct each.

- **Product readiness:** one row per product with what it still lacks (name, picture, facts, cost, search words).

- **Menu review** (Phase 8) and **invoice review** (with receiving).

## How the agents learn every day

"Learning" here does not mean the AI rewriting itself. It means every event leaves behind data that improves the next answer: new search words, new test cases, corrected transcripts, better time estimates. Each lesson becomes a proposal or a test, and goes live only when a person approves it or the eval gate passes.

| Every...                         | What it teaches                                           | Becomes                                                      | Exists today              |
|----------------------------------|-----------------------------------------------------------|--------------------------------------------------------------|---------------------------|
| Order                            | Which words customers use for which product               | Search-word proposals; eval cases from real phrasings        | Partly (1.23 review list) |
| Miss or wrong match              | Where the planner fails                                   | A review item and a new eval case, before any fix            | Partly (1.22 evals)       |
| Item not stocked                 | What customers want that we lack                          | Unmet demand list for buying (1.12)                          | Yes                       |
| Substitution accepted or refused | Which replacements customers accept                       | Substitution suggestions ranked by acceptance                | No                        |
| Delivery                         | Real time per village, rider and hour; pins and landmarks | ETA estimates; saved places corrected by the pin             | Partly (saved places)     |
| Voice note                       | How Shouf customers speak                                 | Corrected transcripts as eval cases; local vocabulary        | V1 starts it              |
| Intake photo                     | The real pack                                             | Picture candidate and label facts, which outrank web sources | 5.15 built                |
| Supplier invoice                 | Costs, suppliers, unknown items                           | Cost history, new-item intake                                | No                        |
| Customer feedback or complaint   | What went wrong                                           | An ops case, and an eval case when the bot was at fault      | Partly (cases)            |
| Staff correction                 | Where the bot was wrong                                   | An eval case, so the same mistake is tested forever          | No                        |

### The daily routine

- **Every night** a job collects the day's lessons: new phrasings that worked, misses, substitutions, delivery times, complaints. It turns them into proposals and eval cases, and writes a short "what the system learned today" note for the ops lead.

- **Every night** the full eval set runs against the live model and prompt. A drop in accuracy or any wrong product opens an alert before customers see it.

- **Every week** the founder gets a one-page report: orders, misses, what was learned, what waits for approval, cost per order.

### Guardrails that never change

- Learning proposes; it never edits prices, stock, money, food facts or live prompts directly.

- A change to prompts, search words or rules ships only if the whole eval set still passes with zero wrong products.

- Food facts are learned only from sources (the pack, the supplier, the vendor's statement), never from the AI's memory or from customers' guesses.

- Customers' voices and personal data are used only for these purposes, kept for the retention period, and never enter the repo.

## Message design

The founder's test chat on 14 Nov showed the bot's messages as long single paragraphs, product names in English inside Arabic text, prices breaking across lines, no total and no visual markers. It works, but it is hard to read and hides what matters. The fix is session M1, after K1 merges (both touch the ordering files).

### Rules

1.  **One message, one job.** A line break at least every two or three lines.

2.  **Fixed messages are built by code, never written by the model:** the order card, status updates, the closed message and held order, the address request and confirmation, payment messages. One template file per language (ar, en, fr).

3.  **The model's own replies** are at most two short sentences, under the same rules.

4.  **Emojis only from this set, as signposts:** 📍 🛒 🛵 ✅ 💵 🌙 ⚠️ 📦 🏠 🔢, and 👑 in the greeting only. At most three per message, never inside a price, never decorative faces (neutral tone rule).

5.  **WhatsApp bold** (\*text\*) only for headings and the total.

6.  **Product names in the conversation's language.** Arabic chats show the approved Arabic name; until one is approved, the English name is used and the gap is logged. Approving N1's 282 proposed Arabic names is therefore urgent.

7.  **Each price on its own line,** Western digits with \$, so Arabic and English never mix on one line.

8.  **The order card always shows** every line, the delivery fee, the total, the address and the payment method, then the confirm and edit buttons.

9.  **A test renders every template in ar, en and fr** into a snapshot in the pull request, so a person reads them before they ship, and checks the rules above.

### Arabic examples (prices are illustrations)

Location request, with a button \[ إرسال الموقع \]:

أهلا فيك بـ Alo King 👑  
📍 ابعتلنا موقعك من الزر تحت

After the pin:

✅ وصلنا موقعك: بعقلين  
  
بس بدنا:  
🏠 اسم البناية أو أقرب معلم  
🔢 الطابق

Order card, with buttons \[ تأكيد الطلب \] \[ تعديل \]:

🛒 \*طلبك\*  
  
1 × كرتونة مي تنورين 2 ليتر (6 قناني)  
\$2.01  
1 × خبز الفورنو أبيض كبير 800 غ  
\$1.01  
1 × قهوة نجار كلاسيك 180 غ  
\$3.25  
  
🛵 التوصيل: \$1.00  
\*المجموع: \$7.27\*  
  
📍 بعقلين، بيت الاختبار، الطابق 2  
💵 الدفع: كاش عند الاستلام

Shop closed, order held:

🌙 مسكرين هلق، منفتح الساعة 8 الصبح.  
  
حفظنالك طلبك:  
• كرتونة مي تنورين  
• خبز الفورنو  
• قهوة نجار  
  
أول ما نفتح منبعتلك زر للتأكيد ✅

Status updates:

✅ تأكد طلبك \#1042  
🛵 طلبك عالطريق  
📦 وصل طلبك. صحتين!

### English examples

Order card, with buttons \[ Confirm order \] \[ Edit \]:

🛒 \*Your order\*  
  
1 × Tannourine water 2 L (pack of 6)  
\$2.01  
1 × Al Forno white bread, large 800 g  
\$1.01  
1 × Najjar Classic coffee 180 g  
\$3.25  
  
🛵 Delivery: \$1.00  
\*Total: \$7.27\*  
  
📍 Baakline, Test House building, 2nd floor  
💵 Payment: cash on delivery

Shop closed, order held:

🌙 We're closed now and open at 8 am.  
  
We've saved your order:  
• Tannourine water  
• Al Forno bread  
• Najjar coffee  
  
We'll send you a button to confirm when we open ✅

Status updates:

✅ Order \#1042 confirmed  
🛵 Your order is on the way  
📦 Delivered. Enjoy!

The French templates follow the same shapes. The founder and Rashid may change the wording; the shapes and rules stay.

## Testing with two numbers

Yes: for staging, Rashid's personal phone and the two staging business numbers are enough for one person to test both sides.

| Role                              | Number                                         |
|-----------------------------------|------------------------------------------------|
| Customer line (the bot)           | The Kapso US number (in the Kapso dashboard)           |
| Staff line (pickers, riders, ops) | The Kapso sandbox number                       |
| The tester                        | Rashid's personal WhatsApp, chatting with both |

How:

1.  **As a customer:** from his personal WhatsApp, message the US number like any customer. Use the phone app, not WhatsApp Web, so the location pin and voice notes behave as they will for real customers.

2.  **As staff:** register his personal phone with the Kapso sandbox (it sends a 6-character code to the sandbox number). Then add his number as a rider or picker on staging through the console. The database keys identities by line and phone, so the same phone can be a customer on the customer line and staff on the ops line.

3.  **Keep the hourly test order working:** registering a real picker on staging turns on the pick flow, and the automatic test order has no picker, so it would get stuck (HANDOFF warns about this). Add a test picker to the probe first, or register only as a rider.

Limits:

- **Never connect his personal number to the WhatsApp Business Platform.** That would move it off his personal WhatsApp.

- The sandbox reaches only one registered phone and cannot send templates. A second test number is needed before testing two riders at once, a rider and an ops lead on different phones, or the approved templates on the staff line.

- Partners' phones (Bassem, Firas) can join as extra customers at any time with no setup.

- The pilot itself needs the two Lebanese +961 numbers on Alo King's own verified Meta account (A3).

## Points for the audit

From the founder's independent reviews of the repo (13 and 14 Nov). Most earlier findings were already fixed by D2, D3 and B4. These remain, for the Fable session to verify and assign:

**Money and data**

1.  **Diet labels from inference.** N1 proposes "vegan: yes" partly from Open Food Facts' own analysis of the ingredient list (ingredients_analysis_tags), not only from a claim printed on the pack. It records the basis, but the approval page must show it clearly, and an inferred diet label should need the real pack before approval.

2.  **The drawer can still go below zero** through the base pay_supplier and pay_out_credit called directly, and through rider earnings paid at settlement (D3's notes, with the exact fix).

3.  **Never store or show** Nutri-Score, NOVA, eco-score or Open Food Facts' "high in" levels (neutral-tone rule). Show Open Food Facts' credit wherever a fact from it reaches a customer.

4.  **Web research is market-sensitive.** Gulf and European pages describe recipes that may differ from the Lebanese pack. The market is recorded; the label photo at intake must always outrank web sources.

**Security and operations**

5.  Rotate the Kapso webhook secrets before production (the connector showed them in plain text) and use a narrower-scope Kapso key for production.

6.  A real email sender (SMTP) in Supabase before staff accounts are added.

7.  The hourly test order stuck in a hand-off should release itself, or the alarm should say so.

8.  Catalog pictures: Meta fetches them from a stable public address and needs at least 500×500 and a description per item. Use a separate public bucket holding only approved product pictures; receipts and voice notes stay private.

9.  Keep the source of every picture, so any picture can be withdrawn and replaced quickly if a brand or Meta objects (founder decision of 14 Nov).

10. Record which model the extraction escalates to: the current smart model refuses the forced tool choice.

11. A weekly Supabase usage check: the old organisation went over its free limits once.

**Founder decisions still open** (record, do not decide): voice-note transcription through Kapso's provider, which may keep transcripts for up to three years, or another provider after scoring the 51 real notes; the proposed pilot settings in supabase/seed/proposed_pilot_settings.sql.

## The founder's additions (14 Nov)

### Shouf words and places

The Concierge must understand every way people in the Shouf order and give directions, including landmarks that exist on no map, such as عين العتيقة and البيادر in Khraibeh.

- **A places list (gazetteer):** village, neighbourhood and landmark names with spellings in Arabic, Arabizi and English, each tied to a village and, once confirmed, to a pin area. Seed it from the founder, the riders, the 51 voice notes and public maps.

- **It grows from every delivery:** when a rider delivers, the pin, the landmark the customer gave and the rider's confirmation are saved. A new landmark becomes a proposal for staff to approve.

- **The pin still decides** the village and the fee. A landmark helps the rider find the door; it never moves the order to another zone.

### A smarter Concierge, within the rules

Customers will ask things like "we're 4 people and want healthy snacks" or "dinner for 5 children aged 12". The Concierge should answer these with a suggested basket the customer can change, not a refusal.

- **Basket builder:** code proposes quantities from portion rules the founder approves (for example drinks or bread per person), within a budget if the customer gives one; the Concierge explains it in two lines; the customer confirms the normal order card.

- **It asks first** about allergies, diets and budget when it matters, and dietary restrictions always outrank selling.

- **No health claims.** "Healthy" is answered with neutral, factual choices (fruit, nuts, items lower in sugar according to approved nutrition data), never "this is healthy". Food facts only from approved records.

- **Measured:** these requests become eval cases, so the Concierge's suggestions are tested like its order reading.

### Learning from every operation

Every order records the exact time of each step: message received, card sent, confirmed, picker start and done, rider offered, accepted or declined (and how fast), arrival at the hub or vendor, waiting time there, vendor preparation time per item, pickup, delivered, and the distance and route. The same for customers: reply times, edits, cancellations, repeat orders.

From this the system learns delivery times per village, hour and rider; preparation times per vendor and item; which riders accept fastest; and where routes are slow. These feed time estimates and dispatch as proposals and measured rules, never as silent changes. Rider location is collected only during a job, and the privacy notice says so.

### The friends' test (3 testers)

Rashid will invite 3 friends: one in the Shouf, one in Beirut and one in Dubai.

- **A tester list:** their numbers are marked as testers. Their orders run end to end on staging with the test rider, no real goods or cash move, and they can see the order go through every step.

- **Outside the Shouf:** the Beirut and Dubai testers order to a Shouf address, as a family member abroad would (the gift case, Phase 9), or use a marked test address. They should also try an address in Beirut, to confirm the bot politely says it doesn't deliver there yet.

- **Every language:** the testers outside the Shouf will likely write in English, Arabizi or mixed language; that is part of the test.

- **A short test script** of about 15 scenarios: typed order, voice note, landmark directions, a change after the card, out-of-stock item, after-hours order, a basket request ("dinner for 5 kids"), a complaint, an off-topic question, and an attempt to break the bot.

- **Feedback:** after each test order the tester can reply with a note; notes land on a console page as cases.

- **Before they start:** a short privacy notice in the first message, the Anthropic and Kapso spending caps, and the staff line checked.

### More from the founder (voice, 14 Nov)

The Fable session must cover everything needed for a finished product before market, not only the points listed here. At minimum:

- **Payments later:** a card payment gateway for Lebanese abroad sending orders home, and Whish and OMT APIs when available, so customers can pay at checkout. Plan the data model now so adding them later changes no order or ledger logic. Money stays in Postgres; the gateway only reports payments.

- **Customer database:** every customer's profile, saved places with pins and landmarks, order history, preferences and restrictions (stated, never inferred), language, and feedback, kept under the retention rules.

- **Rider voice notes at the door:** a rider can say "I reached Rashid Abou Hamze's house in Khraibeh, 30 metres past Abou Adham's butcher". The note is transcribed and proposed as a landmark on that customer's saved place, and the arrival time is recorded.

- **Stock, inventory and warehouse practice:** receiving, shelf locations, counts, expiry, waste, reorder points, and how the AI helps (forecasts, reorder proposals) without moving stock itself.

- **Offers and broadcasts:** offers on dark-store items and later for vendors, sent only to customers who opted in, within Meta's rules so no number is banned; recommendation and ads plans for vendors and the dark store. Marketing stays locked until the founder unlocks it after the pilot.

- **Vendor onboarding:** the full process from signature to live menu, as one workflow.

- **Daily learning from every error,** across ordering, delivery, stock and support.

- **Everything else:** logistics, cancellations, refunds, the AI architecture and its limits, pictures, the WhatsApp catalog, pricing, keywords in every language, voice-note transcription and understanding, reply speed, and asking when unsure instead of guessing.

### Founder decisions (14 Nov)

1.  **Friends' test is simulated.** The test rider "delivers"; no goods or cash move. No real delivery until launch.

2.  **Prices in dollars.** If a customer asks, the Concierge gives the amount in Lebanese pounds at the day's approved rate.

3.  **Rashid approves** names, pictures, food facts and search words in the console, until an ops lead is hired. The console needs a names review page and a product readiness page so this takes minutes a day.

4.  **Friends' test payments:** cash, plus a Whish or OMT screenshot to test receipt reading. Card payment comes later.

### When approval can be automatic (founder request, 14 Nov)

The founder wants items the system is certain about to go live without Rashid's tap. Certainty is defined by rules code can check, never by the AI's own confidence:

| Field                                                     | Automatic when                                                                                                             | Always a person                                                                                                                                                            |
|-----------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Picture                                                   | Barcode exact match, the vision check passes, and the picture comes from the brand, Open Food Facts or the hub's own photo | When any check is unsure                                                                                                                                                   |
| Names, size, category                                     | Barcode exact match and two independent sources agree                                                                      | Arabic names written by the model, until a reader has approved a sample of 50 with no errors; then automatic                                                               |
| Search words                                              | The 1.23 tests pass (already automatic)                                                                                    | Misses on the review list                                                                                                                                                  |
| Ingredients and nutrition                                 | The label photo taken at intake and a second source (Open Food Facts or the brand) agree for that barcode                  | Web sources alone                                                                                                                                                          |
| **Allergens and diet labels** (halal, vegan, gluten-free) | **Never automatic**                                                                                                        | One tap per item, against the real pack: the same brand can carry a different recipe or certificate in another market, and a wrong allergen can put a customer in hospital |
| Price and cost                                            | Never automatic                                                                                                            | Always                                                                                                                                                                     |

Every automatic approval is logged with the checks it passed, and each day a random one in ten is shown to Rashid for a spot check. If spot checks find an error, that field goes back to manual.

### Vendor notifications (Phase 8, and the hub today)

A vendor must never miss an order. Standard for every order:

1.  **Instant job card** on WhatsApp from the staff line: order number, items with options and notes, the time the rider arrives, and three buttons: Accept, Accept in X minutes, Can't make an item. Sent as an approved utility template, so it reaches the vendor even outside the 24-hour window. Vendors opt in at signing.

2.  **Escalation:** no answer in 2 minutes, a reminder; at 4 minutes, ops is alerted to call the vendor; at a set limit the customer is told honestly and offered another vendor or a refund.

3.  **Missing item:** the vendor taps it; the customer is offered a substitute or removal before anything is cooked.

4.  **Rider timing:** the rider is dispatched to arrive when the food is ready, using the vendor's measured preparation time, and the vendor is told when the rider is two minutes away.

5.  **Printable kitchen ticket** link for busy kitchens, and a daily statement of orders, commission and payouts.

6.  **Measured:** acceptance time, preparation time per item, missed orders. A vendor with repeated misses is paused automatically and ops is told.

### Customer first: experience standards

The Fable session designs every customer and vendor journey against these, and adds whatever else best practice requires:

- **Speed:** most replies within 10 seconds; the order card within 30 seconds of the last message.

- **Clarity:** one clear order card with every line, fee, total, address and payment, and one tap to confirm or edit.

- **Status without asking:** confirmed, being prepared, on the way with an estimated time, delivered; a delay is announced before the customer notices it.

- **Easy repeat:** "same as last time", saved addresses and landmarks, a substitution preference stored once.

- **A human whenever wanted:** "بدي احكي مع حدا" or any complaint reaches a person, with the conversation attached.

- **Problems fixed fast:** missing or wrong items refunded as credit or cash within minutes, with an apology from a person.

- **Asks when unsure:** never guesses an item, an address or a quantity.

- **Respect:** no unrequested messages, offers only to customers who opted in, data kept only as long as the retention rules allow, and the stop option always works.

- **Vendors:** one-tap accept, clear tickets, sold-out by a single message, menu updates by sending a photo, transparent payouts, and a weekly performance report.

### More from the founder (voice call, 14 Nov)

- **Routing and location system:** record the exact route, distance and time of every delivery and pickup, so dispatch learns the real roads of the Shouf and can plan multi-stop runs.

- **Combined orders and shipping:** one customer order can mix groceries from the dark store with food from one or more vendors. One rider collects along the best route (hub and vendors on the way), timed so hot food is picked up last. Design the delivery fee for combined orders (riders keep 100% of fees).

- **Analytics and reporting dashboard:** what customers asked for each day (including what we don't sell), best sellers per vendor and in the dark store, what customers liked and didn't (feedback, refunds, substitutions refused), and the day's errors and what went right. One daily summary for the founder.

- **Loyalty and referrals:** win customers from other apps and keep them, while staying profitable. Founder ideas: first 3 deliveries free, credit after every 30 orders. Riders keep 100% of fees, so a free delivery is paid by Alo King; every reward must be modelled against margin before launch. The innovation review recommends starting with a stamp card (every 10th order earns one delivery).

- **Every vendor type:** bakery, croissants and donuts, manakish, sandwiches, burgers, pizza, pasta, sushi, cafes and more. Each has different options, preparation times and packaging; the menu model and the kitchen job card must handle all of them.

- **Perfect journeys for customers and vendors,** fast and reliable, with daily learning above everything.

- **Grocery only from our own dark store:** no other supermarkets are added as vendors. Vendors are restaurants, cafes, bakeries and similar. A combined order is therefore our groceries plus food from one or more vendors. If one vendor in a combined order cannot deliver, the rest of the order still goes, and the customer is told and refunded for that part.

### Repo hygiene

After every set of build sessions, one short cleanup pass (its own pull request, tests green) keeps the repo clean:

- Delete merged branches, dead code, unused scripts and workflows, stale generated files (such as TEST_REPORT.txt), and one-off outputs that a later step has replaced.

- Move old HANDOFF Status sections into docs/history/ so HANDOFF stays short and current.

- Research and proposal files stay only while they are the source of a pending proposal; once loaded and approved, the database is the record.

- Never in the repo: secrets, customer data, voice notes, photos of people, receipts, invoices, or large files. Those live in private storage buckets.

- Watch GitHub's limits: file and repository size, and the Actions minutes that eval and research runs use on a private repo.

- Keep dependencies updated and the lockfile committed; CI and the secret scan must stay green.

### Platform rules

The Fable session checks the current rules of every service against today's official documentation, records the date it checked, and lists any change the build needs:

- **Meta and WhatsApp:** Business Messaging and Commerce policies; opt-in before any business-initiated message; the 24-hour window; correct template categories (utility versus marketing); the ban on general-purpose AI chatbots (the Concierge stays on ordering and delivery); quality rating and messaging limits; catalog product restrictions; a way to reach a human; business verification and display name.

- **Kapso:** terms, rate limits, webhook signatures, data retention setting, billing.

- **GitHub:** terms, Actions acceptable use, size limits, secrets handling.

- **Supabase:** plan limits and usage, row-level security, backups and point-in-time recovery before real money.

- **Cloudflare Workers:** plan limits (requests, CPU time, queues).

- **Anthropic:** usage policy, API terms, spending caps.

- **Sentry:** quota.

- **Open Food Facts:** database licence (credit, share-alike) and picture licences.

- **Websites used for pictures:** respect robots rules and rate limits; keep every source (founder decision of 14 Nov).

- **Lebanon:** consumer pricing display, data protection and the privacy notice, for the lawyer to confirm.

## Founder actions

These are not build work; no session can do them. In order of urgency:

1.  **Approve the Arabic names** proposed for 282 products. They sit in data/proposals/names.json; no console page shows them yet, so the next session adds a names review page (or the founder reviews them in a sheet first). About an hour of reading, and it is what makes the bot's Arabic messages readable.

2.  **Retest the demo order from the phone** after K1 merges, including "مشيلي الطلب" after closing time.

3.  **Meta:** confirm the WhatsApp account belongs to Alo King's own business portfolio, and submit business verification once the SARL papers exist.

4.  **The two +961 numbers** for production. A3 waits for them.

5.  **Upload the 51 voice notes** to the private media bucket with A4's runbook steps, so V1 can score the speech providers.

6.  **Kapso credits:** keep a few dollars on the account; the staff line pays from them.

7.  **Anthropic:** lower the API spending cap after 17 Nov, when the extra credit expires.

8.  **Decide:** voice-note transcription provider; the pilot settings; whether to move to the 200 USD Claude plan for the build month.

Also, from the repo of 14 Nov:

- **WhatsApp catalog setup in Meta** (RUNBOOK "WhatsApp catalog", steps A to C) and the catalog feed password as a GitHub secret.

- **Run research-load on staging** if it has not run since R1 to R3 merged, so the 202 picture candidates and the proposed facts appear in the console.

- **Delivery windows:** their times and capacity, the two cut-offs, and the Ramadan, Lent and holiday dates for 2027, entered once a console page exists.

## The Fable session prompt

The eight sessions have merged, so this can run now. Use Fable 5.2, effort High, alone, at the start of a fresh usage window. Paste the prompt below, then paste this whole doc under it (export it as Markdown, or copy and paste). If it hits the usage limit, type continue after the reset: it commits after each part, so nothing is lost.

You are session S1 (audit, research and system plan), Fable 5.2. You  
write findings, plans and session prompts. You write no product code.  
  
The founder's brief is pasted below this prompt. First commit it  
unchanged as docs/SYSTEM_BRIEF.md. Its founder decisions are decisions;  
where one conflicts with an older decision in docs/DECISIONS.md, record  
the conflict, do not resolve it silently.  
  
Read: CLAUDE.md, START_HERE.md, docs/HANDOFF.md (every Status section,  
including every request one lane left for another), docs/BUILD_PLAN.md,  
docs/DECISIONS.md, docs/AUDIT-2026-11-14.md, docs/COST_MODEL.md,  
docs/RUNBOOK.md, docs/TOOLS.md, data/research/README.md, every  
migration, apps/, packages/ and the tests for money, permissions and  
sending. Reuse and extend what exists; justify any replacement.  
  
Work in parts. Commit after each part, so a usage limit loses nothing.  
  
Part 1. Status audit -\> docs/AUDIT-G1.md, section 1. For every  
capability, one status: production-proven, staging-proven, built and  
test-covered, partial, designed only, not started, or blocked (by  
what). Evidence for each: file and line, test, or workflow run. Run  
npm run typecheck and npm test. Read staging through the existing  
workflows and read-only connectors only: no deploys, no messages, no  
billing or settings changes.  
  
Part 2. The G1 attack audit -\> docs/AUDIT-G1.md, section 2. Try to  
break money (orders, payments, ledger, rider cash, drawer, refunds,  
credit, supplier payments, scheduled orders), permissions (anon,  
authenticated, every role, every SQL function), recovery (retries,  
duplicates, outages, the queue path, a disconnected rider, late payment  
proof) and the send path (one gateway, fail-closed outbox claim, dedupe  
keys, marketing locks, the 24-hour window). Include every point in the  
brief's "Points for the audit". Each finding: severity, evidence, and  
the session that fixes it. Fix nothing yourself.  
  
Part 3. Targeted research -\> docs/RESEARCH_REGISTER.md. Only questions  
that change a decision, each with official sources and the date  
checked, facts kept apart from assumptions, about 25 searches in all:  
(a) card payment processors that will actually serve a Lebanese  
company, for diaspora orders, and whether Whish and OMT offer merchant  
APIs; (b) the website framework on Cloudflare (server-rendered, fast  
on phones, Arabic right-to-left, installable); (c) maps, routing and  
geocoding providers: Lebanon coverage and price; (d) a speech-provider  
shortlist for V1 to score on the 51 real Shouf notes; (e) Meta and  
Kapso current rules and prices (see the brief's "Platform rules"); (f)  
web push and installable apps on iOS versus Android; (g) Just Eat's  
official WhatsApp ordering announcement: what is confirmed and  
relevant. Do not repeat the 12 Nov competitor review.  
  
Part 4. The system plan -\> docs/SYSTEM_PLAN.md, docs/WEBSITE.md,  
docs/CONSOLE.md. From the brief: one channel-independent commerce core  
used by WhatsApp, the website, the console and a future app; the  
delivery-provider model (Alo King riders, vendor drivers, couriers,  
vendor hours past ours); combined orders on the existing fulfilments;  
the intake pipelines (products, vendors and menus, supplier invoices)  
with the automatic-approval rules; the places list and learning from  
every delivery; the learning loops and nightly jobs; the warehouse  
(scan to pick, lots, expiry, bins, counts); vendor commands by message;  
payments now and later; loyalty and referrals priced against margin  
(riders keep 100% of fees); analytics, reports and the founder  
assistant; the website page by page (day one: catalog, search, cart,  
cash checkout, tracking, history); the console redesign page by page,  
mobile first, installable; message design; expansion through markets;  
repo hygiene; platform rules. For each part: what exists and is  
reused, what is new, data model, functions, pages, tests, cost, and  
the invariant in CLAUDE.md that governs it. Never weaken an invariant;  
if a decision needs one changed, put it in the conflict register for  
the founder.  
  
Part 5. Money -\> docs/COST_MODEL.md and data/cost_model.csv. Cost per  
operation and per order type (dark store, restaurant), from real  
figures (ai_cost_daily, message meter) and current prices, at 10, 30,  
50, 100, 200, 500 and 1,000 orders a day; contribution margin and  
break-even; the cost of every reward. The CSV is editable: changing a  
price or volume recalculates.  
  
Part 6. Decisions and sessions. Append the decision conflict register  
to docs/DECISIONS.md. Update docs/BUILD_PLAN.md with a gap matrix (what  
exists against the plan) and every task marked A (must work at launch),  
B (designed now, switched on after evidence), C (pilot after a  
benchmark) or D (rejected or deferred, with the reason). Then one row  
per session, in run order. Put first: the reply-speed fix (A4's  
measurements: the 6 s buffer, pre-turn calls, the ask path; target  
most typed orders under 10 s), the G1 fixes, the open lane requests  
(delivery-window choice for customers, the feed password secret, the  
drawer check in the base functions), the names review and product  
readiness pages, the research-load run, and M1 message design. Each  
row: model (Opus for money, ordering and security; Sonnet for  
mechanical work; Fable only for audits), files it owns, migration  
numbers, what it waits for, what may run beside it (at most three at a  
time on the 100 USD plan), and done-when tests. Write the paste-ready  
prompt for every session in docs/NEXT_SESSIONS.md.  
  
Part 7. Founder list -\> the end of docs/SYSTEM_PLAN.md: only decisions  
and information the founder alone can give, and the questions for the  
lawyer and the accountant (Lebanese VAT, invoicing, data protection,  
consumer pricing).  
  
Rules: no secrets in files or output; never ask Rasheed; record  
anything blocked in docs/HANDOFF.md Status. Use a branch named for the  
session (or the one this environment allows), open a pull request with  
only these documents, and merge it yourself when CI is green.  
  
Finish with: what is finished, partial, missing and blocked (one  
table); the ten most serious findings; the session order; the founder  
list; and the prompts for the first three sessions to start.

After S1, paste its final message to the planning chat and to the founder, and start the first sessions it names.
