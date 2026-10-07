# Alo King — Product, Repository, and Global Benchmark Audit

**Prepared:** 6 October 2026  
**Repository reviewed:** uploaded `shouf-eats-main` archive  
**Positioning used:** **Alo King**, Lebanon; WhatsApp-native ordering plus website; no native mobile app at launch.

> **Bottom line:** Alo King should not try to become another generic delivery marketplace. Its strongest wedge is a **trusted, no-download ordering and operations layer for Lebanese merchants**, where WhatsApp is the customer interface and the website is the discovery/merchant/tracking layer. The product foundation is unusually thoughtful for an MVP, but the next work must prioritize **order correctness, payment/refund trust, delivery proof, merchant availability controls, and operational measurement** over additional AI features.

---

## 1. Scope and method

I reviewed:

- Frontend routes and components for customer, merchant, driver, admin, tracking, and onboarding flows.
- Supabase migrations, RLS policies, database functions, edge functions, webhook/WhatsApp handling, and CI workflows.
- Product documents covering customer friction, merchant operations, WhatsApp architecture, legal/payment considerations, and unit economics.
- Global comparable patterns from Domino’s, KFC, ChatFood, Deliverect, Slerp, Wow! Momo/Gupshup, GoKwik, and other conversational-commerce examples.

The benchmark is **mechanism-focused**, not a claim that these companies are direct like-for-like competitors. Many public case-study results are self-reported; they should be treated as directional evidence, not forecasts.

---

## 2. Executive assessment

### What Alo King already does well

1. **Correct strategic channel choice.** WhatsApp fits Lebanon better than forcing customers to install an app. A web directory and shareable merchant pages support discovery without adding app friction.
2. **Good conversational ordering architecture.** The bot has menu search, basket state, item substitutions, address/landmark capture, dual currency display, COD handling, order confirmation, lifecycle notifications, ratings, handoff, voice transcription, and owner commands.
3. **Strong operational foundations.** The repo contains a kitchen terminal, realtime order updates, driver dispatch, Waze/Google Maps links, GPS tracking, cash-on-hand limits, a watchdog, escalation bookkeeping, and role-based staff access.
4. **Lebanon-specific thinking.** USD/LBP display, landmark-based delivery, village normalization, COD, poor-address realities, local-language support, and a Shouf-specific unit-economics model are better than importing a city-delivery template.
5. **Good safety instincts in the bot.** The code includes secret-leak tests, model/cost caps, demo mode, service-role separation, explicit tool scopes, and a human handoff path.
6. **Merchant ownership and catalog strategy.** Public pages, claim flow, profiles, menu metadata, photo storage, completeness scoring, and merchant AI are the right direction for building a proprietary local supply graph.

### What is still missing or too risky

1. **No real payment/refund system yet.** The primary order path in `kapso-brain` is COD with a fixed `$2` delivery fee; `payment_method` supports `card`/`whish`, but the inspected customer flow does not actually implement a payment authorization, webhook, refund, or reconciliation lifecycle.
2. **Tracking privacy is not strong enough.** `track_order(uuid)` is publicly executable and returns order items, totals, delivery village, gift details, customer coordinates, and live driver coordinates to anyone with the UUID. UUIDs are hard to guess, but this is still bearer access and a leaked link exposes more data than necessary.
3. **Delivery proof is incomplete.** Driver delivery is a single button/confirmation. There is no OTP, signature, photo, recipient name, geofence check, failed-delivery reason, cash receipt, or customer dispute workflow.
4. **Order-state integrity is incomplete.** The DB trigger limits some staff transitions but does not fully enforce a canonical state machine, actor ownership, valid transition paths, cancellation reasons, timestamps for all terminal outcomes, or idempotency across webhook/order creation retries.
5. **Merchant availability is not fully connected to ordering.** The product has `is_live`, `accepts_orders`, pause windows, hours, menu availability, and vendor-open functions, but the launch-critical behavior must be proven end-to-end: no stale page, stale menu, or closed merchant should receive a confirmed order.
6. **Dispatch is first-come, first-served rather than an allocation system.** It is acceptable for a pilot, but does not yet account for driver zones, distance, route batching, promised ETA, capacity, pickup readiness, driver reliability, or merchant self-delivery versus platform delivery as a first-class capability.
7. **Customer identity/retention is minimal.** Phone-based memory exists, but there is no complete customer account/order history, favorites, reorder, saved payment, consent center, referral attribution, loyalty ledger, or robust win-back/abandoned-cart system.
8. **The website is directory-first, not conversion-first.** The merchant page opens WhatsApp with a generic greeting rather than a structured basket/cart handoff. Menu pages should make adding items, modifiers, address, delivery eligibility, and order context much easier even if final completion remains in WhatsApp.
9. **Test/release reproducibility needs work.** The repo includes `bun.lock`, but no `package-lock.json` or `pnpm-lock.yaml`; CI does not show a dependency install/test/build gate before deployment. The initial npm/pnpm checks could not be used as a clean baseline in this sandbox, so the code must be validated in the project’s intended Bun environment.
10. **Secret hygiene needs immediate attention.** A root `.env` exists in the archive and `.gitignore` does not ignore `.env`. Even if values are placeholders, this is a release-process risk. Only publishable Supabase client configuration belongs in the browser; Anthropic, OpenAI, Kapso, webhook, watchdog, and service-role secrets must remain server-side.

