# Alo King strategy, part 5: console, website, design direction, the never-stranded hand-off

Planning chat, 15 November 2026. Founder changes of the same day are applied: no Anthropic workspace or key changes (only metering and a cap per run), no paid plans before the paid pilot, launch hours 09:00 to 21:00 with rounds.

---

# A. The console, page by page

## Rules every screen follows
What needs a person comes first. Every number shows its comparison (yesterday, same day last week). One main action per row. Every list can be searched and filtered, and a filter is a link that can be saved. Nothing is blank while loading. Everything works with one thumb at 390 px, in Arabic and English. Every action still goes through the log-first path and the same SQL functions; no form changes what it posts.

## Navigation: six groups and Settings
Sidebar on a laptop, bottom bar on the phone (Today, Orders, Inbox, Approve, More). A command bar (search icon or Ctrl+K) jumps to an order, product, customer or page. A bell carries the same items as push. The hub pages `/approve`, `/stock` and `/more` are replaced by the groups; `/more` stays as the phone's menu.

| Group | Page | Decision | What changes |
|---|---|---|---|
| **Today** | Today (`/`) | Redesign | KPI tiles with comparisons (orders, sales, contribution, on-time share, reply time, missing-item rate, open cases, AI and message cost per order); "Needs you now"; live board of open orders by status with promise timers; riders against the cash caps as bars. A figure with no source yet is left out |
| | Exceptions (`/exceptions`) | Merge into Today | Becomes Today's "all exceptions" tab; the route stays |
| | Map | Add later | After L1 records positions; until then a village list with open-order counts |
| **Inbox** | Cases inbox | Add (HO1 functions, DS1 screen) | Hand-off cases and complaint cases in one list by timer; chat, order, drafted reply, one-tap send. Replaces "Chats and handoffs" |
| | Complaints (`/cases`) | Merge into Inbox | The complaint record opens from the case |
| **Orders** | Orders (`/orders`) | Redesign | A real table: filters (status, channel, village, rider, payment, dates), saved views, column choice, CSV; an order opens in a drawer with timeline, chat, lines with pictures, payments, refunds, actions |
| | Pick queue | Add (D4b) | Start, missing, substitute, done; packing checklist; scan later |
| **Approve** | One queue with tabs | Merge | Names, Pictures, Food facts, Search words, Spot checks, Places and ETA proposals (L1); counts on each tab; keys; large pictures; the source of each proposal in words |
| | Label intake (`/intake`) | Merge | A "from the pack" tab under Food facts |
| | Automatic approvals | Merge | The "Spot checks" tab |
| | Second approvals (`/approvals`) | Keep, restyle | Stays its own tab: it is about money; "Overpaid transfer" wording fixed |
| **Stock** | Catalog (`/catalog`) with Readiness | Merge and redesign | A grid with pictures and readiness badges; a placement editor (one new function) |
| | Stock levels | Add | Low stock, near expiry, holds |
| | Receiving, Returns | Keep, restyle | Invoice photo later (WH1b) |
| | Lots and bins, Temperature log, Counts | Add (WH1a) | First-to-expire list, twice-daily reading by photo, ten bins a day |
| | Purchase proposals, Suppliers | Add (WH1b) | The evening proposal; approve and send |
| | Unmet demand | Add (AN1) | What customers asked for and could not get |
| **Money** | Day (`/day-open`, `/day-close`) | Merge | One page with two states; the ledger shown as a green check, with the difference when it is not |
| | Payments | Keep, restyle | Proofs, late and overpaid transfers |
| | Refunds | Keep, restyle | |
| | Riders and cash (`/riders`) | Extend | Incidents, over and short per rider, the weekly guarantee report |
| | Hub money (`/money`), Exchange rate (`/fx`) | Keep, restyle | The safe, the float limit, deposits |
| **Reports** | Daily summary, Weekly report | Add (AN1) | The daily summary is also the nightly message |
| | Sales and margin; Customers; Delivery; Riders; Demand; AI and messages; Finance | Add (AN1) | Each: a date range with the previous period, filters, a chart, the table under it, CSV |
| | What the system learned | Add (N2) | |
| | Founder assistant | Add (AN1b) | A side panel on every Reports page |
| **Settings** | Zones and fees (`/zones`), Delivery windows and calendar (`/windows`) | Keep, move here | |
| | Village pause, Hours | Add (RD1) | One switch per village with the customer message |
| | Staff and roles | Add (OPS1) | Add and block staff from the console (one new function) |
| | Alerts and install | Keep | Push status, the install guide |
| | Template health | Add (OPS1) | Approved, pending, moved to marketing, with the fallback in force |
| | Vendors (`/merchants`) | Hide until the first vendor | |

