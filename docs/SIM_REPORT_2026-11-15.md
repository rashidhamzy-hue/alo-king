# Simulated customers: failure report, 2026-11-15

Session SIM1. 500 simulated customer conversations with the real Concierge (claude-haiku-5-5), each played by claude-sonnet-5-5 and judged by claude-sonnet-5-5.
Run: https://github.com/rashidhamzy-hue/alo-king/actions/runs/43696512658 with follow-ups 43709327718 and 43711448441, code afc8f81c34 (follow-ups: 11b008d, main d113621 plus SIM1's own files), 2026-11-15T08:53:16.306Z to 2026-11-15T12:25:44.983Z. Database: PGlite with main's migrations and a read-only copy of staging's catalogue and settings.
Voice is tested at transcript level: a voice note is the customer's words turned by code into a noisy transcript in the shape Kapso returns; no audio is made or heard.
Kapso sends were recorded, never sent (4472 recorded). Staging requests: GET 96; refused by the guard: 0.

## Totals

|  | value |
| --- | --- |
| conversations (first attempt) | 500 |
| judged | 500 |
| passed | 83 (16.6% of judged) |
| not judged: budget stop / error / judge gave no verdict | 0 / 0 / 0 |
| repeat attempts (failing seeds) | 100 |
| conversations where a Concierge call failed at the API (429, 5xx: capacity, not the product) | 0 |
| customer turns | 3726 |
| spend, total | $14.98 (the 500-scenario run and its two follow-ups; with the smoke run $15.11) |
| spend: Concierge / customer / judge | $4.59 / $6.49 / $3.89 |
| model calls | 16414 |
| calibration (first 20 of the first run) | $0.0213 a conversation, projected $10.64 for all |
| stopped by | the first run: the API key's own usage limit; the follow-ups: their budget (see Spend) |

A conversation **passes** when code found no hard failure on any turn and the judge found the goal reached with no wrong product, no invented fact, no rating or health word and no dead end.

What the run changed in its own copy (never on staging):

- zones: market_id emptied
- sources: approved_by, landmark_id, market_id, owner_party_id emptied
- delivery_window_plans: created_by emptied
- delivery_calendar: created_by emptied
- delivery_slots: edited_by emptied
- settings: updated_by emptied
- fx_rates: set_by emptied
- product_facts: approved_by, evidence_id, proposed_by, rejected_by emptied
- out-of-stock scenarios: on_hand = 0 for 20 product(s) (0 SKU(s) not in the copy)
- day: clock "day" -> settings.hours.tz = Etc/GMT-3 (database local time 11:53; hours 08:00-23:00)

## Pass rate by scenario

| scenario | run | judged | passed | pass rate |
| --- | --- | --- | --- | --- |
| address / landmark_only | 11 | 11 | 0 | 0.0% |
| address / no_pin | 12 | 12 | 0 | 0.0% |
| address / pin_outside | 12 | 12 | 0 | 0.0% |
| cancel / after_confirm | 15 | 15 | 0 | 0.0% |
| cancel / before_confirm | 15 | 15 | 6 | 40.0% |
| cancel / during_picking | 15 | 15 | 0 | 0.0% |
| edit_after_card / add_item | 9 | 9 | 1 | 11.1% |
| edit_after_card / change_qty | 9 | 9 | 1 | 11.1% |
| edit_after_card / remove_item | 9 | 9 | 0 | 0.0% |
| edit_after_card / swap_item | 8 | 8 | 0 | 0.0% |
| food_facts / allergy | 10 | 10 | 1 | 10.0% |
| food_facts / halal | 10 | 10 | 2 | 20.0% |
| food_facts / ingredients | 10 | 10 | 1 | 10.0% |
| money / change_large_note | 6 | 6 | 0 | 0.0% |
| money / lira | 7 | 7 | 0 | 0.0% |
| money / omt | 6 | 6 | 0 | 0.0% |
| money / whish | 6 | 6 | 0 | 0.0% |
| night / kept_order | 35 | 35 | 7 | 20.0% |
| not_sold / alcohol | 6 | 6 | 5 | 83.3% |
| not_sold / medicine | 6 | 6 | 2 | 33.3% |
| not_sold / other_shop | 6 | 6 | 4 | 66.7% |
| not_sold / restaurant | 6 | 6 | 5 | 83.3% |
| not_sold / tobacco | 6 | 6 | 4 | 66.7% |
| off_topic / abuse | 7 | 7 | 0 | 0.0% |
| off_topic / injection_confirm | 4 | 4 | 0 | 0.0% |
| off_topic / injection_discount | 4 | 4 | 0 | 0.0% |
| off_topic / off_topic | 8 | 8 | 5 | 62.5% |
| off_topic / stop | 7 | 7 | 6 | 85.7% |
| out_of_stock / alone | 20 | 20 | 2 | 10.0% |
| out_of_stock / in_basket | 25 | 25 | 3 | 12.0% |
| person / complaint | 15 | 15 | 0 | 0.0% |
| person / refund | 15 | 15 | 0 | 0.0% |
| person / wants_person | 15 | 15 | 0 | 0.0% |
| plain_order / few_items | 25 | 25 | 12 | 48.0% |
| plain_order / many_items | 12 | 12 | 3 | 25.0% |
| plain_order / one_item | 18 | 18 | 0 | 0.0% |
| same_as_last / same_as_last | 10 | 10 | 6 | 60.0% |
| vague_items / brand_only | 13 | 13 | 1 | 7.7% |
| vague_items / generic_word | 20 | 20 | 1 | 5.0% |
| vague_items / size_missing | 12 | 12 | 0 | 0.0% |
| window / later_today | 8 | 8 | 2 | 25.0% |
| window / named_day | 9 | 9 | 1 | 11.1% |
| window / pick_from_list | 8 | 8 | 1 | 12.5% |
| window / tomorrow_morning | 10 | 10 | 1 | 10.0% |

| category | run | judged | passed | pass rate |
| --- | --- | --- | --- | --- |
| address | 35 | 35 | 0 | 0.0% |
| cancel | 45 | 45 | 6 | 13.3% |
| edit_after_card | 35 | 35 | 2 | 5.7% |
| food_facts | 30 | 30 | 4 | 13.3% |
| money | 25 | 25 | 0 | 0.0% |
| night | 35 | 35 | 7 | 20.0% |
| not_sold | 30 | 30 | 20 | 66.7% |
| off_topic | 30 | 30 | 11 | 36.7% |
| out_of_stock | 45 | 45 | 5 | 11.1% |
| person | 45 | 45 | 0 | 0.0% |
| plain_order | 55 | 55 | 15 | 27.3% |
| same_as_last | 10 | 10 | 6 | 60.0% |
| vague_items | 45 | 45 | 2 | 4.4% |
| window | 35 | 35 | 5 | 14.3% |

## Pass rate by language

| language | run | judged | passed | pass rate |
| --- | --- | --- | --- | --- |
| ar | 225 | 225 | 47 | 20.9% |
| arabizi | 125 | 125 | 17 | 13.6% |
| en | 75 | 75 | 13 | 17.3% |
| fr | 50 | 50 | 4 | 8.0% |
| mixed | 25 | 25 | 2 | 8.0% |

| form | run | judged | passed | pass rate |
| --- | --- | --- | --- | --- |
| burst | 34 | 34 | 5 | 14.7% |
| typed | 341 | 341 | 59 | 17.3% |
| voice note | 125 | 125 | 19 | 15.2% |

## Failure classes, ranked by count times severity

Severity 3: the customer was harmed, stranded, or got a wrong product or wrong money; 2: friction; 1: a blemish. Code classes carry a fixed severity; judge classes the judge's.

