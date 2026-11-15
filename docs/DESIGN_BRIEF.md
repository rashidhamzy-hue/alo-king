<!-- Converted by session DS1 on 15 November 2026 from the founder's attachment "Alo King world-class design and features plan" (.docx).
Unchanged in meaning: only the format changed (Word to Markdown; the paste-ready prompts are in code blocks).
One thing left out: the author's name on the date line, because this repository is public (rule 4 of docs/NEXT_SESSIONS.md).
Where this brief and docs/strategy/ differ, docs/strategy/ wins: it was written after the brief, by the planning chat the brief asks for. -->

# Alo King: world-class design and features plan

Nov 15, 2026

## For Rashid: how to use this document

One Fable 5.2 chat, in the Alo King project on claude.ai, reads this document and the latest repository and decides everything: strategy, design direction, what the console and website need and do not need, and every session after it, with their prompts. It does not need any other message from the founder.

1. Wait until the session running now has merged into main. The chat reads the code live through the GitHub connector, so do not add the repository to the project files.

2. In the chat's connectors, check that all the Alo King connectors are on (GitHub, Supabase, Cloudflare, Sentry, Kapso and the rest). Read-only is enough: this chat audits and plans, it changes nothing live.

3. In the Alo King project on claude.ai, open a new chat, choose Fable 5.2, and attach this document.

4. Paste the opening message below and send.

5. When it gives you session prompts, run them in Claude Code in the order it says, at most three at a time, and bring each result back to that same chat. When it stops mid-way, reply "continue".

```text
You are Alo King's product, design, operations and engineering lead
for the next phase (Fable 5.2). Attached: the founder's brief of
15 Nov 2026. The repository is rashidhamzy-hue/alo-king: read it through the
GitHub connector in this chat, from the main branch (it is not in the
project files). This is the one session that covers
everything about Alo King and how to make it the best delivery and
dark-store service in Lebanon. You decide everything below; nobody will
send you more instructions. Ask the founder only for decisions that are
genuinely his (money, brand, legal), with your recommendation.

The standard: every experience is world-class, easy, smart and
AI-assisted, for customers, vendors, riders, the dark store and the
operations team. Where the founder's list below is incomplete, say so:
your most valuable output is what we have not thought of.

Read the brief in full. From the repository, read CLAUDE.md,
docs/HANDOFF.md, docs/SYSTEM_PLAN.md, docs/BUILD_PLAN.md,
docs/DECISIONS.md, docs/CONSOLE.md and docs/WEBSITE.md, then the code
you need to judge each area. If a file you need is not available to
you, list it and I will add it. Use the connectors in this chat
(GitHub, Supabase, Cloudflare, Sentry, Kapso and every other Alo King
connector) read-only: change nothing live, and make no commits, branches,
issues or pull requests.

Deliver, in this chat:

1. Verdict: what is strong, what is weak, what is missing, one page.

2. Blind spots: what Alo King has not thought of. Risks, missing
areas, failure cases, legal and operational traps, opportunities,
and what the best operators in the world do that nobody here has
asked for. Rank them by impact.

3. The five journeys, each mapped end to end, step by step, including
what goes wrong and how it recovers. For each: today's state in the
repository, the world-class version, where AI helps, and what to
build in which order.
- Customers: first contact, discovery, ordering on WhatsApp and the
website, payment, tracking, delivery, problems, refunds,
cancellations, support, reorders, loyalty, trust.
- Vendors: signing up, menus and modifiers, availability, receiving
and accepting orders, prep times, problems, statements, payouts,
performance, growth. It must be easy enough to run from WhatsApp.
- Riders: joining, training, shifts, dispatch, batching, routes and
ETAs in the Chouf, pickup, proof of delivery, cash, the daily
close, earnings (100% of fees and tips), safety, help.
- The dark store and logistics: suppliers and purchase orders,
receiving, shelf locations, stock counts, expiry (first to
expire, first out), cold chain, picking, packing, substitutions,
losses and theft, replenishment, demand forecasting.
- Operations: the console, alerts, the hand-off inbox, staff roles,
daily and weekly routines, reports, the founder assistant. Easy,
smart and AI-powered, with the AI proposing and people approving.

4. The learning system: how Alo King learns from every action
(deliveries, the warehouse, vendors, riders, AI conversations,
support). What to record from day one; the event log; each model
(ETAs, prep times, demand and reorder points, substitutions,
dispatch, cash-on-delivery risk, recommendations, AI answer
quality); how each is checked; and what starts as rules or simple
statistics now because pilot volume is small, then becomes machine
learning when the data allows.

5. Experience strategy from the brief's research on Just Eat, DoorDash,
Uber Eats, Instacart, talabat, Toters, JioMart and Deliveroo: which
features Alo King adopts, in which order, and how it does each
better (ordering, tracking, notifications, broadcasts, payments,
cash on delivery, support and hand-offs, refunds, cancellations, AI
and recommendations, ads, subscriptions and loyalty, AI agents,
vendor tools). Mark what nobody in Lebanon offers. Research where a
decision depends on it, with sources and dates.

6. Every system, audited. For each: what you checked, what is wrong or
risky, a score out of 10, and the fix.
- Code and architecture: packages, gateway, agents, commerce, tests.
- Supabase: schema, migrations, access rules, advisors, indexes,
backups and point-in-time recovery, logs, personal data and how
long it is kept.
- Cloudflare: Workers, routes, cron, queues, secrets, rate limits,
firewall, storage, domains and DNS.
- Sentry and monitoring: coverage, alerts, who is woken and when.
- WhatsApp: Kapso, Meta templates, quality rating, number limits,
policy.
- GitHub: privacy, branch protection, Actions minutes, secrets.
- Anthropic: keys, spend limits, model choices, cost per order.
- Money: cash, Whish and OMT, the ledger, reconciliation, receipts,
USD and LBP.
- Security, staff roles, backups and disaster recovery.
- Costs: every monthly bill and the cost per order.
- Rules: consumer protection, food safety, data protection.
- Launch operations: staffing, hours, written procedures, runbooks.
Anything you cannot check from here becomes a Claude Code audit
session in your plan.

7. The console: every page, what to keep, merge, redesign, remove and
add, following the best practice of operations dashboards; the
reports it needs; the founder assistant.

8. The website: a marketplace from its first design (the dark store
now, signed vendors later), page by page, mobile first, Arabic
first, with the Order on WhatsApp door.

9. The design direction: brand (decided: the crown's ink and gold,
green only for "available" and "done", all in one token file so it
can change later), type, components and stack.

10. The never-stranded hand-off: the redesign in the brief, made exact.

11. The session plan: every Claude Code session in run order, its
model (Fable, Opus or Sonnet), files, what it waits for, what may
run beside it (at most three at once), done-when tests with
screenshots, and the paste-ready prompt for each. The first session
commits your strategy and plan into the repository as docs. The
brief's DS1, SP2 and PIX prompts are suggestions: use, change or
replace them.

Rules for everything you plan: CLAUDE.md invariants hold (Postgres owns
money, stock and order state; the AI proposes and code executes; food
facts only from approved records; one gateway; marketing locked until
the founder unlocks it; riders keep 100% of fees and tips). No secrets
in any message. Prefer extending what exists to rebuilding it.

This is a long job: work through it in parts across several replies,
and say at the end of each reply what comes next. Start with the
verdict and the blind spots. End the whole job with the first three
Claude Code prompts to start now.
```

