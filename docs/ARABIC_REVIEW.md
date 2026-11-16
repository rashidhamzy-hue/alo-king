# Arabic for a person to read

Every customer-facing Arabic line added since the last human read, with its English, for a native Lebanese speaker to check before
the friends' test (gate A). Written by models; not yet read by a person. A line the reader changes is changed in
`packages/agents/src/messages/ar.ts` (the test `packages/agents/test/arabic-review.test.ts` checks this file lists every line, so
update both together). Mark each row read with the reader's initials in the last column. The HO1 and B1a rows were read and approved by the founder on
15 November 2026 ("RA 15 Nov"); the changes approved are applied in `ar.ts` and in the rows below (session B1b).

What to check: natural Lebanese Arabic as a shop would write it on WhatsApp; nothing promised that the system does not do; no
rating, praise, health or diet word (invariants 14-15); short.

## HO1, the never-stranded hand-off (15 November 2026)

Source: `messages(...).support` in `packages/agents/src/messages/ar.ts`. When each is sent: `docs/strategy/05-console-website-design-handoff.md` section D.

| Key | Arabic | English | Read by |
|---|---|---|---|
| `opened` | وصلت رسالتك لحدا من الفريق، رح يردّ عليك خلال دقايق.<br>بهالوقت فيك تكمّل طلبك معي عادي. | Your message reached a person from our team, who will answer you within minutes.<br>Meanwhile you can keep ordering with me as usual. | RA 15 Nov |
| `reminder` | رسالتك عند الفريق، وحدا رح يردّ عليك. | Your message is with the team, and a person will answer you. | RA 15 Nov |
| `stillOnIt` | بعدنا عم نتابع رسالتك، وحدا من الفريق رح يردّ عليك.<br>بتكمّل الطلب، منتصل فيك، أو بتبعت رسالة صوتية؟ | We are still following up your message; a person from our team will answer you.<br>Keep ordering, get a call back, or leave a voice note? | RA 15 Nov |
| `resumed` | رجعت معك. رسالتك بعدها عند الفريق ورح يردّوا عليك.<br>شو فيني ساعدك هلّق؟ | I'm back with you. Your message is still with the team and they will answer you.<br>How can I help now? | RA 15 Nov |
| `afterHours("08:00")` | 🌙 هلّق مسكّرين، منفتح الساعة 08:00.<br>سجّلنا طلبك، وحدا من الفريق بيجاوبك أول ما نفتح.<br>فيك تطلب هلّق ومنحفظلك الطلب لوقت ما نفتح. | 🌙 We are closed now and open at 08:00.<br>Your request is recorded; a person will answer you when we open.<br>You can order now and we keep it until we open. | RA 15 Nov |
| `resolved` | ✅ خلّصنا موضوعك. إذا بدك شي تاني، اكتبلنا هون. | ✅ We have settled your matter. If you need anything else, write to us here. | RA 15 Nov |
| `callbackButton` | اتصلوا فيي | Call me back | RA 15 Nov |
| `keepOrderingButton` | كمّل الطلب | Keep ordering | RA 15 Nov |
| `voiceNoteButton` | رسالة صوتية | Voice note | RA 15 Nov |
| `callbackNoted` | تمام، حدا من الفريق رح يتصل فيك على هالرقم. | Noted: a person from our team will call you on this number. | RA 15 Nov |
| `keepOrdering` | تفضّل، شو بتحب تطلب؟ | Go ahead: what would you like to order? | RA 15 Nov |
| `voiceNoteAsk` | ابعت رسالتك الصوتية هون، ويلّي عم يتابعك من الفريق رح يسمعها. | Send your voice note here; the person on the team following you will listen to it. | RA 15 Nov |
| `technical` | ⚠️ صار في مشكلة تقنية صغيرة من عنا.<br>ابعت رسالتك كمان مرة بعد دقيقة. | ⚠️ A short technical problem on our side.<br>Send your message again in a minute. | RA 15 Nov |
| `capMenu` | خلّينا نكمّل من هون، اختار من تحت: | Let's carry on from here; choose below: | RA 15 Nov |
| `stalled` | عفواً، ما فهمت عليك منيح.<br>شو بتحب تعمل؟ | Sorry, I did not get that.<br>What would you like to do? | RA 15 Nov |
| `browseButton` | شوف الأغراض | See the items | RA 15 Nov |
| `myOrderButton` | وين طلبي | My order | RA 15 Nov |
| `personButton` | احكي مع حدا | Talk to a person | RA 15 Nov |
| `buttonError` | ⚠️ ما زبطت هالكبسة من عنا.<br>جرّب كمان مرة. | ⚠️ That tap did not go through on our side.<br>Please try again. | RA 15 Nov |
| `retryButton` | جرّب كمان مرة | Try again | RA 15 Nov |
| `notOnRecord` | هالمعلومة مش مأكّدة بسجلاتنا، فما فينا نقول إنها مناسبة إلك.<br>بتحب نختار شي تاني؟ | This is not confirmed in our records, so we cannot say it suits you.<br>Would you like to choose something else? | RA 15 Nov |
| `browseInWords` | اكتبلي شو بدك، وبدوّرلك عليه. | Tell me what you need and I will look for it. | RA 15 Nov |
| `draft(person_requested, "AK-1234")` | مرحبا، معك فريق ألو كينغ بخصوص الطلب AK-1234.<br>كيف فينا نساعدك؟ | Hello, this is the Alo King team about your order AK-1234.<br>How can we help you? | RA 15 Nov |
| `draft(order_problem, "AK-1234")` | مرحبا، معك فريق ألو كينغ بخصوص الطلب AK-1234.<br>آسفين عالإزعاج. خبّرنا شو صار بالزبط؟ | Hello, this is the Alo King team about your order AK-1234.<br>We are sorry for the trouble. What happened exactly? | RA 15 Nov |
| `draft(complaint, "AK-1234")` | مرحبا، معك فريق ألو كينغ بخصوص الطلب AK-1234.<br>آسفين عالإزعاج. خبّرنا شو صار بالزبط؟ | Hello, this is the Alo King team about your order AK-1234.<br>We are sorry for the trouble. What happened exactly? | RA 15 Nov |
| `draft(refund, "AK-1234")` | مرحبا، معك فريق ألو كينغ بخصوص الطلب AK-1234.<br>وصلنا طلبك ورح نراجعه ونرجعلك بالجواب. | Hello, this is the Alo King team about your order AK-1234.<br>We have your request; we will check it and get back to you with the answer. | RA 15 Nov |
| `draft(payment, "AK-1234")` | مرحبا، معك فريق ألو كينغ بخصوص الدفع للطلب AK-1234.<br>عم نراجعه هلّق. | Hello, this is the Alo King team about the payment for order AK-1234.<br>We are checking it now. | RA 15 Nov |
| `draft(safety, "AK-1234")` | مرحبا، معك فريق ألو كينغ بخصوص الطلب AK-1234.<br>وصلتنا رسالتك وعم نتابعها هلّق. خبّرنا شو صار؟ | Hello, this is the Alo King team about your order AK-1234.<br>We have your message and are on it now. What happened? | RA 15 Nov |
| `draft(other, "AK-1234")` | مرحبا، معك فريق ألو كينغ بخصوص الطلب AK-1234.<br>كيف فينا نساعدك؟ | Hello, this is the Alo King team about your order AK-1234.<br>How can we help you? | RA 15 Nov |
| `ops.turnCap(20) (staff line)` | ⚠️ زبون تخطّى 20 رسالة للمساعد بساعة.<br>عم نجاوبو بقائمة ثابتة لآخر الساعة. | ⚠️ A customer passed 20 assistant messages in an hour.<br>They get a fixed menu until the hour turns. | RA 15 Nov |

