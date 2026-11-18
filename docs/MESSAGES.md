# Customer messages: before and after (CX2)

**Approved by the founder on 18 November 2026, with five changes, and in the code since CX2 stage 2.** This file is the record of what was
approved; it is no longer generated. The words the code sends are in `packages/agents/src/messages/{ar,en,fr}.ts`, and every one of them, as
sent, is in `packages/agents/test/__snapshots__/messages.{ar,en,fr}.md`, checked against the rules below by `packages/agents/test/messages.rules.test.ts`.
The stage-1 pictures stay on the console's **Screens** page, session **cx2**.

The founder's five changes (applied in stage 2):
1. The card's missing-item line: «منسألك قبل ما نبدّل» / "We ask you before swapping anything".
2. 👑 retired everywhere (`answer.repeatOffer` and `cx.welcome` greet with 👋).
3. Every other customer message (status, answers, times, and the rest) in the new layout: the order number in bold, one emoji at the start of a
   line, the 22 emojis only; a status answer and the notice for the same state say the same words.
4. `windows.freshForWindow`: «طازة» / "Fresh" before each product's own name from the quote (the database), never the customer's words.
5. Restaurant and food messages untouched (`windows.restaurantNoWindow`, `fixed.notAvailable`, `fixed.listingClaimed`): FD2 owns them.

## The rules, before and after