## Verdict and what to do now

The engine is strong: 1,385 tests pass, the money fixes are in, replies dropped from 15.9 to 5.6 seconds median on the server, and the website and installable console exist. What the customer and the founder see does not yet match that engine. The console and the website were built function-first, with 116 and 48 lines of hand-written styling, no brand, no product pictures and no charts. That is fixable without touching the logic underneath.

**The order, without breaking anything:**

1. **Let the sessions running now finish** and merge.

2. **Fix the urgent items in section 2:** the repository goes private today; the rest go into the plan.

3. **One Fable 5.2 planning chat** in the Alo King project decides the strategy, the design direction and every session after it (opening message above).

4. **Claude Code sessions build it**, in the order that chat sets, at most three at a time: Fable only where taste or an audit needs it, Opus for money, ordering and security, Sonnet for pages and mechanical work.

5. **The friends' test on WhatsApp** starts as soon as the never-stranded hand-off and the no-reply bug are fixed; it does not wait for the redesign.

6. **A final Fable audit** before the paid pilot.

Fable is used twice more, not for every session: DS1 now and G2 before the pilot. Everything between is Opus (money, ordering, security) or Sonnet (pages, mechanical work).

## Repo review of 15 Nov

Checked by the founder's reviewer on the repository downloaded on the morning of 15 Nov: typecheck clean, **1,385 tests passed, 43 live-only skipped, none failed**.

**Solid:** the G1 money fixes (F1), reply speed (SP1: 5.6 seconds median server-side, from 15.9), delivery windows for customers (W1), the commerce core with its own narrow web_channel role (C4), the intake pipeline with automatic-approval rules and spot checks (I1), the installable console with push alerts (D5), and a live website reading the same catalog and search as the chat (WEB1).

**Urgent, before new sessions:**