Nothing is deleted from the database or the functions. Removed from navigation only: the three hub pages and Vendors.

## The reports
| Report | Shows |
|---|---|
| Daily summary | Orders by outcome and channel, sales, contribution, late deliveries, missing items, cases and how fast they were claimed, refunds and why, what waits for approval, what customers asked for that we lack |
| Weekly report | The eight numbers of the weekly review, repeat rate by first-order week, rider earnings per hour, the stop-condition figures |
| Sales and margin | By day, hour, category, product |
| Customers | New, returning, retention; one customer's page with stated preferences only |
| Delivery | Time distribution; on-time share by village and hour as a heat map; promise against actual |
| Riders | Jobs, acceptance speed, idle time, cash differences |
| Demand | Searches, misses, out-of-stock views, lost sales |
| AI and messages | Cards right without an edit, hand-off rate, reply time, cost per order, messages per order against the budget |
| Finance | Profit and loss, cash position, credit owed to customers, rider payables |

## The founder assistant
A narrow function, not an agent. Read-only tools over the report views: `what_went_wrong(day)`, `deliveries_at_risk()`, `money(day)`, `stock_alerts()`, `waiting_for_me()`, `compare(metric, period)`. Amounts are placed by code from the tool results. Every suggested change is a link to the console form. Its database role can only select from the report views.

---

# B. The website, page by page
Mobile first, Arabic first, the same catalog, prices, stock and rules as the chat. "Order on WhatsApp" is on every page: in the header on a laptop, in the bottom bar beside the cart on a phone.

| Page | Purpose and contents | Session |
|---|---|---|
| Home `/` | Logo, search, language, cart. One promise and two buttons (Order on WhatsApp with a greeting typed; Shop here). "Do we deliver to you?" by village or location: fee, time or next round, open or closed. Category tiles with pictures. "Order again" for a returning customer. Trust strip: cash on delivery, the rider keeps the whole fee, hours, a person on WhatsApp. Two doors, Groceries and "Restaurants and more"; the second is hidden until a vendor is live | DS1 |
| Category `/c/…` | Cards: picture, name, size, price, one-tap add; filters by brand, size, price, in stock; sort by price, size or popularity only | DS1 |
| Search `/search` | Results as you type, the chat's matcher, four ways of writing; "we don't sell this yet", logged | DS1 |
| Product `/p/…` | Large picture, name, size, price, stock, add; food facts with their status or "not confirmed yet"; a substitute when out of stock | DS1 |
| Cart `/cart` | Lines, quantities, the fee, progress to the minimum; stale price or sold-out named; the missing-item choice | WEB2 |
| Checkout `/checkout` | Number confirmed once by WhatsApp code; place (saved, pin, or "send my location on WhatsApp"); time (now, a round, pickup at the hub); payment (cash, which note; transfer proof when the company account exists); the card; Confirm | WEB2 |
| Tracking `/o/…` | Timeline, the promise, what changed, the handover code for prepaid orders, "talk to a person". No address or phone. A signed link that expires | WEB2 |
| Orders `/orders`, Account `/account` | History with "order again"; saved places; language; what we remember, with forget; sign out everywhere | WEB2 |
| How it works `/how` | Three steps, hours, villages, fees, how payment and refunds work. Only true statements from settings | UX3 |
| Send home `/send-home` | Buyer and recipient apart, a gift note, updates to the buyer. Built and hidden until a payment route from abroad exists | SH1 |
| Vendors `/v`, `/v/…` | Directory by facts (open now, time, fee, cuisine); vendor page with hours, preparation time, who delivers; menu items with options and declared allergens. Built on the data shapes, hidden until the first vendor | DS1 (design), E1 (data) |
| For shops `/join/shop`, for riders `/join/rider` | Short forms that open a WhatsApp message to the staff line; no outreach | UX3 |
| Privacy, Terms | The lawyer's text; the processor list; today's exchange rate in the footer of every page | UX3 |
| Offline, 404, 503 | Plain and honest | Built |

Quality bars: under 100 KB before pictures; server-rendered; right-to-left correct; structured data for products and the business; no invented content, reviews or promises.

---

# C. The design direction