---

## 3. Product maturity scorecard

| Area | Current assessment | Launch judgment |
|---|---:|---|
| WhatsApp ordering core | **7/10** | Strong MVP; needs idempotency and payment/exception hardening |
| Customer web discovery | **6/10** | Good SEO/shareable merchant pages; weak cart/conversion handoff |
| Merchant operations | **7/10** | Useful kitchen terminal; needs stock, pause, SLA, refund, and reconciliation controls |
| Driver operations | **5/10** | Works for a small pilot; lacks proof, dispatch intelligence, and settlement workflow |
| Tracking/trust | **5/10** | Good status/timeline concept; privacy and ETA claims need hardening |
| Payments/refunds | **2/10** | COD foundation only; card/Whish path is not production-complete |
| Retention/CRM | **3/10** | Ratings and promo scaffolding; missing mature opt-in, loyalty, reorder, attribution |
| Security/data governance | **5/10** | RLS and service-role separation are thoughtful; public tracking and secret hygiene need fixes |
| Observability/analytics | **4/10** | AI spend/latency instrumentation exists; business funnel/SLA/financial observability is thin |
| Release engineering | **4/10** | Deploy workflows exist; no obvious dependency/test/build gate and no package-manager lock consistency |

**Overall:** approximately **5.5–6/10 as a pilot**, and **3.5–4/10 as a scaled multi-merchant delivery platform** until the P0 items below are closed.

---

## 4. What global comparables have that Alo King should adopt

### 4.1 Structured commerce, not only an AI chat

**Observed across Domino’s, KFC, ChatFood, Deliverect, Slerp, and Wow! Momo:** successful WhatsApp commerce is not just a clever bot. It combines a structured product catalog/order state with natural-language assistance.

Alo King already has much of the right backend shape. The missing product decision is to make the structured layer visible and reliable:

- vendor/menu/item/modifier IDs are the source of truth;
- the customer can see a basket and exact price before confirmation;
- the server validates availability, delivery zone, minimum order, fee, and payment method;
- WhatsApp messages are generated from the order state, not used as the order state;
- every order gets a durable human-readable code and a secure tracking/recovery path.

**Add:** a `checkout_session`/basket state with explicit `draft → priced → awaiting_customer_confirmation → submitted → accepted` states, rather than allowing conversational history to carry business meaning.

### 4.2 Reliable merchant order operations

**ChatFood and Deliverect patterns:** accept/reject, prep-time ETA, inventory/availability, order status, roles, menu sync, and exception handling are the heart of the product.

Alo King has accept/reject/prep/ready and realtime kitchen cards. Add:

- one-tap **pause orders** with reason and expiry;
- item-level sold-out and substitute rules;
- merchant SLA dashboard: time-to-acknowledge, rejection rate, prep variance, missing-item rate;
- a clear **merchant delivery vs Alo King driver** setting per order/vendor;
- order modification/cancellation policy with who pays and what happens to the customer;
- reliable printer/export/receipt option for kitchens with weak connectivity;
- a retry-safe order notification outbox.

### 4.3 Payments, refunds, and reconciliation

**ChatFood, Slerp, Deliverect, and GoKwik patterns:** payment choices, payment status, refunds, and order status must be explicit. Payment should not be a text field that the bot remembers.

For Lebanon, support in stages:

1. **COD USD and COD LBP**, with the exchange-rate timestamp displayed and a server-side rate table rather than a hard-coded constant.
2. **Payment link/card**, only after gateway capability, webhook signatures, settlement, partial/full refund, and failed-payment recovery are implemented.
3. **Whish or other local rail**, only after confirming the actual merchant/API settlement workflow; do not advertise a method that is not operational.
4. Every order should have `payment_intent_id`, `authorized_at`, `captured_at`, `failed_at`, `refunded_at`, `refund_amount`, and reconciliation status.

### 4.4 Trust and delivery proof

**Slerp and mainstream delivery systems:** customer trust depends on predictable status, ETA, contact/support, and recovery when something goes wrong.

Add:

- a narrow tracking payload: status, merchant, order code, fee/total, broad delivery area, ETA band;
- access token or signed expiring tracking token instead of raw UUID bearer access;
- customer confirmation OTP at delivery, with fallback for elderly/low-connectivity customers;
- driver proof: recipient name/OTP, cash collected, failed-delivery reason, optional photo/signature where appropriate;
- driver cash settlement/hand-off records;
- dispute/refund ticket linked to the order;
- no raw customer latitude/longitude in a public function unless it is genuinely needed and protected.

### 4.5 Retention without spamming

**Domino’s:** reorder/easy order/tracking.  
**ChatFood:** loyalty, reviews, direct conversion, QR/social acquisition.  
**GoKwik:** cart recovery and conversion recovery.  
**WhatsApp policy:** explicit marketing opt-in, opt-out, quality monitoring, and template discipline.

Alo King should add a **consented CRM layer**, not simply send more messages:

- first-party consent record: purpose, timestamp, source, language, version, opt-out;
- `reorder last order` and `repeat favorite` in WhatsApp;
- referral/QR/merchant attribution on every first conversation/order;
- segmented win-back only for customers with consent;
- abandoned basket reminder with frequency cap and stop control;
- a lightweight **Alo Crowns** ledger with clear earn/redeem rules, expiry, fraud controls, and merchant/platform funding;
- post-delivery rating plus reason tags, not only a star number.

### 4.6 No native app is acceptable

Slerp demonstrates the viability of web ordering with no-download checkout. Alo King should **not** build a native mobile app before product-market fit. Instead, make the website excellent as a PWA/mobile web surface:

- add-to-home-screen for drivers/merchants;
- offline/reconnect states;
- push notifications where supported;
- shareable vendor/menu URLs;
- WhatsApp deep links with vendor/menu/cart context;
- fast loading on Lebanese mobile networks.

---

## 5. Repo-specific findings by surface

### Customer website

**Implemented:** bilingual UI, explore/search/filter, shareable vendor slugs, SEO metadata, vendor pages, menu tabs, directions/call/share, WhatsApp CTA, gift flow scaffolding, live tracking page, map, receipt, status timeline.

**Improve next:**

- Replace generic `Hi Alo King, I'd like to order from {name}` with a contextual deep link containing merchant ID, source, and optional basket ID.
- Add menu item modifiers and basket capture on the website, even if WhatsApp completes the conversation.
- Show serviceability and fee before the customer leaves the page.
- Add merchant-level trust signals: last verified, menu freshness, average prep time, delivery coverage, last order success, not only “claimed.”
- Separate “compiled from public sources” discovery pages from “orderable/live” pages more visibly.
- Add an explicit “report incorrect menu/price” flow.

### WhatsApp brain

**Implemented:** tool-driven menu search, conversational basket, order creation, substitutions, address memory, voice transcription via OpenAI, Anthropic model calls, owner commands, handoff, lifecycle messages, rating parsing, demo/staging controls, AI budgets.

**Improve next:**

- Make all writes idempotent using WhatsApp message ID, cart version, and order creation idempotency key.
- Introduce a deterministic order state machine and refuse any stale conversational action against a changed basket/menu.
- Stop using a fixed global delivery fee where delivery is geographically variable; calculate/quote by village/zone and store the quote source/time.
- Implement a policy for “price changed,” “item unavailable,” “merchant closed,” “no driver,” “customer unreachable,” and “payment failed.”
- Add a durable outbox for outbound messages with retry policy, provider message ID, error code, template category, and delivery/read status.
- Add conversation retention/deletion behavior across conversations, AI logs, customer addresses, pending voice, orders, and support records.
- Ensure AI can never finalize totals or payment status except through server tools.

### Merchant terminal

**Implemented:** realtime kitchen view, new-order chime, acknowledge, accept with prep time, reject reason, ready, self-delivery demo path, daily revenue count, role protection, onboarding, menu/profile/private data surfaces.

**Improve next:**