| rank | class | found by | conversations | share of judged | mean severity | score | owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | judge_goal_not_reached | judge | 345 | 69.0% | 2.75 | 950.0 | ordering lane |
| 2 | judge_dead_end | judge | 255 | 51.0% | 2.81 | 717.0 | hand-off |
| 3 | judge_repeated_question | judge | 238 | 47.6% | 2.71 | 644.0 | ordering lane |
| 4 | judge_unnatural_dialect | judge | 173 | 34.6% | 2.46 | 425.0 | message design |
| 5 | judge_wrong_product | judge | 151 | 30.2% | 2.81 | 425.0 | ordering lane |
| 6 | silence_after_handoff | code | 95 | 19.0% | 3.00 | 285.0 | hand-off |
| 7 | message_rules | code | 261 | 52.2% | 1.00 | 261.0 | message design |
| 8 | judge_invented_fact | judge | 79 | 15.8% | 2.91 | 230.0 | ordering lane |
| 9 | wrong_language | code | 76 | 15.2% | 2.00 | 152.0 | message design |
| 10 | no_reply | code | 2 | 0.4% | 3.00 | 6.0 | ordering lane |
| 11 | turn_error | code | 2 | 0.4% | 3.00 | 6.0 | ordering lane |
| 12 | judge_rating_or_health_word | judge | 1 | 0.2% | 2.00 | 2.0 | message design |

### judge_goal_not_reached (345 conversations, severity 2.75)

**sim-051** (seed 10050; plain_order/one_item; ar, voice, burst): The shop replied that Gharifeh is not yet served and stopped, so the customer got no card and no way forward. The refusal may be policy-correct, but nothing was offered next (a notify option, a human, or a different address). (no order card was produced; customer left with no next step after the refusal; no alternative or human hand-off offered; no acknowledgment of the greeting or the garlic request)

```
CUSTOMER 1: [voice note, transcript as received: "مرحبا كيفك بدي طلب توصيل ايه ع غريفة بدي ثنتين ثوم لو سمحت"]
SHOP:
  غريفة مش متوفّر بعد على ألو كينغ، فما فينا ناخد طلب منو هلّق.
```

**sim-073** (seed 10072; same_as_last/same_as_last; ar, burst): The shop failed to find the customer's prior order, repeated the same canned reply when challenged, offered no human hand-off, and no order card was ever produced. (said no previous completed order found though customer had one 5 days ago; repeated the identical reply after the customer pushed back; no hand-off or alternative offered; customer stranded with no way to reorder)

```
CUSTOMER 1: (1) مرحبا  (2) بدي نفس الطلبية يلي المرة الماضية لو سمحت
SHOP:
  ما لقيت طلب سابق مكتمل إلك. شو بتحب تطلب؟

CUSTOMER 2: بس أنا طلبت من خمس أيام، آخر طلبية. ما بتطلعلك؟
SHOP:
  ما لقيت طلب سابق مكتمل إلك. شو بتحب تطلب؟
```

**sim-471** (seed 10470; out_of_stock/alone; mixed): The shop correctly said the mayonnaise was out of stock and carded nothing wrong, but the only alternative was ketchup, which isn't similar, so the customer declined and no order resulted; the reply was also in English and not natural for the customer. (replied in English to a mixed Arabizi/French customer; offered ketchup as a 'similar product' to mayonnaise; first line over the length rule (138 chars); no order card, customer left with nothing)

```
CUSTOMER 1: Bonjour, baddi 2 mayonnaise Plein Soleil 250ml please, la jarte (neighbour) 3am bte3mol commande
SHOP:
  Plein Soleil mayonnaise 250ml is out of stock, and no other mayonnaise is available. Would you like one of these Dolly's ketchups instead?
  Dolly's Tomato Ketchup 330G
  $0.88
  Dolly's Ketchup 900G
  $2.78
  Buttons:
    [b1] Dolly's 330g
    [b2] Dolly's 900g
    [b3] No thanks

CUSTOMER 2: [taps "No thanks"]
SHOP:
  No problem, we won't add the mayonnaise or the ketchup. Message us anytime you want to place a new order.
```

### judge_dead_end (255 conversations, severity 2.81)

**sim-051** (seed 10050; plain_order/one_item; ar, voice, burst): The shop replied that Gharifeh is not yet served and stopped, so the customer got no card and no way forward. The refusal may be policy-correct, but nothing was offered next (a notify option, a human, or a different address). (no order card was produced; customer left with no next step after the refusal; no alternative or human hand-off offered; no acknowledgment of the greeting or the garlic request)

```
CUSTOMER 1: [voice note, transcript as received: "مرحبا كيفك بدي طلب توصيل ايه ع غريفة بدي ثنتين ثوم لو سمحت"]
SHOP:
  غريفة مش متوفّر بعد على ألو كينغ، فما فينا ناخد طلب منو هلّق.
```

**sim-073** (seed 10072; same_as_last/same_as_last; ar, burst): The shop failed to find the customer's prior order, repeated the same canned reply when challenged, offered no human hand-off, and no order card was ever produced. (said no previous completed order found though customer had one 5 days ago; repeated the identical reply after the customer pushed back; no hand-off or alternative offered; customer stranded with no way to reorder)

```
CUSTOMER 1: (1) مرحبا  (2) بدي نفس الطلبية يلي المرة الماضية لو سمحت
SHOP:
  ما لقيت طلب سابق مكتمل إلك. شو بتحب تطلب؟

CUSTOMER 2: بس أنا طلبت من خمس أيام، آخر طلبية. ما بتطلعلك؟
SHOP:
  ما لقيت طلب سابق مكتمل إلك. شو بتحب تطلب؟
```