## Brand
Decided: the crown's ink and gold; green only for "available" and "done". One token file, `packages/ui/tokens.css`, holds every colour, font, radius, shadow and the logo reference; a later change is one edit.

| Token | Value (DS1 verifies contrast and may adjust within the family) | Use |
|---|---|---|
| `ink` | #0E0F12 | Text, primary buttons, the dark theme's background |
| `ink-soft` | #2A2D34 | Secondary text, borders in dark |
| `paper` | #FAF8F3 | Background in light, text in dark |
| `gold` | #C9A227 | The crown, focus rings, active marks, large headings on ink. Never small text on paper |
| `gold-deep` | #8A6A12 | Gold that must be read on paper |
| `ok` | #14663B | Available, done, the ledger check |
| `warn` | #9A4D00 | Timers past amber |
| `danger` | #A8231B | Late, failed, destructive actions |

The crown is redrawn as a clean SVG from the WhatsApp profile artwork (the founder attaches the picture to DS1). The King figure appears only at the splash, an empty basket and "order placed".

## Type
IBM Plex Sans Arabic with IBM Plex Sans, served from our own domain and subset. One family for both scripts, clear numerals, tabular figures for prices. Prices keep Western digits and `$` in every language.

## Stack: lighter than the brief suggested
| Choice | Decision | Why |
|---|---|---|
| Tokens and styling | Tailwind CSS v4, compiled at build time into one stylesheet per app | No runtime; the content security policy stays strict |
| Console renderer | Stays as built (server-rendered pages in the Worker) | Every existing test passes unchanged; no write path moves |
| Components | `packages/ui`: one set of patterns, rendered as HTML functions for the console and as Astro components for the website | One look, two renderers, no React |
| shadcn/ui, Radix, TanStack Table, Tremor | **Not adopted** | They need React in the console: a client bundle, a looser policy and a rewrite of pages that work. Their patterns are copied, not their code |
| Tables | Sorting, filters and paging on the server through the address; a saved view is a saved address per staff member | Works on a slow phone and without scripts |
| Charts | Small charts drawn as SVG on the server (trend lines, bars, lines, heat map). One small chart library only if AN1 proves it is needed, loaded on Reports alone | Fast, printable, nothing to break |
| Interactivity | Small scripts served from our own address: command bar, drawer, toasts, search as you type, cart count, tracking refresh | |
| Icons | Lucide, as inline SVG | |
| Maps | MapTiler or Mapbox when a map is built (after L1), never OpenStreetMap's own tile servers | |

## Components DS1 builds
Button, input, select, chip, badge, card, KPI tile (value, comparison, trend line), timer chip (green, amber, red against a promise), data table, drawer, dialog, toast, tabs, command bar, bell, empty, loading and error states, product card, cart bar, order timeline, case row. A gallery page in each app (staging only) shows them in Arabic and English, light and dark.

## Proof
Before any page is rebuilt: the gallery, with screenshots at 390 and 1440 px in both languages and themes. Every later pull request attaches the same screenshots. An Arabic reader checks every customer-facing string before the friends' test: all strings are exported to one file for that read.

---

# D. The never-stranded hand-off, exact (session HO1, Opus)

## Principle
A person is added to a conversation; the bot is never removed from it. A technical failure is not a hand-off.

## Data (extends what exists)
- `handoffs` becomes the case record. New columns: `kind` (`person_requested`, `order_problem`, `complaint`, `refund`, `payment`, `safety`, `other`), `topic`, `order_id`, `state` (`open`, `claimed`, `resolved`), `claimed_by`, `claimed_at`, `first_staff_reply_at`, `last_staff_reply_at`, `callback_requested`, `after_hours`, `late`, `resolved_by`, `outcome`, `complaint_case_id`. View `support_cases` reads it.
- `conversations.bot_paused_until` (a time). Only a staff claim or a staff reply sets it. The turn code skips the model only while it is in the future.
- `conversations.human_handoff` is no longer read by the turn code. The migration sets it to false everywhere; the column stays for older reads.
- `settings.support`: `claim_alert_min` 3, `founder_alert_min` 5, `late_min` 15, `pause_min` 10, `topic_reminder_min` 10, `auto_credit` (`max_usd` 5, `per_customer_month_usd` 10, `per_customer_month_count` 2).

## Functions (SQL; the console and the turn code only call these)
`open_case(conversation, kind, topic, order, source)` (one open case per conversation and kind) · `claim_case(case, by)` · `staff_replied(case, by)` · `release_pause(case, by)` · `resolve_case(case, by, outcome)` · `request_callback(case)` · `case_timers_due()` for the minute cron · `cases_inbox(staff)` · `case_metrics(from, to)` · `customer_unanswered(minutes)` · `auto_credit_missing_item(order_item)`.