## B1a, the basket kept and the minimum said by code (15 November 2026)

Source: `messages(...).basket` in `packages/agents/src/messages/ar.ts`. When each is sent: `packages/agents/src/basket.ts` and `pipeline.ts`.

| Key | Arabic | English | Read by |
|---|---|---|---|
| `minimum(5, 0.69, 4.31)` | 🛒 طلبك أقل من الحد الأدنى.<br>الحد الأدنى للطلب: $5.00<br>طلبك هلّق: $0.69<br>ناقصك: $4.31<br>زيد شي، أو اختار من تحت: | 🛒 Your order is under the minimum.<br>Minimum order: $5.00<br>Your basket now: $0.69<br>Still to add: $4.31<br>Add something, or choose below: | RA 15 Nov |
| `minimumIs(5)` | 🛒 الحد الأدنى للطلب: $5.00<br>شو بتحب تطلب؟ | 🛒 Minimum order: $5.00<br>What would you like to order? | RA 15 Nov |
| `cancelButton` | إلغاء الطلب | Cancel order | RA 15 Nov |
| `cleared` | تمام، ما رح نبعت شي وسلّتك فاضية.<br>اكتبلي أيمتى ما بدك تطلب. | OK, nothing will be sent and your basket is empty.<br>Write to me whenever you want to order. | RA 15 Nov |
| `soFar(["1 × لبنة", "2 × خبز"])` | 🛒 طلبك لسّا ما انبعت. بسلّتك:<br>• 1 × لبنة<br>• 2 × خبز | 🛒 Your order is not sent yet. In your basket:<br>• 1 × Labneh<br>• 2 × Bread | RA 15 Nov |
| `changed(["خبز: 2 → 4"])` | ✅ عدّلنا طلبك:<br>خبز: 2 → 4 | ✅ Your order is updated:<br>Bread: 2 → 4 | RA 15 Nov |
| `unavailable(["لبنة"])` | ⚠️ مش متوفّر هلّق:<br>• لبنة<br>قلّي شو بدك بدالو، أو منشيلو. | ⚠️ Not available now:<br>• Labneh<br>Tell me what you'd like instead, or remove it. | RA 15 Nov |
| `cancelRefused("AK-1234")` | طلبك AK-1234 عم يتحضّر هلّق، فما فينا نلغيه من هون.<br>حدا من فريقنا رح يتّصل فيك بخصوصه. | Order AK-1234 is already being prepared, so it can't be cancelled from here.<br>A person from our team will call you about it. | RA 15 Nov |

