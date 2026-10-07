# Alo King Complete Website Strategy

## Website, dashboards, ordering, design system, copywriting, SEO, AIO, GEO, and shared WhatsApp commerce architecture

**Project:** Alo King — Lebanon’s WhatsApp-native food, grocery, and local delivery platform  
**Date:** 6 October 2026  
**Primary principle:** The website and WhatsApp are two interfaces to the same commerce operating system, not two separate products.

---

# 1. The website’s job

Alo King’s website should do five jobs exceptionally well:

1. **Make local businesses discoverable.**
2. **Let customers browse and order without downloading an application.**
3. **Make WhatsApp the easiest continuation of the experience, not a disconnected channel.**
4. **Give merchants, drivers, and operations teams the tools to fulfil orders reliably.**
5. **Create high-quality public pages that search engines and answer engines can understand.**

The website should not feel like a generic marketplace copied from a global delivery app. Alo King’s advantage is:

```text
Lebanese local knowledge
+ WhatsApp-native ordering
+ voice notes in Lebanese Arabic and mixed languages
+ verified local businesses
+ human-backed fulfilment
+ no app download
```

## Positioning statement

> **Alo King is Lebanon’s easiest way to discover local food and groceries, order through the website or WhatsApp, and get help from a real local delivery network.**

## Brand personality

```text
Local
Fast
Warm
Capable
```

## Brand promise

> **Tell Alo King what you want. We’ll help you find it, order it, and get it there.**

---

# 2. Website architecture at a glance

```text
Public website
├── Home
├── Explore
├── Search results
├── Vendor directory
├── Public vendor pages
├── Category pages
├── Village/area pages
├── Offers and campaigns
├── How it works
├── Voice ordering
├── For businesses
├── Claim your business
├── Become a driver
├── Help and support
├── Safety, privacy, terms, and delivery policy
└── WhatsApp deep links

Customer application
├── Website order flow
├── Account and phone verification
├── Saved addresses
├── Active orders
├── Order history and reorder
├── Favorites
├── Rewards and referrals
└── Support

Merchant application
├── Merchant overview
├── Orders/Kitchen display
├── Menu and items
├── Menu import/review
├── Hours and availability
├── Offers and campaigns
├── Customer insights
├── Team and permissions
├── Billing and credits
├── Claim/verification status
└── Merchant WhatsApp setup

Driver application
├── Driver home
├── Availability
├── Assigned orders
├── Route and navigation
├── Pickup
├── Delivery
├── Cash ledger
├── Earnings
├── Incident reporting
└── Profile and safety

Operations application
├── Live command center
├── Orders and exceptions
├── Dispatch
├── Vendors and claims
├── Drivers and zones
├── Support inbox
├── Payments and reconciliation
├── Campaign approval
├── AI/quality monitoring
├── Audit and security
└── Reports
```

---

# 3. Shared system architecture

## One database, one order state machine

The website, WhatsApp engine, merchant dashboard, driver dashboard, and operations dashboard must use the same Supabase source of truth.

```text
Website customer action
       │
WhatsApp customer action
       │
       ▼
Shared Supabase domain layer
       ├── customer identity
       ├── baskets
       ├── menu versions
       ├── orders
       ├── order events
       ├── payments
       ├── notifications
       ├── zones
       ├── drivers
       ├── merchant memberships
       └── audit log
       │
       ├── WhatsApp notifications
       ├── merchant dashboard
       ├── driver dashboard
       ├── operations dashboard
       └── customer website tracking
```

## The website must not create a second order system

Website and WhatsApp must share:

- vendor IDs;
- menu item IDs;
- menu versions;
- item availability;
- prices and currency rules;
- basket structure;
- order state transitions;
- customer phone identity;
- saved addresses;
- order history;
- loyalty ledger;
- campaign attribution;
- support timeline.

## Website-to-WhatsApp continuity

A customer should be able to:

```text
browse website
→ add to basket
→ open WhatsApp with the basket context
→ confirm or edit by text/voice
→ receive merchant and delivery updates on WhatsApp
```

Or:

```text
start on WhatsApp
→ receive a secure website link
→ review menu or checkout
→ return to WhatsApp without losing the basket
```

Use a short-lived signed handoff token containing:

```text
customer/session reference
basket ID
vendor ID
intended action
expiry
nonce
```

Do not place raw order details, phone numbers, or trusted authorization in the URL.

## Cart identity

For a guest website customer:

1. Create an anonymous session.
2. Let the customer browse and build a temporary basket.
3. Ask for a phone number at checkout or WhatsApp handoff.
4. Verify using WhatsApp or OTP.
5. Merge the anonymous basket into the customer’s server-side basket.
6. Re-price and re-check availability before order confirmation.

The server always re-checks:

```text
vendor is open
items still available
prices are current
options are valid
zone is active
delivery fee is current
payment method is available
```

---

# 4. Primary public navigation

## Desktop navigation

```text
Alo King logo
Explore
How it works
For businesses
Become a driver
Search
[Order on WhatsApp]
[Open account]
```

## Mobile navigation

```text
Alo King logo                         [WhatsApp icon]

Explore    Search    Orders    Account
```

The primary CTA should always be visible:

```text
Order on WhatsApp
```

The website should not pressure customers to download an app because Alo King is intentionally a no-download service.

## Footer navigation

```text
Explore
Restaurants
Groceries
Offers
Areas we serve
How ordering works
Voice-note ordering

For partners
Claim your business
Merchant login
Become a driver
Partner requirements

Help
Track an order
Contact support
Refunds and cancellations
Delivery policy

Company
About Alo King
Privacy
Terms
Cookie policy
Accessibility
```

---

# 5. Public homepage layout and copy

## Homepage structure

### Section 1 — Hero

**Eyebrow:**

> FOOD, GROCERIES & LOCAL DELIVERY IN LEBANON

**Headline:**

> **Tell Alo King what you’re craving.**

**Supporting copy:**

> Browse local restaurants and shops, order on the website or send us a WhatsApp message. You can even send a voice note in Lebanese Arabic, English, French, or a mix of all three.

**Primary CTA:**

> Order on WhatsApp

**Secondary CTA:**

> Explore nearby

**Microcopy below CTA:**

> No app download. Real local businesses. Clear prices before you confirm.

**Hero input placeholder:**

> What are you looking for today?

**Voice CTA:**

> Send a voice note

### Section 2 — Three-step explanation

**Heading:**

> **Your order, your way.**

**Step 1 — Tell us what you want**

> Search the website, browse a local menu, type in WhatsApp, or send a voice note.

**Step 2 — Check everything before you confirm**

> We show the items, quantities, delivery details, and total before your order is placed.

**Step 3 — Follow it all the way home**

> Get updates on WhatsApp and track your delivery when your order is on the way.

### Section 3 — Why Alo King

**Heading:**

> **Local delivery should feel local.**

**Copy:**

> Alo King is built around the way people in Lebanon actually order: by message, by voice note, by landmark, by “the usual,” and sometimes in three languages in the same sentence.

**Cards:**

- **No app to download** — Order from the website or WhatsApp.
- **Speak naturally** — Lebanese Arabic, English, French, Arabizi, and mixed language are welcome.
- **Real local businesses** — Discover restaurants, groceries, and shops around you.
- **Clear confirmation** — You review the basket and total before we place the order.

### Section 4 — Voice-note feature

**Heading:**

> **Can’t be bothered to type? Just talk to Alo King.**

**Copy:**

> Say what you need in the language and style that feels natural. We’ll show you what we understood before anything is ordered.

**CTA:**

> See how voice ordering works

### Section 5 — Explore categories

**Heading:**

> **What are you in the mood for?**

Categories:

```text
Lebanese
Shawarma
Pizza
Burgers
Breakfast
Desserts
Coffee
Groceries
Pharmacy and essentials, if legally supported
Offers
```

### Section 6 — Local area discovery

**Heading:**

> **Find what’s open near you.**

**Copy:**

> From your village to the next town over, see what is available, what is open now, and where Alo King delivery is active.

**CTA:**

> Choose your area

### Section 7 — For merchants

**Heading:**

> **Own a restaurant or local business? Be where your customers already are.**

**Copy:**

> Claim your Alo King profile, update your menu through the portal or WhatsApp, receive orders in real time, and reach customers with campaigns that respect consent and your budget.

**CTA:**

> Claim your business

### Section 8 — Final CTA

**Heading:**

