# The console, redesigned page by page (session S1, 14 November 2026)

The founder's cockpit: mobile first, role aware, installable on a phone, built around exceptions so nobody watches every
transaction. The Worker, the sign-in, the SQL permissions and audit-before-action stay exactly as built (D1 to D3): 21 page
modules, 67 tests. The redesign changes how pages look and are grouped, and adds the missing ones. Nothing is rewritten in a framework.

## The redesign of 15 November (session DS1)
The page-by-page decisions are now `docs/strategy/05-console-website-design-handoff.md`, section A; where this file differs, that one wins.
Built by DS1 on the design system (`packages/ui`): the shell (sidebar with the groups Today, Inbox, Orders, Approve, Stock, Money, Settings;
bottom bar Today, Orders, Inbox, Approve, More; command bar; bell; light and dark), Today (KPI tiles with comparisons, the exception list,
the live board with timers, riders against the caps as bars), the Inbox (case rows, the chat) and Orders (the table with filters, sorting,
columns, CSV, and the drawer). A gallery of every component is at `/gallery` on staging. The other pages wear the new tokens and are moved
onto the components, with Arabic, by UX2. What was left out because no read gives it yet is a table in `docs/HANDOFF.md`, DS1.

## The design reference applied, 17 November (session DS2)
The look is now the founder's design reference (`docs/DECISIONS.md`, "Design reference, 17 November 2026"), a pattern and never code.
The frame: a full-height ink sidebar from 900 px (the chosen page on paper, badges in gold); a paper top bar with the search pill, the
bell and sign-out; the test-data strip drawn with the preview notice; and on a phone a bottom bar **by role**: admin Today, Orders, Inbox,
Approve; lead Today, Orders, Inbox, Dispatch (the rider jobs page); picker Pick, Stock, Intake (the label day's photographing page); More
for everyone. The label day's two pages (photographing, label approvals) and every older page take the new look from the stylesheet;
their markup, data and actions did not change. The reference's rules for staff screens are part of `packages/ui` and its tests: 44 px
targets, no swipes, a toast with Undo instead of "are you sure", timers and statuses with words and an icon. The screens of the
reference that are not built yet, each with its session, are a table in `docs/HANDOFF.md`, DS2.

## The six staff pages on the design system, 17 November (session UX2a)
Today (four link tiles), Inbox (the escalation steps and "I'm on it"), Orders (the drawer with only the transitions `order_transitions` allows), Pick (the one-handed runner), Dispatch (cash against the cap, the code at the door, the pickup shelf) and Stock (counts and adjustments with a reason) are rebuilt on `packages/ui`; the SQL and the permissions did not change. A reversible action's toast carries Undo (`flashRedirect`'s `undo`), offered only where the database can take the action back (a pick mark). The command bar's search posts to `/go`, which opens an order by its code. Details and what is not proven: `docs/HANDOFF.md`, UX2a.

## What never changes
- The browser never holds a database key; the acting person comes from the session; every action is logged before it runs and
  does not run if the log cannot be written; the console has no insert, update or delete of its own (`no-direct-writes.test.ts`).
- Replies to customers and staff go through the gateway's `send()` (invariants 1, 9, 20).
- Roles: admin (founder, Rashid), ops lead, picker. Later: vendor (their own orders and statement only), rider (statement only).

## The shell (session D5, built 15 November 2026)
Built: `apps/console/src/style.ts` (tokens, bottom bar below 900 px, sidebar above), `nav.ts` (five places and their badges), `i18n.ts` (Arabic and English), `pwa.ts` (manifest, icons, service worker, page script, offline page), `push.ts` and migration 0158 (push), `pages/hubs.ts` (Approve, Stock, More, the install guide, the alerts switch), `pages/today.ts`, `pages/orders.ts` and migration 0159.
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
| Today (home) | **built (D5)** | The exception inbox first: what needs a person now, oldest first, each with its one action. Then orders late or at risk, riders with cash against the cap, the drawer. A quiet day shows a short green summary | `ops_exceptions` (kinds and their one action in `kinds.ts`), the existing late and rider reads, `hub_cash_view`. Late means past the zone ETA; "at risk" means no rider yet. No `deliveries_at_risk` view was built: nothing in it needs more than those reads | D5 |
| Day open, Day close | built | As today | `day_open_checklist`, `day_close_report`, `close_day` | - |
| Orders | **built (D5)** | Search by code, phone or name; one order page with its timeline, lines and changes, messages, payments, refunds, "wrong product" and "bot at fault" buttons that file an eval case | `search_orders`, `file_order_eval_case` (0159); the timeline is read from `order_events`, `payments`, `refunds` and `wa_messages` in the page (L1's `order_timeline` does not exist yet and was not waited for) | D5 |
| Chats and handoffs | built (extend) | Open handoffs, reply through the gateway, release to the Concierge; a box to correct a voice transcript | `release_handoff` | D5 |
| Pick queue | new | Orders waiting, start, missing, substitute, done (the ops-line flow, on a screen); scan to pick later | `pick_queue`, `start_pick`, `pick_item_missing`, `finish_pick` | D4b |
| Riders and cash | built (extend) | Drops, statements, payouts; rider incidents (`mark_rider_off`, `call_off_stranded`, `receive_rider_cash`); over/short per rider | existing, plus F1's view | D4b |
| Windows and calendar | new | Delivery window plans, capacity, cut-offs; the calendar (Ramadan, Lent, holidays); one slot's edit; the schedule; reschedule or cancel a scheduled order | `delivery_window_plans`, `delivery_calendar`, `edit_delivery_slot`, `delivery_schedule`, `reschedule_order`, `cancel_scheduled_order` | D4 |

### Approve (minutes a day)
| Page | Status | What it shows or does | SQL | Session |
| --- | --- | --- | --- | --- |
| **Product readiness** | new | One row per product: name, picture, facts, cost, search words, placement, each a tick or what is missing; filters "blocks the catalog", "blocks ordering"; links to the page that fixes it | `product_readiness()` (new) | D4 |
| **Names review** | new | The 282 proposed Arabic and English names and sizes beside the current ones; approve, correct or reject each; keys a, c, r and the arrows; "Approve all shown" for the screenful (at most 20), one at a time, logged, with undo for the batch; progress counter. Swipe was not built: a swipe that approves is too easy to do by accident on a phone; the buttons are 44 px | `product_name_proposals`, `review_product_name()` (new) | D4 |
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

## What D5 left for a live account
- The VAPID secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; `node apps/console/scripts/vapid-keys.mjs` makes them) are not set on any Worker: until they are, the More page says alerts are not set up and the cron does nothing. The console workflow does not set them.
- Nothing has been pushed to a real phone: the encryption is checked against RFC 8291's own example and an independent receiver, the rest against fakes. First real push: install on an iPhone, switch alerts on, raise a `pick_empty` exception on staging.
- The Arabic strings in `i18n.ts`, `kinds.ts` and the pages are model-written and need a reader of Arabic. The 24 pages built before D5 are English inside an Arabic shell (marked `lang="en" dir="ltr"`).

## Cost
None beyond the existing console Worker. Push uses the browsers' own push services (free).

## Order of work
D4 (names, readiness, windows, basis display, action log table) → D4b (pick queue, rider incidents) → D5 (shell, installable,
push, Today as an exception inbox, orders page) → the pages that arrive with I1, L1, WH1, AN1, N2.