**sim-005** (seed 10004; person/refund; ar, burst): The shop handed off to a person with a single brief message, then stayed completely silent on both follow-ups, leaving the older customer without any answer about her refund. (silence after hand-off on customer turn 2; silence after hand-off on customer turn 3; customer's question about when someone will call went unanswered; no clear next step or timeframe given; customer stranded after hand-off)

```
CUSTOMER 1: (1) مساء الخير  (2) بدي إرجع المصاري تبع اللحمة المفرومة، وصلت من يومين وما كانت منيحة  (3) الله يخليكن
SHOP:
  رح يتواصل معك حدا من فريقنا بأقرب وقت.

CUSTOMER 2: يعطيكن العافية، بتقدروا تخبروني أيمتى رح يتصل فيي حدا؟
SHOP:
  (The shop sent nothing.)

CUSTOMER 3: لو سمحتوا، بدي جواب بخصوص المصاري تبع اللحمة، مرسي كتير
SHOP:
  (The shop sent nothing.)
```

### judge_repeated_question (238 conversations, severity 2.71)

**sim-073** (seed 10072; same_as_last/same_as_last; ar, burst): The shop failed to find the customer's prior order, repeated the same canned reply when challenged, offered no human hand-off, and no order card was ever produced. (said no previous completed order found though customer had one 5 days ago; repeated the identical reply after the customer pushed back; no hand-off or alternative offered; customer stranded with no way to reorder)

```
CUSTOMER 1: (1) مرحبا  (2) بدي نفس الطلبية يلي المرة الماضية لو سمحت
SHOP:
  ما لقيت طلب سابق مكتمل إلك. شو بتحب تطلب؟

CUSTOMER 2: بس أنا طلبت من خمس أيام، آخر طلبية. ما بتطلعلك؟
SHOP:
  ما لقيت طلب سابق مكتمل إلك. شو بتحب تطلب؟
```

**sim-125** (seed 10124; cancel/before_confirm; arabizi): Customer ended with nothing ordered and a cancel acknowledgment, but the shop hit the minimum-order wall twice, mixed scripts awkwardly, and repeated itself; the cancellation itself was clear. (first reply in Arabic script to an Arabizi customer; second reply in stiff transliterated Arabizi, flagged wrong_language; same below-minimum message repeated after customer said no more items; price shown for single unit, not 3; no order card ever shown)

```
CUSTOMER 1: marhaba, baddi 3 Private feminine pads extra thin normal 10 pieces, la kfarfaqoud
SHOP:
  الطلب أقل من الحد الأدنى للتوصيل. بدك تضيف شي كمان؟
  Private Feminine Pads Extra Thin Normal 10 Pieces
  $1.35

CUSTOMER 2: la2, bass hayda, yalla 2arreb el order
SHOP:
  El order 2al2al men el 7ad el adna lal tawsil. Bade tzid shi?
  Private Feminine Pads Extra Thin Normal 10 Pieces
  $1.35
  Buttons:
    [b1] زيد شي
    [b2] الغي الطلب

CUSTOMER 3: [taps "الغي الطلب"]
SHOP:
  تمام، ألغينا الطلب. بتحب تطلب شي ثاني؟
```

**sim-265** (seed 10264; off_topic/off_topic; arabizi, voice): The shop stayed polite and never insulted back, but it sent the same canned off-topic line three times, in Arabic script to an Arabizi customer, and never actually answered the direct question about what it does. (identical canned reply three times; customer wrote Arabizi, shop replied in Arabic script; third question 'what do you do' got no real answer; stiff, formal phrasing; no variation between turns; 'Alo King' brand name may not match shop (unverified))

```
CUSTOMER 1: [voice note, transcript as received: "marhaba shu hal 2a6s l yom fi shi shta ana hon bel chouf emmm"]
SHOP:
  أنا هون بس لطلبات ألو كينغ: أغراض، توصيل، ووين صار طلبك.
  شو بتحب تطلب؟

CUSTOMER 2: haha ok, w enta shu shayef bel match mbereh? Barcelona 3emlo shi?
SHOP:
  أنا هون بس لطلبات ألو كينغ: أغراض، توصيل، ووين صار طلبك.
  شو بتحب تطلب؟

CUSTOMER 3: tayyeb, shu bta3mlo bel dabt? shu fiyi 2 टlob menkon?
SHOP:
  أنا هون بس لطلبات ألو كينغ: أغراض، توصيل، ووين صار طلبك.
  شو بتحب تطلب؟
```

### judge_unnatural_dialect (173 conversations, severity 2.46)

**sim-182** (seed 10181; food_facts/halal; ar): The shop correctly declined to confirm halal status without an approved record and told the customer to check the label, and no order was placed, but the Arabic wording was awkward and the follow-up buttons were odd. (reply is stiff and vague: 'مطابق لهالشي' never says the word halal; offers 'I want to order it' right after saying it has no confirmation; second reply is a stiff scope-limit message after a polite 'no thanks')

```
CUSTOMER 1: مرحبا، بدي اسأل، صدر الفروج يلي عندكن ماركة Wilco، هو حلال؟
SHOP:
  ما عندي معلومات موثّقة عن هل المنتج مطابق لهالشي. تأكد من الملصق على العلبة.
  Buttons:
    [b1] بدي أطلبه
    [b2] لا، شكرا

CUSTOMER 2: [taps "لا، شكرا"]
SHOP:
  أنا هون بس لطلبات ألو كينغ: أغراض، توصيل، ووين صار طلبك.
  شو بتحب تطلب؟
```

**sim-307** (seed 10306; same_as_last/same_as_last; arabizi, voice, burst): Shop rebuilt the exact last order in one turn, the customer tapped confirm and the order was confirmed with the correct items and total; only the language register (Arabic script and stiff phrasing for an Arabizi customer) was a small blemish. (Replies in formal Arabic script, not Arabizi/Lebanese chat style; No short intro line before the card)

```
CUSTOMER 1: [voice note, transcript as received: "marhaba baddi nafs talab l marra l fatet yaneh emmm nafs elli talabto abel talet iyem merci"]
SHOP:
  🛒 *طلبك AK-1120*
  
  1 × Tanmia Mortadella Beef Plain
  $0.78
  2 × Happy Basket Red Eggs Naylon 15Pcs
  $4.92
  1 × جبنة أيدام
  $1.43
  
  التوصيل (بطمة): $1.50
  رسم الطلبات الصغيرة: $0.50
  *المجموع: $9.13*
  أو 817,000 ل.ل
  
  📍 بطمة
  الوصول خلال حوالي 30 دقيقة
  💵 الدفع: كاش عند الاستلام
  
  بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة.
  Buttons:
    [b1] تأكيد الطلب
    [b2] تعديل
    [b3] إلغاء

CUSTOMER 2: [taps "تأكيد الطلب"]
SHOP:
  ✅ تأكد طلبك AK-1120
  عم نحضّرو هلّق.
```

**sim-471** (seed 10470; out_of_stock/alone; mixed): The shop correctly said the mayonnaise was out of stock and carded nothing wrong, but the only alternative was ketchup, which isn't similar, so the customer declined and no order resulted; the reply was also in English and not natural for the customer. (replied in English to a mixed Arabizi/French customer; offered ketchup as a 'similar product' to mayonnaise; first line over the length rule (138 chars); no order card, customer left with nothing)

```
CUSTOMER 1: Bonjour, baddi 2 mayonnaise Plein Soleil 250ml please, la jarte (neighbour) 3am bte3mol commande
SHOP:
  Plein Soleil mayonnaise 250ml is out of stock, and no other mayonnaise is available. Would you like one of these Dolly's ketchups instead?
  Dolly's Tomato Ketchup 330G
  $0.88
  Dolly's Ketchup 900G
  $2.78
  Buttons:
    [b1] Dolly's 330g
    [b2] Dolly's 900g
    [b3] No thanks

CUSTOMER 2: [taps "No thanks"]
SHOP:
  No problem, we won't add the mayonnaise or the ketchup. Message us anytime you want to place a new order.
```

### judge_wrong_product (151 conversations, severity 2.81)

**sim-122** (seed 10121; food_facts/allergy; arabizi, voice): The shop correctly said it did not know the gluten status and never called Kit Kat safe, but after the customer declined it still put the Kit Kat on a card, and it mixed in Arabic-script prompts for an Arabizi customer.​ (Kit Kat card shown after customer chose 'Ma bade kit kat'; Garbled card text with minimum-order wording nobody asked for; Arabic-script 'remember allergy' prompts to an Arabizi customer, twice, and 'gluten free' saved as a preference; Wrong-language/stiff reply and over-long first message flagged; Customer tapped no and still got an order card)

```
CUSTOMER 1: [voice note, transcript as received: "marhaba baddi es2al abel ma 2 otlob el kit kat arba3 asabe3 sitte w talatin ela noss gram fiya gluten because ebné 3ando 7assasiye mn el gluten"]
SHOP:
  Ma 3anna ma3lumat mo2akkade 3an el gluten bel Kit Kat 4 Fingers 36.5g, fa ma fi nekdar n2ekked innon mnee2 la ebnak. Mnit2ked men el label 2abel ma tetlob, aw tneen min 3and ghayra 3ande ma3lumat?
  Buttons:
    [b1] Es2al el ma7al
    [b2] Ma bade kit kat
  ---
  سجّلنا «gluten» على طلبك، ولازم المطبخ يأكّد. بتحب نتذكّرها لطلباتك الجاية؟
  Buttons:
    [b3] إيه، تذكّرها
    [b4] بس هالمرة

CUSTOMER 2: [taps "Ma bade kit kat"]
SHOP:
  Kit Kat 4 Fingers, 3ashan ya5od el talab lal minimum zid ashya tanyeh.
  Kit Kat 4 Fingers 36.5G
  $0.63

CUSTOMER 3: La merci, ma baddi kit kat. Ma fi ta2kid enno gluten free, fa ma badde
SHOP:
  Tamam, ma rah nDeef el Kit Kat. Fi shi tenye bdak yetlob?
  ---
  سجّلنا «gluten free» على طلبك، ولازم المطبخ يأكّد. بتحب نتذكّرها لطلباتك الجاية؟
  Buttons:
    [b5] إيه، تذكّرها
    [b6] بس هالمرة
```

**sim-097** (seed 10096; not_sold/restaurant; arabizi): The shop correctly said the pizzeria is not available, but then misread the follow-up as a water jug request and sent an unrequested product card, answered the polite close with a repeated canned line, and used stiff Arabic script for an Arabizi customer. (misread 'jeriti' as jerrycan and showed water product card nobody asked for; never clearly answered the 'can you get it anyway' follow-up; replied in Arabic script to Arabizi customer, stiff phrasing; same canned redirect repeated twice, including after the customer's polite goodbye; no offer of help with something it actually sells, as the success line requires)

```
CUSTOMER 1: marhaba, baddi pizza kbire men l pizzeria law sama7t
SHOP:
  pizzeria مش متوفّر بعد على ألو كينغ، فما فينا ناخد طلب منو هلّق.

CUSTOMER 2: ma fi tjibouna aya7al? 3am bshteri la jeriti l kbire w baddi yeha bi ay tari2a
SHOP:
  ma fhimit 'jeriti l kbire' bi dakkat. Bidak jarra mi kbire?
  Aqua Family 10L
  $0.72
  Tannourine Mineral Water Gallon 6L
  $1.29
  Buttons:
    [b1] Aqua Family 10L
    [b2] Tannourine 6L
    [b3] shi tani

CUSTOMER 3: la la, ma baddi jarra. ana 2ult pizza kbire, 2abl shway. ma fi tjibouna yeha aya7al? iza ma fi, ma fi mushkle merci
SHOP:
  أنا هون بس لطلبات ألو كينغ: أغراض، توصيل، ووين صار طلبك.
  شو بتحب تطلب؟

CUSTOMER 4: ok ma fi mushkle, merci ya3tik l 3afye
SHOP:
  أنا هون بس لطلبات ألو كينغ: أغراض، توصيل، ووين صار طلبك.
  شو بتحب تطلب؟
```

**sim-119** (seed 10118; person/complaint; arabizi): The shop first mistook the complaint for a reorder and showed an uninvited product card; the hand-off was logged, but the two follow-up messages got no reply, leaving the customer stranded with no clear next step. (misread complaint as new order, showed unwanted product card; hand-off message in formal Arabic script, not Arabizi; silence after hand-off on turns 3 and 4; customer never told what happens next; no timeframe or acknowledgment of damaged item)

```
CUSTOMER 1: marhaba, talab 2a5er 3tene (2 ayem) kenet 3elbet Lipton Yellow Label tea 25 bags 5arbane, mnasra
SHOP:
  Talabak 2a2al men el minimum. Fi ta zido shi tani?
  Lipton Yellow Label Black Tea 25 Bags
  $0.73

CUSTOMER 2: la ana ma baddi talab jdid, baddi 2e3mol shakwa: 3elbet el Lipton eli wasalet kenet 5arbane. shu fiyon ta7el hal mawdou3?
SHOP:
  رح يتواصل معك حدا من فريقنا بأقرب وقت.

CUSTOMER 3: merci, fiyon t2oulo yjawebni ta2rib? baddi a3raf shu rah ysir bel 3elbe el 5arbane
SHOP:
  (The shop sent nothing.)

CUSTOMER 4: hello, fi hada yjawebni 3ala shakwet el Lipton tea? merci
SHOP:
  (The shop sent nothing.)
```

### silence_after_handoff (95 conversations, severity 3.00)

**sim-005** (seed 10004; person/refund; ar, burst): turn 2: outcome human; turn 3: outcome human

```
CUSTOMER 1: (1) مساء الخير  (2) بدي إرجع المصاري تبع اللحمة المفرومة، وصلت من يومين وما كانت منيحة  (3) الله يخليكن
SHOP:
  رح يتواصل معك حدا من فريقنا بأقرب وقت.

CUSTOMER 2: يعطيكن العافية، بتقدروا تخبروني أيمتى رح يتصل فيي حدا؟
SHOP:
  (The shop sent nothing.)

CUSTOMER 3: لو سمحتوا، بدي جواب بخصوص المصاري تبع اللحمة، مرسي كتير
SHOP:
  (The shop sent nothing.)
```

**sim-011** (seed 10010; person/wants_person; ar): turn 2: outcome human; turn 3: outcome human

```
CUSTOMER 1: مرحبا، بدي احكي مع شخص حقيقي مش بوت لو سمحت، عندي سؤال عن طلبية
SHOP:
  رح يتواصل معك حدا من فريقنا بأقرب وقت.

CUSTOMER 2: تمام، أيمتى بتقريب بيجاوبني حدا؟
SHOP:
  (The shop sent nothing.)

CUSTOMER 3: هيي بعدك حدا؟ بدي جاوب بسرعة لانو مستعجل
SHOP:
  (The shop sent nothing.)
```

**sim-018** (seed 10017; person/wants_person; arabizi): turn 2: outcome human; turn 3: outcome human

```
CUSTOMER 1: marhaba, baddi 7ada men el shop yekellimne 3an talab (order) please, mesh bot
SHOP:
  رح يتواصل معك حدا من فريقنا بأقرب وقت.

CUSTOMER 2: merci, emta ba3rif yjewebne?
SHOP:
  (The shop sent nothing.)

CUSTOMER 3: marhaba, fi 7ada? emta bi jawbouni please?
SHOP:
  (The shop sent nothing.)
```

### message_rules (261 conversations, severity 1.00)

**sim-235** (seed 10234; food_facts/halal; en): turn 1: rule 1: line 1 has 166 characters | I'm sorry, I don't have verified halal information for the Tanmia Mortadelle Beef Aux Olives. Please

```
CUSTOMER 1: Hi, is the Tanmia Mortadelle Beef Aux Olives halal?
SHOP:
  I'm sorry, I don't have verified halal information for the Tanmia Mortadelle Beef Aux Olives. Please check the label, or I can help you with another product or order.

CUSTOMER 2: ok then forget it, thanks
SHOP:
  I'm here only for Alo King orders: items, delivery, and where your order is.
  What would you like to order?
```

**sim-272** (seed 10271; food_facts/halal; ar): turn 1: rule 1: line 1 has 125 characters | ما عندي معلومات موثّقة عن هذا المنتج بخصوص هذا الموضوع، فالرجاء تتأكد من الغلاف أو من التاجر. بدك أض

```
CUSTOMER 1: مرحبا، البيبروني تبع طولكرم حلال؟
SHOP:
  ما عندي معلومات موثّقة عن هذا المنتج بخصوص هذا الموضوع، فالرجاء تتأكد من الغلاف أو من التاجر. بدك أضيف بيبيروني طولكرم لطلبك؟
  Buttons:
    [b1] ضيف للطلب
    [b2] لا، شكراً

CUSTOMER 2: [taps "لا، شكراً"]
SHOP:
  أنا هون بس لطلبات ألو كينغ: أغراض، توصيل، ووين صار طلبك.
  شو بتحب تطلب؟
```

**sim-471** (seed 10470; out_of_stock/alone; mixed): turn 1: rule 1: line 1 has 138 characters | Plein Soleil mayonnaise 250ml is out of stock, and no other mayonnaise is available. Would you like 

```
CUSTOMER 1: Bonjour, baddi 2 mayonnaise Plein Soleil 250ml please, la jarte (neighbour) 3am bte3mol commande
SHOP:
  Plein Soleil mayonnaise 250ml is out of stock, and no other mayonnaise is available. Would you like one of these Dolly's ketchups instead?
  Dolly's Tomato Ketchup 330G
  $0.88
  Dolly's Ketchup 900G
  $2.78
  Buttons:
    [b1] Dolly's 330g
    [b2] Dolly's 900g
    [b3] No thanks

CUSTOMER 2: [taps "No thanks"]
SHOP:
  No problem, we won't add the mayonnaise or the ketchup. Message us anytime you want to place a new order.
```

### judge_invented_fact (79 conversations, severity 2.91)

**sim-002** (seed 10001; food_facts/allergy; arabizi): The shop correctly refused to call the sardines egg-free and the customer did not order, but the replies were stiff and mixed scripts, and the last message invented an 'Alo King' offer. (turn 1 mixes Arabic-script allergy-memory card into an Arabizi chat; turn 3 invents 'Alo King' as an alternative, which no tool returned; stiff, over-long Arabizi lines with a mix of 6 and 2 forms, partly unnatural; turn 2 tells customer to read the label instead of giving a short answer, though the unknown-is-not-safe rule was respected; turn 1 offers to save the allergy, which is slightly off for an impatient customer)

```
CUSTOMER 1: marhaba, el Maxbell Sardine In Oil 125G fiha bayd? 3indi walad 3ando 7asasiyye men el bayd
SHOP:
  Ma 3indi ma3loumet mou2akkade enno el Maxbell Sardine fiha bayd aw la. Ba3ref l7asasiyye, fa 3al 2al2al iqra el label 2abl ma te2kul menn, w el maTba5 lazem ye2kkad.
  ---
  سجّلنا «حساسية من البيض (ولد عنده حساسية من البيض)» على طلبك، ولازم المطبخ يأكّد. بتحب نتذكّرها لطلباتك الجاية؟
  Buttons:
    [b1] إيه، تذكّرها
    [b2] بس هالمرة

CUSTOMER 2: yaʼni ma fiyon yeʼakkdo hala2? ana 3ajel, baddi jewebe wad7a eza safe aw la
SHOP:
  Ma 3indi ma3loumet mou2akkade enno el Maxbell Sardine ma fiha bayd, fa ma bi2dar 2oulak safe. Eqra el label 2abl ma te3ṭiha, w el ma6ba5 lazem ye2kkad hal2ḍiyye.

CUSTOMER 3: ok yaʼni ma fi ta2keed, ma badde talab. merci
SHOP:
  Tamam, ma fi talab. Merci 3la tawasol ma3na, ba3d ma bdak shi 2ana 3ando 3ala Alo King.
```

**sim-044** (seed 10043; out_of_stock/alone; fr, voice): The product was out of stock and the shop offered only non-jam alternatives twice, so the customer gave up with no order card; the shop was honest about the stockout but its alternatives were poor and a catalogue claim was unsupported. (alternatives offered (Nutella, tahina) are not jam, irrelevant to the request; claimed the only strawberry jam in stock is El Rashidi, an unsupported catalogue assertion; re-offered same irrelevant alternatives after the customer objected; no card was produced, customer left with nothing; message lines exceed the length rule)

```
CUSTOMER 1: [voice note, transcript as received: "bonjour je voudrais un pot de confiture de fraise el rashidi el mizan le trois cent quarante grammes s il vous plaît"]
SHOP:
  Désolé, la confiture de fraise El Rashidi El Mizan 340g est en rupture de stock. Voulez-vous une de ces alternatives ?
  Nutella Spread Chocolate Hazelnut 350G
  $3.53
  Nutella Spread Chocolate Hazelnut 750G
  $7.00
  Al Arabiya Tahina 400G
  $1.98
  Buttons:
    [b1] Nutella 350g
    [b2] Nutella 750g
    [b3] Tahina Al Arabiya

CUSTOMER 2: Merci, mais ce n'est pas de la confiture. Vous n'avez pas une autre confiture de fraise ?
SHOP:
  Désolé, la seule confiture de fraise que nous avons est El Rashidi El Mizan, actuellement en rupture de stock. Voici les alternatives disponibles :
  Nutella Spread Chocolate Hazelnut 750G
  $7.00
  Nutella Spread Chocolate Hazelnut 350G
  $3.53
  Al Arabiya Tahina 400G
  $1.98

CUSTOMER 3: Ok, merci quand même. Je laisse tomber alors.
SHOP:
  D'accord, aucun problème, la commande est annulée. Merci quand même, et n'hésitez pas à nous écrire quand vous voulez commander sur Alo King.
```

**sim-270** (seed 10269; food_facts/allergy; ar): The shop correctly refused to call the product sesame-free and the customer did not order, but it implied a kitchen confirmation process and a recorded allergy note on a non-existent order, adding friction and an unsupported promise. (claims the kitchen will confirm the allergy, a promise no tool supports; order was never placed yet an allergy note was said to be recorded on it; customer asked for confirmation before ordering, yet shop pushed allergy-note flow; long lines and Arabic-Indic digits violate message rules)

```
CUSTOMER 1: مرحبا، بدي اسأل عن اندومي نودلز دجاج ٧٠ غرام، فيه سمسم؟ ابني عنده حساسية من السمسم
SHOP:
  أهلين، ما عندي معلومات موثقة عن وجود سمسم بمنتج اندومي دجاج ٧٠ غرام، فالرجاء تأكدي من الملصق على العبوة. بما إنو في حساسية عند ابنك، المطبخ لازم يأكد الشي قبل الطلب، وبيكون الطلب مسجل مع ملاحظة الحساسية.
  ---
  سجّلنا «حساسية من السمسم» على طلبك، ولازم المطبخ يأكّد. بتحب نتذكّرها لطلباتك الجاية؟
  Buttons:
    [b1] إيه، تذكّرها
    [b2] بس هالمرة

CUSTOMER 2: بس انا بدي اعرف اذا مأكد انو ما فيه سمسم قبل ما اطلب. ما بدي خاطر. فيكن تأكدولي؟
SHOP:
  ما عندي معلومات موثقة تأكد إنو ما في سمسم بمنتج اندومي دجاج ٧٠ غرام، فما بقدر أأكدلك. الرجاء تقري الملصق على العبوة، والطلب بيضل مسجّل مع ملاحظة حساسية السمسم، والمطبخ لازم يأكّد.
  Buttons:
    [b3] ضيف اندومي للطلب
    [b4] لا، شكراً

CUSTOMER 3: [taps "لا، شكراً"]
SHOP:
  تمام، ما بنحفظ شي. لما تحبّي تطلبي، ابعتيلي الطلب.
```

### wrong_language (76 conversations, severity 2.00)

**sim-002** (seed 10001; food_facts/allergy; arabizi): turn 3: arabizi customer, reply read as fr: Tamam, ma fi talab. Merci 3la tawasol ma3na, ba3d ma bdak shi 2ana 3ando 3ala Alo King.

```
CUSTOMER 1: marhaba, el Maxbell Sardine In Oil 125G fiha bayd? 3indi walad 3ando 7asasiyye men el bayd
SHOP:
  Ma 3indi ma3loumet mou2akkade enno el Maxbell Sardine fiha bayd aw la. Ba3ref l7asasiyye, fa 3al 2al2al iqra el label 2abl ma te2kul menn, w el maTba5 lazem ye2kkad.
  ---
  سجّلنا «حساسية من البيض (ولد عنده حساسية من البيض)» على طلبك، ولازم المطبخ يأكّد. بتحب نتذكّرها لطلباتك الجاية؟
  Buttons:
    [b1] إيه، تذكّرها
    [b2] بس هالمرة

CUSTOMER 2: yaʼni ma fiyon yeʼakkdo hala2? ana 3ajel, baddi jewebe wad7a eza safe aw la
SHOP:
  Ma 3indi ma3loumet mou2akkade enno el Maxbell Sardine ma fiha bayd, fa ma bi2dar 2oulak safe. Eqra el label 2abl ma te3ṭiha, w el ma6ba5 lazem ye2kkad hal2ḍiyye.

CUSTOMER 3: ok yaʼni ma fi ta2keed, ma badde talab. merci
SHOP:
  Tamam, ma fi talab. Merci 3la tawasol ma3na, ba3d ma bdak shi 2ana 3ando 3ala Alo King.
```

**sim-062** (seed 10061; not_sold/tobacco; arabizi): turn 3: arabizi customer, reply read as fr: Je suis là seulement pour les commandes Alo King : articles, livraison, et où en est votre commande.
Que voulez-vous com

```
CUSTOMER 1: marhaba, baddi 3elbe cigarettes please, esri3 shi 3ashen 3am 3amel break
SHOP:
  مرحبا، للأسف ما عنا سجاير هلق. بقدر ساعدك بشي تاني؟

CUSTOMER 2: ma fi tjibon aya haye 3ade? bas 3elbe wa7de
SHOP:
  Ma fi sajayer m3na, lal2asaf. Bi2dar sa3dak b2ay shi tene mn Alo King?

CUSTOMER 3: ok mish mushkle, merci yslamo, bye
SHOP:
  Je suis là seulement pour les commandes Alo King : articles, livraison, et où en est votre commande.
  Que voulez-vous commander ?
```

**sim-122** (seed 10121; food_facts/allergy; arabizi, voice): turn 1: arabizi customer, reply read as en: Ma 3anna ma3lumat mo2akkade 3an el gluten bel Kit Kat 4 Fingers 36.5g, fa ma fi nekdar n2ekked innon mnee2 la ebnak. Mni

```
CUSTOMER 1: [voice note, transcript as received: "marhaba baddi es2al abel ma 2 otlob el kit kat arba3 asabe3 sitte w talatin ela noss gram fiya gluten because ebné 3ando 7assasiye mn el gluten"]
SHOP:
  Ma 3anna ma3lumat mo2akkade 3an el gluten bel Kit Kat 4 Fingers 36.5g, fa ma fi nekdar n2ekked innon mnee2 la ebnak. Mnit2ked men el label 2abel ma tetlob, aw tneen min 3and ghayra 3ande ma3lumat?
  Buttons:
    [b1] Es2al el ma7al
    [b2] Ma bade kit kat
  ---
  سجّلنا «gluten» على طلبك، ولازم المطبخ يأكّد. بتحب نتذكّرها لطلباتك الجاية؟
  Buttons:
    [b3] إيه، تذكّرها
    [b4] بس هالمرة

CUSTOMER 2: [taps "Ma bade kit kat"]
SHOP:
  Kit Kat 4 Fingers, 3ashan ya5od el talab lal minimum zid ashya tanyeh.
  Kit Kat 4 Fingers 36.5G
  $0.63

CUSTOMER 3: La merci, ma baddi kit kat. Ma fi ta2kid enno gluten free, fa ma badde
SHOP:
  Tamam, ma rah nDeef el Kit Kat. Fi shi tenye bdak yetlob?
  ---
  سجّلنا «gluten free» على طلبك، ولازم المطبخ يأكّد. بتحب نتذكّرها لطلباتك الجاية؟
  Buttons:
    [b5] إيه، تذكّرها
    [b6] بس هالمرة
```

### no_reply (2 conversations, severity 3.00)

**sim-009** (seed 10008; night/kept_order; mixed, burst): turn 5: outcome buttons

```
CUSTOMER 1 (night): (1) Bonsoir, excusez-moi de vous écrire si tard  (2) Please baddi yogurt Dairy Khoury Greek Apricot Low Fat 175G, wahde  (3) w kamen Tannour El Asser Oat Bread Large 5 Loaves, ça va?
SHOP:
  Nous ouvrons à 08:00, à partir de demain matin.

CUSTOMER 2 (night): Ah d'accord merci. Est-ce que vous pouvez garder ma commande lil sob7 please? Le livraison à Gharifeh.
SHOP:
  Gharifeh est desservi. Envoyez votre position pour que je garde la commande.
    [a "Send location" button: answer with action "pin" to send your location]

CUSTOMER 3 (night): [sends a location pin: home]
SHOP:
  🌙 Nous sommes fermés et ouvrons à 08:00.
  
  Nous avons gardé votre commande ✅
  À l'ouverture, appuyez sur « Envoyer ma commande » et nous continuerons ici.
  Buttons:
    [b1] Envoyer ma commande

CUSTOMER 4 (night): Merci beaucoup, très gentil. Je vous écris demain matin inchallah, bonne nuit
SHOP:
  Quand la voulez-vous ? Voici les créneaux où nous pouvons livrer :
  List "Choisir un créneau":
    [b2] Demain 08:00-10:00
    [b3] Demain 09:00-11:00
    [b4] Demain 11:00-13:00

CUSTOMER 5 (night): [taps "Demain 08:00-10:00"]
SHOP:
  (The shop sent nothing.)

CUSTOMER 6 (night): Bonjour, je suis là. Baddi kamen n3ref: ma commande est bien gardée?
SHOP:
  Vous n'avez pas de commande en cours. Que voulez-vous commander ?

  ... (20 more lines)
```

**sim-014** (seed 10013; night/kept_order; ar): turn 5: outcome buttons

```
CUSTOMER 1 (night): مساء الخير، بدي لو سمحت علبة عصير كانديا فواكه حمرا زغيرة وقنينة خل أبيض يمامة ليتر، وبدي ياهن عالبيت بعين قني
SHOP:
  ابعتلي موقعك عالخريطة لنكمل طلبك.
    [a "Send location" button: answer with action "pin" to send your location]

CUSTOMER 2 (night): [sends a location pin: home]
SHOP:
  📍 الموقع يلي بعتّو بين كذا ضيعة. وين بالزبط؟
  Buttons:
    [b1] عين قني
    [b2] المختارة
    [b3] عماطور

CUSTOMER 3 (night): [taps "عين قني"]
SHOP:
  🌙 مسكّرين هلّق، منفتح الساعة 08:00.
  
  طلبك محفوظ ✅
  بس نفتح اكبس «ابعت طلبي» ومنكمّل من هون.
  Buttons:
    [b4] ابعت طلبي

CUSTOMER 4 (night): تمام، مرسي. بكرا الصبح بكبس عليه
SHOP:
  أيمتى بدك ياه؟ هيدي الأوقات يلي فينا نوصّل فيها:
  List "اختار الوقت":
    [b5] بكرا 08:00-10:00
    [b6] بكرا 09:00-11:00
    [b7] بكرا 11:00-13:00

CUSTOMER 5 (night): [taps "بكرا 08:00-10:00"]
SHOP:
  (The shop sent nothing.)

  ... (24 more lines)
```

### turn_error (2 conversations, severity 3.00)

**sim-112** (seed 10111; cancel/during_picking; en, voice): turn 6: alarms 1; handoffs button_error: Error: handle_order_button: ILLEGAL_TRANSITION preparing -> cancelled by customer

```
CUSTOMER 1: [voice note, transcript as received: "hi i want one nutella like the seven hundred and fifty gram jar delivered delivered to deir baba please"]
SHOP:
  ✅ Your order is ready.
  📍 Send us your location with the button below
  and we'll send your order card.
    [a "Send location" button: answer with action "pin" to send your location]

CUSTOMER 2: [sends a location pin: home]
SHOP:
  ✅ We got your location: Deir Baba
  
  For the rider, we just need:
  🏠 the building name or nearest landmark
  🔢 the floor

CUSTOMER 3: The white building, second floor
SHOP:
  🛒 *Your order AK-1033*
  
  1 × Nutella Spread Chocolate Hazelnut 750G
  $7.00
  
  Delivery (Deir Baba): $1.50
  Small-order fee: $0.50
  *Total: $9.00*
  or 806,000 LBP
  
  📍 Deir Baba, The white building, second floor
  Arrives in about 30 minutes
  💵 Payment: cash on delivery
  
  By confirming, you agree that we send updates about your orders in this chat.
  Buttons:
    [b1] Confirm order
  ... (24 more lines)
```

**sim-215** (seed 10214; cancel/during_picking; arabizi): turn 11: alarms 1; handoffs button_error: Error: handle_order_button: ILLEGAL_TRANSITION preparing -> cancelled by customer

```
CUSTOMER 1: marhaba, baddi 1 Candia Uht Lait Entier 125ml lal tawsil 3a el beit bel Kahlouniyeh
SHOP:
  Tamam! Ba3tlna pin la location lal beit.
    [a "Send location" button: answer with action "pin" to send your location]

CUSTOMER 2: [sends a location pin: home]
SHOP:
  تمام، استلمنا الموقع بالكحلونية. الطلب الحالي (حليب كاندي 125 مل) أقل من الحد الأدنى للتوصيل، ضيف عليه أغراض لحتى يوصل للحد الأدنى، شو بدك كمان؟

CUSTOMER 3: la2, bass hayda baddo, ma baddi shi tene. fi tari2a nkamel hek?
SHOP:
  للأسف ما في طريقة توصل الحليب لحاله، لازم الطلب يوصل للحد الأدنى للتوصيل. ضيف شي أو شي أغراض لتكمل الطلب، أو ألغيه إذا ما بدك.
  Buttons:
    [b1] أوريني الكتالوج
    [b2] ألغي الطلب

CUSTOMER 4: [taps "أوريني الكتالوج"]
SHOP:
  الكتالوج مش جاهز هلق للأسف. قلّي شو بدك تضيف على طلبك (اسم الصنف أو الماركة) وبشوفلك إياه فوراً.

CUSTOMER 5: tayyib, 3tine 10 Candia Uht Lait Entier 125ml, la jarra
SHOP:
  تمام، 10 حليب كاندي. لسا أقل من الحد الأدنى للتوصيل، شو بدك تضيف؟
  Candia Uht Lait Entier 125Ml
  $0.40

CUSTOMER 6: ok 3tine 30 7alib, ya3ne 30 Candia 125ml
SHOP:
  تمام، بدلتلك الكمية لـ 30 حليب كاندي 125 مل. بتحب تكمل الطلب هيك؟
  Buttons:
    [b3] إيه، كمّل
    [b4] ضيف أغراض

CUSTOMER 7: [taps "إيه، كمّل"]
  ... (45 more lines)
```

### judge_rating_or_health_word (1 conversations, severity 2.00)

**sim-037** (seed 10036; vague_items/brand_only; mixed, burst): The shop offered the right choices for Private pads, but then looped on an unstated minimum and never produced a confirmable card within 12 turns. (Never stated the minimum amount despite 4 customer requests; Said 'Tomates bien notées', which reads as a rating; Asked village after customer had said Moukhtara; later asked again; Replies in formal French or Arabic that did not match the customer's Arabizi mix; No order card by turn limit; the customer was dragged through many turns)

```
CUSTOMER 1: (1) Bonjour, marhaba  (2) baddi Private please  (3) men 3andkon, merci
SHOP:
  أهلين! شو بدك تطلب؟

CUSTOMER 2: Marhaba, baddi Private bas, le produit des dames, you know. Shu 3andkon menhom?
SHOP:
  أي نوع بدك؟
  Private Feminine Pads Extra Thin Night 7 Pieces
  $1.36
  Private Feminine Pads Extra Thin Normal 10 Pieces
  $1.35
  Buttons:
    [b1] Night 7 pcs
    [b2] Normal 10 pcs

CUSTOMER 3: [taps "Normal 10 pcs"]
SHOP:
  Your order is below our minimum, so what else would you like to add?
  Private Feminine Pads Extra Thin Normal 10 Pieces
  $1.35

CUSTOMER 4: Ah bon? Ma fi chi tene baddi, c'est juste hayda. Chu l minimum, w kif fiyyi kammel?
SHOP:
  Votre commande n'a pas encore atteint le minimum. Bdik tzid chi ta2 mn l catalogue?
  Buttons:
    [b3] Voir le catalogue

CUSTOMER 5: Ya3ni quel est le minimum exactement? Combien il me manque, please?
SHOP:
  Le minimum n'est pas encore atteint. Voulez-vous ajouter d'autres produits ?
  Buttons:
    [b4] Voir le catalogue

CUSTOMER 6: [taps "Voir le catalogue"]
  ... (44 more lines)
```

## Hand-offs and silence (baseline for the hand-off redesign)

|  | value |
| --- | --- |
| conversations with a hand-off | 103 (20.6%) |
| of those, an agent_handoff exception raised (ops alerted by the cron) | 101 |
| customers left in silence after a hand-off | 95 (92.2% of hand-offs) |
| follow-up messages that got no reply | 188 |

Codes are written by code; "model:" reasons are the Concierge's own hand-off (handoff_human), grouped by what its free text is about.

| hand-off reason | conversations | share of all |
| --- | --- | --- |
| model: complaint | 24 | 4.8% |
| model: asked for a person | 23 | 4.6% |
| model: refund asked | 16 | 3.2% |
| model: food fact not on record | 16 | 3.2% |
| model: below the minimum order | 8 | 1.6% |
| agent_did_not_finish | 6 | 1.2% |
| model: cancel (no button or already confirmed) | 6 | 1.2% |
| code error: button_error | 2 | 0.4% |
| model: other | 2 | 0.4% |

No person answers in a simulation, so every message after a hand-off meets the gateway's `human` outcome: it is stored and nothing is sent. That silence is what the customer sees today until a person replies.

## Time per turn

| turns | count | median s | 95th s | model calls per turn (mean) |
| --- | --- | --- | --- | --- |
| all customer turns | 3726 | 5.6 | 11.0 | 2.30 |
| turns that called the model | 3160 | 6.2 | 11.4 | 2.71 |

Seconds are the turn's processing in the run (database in process, model over the network), from the burst's end to the last message out; the burst buffer's wait is not included.

## Cost

|  | value |
| --- | --- |
| per conversation, mean | $0.0239 |
| per conversation, median | $0.0223 |
| per conversation, 95th | $0.0421 |
| Concierge only, per conversation (mean) | $0.0072 |
| total spend (every call, repeats included) | $14.98 |

Every call is priced from its usage and the model_prices rows (0092, 0102), as agent_run_costs prices a turn.

## How often a failure repeats

100 failing seeds were run once more with the same seed (same persona, goal and opening; the models answer afresh). **One repeat per seed is a small sample**: it shows whether a failure comes back, not how often; a class with a handful of seeds says little.

|  | seeds | share |
| --- | --- | --- |
| passed | 6 | 6.0% |
| failed again | 92 | 92.0% |
| failed differently | 2 | 2.0% |

By failure class of the first attempt (a seed counts under each class it had; "failed again" means that class came back):

| class | seeds repeated | passed | failed again (same class) | failed, not this class |
| --- | --- | --- | --- | --- |
| judge_goal_not_reached | 83 | 4 | 68 | 11 |
| judge_dead_end | 53 | 1 | 37 | 15 |
| judge_repeated_question | 66 | 4 | 50 | 12 |
| judge_unnatural_dialect | 38 | 3 | 32 | 3 |
| judge_wrong_product | 51 | 1 | 29 | 21 |
| silence_after_handoff | 16 | 0 | 9 | 7 |
| message_rules | 73 | 3 | 50 | 20 |
| judge_invented_fact | 27 | 1 | 8 | 18 |
| wrong_language | 21 | 2 | 10 | 9 |
| no_reply | 2 | 0 | 0 | 2 |
| turn_error | 2 | 0 | 0 | 2 |

By the ten fixes (the follow-up drew its seeds in proportion to them; a seed counts under each fix it falls under):

| fix | seeds repeated | passed | same fix needed again | failed otherwise |
| --- | --- | --- | --- | --- |
| 1. the minimum order said by code, with its amount | 75 | 3 | 67 | 5 |
| 2. no silence after a hand-off | 16 | 0 | 9 | 7 |
| 3. the basket kept while it is built | 67 | 4 | 53 | 10 |
| 4. the basket changes only by what the customer picked | 51 | 1 | 29 | 21 |
| 5. a first order without a map pin | 17 | 0 | 14 | 3 |
| 6. replies in the customer's language | 38 | 3 | 32 | 3 |
| 7. line length and Latin digits in model text | 73 | 3 | 50 | 20 |
| 8. greetings and thanks are not off-topic | 14 | 1 | 3 | 10 |
| 9. a refused cancel gets a fixed answer | 6 | 0 | 6 | 0 |
| 10. no catalogue claim without a tool result | 27 | 1 | 8 | 18 |

Classes seen in a repeat that its first attempt did not have: judge_dead_end (23), judge_repeated_question (19), message_rules (11), judge_wrong_product (11), judge_invented_fact (11), judge_unnatural_dialect (8), wrong_language (8), judge_goal_not_reached (7), silence_after_handoff (6), no_reply (1), turn_error (1).

## The ten fixes that matter most

Ranked by how many customers each one would have saved in this sample (first attempts, all 500 judged). Counts come from the results;
each fix names the failure classes it moves. "Came back" is the follow-up's repeat of failing seeds under that fix (one repeat each, a
small sample: see "How often a failure repeats"). None is fixed here.

| # | Fix | Evidence in this run | Came back on repeat | Classes it moves | Owner |
| --- | --- | --- | --- | --- | --- |
| 1 | **Say the minimum order in code, with the amount, and settle one rule.** The planner refuses a basket under `min_order_usd`, the Concierge may not write an amount (output guard), so it loops "your order is below the minimum, add something" without a number; the same baskets also carry a small-order fee, so the shop contradicts itself. A fixed message with the minimum and the gap (both from the quote), or the small-order fee alone below the minimum, never both. | 276 conversations (55%) mention the minimum; 269 of them failed and 178 never got a card. Customers asked "how much is the minimum?" up to five times. | 67 of 75 | goal not reached, dead end, repeated question | ordering lane (quote and planner), message design (the fixed line) |
| 2 | **Never leave a handed-off customer in silence.** After a hand-off, every message meets the `human` outcome and nothing is sent. A fixed acknowledgement on each message while `human_handoff` is set ("a person has your message"), and the chat returned to the Concierge when nobody picks it up within a set time. | 103 hand-offs; 95 of those customers (92.2%) were left in silence; 188 follow-up messages got no reply. Every person / complaint / refund scenario failed (0 of 45). | 9 of 16 (the other 7 were not handed off this time) | silence after hand-off, dead end | hand-off |
| 3 | **Keep the basket while it is being built.** A quick "where is my order / card?" mid-order is answered by the status shortcut with "you have no open order", and the basket built so far is lost; items said early drop out of the card after several turns. The status shortcut should not fire while a basket or a draft is in hand, and the card should be built from the whole basket. | 40 conversations got "no open order" in the middle of ordering; the judge names lost or re-asked items in 238 conversations (repeated question). | 53 of 67 | repeated question, wrong product, goal not reached | ordering lane |
| 4 | **Change the basket only by what the customer picked.** Items added from a tentative "maybe bread?", quantities read as totals instead of additions ("add 2 more" became 4), a different brand put on the card, an edit announced but the card unchanged. Edits through explicit add / remove / set-quantity steps, and a new card that shows what changed. | 151 conversations with a wrong or uninvited product or quantity (severity 2.81). | 29 of 51 | wrong product, invented fact | ordering lane |
| 5 | **Let a first order go without a map pin.** A customer who cannot send a pin cannot order at all ("for a first order we need your location on the map"), and a pin near a village centre is often "between several villages". Accept a typed address with a landmark for a first order (the rider calls or ops checks it), or hand it to a person who answers. | Address scenarios: 0 of 35 passed (no pin 0/12, landmark only 0/11; pin outside 0/12, where the refusal itself is right but carries a 257-character list of villages). 26 conversations got the "which village?" buttons after a pin. | 14 of 17 | goal not reached, dead end | ordering lane (places, L1) |
| 6 | **Reply in the customer's language, Arabizi included.** Arabizi customers were answered in English (67 replies) and French (13); English customers in Arabic (24); fixed messages and model text switch script inside one chat. Pass the language the reading found to every fixed message and to the ask loop, and keep it for the conversation. | 76 conversations with a reply in another language; pass rate Arabizi 13.6%, French 8.0%, mixed 8.0%, against Arabic 20.9%; the judge found the dialect unnatural in 173. | 32 of 38 | wrong language, unnatural dialect | message design |
| 7 | **Hold the message rules in model text.** Lines over 120 characters (480 lines) and Arabic-Indic digits copied from the customer (110, «٣ بيبسي»). The output guard should fold digits to Latin and refuse or split a too-long line, as it already does for amounts. | 261 conversations broke a message rule (52%); severity 1 each, but it is the most common single failure. | 50 of 73 | message rules | message design |
| 8 | **A greeting, a thank-you or a goodbye is not off-topic.** «kifkon?», «merci, yislamo» and «يعطيكن العافية» get the fixed off-topic line, sometimes in the middle of an order. Add them as cases to `evals/cases/off_topic.json` (not off-topic) before changing the reading. | 60 conversations outside the off-topic scenarios got the off-topic line. Lane B item (b) in HANDOFF is the same family. | 3 of 14 | unnatural dialect, dead end | ordering lane (reading prompt) |
| 9 | **A cancel the database refuses gets a clear answer.** Cancelling an order that is being picked raises `ILLEGAL_TRANSITION preparing -> cancelled`, which becomes a `button_error` hand-off; the Concierge also tells customers to tap Cancel on a card that no longer has the button. A fixed message ("it is being prepared; a person will call you about cancelling") and an ops alert. | Cancel scenarios passed 6 of 45 (all before confirming); 2 turn errors (`button_error`) during picking; 6 hand-offs for a cancel the customer could not make. | 6 of 6 | turn error, dead end, silence after hand-off | ordering lane, hand-off |
| 10 | **Say only what a tool returned about the catalogue.** "The catalogue is not ready" (the WhatsApp catalogue is not connected on staging), "the only strawberry jam we have is ...", alternatives that are not the same kind of product. The show_catalog failure should answer with a fixed line and a typed alternative, and "only / no other" claims need a search result behind them. | 79 conversations with an invented fact (severity 2.91), most of them catalogue or availability claims. | 8 of 27 (18 failed for other reasons) | invented fact, dead end | ordering lane |

What held, every turn of every conversation (first attempts and repeats): **no order was confirmed without the customer's own tap** (0),
**no card total differed from the database** (0), **no amount in model text that no tool returned** (0), **nothing was sent after STOP** (0),
and the guard recorded every send (4,472) and none reached Kapso. A turn with no reply at all happened twice in the first attempts (at night,
with the basket kept, a tap on a delivery window from the list got nothing back: `buttons` outcome, sim-009 and sim-014), and a turn error
twice (the cancel in fix 9).

## What this run proves, and what it does not

- **Proven here:** the turn code, tools, gateway and database functions of main (`afc8f81` for the first run; the follow-ups ran at
  `11b008d`, which is main `d113621` plus SIM1's own evals and workflow files, no product file) with the real `claude-haiku-5-5` Concierge,
  on a copy of staging's catalogue and settings, behave as the transcripts show. The customers and the judge are models: a judge finding
  is a strong signal, not a fact; every class above carries three transcripts so a person can check it, and the code classes are exact.
- **Not the live path:** no WhatsApp, no Kapso, no webhook queue, no burst timing (the buffer's wait is not in the seconds), no real audio
  (voice is tested at transcript level), no cron (exceptions were raised, not alerted), and the WhatsApp catalogue is not connected on staging.
- **The clock:** the night scenarios ran with the database's time zone moved so it read 02:xx, then the morning after (the code reads the hours
  from `settings.hours`); delivery windows were the copy's, so a window offered at night may not be one a real 02:00 would offer.
- **Pins** are village centres moved by a few hundred metres: real homes may sit closer to or further from a village line.

## Spend

| run | what | conversations | spend |
| --- | --- | --- | --- |
| [43696258577](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43696258577) | smoke run on main, first 6 scenarios | 6 | $0.13 |
| [43696512658](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43696512658) | the 500 scenarios; stopped by the API key's own usage limit | 463 judged, 37 cut off | $11.27 |
| [43709327718](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43709327718) | follow-up (`budget_usd` 4, `evals/sim/followup-2026-11-15.json`): 29 of the 37 cut off, and 100 failing seeds once more; stopped starting at 85% of its budget | 129 | $3.49 |
| [43711448441](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43711448441) | the last 8 cut off (`budget_usd` 0.45, so the follow-up stays under USD 4) | 8 | $0.22 |
| **total** | | **500 first attempts judged, 100 repeats** | **$15.11** (follow-up $3.71 of its USD 4) |

The first run did not stop at the budget guard: the key's own usage limit was reached at about $11.40 (since raised). The follow-up ran with
the `budget_usd` input added for it: no new conversation from 85% of the budget, every call refused at the budget.
The follow-ups were dispatched on the pull request's branch, because main's workflow did not yet have the `budget_usd` input; the branch was
main plus SIM1's own files only. Cost: $0.0239 a conversation over all first attempts (calibration on the first 20: $0.0213).

## Failing cases written

Each class above is in `evals/cases/sim_<class>.json`: the customer's side of each failing conversation, what the shop sent, and what was wrong. Not fixed here.
