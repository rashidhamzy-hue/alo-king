# FD2: ordering food from places, end to end (18 November 2026)

Session FD2 (Opus 5.5, high). Prompt: the coordinator's (one shop per order; dishes from approved menus; choices by list or buttons before the
card; the card with «🍗 من: <place>»; staff call ahead; the rider buys at the counter; testers only; unknown is never safe). The choices the build
made are `docs/DECISIONS.md`, "FD2, ordering food from places, 18 November 2026" (17 rows). Migrations **0249 to 0251**. No new agent: the food
path is code (invariant 21); the Concierge still reads the turn and never adds a dish; the customer's own tap confirms (invariant 4).

## Built
1. **The quote knows the customer** (0249). `quote_order(..., p_party)`: a testers-only dish is orderable for a tester only; without a party,
   public places only, as before. The order, the card per turn, the basket of an order and the confirm tap's re-check use the customer's own.
2. **A dish's choices, priced by the database** (0249). A line carries `options` (dish option ids); `dish_choice()` checks them against the
   dish's groups (FD1's sizes, options, add-ons); the price is the dish's plus the options'. A required choice not made: no card
   (`choice_required`). Options are stored on the item and shown on the card in the customer's language.
3. **WhatsApp, the same way as groceries** (`packages/agents/src/food.ts`). The place is found by its name or the names customers use (new
   field on the Places page); the dishes on its approved menu (`food_match`); every required choice asked by code (buttons, or a list over three
   options), each optional one offered once («لا، شكراً» first); options the customer's words named are taken; a typed answer works too. Then the
   grocery path's own steps (minimum, pin, phone, card). The card: «🍗 من: <place>» under the heading, the options after each dish, the service
   fee line when above 0, the estimate (preparation + ride). A dish not on the menu is named and the menu is shown as a list. A customer the
   place is not visible to: «مش متوفّر بعد على ألو كينغ» (the unapproved-restaurant reply), no menu, no price.
4. **One shop per order** (0249, `food.ts`, `pipeline.ts`). `mixed_shops` refuses a two-shop quote; another shop's basket in hand waits apart
   ("a second order") and comes back once the new card went; a new card replaces only the same shop's waiting card, so a grocery card and a food
   card wait as two orders.
5. **Hours and the estimate** (0249). `place_open_now`: closed means not orderable (outside hours, a day off, found closed today), checked
   again at the tap. The estimate is the place's preparation time plus the ride; a time asked for a food order gets it (`food.arrives`, which
   replaces `windows.restaurantNoWindow`).
6. **The food service fee** (0249): `orders.service_fee_usd` in the total, its card line, company income at the door (`revenue_food_service`).
   0 today. Food is cash on delivery.
7. **The call ahead** (0250, console **Food** page, Calls tab). The Confirm tap makes a task: "Call <place> on <phone>" with the order to read
   out (dishes, options, counts, the customer's notes and any allergy they stated). Staff record: **accepted + ready in N minutes** (order to
   preparing; only then a rider is offered it: dispatch answers `waiting_for_place`, and ops hear once on the ops line); **an item missing**
   (the customer gets two buttons: go on without it, or cancel); **closed** (cancelled, the place closed for the day); **a price changed**
   (lower: applied and said; higher: waits for the customer's own tap). The customer hears each step in their language (`food-notices.ts`, one
   builder for the console and the simulated customers); the four notices are essential in the message budget.
8. **The rider buys at the counter** (0250, Food page, Riders' cash tab): float given and returned (at most `food.float_max_usd`, 100);
   **paid to the place** with the receipt's amount and photo (shrunk on the phone to 1600 px, JPEG 0.8, by `/menus.js`; `food-receipts/<order>/`
   in the private bucket); the cash at the door as before; the delivery fee and tip to the rider when the order closes, as before. **End-of-shift
   balance**: float given, paid, returned, held; cash collected, dropped, held; each food order owed against paid; any difference **in red**,
   never deducted.
9. **The website's food API** (0251; no page): `web_food_places`, `web_food_menu`, `web_food_quote`, `web_food_order`, and `webFood()` in
   `@ak/commerce`. Testers-only places only for a signed-in tester; one shop per basket; the card goes to WhatsApp.
10. **The seeded test place**: "Alo King test kitchen" (`scripts/staging/test-place.sql`, run by `prepare-staging.sql`), invented menu and phone,
    made through FD1's own functions, testers only, approved, its listing hidden. Used by the tests and the simulated customers.

## Tested (USD 0 except the two runs below)
- `test/db/fd2-food.test.ts` (15): the seeded place; who sees the menu and who is quoted (tester, stranger, no party); finding a place by alias;
  food_match with options from the words; a required choice holds the card; the price with options; an unknown or one-too-many option refused;
  mixed shops refused; a food card and a grocery card side by side, a second food card replacing only the first; cash only; closed by hours, by a
  day off, found closed today; the estimate; the confirm tap's re-check (options in the price, closed refused); the stored card; the service fee
  in the total and in the ledger (`revenue_food_service`), the ledger balanced.