## B1b, a first order without a pin, thanks, and the list of villages (15 November 2026)

Source: `messages(...).fixed` and `.answer.outOfArea` in `packages/agents/src/messages/ar.ts`. When each is sent: `packages/agents/src/pipeline.ts`
(`acceptWithoutPin`, the off-topic branch). `noPinNote` is written on the order for the rider and ops, not sent as a message.

| Key | Arabic | English | Read by |
|---|---|---|---|
| `noPinCall("بعقلين")` | 📍 تمام، منوصّل على بعقلين بلا موقع.<br>السائق رح يتّصل فيك قبل ما يطلع ليتأكّد من العنوان. | 📍 OK, we deliver to Baakline without a pin.<br>The rider will call you before leaving, to check the address. | RA 15 Nov |
| `askVillageLandmark` | 📍 ما في مشكلة بلا موقع.<br>اكتبلي اسم الضيعة وأقرب معلم للبيت (جامع، كنيسة، مدرسة، فرن). | 📍 No problem without a pin.<br>Write your village and the nearest landmark to your home (a mosque, church, school, bakery). | RA 15 Nov |
| `noPinNote` | بلا موقع عالخريطة: السائق لازم يتّصل بالزبون قبل ما يطلع | No map pin: the rider must call the customer before leaving | RA 15 Nov |
| `welcome` | العفو، تكرم عينك. إذا بدك شي، اكتبلي هون. | You're welcome. If you need anything, write to me here. | RA 15 Nov |
| `outOfArea("جباع", [...])` | the same words; the list of villages now runs over as many lines as it needs, none over 120 characters | | |

## B1c, which one, the house default, the basket shown (15 November 2026)

Source: `messages(...).basket`, `.answer` and `.fixed` in `packages/agents/src/messages/ar.ts`. When each is sent: `packages/agents/src/choice.ts`
(`which`: the customer named only the kind or the brand, one question with at most three buttons), `pipeline.ts` (`houseDefault`: the
shop's default was given for a generic word), `answers.ts` (`noOpenRepeat`), `basket.ts` and `concierge-tools.ts` (the basket's lines under
the minimum and the closed-hours lines). Product names and prices are filled in by code.

| Key | Arabic | English | Read by |
|---|---|---|---|
| `which("ربطة خبز", [...])` | «ربطة خبز»: أي واحد بدك؟<br>• Wooden Bakery Pita White Medium 400G: $0.62<br>• Al Forno Pita White Bread Big 800G: $1.01<br>اختار من تحت. | "ربطة خبز": which one would you like?<br>• ...<br>Choose below. | |
| `houseDefault("ربطة خبز", ...)` | «ربطة خبز»: حطّينالك Wooden Bakery Pita White Medium 400G.<br>إذا بدك غيرو، قلّي. | "ربطة خبز": we put Wooden Bakery Pita White Medium 400G.<br>If you want another one, tell me. | |
| `noOpenRepeat(["لبنة", "خبز"], 0)` | ما عندك طلب مفتوح هلّق.<br>اكبس تحت لنجهّزلك نفس طلبك الماضي بأسعار اليوم:<br>لبنة، خبز | You have no open order now.<br>Tap below and we'll prepare the same order as last time at today's prices:<br>... | |
| `minimum(5, 0.69, 4.31, ["1 × لبنة"])` | 🛒 طلبك أقل من الحد الأدنى.<br>بسلّتك:<br>• 1 × لبنة<br>الحد الأدنى للطلب: $5.00<br>طلبك هلّق: $0.69<br>ناقصك: $4.31<br>زيد شي، أو اختار من تحت: | the read line, with the basket's lines under its first line (the words of `soFar`) | |
| `closedKept("08:00", ["1 × لبنة"])` | 🌙 مسكّرين هلّق، منفتح الساعة 08:00.<br><br>طلبك محفوظ ✅<br>• 1 × لبنة<br>بس نفتح اكبس «ابعت طلبي» ومنكمّل من هون. | the read line, with the basket kept | |