- Add pause/close ordering with an expiry and reason.
- Add inventory availability and substitution policy directly to the kitchen flow.
- Make “reject” require a customer-facing reason category and recovery action.
- Add order printer/receipt view and a “call customer” action.
- Add end-of-day reconciliation: completed orders, COD collected, refunds, driver handoff, merchant payout.
- Add offline/reconnect queue and an unmistakable “not receiving orders” health state.
- Replace browser-only sound dependence with WhatsApp/SMS/phone escalation for unacknowledged urgent orders where feasible.

### Driver surface

**Implemented:** staff gate, ready-order offers, claim race protection, route links, GPS updates, cash gauge, COD cap, delivery confirmation, service worker registration.

**Improve next:**

- Allocate jobs by zone/distance/readiness rather than exposing one global first-available offer.
- Add proof of delivery and failed-delivery handling.
- Add cash collection receipt and settlement workflow.
- Add customer call/WhatsApp action, pickup checklist, and notes.
- Do not update driver GPS by allowing a broad client update path without verifying that the current user owns the order and is in an allowed status. Enforce this in a dedicated RPC or tighter RLS/function.
- Make driver availability, shift, vehicle type, active zone, and cash limit explicit.

### Tracking

**Implemented:** polling timeline, map, vendor/destination/driver map points, approximate ETA based on distance, receipt, gift display, bilingual toggle.

**Improve next:**

- Use a signed, expiring tracking token tied to the order and recipient/session.
- Return the least data possible. Do not expose full item, gift, customer coordinates, or live driver coordinates to a public unauthenticated UUID endpoint by default.
- Display ETA as a range with “last updated” and confidence; the current straight-line speed estimate can be misleading on mountain roads.
- Add contact/support, cancellation/refund state, and “what to do if late” actions.
- Treat delivered/rejected/cancelled tracking data with a retention policy.

### Admin and platform operations

**Implemented:** staff roles, merchant claim queue, approval RPC, deploy workflow, watchdog, send-incident backoff, AI usage budget, self-tests.

**Improve next:**

- Build a real ops console: live orders, stuck orders, no-driver orders, message failures, SLA breaches, merchant outages, refunds, disputes, and provider health.
- Add audit log for admin actions and sensitive staff changes.
- Add observability dashboards for funnel and unit economics, not only AI spend.
- Add alerting on webhook silence, Supabase function errors, provider 4xx/5xx, message quality, and order notification lag.
- Add staging smoke tests that run on every PR and deploy only after passing.

---

## 6. Highest-priority launch plan

### P0 — before real public orders

1. **Canonical order state machine**
   - Define every allowed transition and actor.
   - Add server-side transition function/RPC.
   - Enforce idempotency and terminal-state immutability.
   - Add cancellation/rejection/failed-delivery reason and timestamps.

2. **Secure tracking**
   - Replace public UUID-only access with signed expiring tokens.
   - Minimize returned fields and protect coordinates.
   - Add rate limits and auditability.

3. **Availability and quote correctness**
   - Server-check merchant live/open/paused status at cart price and at order submission.
   - Store delivery fee/rate/zone calculation and timestamp on the order.
   - Block stale menus and stale baskets.

4. **COD reconciliation and proof**
   - Add cash collected amount, currency, receipt/reference, delivery OTP/fallback, failed-delivery reason, and driver settlement.
   - Make the `$150` cap configurable and enforce it with race-safe server logic.

5. **Notification outbox**
   - One durable outbound-message table for WhatsApp sends, retry, provider ID, error code, status, and dedupe key.
   - Alert when an order status changes but the customer notification fails.

6. **Security/release hygiene**
   - Remove `.env` from version control if tracked; add `.env*` ignore rules with an explicit safe example file.
   - Rotate any credential that may have entered Git history.
   - Choose Bun as the canonical package manager and commit/use the matching lockfile in CI.
   - Add PR gates: install, typecheck, unit tests, edge-function tests, lint, build, migration check.

### P1 — first pilot, first 30–60 days

1. Merchant pause/stock/substitution controls.
2. Driver zones and dispatch queue with manual override.
3. Payment-link integration only after a real sandbox/settlement test.
4. Customer reorder/favorites and support/dispute flow.
5. Consent-managed CRM, opt-out, abandoned-cart and referral attribution.
6. Merchant SLA and order-funnel dashboard.
7. PWA/offline behavior for kitchen and driver surfaces.
8. Pricing and delivery zones based on actual route cost, not one fixed fee.

