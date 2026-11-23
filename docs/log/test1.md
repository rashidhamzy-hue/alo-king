# TEST1: a working friends' test on staging, with the WhatsApp catalogue (23 November 2026)

Session TEST1. The founder's decision of 23 November: not launching yet (no stock, van, warehouse or label day); the founder's friends test
Alo King end to end on WhatsApp and the website, now. Decisions: `docs/DECISIONS.md`, "TEST1, a working friends' test on staging, 23 November
2026". Migrations **0271** (test mode), **0272** (the catalogue's product link, staging only), **0273** (the catalogue id and the gate's probe
exemption, after the stage stop, staging only), **0274** (Safa Chicken's other names, staging only), **0275** (the staging probe answers
only its own parties). Pull requests [#159](https://github.com/rashidhamzy-hue/alo-king/pull/159), [#160](https://github.com/rashidhamzy-hue/alo-king/pull/160),
[#161](https://github.com/rashidhamzy-hue/alo-king/pull/161), #162, #163, #164, each merged with CI green. No new agent (invariant 21); no
write by a model; Kabsi not touched.

## Built
1. **Test mode** (`settings.test_mode`, 0271). On for staging, impossible in production: a trigger refuses it on unless the database holds
   the staging mark (`deployment_marker`, written only by `scripts/staging/prepare-staging.sql`), and the gateway honours it only when its
   `ENVIRONMENT` is `staging`. The first deploy that marks staging switches it on; after that the Settings page decides ("Friends' test mode").
2. **The gate.** A number not on the tester list (console, People, Places, Testers) gets one short "we're not open yet" in its language
   (Arabic, English or French), before any model, every turn, voice notes included; no price, no menu. STOP and START still win. The probe
   keeps its own path.
3. **What testers order.** Any hour; every active item with a hub price (no stock, no label rule, no price-basis question); dishes of
   approved, testers-visible places (Safa Chicken once the founder approves it; the test kitchen now) at any hour; the minimum order holds;
   any pin (outside the area: the nearest served village's fee). The planner, the cart and the confirm tap's re-check all price for the
   tester (they priced for nobody before).
4. **Test orders** (`orders.is_test`). No stock moves, no rider is offered one, no picker sees one, no payment or ledger row; confirmed only
   by the customer's own tap; after it the order walks by itself, one step every 60 to 120 seconds, with the real customer messages: being
   prepared (food: "<place> took the order", the call ahead simulated and accepted with the place's preparation time), on the way, at the
   door, delivered, then the feedback question. A test order ends at delivered and never closes.
5. **The test line**: «🧪 طلب تجريبي: ما في توصيل ولا دفع» / "🧪 Test order: no delivery, no payment" on the card and on every status
   message of a test order, in the customer's language, added in one place around the gateway's send.
6. **Console**: «🧪 Test: no delivery, no payment» on test orders (list and page); **Clear test orders** (Orders page, ops lead or admin, a
   reason): open test orders cancelled without a customer notice, all of them off the list, logged in `test_mode_log`.
7. **The catalogue**: 0272 sets `catalog.product_link` to the customer line's wa.me link; deploy-staging proves `GET /catalog/feed.csv` after
   every deploy; the `catalog-setup` workflow does Meta's side through Kapso where the access allows (inspect, enable_cart, sets); in test
   mode every listed item is in stock.

8. **After the stage stop**: the catalogue `1178584524839853` the founder made and connected (0273, staging); the gate lets through only the
   probe that has no phone number (0273), so scripted customers meet it as anyone else; Safa Chicken's other names («صفا», «صفا تشيكن», …,
   0274); the WhatsApp catalogue's words in the customer's language (the session's sim-test found a French customer getting the Arabic line
   once the catalogue was connected).
9. **The journeys on staging, by scripted customers** (`test1-journeys` workflow, `scripts/qa/test1-journeys.mjs`): probe parties with
   invented numbers (+961 70 000 9S0 to 9S5), so nothing reaches a phone; their messages enter as Kapso's webhook does (stored inbound
   events the Worker's minute cron delivers), their replies are read from the outbox, the website journey runs in a headless browser.
10. **Who owns the WhatsApp account**: the founder's own business portfolio (Kapso's Instant setup is Meta's embedded signup); Kapso's Meta
    proxy reaches neither catalogues nor commerce settings, so the catalogue, its connection and the cart switch were the founder's clicks
    (DECISIONS rows 15, 16).

## Tested (free)
- `test/db/test1-test-mode.test.ts` (14): the lock (off, refused without the mark, on with it); the gate (tester, stranger, probe); a
  tester's quote at a closed hour with no stock against a stranger's; the minimum; dishes; a far pin; a catalogue cart; the feed; a test
  order confirmed only by the tap (agent and system refused), nothing reserved, no rider or picker; the walk step by step to the feedback
  question, the same step back until its message is sent, never closing, no payment, ledger, stock or delivery row; a food test order's
  simulated call; a stranger's order untouched by the walk; clearing (staff only, a reason, test orders only, no notice, logged).
- `test/db/test1-flow.test.ts` (7), through the real turn code and gateway with the shop closed and the hub empty: a stranger refused in
  Arabic and English, a voice note answered, STOP; outside staging the gate is not asked; a tester's typed order (card with the test line,
  the tap, five walked messages each with the line, no stock or ledger row); a catalogue cart; a food order with required choices.
- `apps/console/test/test1-orders.test.ts` (2): the mark, clearing, the log, a picker refused.
- The message rules and snapshots (`messages.{ar,en,fr}.md`) with the two new messages; 🧪 allowed for the test line only.

## Proven on staging
**The journeys** (`test1-journeys`, scripted customers, staging deployed from main):
- Run 45148927202 (set 8, main at #163), every check but food passed:
  - **Stranger**: «لسّا ما فتحنا: عم نجرّب الخدمة مع مجموعة صغيرة», no price, no model turn.
  - **Typed order** (AK-1111): "which one?" for the bread, then the card with the test line. It waited for the tap; the tap confirmed.
    - «وين صار طلبي؟» was answered with «طلبك AK-1111: عم نحضّرو / بيوصل خلال حوالي 19 دقيقة».
    - The walk went preparing → on the way → at the door → delivered → feedback, one step about every 2 minutes, five messages each
      with the test line.
    - The feedback tap was answered («تمام، شكراً إلك!»).
    - It ended delivered, with 0 stock, payment, ledger and delivery-stop rows.
  - **Voice note** (AK-1110): the card, then the tap.
  - **Catalogue cart** (AK-1109, catalogue 1178584524839853): the cart became the card with no model turn. Nothing was confirmed before
    the tap; the tap confirmed it.
  - **Website** (AK-1108): basket and checkout on the website, sign-in by the code sent from WhatsApp («ALO-…»), the card on WhatsApp
    (channel web), the tap there.
  - **Food**: Safa found by «صفا» and the size asked by buttons. The one shawarma ($4.50) was then rightly turned down as under the $5
    minimum, so the script now orders two (#164). FOOD_RERUN
- Earlier runs on the same build: AK-1098 and AK-1099 each walked to the feedback question; the stranger, the cart, the voice note and
  the website order were proven again.

**The feed**: deploy-staging proves `GET /catalog/feed.csv` on every deploy (219 items, 215 in stock; the 4 others have no price).

**Free tests**: `npm run typecheck && npm test` green on every PR (#159 to #164); the personal-data guard and gitleaks passed every
commit.

**The language gate** (run 45133503756): 0 wrong, precision 1.0, F1 0.91 (Lebanese Arabic 0.919, Arabizi 0.881, English 0.966, French
0.94, mixed 0.93). Cost USD 0.20.

**The sim-test** (run 45133515061, limit 50, budget USD 1.85):
- 70 conversations, 24 of the 50 first runs passed, 28 seeds passed at least once. Cost USD 1.71 (it stopped at the soft limit).
- November sim spend is now about USD 54.8 of the 55 cap, so no further sim-test runs before 1 December.
- Its one hard failure, sim-020 (a French customer given the Arabic catalogue line), is fixed (#161) and is now a case in `evals/`.

**Only a live phone can prove**:
- Meta's own catalogue and cart screens on a real phone.
- A real voice note's audio (the script gives Kapso's transcript).
- That a friend's real number reaches the bot once it is on the tester list.

Nothing is delivered or paid in test mode, by design.

**Left on staging**: test orders AK-1098 to AK-1111 from these runs; clear them whenever you like (below). The scripted customers have
been taken off the tester list.

## The message to forward to your friends
First add each friend's WhatsApp number to the tester list (below, "Add a friend"); until then they get "we're not open yet".

**بالعربي**

> أهلا! عم جرّب خدمة «ألو كينغ» للطلبات عالواتساب وبدّي رأيك. هيدي تجربة: **ما في توصيل ولا دفع**، وكل طلب بيجي معه سطر «🧪 طلب تجريبي».
> الرقم (واتساب): ‎+1 203 660 2328
> جرّب، بالترتيب اللي بدك ياه:
> 1. اكتب طلب بقالة، مثلاً «بدي كرتونة مي تنورين وربطة خبز».
> 2. ابعت رسالة صوتية فيها طلبك.
> 3. افتح الكتالوج (أيقونة المحل فوق بالمحادثة)، حط أغراض بالسلة وابعتها.
> 4. اطلب أكل من صفا تشيكن، مثلاً «بدي تنين شاورما دجاج وبطاطا من صفا»، واختار من الخيارات (أقل طلب $5).
> 5. بعد ما تكبس «تأكيد الطلب»، اسأل «وين طلبي؟». الطلب بيمشي لحالو خطوة خطوة كل دقيقة أو دقيقتين لحد ما «يوصل».
> 6. لما يوصل، جاوب عالسؤال عن الطلب.
> 7. إذا بدك: اطلب من الموقع https://alo-king-web-staging.rashid-hamzy.workers.dev وأكّد عالواتساب.
> صورة لائحة مشتريات ما منقراها بعد: جرّب وشوف شو بيصير. ولا شي بينوصل ولا بتدفع شي. ابعتلي شو عجبك وشو ما عجبك.

**In English**

> Hi! I'm testing Alo King, ordering on WhatsApp, and I'd love your opinion. It's a test: **nothing is delivered and nothing is charged**; every order carries a "🧪 Test order" line.
> The number (WhatsApp): +1 203 660 2328
> Try, in any order:
> 1. Type a grocery order, e.g. "I want a pack of Tannourine water and a bag of bread".
> 2. Send a voice note with your order.
> 3. Open the catalogue (the shop icon at the top of the chat), add items to the cart and send it.
> 4. Order food from Safa Chicken, e.g. "two chicken shawarma sandwiches and fries from Safa", and pick the options (the minimum order is $5).
> 5. After you tap "Confirm order", ask "where's my order?". The order moves on by itself, a step every minute or two, until it is "delivered".
> 6. When it arrives, answer the question about the order.
> 7. If you like: order on the website https://alo-king-web-staging.rashid-hamzy.workers.dev and confirm on WhatsApp.
> A photo of a shopping list isn't read yet: try it and see what happens. Nothing is delivered or charged. Tell me what you liked and what you didn't.

## Founder actions (TEST1)
1. **Add a friend** (before you forward the message): Console, **People**, **Places**, tab **Testers**: their WhatsApp number in full (+961…, + and the country code), **Add the tester**. Remove them the same way when the test ends.
2. **Clear test orders** whenever you like: Console, **Orders**: the box at the top, "N test order(s) from the friends' test", type why (for example "end of the first round"), **Clear test orders**. It touches test orders only; open ones are cancelled without a message to the friend; all of them leave the list (each still opens by its code). Logged with your name.
3. **Switch test mode off** (only when the test is over): your name, **Settings**, "Friends' test mode (staging only)", off, the reason. Then everyone gets the normal service on staging again.
4. **Optional**: category groups ("sets") in Commerce Manager (RUNBOOK B6). The bot does not need them.