## DS1, the website's redesigned pages (15 November 2026)

Source: the `ar` dictionary in `apps/web/src/lib/i18n.ts` (the test `test/ui/design-system.test.ts` checks this section lists every line, so
change both together). Where each shows: the home page (the promise, "Do we deliver to you?", the trust strip), a category's filters, the
product card and the search page. Written by a model in the site's existing register (formal Arabic), read by RA on 15 November (one change: «للسائق» in `trust_rider`); the greeting is Lebanese, because the
customer sends it as their own first message. `{village}`, `{fee}`, `{n}` and `{total}` are filled by code. The console's Arabic (staff only)
is not listed here.

| Key | Arabic | English | Read by |
|---|---|---|---|
| `hero_title` | البقالة إلى باب بيتك في الشوف | Groceries to your door in the Chouf | RA 15 Nov |
| `hero_text` | اطلب عبر واتساب برسالة مكتوبة أو صوتية، أو تسوّق هنا. الدفع نقدًا عند الاستلام. | Order on WhatsApp by text or voice note, or shop here. Pay cash when it arrives. | RA 15 Nov |
| `shop_here` | تسوّق هنا | Shop here | RA 15 Nov |
| `wa_greeting` | مرحبا، بدي اطلب | Hello, I would like to order | RA 15 Nov |
| `order_item_whatsapp` | اطلب هذا المنتج عبر واتساب | Order this item on WhatsApp | RA 15 Nov |
| `check_title` | هل نوصّل إليك؟ | Do we deliver to you? | RA 15 Nov |
| `check_label` | قريتك | Your village | RA 15 Nov |
| `check_choose` | اختر قريتك | Choose your village | RA 15 Nov |
| `check_go` | تحقّق | Check | RA 15 Nov |
| `check_yes` | نوصّل إلى {village}. | We deliver to {village}. | RA 15 Nov |
| `check_fee` | التوصيل {fee} | Delivery {fee} | RA 15 Nov |
| `check_time` | حوالي {n} دقيقة | About {n} minutes | RA 15 Nov |
| `check_other` | قريتك غير موجودة في القائمة؟ اسألنا عبر واتساب. | Not on the list? Ask us on WhatsApp. | RA 15 Nov |
| `trust_cash` | الدفع نقدًا عند الاستلام | Cash on delivery | RA 15 Nov |
| `trust_cash_text` | بالدولار، أو بالليرة بسعر اليوم. | In dollars, or in pounds at the day's rate. | RA 15 Nov |
| `trust_rider` | رسم التوصيل كله للسائق | The rider keeps the whole delivery fee | RA 15 Nov |
| `trust_rider_text` | رسم التوصيل وأي إكرامية يذهبان كاملين إلى من يوصل طلبك. | The delivery fee and any tip go in full to the person who brings your order. | RA 15 Nov |
| `trust_hours` | ساعات العمل | Opening hours | RA 15 Nov |
| `trust_person` | شخص يجيبك على واتساب | A person on WhatsApp | RA 15 Nov |
| `trust_person_text` | عندما تحتاج إلى مساعدة، يجيبك أحد أفراد فريقنا. | When you need help, someone from our team answers. | RA 15 Nov |
| `filter_brand` | الماركة | Brand | RA 15 Nov |
| `filter_unit` | يُباع بـ | Sold by | RA 15 Nov |
| `filter_stock` | المتوفر فقط | In stock only | RA 15 Nov |
| `filter_all` | الكل | All | RA 15 Nov |
| `filter_show` | اعرض | Show | RA 15 Nov |
| `filter_clear` | إزالة التصفية | Clear filters | RA 15 Nov |
| `sort` | الترتيب | Sort | RA 15 Nov |
| `sort_default` | ترتيب القسم | As arranged | RA 15 Nov |
| `sort_price_asc` | السعر: من الأقل إلى الأعلى | Price, low to high | RA 15 Nov |
| `sort_price_desc` | السعر: من الأعلى إلى الأقل | Price, high to low | RA 15 Nov |
| `items_of` | {n} من {total} منتج | {n} of {total} items | RA 15 Nov |
| `filter_none` | لا شيء يطابق هذه التصفية. | Nothing matches these filters. | RA 15 Nov |
| `unit_each` | بالقطعة | each | RA 15 Nov |
| `live_hint` | تظهر النتائج أثناء الكتابة. | Results appear as you type. | RA 15 Nov |