| \# | Item | Why it matters | Fix |
|---|---|---|---|
| 1 | **The repository is public** | The whole system, prompts, eval data and staff workflows are readable by anyone, and git history still holds about 800 business listings with phone numbers and the customer line's number | Make it private now. If public was chosen for free Actions minutes, pay instead: GitHub Team or a minutes budget costs far less than the exposure. Then purge the prospect files from history |
| 2 | **SP2: a turn can end with no reply** | The customer is handed to a person and nothing is sent: the worst failure before the friends' test | One Opus session, first |
| 3 | **Pictures: 0 approved, 20 proposed** | A grocery website and a WhatsApp catalog without pictures cannot look world-class. The research files held 202 picture candidates, but only 20 became proposals | Find out where the other 182 were dropped (vision check, licence rule or loader), then use the founder-approved sources: Brave search key, intake photos, and a retailer scrape for the rest |
| 4 | **No brand** | The WhatsApp profile is a gold crown on black; the website is green (#1f6f4a) with the name in plain text; the console is navy | Decided 15 Nov: ink and gold from the crown, in one token file (section 9) |
| 5 | **The website has no WhatsApp button and no cart** | WhatsApp is the main channel and the site does not lead to it | DS1 and WEB2 |
| 6 | **GitHub minutes:** 1,671 of 2,000 used in two days | CI will stop mid-month | Decide the plan (item 1) |
| 7 | **Push is off:** VAPID secrets not set; **Cloudflare has no spend limit** | Alerts never reach the phone; no cost ceiling | Rashid sets both (RUNBOOK) |
| 8 | **Arabic on the console and site is model-written and unread** | Wrong words in front of customers | An Arabic reader checks every string before the friends' test |

Open lane B items (size-only lines read as products, the ask loop) and the console's missing pages for C2's picker items stay on the list in HANDOFF "Open requests carried forward".

## Never leave a customer waiting: the hand-off redesign

**What happened in Rashid's test:** the bot sent "رح يتواصل معك حدا من فريقنا بأقرب وقت" and went silent. The code explains it: any hand-off sets human_handoff on the whole conversation, and from then on the bot ignores every message (turn.ts, the line "a person has this chat; the model stays out") until someone releases it in the console. Worse, technical failures trigger the same lock: a model error, the model at capacity, the turn cap, a button error, and "the agent did not finish" (the SP2 bug). A customer can be stranded at 2 am because of a timeout.

**What the leaders show:** Just Eat uses chatbots for common customer-service questions and plans automated refund decisions, but its public reviews show the risk on the other side: customers complain of an AI chat that goes round in circles with no person to reach. The lesson for Alo King is both halves: automate what is safe, and never leave a dead end.

### The new rules

1. **A technical failure is never a hand-off.** Retry, fall back to the deterministic path (the card, a clarifying question, the catalog), and if all fail, say so honestly and ask the customer to try again in a minute. The failure becomes an ops case; the chat stays open.

2. **A hand-off is a case beside the chat, not a lock on it.** The bot keeps answering, taking orders and giving status. Only the topic of the case (a complaint, a refund, a safety issue) waits for the person, and the bot says so in one line.

3. **When a person claims the case, the bot steps back for that person, for a limited time.** If the person goes quiet for 10 minutes during open hours, the bot resumes, tells the customer the case is still open, and stays available.

4. **Timers that escalate, during open hours:** not claimed in 3 minutes, push alert to the ops lead; 5 minutes, push to the founder and the bot tells the customer it is still on it, with options (keep ordering, request a call back, leave a voice note); 15 minutes, the case is marked late and the founder's report shows it. Target: zero stranded conversations.

5. **Outside hours:** the bot says honestly when a person will reply (opening time), records the case, and keeps taking orders for the morning (kept orders, K1).

6. **The customer can always ask for a person** ("بدي احكي مع حدا"), and gets a case, a time and a "call me back" button, while the bot still answers anything else.

7. **Fewer cases by safe automation:** within written limits (for example a missing item the picker recorded, up to a set amount), the bot refunds as credit without waiting for a person, and the case is logged for a spot check.

8. **The person answers fast:** the console's case inbox shows the timer, the chat, the order and a reply drafted by the AI; one tap sends it through the gateway.

9. **Measured:** hand-off rate by reason, time to claim, time to first human reply, conversations with a customer message unanswered for more than 2 minutes (alarm at any value above zero).

This is session SP2's scope, together with the bug that ends a turn with no reply. It runs on Opus, beside DS1.

Sources: [City A.M. on Just Eat's assistant, support chatbots and planned automated refunds](https://www.cityam.com/?p=2395455), [Clarity's analysis of Just Eat reviews](https://www.onclarity.com/leaderboard/companies/justeattakeaway). Checked 15 Nov 2026.

## What the leaders do, and how Alo King does it better

### Just Eat on WhatsApp (UK launch, 1 Oct 2026)

Confirmed by Just Eat Takeaway's own announcement and the trade press: customers browse menus and build a basket entirely inside WhatsApp, from any of about 100,000 UK partners; an in-house AI interprets natural requests ("pizza for four") and recommends; **the final payment happens in the Just Eat app**, not in the chat. It is the same assistant as their in-app voice ordering, which launched in the UK in January and, they report, converts significantly better. It started as a pilot in Spain and the Netherlands in May, built with Meta.

**Where Alo King is already ahead:** the whole order closes inside WhatsApp, payment included (cash on delivery, Whish or OMT proof), with no app to install; voice notes in Lebanese Arabic, Arabizi, English and French; landmarks instead of street addresses. **Where Just Eat is ahead:** scale, a polished app, card payment, and a recommendation engine with years of data.

### Features worth taking, and how to do them better

| Leader | What they do (confirmed) | Alo King today | Alo King, better |
|---|---|---|---|
| Just Eat | Basket in WhatsApp, payment in app | Full order and payment in WhatsApp | Keep the whole journey in the chat; add the website as a second door, never a forced one |
| DoorDash (Ask DoorDash, June; order by text, Sept 2026) | "Order my usual"; learns preferences such as no cilantro; with permission, messages about a usual coffee; group orders with mixed diets; one-tap restock and cheaper swaps | Saved places and memory; no "usual", no restock, no group order | "The usual" as one button; restock reminders only to customers who opted in, as utility messages; a cheaper same-size swap shown on the card; group orders later |
| Uber Eats (Cart Assistant, Feb 2026) | Builds a grocery cart from text or a photo | Text and voice | **A photo of a handwritten shopping list becomes a cart.** Many Shouf households still write lists on paper: a strong local differentiator |
| JioMart on WhatsApp | Catalog, cart, address and payment without leaving the chat | Catalog in code (K1), waits on pictures and Meta steps | Same, plus AI for people who never open the catalog |
| Talabat (mart, pro) | Dark stores delivering in 15 to 30 minutes; a subscription with free delivery; flash deals; gift cards | Dark store; no subscription, deals or gift cards | Stamp card after four clean weeks (decided); gift orders for the diaspora; a subscription only when numbers prove it |
| Toters (Lebanon's leader, 500K+ customers) | Favourite stores, scheduling, points and free-delivery rewards, chat support, live tracking | Scheduling built; tracking page partial; no favourites or points | Match all five, then beat them on WhatsApp-first ordering, voice notes and village landmarks |
| Instacart | Replacement preference per item; chat with the shopper while picking, with photos | Substitute question exists | The picker sends a photo of the substitute and the customer taps yes or no in the same chat |
| DoorDash (DashBuddy) | An AI assistant answers drivers' questions | Riders use buttons on the ops line | Rider help on the ops line for "how do I" questions, in Arabic |

### What only Alo King can offer

- Ordering by Lebanese voice note, Arabizi and village landmarks, with no app.

- Send-home ordering for Lebanese abroad, paid from abroad, delivered in the Shouf.

- A photographed shopping list turned into a cart.

- Transparent prices with the pound equivalent on request, and riders who keep 100% of the fee.

Sources: [Just Eat Takeaway newsroom, pilot announcement](https://newsroom.justeattakeaway.com/en-WW/265881-just-eat-takeaway-com-sets-new-industry-standard-as-first-to-introduce-whatsapp-food-and-retail-ordering-option-in-europe/), [The Grocer, UK launch](https://www.thegrocer.co.uk/news/just-eat-launches-whatsapp-ordering-in-uk/724280.article), [TechCrunch, Ask DoorDash](https://techcrunch.com/2026/06/11/doordashs-new-ai-chatbot-lets-you-order-with-prompts-and-photos/), [Unite.AI, DoorDash order by text](https://www.unite.ai/?p=476634), [TechCrunch, Uber Eats Cart Assistant](https://techcrunch.com/2026/02/11/uber-eats-launches-ai-assistant-to-help-with-grocery-cart-creation), [Business Insider, JioMart on WhatsApp](https://www.businessinsider.in/tech/apps/news/how-to-use-jiomart-on-whatsapp/articleshow/93871111.cms), [MEVP, Toters](https://mevp.com/portfolio/toters), [Gulf Business, talabat](https://gulfbusiness.com/en/2026/lists/meet-the-30-companies-shaping-the-gulfs-future/talabat). Checked 15 Nov 2026.

### How the top apps run each part of the business

What the world's leading delivery and commerce apps do in each area, and what Alo King should adopt. "Confirmed" items cite a source; the rest are recommendations for the planning session to weigh.

| Area | What the leaders do | For Alo King |
|---|---|---|
| **Ordering** | Just Eat: discovery and basket inside WhatsApp, an AI that understands "pizza for four". DoorDash: "order my usual", learned preferences, group orders with mixed diets, ordering by photo. JioMart: catalog, cart, address and payment without leaving WhatsApp | Text, voice, catalog and photo-of-a-list all lead to the same order card; "the usual" in one tap; group orders later |
| **Delivery and tracking** | Uber Eats and DoorDash show each stage (accepted, preparing, driver assigned, picked up, nearby, delivered) on the iPhone lock screen as one card that updates, instead of a notification per step; Android has an equivalent called Live Updates | On WhatsApp: one status message per stage at most, plus a tracking link; on the website and console: a live card. Never spam |
| **Notifications and alerts** | Lock-screen cards replace a stream of pushes; too many pushes train users to mute the app | Customers: only stage changes and problems. Founder and staff: push only for exceptions, grouped, with a daily digest |
| **Broadcasts and marketing** | Uber Eats added time-bound offers and post-purchase "reorder rewards" for restaurants in June 2026 | Marketing stays locked for the pilot; later, opt-in only, capped per customer, with the guardrails from the Hader plan |
| **Payments** | WhatsApp's Payments API lets the customer pay inside the chat through an order message and then sends status updates, but only in some countries (India, Brazil, Singapore) through approved gateways | Lebanon: cash, Whish and OMT proof now; a payment link from an approved Lebanese gateway later; in-chat payment when Meta offers it here |
| **Cash on delivery** | In MENA e-commerce: confirm the order before dispatch (one-time code or a WhatsApp confirmation), score risk, cap order value, require partial prepayment from new or risky customers, reconcile rider cash daily | Already: confirm button, cash caps, daily close. Add: a risk score from history (refusals, cancellations), a first-order cap, and "pay part now" for risky orders |
| **Support** | Chatbots answer common questions; customers punish AI loops with no human | The hand-off redesign above: never a dead end, timers, a person reachable |
| **Refunds** | DoorDash Self-Help offers the same options an agent would (credit, refund or redelivery) and asks for photos of what was received; Uber Eats is criticised for automated "not eligible" refusals | Automatic credit for clear cases backed by our own records (the picker's missing item), a photo for the rest, a person for anything disputed; refund to the original method when the customer asks |
| **Cancellations** | Common practice: free until the store starts preparing, then partial | Free until picking starts or a vendor accepts; after that, the customer sees exactly what can still be refunded; a vendor or hub failure is always our cost |
| **AI and recommendations** | DoorDash: suggestions by budget, group size, diet and past orders; Uber Eats: cart from text or photo | Basket builder from approved portion rules; one suggestion per order; restrictions always win; no health claims |
| **Ads** | DoorDash, Uber Eats and Instacart sell sponsored listings (paid placement in search and categories), display ads and brand-funded placements; sponsored listings are the usual first step | Later, after vendors join: clearly labelled sponsored placements that never override a stated restriction, then brand-funded featured products in the dark store |
| **Subscriptions** | talabat pro (free delivery, a family plan for up to four people, partner perks), Deliveroo Plus (free delivery, credit back when an order is late), DashPass | Only when numbers show it pays; a family plan and an on-time promise fit Lebanese households best |
| **AI agents** | DoorDash runs an ordering agent for customers and DashBuddy for drivers; Just Eat a concierge in chat and voice | One customer Concierge, narrow AI functions, a rider helper on the staff line, a read-only founder assistant; no unsupervised agent touches money |
| **Merchant tools** | DoorDash and Uber Eats give merchants AI menu tools, onboarding help and ad dashboards | Vendor onboarding from a menu photo, changes by WhatsApp message with one-tap confirmation, and a weekly performance report |

Sources: [9to5Mac, Uber Eats Live Activities](https://9to5mac.com/?p=880017), [Customer.io on Live Activities](https://customer.io/learn/mobile-marketing/live-activities), [freeCodeCamp, Live Activities and Android Live Updates](https://www.freecodecamp.org/news/react-native-live-activities-handbook/), [PPC Land, Uber Eats Deal Drops and Reorder Rewards](https://ppc.land/commerceiq-adds-doordash-ads-as-doordash-leads-us-grocery-orders/), [Meta, WhatsApp payments via gateways](https://developers.facebook.com/documentation/business-messaging/whatsapp/payments/payments-in/pg), [Jeebly on COD fraud](https://jeebly.com/blogs/cod-fraud-uae-ecommerce/), [eGrow, COD fraud prevention 2026](https://www.egrow.com/en/blog/fraud-prevention-cod-ecommerce-2026), [DoorDash help, missing items](https://help.doordash.com/en-ca/consumers/article/my-order-was-missing-an-item-incorrect-order), [Unstar, Uber Eats refund complaints](https://unstar.app/blog/uber-eats-not-eligible-for-refund-missing-items-reviews-2026), [Osmos, delivery ads 2026](https://osmos.ai/blog/food-delivery-retail-media-monetization-2026), [Khaleej Times, talabat pro](https://www.khaleejtimes.com/kt-network/talabat-pro-delivers-more-than-ever-bigger-savings-exclusive-perks-and-unmatched-convenience), [Deliveroo Plus](https://help.deliveroo.com/en/articles/12538710-about-deliveroo-plus-in-belgium), [Unite.AI, DoorDash order by text and DashBuddy](https://www.unite.ai/?p=476634). Checked 15 Nov 2026.

## Why it looks dated, and the design direction

**Why:** no session was ever asked to design. docs/CONSOLE.md and docs/WEBSITE.md specify pages and permissions but say nothing about brand, colour, type, imagery or charts. The console is 116 lines of hand-written styling with system fonts, a flat list of 25 links and plain tables. The website is 48 lines, text only, no logo, no pictures, no cart, no WhatsApp button, and a wall of 26 village names.

### Direction

1. **Brand first.** One identity across WhatsApp, the website, the console, receipts and rider cards: the crown logo redrawn as a clean vector, a palette, and a type pairing. Recommended palette: deep ink and warm gold from the crown, with green kept only for "available" and "done" states. Decided on 15 Nov, open to change later (section 9).

2. **Arabic-first type.** A family that is excellent in both Arabic and Latin, served from our own domain and subset for speed: for example IBM Plex Sans Arabic with IBM Plex Sans, or Readex Pro. DS1 proposes two and shows them on real screens.

3. **One design system for both apps:** a shared packages/ui with tokens (colour, type, spacing, radius, shadow, motion), light and dark, right-to-left built in, and components: buttons, inputs, chips, badges, cards, KPI tiles, charts, data tables with sort, filter and saved views, drawers, dialogs, toasts, empty, loading and error states, and an open-source icon set (Lucide).

4. **Stack, recommended for DS1 to confirm:** Tailwind CSS v4 for tokens, shadcn/ui and Radix for components, Tremor blocks and Recharts for charts, TanStack Table for data tables, used as islands inside Astro, which the website already runs on. The console keeps its Worker, its sign-in, its log-first actions and every SQL function; only how pages are drawn changes. DS1 decides, with reasons, whether the console's pages move to Astro or keep their current renderer with the new system, under one rule: every existing console test still passes and no write path changes.

5. **Rules for every screen:** mobile first; exceptions before information; every number shown with its comparison (yesterday, last week); every list searchable and filterable; nothing blank while loading; AA contrast; works on a slow connection; the website stays fast (server-rendered pages, small scripts only where needed).

6. **Look before code.** DS1 first builds a gallery of the flagship screens from the design system, reviews it against the brief with screenshots, then builds the screens; every pull request after it attaches screenshots at phone and desktop widths, in Arabic and English. The founder reviews the result on staging and asks for changes; because everything flows from tokens, a change of colour or font is one file.

## The console: world-class, screen by screen

The console is the founder's cockpit, on a laptop and on the phone. It already has the right data and the right safety rules; it needs the experience of a modern operations product.

**Shell**

- Six groups instead of 25 links, each with an icon and a badge: Today, Orders, Approve, Stock, Money, Reports, plus Settings. Collapsible sidebar on desktop, bottom bar on the phone (as D5 started).

- A command bar (Ctrl+K or a search icon): jump to any order, product, customer or page by typing.

- A notification bell with the same exceptions the push alerts carry; a "live" indicator; light and dark themes; Arabic and English.

**Today (the home screen)**

- **KPI tiles**, each with today's value, the change against yesterday and the same day last week, and a small trend line: orders, sales, contribution, average delivery time, on-time share, reply time, missing-item rate, AI cost per order, open exceptions.

- **Needs you now:** the exception inbox, oldest first, one-tap actions (as today, restyled).

- **Live board:** open orders as cards in columns by status (new, picking, ready, on the way), each with a timer that turns amber and red against its promise.

- **Map:** riders and open orders on one map, with village boundaries.

- **Riders and cash:** each rider's cash against the caps as a bar, not a sentence.

**Orders**

- A real data table: search, filters (status, channel, village, rider, payment, date range), sortable columns, saved views ("late today", "unpaid transfers"), column choice, CSV export.

- An order opens in a side drawer: timeline of every step with times, the chat, the lines with pictures, payments and refunds, and the allowed actions.

**Approve**

- Names, pictures, food facts, search words and auto-approval spot checks as one queue with tabs and counts, keyboard-driven, product pictures shown large, the source of every proposal in plain words.

**Stock**

- Catalog as a grid with pictures and readiness badges; stock levels with low-stock and expiry warnings; receiving; returns; product readiness.

**Money**

- Day open and close, cash and riders, payments, refunds, hub money and the exchange rate, with the ledger always reconciling to zero shown as a green check, never as a paragraph.

**Reports (new, session AN1)**

- Sales and contribution by day, hour, category and product; customers: new, returning, retention by first-order week; delivery: time distribution, on-time share by village and hour (heat map); riders: jobs, acceptance speed, cash discrepancies; demand: searches and requests we could not meet, out-of-stock losses; AI: accuracy, misses, reply time, cost per order; finance: profit and loss, cash position.

- Every report: a date range with comparison to the previous period, filters, a chart and the table under it, CSV export.

**The founder assistant (later, read-only)**

- A side panel where the founder asks "what went wrong today?" or "which villages are late this week?" and gets an answer built only from these reports' data, with links to the orders. Any change it suggests needs the founder's tap.

## The website: world-class, page by page

Most visitors arrive on a phone from Instagram, Facebook or a shared link. The site has two jobs: send people to WhatsApp in one tap, and let those who prefer a website order there with the same prices, stock and rules.

**Home**

- Header: the logo, search, language, and a cart button with a count.

- A hero with one promise and two buttons: "Order on WhatsApp" (a link that opens the chat with a greeting already typed) and "Shop here".

- **"Do we deliver to you?"**: pick your village or share your location, and see the fee, the time and whether we are open. This replaces the list of 26 villages.

- Categories as picture tiles; "popular now"; "order again" for returning customers; offers only when they exist.

- Trust strip: cash on delivery, local riders, hours, help on WhatsApp.

**Category and search**

- Product cards with picture, name, size, price and a one-tap add; filters (brand, size, price, in stock); sort by facts only (price, size, popularity), never "best".

- Instant search as you type, in Arabic, Arabizi, English and French, with the same matcher as the chat; a clear "we don't sell this yet" that logs the demand.

**Product**

- Large picture, name, size, price, stock state, add to cart; food facts with their status (approved, from the pack) or "not confirmed yet"; a suggested substitute when out of stock.

**Cart and checkout (WEB2)**

- A cart that stays visible on the phone as a bottom bar with the total, the delivery fee and progress to the minimum order.

- Checkout in as few steps as possible: place (village, pin, landmark), time (now or a window), payment (cash, Whish or OMT proof now; card when approved), then one confirm. A returning customer confirms in one tap.

- The confirmation can continue on WhatsApp, so the same order is visible in both.

**Tracking and account**

- A tracking page with the order's timeline and time estimate; the rider on a map only when the rider has agreed.

- Order history, "order again", saved places, language, and the customer's own privacy choices.

**Send home (diaspora)**

- A clear entry: "Send groceries to family in the Shouf", with buyer and recipient separated, a gift message, and payment from abroad once a card provider approves Alo King.

**Quality bars**

- Pages appear fast on a slow mobile connection; the shell is installable; every page reads correctly right-to-left; structured data for products and the business so search engines and AI assistants read it correctly; no invented content, no fake reviews, no promises the data cannot back.

**Vendors on the website (designed now, switched on with Phase 8)**

The site starts with the dark store but must be a marketplace from its first design: restaurants, bakeries, cafes and other signed vendors join later without a redesign.

- Home with two doors: "Groceries" (the dark store) and "Restaurants and more" (vendors), with search across both.

- A vendor directory filtered by facts only: open now, delivery time, fee, distance, cuisine. No ratings or "best" (business rule 4).

- A vendor page: hours, preparation time, delivery fee and time to your village, who delivers (Alo King or the vendor's own driver), and the menu by section.

- Menu items with options and modifiers (size, extras, "without pickles"), notes, and allergens only as the vendor declared them, labelled as such.

- One cart per vendor at launch (decided); the cart and checkout designed so a combined order (groceries plus food) can be switched on later on the existing fulfilments.

- Vendor sign-up and rider application pages.

## Skills and open-source tools

### Claude Code skills to install before DS1

| Skill | What it does | Use it for | Install |
|---|---|---|---|
| **frontend-design** (Anthropic, Apache-2.0) | Makes Claude choose typography, colour and layout on purpose and avoid generic AI-looking pages | Every UI session from DS1 on | /plugin marketplace add anthropics/skills then /plugin install example-skills@anthropic-agent-skills |
| **webapp-testing** (Anthropic) | Drives the running site with Playwright: screenshots, clicks, console logs | DS1 and every UI session attach phone and desktop screenshots and prove flows work | Same plugin |
| **theme-factory** (Anthropic) | Generates palette and font pairings | DS1's brand options | Same plugin |
| **web-artifacts-builder** (Anthropic) | React, Tailwind and shadcn/ui prototypes | Quick mockups to show the founder before building | Same plugin |
| **ui-ux-pro-max** (nextlevelbuilder, MIT, community) | A large catalogue of UI styles, palettes, font pairs and UX rules | Exploration only; Alo King's own tokens always win | npx skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max |

Community skills are someone else's code: read the files before installing, and pin the version.

### Open-source building blocks (all free)

| Tool | Use |
|---|---|
| Tailwind CSS v4 | Design tokens and styling |
| shadcn/ui with Radix | Accessible components we own as source code |
| Tremor and Tremor Blocks | Dashboard charts and ready sections; Tremor Blocks (300+ sections and templates) became free and open source in 2026 |
| Recharts | The chart engine under Tremor and shadcn charts |
| TanStack Table | Sorting, filtering, saved views and large tables |
| Lucide | One consistent icon set |
| Mapbox or MapTiler | Maps on the tracking page and the dispatch board (R4 left the choice open; never OpenStreetMap's own tile servers) |

**Not recommended:** paid templates (they bring someone else's look and code), and commerce platforms such as Medusa or Shopify. Alo King already has its own commerce core; a second one would split prices, stock and orders.

Sources: [anthropics/skills (frontend-design)](https://open-design.ai/ar/skills/frontend-design/), [Anthropic skills catalogue](https://codenote.net/en/posts/anthropic-official-skills-catalog-overview/), [ui-ux-pro-max](https://claude-codex.fr/en/skills/ui-ux-pro-max), [Tremor Blocks free](https://adminlte.io/blog/tremor-dashboard-templates/). Checked 15 Nov 2026.

## Suggested session plan (the planning chat decides)

At most three sessions at once. Nobody touches apps/console, apps/web or packages/ui while DS1 runs.

| Wave | Sessions (model) | Waits for |
|---|---|---|
| Now | The two running sessions finish; merge M1 (#54) and the A5 follow-up | nothing |
| A | **SP2** ordering fixes: the no-reply turn, size-only lines, the ask loop (Opus) · **PIX** pictures: find why 182 of 202 candidates were dropped, add the founder-approved sources, fill the pictures queue (Sonnet) · **OPS** push secrets, Cloudflare spend limit, CI minutes (Sonnet) | wave Now |
| B | **DS1** design system and flagship screens (Fable 5.2, alone on the UI files); backend-only sessions may run beside it | the two running sessions merged (brand decided 15 Nov) |
| C | **AN1** reports and charts (Opus) · **UX2** every remaining console page on the new system (Sonnet) · **WEB2** cart and checkout on the new system (Opus) | DS1 merged |
| D | **UX3** remaining website pages, tracking, send-home entry (Sonnet) · **T1** friends' test support (Sonnet) | wave C; T1 only needs SP2 and the Arabic reading |
| E | Features from section 3: "the usual" and opt-in restock reminders, a shopping-list photo becomes a cart, substitute photos from the picker, favourites; the stamp card after four clean weeks (Opus) | T1 results |
| F | **G2** full audit before the paid pilot (Fable 5.2) | wave E |

### Suggested DS1 prompt (the planning chat chooses Fable or Opus)

Start it as soon as the two running sessions have merged. SP2 and PIX (Opus and Sonnet) may run beside it because they touch no UI files: three sessions at once. Paste this prompt, then this whole doc under it.

```text
You are session DS1 (experience strategy, design system and flagship
screens). You set the design system and the patterns every later
session copies. The founder's brief is pasted
below; commit it unchanged as docs/DESIGN_BRIEF.md.

Goal: make Alo King the best ordering and delivery experience in
Lebanon, ahead of Toters and talabat and at the level of Just Eat,
DoorDash and Uber Eats, while keeping every business rule, SQL
function, permission and write path exactly as it is.

Before anything: install the Anthropic skills frontend-design,
webapp-testing and theme-factory (/plugin marketplace add
anthropics/skills, then /plugin install
example-skills@anthropic-agent-skills) and use them. Read CLAUDE.md,
docs/HANDOFF.md (D5, WEB1, every console and web section, "Open
requests carried forward"), docs/SYSTEM_PLAN.md, docs/CONSOLE.md,
docs/WEBSITE.md, apps/console/, apps/web/ and their tests.

Work in parts and commit after each, so a usage limit loses nothing.

Part 1. Experience strategy -> docs/EXPERIENCE_STRATEGY.md. Start
from the brief's section "What the leaders do". With at most 15
targeted searches (sources and dates recorded), check the newest
practices in delivery and grocery commerce and in agentic AI that
matter here: conversational ordering on WhatsApp, reorder and "the
usual", proactive opt-in reminders within Meta's rules, cart from a
photo or a list, substitutions with photos, live tracking, delivery
promises calibrated from real data, loyalty that pays for itself,
agent-readable product data, and the founder's AI assistant. For each:
what the leaders do, what Alo King does today, what to build, which
wave, and the invariant that governs it. Mark what nobody in Lebanon
offers. Never weaken an invariant; put any conflict in the
docs/DECISIONS.md conflict register for the founder.

Part 2. Design system -> docs/DESIGN_SYSTEM.md and packages/ui.
Brand (founder decision 15 Nov, open to change): the crown's deep ink
and warm gold, green only for "available" and "done". Put every colour,
font and the logo in one token file so a later change is one edit.
Redraw the crown as a clean SVG from the WhatsApp profile artwork.
Arabic-first type pairing served from our own domain and subset; light
and dark; right-to-left built in; Lucide icons. Recommended stack:
Tailwind CSS v4, shadcn/ui with Radix, Tremor and Recharts, TanStack
Table, as islands in Astro. Decide with reasons whether the console's
pages move to Astro or keep their renderer with the new system. Hard
rules: every existing console and web test passes unchanged;
no-direct-writes and log-first stay; the CSP stays strict; the
website's pages stay server-rendered and light. Components: buttons,
inputs, select, chips, badges, cards, KPI tile with comparison and trend
line, charts, data table (sort, filter, saved views, column choice,
CSV export), drawer, dialog, toast, tabs, command bar, empty, loading
and error states. A gallery page in each app shows them in Arabic and
English, light and dark.

Part 3. The console. First audit every existing console page and
decide, with reasons, what to keep, merge, redesign or remove, and
what is missing, using current best practice for operations
dashboards (exceptions first, comparisons, filters, mobile use). Write
the result into docs/CONSOLE.md. Then build the flagship screens
(brief section "The console"): the
grouped navigation with icons and badges, the command bar, the
notification bell; Today with KPI tiles from existing reads (a figure
with no source yet is left out and listed for AN1), the exception
inbox, the live order board with timers, riders against the cash caps;
Orders as the full data table with the order drawer; the Approve queue
with large pictures and the source of every proposal in words.

Part 4. The website is a marketplace from its first design: the dark
store now, signed vendors later (brief: "Vendors on the website").
Design the information architecture, page types and components for
vendors now (directory, vendor page, menu with options, per-vendor
hours, fees and who delivers), and build them as far as the data
allows without switching vendors on. Then the flagship pages: home
with the logo, the Order on WhatsApp button (a wa.me link with a
greeting typed), "Do we deliver to you?" by village or location,
picture categories and the trust strip; category, search and product
pages with cards and filters; the cart button and bottom cart bar as a
shell for WEB2. Structured data for products and the business. No
invented content.

Part 5. Proof. With webapp-testing, screenshot every flagship screen
at 390 px and 1440 px, Arabic and English, light and dark, and attach
them to the pull request. Check AA contrast, keyboard use,
right-to-left mirroring and page weight on a slow connection.

Part 6. The plan. You decide everything after you: the order of
sessions, which to merge or split, what to drop, and what the brief
missed. Update docs/BUILD_PLAN.md and write
paste-ready prompts in docs/NEXT_SESSIONS.md for every session in the
brief's "Session plan" (AN1, UX2, WEB2, UX3, T1 and the wave E
features), each naming the packages/ui components it must reuse, its
model (Opus for money, ordering and security; Sonnet for pages and
mechanical work), its files, what it waits for and its done-when
tests with screenshots.

Rules: CLAUDE.md invariants hold; touch only apps/console, apps/web,
packages/ui, docs/ and their tests (SP2 and PIX run beside you on
other files); no migration (list missing reads for AN1); no secrets;
never ask Rasheed; use the branch this environment allows, open one
pull request, merge it yourself when CI is green.

Finish with: the screenshots, the decisions taken, what nobody in
Lebanon offers that Alo King will, and the prompts for the next three
sessions to start.
```

### Suggested SP2 prompt (Opus 5.5, beside DS1)

```text
You are session SP2 (never leave a customer waiting), Opus 5.5,
ordering lane. Read CLAUDE.md, docs/HANDOFF.md ("Open requests carried
forward", lane B, SP2 and M1's findings), and the founder's brief
pasted below, section "Never leave a customer waiting".

Rashid's live test on 15 Nov: the bot sent the hand-off line and went
silent. Cause: any hand-off sets conversations.human_handoff and
turn.ts then ignores every message until a person releases it; model
errors, capacity, the turn cap, button errors and
"agent_did_not_finish" all trigger it.

Do, each with a failing test first:
1. Fix the ask loop that can end a turn with no reply (max_tokens and
the loop exit in packages/agents/src/concierge.ts), and the open
lane B items: a size-only reading line becoming a product.
2. Technical failures never hand off: retry once, fall back to the
deterministic path, else an honest "try again in a minute" reply;
open an ops case; the chat stays open.
3. Replace the conversation lock with a case beside the chat: the
bot keeps answering and ordering; only the case's topic waits. A
person who claims the case pauses the bot for that chat; after 10
quiet minutes during open hours the bot resumes and says the case
is still open.
4. Escalation timers (settings, not code): unclaimed 3 min, push to
the ops lead; 5 min, push to the founder and a "still on it" message
with options (keep ordering, call me back, voice note); 15 min, late.
Outside hours: the honest reply time, the case, and kept orders.
5. "I want a person" in any language gives a case, a time and a call
me back button; the bot still answers anything else.
6. Safe automatic credit for a missing item the picker recorded, up to
a settings limit, logged for spot check; everything above it to a
person.
7. Measures: hand-off rate by reason, time to claim, time to first
human reply, and an alarm when a customer message goes unanswered
for more than 2 minutes.
The console's case inbox (timer, chat, order, AI-drafted reply, one
tap to send) is DS1's and UX2's; expose the SQL functions they need
and list them in HANDOFF.

Files: apps/gateway/src/turn.ts, packages/agents/, supabase/migrations
(take the next free numbers and record them), test/, evals/. Not
apps/console or apps/web (DS1 owns them).

Done when: the tests pass; the language-pack gate holds; on staging a
forced model error, a forced capacity error and "I want a person" each
leave the chat answering; no conversation has a customer message
unanswered for more than 2 minutes over 24 hours of probe runs.

Rules: CLAUDE.md invariants hold; npm run typecheck and npm test pass;
no secrets; never ask Rasheed; record anything blocked in HANDOFF; use
the branch this environment allows, one pull request, merge when CI is
green.
```

### Suggested PIX prompt (Sonnet 5.5, beside DS1)

```text
You are session PIX (product pictures), Sonnet 5.5. Read CLAUDE.md,
docs/HANDOFF.md (P1, P2, R1-R4, H1's data check, I1), data/research/,
scripts/product-data/ and the founder decision of 14 Nov "Product
pictures from public pages".

On staging only 20 pictures were proposed although the research files
hold 202 picture candidates, and none is approved.
1. Find, item by item, where the other candidates were dropped
(vision check, licence rule, size, the loader) and write the counts
per reason into HANDOFF.
2. Fix wrongful drops with a failing test first; keep the vision check
strict (right product, right size, no watermark or price tag).
3. Add the founder-approved sources for what is still missing: the
Brave search key when set, and a retailer scrape of Lebanese online
stores (Carrefour Lebanon first) through a workflow, respecting their
rate limits; keep the source of every picture.
4. Run the loader on staging and report how many of 291 items have a
proposed picture, by source, and the list left for intake photos.
Files: scripts/product-data/, .github/workflows/ for picture jobs,
supabase/migrations (next free numbers), test/. Not apps/console or
apps/web.
Rules as every session: invariants hold; tests pass; no secrets; never
ask Rasheed; one pull request, merge when CI is green.
```

## Founder decisions and actions

**Decide before DS1:**

1. **Brand (decided 15 Nov, open to change later):** the crown's deep ink and warm gold, with green only for "available" and "done". All colours, fonts and the logo live in one token file in packages/ui, so a later change is a single edit, not a redesign.

2. **Design approval:** the founder reviews DS1's screens on staging, from the screenshots in its pull request, and asks for changes; no separate mockup step.

3. **Repository visibility:** private now, with paid CI minutes, then purge the prospect files from history.

4. **Picture sources:** confirm the Brave search key, intake photos, and a retailer scrape for what is left (the 14 Nov decision on public pages already allows showing approved web pictures).

**Actions (Rashid unless marked):**

- Merge M1 (#54) and the A5 follow-up; start wave A.

- Make the repository private; set the push secrets and the Cloudflare spend limit.

- An Arabic reader checks every customer-facing Arabic string on the site and the console (founder or a trusted reader).

- Founder: retest the demo order from the phone after SP2, including "مشيلي الطلب" after closing.

- Founder: approve the 282 names on /names and pictures as they arrive; upload the 51 voice notes.

- Everything else still open is in HANDOFF, "Founder / Rasheed".