| Rule | Before (M1, SYSTEM_BRIEF) | After (approved, in the code) |
|---|---|---|
| Layout | Plain lines; a heading only on the card | Every message opens with one **bold heading line** and its emoji; a blank line between sections; lines under about 60 characters on a phone |
| Emoji | 10 allowed (📍 🛒 🛵 ✅ 💵 🌙 ⚠️ 📦 🏠 🔢), at most 3, 👑 only in a greeting | Widened on purpose to 22: the 10, plus ⏱️ 🔁 🕘 👋 🙏 🔎 ✏️ ❌ 💬 ☀️ 👇 📝; at most 6 in an order card, 3 elsewhere; one per heading or button; 👑 retired (👋 greets) |
| Bold | Only the card's heading and the total | Headings, the total, the gap to the minimum, and a button's name when the text tells the customer to tap it |
| Italic | None | The consent and privacy lines, in italics, last |
| Amounts | Each amount on its own line (rule 7) | An amount ends its line after « · » ("3 × Tannourine water 6 × 2 L · $6.03"); still one amount a line, Latin digits, $ before the number |
| Arabic amounts | `$6.03` alone on its line, so it reads left to right | In an Arabic line WhatsApp draws a dollar amount as `6.03$` (as «12.50$ نقداً» already reads); that is how Arabic readers write it, so no hidden direction marks are added. The text sent is still `$6.03` |
| Lists | Bullets in text, choices as three buttons cut to 20 characters | Choices of products, times and options are WhatsApp **list messages** (a row title up to 24 characters, a description up to 72 with the full name and price, up to 10 rows); buttons only for two or three short actions, each with its emoji, at most 20 characters |
| Places | The out-of-area answer listed every village we serve (25 on staging) | Never a list of villages: we ask for the village or the location |
| Language | Some code messages were Arabic whatever the customer wrote (the feedback question, the payment template's amount) | Every message in the customer's language |
| Templates | `ak_*` utility templates, no bold, no emoji (Meta) | Unchanged: they are sent only outside the 24-hour window; inside it the session message above goes instead |

## What the founder's chat showed (18 November, AK-1062 and AK-1063)

Fixed in stage 1, each with a failing case first (`evals/cases/cx2_founder_chat.json`, `test/db/cx2-founder-chat.test.ts`, `test/db/web2-turn.test.ts`):
1. «نص كفة» (half a kilo of kafta) in the 07:37 voice note was not found and nothing said so. Kafta now has the word «كفة» (0256), and a line not found is always said: by code before a card, a question or the kept-order message, and after the model's reply if the reply did not name it.
2. «cafe mate» (Coffee-mate creamer) was asked as «which one?» over three Najjar coffees. Coffee Mate now has the words (0256), and a «which one?» never offers products when a word the customer said names another product's brand or kind: that line gets PD1's honest answer.
3. The website order's card went twice, Arabic then English (08:52:12 and 08:52:15). Each card request is claimed once (0255): one card, in the language of the page.

Seen and proposed here (stage 2): the out-of-area list of 25 villages (07:38); the feedback question and its thank-you in Arabic to every customer; the payment template sent inside the window, in Arabic, with «9.44$ نقداً»; the picker's buttons cut to «1. نسكافيه قهوة سريع» and «2. نسكافيه قهوة سريع»; the hours said as 08:00 (settings.hours is 09:00 to 21:00 from 0255).

## The messages

### The order card (`card`)

One line per item with its amount; a clear totals block; bold section headings with 🛒 📍 ⏱️ 💵 🔁; short lines. The amount now ends its item's line after « · » instead of standing on a line of its own (rule 7 changed on purpose).

**Before, Arabic**

```text
🛒 *طلبك AK-1062*

3 × مياه معدنية تنورين 6 × 2 ل
$6.03
1 × النجار قهوة كلاسيك عادية 180 غ
$3.25
1 × كوفي ميت مبيض قهوة أوريجينال 450 غ
$2.85

التوصيل (بعقلين): $1.00
*المجموع: $13.13*
أو 1,175,000 ل.ل

📍 بعقلين، بيت الاختبار، الطابق 2
الوصول خلال حوالي 30 دقيقة
💵 الدفع: كاش عند الاستلام
إذا في غرض ناقص: منسألك

بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة.
[تأكيد الطلب] [تعديل] [إلغاء]
```

**After, Arabic**

```text
🛒 *طلبك AK-1062*

3 × مياه معدنية تنورين 6 × 2 ل · $6.03
1 × النجار قهوة كلاسيك عادية 180 غ · $3.25
1 × كوفي ميت مبيض قهوة أوريجينال 450 غ · $2.85

الأغراض · $12.13
التوصيل لبعقلين · $1.00
*المجموع · $13.13*
أو 1,175,000 ل.ل

📍 *العنوان*
بعقلين، بيت الاختبار، الطابق 2
⏱️ خلال حوالي 30 دقيقة

💵 *الدفع*
كاش عند الاستلام

🔁 *إذا في غرض ناقص*
منسألك قبل

_بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة._
[✅ تأكيد الطلب] [✏️ تعديل] [❌ إلغاء]
```

**Before, English**

```text
🛒 *Your order AK-1062*

3 × Tannourine water 6 × 2 L
$6.03
1 × Najjar Classic coffee 180 g
$3.25
1 × Coffee Mate Original 450 g
$2.85

Delivery (Baakline): $1.00
*Total: $13.13*
or 1,175,000 LBP

📍 Baakline, Test house, Floor 2
Arrives in about 30 minutes
💵 Payment: cash on delivery
If an item is missing: we ask you

By confirming, you agree that we send updates about your orders in this chat.
[Confirm order] [Edit] [Cancel]
```

**After, English**

```text
🛒 *Your order AK-1062*

3 × Tannourine water 6 × 2 L · $6.03
1 × Najjar Classic coffee 180 g · $3.25
1 × Coffee Mate Original 450 g · $2.85

Items · $12.13
Delivery to Baakline · $1.00
*Total · $13.13*
or 1,175,000 LBP

📍 *Deliver to*
Baakline, Test house, Floor 2
⏱️ In about 30 minutes

💵 *Payment*
Cash on delivery

🔁 *If an item is missing*
We ask you first

_By confirming, you agree that we send updates about your orders in this chat._
[✅ Confirm order] [✏️ Edit] [❌ Cancel]
```

### The order card, for a time chosen (`card-window`)

The time is its own line under the address, with ⏱️.

**Before, Arabic**

```text
🛒 *طلبك AK-1062*

3 × مياه معدنية تنورين 6 × 2 ل
$6.03
1 × النجار قهوة كلاسيك عادية 180 غ
$3.25
1 × كوفي ميت مبيض قهوة أوريجينال 450 غ
$2.85

التوصيل (بعقلين): $1.00
*المجموع: $13.13*
أو 1,175,000 ل.ل

📍 بعقلين، بيت الاختبار، الطابق 2
التوصيل: بكرا 10:00-12:00
💵 الدفع: كاش عند الاستلام
إذا في غرض ناقص: منسألك

بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة.
[تأكيد الطلب] [تعديل] [إلغاء]
```

**After, Arabic**

```text
🛒 *طلبك AK-1062*

3 × مياه معدنية تنورين 6 × 2 ل · $6.03
1 × النجار قهوة كلاسيك عادية 180 غ · $3.25
1 × كوفي ميت مبيض قهوة أوريجينال 450 غ · $2.85

الأغراض · $12.13
التوصيل لبعقلين · $1.00
*المجموع · $13.13*
أو 1,175,000 ل.ل

📍 *العنوان*
بعقلين، بيت الاختبار، الطابق 2
⏱️ بكرا الخميس، 10:00 لـ 12:00

💵 *الدفع*
كاش عند الاستلام

🔁 *إذا في غرض ناقص*
منسألك قبل

_بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة._
[✅ تأكيد الطلب] [✏️ تعديل] [❌ إلغاء]
```

**Before, English**

```text
🛒 *Your order AK-1062*

3 × Tannourine water 6 × 2 L
$6.03
1 × Najjar Classic coffee 180 g
$3.25
1 × Coffee Mate Original 450 g
$2.85

Delivery (Baakline): $1.00
*Total: $13.13*
or 1,175,000 LBP

📍 Baakline, Test house, Floor 2
Delivery: Tomorrow 10:00-12:00
💵 Payment: cash on delivery
If an item is missing: we ask you

By confirming, you agree that we send updates about your orders in this chat.
[Confirm order] [Edit] [Cancel]
```

**After, English**

```text
🛒 *Your order AK-1062*

3 × Tannourine water 6 × 2 L · $6.03
1 × Najjar Classic coffee 180 g · $3.25
1 × Coffee Mate Original 450 g · $2.85

Items · $12.13
Delivery to Baakline · $1.00
*Total · $13.13*
or 1,175,000 LBP

📍 *Deliver to*
Baakline, Test house, Floor 2
⏱️ Tomorrow, Thursday, 10:00 to 12:00

💵 *Payment*
Cash on delivery

🔁 *If an item is missing*
We ask you first

_By confirming, you agree that we send updates about your orders in this chat._
[✅ Confirm order] [✏️ Edit] [❌ Cancel]
```

### The order card, pickup (off until the hub's place is named) (`card-pickup`)

The pickup place replaces the address; no delivery line.

**Before, Arabic**

```text
🛒 *طلبك AK-1062*

3 × مياه معدنية تنورين 6 × 2 ل
$6.03
1 × النجار قهوة كلاسيك عادية 180 غ
$3.25
1 × كوفي ميت مبيض قهوة أوريجينال 450 غ
$2.85

*المجموع: $12.13*
أو 1,175,000 ل.ل

🏠 استلام من مستودع ألو كينغ، بعقلين، بلا رسم توصيل
💵 الدفع: كاش عند الاستلام
إذا في غرض ناقص: منسألك

بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة.
[تأكيد الطلب] [تعديل] [إلغاء]
```

**After, Arabic**

```text
🛒 *طلبك AK-1062*

3 × مياه معدنية تنورين 6 × 2 ل · $6.03
1 × النجار قهوة كلاسيك عادية 180 غ · $3.25
1 × كوفي ميت مبيض قهوة أوريجينال 450 غ · $2.85

الأغراض · $12.13
*المجموع · $12.13*
أو 1,175,000 ل.ل

🏠 *الاستلام*
مستودع ألو كينغ، بعقلين

💵 *الدفع*
كاش عند الاستلام

🔁 *إذا في غرض ناقص*
منسألك قبل

_بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة._
[✅ تأكيد الطلب] [✏️ تعديل] [❌ إلغاء]
```

**Before, English**

```text
🛒 *Your order AK-1062*

3 × Tannourine water 6 × 2 L
$6.03
1 × Najjar Classic coffee 180 g
$3.25
1 × Coffee Mate Original 450 g
$2.85

*Total: $12.13*
or 1,175,000 LBP

🏠 Pickup at the Alo King hub, Baakline, no delivery fee
💵 Payment: cash on delivery
If an item is missing: we ask you

By confirming, you agree that we send updates about your orders in this chat.
[Confirm order] [Edit] [Cancel]
```

**After, English**

```text
🛒 *Your order AK-1062*

3 × Tannourine water 6 × 2 L · $6.03
1 × Najjar Classic coffee 180 g · $3.25
1 × Coffee Mate Original 450 g · $2.85

Items · $12.13
*Total · $12.13*
or 1,175,000 LBP

🏠 *Pickup*
the Alo King hub, Baakline

💵 *Payment*
Cash on delivery

🔁 *If an item is missing*
We ask you first

_By confirming, you agree that we send updates about your orders in this chat._
[✅ Confirm order] [✏️ Edit] [❌ Cancel]
```

### The order card, with an amount owed, a credit and paid in advance (`card-extras`)

Every amount is a line of the totals block; the advance payment is said under 💵 in two short lines.

**Before, Arabic**

```text
🛒 *طلبك AK-1062*

3 × مياه معدنية تنورين 6 × 2 ل
$6.03
1 × النجار قهوة كلاسيك عادية 180 غ
$3.25
1 × كوفي ميت مبيض قهوة أوريجينال 450 غ
$2.85

التوصيل (بعقلين): $1.00
مستحق من طلب سابق ما قدرنا نسلّمو: $1.50
رصيد إلك من قبل: -$1.25
*المجموع: $13.38*
أو 1,175,000 ل.ل

📍 بعقلين، بيت الاختبار، الطابق 2
الوصول خلال حوالي 30 دقيقة
💵 الدفع: تحويل Whish
في مبلغ مستحق من قبل، فهالطلب بينّدفع سلف (تحويل Whish) قبل التحضير.
بعد التأكيد منبعتلك التفاصيل.
إذا في غرض ناقص: منسألك

بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة.
[تأكيد الطلب] [تعديل] [إلغاء]
```

**After, Arabic**

```text
🛒 *طلبك AK-1062*

3 × مياه معدنية تنورين 6 × 2 ل · $6.03
1 × النجار قهوة كلاسيك عادية 180 غ · $3.25
1 × كوفي ميت مبيض قهوة أوريجينال 450 غ · $2.85

الأغراض · $12.13
التوصيل لبعقلين · $1.00
مستحق من طلب ما قدرنا نسلّمو · $1.50
رصيدك من قبل · -$1.25
*المجموع · $13.38*
أو 1,175,000 ل.ل

📍 *العنوان*
بعقلين، بيت الاختبار، الطابق 2
⏱️ خلال حوالي 30 دقيقة

💵 *الدفع*
تحويل Whish، قبل ما نحضّر الطلب
منبعتلك التفاصيل بعد التأكيد.

🔁 *إذا في غرض ناقص*
منسألك قبل

_بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة._
[✅ تأكيد الطلب] [✏️ تعديل] [❌ إلغاء]
```

**Before, English**

```text
🛒 *Your order AK-1062*

3 × Tannourine water 6 × 2 L
$6.03
1 × Najjar Classic coffee 180 g
$3.25
1 × Coffee Mate Original 450 g
$2.85

Delivery (Baakline): $1.00
Owed from an earlier order we could not deliver: $1.50
Your credit from before: -$1.25
*Total: $13.38*
or 1,175,000 LBP

📍 Baakline, Test house, Floor 2
Arrives in about 30 minutes
💵 Payment: Whish transfer
There is an amount owed from before, so this order is paid in advance (Whish transfer) before we prepare it.
We'll send the details after you confirm.
If an item is missing: we ask you

By confirming, you agree that we send updates about your orders in this chat.
[Confirm order] [Edit] [Cancel]
```

**After, English**

```text
🛒 *Your order AK-1062*

3 × Tannourine water 6 × 2 L · $6.03
1 × Najjar Classic coffee 180 g · $3.25
1 × Coffee Mate Original 450 g · $2.85

Items · $12.13
Delivery to Baakline · $1.00
Owed from an order we could not deliver · $1.50
Your credit from before · -$1.25
*Total · $13.38*
or 1,175,000 LBP

📍 *Deliver to*
Baakline, Test house, Floor 2
⏱️ In about 30 minutes

💵 *Payment*
Whish transfer, before we prepare it
We send the details after you confirm.

🔁 *If an item is missing*
We ask you first

_By confirming, you agree that we send updates about your orders in this chat._
[✅ Confirm order] [✏️ Edit] [❌ Cancel]
```

### A long basket (two messages) (`card-long`)

The items go first as one message with the heading and the count; the card follows with the totals and the buttons.

**Before, Arabic**

```text
🛒 *طلبك AK-1062*

1 × مياه معدنية تنورين 6 × 2 ل
$6.03
2 × النجار قهوة كلاسيك عادية 180 غ
$3.25
3 × كوفي ميت مبيض قهوة أوريجينال 450 غ
$2.85
4 × مياه معدنية تنورين 6 × 2 ل
$6.03
1 × النجار قهوة كلاسيك عادية 180 غ
$3.25
2 × كوفي ميت مبيض قهوة أوريجينال 450 غ
$2.85
3 × مياه معدنية تنورين 6 × 2 ل
$6.03
4 × النجار قهوة كلاسيك عادية 180 غ
$3.25
1 × كوفي ميت مبيض قهوة أوريجينال 450 غ
$2.85
2 × مياه معدنية تنورين 6 × 2 ل
$6.03
3 × النجار قهوة كلاسيك عادية 180 غ
$3.25
4 × كوفي ميت مبيض قهوة أوريجينال 450 غ
$2.85
1 × مياه معدنية تنورين 6 × 2 ل
$6.03
2 × النجار قهوة كلاسيك عادية 180 غ
$3.25
3 × كوفي ميت مبيض قهوة أوريجينال 450 غ
$2.85
4 × مياه معدنية تنورين 6 × 2 ل
$6.03
1 × النجار قهوة كلاسيك عادية 180 غ
$3.25
2 × كوفي ميت مبيض قهوة أوريجينال 450 غ
$2.85
3 × مياه معدنية تنورين 6 × 2 ل
$6.03
4 × النجار قهوة كلاسيك عادية 180 غ
$3.25
1 × كوفي ميت مبيض قهوة أوريجينال 450 غ
$2.85
2 × مياه معدنية تنورين 6 × 2 ل
$6.03
3 × النجار قهوة كلاسيك عادية 180 غ
$3.25
4 × كوفي ميت مبيض قهوة أوريجينال 450 غ
$2.85
```
```text
🛒 *طلبك AK-1062*

التوصيل (بعقلين): $1.00
*المجموع: $13.13*
أو 1,175,000 ل.ل

📍 بعقلين، بيت الاختبار، الطابق 2
الوصول خلال حوالي 30 دقيقة
💵 الدفع: كاش عند الاستلام
إذا في غرض ناقص: منسألك

بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة.
[تأكيد الطلب] [تعديل] [إلغاء]
```

**After, Arabic**

```text
🛒 *طلبك AK-1062* · 24 غرض

1 × مياه معدنية تنورين 6 × 2 ل · $6.03
2 × النجار قهوة كلاسيك عادية 180 غ · $3.25
3 × كوفي ميت مبيض قهوة أوريجينال 450 غ · $2.85
4 × مياه معدنية تنورين 6 × 2 ل · $6.03
1 × النجار قهوة كلاسيك عادية 180 غ · $3.25
2 × كوفي ميت مبيض قهوة أوريجينال 450 غ · $2.85
3 × مياه معدنية تنورين 6 × 2 ل · $6.03
4 × النجار قهوة كلاسيك عادية 180 غ · $3.25
1 × كوفي ميت مبيض قهوة أوريجينال 450 غ · $2.85
2 × مياه معدنية تنورين 6 × 2 ل · $6.03
3 × النجار قهوة كلاسيك عادية 180 غ · $3.25
4 × كوفي ميت مبيض قهوة أوريجينال 450 غ · $2.85
1 × مياه معدنية تنورين 6 × 2 ل · $6.03
2 × النجار قهوة كلاسيك عادية 180 غ · $3.25
3 × كوفي ميت مبيض قهوة أوريجينال 450 غ · $2.85
4 × مياه معدنية تنورين 6 × 2 ل · $6.03
1 × النجار قهوة كلاسيك عادية 180 غ · $3.25
2 × كوفي ميت مبيض قهوة أوريجينال 450 غ · $2.85
3 × مياه معدنية تنورين 6 × 2 ل · $6.03
4 × النجار قهوة كلاسيك عادية 180 غ · $3.25
1 × كوفي ميت مبيض قهوة أوريجينال 450 غ · $2.85
2 × مياه معدنية تنورين 6 × 2 ل · $6.03
3 × النجار قهوة كلاسيك عادية 180 غ · $3.25
4 × كوفي ميت مبيض قهوة أوريجينال 450 غ · $2.85
```
```text
🛒 *طلبك AK-1062*
(الأغراض بالرسالة يلي فوق)

الأغراض · $12.13
التوصيل لبعقلين · $1.00
*المجموع · $13.13*
أو 1,175,000 ل.ل

📍 *العنوان*
بعقلين، بيت الاختبار، الطابق 2
⏱️ خلال حوالي 30 دقيقة

💵 *الدفع*
كاش عند الاستلام

🔁 *إذا في غرض ناقص*
منسألك قبل

_بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة._
[✅ تأكيد الطلب] [✏️ تعديل] [❌ إلغاء]
```

**Before, English**

```text
🛒 *Your order AK-1062*

1 × Tannourine water 6 × 2 L
$6.03
2 × Najjar Classic coffee 180 g
$3.25
3 × Coffee Mate Original 450 g
$2.85
4 × Tannourine water 6 × 2 L
$6.03
1 × Najjar Classic coffee 180 g
$3.25
2 × Coffee Mate Original 450 g
$2.85
3 × Tannourine water 6 × 2 L
$6.03
4 × Najjar Classic coffee 180 g
$3.25
1 × Coffee Mate Original 450 g
$2.85
2 × Tannourine water 6 × 2 L
$6.03
3 × Najjar Classic coffee 180 g
$3.25
4 × Coffee Mate Original 450 g
$2.85
1 × Tannourine water 6 × 2 L
$6.03
2 × Najjar Classic coffee 180 g
$3.25
3 × Coffee Mate Original 450 g
$2.85
4 × Tannourine water 6 × 2 L
$6.03
1 × Najjar Classic coffee 180 g
$3.25
2 × Coffee Mate Original 450 g
$2.85
3 × Tannourine water 6 × 2 L
$6.03
4 × Najjar Classic coffee 180 g
$3.25
1 × Coffee Mate Original 450 g
$2.85
2 × Tannourine water 6 × 2 L
$6.03
3 × Najjar Classic coffee 180 g
$3.25
4 × Coffee Mate Original 450 g
$2.85
```
```text
🛒 *Your order AK-1062*

Delivery (Baakline): $1.00
*Total: $13.13*
or 1,175,000 LBP

📍 Baakline, Test house, Floor 2
Arrives in about 30 minutes
💵 Payment: cash on delivery
If an item is missing: we ask you

By confirming, you agree that we send updates about your orders in this chat.
[Confirm order] [Edit] [Cancel]
```

**After, English**

```text
🛒 *Your order AK-1062* · 24 items

1 × Tannourine water 6 × 2 L · $6.03
2 × Najjar Classic coffee 180 g · $3.25
3 × Coffee Mate Original 450 g · $2.85
4 × Tannourine water 6 × 2 L · $6.03
1 × Najjar Classic coffee 180 g · $3.25
2 × Coffee Mate Original 450 g · $2.85
3 × Tannourine water 6 × 2 L · $6.03
4 × Najjar Classic coffee 180 g · $3.25
1 × Coffee Mate Original 450 g · $2.85
2 × Tannourine water 6 × 2 L · $6.03
3 × Najjar Classic coffee 180 g · $3.25
4 × Coffee Mate Original 450 g · $2.85
1 × Tannourine water 6 × 2 L · $6.03
2 × Najjar Classic coffee 180 g · $3.25
3 × Coffee Mate Original 450 g · $2.85
4 × Tannourine water 6 × 2 L · $6.03
1 × Najjar Classic coffee 180 g · $3.25
2 × Coffee Mate Original 450 g · $2.85
3 × Tannourine water 6 × 2 L · $6.03
4 × Najjar Classic coffee 180 g · $3.25
1 × Coffee Mate Original 450 g · $2.85
2 × Tannourine water 6 × 2 L · $6.03
3 × Najjar Classic coffee 180 g · $3.25
4 × Coffee Mate Original 450 g · $2.85
```
```text
🛒 *Your order AK-1062*
(the items are in the message above)

Items · $12.13
Delivery to Baakline · $1.00
*Total · $13.13*
or 1,175,000 LBP

📍 *Deliver to*
Baakline, Test house, Floor 2
⏱️ In about 30 minutes

💵 *Payment*
Cash on delivery

🔁 *If an item is missing*
We ask you first

_By confirming, you agree that we send updates about your orders in this chat._
[✅ Confirm order] [✏️ Edit] [❌ Cancel]
```

### «Which one?» (a picker) (`picker`)

A WhatsApp list message: each row a product's short name, its full name and price underneath, up to ten rows. Replaces the paragraph with three cut-off buttons (the founder's chat, 08:39).