> **Your next order is one message away.**

**CTA:**

> Order on WhatsApp

**Secondary CTA:**

> Explore Alo King

---

# 6. Public explore and search experience

## Explore page goals

The Explore page should answer immediately:

```text
What is available?
Where is it?
Is it open?
Can it deliver to me?
How much does it cost?
Can I order now?
```

## Explore layout

```text
Area selector
Open now toggle
Delivery available toggle
Search bar
Category chips
Offer chip
Sort/filter drawer
Vendor cards
Map/list switch
```

## Vendor card content

```text
cover/photo
verified status
vendor name in Arabic and English where available
cuisine/category
area
open/closed status
estimated preparation time
estimated delivery range
price level
minimum order if applicable
order button
WhatsApp button
```

## Search copy

Placeholder:

> Search restaurants, dishes, groceries, or areas

Empty state:

> We couldn’t find that yet. Try another dish, restaurant, or village — or ask Alo King on WhatsApp.

No active zone:

> Alo King is still building delivery coverage here. You can browse the local businesses and join the availability list.

Closed vendor:

> Closed now — you can still view the menu and ask Alo King when it opens.

## Search ranking

Rank by:

```text
exact item/vendor match
availability
open status
customer zone
verified quality
delivery feasibility
relevance
personal preference, only with consent
```

Do not rank only by paid placement. Sponsored listings must be clearly labelled.

---

# 7. Public vendor page strategy

Each vendor should have a crawlable public page:

```text
/m/{vendor-slug}
```

## Above-the-fold content

```text
vendor name
Arabic name where relevant
verified badge and explanation
category/cuisine
area
open/closed state
hours
order buttons
WhatsApp button
menu sections
```

## Vendor page copy template

> **Order from [Vendor Name] in [Area]**
>
> Browse the current menu, check item availability, and order through Alo King or WhatsApp. You can type your order or send a voice note in Lebanese Arabic, English, French, Arabizi, or a mix.

CTA:

> Start an order

Secondary CTA:

> Order on WhatsApp

## Trust labels

Use precise labels:

```text
Verified business
Profile claimed by business
Menu last updated [date]
Ordering active in your area
Open now
Delivery availability checked at checkout
```

Do not imply that an unclaimed scraped listing has been approved by the business.

## Menu UX

Each item shows:

```text
name
Arabic/English/French aliases where useful
short description
price and currency
options/modifiers
availability
allergen note if confirmed
add button
```

Do not show stale stock as guaranteed. Use:

> Availability is confirmed again before your order is placed.

---

# 8. Website ordering flow

## Flow A — guest browsing to website order

```text
Home
→ choose area
→ browse/search
→ vendor page
→ add item
→ customize
→ cart
→ delivery location
→ phone verification
→ payment method
→ final review
→ confirm order
→ order tracking
```

## Flow B — website to WhatsApp

```text
vendor page
→ add item
→ click Order on WhatsApp
→ secure handoff opens WhatsApp
→ Alo King loads the basket
→ customer edits by text or voice
→ customer confirms
```

## Flow C — WhatsApp to website

```text
WhatsApp conversation
→ “See menu” link
→ secure vendor/menu page
→ customer browses visually
→ basket remains linked
→ return to WhatsApp or complete on web
```

## Checkout rules

Before final confirmation show:

```text
vendor
items and quantities
options and notes
subtotal
delivery fee
discounts
currency conversion if applicable
total
address and landmark
contact phone
payment method
estimated preparation/delivery time
```

Primary CTA:

> Confirm order

Secondary actions:

```text
Edit basket
Change address
Change payment
Talk to Alo King
Cancel
```

Never place an order from a website click that has not passed the same server-side confirmation logic as WhatsApp.

---

# 9. Customer account area

## Customer navigation

```text
Overview
Active orders
Order history
Saved addresses
Favorites
Rewards
Referrals
Notifications and marketing choices
Privacy and data
Support
```

## Customer dashboard copy

**Heading:**

> Your Alo King

**Empty orders:**

> Your next order is waiting. Find something nearby or tell Alo King what you’re craving.

**Reorder CTA:**

> Order this again

**Address safety:**

> Your saved address is used as a starting point. We check delivery availability again for every order.

## Reorder behavior

A reorder must always:

- re-price from the current menu;
- re-check availability;
- re-check vendor opening status;
- re-check delivery zone and fee;
- show a new summary;
- require explicit confirmation.

---

# 10. Merchant dashboard strategy

## Merchant information architecture

```text
Merchant overview
Orders / Kitchen
Menu
Menu import
Availability and hours
Offers and campaigns
Customers and insights
Team members
WhatsApp management
Billing and campaign credits
Profile and verification
Help
```

## Merchant dashboard home

Show only operationally useful information:

```text
orders waiting for action
orders preparing
orders ready
orders delayed
sales today
acceptance rate
average preparation time
menu completeness
campaign balance
```

Primary dashboard CTA:

> Open order queue

The dashboard should never bury a pending order under analytics.

## Orders/Kitchen view

Use a high-contrast Kanban or queue:

```text
New
Accepted
Preparing
Ready
Picked up
Completed
Needs attention
```

Each order card shows:

```text
short order code
time received
customer first name or masked identity
items and modifiers
special notes
payment method
delivery/pickup
countdown to SLA
accept/reject actions
```

Actions must be idempotent and permission-checked.

## Menu management

Merchant can:

- edit item name and description;
- add Arabic, English, and French names;
- edit price and currency;
- mark sold out;
- set option groups;
- upload photos;
- reorder sections;
- set item availability windows;
- import a PDF/image menu;
- review AI extraction proposals;
- publish a new menu version.

AI extraction must create a draft. It must never publish a menu or price without merchant review.

## Merchant voice and WhatsApp controls

The dashboard should show:

```text
merchant WhatsApp number
linked team members
last webhook received
last notification delivered
backup notification method
current open/paused status
```

Merchant commands sent through WhatsApp should be summarized before execution:

> I heard: mark chicken shawarma sold out and pause orders for 30 minutes. Apply these changes?

## Merchant campaign center

Campaign creation flow:

```text
objective
eligible audience
consent status
message/template
offer and budget
schedule
frequency cap
preview
estimated reach
estimated cost
approval
send/pause/report
```

Show a clear compliance warning:

> Only customers with valid marketing consent are eligible. Every campaign includes an easy opt-out.

---

# 11. Merchant claiming and verification pages

## Public claim page

Route:

```text
/claim/{vendor-slug}
```

**Headline:**

> **Is this your business? Make your Alo King profile yours.**

**Copy:**

> Claim your listing to correct your details, publish your menu, receive orders, update availability, and speak to customers through the channel they already use.

CTA:

> Claim this business

Secondary:

> Report incorrect information

## Claim flow

```text
choose business
→ enter owner/manager phone
→ receive OTP or WhatsApp verification
→ select verification method
→ submit evidence
→ pending review or instant low-risk approval
→ complete business profile
→ connect merchant WhatsApp number
→ publish menu
```

## Verification levels

```text
Directory listing
Contact verified
Business identity reviewed
Menu verified
Ordering enabled
Premium verified partner
```

Do not display a generic “verified” badge without explaining what it means.

## If the business is missing

Page copy:

> **Can’t find your business? Add it to Alo King.**
>
> Tell us the business name, area, category, phone number, and public location. We’ll review the submission before it becomes visible to customers.

Required fields:

```text
business name
Arabic/English name
category
village/area
phone
map pin
opening hours
website/social link
owner/manager contact
```

Do not immediately enable ordering for a newly submitted business. It enters a review queue.

---

# 12. Driver dashboard strategy

## Driver information architecture

```text
Today
Available orders
Active delivery
Route
Cash ledger
Earnings
History
Safety and support
Profile
```

## Driver home

Show:

```text
online/offline state
current zone
active assignment
available order count
cash owed/held
today’s completed deliveries
estimated earnings
```

Primary action:

> Go online

The driver must clearly see when the zone is not active:

> Ordering is currently paused in this zone because merchant or driver coverage is incomplete.

## Assignment view

Each order shows:

```text
pickup business
pickup readiness
delivery village/landmark
customer contact action
COD amount
route estimate
batch compatibility
special instructions
```

## One order versus two

Default rule:

```text
one active cart/order per driver unless dispatch approves a compatible batch
```

A second order may be assigned only when:

- the pickup and delivery routes are compatible;
- the second pickup does not materially delay the first;
- temperature/food safety permits batching;
- the driver capacity rule allows it;
- the customer ETA remains inside the promised range;
- operations can see and reverse the assignment.

The driver dashboard must explain this operationally, not expose hidden optimization logic.

## Proof of delivery

Support:

```text
customer confirmation code
photo only where appropriate and legally justified
location/time event
not-collected reason
cash received
cash returned or reconciled
```

---

# 13. Operations dashboard strategy

The operations dashboard is the command center, not a collection of admin tables.

## Operations navigation

```text
Command center
Live orders
Exceptions
Dispatch map
Zones
Merchants
Drivers
Claims and verification
Support inbox
Payments
Campaign approvals
AI quality
Analytics
Audit and security
Settings
```

## Command center priorities

Top row:

```text
orders needing action
merchant timeouts
driver shortages
payment mismatches
support SLA breaches
WhatsApp/provider incidents
```

Live order table:

```text
order code
vendor
zone
status
age
merchant acknowledgement
assigned driver
ETA risk
payment state
next action
```

## Exception-first design

The dashboard should not make operators search for failures. Create views for:

- merchant did not acknowledge;
- order stuck in preparing;
- driver unassigned;
- driver GPS stale;
- customer not reachable;
- payment pending;
- duplicate webhook;
- send failure;
- order outside active zone;
- vendor suddenly closed;
- suspected fraud;
- food safety or allergy complaint.

Every exception needs:

```text
owner
SLA
recommended action
manual override
reason code
audit trail
```

---

# 14. Design system

## Design movement

**Warm local utility** — a blend of Mediterranean hospitality, modern commerce clarity, and a slightly playful “king” identity. The interface should feel fast and trustworthy rather than luxurious or corporate.

## Core principles

1. **One obvious next action.** Every screen should make the next step clear.
2. **Local warmth without clutter.** Use Lebanese character through language, color, and imagery, not decorative noise.
3. **Operational clarity.** Merchant, driver, and operations screens prioritize urgency and state.
4. **Confidence before commitment.** Show what Alo King understood, what it will cost, and what will happen next.

## Color philosophy

The palette combines:

- deep ink for confidence and readability;
- crown gold for brand recognition and action;
- warm cream for hospitality and food;
- aubergine for depth and premium moments;
- mint/green for verified success;
- coral for attention and exceptions.

### Core palette

| Token | Hex | Use |
|---|---|---|
| `ink-950` | `#17131A` | Main text, dark dashboard shell |
| `ink-800` | `#2A2430` | Secondary text, dark surfaces |
| `crown-500` | `#F4B63C` | Primary Alo King brand/action color |
| `crown-600` | `#D99720` | Hover/pressed crown action |
| `cream-50` | `#FFF9F0` | Main public background |
| `cream-100` | `#FFF1DD` | Cards and warm sections |
| `aubergine-700` | `#3A2448` | Premium sections and depth |
| `mint-600` | `#1F9D72` | Success, verified, active |
| `coral-500` | `#E86655` | Error, delay, attention |
| `sky-500` | `#4D8FD8` | Information, tracking |
| `line` | `#E8DED2` | Borders and dividers |

### Brand signature color

**Crown Gold `#F4B63C`** is the ownable Alo King color. Use it consistently for the logo accent, primary CTA, active navigation state, and order-confirmation highlights.

Do not use crown gold for every decorative element. It should signal action and brand recognition.

## Typography

Recommended pairing:

```text
Latin: Plus Jakarta Sans
Arabic: IBM Plex Sans Arabic
Fallback: system-ui, sans-serif
```

Alternative if licensing or performance requires fewer fonts:

```text
Noto Sans Arabic with a Latin-compatible fallback
```

### Type hierarchy

```text
Display: 48–64px desktop, 36–44px mobile, weight 800
H1: 40–52px, weight 800
H2: 28–36px, weight 750
H3: 20–24px, weight 700
Body: 16–18px, line-height 1.6
Small: 13–14px, line-height 1.4
Dashboard labels: 12–13px, weight 650, uppercase only sparingly
```

Arabic text should receive enough line height and should never be squeezed into narrow cards.

## Layout paradigm

Use **asymmetric editorial sections for public pages** and **dense task-focused shells for dashboards**.

