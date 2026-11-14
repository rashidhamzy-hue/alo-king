# The console, redesigned page by page (session S1, 14 November 2026)

The founder's cockpit: mobile first, role aware, installable on a phone, built around exceptions so nobody watches every
transaction. The Worker, the sign-in, the SQL permissions and audit-before-action stay exactly as built (D1 to D3): 21 page
modules, 67 tests. The redesign changes how pages look and are grouped, and adds the missing ones. Nothing is rewritten in a framework.

## What never changes
- The browser never holds a database key; the acting person comes from the session; every action is logged before it runs and
  does not run if the log cannot be written; the console has no insert, update or delete of its own (`no-direct-writes.test.ts`).
- Replies to customers and staff go through the gateway's `send()` (invariants 1, 9, 20).
- Roles: admin (founder, Rashid), ops lead, picker. Later: vendor (their own orders and statement only), rider (statement only).

## The shell (session D5)
- One stylesheet with design tokens; bottom navigation on phones (Today, Orders, Approve, Stock, More), a sidebar on wide screens.
- Arabic and English, right to left handled by logical CSS; large tap targets; forms that work with one thumb.
- Installable: manifest, icons, a service worker that caches the shell only (never data). On iPhone a one-screen guide to "Add
  to Home Screen", because Safari cannot prompt and web push works there only after installing (RESEARCH_REGISTER f).
- **Push alerts** where supported (`push_subscriptions`, VAPID keys as Worker secrets), sent by the console Worker's cron for
  new high-priority exceptions. Push is an extra: the same alert always goes to the ops WhatsApp line and shows in the list.
- A badge on every navigation item that has something waiting. An empty state says "nothing needs you".
- Second approval from the phone: the approvals page is reachable in two taps from a push.

## Pages
Status: **built** (exists and tested), **new**, **extend**. Class as in the system plan.

### Run the day
| Page | Status | What it shows or does | SQL | Session |
| --- | --- | --- | --- | --- |
| Today (home) | extend | The exception inbox first: what needs a person now, oldest first, each with its one action. Then orders late or at risk, riders with cash against the cap, the drawer. A quiet day shows a short green summary | `ops_exceptions`, `riders_on_shift`, `day_open_checklist`, `deliveries_at_risk` (new view) | D5 |
| Day open, Day close | built | As today | `day_open_checklist`, `day_close_report`, `close_day` | - |
| Orders | new | Search by code, phone or name; one order page with its timeline, lines and changes, messages, payments, refunds, "wrong product" and "bot at fault" buttons that file an eval case | `order_timeline` (L1), existing tables | D5 |
| Chats and handoffs | built (extend) | Open handoffs, reply through the gateway, release to the Concierge; a box to correct a voice transcript | `release_handoff` | D5 |
| Pick queue | new | Orders waiting, start, missing, substitute, done (the ops-line flow, on a screen); scan to pick later | `pick_queue`, `start_pick`, `pick_item_missing`, `finish_pick` | D4b |
| Riders and cash | built (extend) | Drops, statements, payouts; rider incidents (`mark_rider_off`, `call_off_stranded`, `receive_rider_cash`); over/short per rider | existing, plus F1's view | D4b |
| Windows and calendar | new | Delivery window plans, capacity, cut-offs; the calendar (Ramadan, Lent, holidays); one slot's edit; the schedule; reschedule or cancel a scheduled order | `delivery_window_plans`, `delivery_calendar`, `edit_delivery_slot`, `delivery_schedule`, `reschedule_order`, `cancel_scheduled_order` | D4 |

### Approve (minutes a day)
| Page | Status | What it shows or does | SQL | Session |
| --- | --- | --- | --- | --- |
| **Product readiness** | new | One row per product: name, picture, facts, cost, search words, placement, each a tick or what is missing; filters "blocks the catalog", "blocks ordering"; links to the page that fixes it | `product_readiness()` (new) | D4 |
| **Names review** | new | The 282 proposed Arabic and English names and sizes beside the current ones; approve, correct or reject each; keyboard and swipe; progress counter | `product_name_proposals`, `review_product_name()` (new) | D4 |
| Pictures | built (extend) | Add the vision check's reasons and the source page; bulk approve a screenful only for brand or Open Food Facts sources | `review_product_image` | D4 |
| Food facts and label intake | built (extend) | Show the **basis** of every proposal in words ("inferred from the ingredient list, not printed on the pack"; "from a web page for the Gulf market"); the label photo beside it; a disagreement between label and web source is flagged and the label wins (audit points 1, 4) | `food_fact_review_queue`, `review_proposed_fact` | D4 |
| Search words | built | As today | 0076, 0080 | - |
| Automatic approvals | new | Yesterday's automatic approvals with the checks each passed; the day's random tenth to spot-check; a field switched back to manual after a failed check | `auto_approvals`, `spot_check_result()` | I1 |
| Approvals (second person) | built | Price changes and refunds above the limits | `decide_approval` | - |
| Landmarks and places | new | Proposed place names and landmarks from deliveries and rider notes; approve, merge, reject | `landmark_proposals` | L1 |
| ETA and zone proposals | new | Measured times against the settings; apply with one tap and a reason | `delivery_time_stats`, `set_zone` | L1 |

### Stock and money
| Page | Status | Notes | Session |
| --- | --- | --- | --- |
| Catalog, Receiving, Returns, Refunds, Hub money, Exchange rate, Zones, Payments | built | Restyled only; payments gains "late payment" (G1-04) | F1, D5 |
| Invoice review | new | The supplier invoice photo, the proposed lines, match or "new item"; confirm quantities | WH1 |
| Lots, bins, counts, reorder | new | FEFO list, today's cycle count, reorder proposals | WH1 |
| Unmet demand and buying list | new | What customers asked for and could not get | AN1 |

### Know
| Page | Status | Notes | Session |
| --- | --- | --- | --- |
| Daily summary, Weekly report | new | SYSTEM_PLAN section 11; the daily summary is also the nightly message | AN1 |
| Founder assistant | new | Admins only; read-only tools; every suggested change is a link to a form (conflict register C3) | AN1 |
| What the system learned | new | The nightly note: new phrasings, misses, proposals waiting, the eval result | N2 |
| Costs | new | AI and message cost per order (`ai_cost_daily`, `message_meter`) against the model | AN1 |
| Customers | new | One customer's profile: places, history, stated restrictions, credit, feedback | AN1 |

### Later
Vendors (onboarding workflow, menu review, statements, performance), vendor and rider sign-in, loyalty. Class B, with Phase 8 and LOY1.

## Tests the redesign adds
- Every existing page test still passes unchanged (the redesign may not touch what a form posts).
- A screenshot-free check: each page renders valid HTML with a `lang`, a `dir`, a title and no control smaller than 44 px (a parser test).
- The service worker caches no response with personal data (a test lists what it may cache).
- Push: a subscription belongs to one staff party; a removed staff member's subscription is deleted; an alert is sent once per exception.
- Names review: approving a name updates the product, queues its search words, and is undone by rejecting within the page.
- Readiness: a product with no approved picture is "blocks the catalog", not "blocks ordering".

## Cost
None beyond the existing console Worker. Push uses the browsers' own push services (free).

## Order of work
D4 (names, readiness, windows, basis display, action log table) → D4b (pick queue, rider incidents) → D5 (shell, installable,
push, Today as an exception inbox, orders page) → the pages that arrive with I1, L1, WH1, AN1, N2.