**Before, Arabic**

```text
(the customer) 🎤 ... وقهوة نجار ونسكافيه please ...
```
```text
«نسكافيه»: أي واحد بدك؟
• نسكافيه قهوة سريعة التحضير 3 في 1 كلاسيك 20 غ: $0.19
• نسكافيه قهوة سريعة التحضير غولد كيس 100 غ: $4.37
اختار من تحت.
[1. نسكافيه قهوة سريع] [2. نسكافيه قهوة سريع]
```

**After, Arabic**

```text
(the customer) 🎤 ... وقهوة نجار ونسكافيه please ...
```
```text
🔎 *أيّا نسكافيه بدك؟*
عنّا نوعين. اختار من القائمة 👇
[☰ اختار]
  • نسكافيه قهوة سريعة 20 غ  —  نسكافيه قهوة سريعة التحضير 3 في 1 كلاسيك 20 غ · $0.19
  • نسكافيه قهوة سريعة 100 غ  —  نسكافيه قهوة سريعة التحضير غولد كيس 100 غ · $4.37
```

**Before, English**

```text
(the customer) 🎤 ... and Najjar coffee and Nescafé please ...
```
```text
"Nescafé": which one would you like?
• Nescafé 3in1 Classic 20 g: $0.19
• Nescafé Gold pouch 100 g: $4.37
Choose below.
[Nescafé 3in1 Clas 20g] [Nescafé Gold pouch 1]
```

**After, English**

```text
(the customer) 🎤 ... and Najjar coffee and Nescafé please ...
```
```text
🔎 *Which Nescafé would you like?*
We have two. Choose from the list 👇
[☰ Choose]
  • Nescafé 3in1 20 g  —  Nescafé 3in1 Classic 20 g · $0.19
  • Nescafé Gold pouch 100 g  —  Nescafé Gold pouch 100 g · $4.37
```

### The welcome (a first message) (`welcome`)

A bold greeting, what we do in one line, then how to order and the hours, each with its emoji; the privacy line in italics. The hours come from settings.hours (09:00 to 21:00 now).

**Before, Arabic**

```text
👑 أهلا فيك بألو كينغ!
منوصّلك أغراض البيت لعند بابك بالشوف. اكتبلي شو بدك أو ابعت رسالة صوتية.
🌙 الدوام من 09:00 لـ 21:00.
لمّا تراسلنا، بتوافق إنّو نحفظ رسايلك وطلباتك بس لنخدمك. فيك تكتب STOP بأي وقت لنوقّف.
[اطلب] [بتوصلو لعندي؟]
```

**After, Arabic**

```text
👋 *أهلا فيك بألو كينغ!*
منوصّلك أغراض البيت لعند بابك بالشوف.

🛒 اكتبلي شو بدك، أو ابعت رسالة صوتية.
🕘 فاتحين كل يوم من 09:00 لـ 21:00.

_لمّا تراسلنا، بتوافق إنّو نحفظ رسايلك وطلباتك بس لنخدمك. فيك تكتب STOP بأي وقت لنوقّف._
[🛒 اطلب] [📍 بتوصلو لعندي؟]
```

**Before, English**

```text
👑 Welcome to Alo King!
We bring home groceries to your door in the Chouf. Tell me what you need, in writing or by voice note.
🌙 We are open from 09:00 to 21:00.
By writing to us you agree that we keep your messages and orders only to serve them. Write STOP at any time.
[Order] [Do you deliver here?]
```

**After, English**

```text
👋 *Welcome to Alo King!*
We bring home groceries to your door in the Chouf.

🛒 Tell me what you need, in writing or by voice note.
🕘 Open every day from 09:00 to 21:00.

_By writing to us you agree that we keep your messages and orders only to serve them. Write STOP at any time._
[🛒 Order] [📍 Do you deliver?]
```

### Closed hours, the order kept (`closed`)

The heading says we are closed and when we open; the basket is a short list; the button is named in bold.

**Before, Arabic**

```text
(the customer) 🎤 بدي كرتونة مي تنورين وقهوة نجار…
```
```text
🌙 مسكّرين هلّق، منفتح الساعة 09:00.

طلبك محفوظ ✅
• 3 × مياه معدنية تنورين 6 × 2 ل
• 1 × النجار قهوة كلاسيك عادية 180 غ
بس نفتح اكبس «ابعت طلبي» ومنكمّل من هون.
[ابعت طلبي]
```

**After, Arabic**

```text
(the customer) 🎤 بدي كرتونة مي تنورين وقهوة نجار…
```
```text
🌙 *مسكّرين هلّق، منفتح الساعة 09:00*

✅ طلبك محفوظ:
• 3 × مياه معدنية تنورين 6 × 2 ل
• 1 × النجار قهوة كلاسيك عادية 180 غ

بس نفتح، اكبس *ابعت طلبي* ومنكمّل من هون.
[🛒 ابعت طلبي]
```

**Before, English**

```text
(the customer) 🎤 I want a pack of Tannourine water and Najjar coffee…
```
```text
🌙 We're closed now and open at 09:00.

We've saved your order ✅
• 3 × Tannourine water 6 × 2 L
• 1 × Najjar Classic coffee 180 g
When we open, tap "Send my order" and we'll carry on here.
[Send my order]
```