### P2 — after repeatable volume

1. WhatsApp Flows for address/review/payment selection where they materially reduce errors.
2. Multi-stop batching and route optimization.
3. Loyalty/credits with a proper ledger.
4. Merchant subscriptions or paid premium tooling.
5. Aggregated analytics and demand forecasting.
6. Native app only if observed retention/use cases justify it; do not build it because competitors have one.

---

## 7. Recommended metrics and launch gates

### Customer funnel

- WhatsApp inbound → menu search → basket started → confirmation → order submitted.
- Website vendor page → WhatsApp click-through.
- Order completion rate, cancellation rate, abandoned basket rate.
- First-to-second order conversion at 7/30 days.
- Arabic, English, and Arabizi resolution rate.
- Human handoff rate and median time to human reply.

### Merchant SLA

- Time to acknowledge.
- Acceptance/rejection rate and reasons.
- Prep-time accuracy: promised versus ready.
- Item unavailable/substitution rate.
- Merchant-open accuracy and stale-menu incidents.
- Orders received while merchant is paused/closed: target **zero**.

### Delivery

- Ready-to-pickup → pickup time.
- Pickup → delivered time by village/zone.
- Delivery success rate and failed-delivery reasons.
- Proof-of-delivery completion.
- Cash variance and time-to-settlement.
- Driver utilization and drops per route.
- Customer support contacts per 100 orders.

### Trust and messaging

- Notification send success and delivery/read rates.
- WhatsApp provider error-code distribution.
- Opt-out/block/report rate.
- Tracking-link access failures and suspicious access.
- Refund/dispute resolution time.

### Unit economics

- AOV and contribution margin by merchant/zone/payment method.
- Delivery fee recovery versus actual route cost.
- AI cost per conversation and per completed order.
- WhatsApp message cost per completed order.
- Driver cost per completed drop.
- COD loss/variance.
- Merchant payout and platform take rate.

**Pilot gate suggestion:** do not scale acquisition until you have at least two weeks of stable operation with order notification success >99%, no unresolved money/total mismatches, <5% merchant rejection excluding customer errors, tracked delivery success >95%, and a documented cash settlement process.

---

## 8. Architecture recommendation

Keep the current stack: **React/TanStack + Supabase + Anthropic/OpenAI + WhatsApp provider**. Do not rewrite it. Add the missing boundaries:

```text
WhatsApp / Website
        |
        v
Conversation + Checkout Session  ----->  Customer/Consent/Address
        |
        v
Order Command API / RPC
        |
        +---- immutable order + order_events
        +---- payment_intents / refunds
        +---- dispatch_assignments / delivery_proof
        +---- notification_outbox
        +---- audit_log
        |
        +---- Merchant terminal
        +---- Driver PWA
        +---- Tracking token endpoint
        +---- Ops console / analytics
```

**Core rule:** AI may interpret intent and recommend actions, but only deterministic server commands may change carts, totals, payment state, order status, driver ownership, or refunds.

---

## 9. Questions that materially affect the next implementation plan

I can proceed with sensible defaults, but these answers would change the roadmap:

1. Is Alo King **platform-owned delivery**, merchant self-delivery, or a hybrid per merchant/zone?
2. Which payment rails are actually available to you today: COD only, Whish, a Lebanese gateway, payment links, or another provider?
3. Will merchants use their existing WhatsApp Business numbers, one shared Alo King number, or a coexistence/embedded-signup setup?
4. Is the fixed `$2` delivery fee intentional for the pilot, or should it vary by village/zone?
5. Is the first launch food only, or food plus grocery/retail from day one?
6. What is the intended legal operating entity and who owns customer data, merchant data, and delivery liability?
7. What volume do you expect for the first pilot: merchants, orders/day, drivers, and villages?

---

## 10. Sources and benchmark notes

### Benchmark sources