- `test/db/fd2-calls.test.ts` (9): one call task per confirmed food order, none for groceries; dispatch waits for the place; accepted moves the
  order on and gives the estimate; item missing (keep the rest: the line removed and the total recounted; or cancel); closed; price lower applied,
  higher waiting for the tap, accepted or declined; someone else's tap refused; the float, the counter payment with its receipt (path checked),
  the balance with the 0.50 difference, the ledger balanced; the log append-only.
- `test/db/fd2-food-flow.test.ts` (6, `evals/cases/fd2_food.json`): through the real turn code with a scripted reading: size then bread then
  extras by buttons and lists, the card «🍗 من: …» with `2 × سندويش شاورما دجاج (كبير، صاج) · $13.00`, the tap making the call; options from the
  words; a typed «كبير»; a non-tester; a dish not on the menu then the menu; a grocery card and a food card as two orders. One model call a
  conversation (the reading); everything after it is code.
- `test/db/fd2-web.test.ts` (4): the web API as the `web_channel` role.
- `apps/console/test/fd2-food.test.ts` (5): the Food page in the console rig: the call with the phone and the order read out; accepted, item
  missing (Arabic, two buttons), price up, closed, each told to the customer through the gateway; closed to pickers; the float, the receipt upload,
  the balance in red.
- `packages/agents/test/messages.rules.test.ts`: every new message, in Arabic, English and French, passes the CX2 rules (🍗 added); the
  snapshots `messages.{ar,en,fr}.md` hold them as sent. `test/ci/fd2-arabic.test.ts`: the Food page's Arabic equals `docs/ARABIC_REVIEW.md`.
- `evals/sim`: ten food scenarios (`food-scenarios.json`, apart from the 500), the seeded place in the world, the call ahead played by the driver.
  A dry run with stand-in models passed through the harness.
- `npm run typecheck` and `npm test`: RESULT_TESTS. `npm run check:personal-data`: clean.

## The live runs (one each, at the end)
LIVE_RUNS

## Not proven (only a live account can)
- A real place: none is approved on staging yet (the founder's steps in `docs/log/FD1.md`); the test kitchen stands in. A real phone call to a
  place; a rider's real receipt photo from a phone; the customer's buttons on a real phone (the sandbox number).
- The customer messages outside the 24-hour window: no food template exists (a food order is minutes old, so this should not arise).
- The website's food pages: WEB4b.

## Founder test (FD2)
On staging, after the deploy, with your own phone on the tester list:
1. Console (staging), **Approve**, **Places**, tab **Testers**: your WhatsApp number in full (+961...), **Add the tester**.
2. On WhatsApp (the US test number): «بدي ٢ سندويش شاورما من مطبخ التجربة» (or "2 chicken shawarma from the test kitchen"). Expect buttons
   for the size, then the bread, then a list of extras with «لا، شكراً» first; tap your choices. Then the card with «🍗 من: Alo King test kitchen».
3. Tap **✅ تأكيد الطلب**.
4. Console, **Orders**, **Food** (or `/food`): the call "Call Alo King test kitchen" with the order read out. (Do not phone the number shown: it
   is invented.) Type **20** in "ready in", **Accepted**. Your phone gets «✅ طلبك AK-…» with the estimate.
   To try the other outcomes, place another order and press instead **Ask the customer** (an item missing: you get two buttons), **Record the
   price** with a higher price (you get the new total and two buttons), or **The place is closed: cancel the order**.
5. **Food**, tab **Riders' cash**: choose a test rider, **20**, **Give the float**. Under "The rider paid the place": the order, the rider, the
   amount (try 0.50 more than the food's price), **Photograph the receipt and save** (any photo). The end-of-shift balance shows the order with
   the 0.50 difference in red.
6. The rider delivers as usual (the probe riders do on staging); the money closes as for groceries.

## For WEB4b
- Read `packages/commerce/src/index.ts`, `webFood()`: `places(token)`, `menu(token, place)` (dishes, groups with `required`, `min`, `max`,
  options with `price_delta_usd`, and each dish's facts status), `quote(token, place, lines, at)` and `order(token, {requestKey, at, place,
  lines, notes, lang})`. Lines are `{product_id, qty, options: [ids]}`; the quote's `issues` say what is left: `choice_required` (with the groups
  and options to show), `option_invalid`, `place_closed` (`opens`), `below_minimum`, `closed`, `no_delivery_village`; `quote.shop` names the
  place; `eta_minutes` is the estimate; `service_fee_usd` its own line when above 0.
- The page never confirms: the card goes to WhatsApp (web_card_requests) as WEB2's orders do; cash on delivery only.
- A food basket is one place's: keep it apart from the grocery basket (cart_lines are groceries); the API refuses another shop's line.
- Facts: show "declared by the place" or "not confirmed yet: ask us", never "safe" (invariant 15). No rating, no praise (invariant 14).
- Testers-only places never show to an anonymous visitor or a non-tester; the LV1 listings on the Food page stay listings (never orderable).

## Founder actions (FD2)
In `docs/STATUS.md`, section 1, step 7, and section 3. The test order above; for each real place, its other names (Places page).