**After, English**

```text
(the customer) 🎤 I want a pack of Tannourine water and Najjar coffee…
```
```text
🌙 *We're closed now and open at 09:00*

✅ Your order is saved:
• 3 × Tannourine water 6 × 2 L
• 1 × Najjar Classic coffee 180 g

When we open, tap *Send my order* and we'll carry on here.
[🛒 Send my order]
```

### We are open: the kept order (`closed-open`)

Sent once when we open, inside the 24 hours.

**Before, Arabic**

```text
صباح الخير، فتحنا ✅
طلبك يلي بعتّو وكنّا مسكّرين بعدو محفوظ.
اكبس «ابعت طلبي» ومنكمّل.
[ابعت طلبي]
```

**After, Arabic**

```text
☀️ *صباح الخير، فتحنا*
طلبك يلي بعتّو وكنّا مسكّرين بعدو محفوظ.
اكبس *ابعت طلبي* ومنكمّل.
[🛒 ابعت طلبي]
```

**Before, English**

```text
Good morning, we're open ✅
The order you sent while we were closed is saved.
Tap "Send my order" and we'll carry on.
[Send my order]
```

**After, English**

```text
☀️ *Good morning, we're open*
The order you sent while we were closed is saved.
Tap *Send my order* and we'll carry on.
[🛒 Send my order]
```

### The hours, asked (`hours`)

Two short lines.

**Before, Arabic**

```text
منستقبل الطلبات كل يوم من 09:00 لـ 21:00.
🌙 هلّق مسكّرين.
```

**After, Arabic**

```text
🕘 *فاتحين كل يوم من 09:00 لـ 21:00*
🌙 هلّق مسكّرين. فيك تبعت طلبك ومنحفظلك ياه.
```

**Before, English**

```text
We take orders every day from 09:00 to 21:00.
🌙 We're closed now.
```

**After, English**

```text
🕘 *We're open every day, 09:00 to 21:00*
🌙 We're closed now. Send your order and we'll keep it for you.
```

### A village we do not deliver to (`area-out`)