Public pages:

```text
wide hero
split content blocks
local discovery rails
horizontal vendor cards
map/list sections
clear CTA bands
```

Dashboards:

```text
persistent sidebar on desktop
bottom navigation on mobile
sticky action bar for urgent tasks
dense but breathable cards
status color and time first
```

Avoid generic centered card grids for every section.

## Signature visual motifs

1. **Crown mark:** a simple three-point crown or crown spark integrated into the logo and active states.
2. **Route line:** a subtle curved line motif representing the path from craving to doorstep.
3. **Message bubble:** rounded speech shape used selectively around WhatsApp and voice-note moments.

## Border radius and elevation

```text
small: 8px
medium: 14px
large: 22px
pill: 999px
```

Use soft shadows only for floating actions and cards. Avoid excessive glassmorphism.

## Buttons

Primary:

```text
background crown-500
text ink-950
rounded 12px
clear pressed state
```

Secondary:

```text
cream/white background
ink border
```

Danger:

```text
coral background only for destructive action
```

Every destructive action needs a reason/confirmation where appropriate.

## Motion

Use motion to clarify state:

- 150–200ms hover/press;
- 250ms drawer and modal;
- order-status transition with a short pulse;
- no decorative animation while a merchant is handling a time-sensitive order;
- respect `prefers-reduced-motion`.

---

# 15. UX rules for every role

## Customer

- Show one primary action.
- Preserve the basket across website and WhatsApp.
- Never hide delivery cost until the final step.
- Keep address instructions human and local.
- Explain “verified” and “available” precisely.
- Make support reachable from every active order.

## Merchant

- Pending orders always outrank analytics.
- New order sound/visual signal must be unmistakable.
- The merchant must be able to pause orders in one action.
- Every AI proposal is visibly a proposal until approved.
- Price changes show the effective menu version.

## Driver

- Never show unnecessary customer data.
- Show the next action and the cash amount.
- Use large touch targets.
- Keep navigation available while driving, but discourage unsafe interaction.

## Operations

- Show exceptions first.
- Every override requires a reason.
- Use a timeline for every order.
- Never rely on a dashboard color without a text status.
- Keep an audit trail for manual decisions.

---

# 16. SEO strategy

## Public indexable pages

Index only pages with real, useful public content:

```text
/
/explore
/m/{vendor-slug}
/category/{category-slug}
/area/{area-slug}
/offers
/how-it-works
/voice-ordering
/for-business
/drive-with-alo-king
/help/{article-slug}
```

Do not index:

```text
/customer
/merchant
/driver
/admin
/track/{private-token-or-order-id}
/claim/{private-or-unclaimed-flow}
/cart
/checkout
/support/private
```

## Technical SEO requirements

Every public route needs:

- meaningful initial HTML, not only an empty React mount;
- route-specific title;
- route-specific meta description;
- canonical URL;
- Open Graph title, description, URL, type, image;
- Twitter card metadata;
- real 404 status for missing vendor pages;
- `noindex` for private/error states;
- sitemap entries only for intended public pages;
- robots rules aligned with the intended indexability;
- internal links between area, category, and vendor pages;
- fast mobile performance;
- accessible headings and landmarks.

## Title examples

Home:

> Alo King — Order Food and Groceries in Lebanon

Vendor:

> Order from [Vendor Name] in [Area] | Alo King

Area:

> Food Delivery in [Area] | Restaurants and Local Shops | Alo King

Category:

> Best [Category] in Lebanon | Order on WhatsApp | Alo King

Voice ordering:

> Order Food by WhatsApp Voice Note in Lebanon | Alo King

For business:

> Grow Your Restaurant with Alo King | WhatsApp Orders in Lebanon

## Meta description examples

Home:

> Discover local restaurants and shops in Lebanon. Browse online or order through WhatsApp by text or voice note in Lebanese Arabic, English, French, or mixed language.

Vendor:

> Browse the menu, check availability, and order from [Vendor Name] in [Area] through Alo King or WhatsApp. No app download required.

Voice ordering:

> Send Alo King a WhatsApp voice note in Lebanese Arabic, English, French, Arabizi, or a mix. Review what we understood before placing your order.

## Structured data

Use only schema that matches visible page content:

```text
Organization
WebSite
WebPage
BreadcrumbList
Restaurant or LocalBusiness
FoodEstablishment
Product/Offer where accurate
FAQPage only for visible FAQs
ItemList for visible lists
```

Do not invent ratings, prices, hours, or reviews.

## Local SEO

For each area page include:

```text
area name in Arabic and English
businesses actually listed
ordering coverage status
delivery-zone status
local FAQs
nearby areas
local landmarks where useful
last-updated date
```

Do not create hundreds of thin pages with only a changed village name. Each indexable page must have unique, useful content.

---

# 17. AIO and GEO strategy

AIO means **Answer Engine Optimization**. GEO means **Generative Engine Optimization**. The goal is not to manipulate AI systems; it is to make Alo King’s public facts clear, structured, current, and easy to cite.

## Make Alo King easy to understand

Clearly state:

```text
what Alo King is
where it operates
how ordering works
which languages/voice styles it supports
what businesses are listed
how verification works
which areas have active delivery
how merchants claim listings
how support works
```

## Create answer-ready content

Useful question pages:

```text
How do I order food on WhatsApp in Lebanon?
Can I order in Lebanese Arabic by voice note?
Does Alo King require an app?
How can a restaurant claim its Alo King profile?
How does Alo King verify businesses?
How are delivery zones activated?
How can I track an Alo King order?
How do merchants receive orders?
How do I cancel an order?
How does Alo King handle refunds?
```

Answer each question directly in the first paragraph, then provide detail.

## Entity consistency

Keep the same public facts across:

- homepage;
- About page;
- social profiles;
- public vendor pages;
- Google Business presence where controlled by the business;
- press material;
- structured data;
- help center.

Use consistent:

```text
brand name
logo
company description
service areas
contact channels
WhatsApp number
business category
```

## Helpful public data

For public vendors, expose only approved public information:

```text
name
category
area
public hours
menu summary
public phone/WhatsApp link where authorized
verification status
ordering availability
```

Do not expose private merchant, customer, driver, order, or campaign information.

## AI-readable content patterns

Use:

- concise definitions;
- visible FAQs;
- clear headings;
- tables for service coverage where useful;
- explicit dates for “last updated” information;
- citations/links to policies;
- clean HTML, not important facts hidden inside images;
- descriptive alt text;
- direct canonical URLs.

An `llms.txt` file can be added as an optional supplemental guide, but it does not replace crawlable HTML, sitemap, robots, structured data, or strong public content.

---

# 18. Accessibility and performance

## Accessibility requirements

- WCAG 2.2 AA target.
- Keyboard navigation.
- Visible focus states.
- Screen-reader labels.
- Arabic RTL support.
- French and English language switching.
- Color is never the only status signal.
- Minimum touch target around 44px.
- Captions/transcripts for promotional videos.
- Reduced motion support.
- Error messages adjacent to fields.

## Performance requirements

Public pages:

```text
server/static initial HTML
small critical CSS
optimized images
lazy-load below the fold
no blocking third-party scripts
fast search interaction
```

Dashboards:

```text
load operational shell first
paginate history
subscribe only to relevant realtime channels
avoid rerendering all orders on every update
virtualize long tables
```

Do not open a live Realtime subscription for every historical order. Subscribe to the merchant’s active queue only.

---

# 19. Security and authorization

## Role model

```text
public visitor
customer
merchant member
merchant manager
merchant owner
driver
operations agent
operations manager
finance role
admin
```

Use server-enforced permissions. Hiding a button is not authorization.

## Private routes

The following must never be indexed or cached publicly:

```text
merchant data
customer account data
driver data
operations data
private tracking tokens
support conversations
payment records
campaign audiences
AI transcripts containing personal data
```

## Audit events

Record:

```text
who
what
when
which object
before/after state where appropriate
reason
source: web / WhatsApp / system / AI / human
```

Every AI mutation must identify:

```text
model
prompt version
tool
human confirmation state
```

---

# 20. Copywriting voice guide

## Voice

Alo King should sound:

```text
confident, not corporate
local, not forced
warm, not childish
clear, not overly clever
```

## Use

> Tell us what you’re craving.  
> We’ll show you what we understood.  
> You stay in control.

## Avoid

```text
Revolutionizing food delivery
The ultimate ecosystem
Seamless omnichannel synergy
AI-powered disruption
```