## CX1, the customer pack (16 November 2026)

Source: `messages(...).cx` and the six new lines of `messages(...).ops` in `packages/agents/src/messages/ar.ts`. When each is sent:
`packages/agents/src/customer-pack.ts` and `docs/HANDOFF.md`, CX1. Model-written; **not read by a person yet**. The privacy line
(`cx.privacy`) is also the wording kept with each customer's consent (`customer_welcomes`, 0143): a change to it is a change of wording
that later customers agree to. List rows are cut by WhatsApp at 24 characters and buttons at 20.

| Key | Arabic | English | Read by |
|---|---|---|---|
| `cx.welcome("08:00", "22:00")` | 👑 أهلا فيك بألو كينغ!<br>منوصّلك أغراض البيت لعند بابك بالشوف. اكتبلي شو بدك أو ابعت رسالة صوتية.<br>🌙 الدوام من 08:00 لـ 22:00.<br>بمراسلتك إلنا بتوافق إنّو نحفظ رسايلك وطلباتك بس لنخدمك فيها. فيك تكتب STOP بأي وقت. | 👑 Welcome to Alo King!<br>We bring home groceries to your door in the Chouf. Tell me what you need, in writing or by voice note.<br>🌙 We are open from 08:00 to 22:00.<br>By writing to us you agree that we keep your messages and orders only to serve them. Write STOP at any time. | |
| `cx.privacy` | بمراسلتك إلنا بتوافق إنّو نحفظ رسايلك وطلباتك بس لنخدمك فيها. فيك تكتب STOP بأي وقت. | By writing to us you agree that we keep your messages and orders only to serve them. Write STOP at any time. | |
| `cx.orderButton` | اطلب | Order | |
| `cx.areaButton` | بتوصلو لعندي؟ | Do you deliver here? | |
| `cx.orderAsk` | تفضّل، اكتبلي شو بدك أو ابعت رسالة صوتية. | Go ahead: tell me what you need, or send a voice note. | |
| `cx.areaAsk` | 📍 ابعتلنا موقعك من الزر تحت أو اكتب اسم الضيعة، ومنقلّك إذا منوصل لعندك. | 📍 Send your location with the button below, or type your village, and we'll tell you if we deliver there. | |
| `cx.keepLine` | الفراطة بتبقى رصيد إلك. | Your change stays with us as credit. | |
| `cx.choicesButton` | خيارات | Options | |
| `cx.choicesMissing` | إذا في غرض ناقص | If an item is missing | |
| `cx.choicesNote` | الدفع كاش | Paying cash | |
| `cx.choicesOrder` | الطلب | The order | |
| `cx.exactRow` | معي المبلغ مظبوط | I have the exact amount | |
| `cx.keepRow` | خلّوا الفراطة رصيد | Keep change as credit | |
| `cx.cancelRow` | إلغاء الطلب | Cancel the order | |
| `cx.exactSet` | ✅ تمام: الدفع بالمبلغ المظبوط. | ✅ Done: you'll pay the exact amount. | |
| `cx.needsNote` | اختار أوّل الورقة يلي رح تدفع فيها. | First choose the note you'll pay with. | |
| `cx.cancelYes` | إيه، ألغيه | Yes, cancel it | |
| `cx.pickupOff` | الاستلام من المحل مش متوفّر بعد، فمنوصّلك لعند بيتك. | Pickup isn't available yet, so we'll deliver to your home. | |
| `cx.missingLine(best_match)` | إذا في غرض ناقص: منحطّ أقرب بديل | If an item is missing: we put the closest match | |
| `cx.missingRow.best_match` | حطّولي أقرب بديل | Closest match | |
| `cx.missingSet(best_match)` | ✅ تمام: إذا في غرض ناقص منحطّ أقرب بديل. | ✅ Done: if an item is missing, we put the closest match. | |
| `cx.missingLine(ask)` | إذا في غرض ناقص: منسألك | If an item is missing: we ask you | |
| `cx.missingRow.ask` | اسألوني | Ask me | |
| `cx.missingSet(ask)` | ✅ تمام: إذا في غرض ناقص منسألك قبل ما نبدّل. | ✅ Done: if an item is missing, we ask you before swapping. | |
| `cx.missingLine(remove)` | إذا في غرض ناقص: منشيلو من الطلب | If an item is missing: we take it off | |
| `cx.missingRow.remove` | شيلوه من الطلب | Take it off | |
| `cx.missingSet(remove)` | ✅ تمام: إذا في غرض ناقص منشيلو من الطلب. | ✅ Done: if an item is missing, we take it off the order. | |
| `cx.noteRow(20)` | بدفع بورقة $20.00 | I'll pay with $20.00 | |
| `cx.noteSet(20, 12.73)` | ✅ تمام، منجيب فراطة لورقة $20.00<br>الفراطة: $12.73 | ✅ Done, we'll bring change for $20.00<br>Your change: $12.73 | |
| `cx.keepSet(12.73)` | ✅ تمام، ما منرجّعلك فراطة.<br>بتصير رصيد إلك بعد الدفع: $12.73 | ✅ Done, no change will be given back.<br>It becomes your credit once paid: $12.73 | |
| `cx.noteTooSmall(7.27)` | هالورقة أقل من المجموع: $7.27 | That note is less than the total: $7.27 | |
| `cx.choiceTooLate` | بلّشنا نحضّر طلبك AK-1234، وما بقى فينا نغيّر هالخيار. | We've started preparing order AK-1234, so this can't change any more. | |
| `cx.cancelAsk` (cash) | بدك نلغي طلبك AK-1234؟ لسّا ما بلّشنا نحضّرو. | Cancel order AK-1234? We haven't started preparing it. | |
| `cx.cancelAsk` (paid) | بدك نلغي طلبك AK-1234؟ لسّا ما بلّشنا نحضّرو.<br>المبلغ يلي دفعتو بيرجع رصيد إلك: $7.27 | Cancel order AK-1234? We haven't started preparing it.<br>What you paid comes back as credit: $7.27 | |
| `cx.cancelAfterPick` | بلّشنا نحضّر طلبك AK-1234، فما فينا نلغيه من هون.<br>إذا لغيناه، بيرجعلك رصيد: $5.27<br>ما بيرجعو عالرفّ: لبنة.<br>حدا من الفريق رح يحكيك هلّق. | We've started preparing order AK-1234, so it can't be cancelled from here.<br>If we cancel it, your credit back: $5.27<br>Can't go back on the shelf: Labneh.<br>A person from our team will talk to you now. | |
| `cx.cancelAfterPickCash` | بلّشنا نحضّر طلبك AK-1234، فما فينا نلغيه من هون.<br>ما دفعت شي بعد. حدا من الفريق رح يحكيك هلّق. | We've started preparing order AK-1234, so it can't be cancelled from here.<br>You haven't paid anything. A person from our team will talk to you now. | |
| `cx.cancelOnTheWay` | 🛵 طلبك AK-1234 صار عالطريق، فما فينا نلغيه من هون.<br>حدا من الفريق رح يحكيك هلّق. | 🛵 Order AK-1234 is on its way, so it can't be cancelled from here.<br>A person from our team will talk to you now. | |
| `cx.handoverCode` | 🔢 رمز الاستلام: 4821<br>عطيه للسائق بس لمّا يوصلك الطلب. | 🔢 Your handover code: 4821<br>Give it to the rider only when you have your order. | |
| `cx.pickupAt` | 🏠 استلام من مستودع ألو كينغ، بلا رسم توصيل | 🏠 Pickup at the Alo King hub, no delivery fee | |
| `cx.pickupReady` | 📦 طلبك AK-1234 جاهز للاستلام من مستودع ألو كينغ.<br>إذا كان مدفوع، جيب معك رمز الاستلام. | 📦 Order AK-1234 is ready for pickup at the Alo King hub.<br>If it's prepaid, bring your handover code. | |
| `ops.askCode` (rider) | 🔢 الطلب #AK-1234 مدفوع سلف.<br>اطلب من الزبون رمز الاستلام (4 أرقام) واكتبو هون. | 🔢 Order #AK-1234 is prepaid.<br>Ask the customer for their handover code (4 digits) and type it here. | |
| `ops.wrongCode` (rider) | الرمز غلط. باقي 4 محاولات. | Wrong code. 4 tries left. | |
| `ops.codeLocked` (rider) | ⚠️ الرمز غلط كذا مرة للطلب #AK-1234. ما تسلّم، العمليات رح تتصل فيك. | ⚠️ Too many wrong codes for order #AK-1234. Do not hand it over; ops will call you. | |
| `ops.codeLockedAlert` (ops) | ⚠️ رمز الاستلام للطلب #AK-1234 انقفل بعد محاولات غلط. اتصلوا بالزبون والسائق. | ⚠️ The handover code of order #AK-1234 is locked after wrong tries. Call the customer and the rider. | |
| `ops.codeOk` (rider) | ✅ الرمز صحيح: تسلّم الطلب #AK-1234. | ✅ Code correct: order #AK-1234 handed over. | |
| `ops.keepChange` (rider) | 💵 ما في فراطة: الزبون بيترك الباقي رصيد. الورقة: $20.00 | 💵 No change: the customer keeps it as credit. The note: $20.00 | |