Never a list of 25 villages: we ask for the village or the location (the founder's chat, 07:38, sent all 25).

**Before, Arabic**

```text
(the customer) 📍 (موقع بصيدا)
```
```text
لهلّق ما منوصّل على صيدا.
📍 منوصّل على: عينبال، عين وزين، بعقلين، بقعاتا، جديدة الشوف، السمقانية، عترين، عين قني، بتلون، بشتفين،
بيت الدين، بطمة، دير بابا، دير دوريت، دير القمر، الفوارة، غريفة، الكحلونية، كفرفاقود، كفرحيم، كفرنبرخ،
معاصر بيت الدين، مزرعة الشوف، المختارة، الورهانية.
```

**After, Arabic**

```text
(the customer) 📍 (موقع بصيدا)
```
```text
📍 *لهلّق ما منوصّل على صيدا*
منوصّل بالشوف حوالي بعقلين.
إذا الطلب لمحلّ تاني، ابعت موقعو من الزر أو اكتب اسم الضيعة.
[📍 ابعت الموقع]
```

**Before, English**

```text
(the customer) 📍 (a pin in Saida)
```
```text
We don't deliver to Saida yet.
📍 We deliver to: Ainbal, Ain Wazein, Baakline, Baqaata, Jdeidet El Chouf, Semkanieh, Atrine, Ain Qeni,
Batloun, Bchetfine, Beiteddine, Botmeh, Deir Baba, Deir Dourit, Deir El Qamar, Fouara, Gharifeh, Kahlounieh,
Kfarfakoud, Kfarhim, Kfarnabrakh, Maasser Beiteddine, Mazraat El Chouf, Moukhtara, Warhanieh.
```

**After, English**

```text
(the customer) 📍 (a pin in Saida)
```
```text
📍 *We don't deliver to Saida yet*
We deliver in the Chouf, around Baakline.
If the order is for another place, send its location with the button or type the village.
[📍 Send location]
```

### A village we deliver to (`area-in`)

Yes, the fee and the time, one line each.

**Before, Arabic**

```text
✅ إيه منوصّل على بيت الدين.
🛵 التوصيل: $1.50
وبياخد عادةً حوالي 30 دقيقة.
```

**After, Arabic**

```text
✅ *إيه، منوصّل على بيت الدين*
🛵 التوصيل · $1.50
⏱️ عادةً حوالي 30 دقيقة
```

**Before, English**

```text
✅ Yes, we deliver to Beiteddine.
🛵 Delivery: $1.50
It usually takes about 30 minutes.
```

**After, English**

```text
✅ *Yes, we deliver to Beiteddine*
🛵 Delivery · $1.50
⏱️ Usually about 30 minutes
```

### Where to deliver (the location request) (`ask-pin`)

One heading and one line; WhatsApp's own Send location button.

**Before, Arabic**

```text
✅ طلبك جاهز.
📍 ابعتلنا موقعك من الزر تحت
ومنبعتلك ورقة الطلب.
[📍 Send location]
```

**After, Arabic**

```text
📍 *وين منوصّلك؟*
ابعتلنا موقعك من الزر تحت، ومنبعتلك ورقة الطلب.
[📍 ابعت الموقع]
```

**Before, English**

```text
✅ Your order is ready.
📍 Send us your location with the button below
and we'll send your order card.
[📍 Send location]
```

**After, English**

```text
📍 *Where should we deliver?*
Send your location with the button below and your order card follows.
[📍 Send location]
```

### A location outside the area (`pin-outside`)

Says what to do next: the location again, or the village typed.

**Before, Arabic**

```text
📍 هالموقع برّا المناطق يلي منوصل عليها هلّق.
إذا في غلط، ابعت الموقع من جديد من الزر.
[📍 Send location]
```

**After, Arabic**

```text
📍 *هالموقع برّا منطقتنا هلّق*
إذا في غلط، ابعت الموقع من جديد، أو اكتب اسم الضيعة.
[📍 ابعت الموقع]
```

**Before, English**

```text
📍 This location is outside the areas we deliver to now.
If that's a mistake, send the location again with the button.
[📍 Send location]
```

**After, English**

```text
📍 *This location is outside our area for now*
If that's a mistake, send the location again, or type your village.
[📍 Send location]
```

### Order confirmed (`confirmed`)

A bold heading with the code, what happens next with the time; the options list stays under it.

**Before, Arabic**

```text
✅ تأكد طلبك AK-1062
عم نحضّرو هلّق.
[☰ خيارات]
  • حطّولي أقرب بديل  —  إذا في غرض ناقص
  • اسألوني  —  إذا في غرض ناقص
  • شيلوه من الطلب  —  إذا في غرض ناقص
  • معي المبلغ مظبوط  —  الدفع كاش
```

**After, Arabic**

```text
✅ *تأكّد طلبك AK-1062*
عم نحضّرو هلّق.
⏱️ بيوصل خلال حوالي 30 دقيقة.

بدك تغيّر شي؟ اختار من *خيارات* 👇
[☰ خيارات]
  • حطّولي أقرب بديل  —  إذا في غرض ناقص
  • اسألوني  —  إذا في غرض ناقص
  • شيلوه من الطلب  —  إذا في غرض ناقص
  • معي المبلغ مظبوط  —  الدفع كاش
```

**Before, English**

```text
✅ Order AK-1062 confirmed
We're preparing it now.
[☰ Options]
  • Closest match  —  If an item is missing
  • Ask me  —  If an item is missing
  • Take it off  —  If an item is missing
  • I have the exact amount  —  Paying cash
```

**After, English**

```text
✅ *Order AK-1062 confirmed*
We're preparing it now.
⏱️ It arrives in about 30 minutes.

Want to change something? Choose from *Options* 👇
[☰ Options]
  • Closest match  —  If an item is missing
  • Ask me  —  If an item is missing
  • Take it off  —  If an item is missing
  • I have the exact amount  —  Paying cash
```

### On the way (`on-the-way`)

The rider's name is never shown; the amount to have ready when it is cash.

**Before, Arabic**

```text
🛵 طلبك AK-1062 صار عالطريق.
```

**After, Arabic**

```text
🛵 *طلبك AK-1062 عالطريق*
💵 حضّر $13.13 كاش، أو 1,175,000 ل.ل.
```

**Before, English**

```text
🛵 Your order AK-1062 is on its way.
```

**After, English**

```text
🛵 *Order AK-1062 is on its way*
💵 Please have $13.13 ready in cash, or 1,175,000 LBP.
```

### The rider at the door (`at-door`)

Short; one emoji.

**Before, Arabic**

```text
🛵 السائق واصل عندك بطلب AK-1062 وعم يستناك.
```

**After, Arabic**

```text
🛵 *الدليفري واصل لعندك*
طلبك AK-1062 عالباب، وعم يستناك.
```

**Before, English**

```text
🛵 The rider is at your door with order AK-1062 and is waiting for you.
```

**After, English**

```text
🛵 *The rider is at your door*
Order AK-1062 is here and waiting for you.
```

### Delivered, asked (`delivered`)

Delivered, and how to say if something is missing.

**Before, Arabic**

```text
📦 طلبك AK-1062: تسلّم.
إذا في شي ناقص اكتبلنا.
```

**After, Arabic**

```text
📦 *تسلّم طلبك AK-1062*
إذا في شي ناقص أو مش مزبوط، اكتبلنا هون.
```

**Before, English**

```text
📦 Order AK-1062: delivered.
If anything is missing, write to us.
```

**After, English**

```text
📦 *Order AK-1062 delivered*
If anything is missing or wrong, write to us here.
```

### Payment received (`payment`)

Today a Meta template went in Arabic inside the 24-hour window (the founder's chat, 08:45), with «9.44$ نقداً» as its amount. After: a session message in the customer's language; the template stays for outside the window only.

**Before, Arabic**

```text
[template ak_payment_received_v1, Arabic]
✅ وصلنا دفعك لطلب AK-1062:
13.13$ نقداً
```

**After, Arabic**

```text
✅ *وصلنا دفعك*
طلبك AK-1062 · $13.13 كاش
شكراً إلك 🙏
```

**Before, English**

```text
[template ak_payment_received_v1, Arabic]
✅ وصلنا دفعك لطلب AK-1062:
13.13$ نقداً
```

**After, English**

```text
✅ *Payment received*
Order AK-1062 · $13.13 in cash
Thank you 🙏
```

### Did it arrive all right? (the feedback question) (`feedback`)

Today it is Arabic only, whatever the customer's language. After: in their language, a bold question, and the two buttons with an emoji each; the thank-you in their language.

**Before, Arabic**

```text
وصلك طلبك AK-1062؟ إذا في شي ناقص أو مش مزبوط، دقّ «في مشكلة» وبيحكيك حدا من الفريق.
[وصل تمام ✅] [في مشكلة]
```
```text
(the customer) وصل تمام ✅
```
```text
تمام، شكراً 🙏
```

**After, Arabic**

```text
📦 *وصلك طلبك AK-1062 مزبوط؟*
إذا في شي ناقص أو مش مزبوط، اكبس *في مشكلة* وبيحكيك حدا من الفريق.
[✅ وصل تمام] [⚠️ في مشكلة]
```
```text
(the customer) ✅ وصل تمام
```
```text
🙏 تمام، شكراً إلك!
```

**Before, English**

```text
وصلك طلبك AK-1062؟ إذا في شي ناقص أو مش مزبوط، دقّ «في مشكلة» وبيحكيك حدا من الفريق.
[وصل تمام ✅] [في مشكلة]
```
```text
(the customer) وصل تمام ✅
```
```text
تمام، شكراً 🙏
```

**After, English**

```text
📦 *Did order AK-1062 arrive all right?*
If anything is missing or wrong, tap *A problem* and someone from the team will talk to you.
[✅ All good] [⚠️ A problem]
```
```text
(the customer) ✅ All good
```
```text
🙏 Great, thank you!
```

### The honest answer (a kind we do not carry) (`honest`)

PD1's words, with a bold heading; the request is noted.

**Before, Arabic**

```text
لسّا ما عنّا ألواح بروتين، سجّلنا طلبك.
```

**After, Arabic**

```text
🔎 *لسّا ما عنّا ألواح بروتين*
سجّلنا طلبك، ومنخبّرك إذا صار عنّا.
```

**Before, English**

```text
We don't carry protein bars yet. I've noted your request.
```

**After, English**

```text
🔎 *We don't carry protein bars yet*
I've noted your request.
```

### A word we could not find (`not-found`)

New in CX2 (fix 1): nothing asked for is dropped in silence.

**Before, Arabic**

```text
(the customer) 🎤 … وكمان بدي نص كفوف
```
```text
(nothing was said)
```

**After, Arabic**

```text
(the customer) 🎤 … وكمان بدي نص كفوف
```
```text
🔎 *ما لقيت «نص كفوف» عنّا*
إذا قصدك شي تاني، قلّي ياه بكلمات تانية.
```

**Before, English**

```text
(the customer) 🎤 … وكمان بدي نص كفوف
```
```text
(nothing was said)
```

**After, English**

```text
(the customer) 🎤 … وكمان بدي نص كفوف
```
```text
🔎 *I couldn't find “nos kfouf”*
If you meant something else, tell me in other words.
```

### What fits a fact asked (no sugar) (`honest-fits`)

Each item on one line with its amount, then the fact and its source under it.

**Before, Arabic**

```text
هيدول يلي بيناسبوا من سناكس، مع شو مكتوب على علبهن:
Crunchy Kids Rice Cakes Apple No Added Sugar 30 g
$0.85
قلّي أيّا واحد بدك وقدّيش.
```

**After, Arabic**

```text
🔎 *يلي بيناسب من السناكس*
حسب المكتوب على العلبة:

• Crunchy Kids Rice Cakes Apple 30 g · $0.85
  بلا سكر مضاف (العلبة)

قلّي أيّا واحد بدك وقدّيش.
```

**Before, English**

```text
What fits (snacks), with what the pack says:
Crunchy Kids Rice Cakes Apple No Added Sugar 30 g
$0.85
Tell me which one and how many.
```

**After, English**

```text
🔎 *What fits: snacks*
By what the pack says:

• Crunchy Kids Rice Cakes Apple 30 g · $0.85
  No added sugar (the pack)

Tell me which one and how many.
```

### The reminder (a card not confirmed after 20 minutes) (`reminder`)

Names the buttons on the card above; once per order.

**Before, Arabic**

```text
طلبك AK-1062 بعدو ناطر تأكيدك.
فيك تأكّدو أو تعدّلو من الرسالة يلي فوق.
```

**After, Arabic**

```text
🛒 *طلبك AK-1062 بعدو ناطرك*
اكبس *تأكيد الطلب* عالورقة يلي فوق لنبعتو، أو *تعديل* لتغيّر شي.
```

**Before, English**

```text
Your order AK-1062 is still waiting for your confirmation.
You can confirm or edit it from the card above.
```

**After, English**

```text
🛒 *Order AK-1062 is still waiting for you*
Tap *Confirm order* on the card above to send it, or *Edit* to change it.
```

### A card that lapsed, and reopen (`reopen`)

Why, and one button that makes a new card at today's prices.

**Before, Arabic**

```text
انلغى طلبك AK-1062: ما تأكّد الطلب بالوقت المحدد.
اكتبلنا إذا بعدك بدّك ياه.
[افتح الطلب من جديد]
```

**After, Arabic**

```text
🕘 *انلغى طلبك AK-1062*
ما تأكّد بالوقت.
اكبس *افتح الطلب* ومنبعتلك ورقة جديدة بأسعار اليوم.
[🔁 افتح الطلب]
```

**Before, English**

```text
Your order AK-1062 was cancelled: it was not confirmed in time.
Write to us if you still want it.
[Reopen order]
```

**After, English**

```text
🕘 *Order AK-1062 was cancelled*
It was not confirmed in time.
Tap *Reopen order* for a new card at today's prices.
[🔁 Reopen order]
```

### Under the minimum order (`minimum`)

The basket with amounts, then the minimum and what is left to add; the gap in bold.

**Before, Arabic**

```text
🛒 طلبك أقل من الحد الأدنى.
بسلّتك:
• 1 × النجار قهوة كلاسيك عادية 180 غ
الحد الأدنى للطلب: $5.00
طلبك هلّق: $3.25
ناقصك: $1.75
زيد شي، أو اختار من تحت:
[إلغاء الطلب]
```

**After, Arabic**

```text
🛒 *طلبك أقل من الحد الأدنى*
• 1 × النجار قهوة كلاسيك عادية 180 غ · $3.25

الحد الأدنى · $5.00
*ناقصك · $1.75*

زيد شي، أو اختار من تحت 👇
[❌ إلغاء الطلب]
```

**Before, English**

```text
🛒 Your order is under the minimum.
In your basket:
• 1 × Najjar Classic coffee 180 g
Minimum order: $5.00
Your basket now: $3.25
Still to add: $1.75
Add something, or choose below:
[Cancel order]
```

**After, English**

```text
🛒 *Your order is under the minimum*
• 1 × Najjar Classic coffee 180 g · $3.25

Minimum order · $5.00
*Still to add · $1.75*

Add something, or choose below 👇
[❌ Cancel the order]
```

### When to deliver (the times) (`windows`)

A list message as today; a bold question and the button «Choose a time».

**Before, Arabic**

```text
أيمتى بدك ياه؟ هيدي الأوقات يلي فينا نوصّل فيها:
[☰ اختار الوقت]
  • هلّق (أقرب وقت)
  • بكرا 10:00-12:00
  • الجمعة 20/11  —  10:00-12:00
```

**After, Arabic**

```text
🕘 *أيمتى بدك ياه؟*
هيدي الأوقات يلي فينا نوصّل فيها 👇
[☰ اختار وقت]
  • هلّق (أقرب وقت)
  • بكرا 10:00-12:00
  • الجمعة 20/11  —  10:00-12:00
```

**Before, English**

```text
When would you like it? These are the times we can deliver:
[☰ Choose a time]
  • Now (soonest)
  • Tomorrow 10:00-12:00
  • Friday 20/11  —  10:00-12:00
```

**After, English**

```text
🕘 *When would you like it?*
These are the times we can deliver 👇
[☰ Choose a time]
  • Now (soonest)
  • Tomorrow 10:00-12:00
  • Friday 20/11  —  10:00-12:00
```

### A person will answer (a case opened) (`person`)

Says who and when; ordering goes on.

**Before, Arabic**

```text
وصلت رسالتك لحدا من الفريق، رح يردّ عليك خلال دقايق.
بهالوقت فيك تكمّل طلبك معي عادي.
```

**After, Arabic**

```text
💬 *وصلت رسالتك لحدا من الفريق*
رح يردّ عليك خلال دقايق.
بهالوقت فيك تكمّل طلبك معي عادي.
```

**Before, English**

```text
✅ A person from our team will answer you within minutes.
Meanwhile you can keep ordering with me as usual.
```

**After, English**

```text
💬 *A person from our team has your message*
They will answer you within minutes.
Meanwhile you can keep ordering with me as usual.
```

## Every other customer message

Today's words (English; the Arabic is in `packages/agents/test/__snapshots__/messages.ar.md` under the same key). In stage 2 each gets the rules above: a bold heading line where it is more than one line, its emoji from the set, amounts after « · », buttons with an emoji; the words stay unless the founder changes them here.

| Key | Today (English) |
|---|---|
| `card.heading` | 🛒 *Your order AK-1042* |
| `card.item` | 2 × Tannourine water 2 L (pack of 6) (بلا ملح) |
| `card.more` | … and 3 more items |
| `card.delivery` | Delivery (Baakline): $1.00 |
| `card.smallOrder` | Small-order fee: $0.50 |
| `card.dues` | Owed from an earlier order we could not deliver: $1.50 |
| `card.credit` | Your credit from before: -$1.25 |
| `card.total` | *Total: $7.27* |
| `card.orLbp` | or 651,000 LBP |
| `card.address` | 📍 Baakline |
| `card.eta` | Arrives in about 30 minutes |
| `card.deliverNow` | Delivery |
| `card.payment` | 💵 Payment: cash on delivery |
| `card.payName.cod` | cash on delivery |
| `card.payName.whish` | Whish transfer |
| `card.payName.omt` | OMT transfer |
| `card.changeFor` | We'll bring change for a note of: |
| `card.changeForLbp` | You pay in lira, with: ⏎ 2,000,000 LBP |
| `card.prepayFirst` | A first order is paid in cash up to: ⏎ $50.00 ⏎ This order is larger, so it is paid in advance (Whish transfer) before we prepare it. ⏎ We'll send the details a… |
| `card.prepay` | There is an amount owed from before, so this order is paid in advance (Whish transfer) before we prepare it. ⏎ We'll send the details after you confirm. |
| `card.replaces` | 🛒 *Your order AK-1042* ⏎  ⏎ 1 × Tannourine water 2 L (pack of 6) ⏎ $2.01 ⏎ 1 × Al Forno white bread, large 800 g ⏎ $1.01 ⏎ 1 × Najjar Classic coffee 180 g ⏎ $3… |
| `card.reopenedFrom` | Reopened from AK-1040, at today's prices. |
| `card.consent` | By confirming, you agree that we send updates about your orders in this chat. |
| `card.confirm` | Confirm order |
| `card.edit` | Edit |
| `card.cancel` | Cancel |
| `card.change` | 🛒 *Your order AK-1042* ⏎  ⏎ 1 × Tannourine water 2 L (pack of 6) ⏎ $2.01 ⏎ 1 × Al Forno white bread, large 800 g ⏎ $1.01 ⏎ 1 × Najjar Classic coffee 180 g ⏎ $3… |
| `card.windowFar` | 🛒 *Your order AK-1042* ⏎  ⏎ 1 × Tannourine water 2 L (pack of 6) ⏎ $2.01 ⏎ 1 × Al Forno white bread, large 800 g ⏎ $1.01 ⏎ 1 × Najjar Classic coffee 180 g ⏎ $3… |
| `card.firstOrder` | 🛒 *Your order AK-1042* ⏎  ⏎ 1 × Tannourine water 2 L (pack of 6) ⏎ $2.01 ⏎ 1 × Al Forno white bread, large 800 g ⏎ $1.01 ⏎ 1 × Najjar Classic coffee 180 g ⏎ $3… |
| `card.noAddress` | 🛒 *Your order AK-1042* ⏎  ⏎ 1 × Tannourine water 2 L (pack of 6) ⏎ $2.01 ⏎ 1 × Al Forno white bread, large 800 g ⏎ $1.01 ⏎ 1 × Najjar Classic coffee 180 g ⏎ $3… |
| `tap.confirmedFor` | ✅ Order AK-1042 confirmed ⏎ Delivery Tomorrow 10:00-12:00. |
| `tap.replaced` | ✅ Changed: your order AK-1042 replaces AK-1040 ⏎ Delivery Tomorrow 10:00-12:00. |
| `tap.awaitingPayment` | ✅ Order AK-1042 is booked for delivery Tomorrow 10:00-12:00. ⏎  ⏎ 💵 Transfer by Whish to 70123456: ⏎ $7.27 ⏎  ⏎ Then send a photo of the receipt here and we'll… |
| `tap.channel` | OMT |
| `tap.draft` | Sure, what would you like to change in order AK-1042? |
| `tap.cancelled` | Order AK-1042 is cancelled. |
| `tap.cancelledCredit` | Order AK-1042 is cancelled. ⏎  ⏎ What you paid is now your credit: ⏎ $7.27 ⏎ We'll refund it or take it off your next order. |
| `tap.slotFull` | ⚠️ The time you chose (Tomorrow 10:00-12:00) filled up before you confirmed. ⏎ Order AK-1042 is not booked: choose another time or write to us. |
| `tap.slotClosed` | ⚠️ We can no longer deliver at that time: the ordering cut-off has passed. ⏎ Order AK-1042 is not booked: choose another time or write to us. |
| `tap.changeOpen` | Sure, what would you like to change in order AK-1042 (Tomorrow 10:00-12:00)? ⏎ We'll send a new card, and nothing changes until you confirm it. |
| `tap.tooLate` | It is too late to change or cancel order AK-1042 (Tomorrow 10:00-12:00) here. ⏎ If it's urgent, write to us and we'll see. |
| `tap.inProgress` | Order AK-1042 is already being handled, so it can't be changed here. ⏎ If it's urgent, write to us. |
| `tap.needsLocation` | Before we confirm, send us your location 📍 ⏎ or type the full address. |
| `buttonReply.confirmed` | ✅ Order AK-1042 confirmed ⏎ We're preparing it now. |
| `buttonReply.awaiting_payment` | ✅ Order AK-1042 is booked for delivery Tomorrow 10:00-12:00. ⏎  ⏎ 💵 Transfer by OMT to 70123456: ⏎ $7.27 ⏎  ⏎ Then send a photo of the receipt here and we'll s… |
| `buttonReply.draft` | Sure, what would you like to change in order AK-1042? |
| `buttonReply.cancelled` | Order AK-1042 is cancelled. ⏎  ⏎ What you paid is now your credit: ⏎ $3.00 ⏎ We'll refund it or take it off your next order. |
| `buttonReply.slot_full` | ⚠️ The time you chose (Tomorrow 10:00-12:00) filled up before you confirmed. ⏎ Order AK-1042 is not booked: choose another time or write to us. |
| `buttonReply.slot_closed` | ⚠️ We can no longer deliver Tomorrow 10:00-12:00: the ordering cut-off has passed. ⏎ Order AK-1042 is not booked: choose another time or write to us. |
| `buttonReply.change_open` | Sure, what would you like to change in order AK-1042 (Tomorrow 10:00-12:00)? ⏎ We'll send a new card, and nothing changes until you confirm it. |
| `buttonReply.too_late` | It is too late to change or cancel order AK-1042 (Tomorrow 10:00-12:00) here. ⏎ If it's urgent, write to us and we'll see. |
| `buttonReply.preparing` | Order AK-1042 is already being handled, so it can't be changed here. ⏎ If it's urgent, write to us. |
| `fixed.audioUnusable` | I couldn't hear the recording well. ⏎ Could you send it again or type your order? |
| `fixed.handoff` | Someone from our team will contact you shortly. |
| `fixed.optOut` | Done. We won't send you messages anymore. ⏎ If you want to order, just write to us. |
| `fixed.optIn` | Offers are turned on. Thank you! |
| `fixed.outOfStock` | ⚠️ Sorry, an item ran out before we could confirm the order. ⏎ Tell me what you'd like instead, or remove it. |
| `fixed.error` | Something went wrong on our side. ⏎ Someone from the team will contact you. |
| `fixed.oneMoment` | One moment, I'll be right back. |
| `fixed.offTopic` | I'm here only for Alo King orders: items, delivery, and where your order is. ⏎ What would you like to order? |
| `fixed.askPhone` | Before we send your order card: ⏎ which phone number can the rider call you on? |
| `fixed.badPhone` | I couldn't read the number. ⏎ Could you send it like this: 03123456 or +9613123456? |
| `fixed.phoneSaved` | Got it, we saved the number. What would you like to order? |
| `fixed.askAddress` | For the rider, we just need: ⏎ 🏠 the building name or nearest landmark ⏎ 🔢 the floor |
| `fixed.askVillage` | 📍 The location you sent is between several villages. Where exactly? |
| `fixed.fxPaused` | We're updating the exchange rate right now, so we can't price the order this minute. ⏎ Your order is saved: send us "ok" in a little while and we'll send the ca… |
| `fixed.pinVillageRefused` | We couldn't use that village for this location. ⏎ Send the location again with the button 📍 |
| `fixed.keptButton` | Send my order |
| `fixed.keptGone` | There is no saved order now. What would you like to order? |
| `fixed.askVillageLandmark` | 📍 No problem without a pin. ⏎ Write your village and the nearest landmark to your home (a mosque, church, school, bakery). |
| `fixed.noPinNote` | No map pin: the rider must call the customer before leaving |
| `fixed.welcome` | You're welcome. If you need anything, write to me here. |
| `fixed.noPinCall` | 📍 OK, we deliver to بعقلين without a pin. ⏎ The rider will call you before leaving, to check the address. |
| `fixed.notAvailable` | سناك أبو علي is not on Alo King yet, so we can't take an order from it now. |
| `fixed.notAvailable.none` | This shop is not on Alo King yet, so we can't take an order from it now. |
| `fixed.listingClaimed` | We got your message about مخبز الشوف. ⏎ Someone from our team will get in touch with you here on WhatsApp. ⏎ Until then nothing changes on the page. |
| `fixed.pinReceived` | ✅ We got your location: بعقلين |
| `fixed.pinReceivedThenAddress` | ✅ We got your location: بعقلين ⏎  ⏎ For the rider, we just need: ⏎ 🏠 the building name or nearest landmark ⏎ 🔢 the floor |
| `fixed.pinVillage` | 📍 The location you sent is in الخريبة, not بعقلين. ⏎ So the delivery is to الخريبة. |
| `fixed.pinSaved` | ✅ We saved your location (بعقلين). ⏎ What would you like to order? |
| `fixed.closedKeptPin` | 📍 We got your location. ⏎ 🌙 But we're closed now and open at 08:00. ⏎  ⏎ Your order is saved: when we open, tap "Send my order" and we'll carry on. ⏎ • 2 × Ta… |
| `fixed.priced` | Tannourine water 2 L (pack of 6) ⏎ $2.01 ⏎ Najjar Classic coffee 180 g (not available now) ⏎ $3.25 |
| `windows.choose` | When would you like it? These are the times we can deliver: |
| `windows.button` | Choose a time |
| `windows.now` | Now (soonest) |
| `windows.none` | There are no free delivery times in the coming days. ⏎ You can order for now, or write to us and we'll see. |
| `windows.gone` | ⚠️ The time you chose is no longer available. ⏎ These are the times we can deliver: |
| `windows.noneAt` | There is no free delivery time like the one you asked for. ⏎ These are the times we can deliver: |
| `windows.noneAtAll` | There are no scheduled delivery times in the coming days. |
| `windows.nowUnavailable` | We can't deliver this order now. Choose a delivery time: |
| `windows.orChoose` | Or choose a delivery time here: |
| `windows.pickupNoWindow` | Pickup from the shop has no set time: come by during opening hours. |
| `windows.restaurantNoWindow` | Restaurant orders have no set time for now: they arrive when ready. |
| `windows.freshForWindow` | We buy Al Forno white bread, large 800 g fresh for your order, so it comes at a set time. ⏎ Choose the time: |
| `windows.notChangeable` | Order AK-1042 is confirmed and its time can't be changed here. ⏎ If it's urgent, write to us. |
| `status.awaiting_confirmation` | Order AK-1042: waiting for your confirmation. ⏎ Tap "Confirm order" on the card to start. |
| `status.awaiting_payment` | Order AK-1042: waiting for the payment. ⏎ 💵 Amount: ⏎ $7.27 ⏎ Send a photo of the receipt here. |
| `status.confirmed` | 📦 Order AK-1042: we're preparing it. ⏎ Expected arrival in about 20 minutes. |
| `status.ready` | 📦 Order AK-1042: ready and waiting for the rider. |
| `status.out_for_delivery` | 🛵 Order AK-1042 is on its way to you. ⏎ About 20 minutes. |
| `status.arrived` | 🛵 Order AK-1042: the rider is at your door. |
| `status.failed_delivery` | Order AK-1042: we couldn't deliver it. ⏎ Someone from the team will contact you. |
| `status.other` | Order AK-1042: in progress. ⏎ If it's urgent, write to us. |
| `status.scheduled.awaiting_confirmation` | Order AK-1042: waiting for your confirmation, for delivery Tomorrow 10:00-12:00. ⏎ Tap "Confirm order" on the card to start. |
| `status.scheduled.awaiting_payment` | Order AK-1042: booked for delivery Tomorrow 10:00-12:00, waiting for the payment. ⏎ 💵 Amount: ⏎ $7.27 ⏎ Send a photo of the receipt here. |
| `status.scheduled.confirmed` | ✅ Order AK-1042: confirmed, delivery Tomorrow 10:00-12:00. |
| `status.scheduled.preparing` | 📦 Order AK-1042: we're preparing it for delivery Tomorrow 10:00-12:00. |
| `status.ready.pickup` | 📦 Order AK-1042: ready, you can come and pick it up. |
| `answer.noOpenOrder` | You have no open order now. What would you like to order? |
| `answer.noOpenRepeat` | You have no open order now. ⏎ Tap below and we'll prepare the same order as last time at today's prices: ⏎ Tannourine water 2 L (pack of 6), Al Forno white brea… |
| `answer.awaitingConfirmation` | Order AK-1042: waiting for your confirmation. ⏎ Tap "Confirm order" on the card to start. |
| `answer.awaitingPayment` | Order AK-1042: booked for delivery Tomorrow 10:00-12:00, waiting for the payment. ⏎ 💵 Amount: ⏎ $7.27 ⏎ Send a photo of the receipt here. |
| `answer.confirmedFor` | ✅ Order AK-1042: confirmed, delivery Tomorrow 10:00-12:00. |
| `answer.preparingFor` | 📦 Order AK-1042: we're preparing it for delivery Tomorrow 10:00-12:00. |
| `answer.preparing` | 📦 Order AK-1042: we're preparing it. ⏎ Expected arrival in about 20 minutes. |
| `answer.ready` | 📦 Order AK-1042: ready and waiting for the rider. |
| `answer.onTheWay` | 🛵 Order AK-1042 is on its way to you. ⏎ About 10 minutes. |
| `answer.arrived` | 🛵 Order AK-1042: the rider is at your door. |
| `answer.delivered` | 📦 Order AK-1042: delivered. ⏎ If anything is missing, write to us. |
| `answer.failed` | Order AK-1042: we couldn't deliver it. ⏎ Someone from the team will contact you. |
| `answer.other` | Order AK-1042: in progress. ⏎ If it's urgent, write to us. |
| `answer.noPrevious` | I didn't find a completed earlier order. What would you like to order? |
| `answer.allMissing` | The items of your last order are not available now: ⏎ • Tannourine water 2 L (pack of 6) ⏎ • Al Forno white bread, large 800 g ⏎ • Najjar Classic coffee 180 g ⏎… |
| `answer.repeatOffer` | Welcome to Alo King 👑 ⏎ What would you like today? ⏎  ⏎ Or tap below and we'll prepare the same order as last time at today's prices: ⏎ Tannourine water 2 L (p… |
| `answer.repeatButton` | Same as last time |
| `answer.stale` | Prices or availability changed since we sent the card. ⏎ Here is a new card at today's prices. |
| `answer.someMissing` | From your last order these are not available now: ⏎ • Najjar Classic coffee 180 g ⏎ We put the rest on the card. |
| `answer.lira` | 💵 Today's exchange rate, for one dollar: ⏎ 89,500 LBP ⏎  ⏎ Order AK-1042: ⏎ $7.27 ⏎ In lira: ⏎ 651,000 LBP |
| `answer.lira.noOrder` | 💵 Today's exchange rate, for one dollar: ⏎ 89,500 LBP |
| `answer.noRate` | We have no confirmed exchange rate right now. ⏎ You can pay in dollars, or ask us again shortly. |
| `basket.minimumIs` | 🛒 Minimum order: $5.00 ⏎ What would you like to order? |
| `basket.houseDefault` | "ربطة خبز": we put Tannourine water 2 L (pack of 6). ⏎ If you want another one, tell me. |
| `basket.cancelButton` | Cancel order |
| `basket.cleared` | OK, nothing will be sent and your basket is empty. ⏎ Write to me whenever you want to order. |
| `basket.soFar` | 🛒 Your order is not sent yet. In your basket: ⏎ • 1 × Tannourine water 2 L (pack of 6) ⏎ • 2 × Al Forno white bread, large 800 g ⏎ • 3 × Najjar Classic coffee  |
| `basket.changed` | ✅ Your order is updated: ⏎ + 2 × Tannourine water 2 L (pack of 6) ⏎ − Al Forno white bread, large 800 g ⏎ Najjar Classic coffee 180 g: 1 → 3 |
| `basket.unavailable` | ⚠️ Not available now: ⏎ • Najjar Classic coffee 180 g ⏎ Tell me what you'd like instead, or remove it. |
| `basket.comingSoon` | Coming soon, we can't take it yet: ⏎ • Najjar Classic coffee 180 g ⏎ Tell me what you'd like instead, or remove it. |
| `basket.cancelRefused` | Order AK-1042 is already being prepared, so it can't be cancelled from here. ⏎ A person from our team will call you about it. |
| `payment.proofReceived` | ✅ We received the payment photo for order AK-1042, thank you. ⏎ Someone from our team is checking it and will get back to you. |
| `payment.proofResend` | We couldn't open the picture. ⏎ Could you send the receipt photo again? |
| `web.linked` | ✅ Your number is confirmed. ⏎ Go back to the website to finish your order. |
| `web.codeExpired` | This code has expired. ⏎ Go back to the website and tap "Confirm your number on WhatsApp" again. |
| `web.codeUsed` | Another number already used this code. ⏎ Go back to the website for a new one. |
| `web.codeUnknown` | We don't know this code. ⏎ Go back to the website and tap "Confirm your number on WhatsApp" again. |
| `web.notSignedIn` | No device is signed in to the website with your number. |
| `web.cardUnknown` | We found no order of yours with that number. ⏎ Tell me what you need and we'll help. |
| `web.signedOut.one` | ✅ You are signed out of the website. ⏎ Your orders and this chat stay as they are. |
| `web.signedOut.many` | ✅ You are signed out of the website on every device. ⏎ Your orders and this chat stay as they are. |
| `web.cardNotWaiting` | Order AK-1042 is no longer waiting for your Confirm. ⏎ Ask me here if you want to know where it is. |
| `honest.notFound.two` | I couldn't find “نص كفة” or “cafe mate” in our shop. If you meant something else, tell me in other words. |
| `honest.notCarried.two` | We don't carry protein bars and dates yet. I've noted your request. |
| `honest.cannotConfirm` | I can't confirm the sugar for our snacks yet. |
| `honest.fact.sugar` | I can't confirm the sugar for our snacks yet. |
| `honest.fact.protein` | I can't confirm the protein for our snacks yet. |
| `honest.fact.gluten` | I can't confirm gluten-free for our snacks yet. |
| `honest.fact.lactose` | I can't confirm lactose-free for our snacks yet. |
| `honest.fact.fat` | I can't confirm the fat for our snacks yet. |
| `honest.fact.salt` | I can't confirm the salt for our snacks yet. |
| `honest.fact.fragrance` | I can't confirm fragrance-free for our snacks yet. |
| `honest.named` | Items with “Zero Sugar” or “No Sugar” in their name: ⏎ Lipton Ice Tea Tropical Zero Sugar 320Ml ⏎ $0.69 ⏎ Tell me if you want one of these, or something else. |
| `honest.closeItems` | Tell me if you want one of these, or something else. |
| `honest.closeNone` | Tell me what else you need. |
| `honest.noneFits` | None of our juice fits that, by what their packs say. |
| `honest.closeFits` | Tell me which one and how many. |
| `remember.offer` | I've put “no sugar” on your order; the kitchen must confirm it. ⏎ Shall we remember it for your next orders? |
| `remember.offer.noOrder` | Noted: “no sugar”; the kitchen must confirm it on each order. ⏎ Shall we remember it for your next orders? |
| `remember.offer.long` | Noted: “no peanuts, no sesame, no milk in anything”; the kitchen must confirm it on each order. ⏎ Shall we remember it for your next orders? |
| `remember.yes` | Yes, remember it |
| `remember.no` | Just this time |
| `remember.kept` | Done: we'll remember it and put it on every order. Say “forget me” any time. |
| `remember.notKept` | OK, just for this order. |
| `built.dish` | Mjadra for 6: everything it needs, by the quantity per person. |
| `built.lunchbox` | Lunchbox snacks: 10 in all, a few different ones. |
| `built.budget` | A basket for your budget (items only, delivery apart). ⏎ Budget: $20.00 |
| `built.missing` | Not included: burghul (we can't add it now). |
| `built.overBudget` | This comes to more than your budget; tell me what to take out. ⏎ Budget: $15.00 |
| `built.tooMany` | I can build a basket for up to 50 people. Tell me what you need and I'll add it. |
| `built.none` | I couldn't build this basket from what we have now. Tell me what you need and I'll add it. |
| `cx.welcome.noHours` | 👑 Welcome to Alo King! ⏎ We bring home groceries to your door in the Chouf. Tell me what you need, in writing or by voice note. ⏎ By writing to us you agree th… |
| `cx.privacy` | By writing to us you agree that we keep your messages and orders only to serve them. Write STOP at any time. |
| `cx.orderButton` | Order |
| `cx.areaButton` | Do you deliver here? |
| `cx.orderAsk` | Go ahead: tell me what you need, or send a voice note. |
| `cx.areaAsk` | 📍 Send your location with the button below, or type your village, and we'll tell you if we deliver there. |
| `cx.keepLine` | Your change stays with us as credit. |
| `cx.choicesButton` | Options |
| `cx.choicesMissing` | If an item is missing |
| `cx.choicesNote` | Paying cash |
| `cx.choicesOrder` | The order |
| `cx.exactRow` | I have the exact amount |
| `cx.keepRow` | Keep change as credit |
| `cx.cancelRow` | Cancel the order |
| `cx.exactSet` | ✅ Done: you'll pay the exact amount. |
| `cx.needsNote` | First choose the note you'll pay with. |
| `cx.cancelYes` | Yes, cancel it |
| `cx.pickupOff` | Pickup isn't available yet, so we'll deliver to your home. |
| `cx.missingLine.best_match` | If an item is missing: we put the closest match |
| `cx.missingItemLine.best_match` | Labneh 500 g: we put the closest match |
| `cx.missingRow.best_match` | Closest match |
| `cx.missingSet.best_match` | ✅ Done: if an item is missing, we put the closest match. |
| `cx.missingLine.ask` | If an item is missing: we ask you |
| `cx.missingItemLine.ask` | Labneh 500 g: we ask you |
| `cx.missingRow.ask` | Ask me |
| `cx.missingSet.ask` | ✅ Done: if an item is missing, we ask you before swapping. |
| `cx.missingLine.remove` | If an item is missing: we take it off |
| `cx.missingItemLine.remove` | Labneh 500 g: we take it off |
| `cx.missingRow.remove` | Take it off |
| `cx.missingSet.remove` | ✅ Done: if an item is missing, we take it off the order. |
| `cx.noteRow` | I'll pay with $20.00 |
| `cx.noteSet` | ✅ Done, we'll bring change for $20.00 ⏎ Your change: $12.73 |
| `cx.keepSet` | ✅ Done, no change will be given back. ⏎ It becomes your credit once paid: $12.73 |
| `cx.noteTooSmall` | That note is less than the total: $7.27 |
| `cx.choiceTooLate` | We've started preparing order AK-1042, so this can't change any more. |
| `cx.cancelAsk` | Cancel order AK-1042? We haven't started preparing it. |
| `cx.cancelAsk.credit` | Cancel order AK-1042? We haven't started preparing it. ⏎ What you paid comes back as credit: $7.27 |
| `cx.cancelAfterPick` | We've started preparing order AK-1042, so it can't be cancelled from here. ⏎ If we cancel it, your credit back: $5.27 ⏎ A person from our team will talk to you  |
| `cx.cancelAfterPick.kept` | We've started preparing order AK-1042, so it can't be cancelled from here. ⏎ If we cancel it, your credit back: $5.27 ⏎ Can't go back on the shelf: Tannourine w… |
| `cx.cancelAfterPickCash` | We've started preparing order AK-1042, so it can't be cancelled from here. ⏎ You haven't paid anything. A person from our team will talk to you now. |
| `cx.cancelOnTheWay` | 🛵 Order AK-1042 is on its way, so it can't be cancelled from here. ⏎ A person from our team will talk to you now. |
| `cx.handoverCode` | 🔢 Your handover code: 4821 ⏎ Give it to the rider only when you have your order. |
| `cx.handoverCodePickup` | 🔢 Your handover code: 4821 ⏎ Give it to our hub staff only when you take your order. |
| `cx.reopenButton` | Reopen order |
| `cx.pickupAt` | 🏠 Pickup at the Alo King hub, Baakline, no delivery fee |
| `cx.pickupReady` | 📦 Order AK-1042 is ready for pickup at the Alo King hub, Baakline. ⏎ Bring your handover code. |
| `support.reminder` | Your request is open; a person from our team will answer you. |
| `support.stillOnIt` | We are still on it; a person from our team will answer you. ⏎ Keep ordering, get a call back, or leave a voice note? |
| `support.resumed` | I'm back with you. Your request is still open and a person will answer you. ⏎ How can I help now? |
| `support.resolved` | ✅ Your request is closed. If you need anything else, write to us here. |
| `support.callbackButton` | Call me back |
| `support.keepOrderingButton` | Keep ordering |
| `support.voiceNoteButton` | Voice note |
| `support.callbackNoted` | Noted: a person from our team will call you on this number. |
| `support.keepOrdering` | Go ahead: what would you like to order? |
| `support.voiceNoteAsk` | Send your voice note here; the person handling your request will listen to it. |
| `support.technical` | ⚠️ A short technical problem on our side. ⏎ Send your message again in a minute. |
| `support.capMenu` | We reached this hour's message limit. ⏎ Choose below: |
| `support.stalled` | Sorry, I did not get that. ⏎ What would you like to do? |
| `support.browseButton` | Browse |
| `support.myOrderButton` | My order |
| `support.personButton` | Talk to a person |
| `support.buttonError` | ⚠️ That tap did not go through on our side. ⏎ Please try again. |
| `support.retryButton` | Try again |
| `support.notOnRecord` | This is not confirmed in our records, so we cannot say it suits you. ⏎ Would you like to choose something else? |
| `support.browseInWords` | Tell me what you need and I will look for it. |
| `support.afterHours` | 🌙 We are closed now and open at 08:00. ⏎ Your request is recorded; a person will answer you when we open. ⏎ You can order now and we keep it until we open. |
| `support.draft.person_requested` | Hello, this is the Alo King team about your order AK-1042. ⏎ How can we help you? |
| `support.draft.order_problem` | Hello, this is the Alo King team about your order AK-1042. ⏎ We are sorry for the trouble. What happened exactly? |
| `support.draft.complaint` | Hello, this is the Alo King team about your order AK-1042. ⏎ We are sorry for the trouble. What happened exactly? |
| `support.draft.refund` | Hello, this is the Alo King team about your order AK-1042. ⏎ We have your request; we will check it and get back to you with the answer. |
| `support.draft.payment` | Hello, this is the Alo King team about the payment for order AK-1042. ⏎ We are checking it now. |
| `support.draft.safety` | Hello, this is the Alo King team about your order AK-1042. ⏎ We have your message and are on it now. What happened? |
| `support.draft.other` | Hello, this is the Alo King team about your order AK-1042. ⏎ How can we help you? |
| `notice.riderWaiting` | 🛵 The rider is at your door with order AK-1042 and is waiting for you. |
| `notice.delayed` | ⚠️ Your order AK-1042 will be a little late because of an emergency with the rider. ⏎ Another rider will bring it. |
| `notice.calledOff` | ⚠️ We couldn't finish delivering your order AK-1042 because of an emergency with the rider. ⏎ Someone from our team will contact you. |
| `notice.calledOff.credit` | ⚠️ We couldn't finish delivering your order AK-1042 because of an emergency with the rider. ⏎ Someone from our team will contact you. ⏎  ⏎ What you paid is your… |
| `shelf.ready` | 📦 Your order AK-1042 is ready. |
| `shelf.notFound` | We didn't find these, so we took them off the order: ⏎ • 1 × Najjar Classic coffee 180 g |
| `shelf.swapped` | Instead of Najjar Classic coffee 180 g: 1 × Najjar Cardamom 180 g, as you agreed. ⏎ $3.49 |
| `shelf.newTotal` | *New total: $7.51* ⏎ or 672,000 LBP |
| `shelf.credit` | What you paid extra is yours: ⏎ $1.25 ⏎ We'll refund it or take it off your next order, as you prefer. |
| `shelf.summary` | 1 × Najjar Classic coffee 180 g not found and removed, Wooden Bakery 800 g instead of Al Forno white bread, large 800 g |
| `shelf.message` | 📦 Your order AK-1042 is ready. ⏎ We didn't find these, so we took them off the order: ⏎ • 1 × Najjar Classic coffee 180 g ⏎ Instead of Al Forno white bread, la… |
| `shelf.template` | AK-1042 ⏎ 1 × Najjar Classic coffee 180 g not found and removed, Wooden Bakery 800 g instead of Al Forno white bread, large 800 g ⏎ $7.51 |
| `sub.question` | ⚠️ Order AK-1042: we didn't find 1 × Najjar Classic coffee 180 g ⏎ $3.25 ⏎  ⏎ We have 1 × Najjar Cardamom 180 g instead ⏎ $3.49 ⏎ More expensive by: ⏎ $0.24 ⏎  … |
| `sub.question.cheaper` | ⚠️ Order AK-1042: we didn't find 1 × Najjar Classic coffee 180 g ⏎ $3.25 ⏎  ⏎ We have 1 × Najjar Cardamom instead ⏎ $3.00 ⏎ Cheaper by: ⏎ $0.25 ⏎  ⏎ Shall we ta… |
| `sub.question.same` | ⚠️ Order AK-1042: we didn't find 1 × Najjar Classic coffee 180 g ⏎ $3.25 ⏎  ⏎ We have 1 × Najjar Cardamom instead ⏎ $3.25 ⏎ Same price. ⏎  ⏎ Shall we take it? I… |
| `sub.keep` | Keep it ✅ |
| `sub.remove` | Remove it |
| `sub.kept` | ✅ We put the substitute in order AK-1042. ⏎ *Total now: $7.51* |
| `sub.removed` | ✅ We removed it from order AK-1042. ⏎ *Total now: $4.02* |
| `sub.late` | The time to answer ran out, so we removed the item from order AK-1042. ⏎ *Total now: $4.02* |
| `sub.message` | ⚠️ Order AK-1042: we didn't find 1 × Najjar Classic coffee 180 g ⏎ $3.25 ⏎  ⏎ We have 1 × Najjar Cardamom 180 g instead ⏎ $3.49 ⏎ More expensive by: ⏎ $0.24 ⏎  … |
| `sub.template` | AK-1042 ⏎ 1 × Najjar Classic coffee 180 g ⏎ 1 × Najjar Cardamom 180 g ⏎ $3.49 ⏎ 5 |