## What each of today's nine lock reasons becomes
| Today's reason | New behaviour | Case? |
|---|---|---|
| Model unavailable after retries | The turn is queued again once after 60 seconds. If it fails again: a fixed line ("a short technical problem on our side; send it again in a minute") with two buttons, Browse and Talk to a person. An ops exception `technical` | No |
| Agent error | The same | No |
| Agent did not finish | A fixed question with buttons, never silence | No |
| Hourly model cap reached | No model call: a fixed menu (browse, my order, a person). An ops exception | No |
| Button, window or substitution error | The fixed error line with a retry button; an ops exception carrying the error | No |
| Customer taps "a problem with my delivery" | A case, kind `order_problem` | Yes |
| The planner says a person is needed | A case with the planner's topic | Yes |
| The model calls `handoff_human` | A case with the model's stated topic | Yes |
| The customer asks for a person (new: recognised by code in four ways of writing, before any model) | A case, kind `person_requested`, with a "call me back" button | Yes |

## What the customer experiences
1. **Case opened, during open hours:** one line that a person will answer within minutes and that ordering continues meanwhile. The bot keeps taking orders, giving status and answering questions.
2. **A message about the case's topic while it is open:** one short "your request is open, a person will answer" at most every 10 minutes; anything else is answered normally.
3. **At 5 minutes unclaimed:** "we are still on it", with buttons: Keep ordering, Call me back, Leave a voice note.
4. **A person claims:** the bot steps back for 10 minutes, renewed by each staff reply. Buttons, pins, STOP and payments are still handled by code during the pause.
5. **The person goes quiet for 10 minutes:** the bot resumes, says the request is still open, and the case returns to the alert ladder.
6. **Outside open hours:** the honest opening time, the case recorded, orders kept for opening. No timers run; open cases head the day-open list.
7. **Resolved:** one closing line; the feedback question follows the normal rule.

The Arabic for these six lines is written by HO1 in `messages/ar.ts` and read by a person before the friends' test.

## What staff experience
| Time, open hours | Alert |
|---|---|
| 0 | The case appears in the Inbox; one message on the staff line; a push (cases are high priority) |
| 3 minutes unclaimed | Push again to the ops lead |
| 5 minutes | Push to the founder and the deputy |
| 15 minutes | Marked late; shown in the daily summary |

The Inbox row shows the timer, the kind, the order code and the last message. Opening it shows the chat, the order and a reply drafted by a narrow read-only function; the person edits and sends it through the gateway in one tap, or resolves.

## Safe automatic credit
Only for a missing item the picker recorded on a prepaid order (on a cash order the total simply drops). Within the three limits in settings. Logged, shown in the spot-check tab, counted per picker. Wrong, damaged or disputed items always go to a person.

## Measured
Cases by kind and reason; minutes to claim; minutes to the first human reply; cases late; pauses that expired; automatic credits. **Alarm:** any customer message with no reply of any kind within 2 minutes during open hours raises a high-priority exception. Target: zero.

## Done when
Each with a failing test first: a forced model error, a capacity error, the hourly cap and a button error each leave the chat answering the next message; "بدي احكي مع حدا" and its Latin-letter, English and French forms open a case and the bot then answers a price question; a claim pauses the bot and 10 quiet minutes resume it; the after-hours wording; the automatic credit's three limits; the migration clears every existing lock; the simulated-customer suite shows zero silences after a hand-off. HO1 starts only after SIM1 has merged its report, so SIM1's baseline is the old behaviour.

---

# E. Two founder changes, as they land in the plan
- **Backups without a paid plan (session BK0, Sonnet):** a nightly workflow dumps the staging database, encrypts it with a passphrase the founder creates once and keeps offline, and stores it in a private Cloudflare R2 bucket (free allowance) with a second copy in the private Supabase bucket; 14 nightly and 8 weekly copies kept. A weekly job restores the latest copy into a throwaway database and checks row counts and that the ledger balances: the tried restore, repeated. The same workflow points at production when it exists. Supabase Pro arrives with the paid pilot.
- **COST1, reduced:** every workflow that calls a model writes its tokens and dollars to a table and to its run summary, and stops at a dollar cap per run. No key or secret changes. Auto-reload with a limit goes on before the first paying customer.