## CTA library

```text
Order on WhatsApp
Explore nearby
See the menu
Start an order
Send a voice note
Track my order
Order this again
Claim this business
Update my menu
Go online
Open the order queue
Pause orders
Get help
```

## Error copy

Instead of:

> Error 500

Use:

> Something went wrong while checking that order. Nothing was charged. Try again or talk to Alo King support.

Instead of:

> Invalid location

Use:

> We need a clearer delivery location. Share your pin or tell us the village and a nearby landmark.

Instead of:

> Vendor unavailable

Use:

> This business is not accepting orders right now. You can view the menu, save it, or ask Alo King when ordering opens again.

---

# 21. Measurement plan

## Public website

Track:

```text
area_selected
vendor_viewed
menu_item_viewed
add_to_cart
checkout_started
phone_verified
website_order_confirmed
whatsapp_handoff_started
voice_cta_clicked
```

## Merchant

Track:

```text
claim_started
claim_completed
menu_import_started
menu_import_approved
order_notification_acknowledged
order_accepted
order_timeout
item_marked_sold_out
campaign_previewed
campaign_sent
```

## Driver

Track:

```text
driver_application_started
driver_approved
driver_online
delivery_accepted
pickup_confirmed
delivery_confirmed
not_collected
cash_reconciled
```

Do not send raw messages, full addresses, or sensitive payment data to analytics.

## Core growth metrics

```text
visitor → vendor view
vendor view → menu interaction
menu → cart
cart → checkout
checkout → confirmed order
website → WhatsApp continuation
first order → reorder
merchant claim completion
merchant acceptance rate
order fulfilment rate
support contact rate
```

---

# 22. Implementation roadmap

## Phase 1 — public foundation

- refine brand/logo and design tokens;
- create responsive homepage;
- create Explore/search;
- create public vendor pages;
- connect live menu read models;
- add WhatsApp deep links;
- add SEO metadata and public HTML;
- add sitemap/robots/canonical configuration;
- implement `/manus-routes.json` for the actual route set.

## Phase 2 — website ordering

- anonymous basket;
- phone verification;
- shared server-side cart;
- website checkout;
- order confirmation;
- tracking page;
- WhatsApp continuation;
- support entry from active order.

## Phase 3 — merchant portal

- merchant auth and roles;
- order queue;
- menu editor;
- AI menu-import review;
- hours and availability;
- WhatsApp management;
- claim and verification status;
- campaign center.

## Phase 4 — driver and operations

- driver onboarding;
- availability and zone logic;
- dispatch queue;
- delivery proof;
- cash ledger;
- operations command center;
- exceptions and support inbox.

## Phase 5 — discoverability and growth

- area pages;
- category pages;
- help center;
- voice ordering education;
- local SEO;
- AIO/GEO answer pages;
- referral and loyalty after fulfilment is stable.

---

# 23. Launch criteria

Alo King should not announce a broad public launch until:

```text
public pages load quickly on mobile
vendor pages show accurate current data
website and WhatsApp share the same basket/order state
checkout re-prices and re-checks availability
merchant receives and acknowledges orders reliably
driver can complete and prove delivery
operations can see every exception
private dashboards are not indexable
SEO metadata and 404 behavior are correct
Arabic RTL is usable
support can handle failed orders and refunds
analytics do not leak private data
```

## First pilot

Launch with:

```text
one connected geographic cluster
verified merchants
trained drivers
limited operating hours
clear delivery zones
manual operations coverage
measured support response
```

Do not launch nationwide just because the public directory contains nationwide listings.

---

# Final recommendation

The Alo King website should not be a brochure attached to a WhatsApp bot. It should be the public, visual, discoverable front door to the same system:

```text
website discovery
+ visual menu browsing
+ WhatsApp text and voice ordering
+ merchant fulfilment
+ driver dispatch
+ operations control
+ one shared database
```

The strongest user experience is not “choose website or WhatsApp.” It is:

> **Start wherever you prefer, continue wherever it is easiest, and never lose your basket or order context.**

The strongest brand message is:

> **Tell Alo King what you’re craving.**

The strongest operational rule is:

> **Every public promise must be backed by a current database state, an accountable owner, and a visible fallback.**