## D4b, the pick queue, rider jobs and rider incidents (console, written by a model)
The pages choose a line with `pick(lang, English, Arabic)` in `apps/console/src/pages/pick.ts`, `riderjobs.ts` and `riderincidents.ts` (about 120 short lines: buttons, warnings, the refusals' explanations), and the packing steps are in the `packing_checklist` setting (migration 0147): «المنتجات المبرّدة والمجمّدة والطازجة في الحقيبة الباردة.», «البيض والخبز في الأعلى ولا شيء ثقيل فوقهما.», «ملصق الكيس عليه رمز الطلب واسم القرية.» The customer messages are the existing ones (`messages/`). A reader should check: the picker's words (التقاط، ناقص، تجهيز), the rider words (مندوب), and that the long warnings read as an instruction to a person at work.

## PD1, the honest answer when nothing fits (16 November 2026)
Written by code (`packages/agents/src/messages/ar.ts`, `honest`), sent when a customer asks for a kind of product with a fact that no
approved record can answer («بدي سناكس بلا سكر لخمس ولاد», «بروتين بار بلا سكر»). The kinds are the customer's own words; the items are
product names as printed, each with its price on the next line. A reader should check that «ما فينا نأكّد السكر» reads as "we cannot
confirm" and never as "it has no sugar", and the joined «بـ» before a Latin word.

| Key | Arabic | English | Read |
| --- | --- | --- | --- |
| `honest.notCarried(["بروتين بار"])` | ما عنا بروتين بار بعد. سجّلنا طلبك. | We don't carry protein bars yet. I've noted your request. | |
| `honest.cannotConfirm("السكر", ["سناكس"])` | ما فينا نأكّد السكر بـسناكس يلي عنا بعد. | I can't confirm the sugar for our snacks yet. | |
| `honest.fact` | السكر، البروتين، إنّو بلا غلوتين، إنّو بلا لاكتوز، الدهون، الملح، إنّو بلا ريحة | the sugar, the protein, gluten-free, lactose-free, the fat, the salt, fragrance-free | |
| `honest.named(["Zero Sugar", "No Sugar"])` | أغراض باسمها «Zero Sugar» أو «No Sugar»: | Items with “Zero Sugar” or “No Sugar” in their name: | |
| `honest.closeItems` | قلّي إذا بدك شي منهن، أو شي تاني. | Tell me if you want one of these, or something else. | |
| `honest.closeNone` | قلّي شو بدك غير هيك. | Tell me what else you need. | |

## SR1, what fits with its facts, and baskets built by code (16 November 2026)
Written by code (`packages/agents/src/messages/ar.ts`, `honest.fits`, `honest.noneFits`, `honest.closeFits`, `built`; the fact lines in
`packages/agents/src/search.ts`, `factLine`). A reader should check that each fact line reads as "this is what is printed on the pack" and
never as our own judgement, and that «بلا» in the allergen line reads as "the list says it has none", not as a promise.

| Key | Arabic | English | Read |
| --- | --- | --- | --- |
| `honest.fits(["سناكات"])` | هيدا يلي بيناسب (سناكات)، مع شو مكتوب على العلبة: | What fits (snacks), with what the pack says: | |
| `honest.noneFits(["عصير"])` | ولا شي من عصير يلي عنا بيناسب، حسب المكتوب على العلب. | None of our juice fits that, by what their packs say. | |
| `honest.closeFits` | قلّي أيّا واحد وقدّيش. | Tell me which one and how many. | |
| `factLine` (claim) | مكتوب على العلبة «No added sugar» | the pack says “No added sugar” | |
| `factLine` (nutrition) | جدول القيم الغذائية على العلبة: 0.4 غ سكر بكل 100 غ | the nutrition panel on the pack: 0.4 g sugar per 100 g | |
| `factLine` (allergen) | لائحة مسبّبات الحساسية على العلبة: بلا فول سوداني | the pack's allergen list: no peanuts | |
| `built.dish("مجدرة", 6)` | مجدرة لـ6: كل شي بدها، حسب الكمية للشخص. | Mjadra for 6: everything it needs, by the quantity per person. | |
| `built.lunchbox(10)` | سناكات للزوادة: 10 بالمجموع، من كذا نوع. | Lunchbox snacks: 10 in all, a few different ones. | |
| `built.budget(20)` | سلة على قد الميزانية (الأغراض بس، التوصيل لحال). / الميزانية: $20.00 | A basket for your budget (items only, delivery apart). / Budget: $20.00 | |
| `built.missing(["برغل"])` | مش محطوط: برغل (ما فينا نزيدو هلّق). | Not included: burghul (we can't add it now). | |
| `built.overBudget(15)` | المجموع أكتر من الميزانية؛ قلّي شو نشيل. / الميزانية: $15.00 | This comes to more than your budget; tell me what to take out. / Budget: $15.00 | |
| `built.tooMany(50)` | فيني ضبّط سلة لحد 50 شخص. قلّي شو بدك وبزيدو. | I can build a basket for up to 50 people. Tell me what you need and I'll add it. | |
| `built.none` | ما قدرت ضبّط هالسلة من يلي عنا هلّق. قلّي شو بدك وبزيدو. | I couldn't build this basket from what we have now. Tell me what you need and I'll add it. | |

## LD1, the product page by template (16 November 2026)
Written by a model, to be read by a person (Arabic and French). Files: `apps/web/src/lib/i18n.ts` (the keys `not_confirmed_yet`, `not_verified*`, `nothing_verified`, `facts_intro`, `details_*`, `src_*`, `barcode`, `claims_title`, `per_amount`, `certificate`, `valid_until`, `no_price`, `size_label`) and `apps/web/src/lib/fields.ts` (labels of every template field, the words of enum values, hazard pictograms, certificate kinds, nutrient names). Check first: «لم يتم التأكيد بعد» (not confirmed yet), the source phrases («من العبوة»، «مُصرَّح به من البائع»), and the hazard words (they must say what is printed, never judge).

## LB1, the label day pages (console, staff-facing, written by a model; 16 November 2026)

Source: `apps/console/src/pages/capture.ts` and `apps/console/src/pages/labelqueue.ts` (the words are written beside their English with `pick(L, en, ar)`), and the navigation names in `apps/console/src/i18n.ts` (`NAV_AR`). Read by Bassem, who uses them on the label day. Not covered by `arabic-review.test.ts` (staff screens, not customer messages).

| Place | Arabic | English | Read by |
|---|---|---|---|
| Title | يوم الملصقات: صوّر العبوات | Label day: photograph the packs | |
| Counter | تم / بقي / من / حسب الممر | done / left / of / By aisle | |
| Slots | الواجهة (مطلوبة) · الخلف (مطلوبة) · الجانب | Front (needed) · Back (needed) · Side | |
| Slot help | واجهة العبوة كاملة. · ظهر العبوة كاملاً: المكوّنات والمسبّبات والتحذيرات. · اختياري: الجانب الذي فيه جدول القيم الغذائية أو طريقة الاستعمال. | The whole front of the pack. · The whole back: ingredients, allergens, warnings. · Optional: the side with the nutrition panel or the directions. | |
| Buttons | التقط الصورة · التقطها من جديد · احفظ الصورة · المنتج التالي · امسح بالكاميرا · اختر من القائمة · ابحث · أرسل من جديد | Take the photo · Take it again · Save the photo · Next item · Scan with the camera · Pick from the list · Find · Send again | |
| States | تم الحفظ · بانتظار الإرسال: تبقى على هذا الهاتف · مرفوضة: انظر أدناه · لم تُلتقط بعد | Saved · Waiting to be sent: it stays on this phone · Refused: see below · Not yet | |
| Approvals | موافقات الملصقات · مسبّبات الحساسية · الحلال وبطاقات الحمية والشهادات · تحذيرات الخطر والتحذيرات المطبوعة · اختلاف المصادر · بقية قراءات الملصقات · أكّد · ارفض | Label approvals · Allergens · Halal, diet labels and certificates · Hazard and printed warnings · Disagreements between sources · The rest of the label readings · Confirm · Reject | |
| Menu | تصوير الملصقات · موافقات الملصقات | Label day photos · Label approvals | |