- [WhatsApp Business — Domino’s Pizza Indonesia case study](https://whatsappbusiness.com/resources/success-stories/dominos-pizza-indonesia/)
- [Domino’s — Messenger ordering announcement](https://ir.dominos.com/news-releases/news-release-details/dominosr-launches-messenger-ordering-us)
- [KFC South Africa — WhatsApp ordering launch](https://global.kfc.com/press-releases/kfc-south-africa-first-qsr-to-launch-whatsapp-ordering-in-sa)
- [ChatFood — live orders](https://docs.chatfood.io/en/articles/3368488-managing-your-live-orders)
- [ChatFood — payment methods](https://docs.chatfood.io/en/articles/4374132-payment-methods)
- [ChatFood — loyalty](https://docs.chatfood.io/en/articles/5622089-how-to-use-the-loyalty-program)
- [Deliverect — WhatsApp integration](https://www.deliverect.com/en-us/integrations/whatsapp)
- [Deliverect — order statuses](https://help.deliverect.com/en/articles/7979014-order-statuses)
- [Slerp — web ordering](https://www.slerp.com/web-ordering-system/)
- [Slerp — delivery](https://www.slerp.com/delivery/)
- [Slerp — CRM](https://www.slerp.com/crm/)
- [Slerp — loyalty](https://www.slerp.com/loyalty/)
- [Wow! Momo / Gupshup case study](https://www.gupshup.io/resources/case-studies/wowmomo)
- [Wow! Momo WhatsApp ordering coverage](http://www.fnbnews.com/Top-News/wow-momo-introduces-endtoend-food-ordering-on-whatsapp-71608)
- [GoKwik — abandoned-cart recovery case](https://www.gokwik.co/case-studies/true-elements-increases-abandoned-cart-recovery-by-134-with-kwikengage)
- [WhatsApp Catalogs overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/catalogs-overview/)
- [WhatsApp Payments in / payment gateway documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/payments/payments-in/pg/)
- [WhatsApp Business Platform pricing](https://business.whatsapp.com/products/platform-pricing)
- [WhatsApp messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)
- [WhatsApp throughput](https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput)
- [WhatsApp Flows](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows)
- [WhatsApp template review](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review)
- [WhatsApp marketing opt-in/service messaging documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages)

### Repo evidence reviewed

- `supabase/functions/kapso-brain/index.ts` and supporting modules/tests.
- `supabase/migrations/20261005054156_alo_king_core_hardening_and_lifecycle.sql`.
- `supabase/migrations/20261005062418_alo_king_merchant_platform_schema.sql`.
- `supabase/migrations/20261005144613_customer_addresses_pending_voice.sql`.
- `supabase/migrations/20261005145928_order_lifecycle_notifications.sql`.
- `supabase/migrations/20261006110000_send_incidents.sql`.
- `src/routes/m.$slug.tsx`, `src/routes/merchant.orders.tsx`, `src/routes/driver.tsx`, `src/routes/track.$orderId.tsx`, `src/routes/admin.tsx`.
- `.github/workflows/deploy-functions.yml` and `.github/workflows/order-watchdog.yml`.
- `docs/flows-plan.md`, `docs/customer-side.md`, `docs/friction-review.md`, `docs/human-inbox-plan.md`, `docs/send-failures.md`, and the research/blueprint documents.

---

## Final recommendation

Launch **Alo King as a tightly controlled Shouf pilot**, not as a broad Lebanon marketplace. Keep the no-app, WhatsApp-native position. Recruit a small set of merchants with reliable menus and one delivery operating model. Before spending on acquisition, close the P0 list—especially **secure tracking, canonical order state, COD proof/reconciliation, quote/availability correctness, notification outbox, and release/security hygiene**. Once those are stable, add structured checkout/Flows, retention, dispatch optimization, and payment rails in that order.

The product does not need more surface area right now. It needs to become **boringly reliable when a real customer sends money, a kitchen is busy, a driver is late, an item is sold out, or WhatsApp fails**.


## 11. Technical validation result

The repository was installed with its intended dependency graph and the Vitest suite was executed. Result:

- **45 test files passed; 1 test file failed.**
- **1,254 tests passed; 1,255 total.**
- Failure: `supabase/functions/kapso-brain/numbered.test.ts` — the expected numbered menu order was `Cheese Kunafa, Chicken Shawarma`, while the implementation returned `Chicken Shawarma, Cheese Kunafa`.
- Because the command uses `test && lint && build`, lint/build were not reached after the test failure; run them separately after correcting or intentionally updating that ordering contract.
- The repo contains `bun.lock` but no npm/pnpm lockfile. Standardize CI and local development on Bun (or regenerate and commit the lockfile for the chosen package manager).
- This is not a broad test failure: the suite is largely healthy, but the failing test is directly customer-facing because menu ordering affects numbered WhatsApp choices and can cause the customer to select the wrong item.

**Immediate fix:** make menu ranking/order deterministic and encode the intended rule—e.g. explicit merchant `sort_order`, then section/category priority, then stable item name/ID—or update the test only if the new order is intentional and documented.
