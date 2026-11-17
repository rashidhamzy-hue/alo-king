# Arabic for a person to read

Every customer-facing Arabic line added since the last human read, with its English, for a native Lebanese speaker to check before
the friends' test (gate A). Written by models; every line below was read by the founder with the planning chat on 16 November 2026 ("RA 16 Nov"; session AR1 applied the changes). A line the reader changes is changed in
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
| `outOfArea("جباع", [...])` | the same words; the list of villages now runs over as many lines as it needs, none over 120 characters | | RA 16 Nov |

## B1c, which one, the house default, the basket shown (15 November 2026)

Source: `messages(...).basket`, `.answer` and `.fixed` in `packages/agents/src/messages/ar.ts`. When each is sent: `packages/agents/src/choice.ts`
(`which`: the customer named only the kind or the brand, one question with at most three buttons), `pipeline.ts` (`houseDefault`: the
shop's default was given for a generic word), `answers.ts` (`noOpenRepeat`), `basket.ts` and `concierge-tools.ts` (the basket's lines under
the minimum and the closed-hours lines). Product names and prices are filled in by code.

| Key | Arabic | English | Read by |
|---|---|---|---|
| `which("ربطة خبز", [...])` | «ربطة خبز»: أي واحد بدك؟<br>• Wooden Bakery Pita White Medium 400G: $0.62<br>• Al Forno Pita White Bread Big 800G: $1.01<br>اختار من تحت. | "ربطة خبز": which one would you like?<br>• ...<br>Choose below. | RA 16 Nov |
| `houseDefault("ربطة خبز", ...)` | «ربطة خبز»: حطّينالك Wooden Bakery Pita White Medium 400G.<br>إذا بدك غيرو، قلّي. | "ربطة خبز": we put Wooden Bakery Pita White Medium 400G.<br>If you want another one, tell me. | RA 16 Nov |
| `noOpenRepeat(["لبنة", "خبز"], 0)` | ما عندك طلب مفتوح هلّق.<br>اكبس تحت لنجهّزلك نفس آخر طلب إلك بأسعار اليوم:<br>لبنة، خبز | You have no open order now.<br>Tap below and we'll prepare the same order as last time at today's prices:<br>... | RA 16 Nov |
| `minimum(5, 0.69, 4.31, ["1 × لبنة"])` | 🛒 طلبك أقل من الحد الأدنى.<br>بسلّتك:<br>• 1 × لبنة<br>الحد الأدنى للطلب: $5.00<br>طلبك هلّق: $0.69<br>ناقصك: $4.31<br>زيد شي، أو اختار من تحت: | the read line, with the basket's lines under its first line (the words of `soFar`) | RA 16 Nov |
| `closedKept("08:00", ["1 × لبنة"])` | 🌙 مسكّرين هلّق، منفتح الساعة 08:00.<br><br>طلبك محفوظ ✅<br>• 1 × لبنة<br>بس نفتح اكبس «ابعت طلبي» ومنكمّل من هون. | the read line, with the basket kept | RA 16 Nov |

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
`packages/agents/src/customer-pack.ts` and `docs/HANDOFF.md`, CX1. Model-written; read by the founder on 16 November ("RA 16 Nov"), who changed the privacy line: the new wording is kept per customer from now on in `customer_welcomes`, and earlier rows keep the words they were shown. The privacy line
(`cx.privacy`) is also the wording kept with each customer's consent (`customer_welcomes`, 0143): a change to it is a change of wording
that later customers agree to. List rows are cut by WhatsApp at 24 characters and buttons at 20.

| Key | Arabic | English | Read by |
|---|---|---|---|
| `cx.welcome("08:00", "22:00")` | 👑 أهلا فيك بألو كينغ!<br>منوصّلك أغراض البيت لعند بابك بالشوف. اكتبلي شو بدك أو ابعت رسالة صوتية.<br>🌙 الدوام من 08:00 لـ 22:00.<br>لمّا تراسلنا، بتوافق إنّو نحفظ رسايلك وطلباتك بس لنخدمك. فيك تكتب STOP بأي وقت لنوقّف. | 👑 Welcome to Alo King!<br>We bring home groceries to your door in the Chouf. Tell me what you need, in writing or by voice note.<br>🌙 We are open from 08:00 to 22:00.<br>By writing to us you agree that we keep your messages and orders only to serve them. Write STOP at any time. | RA 16 Nov |
| `cx.privacy` | لمّا تراسلنا، بتوافق إنّو نحفظ رسايلك وطلباتك بس لنخدمك. فيك تكتب STOP بأي وقت لنوقّف. | By writing to us you agree that we keep your messages and orders only to serve them. Write STOP at any time. | RA 16 Nov |
| `cx.orderButton` | اطلب | Order | RA 16 Nov |
| `cx.areaButton` | بتوصلو لعندي؟ | Do you deliver here? | RA 16 Nov |
| `cx.orderAsk` | تفضّل، اكتبلي شو بدك أو ابعت رسالة صوتية. | Go ahead: tell me what you need, or send a voice note. | RA 16 Nov |
| `cx.areaAsk` | 📍 ابعتلنا موقعك من الزر تحت أو اكتب اسم الضيعة، ومنقلّك إذا منوصل لعندك. | 📍 Send your location with the button below, or type your village, and we'll tell you if we deliver there. | RA 16 Nov |
| `cx.keepLine` | الفراطة بتبقى رصيد إلك. | Your change stays with us as credit. | RA 16 Nov |
| `cx.choicesButton` | خيارات | Options | RA 16 Nov |
| `cx.choicesMissing` | إذا في غرض ناقص | If an item is missing | RA 16 Nov |
| `cx.choicesNote` | الدفع كاش | Paying cash | RA 16 Nov |
| `cx.choicesOrder` | الطلب | The order | RA 16 Nov |
| `cx.exactRow` | معي المبلغ مظبوط | I have the exact amount | RA 16 Nov |
| `cx.keepRow` | خلّوا الفراطة رصيد | Keep change as credit | RA 16 Nov |
| `cx.cancelRow` | إلغاء الطلب | Cancel the order | RA 16 Nov |
| `cx.exactSet` | ✅ تمام: الدفع بالمبلغ المظبوط. | ✅ Done: you'll pay the exact amount. | RA 16 Nov |
| `cx.needsNote` | أوّل شي، اختار الورقة يلي رح تدفع فيها. | First choose the note you'll pay with. | RA 16 Nov |
| `cx.cancelYes` | إيه، ألغيه | Yes, cancel it | RA 16 Nov |
| `cx.pickupOff` | لسّا ما في استلام من عنّا، فمنوصّلك لعند البيت. | Pickup isn't available yet, so we'll deliver to your home. | RA 16 Nov |
| `cx.missingLine(best_match)` | إذا في غرض ناقص: منحطّ أقرب بديل | If an item is missing: we put the closest match | RA 16 Nov |
| `cx.missingRow.best_match` | حطّولي أقرب بديل | Closest match | RA 16 Nov |
| `cx.missingSet(best_match)` | ✅ تمام: إذا في غرض ناقص منحطّ أقرب بديل. | ✅ Done: if an item is missing, we put the closest match. | RA 16 Nov |
| `cx.missingLine(ask)` | إذا في غرض ناقص: منسألك | If an item is missing: we ask you | RA 16 Nov |
| `cx.missingRow.ask` | اسألوني | Ask me | RA 16 Nov |
| `cx.missingSet(ask)` | ✅ تمام: إذا في غرض ناقص منسألك قبل ما نبدّل. | ✅ Done: if an item is missing, we ask you before swapping. | RA 16 Nov |
| `cx.missingLine(remove)` | إذا في غرض ناقص: منشيلو من الطلب | If an item is missing: we take it off | RA 16 Nov |
| `cx.missingRow.remove` | شيلوه من الطلب | Take it off | RA 16 Nov |
| `cx.missingSet(remove)` | ✅ تمام: إذا في غرض ناقص منشيلو من الطلب. | ✅ Done: if an item is missing, we take it off the order. | RA 16 Nov |
| `cx.noteRow(20)` | بدفع بورقة $20.00 | I'll pay with $20.00 | RA 16 Nov |
| `cx.noteSet(20, 12.73)` | ✅ تمام، منجيبلك فراطة للـ$20.00<br>الفراطة: $12.73 | ✅ Done, we'll bring change for $20.00<br>Your change: $12.73 | RA 16 Nov |
| `cx.keepSet(12.73)` | ✅ تمام، ما منرجّعلك فراطة.<br>بتصير رصيد إلك بعد الدفع: $12.73 | ✅ Done, no change will be given back.<br>It becomes your credit once paid: $12.73 | RA 16 Nov |
| `cx.noteTooSmall(7.27)` | هالورقة أقل من المجموع: $7.27 | That note is less than the total: $7.27 | RA 16 Nov |
| `cx.choiceTooLate` | بلّشنا نحضّر طلبك AK-1234، وما بقى فينا نغيّر هالخيار. | We've started preparing order AK-1234, so this can't change any more. | RA 16 Nov |
| `cx.cancelAsk` (cash) | بدك نلغي طلبك AK-1234؟ لسّا ما بلّشنا نحضّرو. | Cancel order AK-1234? We haven't started preparing it. | RA 16 Nov |
| `cx.cancelAsk` (paid) | بدك نلغي طلبك AK-1234؟ لسّا ما بلّشنا نحضّرو.<br>المبلغ يلي دفعتو بيرجع رصيد إلك: $7.27 | Cancel order AK-1234? We haven't started preparing it.<br>What you paid comes back as credit: $7.27 | RA 16 Nov |
| `cx.cancelAfterPick` | بلّشنا نحضّر طلبك AK-1234، فما فينا نلغيه من هون.<br>إذا لغيناه، بيرجعلك رصيد: $5.27<br>ما بيرجعو عالرفّ: لبنة.<br>حدا من الفريق رح يحكيك هلّق. | We've started preparing order AK-1234, so it can't be cancelled from here.<br>If we cancel it, your credit back: $5.27<br>Can't go back on the shelf: Labneh.<br>A person from our team will talk to you now. | RA 16 Nov |
| `cx.cancelAfterPickCash` | بلّشنا نحضّر طلبك AK-1234، فما فينا نلغيه من هون.<br>ما دفعت شي بعد. حدا من الفريق رح يحكيك هلّق. | We've started preparing order AK-1234, so it can't be cancelled from here.<br>You haven't paid anything. A person from our team will talk to you now. | RA 16 Nov |
| `cx.cancelOnTheWay` | 🛵 طلبك AK-1234 صار عالطريق، فما فينا نلغيه من هون.<br>حدا من الفريق رح يحكيك هلّق. | 🛵 Order AK-1234 is on its way, so it can't be cancelled from here.<br>A person from our team will talk to you now. | RA 16 Nov |
| `cx.handoverCode` | 🔢 رمز الاستلام: 4821<br>عطيه للدليفري بس لمّا يوصلك الطلب. | 🔢 Your handover code: 4821<br>Give it to the rider only when you have your order. | RA 16 Nov |
| `cx.pickupAt` | 🏠 استلام من مستودع ألو كينغ، بلا رسم توصيل | 🏠 Pickup at the Alo King hub, no delivery fee | RA 16 Nov |
| `cx.pickupReady` | 📦 طلبك AK-1234 جاهز للاستلام من مستودع ألو كينغ.<br>جيب معك رمز الاستلام. | 📦 Order AK-1234 is ready for pickup at the Alo King hub.<br>Bring your handover code. | first line RA 16 Nov; second line changed by CFG1 (every pickup order has a code now), **not read by a person yet** |
| `ops.askCode` (rider) | 🔢 الطلب #AK-1234 مدفوع سلف.<br>اطلب من الزبون رمز الاستلام (4 أرقام) واكتبو هون. | 🔢 Order #AK-1234 is prepaid.<br>Ask the customer for their handover code (4 digits) and type it here. | RA 16 Nov |
| `ops.wrongCode` (rider) | الرمز غلط. باقي 4 محاولات. | Wrong code. 4 tries left. | RA 16 Nov |
| `ops.codeLocked` (rider) | ⚠️ الرمز غلط كذا مرة للطلب #AK-1234. ما تسلّم، العمليات رح تتصل فيك. | ⚠️ Too many wrong codes for order #AK-1234. Do not hand it over; ops will call you. | RA 16 Nov |
| `ops.codeLockedAlert` (ops) | ⚠️ رمز الاستلام للطلب #AK-1234 انقفل بعد محاولات غلط. اتصلوا بالزبون والدليفري. | ⚠️ The handover code of order #AK-1234 is locked after wrong tries. Call the customer and the rider. | RA 16 Nov |
| `ops.codeOk` (rider) | ✅ الرمز صحيح. سلّم الطلب #AK-1234. | ✅ Code correct: order #AK-1234 handed over. | RA 16 Nov |
| `ops.keepChange` (rider) | 💵 ما في فراطة: الزبون بيترك الباقي رصيد. الورقة: $20.00 | 💵 No change: the customer keeps it as credit. The note: $20.00 | RA 16 Nov |

## D4b, the pick queue, rider jobs and rider incidents (console, written by a model; RA 16 Nov)
The pages choose a line with `pick(lang, English, Arabic)` in `apps/console/src/pages/pick.ts`, `riderjobs.ts` and `riderincidents.ts` (about 120 short lines: buttons, warnings, the refusals' explanations), and the packing steps are in the `packing_checklist` setting (migration 0147): «المنتجات المبرّدة والمجمّدة والطازجة في الحقيبة الباردة.», «البيض والخبز في الأعلى ولا شيء ثقيل فوقهما.», «ملصق الكيس عليه رمز الطلب واسم القرية.» The customer messages are the existing ones (`messages/`). A reader should check: the picker's words (التقاط، ناقص، تجهيز), the rider words (مندوب), and that the long warnings read as an instruction to a person at work.

## PD1, the honest answer when nothing fits (16 November 2026)
Written by code (`packages/agents/src/messages/ar.ts`, `honest`), sent when a customer asks for a kind of product with a fact that no
approved record can answer («بدي سناكس بلا سكر لخمس ولاد», «بروتين بار بلا سكر»). The kinds are the customer's own words; the items are
product names as printed, each with its price on the next line. A reader should check that «ما فينا نأكّد السكر» reads as "we cannot
confirm" and never as "it has no sugar", and the joined «بـ» before a Latin word.

| Key | Arabic | English | Read |
| --- | --- | --- | --- |
| `honest.notCarried(["بروتين بار"])` | لسّا ما عنّا بروتين بار، سجّلنا طلبك. | We don't carry protein bars yet. I've noted your request. | RA 16 Nov |
| `honest.cannotConfirm("السكر", ["سناكس"])` | لسّا ما فينا نأكّد السكر بالسناكس يلي عنّا. | I can't confirm the sugar for our snacks yet. | RA 16 Nov |
| `honest.fact` | السكر، البروتين، إنّو بلا غلوتين، إنّو بلا لاكتوز، الدهون، الملح، إنّو بلا ريحة | the sugar, the protein, gluten-free, lactose-free, the fat, the salt, fragrance-free | RA 16 Nov |
| `honest.named(["Zero Sugar", "No Sugar"])` | أغراض باسمها «Zero Sugar» أو «No Sugar»: | Items with “Zero Sugar” or “No Sugar” in their name: | RA 16 Nov |
| `honest.closeItems` | قلّي إذا بدك شي منهن، أو شي تاني. | Tell me if you want one of these, or something else. | RA 16 Nov |
| `honest.closeNone` | قلّي شو بدك غير هيك. | Tell me what else you need. | RA 16 Nov |

## SR1, what fits with its facts, and baskets built by code (16 November 2026)
Written by code (`packages/agents/src/messages/ar.ts`, `honest.fits`, `honest.noneFits`, `honest.closeFits`, `built`; the fact lines in
`packages/agents/src/search.ts`, `factLine`). A reader should check that each fact line reads as "this is what is printed on the pack" and
never as our own judgement, and that «بلا» in the allergen line reads as "the list says it has none", not as a promise.

| Key | Arabic | English | Read |
| --- | --- | --- | --- |
| `honest.fits(["سناكس"])` | هيدول يلي بيناسبوا من سناكس، مع شو مكتوب على علبهن: | What fits (snacks), with what the pack says: | RA 16 Nov |
| `honest.noneFits(["عصير"])` | ولا شي من العصير يلي عنّا بيناسب، حسب المكتوب على العلب. | None of our juice fits that, by what their packs say. | RA 16 Nov |
| `honest.closeFits` | قلّي أيّا واحد بدك وقدّيش. | Tell me which one and how many. | RA 16 Nov |
| `factLine` (claim) | مكتوب على العلبة «No added sugar» | the pack says “No added sugar” | RA 16 Nov |
| `factLine` (nutrition) | جدول القيم الغذائية على العلبة: 0.4 غ سكر بكل 100 غ | the nutrition panel on the pack: 0.4 g sugar per 100 g | RA 16 Nov |
| `factLine` (allergen) | لائحة مسبّبات الحساسية على العلبة: بلا فستق عبيد | the pack's allergen list: no peanuts | RA 16 Nov |
| `built.dish("مجدرة", 6)` | مجدرة لـ6 أشخاص: كل شي بدها، حسب الكمية للشخص. | Mjadra for 6: everything it needs, by the quantity per person. | RA 16 Nov |
| `built.lunchbox(10)` | سناكس للزوادة: 10 بالمجموع، من كذا نوع. | Lunchbox snacks: 10 in all, a few different ones. | RA 16 Nov |
| `built.budget(20)` | سلة على قد الميزانية (الأغراض بس، التوصيل لحال). / الميزانية: $20.00 | A basket for your budget (items only, delivery apart). / Budget: $20.00 | RA 16 Nov |
| `built.missing(["برغل"])` | مش محطوط: برغل (ما فينا نزيدو هلّق). | Not included: burghul (we can't add it now). | RA 16 Nov |
| `built.overBudget(15)` | المجموع أكتر من الميزانية؛ قلّي شو نشيل. / الميزانية: $15.00 | This comes to more than your budget; tell me what to take out. / Budget: $15.00 | RA 16 Nov |
| `built.tooMany(50)` | فيني ضبّط سلة لحد 50 شخص. قلّي شو بدك وبزيدو. | I can build a basket for up to 50 people. Tell me what you need and I'll add it. | RA 16 Nov |
| `built.none` | ما قدرت ضبّط هالسلة من يلي عنا هلّق. قلّي شو بدك وبزيدو. | I couldn't build this basket from what we have now. Tell me what you need and I'll add it. | RA 16 Nov |

## LD1, the product page by template (16 November 2026; RA 16 Nov)
Written by a model, read by the founder on 16 November, "approved as written" (Arabic and French). Files: `apps/web/src/lib/i18n.ts` (the keys `not_confirmed_yet`, `not_verified*`, `nothing_verified`, `facts_intro`, `details_*`, `src_*`, `barcode`, `claims_title`, `per_amount`, `certificate`, `valid_until`, `no_price`, `size_label`) and `apps/web/src/lib/fields.ts` (labels of every template field, the words of enum values, hazard pictograms, certificate kinds, nutrient names). Check first: «لم يتم التأكيد بعد» (not confirmed yet), the source phrases («من العبوة»، «مُصرَّح به من البائع»), and the hazard words (they must say what is printed, never judge).

## CFG1, the reminder, reopening a lapsed order, and the pickup code (17 November 2026)

Source: `messages(...).notice.confirmReminder`, `.card.reopenedFrom`, `.cx.reopenButton`, `.cx.handoverCodePickup` in `packages/agents/src/messages/ar.ts`
(and the changed `cx.pickupReady` above). When each is sent: `docs/HANDOFF.md`, CFG1. Written by a model; read by the coordinator on 17 November 2026 ("RA 17 Nov"), who changed `notice.confirmReminder` (since AR1 «الورقة» means the banknote) and `card.reopenedFrom`. The coordinator wrote `card.reopenedFrom` with a leading 🔁; the line is stored without it, as in `en.ts` and `fr.ts`, because the message rules allow only a fixed set of emoji (rule 4, `messages.rules.test.ts`) and 🔁 is not in it.
The English and French lines are in `en.ts` and `fr.ts`; they are listed here so the reader can see what the Arabic is meant to say.

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `notice.confirmReminder` | طلبك AK-1234 بعدو ناطر تأكيدك.<br>فيك تأكّدو أو تعدّلو من الرسالة يلي فوق. | Your order AK-1234 is still waiting for your confirmation.<br>You can confirm or edit it from the card above. | Votre commande AK-1234 attend toujours votre confirmation.<br>Vous pouvez la confirmer ou la modifier depuis la carte ci-dessus. || RA 17 Nov |
| `card.reopenedFrom` | رجعنا فتحنا طلبك من AK-1234، بأسعار اليوم. | 🔁 Reopened from AK-1234, at today's prices. | 🔁 Rouverte à partir de AK-1234, aux prix d'aujourd'hui. || RA 17 Nov |
| `cx.reopenButton` | افتح الطلب من جديد | Reopen order | Rouvrir la commande || RA 17 Nov |
| `cx.handoverCodePickup` | 🔢 رمز الاستلام: 4821<br>عطيه لموظف المستودع بس لمّا تاخد طلبك. | 🔢 Your handover code: 4821<br>Give it to our hub staff only when you take your order. | 🔢 Votre code de remise : 4821<br>Donnez-le à notre équipe au dépôt seulement quand vous prenez votre commande. || RA 17 Nov |

## LB1, the label day pages (console, staff-facing, written by a model; 16 November 2026)

Source: `apps/console/src/pages/capture.ts` and `apps/console/src/pages/labelqueue.ts` (the words are written beside their English with `pick(L, en, ar)`), and the navigation names in `apps/console/src/i18n.ts` (`NAV_AR`). Read by Bassem, who uses them on the label day. Not covered by `arabic-review.test.ts` (staff screens, not customer messages).

| Place | Arabic | English | Read by |
|---|---|---|---|
| Title | يوم الملصقات: صوّر العبوات | Label day: photograph the packs | RA 16 Nov |
| Counter | تم / بقي / من / حسب الممر | done / left / of / By aisle | RA 16 Nov |
| Slots | الواجهة (مطلوبة) · الخلف (مطلوبة) · الجانب | Front (needed) · Back (needed) · Side | RA 16 Nov |
| Slot help | واجهة العبوة كاملة. · ظهر العبوة كاملاً: المكوّنات ومسبّبات الحساسية والتحذيرات. · اختياري: الجانب الذي فيه جدول القيم الغذائية أو طريقة الاستعمال. | The whole front of the pack. · The whole back: ingredients, allergens, warnings. · Optional: the side with the nutrition panel or the directions. | RA 16 Nov |
| Buttons | التقط الصورة · التقطها من جديد · احفظ الصورة · المنتج التالي · امسح بالكاميرا · اختر من القائمة · ابحث · أرسل من جديد | Take the photo · Take it again · Save the photo · Next item · Scan with the camera · Pick from the list · Find · Send again | RA 16 Nov |
| States | تم الحفظ · بانتظار الإرسال: تبقى على هذا الهاتف · مرفوضة: انظر أدناه · لم تُلتقط بعد | Saved · Waiting to be sent: it stays on this phone · Refused: see below · Not yet | RA 16 Nov |
| Approvals | موافقات الملصقات · مسبّبات الحساسية · الحلال وبطاقات الحمية والشهادات · تحذيرات الخطر والتحذيرات المطبوعة · اختلاف المصادر · بقية قراءات الملصقات · أكّد · ارفض | Label approvals · Allergens · Halal, diet labels and certificates · Hazard and printed warnings · Disagreements between sources · The rest of the label readings · Confirm · Reject | RA 16 Nov |
| Menu | تصوير الملصقات · موافقات الملصقات | Label day photos · Label approvals | RA 16 Nov |


## SELL1, "coming soon" for a packaged item with no label reading yet (17 November 2026)

Source: `messages(...).basket.comingSoon` in `packages/agents/src/messages/ar.ts` (English and French in `en.ts` and `fr.ts`), and the website word `coming_soon` in `apps/web/src/lib/i18n.ts`.
Said by code, never by the model, only while the setting `sell_requires_label` is on and only for a packaged item whose label has not been read and approved by a person; `docs/HANDOFF.md`, SELL1.
It promises no date and gives no reason about the product (invariants 14 and 15). Written by a model; read by the coordinator on 17 November ("RA 17 Nov"; the changes are applied) (the same rule as every other new line).

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `basket.comingSoon(["لبنة"])` | جايي قريباً، لسّا ما فينا نبيعو:<br>• لبنة<br>قلّي شو بدك بدالو، أو منشيلو. | Coming soon, we can't take it yet:<br>• لبنة<br>Tell me what you'd like instead, or remove it. | Bientôt disponible, nous ne pouvons pas encore le vendre :<br>• لبنة<br>Dites-moi ce que vous voulez à la place, ou retirez-le. | RA 17 Nov |
| `basket.comingSoon(["لبنة", "خبز"])` | جايي قريباً، لسّا ما فينا نبيعو:<br>• لبنة<br>• خبز<br>قلّي شو بدك بدالو، أو منشيلو. | Coming soon, we can't take it yet:<br>• لبنة<br>• خبز<br>Tell me what you'd like instead, or remove it. | Bientôt disponible, nous ne pouvons pas encore le vendre :<br>• لبنة<br>• خبز<br>Dites-moi ce que vous voulez à la place, ou retirez-le. | RA 17 Nov |
| website `coming_soon` (the label that replaces "In stock" on a card and on the page) | قريباً | Coming soon | Bientôt disponible | RA 17 Nov |
## DS2, the order status words (17 November 2026; RA 17 Nov)

Source: `STATUS_LABELS` in `packages/ui/src/status.ts`, the one label table for order statuses (`docs/DECISIONS.md`, "Design reference,
17 November 2026"). The customer words are **not shown to any customer yet**: the website's order page is WEB2's, and WhatsApp messages
keep their own wording in `packages/agents/src/messages/ar.ts`. Read by the coordinator on 17 November ("RA 17 Nov"); two were changed (`preparing`, `ready`). The staff words and the
two navigation words (`nav_dispatch`: «التوزيع», `nav_intake`: «التصوير», `apps/console/src/i18n.ts`) are staff-facing.

| Status (customer words) | Arabic | English | Read by |
|---|---|---|---|
| `status.awaiting_confirmation.customer` | بانتظار تأكيدك | Waiting for your Confirm || RA 17 Nov |
| `status.awaiting_payment.customer` | بانتظار الدفع | Waiting for payment || RA 17 Nov |
| `status.confirmed.customer` | مؤكد | Confirmed || RA 17 Nov |
| `status.preparing.customer` | نجهّز طلبك في المستودع | Packing at the hub || RA 17 Nov |
| `status.ready.customer` | جاهز | Packed || RA 17 Nov |
| `status.ready.pickup` | جاهز للاستلام | Ready for pickup || RA 17 Nov |
| `status.out_for_delivery.customer` | في الطريق | On the way || RA 17 Nov |
| `status.arrived.customer` | عند الباب | At your door || RA 17 Nov |
| `status.delivered.customer` | سُلّم | Delivered || RA 17 Nov |
| `status.delivered.pickup` | استُلم | Collected || RA 17 Nov |
| `status.failed_delivery.customer` | لم يُسلَّم | Not delivered || RA 17 Nov |
| `status.returned.customer` | أُعيد | Returned || RA 17 Nov |
| `status.cancelled.customer` | مُلغى | Cancelled || RA 17 Nov |


## UX2a, the six staff pages (console, staff-facing, written by a model; 17 November 2026)

Source: the `pick(L, "English", "Arabic")` pairs added to `apps/console/src/pages/{today,inbox,orders,pick,riderjobs,stock}.ts` and the two command-bar hints in `apps/console/src/i18n.ts`. Staff read these, never a customer. Words with `${…}` stand for a number or a name filled in by the page. Nothing here is a customer message. Read by the coordinator on 17 November ("RA 17 Nov"); the changes he made are applied here and in the code.

| English | Arabic | Read by |
|---|---|---|
| Orders waiting | طلبات بانتظارنا | RA 17 Nov |
| ${packedNoRider} packed, no rider yet | ${packedNoRider} جاهز بلا مندوب | RA 17 Nov |
| to pick | للتجهيز | RA 17 Nov |
| ${packedNoRider} waiting for a rider | ${packedNoRider} بانتظار مندوب | RA 17 Nov |
| Late | متأخرة | RA 17 Nov |
| past the zone time | تجاوزت وقت المنطقة | RA 17 Nov |
| none past the zone time | لا طلب تجاوز وقت المنطقة | RA 17 Nov |
| ${late} late | ${late} متأخرة | RA 17 Nov |
| Cash held | النقد مع المناديب | RA 17 Nov |
| ${d.riders.length} on shift | ${d.riders.length} في الوردية | RA 17 Nov |
| ${overCap.length} over the soft cap | ${overCap.length} فوق السقف المرن | RA 17 Nov |
| Cases open | حالات مفتوحة | RA 17 Nov |
| customers waiting for a person | زبائن بانتظار شخص | RA 17 Nov |
| ${inbox.lateCases} late | ${inbox.lateCases} متأخرة | RA 17 Nov |
| the ops lead is alerted | يُنبَّه مسؤول العمليات | RA 17 Nov |
| the founder is alerted and the customer is told we are on it | يُنبَّه المؤسس ويُبلَّغ الزبون أننا نتابع | RA 17 Nov |
| the case is marked late | تُعلَّم الحالة متأخرة | RA 17 Nov |
| Claimed: the steps are stopped while someone is answering. | مستلمة: توقفت الخطوات ما دام أحدهم يرد. | RA 17 Nov |
| done | تم | RA 17 Nov |
| next | التالي | RA 17 Nov |
| later | لاحقاً | RA 17 Nov |
| min | د | RA 17 Nov |
| Customers waiting for a person, the longest wait first. The bot keeps answering them meanwhile; press I'm on it to take a case and step the bot back. | الزبائن الذين ينتظرون شخصاً، الأطول انتظاراً أولاً. البوت يواصل الرد عليهم؛ اضغط «سأتولّاها» لتستلم الحالة ويتراجع البوت. | RA 17 Nov |
| I'm on it | سأتولّاها | RA 17 Nov |
| I'm on it (the bot steps back) | سأتولّاها (يتوقف البوت) | RA 17 Nov |
| the closest match | أقرب بديل | RA 17 Nov |
| take it off the order | أزل البند من الطلب | RA 17 Nov |
| ask me first | اسألني أولاً | RA 17 Nov |
| no code needed | لا رمز مطلوب | RA 17 Nov |
| code checked ${when_(h.verifiedAt)} | فُحص الرمز ${when_(h.verifiedAt)} | RA 17 Nov |
| locked after ${h.attempts} wrong tries: a person decides | مقفل بعد ${h.attempts} محاولات خاطئة: يقرّر شخص | RA 17 Nov |
| Cancel this order | إلغاء هذا الطلب | RA 17 Nov |
| Free until picking starts. The customer is told by message. This cannot be taken back. | مجاني حتى يبدأ التجهيز. يُبلَّغ الزبون برسالة. لا يمكن التراجع. | RA 17 Nov |
| ${usd(x.terms.paid_usd)} was paid: give it back on the Refunds page afterwards. | دُفع ${usd(x.terms.paid_usd)}: أعده من صفحة الاسترداد بعد ذلك. | RA 17 Nov |
| Why (for the record) | السبب (للسجل) | RA 17 Nov |
| Cancel the order | إلغاء الطلب | RA 17 Nov |
| It cannot be cancelled here: ${why[x.terms?.reason ?? ""]?.[0] ?? "the database says no"}. | لا يمكن إلغاؤه من هنا: ${why[x.terms?.reason ?? ""]?.[1] ?? "قاعدة البيانات ترفض"}. | RA 17 Nov |
| Confirm the payment | تأكيد الدفع | RA 17 Nov |
| Hand over at the hub | التسليم في المستودع | RA 17 Nov |
| Decide it as a rider incident | قرّر بوصفها حادثة مندوب | RA 17 Nov |
| It closes when its payment is recorded: delivered is not paid. | يُغلق عند تسجيل دفعه: التسليم لا يعني الدفع. | RA 17 Nov |
| Payments | المدفوعات | RA 17 Nov |
| Status | الحالة | RA 17 Nov |
| Picker | المجهّز | RA 17 Nov |
| nobody yet | لا أحد بعد | RA 17 Nov |
| Rider | المندوب | RA 17 Nov |
| none yet | لا مندوب بعد | RA 17 Nov |
| paid | مدفوع | RA 17 Nov |
| not paid yet | لم يُدفع بعد | RA 17 Nov |
| Handover code | رمز التسليم | RA 17 Nov |
| If an item is missing | إن نقص صنف | RA 17 Nov |
| customer chose | اختار الزبون | RA 17 Nov |
| What you can do | ما يمكنك فعله | RA 17 Nov |
| No step is open to staff from this status. | لا خطوة متاحة للموظفين من هذه الحالة. | RA 17 Nov |
| picked | أُخذ | RA 17 Nov |
| substituted | استُبدل | RA 17 Nov |
| removed | أُزيل | RA 17 Nov |
| replaces | بديل عن | RA 17 Nov |
| Status history | سجل الحالات | RA 17 Nov |
| No change yet. | لا تغيير بعد. | RA 17 Nov |
| Put back | أعِده | RA 17 Nov |
| Picked | أُخذ من الرف | RA 17 Nov |
| the closest match: the system keeps one for them | أقرب بديل: يحتفظ النظام به لهم | RA 17 Nov |
| ask them first | اسألهم أولاً | RA 17 Nov |
| If a line is missing, the customer chose: | إن نقص بند، اختار الزبون: | RA 17 Nov |
| In walking order | بترتيب المشي في المستودع | RA 17 Nov |
| All picked: packing | أُخذ من الرف: التعبئة | RA 17 Nov |
| Packing (${l.lines.length - picked + pending.length} left) | التعبئة (بقي ${l.lines.length - picked + pending.length}) | RA 17 Nov |
| Soft cap ${usd(soft)} warns. Hard cap ${usd(hard)} blocks new cash orders until a drop. | السقف المرن ${usd(soft)} للتنبيه. السقف الصارم ${usd(hard)} يمنع الطلبات النقدية الجديدة حتى التسليم. | RA 17 Nov |
| has a job | لديه مهمة | RA 17 Nov |
| at the door | عند الباب | RA 17 Nov |
| delivered | سُلّم | RA 17 Nov |
| The customer's 4-digit code | رمز الزبون المكوّن من 4 أرقام | RA 17 Nov |
| Delivered | سُلّم | RA 17 Nov |
| at the hard cap: no new cash order | عند السقف الصارم: لا طلب نقدي جديد | RA 17 Nov |
| over the soft cap: plan a drop | فوق السقف المرن: خطّط لتسليم النقد | RA 17 Nov |
| at the hub | في المستودع | RA 17 Nov |
| counting cash still to collect | مع النقد المنتظر تحصيله | RA 17 Nov |
| soft ${usd(soft)}, hard ${usd(hard)} | مرن ${usd(soft)}، صارم ${usd(hard)} | RA 17 Nov |
| Cash drop | تسليم النقد | RA 17 Nov |
| Pick up at | الاستلام من | RA 17 Nov |
| the hub | المستودع | RA 17 Nov |
| ,  | ،  | RA 17 Nov |
| Still being picked at the hub: ${stillPicking.join(", ")}. Wait until it is packed. | ما زال قيد التجهيز في المستودع: ${stillPicking.join(pick(L, ", ", "، "))}. انتظر حتى يُجهَّز. | RA 17 Nov |
| Cash to record | نقد بانتظار التسجيل | RA 17 Nov |
| left on the road | تُرك في الطريق | RA 17 Nov |
| Give to this rider | أعطه لهذا المندوب | RA 17 Nov |
| No rider is on shift. Start a shift for one below. | لا مندوب في الوردية. ابدأ وردية أحدهم أدناه. | RA 17 Nov |
| pickup: no rider, no fee | استلام: بلا مندوب ولا رسم | RA 17 Nov |
| Dollars received | دولارات مستلمة | RA 17 Nov |
| Lira received | ليرات مستلمة | RA 17 Nov |
| Change given, dollars | الباقي بالدولار | RA 17 Nov |
| Change given, lira | الباقي بالليرة | RA 17 Nov |
| Collected | استُلم | RA 17 Nov |
| Dispatch | التوزيع | RA 17 Nov |
| Give packed orders to a rider. The rider keeps the whole delivery fee. You are acting for the rider: every tap is recorded under your name and shows on the order's timeline; the rider is not messaged, the customer is told when the goods leave. | أعطِ الطلبات الجاهزة لمندوب. يحتفظ المندوب بكامل رسم التوصيل. أنت تتصرف نيابةً عن المندوب: كل ضغطة تُسجَّل باسمك وتظهر في السجل الزمني للطلب؛ لا يُراسَل المندوب، ويُبلَغ الزبون عند خروج البضاعة. | RA 17 Nov |
| Packed, waiting for a rider | جاهز بانتظار مندوب | RA 17 Nov |
| No packed order is waiting for a rider. | لا طلب جاهز ينتظر مندوباً. | RA 17 Nov |
| Not packed yet | لم يُجهَّز بعد | RA 17 Nov |
| These can be given now; the rider leaves only when each is packed. | يمكن إعطاؤها الآن؛ لا يغادر المندوب إلا بعد تجهيز كل طلب. | RA 17 Nov |
| The system also offers these to riders on its own every minute. Giving one here offers it and accepts it for that rider. | يعرض النظام هذه الطلبات على المناديب تلقائياً كل دقيقة. الإعطاء هنا يعرضها ويقبلها نيابةً عن ذلك المندوب. | RA 17 Nov |
| Pickup shelf | رف الاستلام | RA 17 Nov |
| No order waits to be collected at the hub. | لا طلب ينتظر الاستلام من المستودع. | RA 17 Nov |
| Riders on shift | المناديب في الوردية | RA 17 Nov |
| No rider is on shift. | لا مندوب في الوردية. | RA 17 Nov |
| Off shift | خارج الوردية | RA 17 Nov |
| No rider is registered. | لا مندوب مسجّل. | RA 17 Nov |
| Too many wrong tries: the code is locked and a person decides. | محاولات خاطئة كثيرة: الرمز مقفل ويقرّر شخص. | RA 17 Nov |
| That is not the code. ${h.tries_left ?? 0} tries left. | هذا ليس الرمز. بقي ${h.tries_left ?? 0} محاولات. | RA 17 Nov |
| Delivered. Now record the cash the rider collected (below). | سُلّم. سجّل الآن النقد الذي حصّله المندوب (أدناه). | RA 17 Nov |
| Delivered. | سُلّم. | RA 17 Nov |
| Already handed over. | سُلّم بالفعل. | RA 17 Nov |
| That is not the code. ${r.tries_left ?? 0} tries left. | هذا ليس الرمز. بقي ${r.tries_left ?? 0} محاولات. | RA 17 Nov |
| This order is not ready to be collected. | هذا الطلب ليس جاهزاً للاستلام. | RA 17 Nov |
| Handed over and closed. | سُلّم وأُغلق. | RA 17 Nov |
| ${num_(free)} available | المتاح ${num_(free)} | RA 17 Nov |
| running low | ينفد قريباً | RA 17 Nov |
| use by ${s.expiry_date} | يُستهلك قبل ${s.expiry_date} | RA 17 Nov |
| on hand ${num_(onHand)}, reserved for open orders ${num_(reserved)} | في المخزن ${num_(onHand)}، محجوز لطلبات مفتوحة ${num_(reserved)} | RA 17 Nov |
| , reorder at ${num_(n(l.reorder_point))} | ، يُعاد الطلب عند ${num_(n(l.reorder_point))} | RA 17 Nov |
| Count or adjust | جرد أو تعديل | RA 17 Nov |
| Count the shelf | جرد الرف | RA 17 Nov |
| Counted | المعدود | RA 17 Nov |
| Why it differs (needed if it does) | سبب الفرق (مطلوب إن وُجد) | RA 17 Nov |
| Save the count | احفظ الجرد | RA 17 Nov |
| Adjust the stock | تعديل المخزون | RA 17 Nov |
| Change (+ or −) | التغيير (+ أو −) | RA 17 Nov |
| Reason (required) | السبب (مطلوب) | RA 17 Nov |
| Choose a reason | اختر سبباً | RA 17 Nov |
| Note | ملاحظة | RA 17 Nov |
| A movement is a record and is never edited: a mistake is put right by a new one with its own reason. | الحركة سجل لا يُعدَّل: يُصحَّح الخطأ بحركة جديدة بسببها. | RA 17 Nov |
| Save the change | احفظ التغيير | RA 17 Nov |
| The first ${LIMIT} are shown: search to find the rest. | المعروض أول ${LIMIT}: ابحث لتجد البقية. | RA 17 Nov |
| No item matches. | لا صنف مطابق. | RA 17 Nov |
| Out | نفد | RA 17 Nov |
| Nothing is out. | لا شيء نافد. | RA 17 Nov |
| Running low | ينفد قريباً | RA 17 Nov |
| Nothing is below its reorder point. | لا شيء تحت حدّ إعادة الطلب. | RA 17 Nov |
| Use within ${USE_SOON_DAYS} days | يُستهلك خلال ${USE_SOON_DAYS} أيام | RA 17 Nov |
| Nothing expires soon. | لا شيء تنتهي صلاحيته قريباً. | RA 17 Nov |
| Needs a look | يحتاج نظرة | RA 17 Nov |
| Every item | كل الأصناف | RA 17 Nov |
| Find an item | ابحث عن صنف | RA 17 Nov |
| name, brand or SKU | الاسم أو العلامة أو الرمز | RA 17 Nov |
| Search | بحث | RA 17 Nov |
| More stock pages | صفحات مخزون أخرى | RA 17 Nov |
| The books say ${num_(n(lvl?.on_hand ?? 0))}: write why the count differs. | الدفاتر تقول ${num_(n(lvl?.on_hand ?? 0))}: اكتب سبب اختلاف الجرد. | RA 17 Nov |
| That count was already saved. | حُفظ هذا الجرد بالفعل. | RA 17 Nov |
| Count saved: it matches the books. | حُفظ الجرد: يطابق الدفاتر. | RA 17 Nov |
| Count saved: the books had ${num_(n(r.expected))}, a difference of ${diff > 0 ? "+" : ""}${num_(diff)}. | حُفظ الجرد: كان في الدفاتر ${num_(n(r.expected))}، والفرق ${diff > 0 ? "+" : ""}${num_(diff)}. | RA 17 Nov |
| Choose the reason first: no change is saved without one. | اختر السبب أولاً: لا يُحفظ أي تغيير بدونه. | RA 17 Nov |
| Write a note for the reason Other. | اكتب ملاحظة للسبب «أخرى». | RA 17 Nov |
| That change was already saved. | حُفظ هذا التغيير بالفعل. | RA 17 Nov |
| Saved. On hand now ${num_(n(r?.on_hand ?? 0))}. | حُفظ. في المخزن الآن ${num_(n(r?.on_hand ?? 0))}. | RA 17 Nov |
| Found more | وُجدت زيادة | RA 17 Nov |
| Damaged | تالف | RA 17 Nov |
| Expired | منتهي الصلاحية | RA 17 Nov |
| Spoiled | فاسد | RA 17 Nov |
| Stolen | مسروق | RA 17 Nov |
| Recalled | مسحوب من السوق | RA 17 Nov |
| Sample | عيّنة | RA 17 Nov |
| Other (write a note) | أخرى (اكتب ملاحظة) | RA 17 Nov |
| Type an order code (AK-1042) and press Enter to open that order. Type a page name to filter the pages; anything else searches orders. | اكتب رمز طلب (AK-1042) واضغط Enter لفتحه. اكتب اسم صفحة لتصفية الصفحات؛ وأي شيء آخر يبحث في الطلبات. | RA 17 Nov |
| Type an order code (AK-1042) and press Enter to open its pick list. Type a page name to filter the pages; anything else searches the catalog. | اكتب رمز طلب (AK-1042) واضغط Enter لفتح قائمة تجهيزه. اكتب اسم صفحة لتصفية الصفحات؛ وأي شيء آخر يبحث في الكتالوج. | RA 17 Nov |

## LV1, the Chouf food places listed before they sign (17 November 2026)

Written by a model. The Arabic was read by the coordinator on 17 November ("RA 17 Nov"; the changes are applied below and in the code); the English and French still wait for a reader.
Three places hold words: the website (the `ar`, `en` and `fr` dictionaries in `apps/web/src/lib/i18n.ts`, the keys `food*` and `kind_*`: the test
`test/ci/listings-lv1.test.ts` checks this table lists every one, word for word), the one WhatsApp line (`messages(...).fixed.listingClaimed`), and the
console's Listings page (staff only, `apps/console/src/pages/listings.ts`, beside its English with `pick(L, en, ar)`). Neutral wording only: no
rating, praise, health or diet word, no promise that anything can be ordered from a listing (invariants 11 and 14). The names of the places are the
founder's file as it is: a business's name is not translated. The website's Arabic is the site's register (formal Arabic); the WhatsApp line is Lebanese, as every
fixed message is. `{km}`, `{n}`, `{total}` and `{name}` are filled by code.

### The website

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `web.food` | أماكن الطعام | Food places | Lieux pour manger | RA 17 Nov |
| `web.food_title` | أماكن الطعام في الشوف | Food places in the Chouf | Lieux pour manger dans le Chouf | RA 17 Nov |
| `web.food_tile_note` | ليس على ألو كينغ بعد | Not on Alo King yet | Pas encore sur Alo King | RA 17 Nov |
| `web.food_intro` | أماكن قريبة منك ليست على ألو كينغ بعد. لا يمكنك الطلب منها من هنا. أخبرنا أيّها تريد. ويستطيع أصحاب الأماكن المطالبة بصفحتهم أو إزالتها. | Places near you that are not on Alo King yet. You can't order from them here. Tell us which ones you want. Owners can claim a page or have it removed. | Des lieux près de chez vous qui ne sont pas encore sur Alo King. Vous ne pouvez pas y commander d'ici. Dites-nous lesquels vous voulez. Les propriétaires peuvent revendiquer leur page ou la faire retirer. | RA 17 Nov |
| `web.food_not_yet` | ليس على ألو كينغ بعد. لا يمكنك الطلب من هنا بعد. | Not on Alo King yet. You can't order from here yet. | Pas encore sur Alo King. Vous ne pouvez pas encore commander ici. | RA 17 Nov |
| `web.food_places` | عدد الأماكن: {n} | Places: {n} | Lieux : {n} | RA 17 Nov |
| `web.food_none` | لا توجد أماكن تطابق هذا. | No places match this. | Aucun lieu ne correspond. | RA 17 Nov |
| `web.food_km` | {km} كم من مستودعنا | {km} km from our hub | {km} km de notre centre | RA 17 Nov |
| `web.food_village_none` | القرية غير مذكورة | Village not listed | Village non indiqué | RA 17 Nov |
| `web.food_kind` | النوع | Kind | Type | RA 17 Nov |
| `web.food_village` | القرية | Village | Village | RA 17 Nov |
| `web.food_sort_distance` | المسافة من مستودعنا | Distance from our hub | Distance de notre centre | RA 17 Nov |
| `web.food_sort_name` | الاسم | Name | Nom | RA 17 Nov |
| `web.food_next` | التالي | Next | Suivant | RA 17 Nov |
| `web.food_prev` | السابق | Previous | Précédent | RA 17 Nov |
| `web.food_page` | الصفحة {n} من {total} | Page {n} of {total} | Page {n} sur {total} | RA 17 Nov |
| `web.food_map` | افتح في خرائط Google | Open in Google Maps | Ouvrir dans Google Maps | RA 17 Nov |
| `web.food_want` | أريد الطلب من هنا | I want to order from here | Je veux commander ici | RA 17 Nov |
| `web.food_asked` | شكرًا. سجّلنا أنك تريد الطلب من {name}. لا يلزمك أي شيء آخر. | Thanks. We've noted that you want to order from {name}. Nothing else is needed from you. | Merci. Nous avons noté que vous voulez commander chez {name}. Rien d'autre n'est nécessaire de votre part. | RA 17 Nov |
| `web.food_claim` | هل هذا مكانك؟ اطلب إدارته | Is this your place? Claim it | C'est votre établissement ? Revendiquez-le | RA 17 Nov |
| `web.food_claim_note` | يفتح هذا واتساب مع رسالة إلينا مكتوبة مسبقًا. أرسلها وسنتواصل معك. | This opens WhatsApp with a message to us already typed. Send it and we will get in touch. | Cela ouvre WhatsApp avec un message pour nous déjà écrit. Envoyez-le et nous vous contacterons. | RA 17 Nov |
| `web.food_remove` | إزالة هذه الصفحة | Remove this listing | Retirer cette page | RA 17 Nov |
| `web.food_remove_title` | إزالة هذه الصفحة | Remove this listing | Retirer cette page | RA 17 Nov |
| `web.food_remove_intro` | هذا يُخفي صفحة {name} فورًا. يُبلَّغ فريقنا وسينظر في الأمر. | This hides the page for {name} right away. Our team is told and will look at it. | Cela masque tout de suite la page de {name}. Notre équipe est prévenue et l'examinera. | RA 17 Nov |
| `web.food_who` | من أنت؟ | Who are you? | Qui êtes-vous ? | RA 17 Nov |
| `web.food_who_choose` | اختر | Choose | Choisir | RA 17 Nov |
| `web.food_who_owner` | صاحب المكان | The owner | Le propriétaire | RA 17 Nov |
| `web.food_who_manager` | مدير | A manager | Un gérant | RA 17 Nov |
| `web.food_who_staff` | موظف | Staff | Un employé | RA 17 Nov |
| `web.food_who_other` | شخص آخر | Someone else | Quelqu'un d'autre | RA 17 Nov |
| `web.food_who_error` | اختر من أنت. | Choose who you are. | Choisissez qui vous êtes. | RA 17 Nov |
| `web.food_reason` | لماذا؟ (اختياري) | Why? (optional) | Pourquoi ? (facultatif) | RA 17 Nov |
| `web.food_reason_hint` | من فضلك لا تكتب تفاصيل خاصة مثل الأرقام أو العناوين. | Please don't include private details such as numbers or addresses. | N'indiquez pas de détails privés, comme des numéros ou des adresses. | RA 17 Nov |
| `web.food_remove_go` | أخفِ هذه الصفحة | Hide this page | Masquer cette page | RA 17 Nov |
| `web.food_cancel` | إلغاء | Cancel | Annuler | RA 17 Nov |
| `web.food_removed` | تم. الصفحة مخفية وقد أُبلغ فريقنا. | Done. The page is hidden and our team has been told. | C'est fait. La page est masquée et notre équipe est prévenue. | RA 17 Nov |
| `web.food_remove_queued` | وصلنا طلبك. سينظر فريقنا فيه. | We have your request. Our team will look at it. | Nous avons votre demande. Notre équipe va l'examiner. | RA 17 Nov |
| `web.kind_restaurant` | مطعم | Restaurant | Restaurant | RA 17 Nov |
| `web.kind_cafe` | مقهى | Café | Café | RA 17 Nov |
| `web.kind_bakery` | مخبز | Bakery | Boulangerie | RA 17 Nov |
| `web.kind_sweets` | حلويات | Sweets | Pâtisserie | RA 17 Nov |
| `web.kind_catering` | تموين وضيافة | Catering | Traiteur | RA 17 Nov |
| `web.kind_butcher` | ملحمة | Butcher | Boucherie | RA 17 Nov |

### On WhatsApp (the reply to "Claim <listing_id>", read by code before any model)

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `fixed.listingClaimed("مخبز الشوف")` | وصلتنا رسالتك بخصوص مخبز الشوف.<br>رح يتواصل معك حدا من فريقنا هون على واتساب.<br>لحد ذاك ما رح يتغيّر شي على الصفحة. | We got your message about مخبز الشوف.<br>Someone from our team will get in touch with you here on WhatsApp.<br>Until then nothing changes on the page. | Nous avons bien reçu votre message au sujet de مخبز الشوف.<br>Quelqu'un de notre équipe vous contactera ici sur WhatsApp.<br>D'ici là, rien ne change sur la page. | RA 17 Nov |

### The console's Listings page (staff-facing)

| Place | Arabic | English | Read by |
|---|---|---|---|
| Menu and title | أماكن الطعام | Food places | RA 17 Nov |
| Tabs | بحث · المخفي والطلبات · المطالبات | Search · Hidden and requests · Claims | RA 17 Nov |
| Intro | أماكن طعام في الشوف مدرجة على الموقع قبل أن توقّع. الإدراج ليس تاجرًا: لا يمكن الطلب منه. يستطيع الزائر أن يقول إنه يريده، ويستطيع صاحب المكان المطالبة به أو إزالته. | Chouf food places listed on the website before they sign. A listing is not a merchant: nothing can be ordered from it. A visitor can say they want it, an owner can claim it or have it removed. | RA 17 Nov |
| Columns | المكان · النوع · القرية · كم · يريدونه · المطالبات · الحالة · إخفاء · الطلب · القرار · متى · أُرسلت من · الحالة | Place · Kind · Village · km · Wants · Claims · Status · Hide · Request · Decide · When · Sent from · Case | RA 17 Nov |
| States | ظاهر · مخفي · أغلق · بلا سبب · بلا رقم · غير مذكورة · مفتوحة: الوارد · مُغلقة | Listed · Hidden · closed · no reason given · no number · not listed · open: Inbox · resolved | RA 17 Nov |
| Who asked | صاحب المكان · مدير · موظف · شخص آخر | the owner · a manager · staff · someone else | RA 17 Nov |
| Limit note | تجاوز الحد: تُركت الصفحة ظاهرة لتقرّر أنت. | Over a limit: the page was left up for you to decide. | RA 17 Nov |
| Buttons | أعد الصفحة · أخفِ الصفحة · أخفِ · أغلق: أبقها مخفية · أغلق: أبقها ظاهرة · بحث | Restore the page · Hide the page · Hide · Close: keep it hidden · Close: leave it up · Search | RA 17 Nov |
| Fields | سبب الإعادة · سبب الإخفاء · السبب · ملاحظة · الاسم أو القرية | Reason to restore · Reason to hide · Reason · Note · Name or village | RA 17 Nov |
| Done | أُعيدت الصفحة وأُغلق الطلب. · أُخفيت الصفحة من الموقع. · أُبقيت مخفية وأُغلق الطلب. · أُغلق الطلب وتبقى الصفحة ظاهرة. | Restored: the page is back, and the request is closed. · Hidden: the page is gone from the website. · Kept hidden. The request is closed. · The request is closed and the page stays up. | RA 17 Nov |
| Refusals | اكتب السبب (٣ أحرف على الأقل). · هذا المكان غير صالح. · هذا الطلب غير صالح. | Write the reason (at least 3 characters). · That place is not valid. · That request is not valid. | RA 17 Nov |
| Empty | لا مطالبات بعد. · لا شيء مخفي ولا طلب بانتظار. · لا أماكن تطابق هذا. · تُعرض أول ٥٠: ابحث بالاسم أو القرية لتضييق النتائج. | No claims yet. · Nothing hidden and no request waiting. · No places match this. · The first 50 are shown: search by name or village to narrow it. | RA 17 Nov |
| Staff alert | مكان طعام طلب إزالة صفحته | A food place asked to be removed | RA 17 Nov |

## WEB2, the website's basket, sign-in, checkout, order page, history, account and "How it works" (17 November 2026)

Written by a model; **read by the coordinator on 17 November 2026 ("RA 17 Nov")**, who changed four Arabic lines (`w2_missing_best_match` «أقرب بديل», the customers' word since CX1; `w2_how_code_text`, which now names pickup orders too, with its English and French; `web.signedOut`; `web.codeUsed`); the rest were accepted as written.
Three places hold words: the website (the `w2_` keys of `apps/web/src/lib/i18n-web2.ts`, merged into the site's dictionary; the test
`test/ci/web2-words.test.ts` checks this table lists every one, word for word), the French words for the order statuses (`FR_STATUS` in
`apps/web/src/lib/order.ts`; Arabic and English come from DS2's label table, read on 17 November), and the WhatsApp lines (`messages(...).web`,
`card.changeForLbp` and `cx.missingItemLine` in `packages/agents/src/messages/`). The website's Arabic is the site's register (formal Arabic); the
WhatsApp lines are Lebanese, as every fixed message is. Neutral wording only: no rating, praise, health or diet word (invariants 14 and 15).
`{n}`, `{min}`, `{gap}`, `{village}`, `{code}`, `{days}`, `{cap}`, `{when}`, `{hours}`, `{below}`, `{r}`, `{l}`, `{name}`, `{for}` and `{date}` are filled by code
from the database. The order card itself is the WhatsApp card's own words (read before, CX1 and M1), printed by the website.

### The website

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `web.w2_basket` | السلة | Basket | Panier | RA 17 Nov |
| `web.w2_basket_n` | السلة، {n} منتج | Basket, {n} items | Panier, {n} articles | RA 17 Nov |
| `web.w2_account` | حسابي | Account | Compte | RA 17 Nov |
| `web.w2_orders` | طلباتك | Your orders | Vos commandes | RA 17 Nov |
| `web.w2_how` | كيف يعمل | How it works | Comment ça marche | RA 17 Nov |
| `web.w2_add` | أضف إلى السلة | Add to basket | Ajouter au panier | RA 17 Nov |
| `web.w2_added` | أُضيف إلى سلتك. | Added to your basket. | Ajouté à votre panier. | RA 17 Nov |
| `web.w2_view_basket` | اعرض السلة | View basket | Voir le panier | RA 17 Nov |
| `web.w2_basket_title` | سلتك | Your basket | Votre panier | RA 17 Nov |
| `web.w2_basket_empty` | سلتك فارغة. | Your basket is empty. | Votre panier est vide. | RA 17 Nov |
| `web.w2_basket_empty_text` | أضف منتجات من الأقسام أو من البحث. | Add items from the aisles or from search. | Ajoutez des articles depuis les rayons ou la recherche. | RA 17 Nov |
| `web.w2_browse` | تصفّح الأقسام | Browse the aisles | Parcourir les rayons | RA 17 Nov |
| `web.w2_qty` | الكمية | Quantity | Quantité | RA 17 Nov |
| `web.w2_less` | أنقص واحدًا | One less | Un de moins | RA 17 Nov |
| `web.w2_more` | زِد واحدًا | One more | Un de plus | RA 17 Nov |
| `web.w2_remove` | احذف | Remove | Retirer | RA 17 Nov |
| `web.w2_items_total` | المنتجات | Items | Articles | RA 17 Nov |
| `web.w2_delivery` | التوصيل | Delivery | Livraison | RA 17 Nov |
| `web.w2_delivery_to` | التوصيل إلى {village} | Delivery to {village} | Livraison à {village} | RA 17 Nov |
| `web.w2_small_fee` | رسم الطلب الصغير | Small-order fee | Frais de petite commande | RA 17 Nov |
| `web.w2_credit` | رصيدك | Your credit | Votre crédit | RA 17 Nov |
| `web.w2_dues` | مستحق من قبل | Owed from before | Dû d'avant | RA 17 Nov |
| `web.w2_total` | المجموع | Total | Total | RA 17 Nov |
| `web.w2_in_lira` | بالليرة، بسعر اليوم | In lira, at today's rate | En livres, au taux du jour | RA 17 Nov |
| `web.w2_fee_pick` | اختر قريتك لترى رسم التوصيل. | Choose your village to see the delivery fee. | Choisissez votre village pour voir les frais de livraison. | RA 17 Nov |
| `web.w2_village` | قريتك | Your village | Votre village | RA 17 Nov |
| `web.w2_village_show` | اعرض الرسم | Show the fee | Voir les frais | RA 17 Nov |
| `web.w2_min_missing` | الحد الأدنى للطلب {min}. أضف {gap} لتتمكّن من إتمام الطلب. | The minimum order is {min}. Add {gap} more to check out. | La commande minimum est de {min}. Ajoutez encore {gap} pour commander. | RA 17 Nov |
| `web.w2_min_ok` | بلغت الحد الأدنى للطلب. | The minimum order is reached. | La commande minimum est atteinte. | RA 17 Nov |
| `web.w2_checkout` | أتمّ الطلب | Check out | Commander | RA 17 Nov |
| `web.w2_sold_out` | نفد الآن، لذلك لم يُحسب: | Sold out now, so it is left out: | Épuisé pour l'instant, donc laissé de côté : | RA 17 Nov |
| `web.w2_coming_soon` | قريباً، لا نستطيع أخذه بعد: | Coming soon, we can't take it yet: | Bientôt disponible, nous ne pouvons pas encore le prendre : | RA 17 Nov |
| `web.w2_unknown` | لم يعد يُباع، لذلك لم يُحسب: | No longer sold, so it is left out: | Plus vendu, donc laissé de côté : | RA 17 Nov |
| `web.w2_price_changed` | تغيّر السعر منذ أضفته: | The price changed since you added it: | Le prix a changé depuis l'ajout : | RA 17 Nov |
| `web.w2_again_missing` | غير متوفر الآن، لذلك لم يُضَف: | Not available now, so not added: | Indisponible pour l'instant, donc pas ajouté : | RA 17 Nov |
| `web.w2_again_done` | طلبك الأخير في السلة بأسعار اليوم. | Your last order is in the basket at today's prices. | Votre dernière commande est dans le panier, aux prix du jour. | RA 17 Nov |
| `web.w2_prices_note` | نقرأ الأسعار والتوفر من متجرنا من جديد في كل مرة تفتح فيها هذه الصفحة. | Prices and stock are read again from our shop each time you open this page. | Les prix et le stock sont relus dans notre magasin à chaque ouverture de cette page. | RA 17 Nov |
| `web.w2_rider_fee_note` | رسم التوصيل يذهب كاملًا إلى عامل التوصيل. | The delivery fee goes to the rider in full. | Les frais de livraison vont entièrement au livreur. | RA 17 Nov |
| `web.w2_signin_title` | أكّد رقمك على واتساب | Confirm your number on WhatsApp | Confirmez votre numéro sur WhatsApp | RA 17 Nov |
| `web.w2_signin_lead` | لا كلمة مرور ولا شيء لتكتبه. رسالة واحدة من واتساب الخاص بك تؤكد رقمك وتُبقي هذا الجهاز مسجّلًا لمدة {days} يومًا. | No password, nothing to type. One message from your own WhatsApp confirms your number and signs in this device for {days} days. | Pas de mot de passe, rien à taper. Un message depuis votre propre WhatsApp confirme votre numéro et garde cet appareil connecté pendant {days} jours. | RA 17 Nov |
| `web.w2_signin_button` | أكّد رقمك على واتساب | Confirm your number on WhatsApp | Confirmer votre numéro sur WhatsApp | RA 17 Nov |
| `web.w2_signin_step1` | اضغط الزر. يُفتح واتساب والرمز مكتوب مسبقًا. | Tap the button. WhatsApp opens with a code already typed. | Appuyez sur le bouton. WhatsApp s'ouvre avec un code déjà écrit. | RA 17 Nov |
| `web.w2_signin_step2` | اضغط إرسال. لا تغيّر الرمز. | Press send. Do not change the code. | Appuyez sur envoyer. Ne changez pas le code. | RA 17 Nov |
| `web.w2_signin_step3` | عُد إلى هذه الصفحة. تتحدّث وحدها. | Come back to this page. It updates by itself. | Revenez sur cette page. Elle se met à jour toute seule. | RA 17 Nov |
| `web.w2_signin_code` | رمزك | Your code | Votre code | RA 17 Nov |
| `web.w2_signin_open` | افتح واتساب | Open WhatsApp | Ouvrir WhatsApp | RA 17 Nov |
| `web.w2_signin_waiting` | بانتظار رسالتك. | Waiting for your message. | En attente de votre message. | RA 17 Nov |
| `web.w2_signin_expires` | يعمل الرمز لمدة {n} دقائق. | The code works for {n} minutes. | Le code est valable {n} minutes. | RA 17 Nov |
| `web.w2_signin_done` | تأكّد رقمك. هذا الجهاز مسجّل الدخول. | Your number is confirmed. This device is signed in. | Votre numéro est confirmé. Cet appareil est connecté. | RA 17 Nov |
| `web.w2_signin_continue` | تابِع | Continue | Continuer | RA 17 Nov |
| `web.w2_signin_consent` | بإرسال الرمز تؤكد رقمك وتسمح لنا بإرسال تحديثات طلباتك في هذه المحادثة. | Sending the code confirms your number and lets us send your order updates in this chat. | Envoyer le code confirme votre numéro et nous permet d'envoyer le suivi de vos commandes dans cette conversation. | RA 17 Nov |
| `web.w2_signin_no_wa` | عنوان واتساب الخاص بنا غير محدّد بعد، لذلك لا يمكن تسجيل الدخول الآن. | Our WhatsApp address is not set yet, so signing in is not possible yet. | Notre adresse WhatsApp n'est pas encore définie : la connexion n'est pas encore possible. | RA 17 Nov |
| `web.w2_signin_b1` | كل طلباتك في مكان واحد | Every order in one place | Toutes vos commandes au même endroit | RA 17 Nov |
| `web.w2_signin_b1_text` | الطلبات التي أرسلتها عبر واتساب وهنا. | Orders you placed on WhatsApp and here. | Les commandes passées sur WhatsApp et ici. | RA 17 Nov |
| `web.w2_signin_b2` | أماكنك | Your places | Vos adresses | RA 17 Nov |
| `web.w2_signin_b2_text` | تُحفظ مرة وتُستعمل في الاثنين. | Saved once, used on both. | Enregistrées une fois, utilisées des deux côtés. | RA 17 Nov |
| `web.w2_signin_b3` | أنت فقط | Only you | Vous seul | RA 17 Nov |
| `web.w2_signin_b3_text` | يُثبت رقمك برسالة من واتساب الخاص بك. يمكنك تسجيل الخروج من كل الأجهزة في أي وقت. | Your number is proven by a message from your own WhatsApp. Sign out on every device at any time. | Votre numéro est prouvé par un message depuis votre propre WhatsApp. Déconnectez tous vos appareils à tout moment. | RA 17 Nov |
| `web.w2_checkout_title` | إتمام الطلب | Checkout | Commande | RA 17 Nov |
| `web.w2_step_place` | إلى أين؟ | Where to? | Où livrer ? | RA 17 Nov |
| `web.w2_saved_places` | الأماكن المحفوظة | Saved places | Adresses enregistrées | RA 17 Nov |
| `web.w2_no_places` | لا يوجد مكان محفوظ بعد. | No saved place yet. | Aucune adresse enregistrée. | RA 17 Nov |
| `web.w2_use_location` | استعمل موقعي | Use my location | Utiliser ma position | RA 17 Nov |
| `web.w2_location_hint` | يطلب هاتفك مرة واحدة مشاركة موقعك. الموقع يحدّد القرية ورسم التوصيل. | Your phone asks once to share your location. The pin decides the village and the fee. | Votre téléphone demande une fois de partager votre position. La position décide du village et des frais. | RA 17 Nov |
| `web.w2_paste_pin` | أو الصق رابط خريطة أو إحداثيات | Or paste a map link or coordinates | Ou collez un lien de carte ou des coordonnées | RA 17 Nov |
| `web.w2_paste_hint` | مثلًا رابط من خرائط Google، أو 33.68, 35.56 | For example a Google Maps link, or 33.68, 35.56 | Par exemple un lien Google Maps, ou 33.68, 35.56 | RA 17 Nov |
| `web.w2_save_pin` | احفظ هذا الموقع | Save this pin | Enregistrer cette position | RA 17 Nov |
| `web.w2_send_location` | أرسل موقعي عبر واتساب | Send my location on WhatsApp | Envoyer ma position sur WhatsApp | RA 17 Nov |
| `web.w2_send_location_hint` | في المحادثة، اضغط على المشبك، ثم الموقع، ثم إرسال. يظهر مكانك هنا بعد ذلك. | In the chat, tap the clip, then Location, then send. Your place then appears here. | Dans la conversation, touchez le trombone, puis Position, puis envoyer. Votre adresse apparaît ensuite ici. | RA 17 Nov |
| `web.w2_refresh` | أرسلته، حدّث الصفحة | I sent it, refresh | Je l'ai envoyée, actualiser | RA 17 Nov |
| `web.w2_pin_located` | الموقع في {village}. | Pinned in {village}. | Position à {village}. | RA 17 Nov |
| `web.w2_pin_unsure` | في أي قرية هذا الموقع؟ | Which village is this pin in? | Dans quel village est cette position ? | RA 17 Nov |
| `web.w2_pin_outside` | لا نوصّل إلى هناك بعد. يمكنك أن تسألنا عبر واتساب. | We don't deliver there yet. You can ask us on WhatsApp. | Nous ne livrons pas encore là-bas. Vous pouvez nous demander sur WhatsApp. | RA 17 Nov |
| `web.w2_pin_not_served` | لا نوصّل إلى {village} بعد. | We don't deliver to {village} yet. | Nous ne livrons pas encore à {village}. | RA 17 Nov |
| `web.w2_pin_bad` | لم نستطع قراءة موقع من هذا. | We could not read a position from that. | Nous n'avons pas pu lire de position. | RA 17 Nov |
| `web.w2_pin_choose` | اختر | Choose | Choisir | RA 17 Nov |
| `web.w2_house` | البيت أو المبنى | House or building | Maison ou immeuble | RA 17 Nov |
| `web.w2_floor` | الطابق | Floor | Étage | RA 17 Nov |
| `web.w2_directions` | إرشادات لعامل التوصيل (اختياري) | Directions for the rider (optional) | Indications pour le livreur (facultatif) | RA 17 Nov |
| `web.w2_save` | احفظ | Save | Enregistrer | RA 17 Nov |
| `web.w2_has_pin` | محدّد على الخريطة | Pinned | Position enregistrée | RA 17 Nov |
| `web.w2_no_pin` | بلا موقع | No pin | Sans position | RA 17 Nov |
| `web.w2_step_when` | متى؟ | When? | Quand ? | RA 17 Nov |
| `web.w2_now` | بأسرع وقت | As soon as possible | Dès que possible | RA 17 Nov |
| `web.w2_now_eta` | بأسرع وقت (حوالي {n} دقيقة) | As soon as possible (about {n} min) | Dès que possible (environ {n} min) | RA 17 Nov |
| `web.w2_now_closed` | نحن مغلقون الآن. اختر موعدًا للتوصيل. | We're closed now. Choose a delivery window. | Nous sommes fermés. Choisissez un créneau de livraison. | RA 17 Nov |
| `web.w2_windows_none` | لا مواعيد توصيل في الأيام القادمة. | No delivery windows in the coming days. | Aucun créneau de livraison dans les prochains jours. | RA 17 Nov |
| `web.w2_step_missing` | إذا نقص منتج | If an item is missing | Si un article manque | RA 17 Nov |
| `web.w2_missing_best_match` | أقرب بديل | The closest match | Le plus proche | RA 17 Nov |
| `web.w2_missing_ask` | راسلني أولًا | Message me first | M'écrire d'abord | RA 17 Nov |
| `web.w2_missing_remove` | احذفه | Leave it out | Le retirer | RA 17 Nov |
| `web.w2_missing_per_item` | اختر لكل منتج | Choose per item | Choisir article par article | RA 17 Nov |
| `web.w2_missing_same` | كما في الأعلى | Same as above | Comme ci-dessus | RA 17 Nov |
| `web.w2_step_pay` | الدفع | Payment | Paiement | RA 17 Nov |
| `web.w2_pay_usd` | نقدًا بالدولار | Cash in dollars | Espèces en dollars | RA 17 Nov |
| `web.w2_pay_lbp` | نقدًا بالليرة، بسعر اليوم | Cash in lira, at today's rate | Espèces en livres, au taux du jour | RA 17 Nov |
| `web.w2_pay_rate` | سعر اليوم للدولار الواحد: | Today's rate for one dollar: | Le taux du jour pour un dollar : | RA 17 Nov |
| `web.w2_pay_whish` | تحويل عبر Whish | Whish transfer | Virement Whish | RA 17 Nov |
| `web.w2_pay_omt` | تحويل عبر OMT | OMT transfer | Virement OMT | RA 17 Nov |
| `web.w2_pay_transfer_note` | يتحقق شخص من تحويلك قبل أن نجهّز الطلب. نرسل لك التفاصيل عبر واتساب بعد أن تؤكد. | A person checks your transfer before we pack. We send the details on WhatsApp after you confirm. | Une personne vérifie votre virement avant la préparation. Nous envoyons les détails sur WhatsApp après votre confirmation. | RA 17 Nov |
| `web.w2_note` | بأي ورقة ستدفع؟ | Which note will you pay with? | Avec quel billet payerez-vous ? | RA 17 Nov |
| `web.w2_note_exact` | المبلغ تمامًا | The exact amount | Le montant exact | RA 17 Nov |
| `web.w2_note_lbp` | كم ستدفع؟ | How much will you hand over? | Combien donnerez-vous ? | RA 17 Nov |
| `web.w2_no_card` | الدفع بالبطاقة أو Whish Pay لاحقًا. | Paying by card or Whish Pay comes later. | Le paiement par carte ou Whish Pay viendra plus tard. | RA 17 Nov |
| `web.w2_first_cap` | يُدفع الطلب الأول نقدًا حتى {cap}. هذا الطلب أكبر، فاختر Whish أو OMT. | A first order is paid in cash up to {cap}. This order is larger, so choose Whish or OMT. | Une première commande se paie en espèces jusqu'à {cap}. Celle-ci est plus grande : choisissez Whish ou OMT. | RA 17 Nov |
| `web.w2_step_notes` | شيء آخر؟ (اختياري) | Anything else? (optional) | Autre chose ? (facultatif) | RA 17 Nov |
| `web.w2_card` | بطاقة طلبك | Your order card | Votre bon de commande | RA 17 Nov |
| `web.w2_update` | حدّث البطاقة | Update the card | Mettre à jour le bon | RA 17 Nov |
| `web.w2_send_card` | أرسل الطلب إلى واتساب الخاص بي | Send the order to my WhatsApp | Envoyer la commande sur mon WhatsApp | RA 17 Nov |
| `web.w2_confirm_on_wa` | لم يُطلب شيء بعد. نرسل هذه البطاقة إلى واتساب الخاص بك، ويُرسل الطلب عندما تضغط «تأكيد» هناك. | Nothing is ordered yet. We send this card to your WhatsApp, and the order is placed when you tap Confirm there. | Rien n'est encore commandé. Nous envoyons ce bon sur votre WhatsApp, et la commande est passée quand vous touchez Confirmer là-bas. | RA 17 Nov |
| `web.w2_need_place` | اختر مكانًا أو حدّد موقعًا أولًا. | Choose or pin a place first. | Choisissez ou enregistrez d'abord une adresse. | RA 17 Nov |
| `web.w2_need_details` | أضف البيت والطابق ليجدك عامل التوصيل. | Add the house and floor, so the rider finds you. | Ajoutez la maison et l'étage, pour que le livreur vous trouve. | RA 17 Nov |
| `web.w2_err_not_ready` | تغيّر شيء في البطاقة. راجعها وأرسلها من جديد. | Something on the card changed. Check it and send again. | Quelque chose a changé sur le bon. Vérifiez-le et renvoyez-le. | RA 17 Nov |
| `web.w2_err_note_too_small` | هذا المبلغ ليس أكثر من المجموع. | That amount is not more than the total. | Ce montant n'est pas supérieur au total. | RA 17 Nov |
| `web.w2_err_unknown_note` | اختر أحد المبالغ في القائمة. | Choose one of the amounts in the list. | Choisissez un des montants de la liste. | RA 17 Nov |
| `web.w2_err_closed` | نحن مغلقون الآن. اختر موعدًا للتوصيل. | We're closed now. Choose a delivery window. | Nous sommes fermés. Choisissez un créneau de livraison. | RA 17 Nov |
| `web.w2_err_village` | لا نوصّل إلى هذا المكان بعد. | We don't deliver to this place yet. | Nous ne livrons pas encore à cette adresse. | RA 17 Nov |
| `web.w2_err_fx` | نحدّث سعر اليوم الآن. حاول بعد دقائق. | We're updating today's rate. Try again in a few minutes. | Nous mettons à jour le taux du jour. Réessayez dans quelques minutes. | RA 17 Nov |
| `web.w2_err_empty` | سلتك فارغة. | Your basket is empty. | Votre panier est vide. | RA 17 Nov |
| `web.w2_err_window` | لم يعد هذا الموعد متاحًا. اختر موعدًا آخر. | That delivery window is no longer open. Choose another. | Ce créneau n'est plus ouvert. Choisissez-en un autre. | RA 17 Nov |
| `web.w2_err_not_linked` | أكّد رقمك أولًا. | Confirm your number first. | Confirmez d'abord votre numéro. | RA 17 Nov |
| `web.w2_err_any` | لم نستطع الإرسال. حاول بعد قليل. | We could not send it. Try again in a moment. | L'envoi n'a pas abouti. Réessayez dans un instant. | RA 17 Nov |
| `web.w2_order_title` | الطلب {code} | Order {code} | Commande {code} | RA 17 Nov |
| `web.w2_order_waiting` | بطاقة طلبك على واتساب. اضغط «تأكيد» هناك لإرسال الطلب. | Your order card is on WhatsApp. Tap Confirm there to place the order. | Votre bon de commande est sur WhatsApp. Touchez Confirmer là-bas pour passer la commande. | RA 17 Nov |
| `web.w2_order_waiting_note` | لا نحجز شيئًا قبل أن تؤكد. تنتهي البطاقة بعد {n} دقيقة من إنشائها. | Nothing is held until you confirm. The card lapses {n} minutes after it was made. | Rien n'est réservé avant votre confirmation. Le bon expire {n} minutes après sa création. | RA 17 Nov |
| `web.w2_order_resend` | لم تصلك البطاقة؟ افتح واتساب وأرسل الرسالة المكتوبة: تعود البطاقة فورًا. | Didn't get the card? Open WhatsApp and send the message we typed: the card comes back at once. | Vous n'avez pas reçu le bon ? Ouvrez WhatsApp et envoyez le message préparé : le bon revient aussitôt. | RA 17 Nov |
| `web.w2_order_open_wa` | افتح واتساب | Open WhatsApp | Ouvrir WhatsApp | RA 17 Nov |
| `web.w2_order_steps` | أين طلبك | Where your order is | Où en est votre commande | RA 17 Nov |
| `web.w2_order_window` | التوصيل: {when} | Delivery: {when} | Livraison : {when} | RA 17 Nov |
| `web.w2_order_eta` | التوصيل خلال حوالي {n} دقيقة بعد خروجه من المستودع. | Delivery in about {n} minutes once it leaves the hub. | Livraison en environ {n} minutes une fois partie du dépôt. | RA 17 Nov |
| `web.w2_order_changed` | ما الذي تغيّر | What changed | Ce qui a changé | RA 17 Nov |
| `web.w2_order_removed` | حُذف: | Taken off: | Retiré : | RA 17 Nov |
| `web.w2_order_substituted` | {name} بدل {for} | {name} instead of {for} | {name} à la place de {for} | RA 17 Nov |
| `web.w2_order_code` | رمز التسليم | Your handover code | Votre code de remise | RA 17 Nov |
| `web.w2_order_code_note` | أعطه فقط عندما يصبح طلبك بين يديك. | Give it only when you have your order in your hands. | Donnez-le seulement quand vous avez votre commande en main. | RA 17 Nov |
| `web.w2_order_person` | تحدّث إلى شخص | Talk to a person | Parler à une personne | RA 17 Nov |
| `web.w2_order_cancelled` | هذا الطلب مُلغى. | This order is cancelled. | Cette commande est annulée. | RA 17 Nov |
| `web.w2_order_items` | في هذا الطلب | In this order | Dans cette commande | RA 17 Nov |
| `web.w2_order_updates` | تتحدّث هذه الصفحة وحدها. | This page updates by itself. | Cette page se met à jour toute seule. | RA 17 Nov |
| `web.w2_order_payment` | الدفع | Payment | Paiement | RA 17 Nov |
| `web.w2_today` | اليوم | today | aujourd'hui | RA 17 Nov |
| `web.w2_tomorrow` | غدًا | tomorrow | demain | RA 17 Nov |
| `web.w2_orders_title` | طلباتك | Your orders | Vos commandes | RA 17 Nov |
| `web.w2_orders_none` | لا طلبات بعد. | No orders yet. | Pas encore de commande. | RA 17 Nov |
| `web.w2_on_whatsapp` | عبر واتساب | On WhatsApp | Sur WhatsApp | RA 17 Nov |
| `web.w2_on_web` | عبر الموقع | On the website | Sur le site | RA 17 Nov |
| `web.w2_order_again` | اطلبه مجددًا | Order again | Commander à nouveau | RA 17 Nov |
| `web.w2_view` | اعرض | View | Voir | RA 17 Nov |
| `web.w2_items_n` | {n} منتج | {n} items | {n} articles | RA 17 Nov |
| `web.w2_account_title` | حسابك | Your account | Votre compte | RA 17 Nov |
| `web.w2_places` | الأماكن المحفوظة | Saved places | Adresses enregistrées | RA 17 Nov |
| `web.w2_language` | اللغة | Language | Langue | RA 17 Nov |
| `web.w2_memory` | ما نتذكّره | What we remember | Ce que nous retenons | RA 17 Nov |
| `web.w2_memory_intro` | ما نستعمله لتسريع الطلب. يمكنك أن تراه أو تمحوه أو توقفه، هنا أو عبر واتساب. | What we use to make ordering quicker. You can see it, forget it or stop it, here or on WhatsApp. | Ce qui nous sert à rendre la commande plus rapide. Vous pouvez le voir, l'effacer ou l'arrêter, ici ou sur WhatsApp. | RA 17 Nov |
| `web.w2_mem_restrictions` | القيود التي طلبت أن نحفظها (تُطبَّق دائمًا) | Restrictions you asked us to keep (always applied) | Restrictions que vous nous avez demandé de garder (toujours appliquées) | RA 17 Nov |
| `web.w2_mem_usuals` | منتجات تطلبها كثيرًا | Items you often order | Articles que vous commandez souvent | RA 17 Nov |
| `web.w2_mem_brands` | ماركات اخترتها | Brands you chose | Marques choisies | RA 17 Nov |
| `web.w2_mem_notes` | ملاحظات | Notes | Notes | RA 17 Nov |
| `web.w2_mem_payment` | طريقة دفعك المعتادة | How you usually pay | Votre façon habituelle de payer | RA 17 Nov |
| `web.w2_mem_none` | لا شيء بعد. | Nothing yet. | Rien pour l'instant. | RA 17 Nov |
| `web.w2_mem_paused` | التذكّر متوقف: لا نتعلّم شيئًا جديدًا ولا نستعمل ما تعلّمناه. القيود التي طلبت حفظها ما زالت تُطبَّق. | Remembering is stopped: we learn nothing new and use nothing learned. Restrictions you asked us to keep still apply. | La mémoire est arrêtée : nous n'apprenons rien de nouveau et n'utilisons rien d'appris. Les restrictions que vous avez demandé de garder s'appliquent toujours. | RA 17 Nov |
| `web.w2_forget` | امحُ ما تعلّمناه | Forget what we learned | Effacer ce que nous avons appris | RA 17 Nov |
| `web.w2_forget_done` | تم. محونا ما تعلّمناه، هنا وعلى واتساب. | Done. We forgot what we had learned, here and on WhatsApp. | C'est fait. Nous avons effacé ce que nous avions appris, ici et sur WhatsApp. | RA 17 Nov |
| `web.w2_stop` | أوقف التذكّر | Stop remembering | Arrêter de retenir | RA 17 Nov |
| `web.w2_start` | تذكّر من جديد | Remember again | Retenir à nouveau | RA 17 Nov |
| `web.w2_signout` | سجّل الخروج من هذا الجهاز | Sign out of this device | Se déconnecter de cet appareil | RA 17 Nov |
| `web.w2_signout_all` | سجّل الخروج من كل الأجهزة | Sign out on every device | Se déconnecter de tous les appareils | RA 17 Nov |
| `web.w2_signout_all_done` | سُجّل الخروج من كل الأجهزة. | Signed out on every device. | Déconnecté de tous les appareils. | RA 17 Nov |
| `web.w2_signed_out` | سُجّل خروجك من هذا الجهاز. | You're signed out of this device. | Vous êtes déconnecté de cet appareil. | RA 17 Nov |
| `web.w2_signed_in_until` | يبقى هذا الجهاز مسجّلًا حتى {date}. | This device stays signed in until {date}. | Cet appareil reste connecté jusqu'au {date}. | RA 17 Nov |
| `web.w2_signout_wa` | يمكنك أيضًا أن ترسل لنا «تسجيل الخروج» عبر واتساب. | You can also send "sign out" to us on WhatsApp. | Vous pouvez aussi nous envoyer « déconnexion » sur WhatsApp. | RA 17 Nov |
| `web.w2_need_signin` | أكّد رقمك لترى هذه الصفحة. | Confirm your number to see this page. | Confirmez votre numéro pour voir cette page. | RA 17 Nov |
| `web.w2_pay_cod` | نقدًا عند الاستلام | Cash on delivery | Espèces à la livraison | RA 17 Nov |
| `web.w2_how_title` | كيف يعمل ألو كينغ | How Alo King works | Comment fonctionne Alo King | RA 17 Nov |
| `web.w2_how_lead` | بقالة من متجرنا في الشوف، يوصلها عمّال التوصيل لدينا. اطلب عبر واتساب أو هنا؛ وتؤكد كل طلب عبر واتساب. | Groceries from our own shop in the Chouf, brought by our riders. Order on WhatsApp or here; you confirm every order on WhatsApp. | Des courses de notre propre magasin dans le Chouf, apportées par nos livreurs. Commandez sur WhatsApp ou ici ; vous confirmez chaque commande sur WhatsApp. | RA 17 Nov |
| `web.w2_how_ways` | ثلاث طرق للطلب | Three ways to order | Trois façons de commander | RA 17 Nov |
| `web.w2_how_way_text` | اكتب طلبك على واتساب. | Type your order on WhatsApp. | Écrivez votre commande sur WhatsApp. | RA 17 Nov |
| `web.w2_how_way_voice` | أرسل رسالة صوتية على واتساب. | Send a voice note on WhatsApp. | Envoyez un message vocal sur WhatsApp. | RA 17 Nov |
| `web.w2_how_way_web` | املأ سلة هنا، ثم أكّد عبر واتساب. | Fill a basket here, then confirm on WhatsApp. | Remplissez un panier ici, puis confirmez sur WhatsApp. | RA 17 Nov |
| `web.w2_how_steps` | من السلة إلى الباب | From basket to door | Du panier à la porte | RA 17 Nov |
| `web.w2_how_step1` | اختر منتجاتك. الأسعار والتوفر من متجرنا. | Choose your items. Prices and stock come from our shop. | Choisissez vos articles. Prix et stock viennent de notre magasin. | RA 17 Nov |
| `web.w2_how_step2` | نرسل بطاقة الطلب إلى واتساب الخاص بك. | We send the order card to your WhatsApp. | Nous envoyons le bon de commande sur votre WhatsApp. | RA 17 Nov |
| `web.w2_how_step3` | اضغط «تأكيد» على البطاقة. عندها فقط يُرسل الطلب. | Tap Confirm on the card. Only then is it ordered. | Touchez Confirmer sur le bon. C'est seulement alors que c'est commandé. | RA 17 Nov |
| `web.w2_how_step4` | نجهّزه ويوصله عامل التوصيل. تدفع عند الاستلام. | We pack it and our rider brings it. Pay when it arrives. | Nous préparons et notre livreur l'apporte. Vous payez à l'arrivée. | RA 17 Nov |
| `web.w2_how_when` | الساعات والحد الأدنى | Hours and minimum | Horaires et minimum | RA 17 Nov |
| `web.w2_how_hours` | مفتوح كل يوم، {hours}. | Open every day, {hours}. | Ouvert tous les jours, {hours}. | RA 17 Nov |
| `web.w2_how_min` | الحد الأدنى للطلب: | Minimum order: | Commande minimum : | RA 17 Nov |
| `web.w2_how_fees` | رسم التوصيل حسب القرية | Delivery fee by village | Frais de livraison par village | RA 17 Nov |
| `web.w2_how_village` | القرية | Village | Village | RA 17 Nov |
| `web.w2_how_fee` | الرسم | Fee | Frais | RA 17 Nov |
| `web.w2_how_time` | الوقت | Time | Délai | RA 17 Nov |
| `web.w2_how_small` | رسم الطلب الصغير دون {below}: | Small-order fee under {below}: | Frais de petite commande en dessous de {below} : | RA 17 Nov |
| `web.w2_how_pay` | الدفع | Paying | Payer | RA 17 Nov |
| `web.w2_how_pay_cash` | نقدًا بالدولار، أو بالليرة بسعر اليوم. قل بأي ورقة ستدفع ويحضر لك عامل التوصيل الباقي. | Cash in dollars, or in lira at the day's rate. Say which note you'll pay with and the rider brings change. | En espèces, en dollars ou en livres au taux du jour. Dites avec quel billet vous payez et le livreur apporte la monnaie. | RA 17 Nov |
| `web.w2_how_pay_rate` | سعر اليوم للدولار الواحد: | Today's rate for one dollar: | Le taux du jour pour un dollar : | RA 17 Nov |
| `web.w2_how_pay_transfer` | تحويل عبر Whish أو OMT: أرسل صورة الإيصال في المحادثة. يتحقق منه شخص قبل أن نجهّز الطلب. | Whish or OMT transfer: send the receipt photo in the chat. A person checks it before we pack. | Virement Whish ou OMT : envoyez la photo du reçu dans la conversation. Une personne le vérifie avant la préparation. | RA 17 Nov |
| `web.w2_how_first` | يُدفع الطلب الأول نقدًا حتى {cap}؛ وما فوق ذلك بالتحويل. | A first order is paid in cash up to {cap}; above that, by transfer. | Une première commande se paie en espèces jusqu'à {cap} ; au-delà, par virement. | RA 17 Nov |
| `web.w2_how_missing` | إذا نقص شيء | If something is missing | Si quelque chose manque | RA 17 Nov |
| `web.w2_how_missing_text` | تختار في كل طلب: الأقرب إليه، أو رسالة أولًا، أو حذفه، للكل أو لكل منتج. | You choose on each order: the closest match, a message first, or leave it out, for everything or per item. | Vous choisissez à chaque commande : le plus proche, un message d'abord, ou le retirer, pour tout ou article par article. | RA 17 Nov |
| `web.w2_how_confirm` | التأكيد | Confirming | Confirmer | RA 17 Nov |
| `web.w2_how_confirm_text` | لا نحجز شيئًا قبل أن تضغط «تأكيد». تذكير واحد بعد {r} دقيقة؛ تنتهي البطاقة بعد {l} دقيقة، ويمكنك فتحها من جديد. | Nothing is held until you tap Confirm. One reminder after {r} minutes; the card lapses after {l} minutes, and you can open it again. | Rien n'est réservé avant que vous touchiez Confirmer. Un rappel après {r} minutes ; le bon expire après {l} minutes, et vous pouvez le rouvrir. | RA 17 Nov |
| `web.w2_how_code` | رمز التسليم | The handover code | Le code de remise | RA 17 Nov |
| `web.w2_how_code_text` | الطلب المدفوع مسبقًا، والطلب الذي تستلمه من المستودع، لا يُسلَّم إلا مقابل رمز من 4 أرقام نرسله لك. | A prepaid order, and an order you collect at the hub, is handed over only against a 4-digit code we send you. | Une commande payée d'avance, et une commande que vous retirez au dépôt, ne sont remises que contre un code à 4 chiffres que nous vous envoyons. | RA 17 Nov |
| `web.w2_how_account` | حسابك وخصوصيتك | Your account and privacy | Votre compte et votre vie privée | RA 17 Nov |
| `web.w2_how_account_text` | لا كلمة مرور: رسالة واحدة عبر واتساب تؤكد رقمك. سجّل الخروج متى شئت، واطّلع على ما نتذكّره أو امحُه. | No password: one WhatsApp message confirms your number. Sign out at any time, and see or forget what we remember. | Pas de mot de passe : un message WhatsApp confirme votre numéro. Déconnectez-vous à tout moment, voyez ou effacez ce que nous retenons. | RA 17 Nov |
| `web.w2_how_cta` | ابدأ التسوّق | Start shopping | Commencer les courses | RA 17 Nov |
| `web.w2_page_prev` | السابق | Previous | Précédent | RA 17 Nov |
| `web.w2_page_next` | التالي | Next | Suivant | RA 17 Nov |
| `web.w2_page_n` | الصفحة {n} من {total} | Page {n} of {total} | Page {n} sur {total} | RA 17 Nov |

### French status words (the label table has Arabic and English; French reads these for the same ids)

| Status id | French | Read by |
|---|---|---|
| `draft` | Pas encore envoyée | RA 17 Nov |
| `awaiting_confirmation` | En attente de votre confirmation | RA 17 Nov |
| `awaiting_payment` | En attente du paiement | RA 17 Nov |
| `confirmed` | Confirmée | RA 17 Nov |
| `preparing` | En préparation au dépôt | RA 17 Nov |
| `ready` | Prête | RA 17 Nov |
| `out_for_delivery` | En route | RA 17 Nov |
| `arrived` | À votre porte | RA 17 Nov |
| `delivered` | Livrée | RA 17 Nov |
| `failed_delivery` | Non livrée | RA 17 Nov |
| `returned` | Retournée | RA 17 Nov |
| `closed` | Livrée | RA 17 Nov |
| `cancelled` | Annulée | RA 17 Nov |

### On WhatsApp (read by code before any model; and two new lines on the order card)

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `web.linked` | ✅ تأكّد رقمك.<br>ارجع عالموقع وكمّل طلبك من هونيك. | ✅ Your number is confirmed.<br>Go back to the website to finish your order. | ✅ Votre numéro est confirmé.<br>Retournez sur le site pour terminer votre commande. | RA 17 Nov |
| `web.codeExpired` | هالرمز انتهت صلاحيته.<br>ارجع عالموقع واضغط «أكّد رقمك على واتساب» من جديد. | This code has expired.<br>Go back to the website and tap "Confirm your number on WhatsApp" again. | Ce code a expiré.<br>Retournez sur le site et appuyez de nouveau sur « Confirmer votre numéro sur WhatsApp ». | RA 17 Nov |
| `web.codeUsed` | هالرمز انستعمل من رقم تاني.<br>ارجع عالموقع واطلب رمز جديد. | Another number already used this code.<br>Go back to the website for a new one. | Un autre numéro a déjà utilisé ce code.<br>Retournez sur le site pour en avoir un nouveau. | RA 17 Nov |
| `web.codeUnknown` | ما عرفنا هالرمز.<br>ارجع عالموقع واضغط «أكّد رقمك على واتساب» من جديد. | We don't know this code.<br>Go back to the website and tap "Confirm your number on WhatsApp" again. | Nous ne connaissons pas ce code.<br>Retournez sur le site et appuyez de nouveau sur « Confirmer votre numéro sur WhatsApp ». | RA 17 Nov |
| `web.signedOut(1)` | ✅ طلّعناك من حسابك عالموقع.<br>طلباتك ومحادثتك هون باقيين متل ما هنّي. | ✅ You are signed out of the website.<br>Your orders and this chat stay as they are. | ✅ Vous êtes déconnecté du site.<br>Vos commandes et cette conversation restent telles quelles. | RA 17 Nov |
| `web.signedOut(2)` | ✅ طلّعناك من حسابك عالموقع على كل الأجهزة.<br>طلباتك ومحادثتك هون باقيين متل ما هنّي. | ✅ You are signed out of the website on every device.<br>Your orders and this chat stay as they are. | ✅ Vous êtes déconnecté du site sur tous vos appareils.<br>Vos commandes et cette conversation restent telles quelles. | RA 17 Nov |
| `web.notSignedIn` | ما في جهاز مسجّل دخول على الموقع برقمك. | No device is signed in to the website with your number. | Aucun appareil n'est connecté au site avec votre numéro. | RA 17 Nov |
| `web.cardNotWaiting("AK-1042")` | الطلب AK-1042 ما عاد ناطر تأكيد.<br>إذا بدك تعرف وين صار، اسألني هون. | Order AK-1042 is no longer waiting for your Confirm.<br>Ask me here if you want to know where it is. | La commande AK-1042 n'attend plus votre confirmation.<br>Demandez-moi ici si vous voulez savoir où elle en est. | RA 17 Nov |
| `web.cardUnknown` | ما لقينا طلب إلك بهالرقم.<br>اكتبلي شو بدك ومنساعدك. | We found no order of yours with that number.<br>Tell me what you need and we'll help. | Nous n'avons trouvé aucune commande à vous avec ce numéro.<br>Dites-moi ce qu'il vous faut et nous vous aiderons. | RA 17 Nov |
| `card.changeForLbp` | رح تدفع بالليرة، ومعك:<br>2,000,000 ل.ل | You pay in lira, with:<br>2,000,000 LBP | Vous payez en livres, avec :<br>2,000,000 LBP | RA 17 Nov |
| `cx.missingItemLine("Labneh 500 g", best_match)` | Labneh 500 g: منحطّ أقرب بديل | Labneh 500 g: we put the closest match | Labneh 500 g : nous mettons le plus proche | RA 17 Nov |
| `cx.missingItemLine("Labneh 500 g", ask)` | Labneh 500 g: منسألك | Labneh 500 g: we ask you | Labneh 500 g : nous vous demandons | RA 17 Nov |
| `cx.missingItemLine("Labneh 500 g", remove)` | Labneh 500 g: منشيلو من الطلب | Labneh 500 g: we take it off | Labneh 500 g : nous le retirons | RA 17 Nov |

## UX2b, Approve, Intake, Money, Settings and Riders (console, staff-facing, written by a model; 17 November 2026)

Source: the `pick(L, "English", "Arabic")` pairs and the `{ en, ar }` entries added to `apps/console/src/pages/{approve,intakeframe,intake,readiness,moneyframe,payments,money,refunds,riders,settings,settingmeta}.ts`, and one line of `labelqueue.ts`. Staff read these, never a customer. Words with `${…}` stand for a number or a name the page fills in. The hub is «المستودع» everywhere (never «المركز»). Lines already in an earlier table of this file (UX2a, LB1, SELL1) are not repeated. The database's refusals (`explain()` in `app.ts`) stay English, as for every older page. A test (`test/ci/ux2b-arabic.test.ts`) holds this table equal to the pages.

| English | Arabic | Read by |
|---|---|---|
| Cards | البطاقات | RA 17 Nov |
| Card ${n + 1} of ${total} | البطاقة ${n + 1} من ${total} | RA 17 Nov |
| Previous | السابقة | RA 17 Nov |
| Skip for now | تخطَّ الآن | RA 17 Nov |
| Reason (needed to reject) | السبب (مطلوب للرفض) | RA 17 Nov |
| Prefer a list?  | تفضّل قائمة؟  | RA 17 Nov |
| See all of these as a list | اعرض كلها كقائمة | RA 17 Nov |
| This item is not in the catalog database, so nothing can be applied. | هذا الصنف غير موجود في قاعدة الكتالوج، فلا يمكن تطبيق شيء. | RA 17 Nov |
| The catalog name has changed since this was proposed: check that the proposal still fits. | تغيّر اسم الكتالوج منذ اقتراح هذا: تأكد أن الاقتراح ما زال مناسباً. | RA 17 Nov |
| The Arabic was written by a model: it needs a person who reads Arabic. | العربية كتبها نموذج: تحتاج شخصاً يقرأ العربية. | RA 17 Nov |
| Words the generator had to add: | كلمات اضطر المولّد لإضافتها: | RA 17 Nov |
| no brand | بلا علامة | RA 17 Nov |
| In the catalog now | في الكتالوج الآن | RA 17 Nov |
| English name | الاسم بالإنجليزية | RA 17 Nov |
| Arabic name | الاسم بالعربية | RA 17 Nov |
| Proposed | المقترح | RA 17 Nov |
| Will be saved as | سيُحفظ باسم | RA 17 Nov |
| Open Food Facts calls it: | يسمّيه Open Food Facts: | RA 17 Nov |
| Approving saves the name, queues its search words again, and shows an Undo for a moment: undoing puts the earlier name back. | الموافقة تحفظ الاسم وتعيد بناء كلمات بحثه، وتظهر «تراجع» للحظات: التراجع يعيد الاسم السابق. | RA 17 Nov |
| Correct it first | صحّحه أولاً | RA 17 Nov |
| English size | الحجم بالإنجليزية | RA 17 Nov |
| Arabic size | الحجم بالعربية | RA 17 Nov |
| Note (why) | ملاحظة (السبب) | RA 17 Nov |
| Save my correction | احفظ تصحيحي | RA 17 Nov |
| barcode | الباركود | RA 17 Nov |
| Proposed picture of | الصورة المقترحة لـ | RA 17 Nov |
| Picture not available. | الصورة غير متاحة. | RA 17 Nov |
| Source | المصدر | RA 17 Nov |
| original | الأصل | RA 17 Nov |
| Licence | الترخيص | RA 17 Nov |
| Fetched | جُلبت | RA 17 Nov |
| Never shown to customers | لا تُعرض للزبائن أبداً | RA 17 Nov |
| (licence unknown): approving keeps it only as a guide for the intake photo. | (الترخيص غير معروف): الموافقة تبقيها دليلاً لصورة الإدخال فقط. | RA 17 Nov |
| Approve only if the picture shows exactly this item: same brand, product and size, one pack, plain background, no price tag, shop logo or text on top. | وافق فقط إن كانت الصورة تُظهر هذا الصنف تماماً: العلامة والمنتج والحجم نفسها، عبوة واحدة، خلفية سادة، بلا بطاقة سعر أو شعار متجر أو كتابة فوقها. | RA 17 Nov |
| A picture's approval cannot be undone from here: it replaces the earlier picture. A wrong one is rejected on the Pictures page. | لا يمكن التراجع عن الموافقة على صورة من هنا: فهي تحلّ محل الصورة السابقة. الصورة الخاطئة تُرفض في صفحة الصور. | RA 17 Nov |
| The pack says | العبوة تقول | RA 17 Nov |
| One line each, as printed | سطر لكل تحذير كما هو مطبوع | RA 17 Nov |
| As printed | كما هو مطبوع | RA 17 Nov |
| Group ${x.group} of 5: ${GROUP(L, x.group)[0]} | المجموعة ${x.group} من 5: ${GROUP(L, x.group)[0]} | RA 17 Nov |
| no photo | لا صورة | RA 17 Nov |
| Printed words | الكلمات المطبوعة | RA 17 Nov |
| Read from | مأخوذ من | RA 17 Nov |
| Another source said otherwise: | مصدر آخر قال غير ذلك: | RA 17 Nov |
| The label's reading wins; check the photo. | قراءة الملصق هي المعتمدة؛ تحقق من الصورة. | RA 17 Nov |
| I looked at the label photo and it says this. | نظرت إلى صورة الملصق وهو يقول هذا. | RA 17 Nov |
| Nothing is published until you confirm it, and a confirmation cannot be undone here: a wrong fact is corrected on the item's own page. | لا يُنشر شيء حتى تؤكده، ولا يمكن التراجع عن التأكيد من هنا: تُصحَّح المعلومة الخاطئة في صفحة الصنف. | RA 17 Nov |
| on order | على الطلب | RA 17 Nov |
| given back as | يُعاد عبر | RA 17 Nov |
| A refund above ${usd(limits?.refund_usd ?? 10)} needs a second person. | استرداد فوق ${usd(limits?.refund_usd ?? 10)} يحتاج شخصاً ثانياً. | RA 17 Nov |
| A price change of more than ${limits?.price_change_pct ?? 10}% needs a second person. | تغيير سعر بأكثر من ${limits?.price_change_pct ?? 10}% يحتاج شخصاً ثانياً. | RA 17 Nov |
| Exchange rate | سعر الصرف | RA 17 Nov |
| Any change to the LBP rate needs a second person. | أي تغيير في سعر الليرة يحتاج شخصاً ثانياً. | RA 17 Nov |
| Setting | إعداد | RA 17 Nov |
| A change to this rule needs a second person. | تغيير هذه القاعدة يحتاج شخصاً ثانياً. | RA 17 Nov |
| A transfer more than 5% over the order total needs a second person. | تحويل يزيد عن مجموع الطلب بأكثر من 5% يحتاج شخصاً ثانياً. | RA 17 Nov |
| Two-person rule | قاعدة الشخصين | RA 17 Nov |
| Asked by | طلبها | RA 17 Nov |
| Waiting for someone else: the person who asked can never approve. | بانتظار شخص آخر: من طلبها لا يستطيع الموافقة أبداً. | RA 17 Nov |
| Needs you as the second person. | تحتاجك كشخص ثانٍ. | RA 17 Nov |
| Approve: make the change | وافق: نفّذ التغيير | RA 17 Nov |
| Approving makes the change as it was asked, in the asker's name. Money and settings are not undone from here. | الموافقة تنفّذ التغيير كما طُلب، باسم من طلبه. لا يُتراجع عن المال والإعدادات من هنا. | RA 17 Nov |
| Why (optional) | السبب (اختياري) | RA 17 Nov |
| Withdraw my request | اسحب طلبي | RA 17 Nov |
| Names | الأسماء | RA 17 Nov |
| Second approvals | الموافقات الثانية | RA 17 Nov |
| This list is not available yet: the database is missing a part of it. | هذه القائمة غير متاحة بعد: قاعدة البيانات ينقصها جزء منها. | RA 17 Nov |
| Nothing waits here. | لا شيء ينتظر هنا. | RA 17 Nov |
| One card at a time. Nothing is decided by moving between cards, and nothing is decided by a swipe. | بطاقة واحدة في كل مرة. لا يُقرَّر شيء بالتنقل بين البطاقات، ولا بالسحب. | RA 17 Nov |
|  Keys: a approves, r rejects (it asks for a reason), the arrow or space skips. |  المفاتيح: a للموافقة، r للرفض (يطلب سبباً)، السهم أو المسافة للتخطي. | RA 17 Nov |
| Approval pages as lists | صفحات الموافقات كقوائم | RA 17 Nov |
| Progress | التقدّم | RA 17 Nov |
| Readiness | الجاهزية | RA 17 Nov |
| Intake | الإدخال | RA 17 Nov |
| Photographed | صُوّر | RA 17 Nov |
| ${progress.left} left | بقي ${progress.left} | RA 17 Nov |
| front and back of every pack | واجهة كل عبوة وخلفها | RA 17 Nov |
| to decide | للبتّ | RA 17 Nov |
| label readings, allergens first | قراءات الملصقات، مسبّبات الحساسية أولاً | RA 17 Nov |
| Sellable | قابل للبيع | RA 17 Nov |
| the core is complete | الأساسيات مكتملة | RA 17 Nov |
| Label-ready | جاهز بملصقه | RA 17 Nov |
| of the packaged items | من المنتجات المعبّأة | RA 17 Nov |
| to do | للعمل | RA 17 Nov |
| Selling requires a label | لا بيع قبل الملصق | RA 17 Nov |
| On | مفعّل | RA 17 Nov |
| Off | معطّل | RA 17 Nov |
| Shown here and never changed from here. It is the setting | يُعرض هنا ولا يتغيّر من هنا. إنه الإعداد | RA 17 Nov |
| When it is on, a packaged item whose label has not been read and approved by a person cannot be quoted, added to a card or shown as orderable: the chat and the site say “coming soon”. Loose produce, meat and bakery with no real barcode are not packaged and sell on the core. | عند تفعيله لا يمكن تسعير منتج معبّأ لم يُقرأ ملصقه ويعتمده شخص، ولا إضافته إلى بطاقة ولا عرضه قابلاً للطلب: تقول المحادثة والموقع «جايي قريباً». الخضار والفواكه واللحوم والمخبوزات السائبة بلا باركود حقيقي ليست معبّأة وتُباع على الأساسيات. | RA 17 Nov |
| The steps to turn it on | خطوات التفعيل | RA 17 Nov |
| Photograph every pack | صوّر كل عبوة | RA 17 Nov |
| Front and back of each item, on the Photograph tab (the label day). | واجهة كل منتج وخلفه، في تبويب التصوير (يوم الملصقات). | RA 17 Nov |
| Run the label reading | شغّل قراءة الملصقات | RA 17 Nov |
| Once the photos are in: GitHub, Actions, label-read, Run workflow (the Founder actions in the handoff say exactly where). | بعد وصول الصور: GitHub ثم Actions ثم label-read ثم Run workflow (يوضّح قسم إجراءات المؤسس في وثيقة التسليم المكان بالضبط). | RA 17 Nov |
| Approve the readings | اعتمد القراءات | RA 17 Nov |
| Label approvals: allergens first, then halal and certificates, warnings, disagreements, the rest. Each against the photo. | موافقات الملصقات: مسبّبات الحساسية أولاً ثم الحلال والشهادات والتحذيرات والاختلافات وبقية القراءات. كل واحدة مقابل الصورة. | RA 17 Nov |
| Nothing in stock is left unlabelled | لا شيء في المخزون بلا ملصق | RA 17 Nov |
| ${notReadyInStock} packaged item(s) in stock are not label-ready. The Readiness tab lists them under “packaged, not label-ready”. | ${notReadyInStock} منتج معبّأ في المخزون ليس جاهزاً بملصقه. تعرضها تبويب الجاهزية تحت «معبّأ، ملصقه غير جاهز». | RA 17 Nov |
| The Readiness tab lists what is left. | يعرض تبويب الجاهزية ما تبقّى. | RA 17 Nov |
| Switch it on in Settings | فعّله من الإعدادات | RA 17 Nov |
| The admin turns it on under Settings, Switches; it needs a second person to approve (the ops lead or another admin). It can be switched off at once. | يفعّله المدير من الإعدادات ثم المفاتيح؛ ويحتاج موافقة شخص ثانٍ (مسؤول العمليات أو مدير آخر). ويمكن إيقافه فوراً. | RA 17 Nov |
| Open Settings | افتح الإعدادات | RA 17 Nov |
| Scan a pack | امسح عبوة | RA 17 Nov |
| Barcode or SKU | الباركود أو الرمز | RA 17 Nov |
|  and read the label |  واقرأ الملصق | RA 17 Nov |
| The label is read by a model to save typing. What it reads is only a proposal: a person checks every field against the pack. | يقرأ نموذج الملصق لتوفير الكتابة. ما يقرأه مجرد اقتراح: يتحقق شخص من كل حقل مقابل العبوة. | RA 17 Nov |
| No label reader is set up on this console (no model key): the photos are saved, and the fields are typed from the pack on the item's page. | لا قارئ ملصقات مهيّأ في هذه اللوحة (لا مفتاح نموذج): تُحفظ الصور وتُكتب الحقول من العبوة في صفحة الصنف. | RA 17 Nov |
| Waiting to be checked against the pack (${waiting.length} items) | بانتظار التحقق مقابل العبوة (${waiting.length} منتج) | RA 17 Nov |
| Items with fields to check | منتجات فيها حقول للتحقق | RA 17 Nov |
| Nothing waits. | لا شيء ينتظر. | RA 17 Nov |
| Barcode | الباركود | RA 17 Nov |
| Fields | الحقول | RA 17 Nov |
| Label reading | قراءة الملصق | RA 17 Nov |
| Staff | الموظفون | RA 17 Nov |
| all items | كل المنتجات | RA 17 Nov |
| not sellable | غير قابل للبيع | RA 17 Nov |
| sellable, facts not confirmed | قابل للبيع، حقائقه غير مؤكدة | RA 17 Nov |
| fact-complete | حقائقه مكتملة | RA 17 Nov |
| packaged, not label-ready | معبّأ، ملصقه غير جاهز | RA 17 Nov |
| blocks the catalog | يمنع الكتالوج | RA 17 Nov |
| something missing | ينقصه شيء | RA 17 Nov |
| sellable | قابل للبيع | RA 17 Nov |
| for fact-complete: | لتكتمل حقائقه: | RA 17 Nov |
| needs: | يحتاج: | RA 17 Nov |
| loose | سائب | RA 17 Nov |
| packaged, label-ready | معبّأ، ملصقه جاهز | RA 17 Nov |
| label missing: | ينقص الملصق: | RA 17 Nov |
| approved | معتمد | RA 17 Nov |
| waiting | بالانتظار | RA 17 Nov |
| kept as is | كما هو | RA 17 Nov |
| not reviewed | لم يُراجَع | RA 17 Nov |
| approved | معتمدة | RA 17 Nov |
| guide only (licence unknown) | دليل فقط (ترخيص مجهول) | RA 17 Nov |
| Food facts | المعلومات الغذائية | RA 17 Nov |
| all ${r.facts.allergens_of} allergens | كل مسبّبات الحساسية (${r.facts.allergens_of}) | RA 17 Nov |
| ingredients ok | المكوّنات سليمة | RA 17 Nov |
| no ingredients | لا مكوّنات | RA 17 Nov |
| allergens | مسبّبات الحساسية | RA 17 Nov |
| Cost | التكلفة | RA 17 Nov |
| known | معروفة | RA 17 Nov |
| Search words | كلمات البحث | RA 17 Nov |
| queued | في الطابور | RA 17 Nov |
| failed | فشلت | RA 17 Nov |
| not placed | غير موضوع | RA 17 Nov |
| none | لا يوجد | RA 17 Nov |
| unavailable | غير متاح | RA 17 Nov |
| Packaged items and their labels | المنتجات المعبّأة وملصقاتها | RA 17 Nov |
| Selling requires a label:  | لا بيع قبل الملصق:  | RA 17 Nov |
| on | مفعّل | RA 17 Nov |
| off | معطّل | RA 17 Nov |
| The setting | الإعداد | RA 17 Nov |
| , read only here: the steps are on the Progress tab and the switch is in Settings. When on, a packaged item whose label has not been read and approved by a person cannot be quoted, added to a card, found as orderable or shown as orderable: the chat and the site say “coming soon”. Loose produce, meat and bakery with no real barcode are not packaged and sell on the core. | ، للقراءة فقط هنا: الخطوات في تبويب التقدّم والمفتاح في الإعدادات. عند تفعيله لا يمكن تسعير منتج معبّأ لم يُقرأ ملصقه ويعتمده شخص، ولا إضافته إلى بطاقة ولا عرضه قابلاً للطلب: تقول المحادثة والموقع «جايي قريباً». الخضار والفواكه واللحوم والمخبوزات السائبة بلا باركود حقيقي ليست معبّأة وتُباع على الأساسيات. | RA 17 Nov |
| Readiness per template | الجاهزية لكل قالب | RA 17 Nov |
| Template | القالب | RA 17 Nov |
| Fact-complete | حقائقه مكتملة | RA 17 Nov |
| Packaged | معبّأ | RA 17 Nov |
| Label-ready | ملصقه جاهز | RA 17 Nov |
| The packaged items not label-ready, with what each misses, are under “packaged, not label-ready” below. | المنتجات المعبّأة غير الجاهزة بملصقاتها، وما ينقص كل واحد، تحت «معبّأ، ملصقه غير جاهز» أدناه. | RA 17 Nov |
| Product readiness | جاهزية المنتجات | RA 17 Nov |
| ${counts.not_sellable} not sellable | ${counts.not_sellable} غير قابل للبيع | RA 17 Nov |
| answers a filter such as “no added sugar” | يجيب عن مرشّح مثل «بلا سكر مضاف» | RA 17 Nov |
| ${counts.label} packaged not ready | ${counts.label} معبّأ غير جاهز | RA 17 Nov |
| customers cannot order these | لا يستطيع الزبائن طلبها | RA 17 Nov |
| the core is complete (names in English and Arabic, category with its template, storage, sale unit, price); it can be ordered and its facts read “not confirmed yet”. | الأساسيات مكتملة (الاسم بالإنجليزية والعربية، الفئة مع قالبها، التخزين، وحدة البيع، السعر)؛ يمكن طلبه وتُقرأ حقائقه «غير مؤكدة بعد». | RA 17 Nov |
| its template is complete too (for packaged food: ingredients, the 14 allergens and the nutrition panel; for a cleaning product: hazard warnings as printed); only these answer a filter such as “no added sugar” or “fragrance-free”. Facts need a re-check after 12 months. | قالبه مكتمل أيضاً (للأغذية المعبّأة: المكوّنات ومسبّبات الحساسية الأربعة عشر وجدول القيم الغذائية؛ ولمنتج التنظيف: تحذيرات الخطر كما هي مطبوعة)؛ هذه وحدها تجيب عن مرشّح مثل «بلا سكر مضاف» أو «بلا عطر». تحتاج الحقائق إعادة فحص بعد 12 شهراً. | RA 17 Nov |
| Level | المستوى | RA 17 Nov |
| What blocks | ما يمنع | RA 17 Nov |
| Blocks the catalog | يمنع الكتالوج | RA 17 Nov |
| the WhatsApp catalog leaves the item out (no approved picture a customer may see, not placed in a category, or no price). | يستبعد كتالوج واتساب المنتج (لا صورة معتمدة يجوز للزبون رؤيتها، أو غير موضوع في فئة، أو بلا سعر). | RA 17 Nov |
| a customer cannot order it at all (no price at the hub, or marked unavailable). A missing picture blocks the catalog, not ordering. Names, food facts, cost and search words do not stop a sale; they are listed so nothing is forgotten. Click what is missing to open the page that fixes it. | لا يستطيع الزبون طلبه أبداً (لا سعر في المستودع، أو معلَّم غير متاح). غياب الصورة يمنع الكتالوج لا الطلب. الأسماء والحقائق الغذائية والتكلفة وكلمات البحث لا توقف البيع؛ تُسرد كي لا يُنسى شيء. اضغط على الناقص لتفتح الصفحة التي تصلحه. | RA 17 Nov |
| Find an item | ابحث عن منتج | RA 17 Nov |
| SKU, name or brand | الرمز أو الاسم أو العلامة | RA 17 Nov |
| Nothing here. | لا شيء هنا. | RA 17 Nov |
| The first 200 of ${rows.length} are shown: search to find the rest. | المعروض أول 200 من ${rows.length}: ابحث لتجد البقية. | RA 17 Nov |
| To confirm | للتأكيد | RA 17 Nov |
| Refunds | المبالغ المستردة | RA 17 Nov |
| Money | المال | RA 17 Nov |
| Also: | أيضاً: | RA 17 Nov |
| Day open | فتح اليوم | RA 17 Nov |
| Day close | إغلاق اليوم | RA 17 Nov |
| ${n.approvals} waiting for a second person | ${n.approvals} بانتظار شخص ثانٍ | RA 17 Nov |
| Already ${r.already}; nothing changed. | سبق أن ${r.already}؛ لم يتغيّر شيء. | RA 17 Nov |
| The amount is ${Number(r.over_pct ?? 0).toFixed(1)}% over the order total: it waits for a second person on Approvals. Nothing is booked yet. | المبلغ يزيد ${Number(r.over_pct ?? 0).toFixed(1)}% عن مجموع الطلب: ينتظر شخصاً ثانياً في الموافقات. لم يُسجَّل شيء بعد. | RA 17 Nov |
| This late payment was already booked; nothing changed. | سُجّلت هذه الدفعة المتأخرة من قبل؛ لم يتغيّر شيء. | RA 17 Nov |
| Late payment booked as the customer's credit (${usd(r.amount_usd ?? 0)}). The order stays cancelled; the credit comes off their next order or is paid out on Refunds. | سُجّلت الدفعة المتأخرة رصيداً للزبون (${usd(r.amount_usd ?? 0)}). يبقى الطلب ملغى؛ ويُخصم الرصيد من طلبه التالي أو يُدفع من صفحة المبالغ المستردة. | RA 17 Nov |
| This order was already paid; the screenshot is closed. | هذا الطلب مدفوع من قبل؛ أُغلقت اللقطة. | RA 17 Nov |
| Payment confirmed and booked. ${usd(credit)} over the total is the customer's credit. | تم تأكيد الدفعة وتسجيلها. ${usd(credit)} فوق المجموع رصيد للزبون. | RA 17 Nov |
| Payment confirmed and booked. | تم تأكيد الدفعة وتسجيلها. | RA 17 Nov |
| Payments to confirm | دفعات للتأكيد | RA 17 Nov |
| Check the money in the Whish or OMT account first. Type the amount and the reference you see there, not what the screenshot says. | تحقق من المبلغ في حساب Whish أو OMT أولاً. اكتب المبلغ والمرجع كما تراهما هناك، لا كما في اللقطة. | RA 17 Nov |
| Screenshots | اللقطات | RA 17 Nov |
| None waiting. | لا شيء ينتظر. | RA 17 Nov |
| payment screenshot | لقطة الدفع | RA 17 Nov |
| expected | المتوقع | RA 17 Nov |
| Late payment. | دفعة متأخرة. | RA 17 Nov |
| The payment timer cancelled this order. If the money is in the account, confirm it: it becomes the customer's credit and the order stays cancelled. | ألغى مؤقّت الدفع هذا الطلب. إن كان المال في الحساب فأكّده: يصبح رصيداً للزبون ويبقى الطلب ملغى. | RA 17 Nov |
| Waiting for a second person | بانتظار شخص ثانٍ | RA 17 Nov |
| Approvals | الموافقات | RA 17 Nov |
| the amount is more than 5% over the total. | المبلغ يزيد عن المجموع بأكثر من 5%. | RA 17 Nov |
| This picture was sent before for another payment. | أُرسلت هذه الصورة من قبل لدفعة أخرى. | RA 17 Nov |
| Check the account carefully. | تحقق من الحساب بعناية. | RA 17 Nov |
| Read by the model (a hint, may be wrong): | قرأها النموذج (تلميح قد يكون خاطئاً): | RA 17 Nov |
| Amount received, USD | المبلغ المستلم بالدولار | RA 17 Nov |
| Reference | المرجع | RA 17 Nov |
| Book as the customer's credit | سجّلها رصيداً للزبون | RA 17 Nov |
| Confirm payment | أكّد الدفعة | RA 17 Nov |
| Reject screenshot | ارفض اللقطة | RA 17 Nov |
| Transfers without a screenshot | تحويلات بلا لقطة | RA 17 Nov |
| None. | لا شيء. | RA 17 Nov |
| Method | الطريقة | RA 17 Nov |
| Since | منذ | RA 17 Nov |
| Confirm, once the money is in the account | أكّد بعد وصول المال إلى الحساب | RA 17 Nov |
| amount USD | المبلغ بالدولار | RA 17 Nov |
| reference | المرجع | RA 17 Nov |
| Screenshot rejected. The customer still owes the transfer. | رُفضت اللقطة. ما زال الزبون مديناً بالتحويل. | RA 17 Nov |
| Already paid; nothing changed. | مدفوع من قبل؛ لم يتغيّر شيء. | RA 17 Nov |
| The drawer, by the books | الصندوق بحسب الدفاتر | RA 17 Nov |
| The bank | البنك | RA 17 Nov |
| transfers to check | تحويلات للتحقق | RA 17 Nov |
| to count with a rider | للعدّ مع مندوب | RA 17 Nov |
| Drawer by the books:  | الصندوق بحسب الدفاتر:  | RA 17 Nov |
| bank: | البنك: | RA 17 Nov |
| Count the drawer at day close; what is in it must match the books. Everything that leaves it is recorded here. | اعدّ الصندوق عند إغلاق اليوم؛ ما فيه يجب أن يطابق الدفاتر. كل ما يخرج منه يُسجَّل هنا. | RA 17 Nov |
| Today's takings by method | مقبوضات اليوم حسب الطريقة | RA 17 Nov |
| Today (${v.movements.length}) | اليوم (${v.movements.length}) | RA 17 Nov |
| Nothing yet today. | لا شيء بعد اليوم. | RA 17 Nov |
| The day's cash movements | حركات النقد اليوم | RA 17 Nov |
| By | بواسطة | RA 17 Nov |
| Proof | الإثبات | RA 17 Nov |
| bank | البنك | RA 17 Nov |
| drawer | الصندوق | RA 17 Nov |
| Cash out of the drawer | نقد يخرج من الصندوق | RA 17 Nov |
| Cash to the bank | نقد إلى البنك | RA 17 Nov |
| Slip number | رقم الإيصال | RA 17 Nov |
| Slip photo | صورة الإيصال | RA 17 Nov |
| Record deposit | سجّل الإيداع | RA 17 Nov |
| Petty cash | النثرية | RA 17 Nov |
| For what | لأي غرض | RA 17 Nov |
| Who spent it or was paid | من أنفقها أو دُفعت له | RA 17 Nov |
| Receipt photo | صورة الإيصال | RA 17 Nov |
| Expense | مصروف | RA 17 Nov |
| Paid from | دُفع من | RA 17 Nov |
| the drawer | الصندوق | RA 17 Nov |
| the bank | البنك | RA 17 Nov |
| Category | الفئة | RA 17 Nov |
| Paid to | دُفع إلى | RA 17 Nov |
| Invoice or receipt number | رقم الفاتورة أو الإيصال | RA 17 Nov |
| Record expense | سجّل المصروف | RA 17 Nov |
| No order ${code}. | لا يوجد طلب ${code}. | RA 17 Nov |
| small-order fee | رسم الطلب الصغير | RA 17 Nov |
| nothing yet | لا شيء بعد | RA 17 Nov |
| placed | وقت الطلب | RA 17 Nov |
| Items | البنود | RA 17 Nov |
| Item | الصنف | RA 17 Nov |
| Line | السطر | RA 17 Nov |
| Refunded on this order: | المُسترد على هذا الطلب: | RA 17 Nov |
| the customer's credit: | رصيد الزبون: | RA 17 Nov |
| owed | مستحق | RA 17 Nov |
| free to use | حرّ للاستعمال | RA 17 Nov |
| Only money that was paid can be refunded. An unpaid order is corrected, not refunded. | يُستردّ المال المدفوع فقط. الطلب غير المدفوع يُصحَّح ولا يُسترد. | RA 17 Nov |
| A refund above the limit waits for a second person. | الاسترداد فوق الحد ينتظر شخصاً ثانياً. | RA 17 Nov |
| Amount USD | المبلغ بالدولار | RA 17 Nov |
| Charged to | يُحمَّل على | RA 17 Nov |
| (whole order) | (الطلب كله) | RA 17 Nov |
| Give it back as | يُعاد عبر | RA 17 Nov |
| Transfer reference (Whish, OMT) | مرجع التحويل (Whish، OMT) | RA 17 Nov |
| Use credit on this order | استعمل الرصيد على هذا الطلب | RA 17 Nov |
| Take ${usd(Math.min(Number(view.available_usd), Number(order.total_usd)))} off this order | اخصم ${usd(Math.min(Number(view.available_usd), Number(order.total_usd)))} من هذا الطلب | RA 17 Nov |
| Refunds and credit | المبالغ المستردة والرصيد | RA 17 Nov |
| Customers we owe (${owed.length}) | زبائن لهم عندنا (${owed.length}) | RA 17 Nov |
| Nobody. | لا أحد. | RA 17 Nov |
| Owed | المستحق | RA 17 Nov |
| Free to use | الحرّ للاستعمال | RA 17 Nov |
| Last refunds | آخر المبالغ المستردة | RA 17 Nov |
| Pay out | ادفع | RA 17 Nov |
| taken off an open order | خُصم من طلب مفتوح | RA 17 Nov |
| Cash drops and rider payouts | تسليم النقد ودفعات المناديب | RA 17 Nov |
| Count the cash with the rider, note by note, per currency. Confirm only what you counted. The counted figure is recorded; the expected one is never edited. | اعدّ النقد مع المندوب ورقة ورقة لكل عملة. أكّد ما عددته فقط. يُسجَّل المبلغ المعدود ولا يُعدَّل المتوقع أبداً. | RA 17 Nov |
| Cash drops to confirm (${declared.length}) | تسليمات نقد للتأكيد (${declared.length}) | RA 17 Nov |
| No rider on shift or holding money. | لا مندوب في الوردية ولا يحمل مالاً. | RA 17 Nov |
| on shift since | في الوردية منذ | RA 17 Nov |
| shift ended | انتهت الوردية | RA 17 Nov |
| Cash held | النقد معه | RA 17 Nov |
| Earnings owed (fees and tips) | الأرباح المستحقة (الرسوم والإكراميات) | RA 17 Nov |
| To hand over | يسلّم للمحل | RA 17 Nov |
| Cash over/short today | فائض أو عجز النقد اليوم | RA 17 Nov |
| Declared | المُصرَّح به | RA 17 Nov |
| receipt | الإيصال | RA 17 Nov |
| Counted: confirm | عددتُه: أكّد | RA 17 Nov |
| Pay earnings | ادفع الأرباح | RA 17 Nov |
| Send statement on WhatsApp | أرسل الكشف عبر واتساب | RA 17 Nov |
| Pay earnings: the rider keeps their fees and tips out of the cash they carry (dollars first, then lira); anything more is paid from the hub till, never more than it holds. The database works it out. | دفع الأرباح: يحتفظ المندوب برسومه وإكرامياته من النقد الذي يحمله (الدولار أولاً ثم الليرة)؛ وأي زيادة تُدفع من صندوق المستودع ولا تتجاوز ما فيه. تحسبها قاعدة البيانات. | RA 17 Nov |
| Over/short: a few cents of lira rounding at the door is the company's; a shortfall beyond it (up to a dollar) is owed by the rider and flagged. More than a dollar is refused at the door. | الفائض والعجز: بضعة سنتات تقريب بالليرة عند الباب على الشركة؛ وما زاد عنها (حتى دولار) يدين به المندوب ويُعلَّم. وأكثر من دولار يُرفض عند الباب. | RA 17 Nov |
| Damaged notes | الأوراق التالفة | RA 17 Nov |
| A note in a confirmed drop that cannot be used. It leaves the drawer once: the first this month is the company's, later ones are the rider's. | ورقة في تسليم مؤكّد لا يمكن استعمالها. تخرج من الصندوق مرة واحدة: أول واحدة هذا الشهر على الشركة والتالية على المندوب. | RA 17 Nov |
| No confirmed drop at the hub yet. | لا تسليم مؤكّد في المستودع بعد. | RA 17 Nov |
| damaged so far | التالف حتى الآن | RA 17 Nov |
| Record damaged note | سجّل ورقة تالفة | RA 17 Nov |
| under the caps | تحت السقفين | RA 17 Nov |
| a job in hand | في مهمة | RA 17 Nov |
| ${usd(exposure)} of the ${usd(hard)} hard cap | ${usd(exposure)} من السقف الصارم ${usd(hard)} | RA 17 Nov |
|  · soft ${usd(soft)}, hard ${usd(hard)} (set in Settings) |  · مرن ${usd(soft)}، صارم ${usd(hard)} (من الإعدادات) | RA 17 Nov |
| Written terms | الشروط المكتوبة | RA 17 Nov |
| on file | محفوظة | RA 17 Nov |
| signed | وُقّعت | RA 17 Nov |
| open the document | افتح المستند | RA 17 Nov |
| Recorded by | سجّلها | RA 17 Nov |
| not on file | غير محفوظة | RA 17 Nov |
| A rider carries cash and fees only with their written terms on file. | لا يحمل المندوب نقداً ورسوماً إلا بعد حفظ شروطه المكتوبة. | RA 17 Nov |
| Record newer terms | سجّل شروطاً أحدث | RA 17 Nov |
| Record the written terms | سجّل الشروط المكتوبة | RA 17 Nov |
| Document and version | المستند والإصدار | RA 17 Nov |
| Signed on | تاريخ التوقيع | RA 17 Nov |
| Scan or photo (optional) | مسح أو صورة (اختياري) | RA 17 Nov |
| End shift | أنهِ الوردية | RA 17 Nov |
| Start shift | ابدأ الوردية | RA 17 Nov |
| Cash drops and payouts | تسليم النقد والدفعات | RA 17 Nov |
| Who rides, who is on shift, the cash each holds against the caps, and whether their written terms are on file. Riders are never rated or scored here: this page measures the service, not people. | من يوصّل، ومن في الوردية، والنقد الذي يحمله كل واحد مقابل السقفين، وهل شروطه المكتوبة محفوظة. لا تقييم ولا درجات للمناديب هنا: تقيس هذه الصفحة الخدمة لا الأشخاص. | RA 17 Nov |
| On shift (${on.length}) | في الوردية (${on.length}) | RA 17 Nov |
| Off shift (${off.length}) | خارج الوردية (${off.length}) | RA 17 Nov |
| Dispatching, jobs and incidents are on the  | التوزيع والمهام والحوادث في صفحة  | RA 17 Nov |
| Their shift was already open. | ورديته مفتوحة بالفعل. | RA 17 Nov |
| Their shift is open. They can be offered jobs. | فُتحت ورديته. يمكن عرض مهام عليه. | RA 17 Nov |
| Name the document and its version. | سمِّ المستند وإصداره. | RA 17 Nov |
| Choose the day it was signed. | اختر يوم التوقيع. | RA 17 Nov |
| Newer terms recorded; the earlier ones stay as history. | سُجّلت شروط أحدث؛ وتبقى السابقة في السجل. | RA 17 Nov |
| The written terms are on file. | حُفظت الشروط المكتوبة. | RA 17 Nov |
| Drop confirmed. The rider still holds ${usd(left)} in value. | تم تأكيد التسليم. ما زال المندوب يحمل ما قيمته ${usd(left)}. | RA 17 Nov |
| not set | غير مضبوط | RA 17 Nov |
| Not available yet: the database has no console_settings() (migration 0231 is not applied there yet). | غير متاح بعد: لا توجد console_settings() في قاعدة البيانات (لم تُطبَّق الهجرة 0231 هناك بعد). | RA 17 Nov |
| New value | القيمة الجديدة | RA 17 Nov |
| Turn on | فعّل | RA 17 Nov |
| Turn off | عطّل | RA 17 Nov |
| : a second person approves | : يوافق شخص ثانٍ | RA 17 Nov |
| Ask for a second person to approve | اطلب موافقة شخص ثانٍ | RA 17 Nov |
| two-person | شخصان | RA 17 Nov |
| Last changed by ${i.changed_by_name ?? "staff"}, ${when(i.changed_at)} | آخر تغيير: ${i.changed_by_name ?? "موظف"}، ${when(i.changed_at)} | RA 17 Nov |
| Not changed from this page yet. | لم يُغيَّر من هذه الصفحة بعد. | RA 17 Nov |
| Waiting for a second person: | بانتظار شخص ثانٍ: | RA 17 Nov |
| asked by | طلبها | RA 17 Nov |
| Open it on the Approve page | افتحها في صفحة الموافقات | RA 17 Nov |
| Why (logged with your name) | السبب (يُسجَّل باسمك) | RA 17 Nov |
| This change waits for another ops lead or admin; the person who asked can never approve it. | ينتظر هذا التغيير مسؤول عمليات أو مدير آخر؛ ومن طلبه لا يستطيع الموافقة عليه أبداً. | RA 17 Nov |
| People and roles | الأشخاص والأدوار | RA 17 Nov |
| add, change a role, block | إضافة وتغيير دور وحظر | RA 17 Nov |
| Zones, villages and delivery fees | المناطق والقرى ورسوم التوصيل | RA 17 Nov |
| which villages are served, each zone's fee and time | أي قرى تُخدم، ورسم كل منطقة ووقتها | RA 17 Nov |
| Delivery windows and the calendar | نوافذ التوصيل والتقويم | RA 17 Nov |
| capacity, cut-offs, Ramadan and holidays | السعة وآخر المواعيد ورمضان والعطل | RA 17 Nov |
| Message templates | قوالب الرسائل | RA 17 Nov |
| their status and what is sent meanwhile | حالتها وما يُرسل في الأثناء | RA 17 Nov |
| Alerts on this phone, language, appearance | التنبيهات على هذا الهاتف واللغة والمظهر | RA 17 Nov |
| switch push alerts on for this phone | فعّل تنبيهات الدفع على هذا الهاتف | RA 17 Nov |
| Admin only. Each change is logged with who and when. A rule that needs two people waits on the Approve page until another ops lead or admin approves it. The database checks every value again. | للمدير فقط. يُسجَّل كل تغيير بالاسم والوقت. القاعدة التي تحتاج شخصين تنتظر في صفحة الموافقات حتى يوافق مسؤول عمليات أو مدير آخر. وتفحص قاعدة البيانات كل قيمة من جديد. | RA 17 Nov |
| Change log | سجل التغييرات | RA 17 Nov |
| Changes made on this page | التغييرات التي جرت في هذه الصفحة | RA 17 Nov |
| No change made from this page yet. | لم يُجرَ أي تغيير من هذه الصفحة بعد. | RA 17 Nov |
| Setting | الإعداد | RA 17 Nov |
| That is not a setting this page changes. | هذا ليس إعداداً تغيّره هذه الصفحة. | RA 17 Nov |
| Write why: the reason is logged with your name. | اكتب السبب: يُسجَّل باسمك. | RA 17 Nov |
| Choose on or off. | اختر التفعيل أو التعطيل. | RA 17 Nov |
| Type a number. | اكتب رقماً. | RA 17 Nov |
| ${name} is already waiting for a second person. | ${name} بانتظار شخص ثانٍ بالفعل. | RA 17 Nov |
| Waiting for a second person: ${name} changes when another ops lead or admin approves it on the Approve page. | بانتظار شخص ثانٍ: يتغيّر «${name}» حين يوافق مسؤول عمليات أو مدير آخر في صفحة الموافقات. | RA 17 Nov |
| Nothing changed: ${name} already is ${show(L, it, value)}. | لم يتغيّر شيء: «${name}» هو ${show(L, it, value)} بالفعل. | RA 17 Nov |
| Saved: ${name} is now ${show(L, it, value)}. | تم الحفظ: «${name}» الآن ${show(L, it, value)}. | RA 17 Nov |
| Hours and minimum order | ساعات العمل والحد الأدنى للطلب | RA 17 Nov |
| When the shop takes orders, and the smallest order it takes. | متى يستقبل المتجر الطلبات، وأصغر طلب يقبله. | RA 17 Nov |
| Fees | الرسوم | RA 17 Nov |
| The small-order fee is company income. The delivery fee and tips belong to whoever delivers; delivery fees are set per zone on the Zones page. | رسم الطلب الصغير دخل للشركة. أما رسم التوصيل والإكراميات فهي لمن يوصّل؛ ورسوم التوصيل تُضبط لكل منطقة في صفحة المناطق. | RA 17 Nov |
| Timers | المؤقتات | RA 17 Nov |
| How long an order card, a payment or a draft waits before the system acts. | كم تنتظر بطاقة الطلب أو الدفع أو المسودة قبل أن يتصرف النظام. | RA 17 Nov |
| Cash caps | سقوف النقد | RA 17 Nov |
| What a rider may carry. The database refuses a new cash order past the hard cap. A change needs a second person. | ما يحق للمندوب حمله. ترفض قاعدة البيانات طلب نقد جديداً بعد السقف الصلب. التغيير يحتاج شخصاً ثانياً. | RA 17 Nov |
| Pickup place | مكان الاستلام | RA 17 Nov |
| Where a customer collects an order, when pickup is on. | أين يستلم الزبون طلبه حين يكون الاستلام مفعّلاً. | RA 17 Nov |
| Escalation steps | خطوات التصعيد | RA 17 Nov |
| Minutes a customer waits for a person before each step (the Inbox shows them). | الدقائق التي ينتظرها الزبون شخصاً قبل كل خطوة (يعرضها الوارد). | RA 17 Nov |
| Two-person limits | حدود الشخصين | RA 17 Nov |
| Above these a second person must approve. Changing a limit also needs a second person. | فوق هذه الحدود يجب أن يوافق شخص ثانٍ. وتغيير الحد نفسه يحتاج شخصاً ثانياً. | RA 17 Nov |
| Switches | المفاتيح | RA 17 Nov |
| Rules that are on or off. | قواعد مفعّلة أو معطّلة. | RA 17 Nov |
| Beirut time. | بتوقيت بيروت. | RA 17 Nov |
| Closes | يغلق | RA 17 Nov |
| Small-order fee applies below | رسم الطلب الصغير ينطبق تحت | RA 17 Nov |
| USD of goods; 0 is off | دولار من المشتريات؛ 0 يعني معطّل | RA 17 Nov |
| Small-order fee | رسم الطلب الصغير | RA 17 Nov |
| A transfer waits for payment | التحويل ينتظر الدفع | RA 17 Nov |
| An order card waits for the customer's tap | بطاقة الطلب تنتظر ضغطة الزبون | RA 17 Nov |
| One reminder for an unconfirmed card after | تذكير واحد بالبطاقة غير المؤكدة بعد | RA 17 Nov |
| A draft is dropped after | تُترك المسودة بعد | RA 17 Nov |
| Soft cap: warn above | السقف المرن: تحذير فوق | RA 17 Nov |
| USD a rider holds | دولار مع المندوب | RA 17 Nov |
| Hard cap: no new cash order above | السقف الصلب: لا طلب نقد جديد فوق | RA 17 Nov |
| Stays off until the pickup place below is set. | يبقى معطّلاً حتى يُضبط مكان الاستلام أدناه. | RA 17 Nov |
| Pickup place (English) | مكان الاستلام (بالإنجليزية) | RA 17 Nov |
| Pickup place (Arabic) | مكان الاستلام (بالعربية) | RA 17 Nov |
| Step 1: the ops lead is alerted after | الخطوة 1: يُنبَّه مسؤول العمليات بعد | RA 17 Nov |
| Step 2: the founder is alerted after | الخطوة 2: يُنبَّه المؤسس بعد | RA 17 Nov |
| Step 3: the case is marked late after | الخطوة 3: تُعلَّم الحالة متأخرة بعد | RA 17 Nov |
| A refund above this needs a second person | استرداد فوق هذا يحتاج شخصاً ثانياً | RA 17 Nov |
| A price change above this needs a second person | تغيير سعر فوق هذا يحتاج شخصاً ثانياً | RA 17 Nov |
| percent | بالمئة | RA 17 Nov |
| Any change to the LBP rate needs a second person | أي تغيير في سعر الليرة يحتاج شخصاً ثانياً | RA 17 Nov |
| Switching this off needs a second person. | إيقافه يحتاج شخصاً ثانياً. | RA 17 Nov |
| A packaged item is sold only after its label is read and approved | لا يُباع المنتج المعبّأ إلا بعد قراءة ملصقه واعتماده | RA 17 Nov |
| On: every packaged item without an approved label reading reads “coming soon”. Turning it on needs a second person; turning it off is immediate. Read the steps on the Intake page first. | مفعّل: كل منتج معبّأ بلا قراءة ملصق معتمدة يظهر «جايي قريباً». التفعيل يحتاج شخصاً ثانياً؛ والإيقاف فوري. اقرأ الخطوات في صفحة الإدخال أولاً. | RA 17 Nov |
| Search by meaning (embeddings) | البحث بالمعنى (المتجهات) | RA 17 Nov |
| On only once the model's vectors are in the database and the search evaluation shows it beats words alone. | يُفعَّل فقط بعد أن تصبح متجهات النموذج في قاعدة البيانات وبعد أن يُظهر تقييم البحث أنه يتفوق على الكلمات وحدها. | RA 17 Nov |
| Decide one card at a time | قرّر بطاقة بطاقة | RA 17 Nov |
| Price / Refund / Payment / Exchange rate / Setting (the kind of a second approval) | سعر / استرداد / دفعة / سعر الصرف / إعداد | RA 17 Nov |

## UX3, the join pages and the Applicants tab (17 November 2026)

Written by a model; **the Arabic, English and French below wait for a reader** (the last column is empty). Three places hold words:
the website's two pages (the keys `join_*`, `vend_*`, `kind_shop` in `apps/web/src/lib/join-words.ts`, merged into the three dictionaries in `apps/web/src/lib/i18n.ts`; the test `test/ci/ux3-arabic.test.ts` holds this table equal to them, word for word),
the one Postgres line (the consent a sender gives by sending their code, `claim_link_code`, migration 0233; Lebanese, as the checkout's is), and the console's Applicants tab (staff only, `apps/console/src/pages/riders.ts`, beside its English with `pick(L, en, ar)`).
Rules the words keep: a rider keeps the whole delivery fee and all tips (invariant 10); no commission figure for a place is published; applying opens nothing (invariant 11); no rating, praise or promise of income (invariant 14);
**the hub is «المستودع»**, never «المركز»; nobody is messaged who has not messaged us first (invariant 17). `{min}`, `{max}`, `{soft}`, `{hard}`, `{vehicles}`, `{code}` and `{name}` are filled by code, from the database.
The shifts (morning 08:00 to 15:30, evening 15:30 to 23:00) are a draft taken from the founder's reference and live in `settings.join`; the amounts come from `zones` and `settings.cash_cap`.

### The website

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `web.join_footer_rider` | كن مندوباً معنا | Ride with us | Livrer avec nous | |
| `web.join_footer_vendor` | بع عبر ألو كينغ | Sell on Alo King | Vendre sur Alo King | |
| `web.vend_from_place` | هل هذا مكانك؟ قدّم طلباً للبيع عبر ألو كينغ | Own this place? Apply to sell on Alo King | C'est votre établissement ? Demandez à vendre sur Alo King | |
| `web.kind_shop` | متجر | Shop | Magasin | |
| `web.join_rider_eyebrow` | كن مندوباً مع ألو كينغ | Ride with Alo King | Livrer avec Alo King | |
| `web.join_rider_title` | وصّل في الشوف. وخذ الرسوم كاملة. | Deliver in the Chouf. Keep the whole fee. | Livrez dans le Chouf. Gardez tous les frais. | |
| `web.join_rider_lead` | البقالة تخرج من مستودعنا إلى قرىً تعرفها. كل رسم توصيل وكل إكرامية لك. | Groceries leave our hub and go to villages you know. Every delivery fee and every tip is yours. | Les courses partent de notre centre vers des villages que vous connaissez. Chaque frais de livraison et chaque pourboire sont à vous. | |
| `web.join_apply_cta` | قدّم طلبك في دقيقتين | Apply in 2 minutes | Postulez en 2 minutes | |
| `web.join_how_cta` | كيف تربح | How you earn | Comment vous gagnez | |
| `web.join_earn_h` | ما الذي تربحه | What you earn | Ce que vous gagnez | |
| `web.join_fee_t` | 100٪ من رسم التوصيل | 100% of the delivery fee | 100 % des frais de livraison | |
| `web.join_fee_range` | التوصيلة تدفع من {min} إلى {max}، حسب القرية. | A delivery pays {min} to {max}, depending on the village. | Une livraison rapporte de {min} à {max}, selon le village. | |
| `web.join_fee_text` | الرسم يُحصَّل لك أنت، لا لألو كينغ. لا نأخذ منه شيئاً. | The fee is collected for you, not for Alo King. We take nothing from it. | Les frais sont encaissés pour vous, pas pour Alo King. Nous n'en prélevons rien. | |
| `web.join_tips_t` | 100٪ من الإكراميات | 100% of tips | 100 % des pourboires | |
| `web.join_tips_text` | كل إكرامية لك كاملة. | Every tip is yours, in full. | Chaque pourboire est à vous, en entier. | |
| `web.join_pay_t` | الدفع عن كل توصيلة | Paid per delivery | Payé à la livraison | |
| `web.join_pay_text` | لا يوجد أجر بالساعة. ما تربحه هو رسم كل توصيلة تنجزها وإكراميتها. | There is no hourly wage. What you earn is the fee and the tip of each delivery you make. | Il n'y a pas de salaire horaire. Vous gagnez les frais et le pourboire de chaque livraison que vous faites. | |
| `web.join_shifts_h` | الورديات | Shifts | Créneaux | |
| `web.join_shifts_lead` | أخبرنا بالأيام والورديات التي تستطيع العمل فيها. | Tell us the days and shifts you can ride. | Dites-nous les jours et les créneaux où vous pouvez livrer. | |
| `web.join_shift_morning` | صباحية | Morning | Matin | |
| `web.join_shift_evening` | مسائية | Evening | Soir | |
| `web.join_who_h` | من يستطيع التوصيل | Who can ride | Qui peut livrer | |
| `web.join_who_vehicle` | عندك وسيلة نقل: {vehicles}. | You have a vehicle: {vehicles}. | Vous avez un véhicule : {vehicles}. | |
| `web.join_who_licence` | تخبرنا هل عندك رخصة قيادة، نعم أو لا. نقرأ الجواب مع باقي طلبك. | You tell us whether you have a driving licence, yes or no. We read the answer with the rest of your application. | Vous nous dites si vous avez un permis de conduire, oui ou non. Nous lisons la réponse avec le reste de votre candidature. | |
| `web.join_who_hours` | تستطيع العمل في الأيام والورديات التي تختارها. | You can ride the days and shifts you choose. | Vous livrez les jours et les créneaux que vous choisissez. | |
| `web.join_who_number` | رقم واتساب الخاص بك يُؤكَّد بأن تراسلنا أنت أولاً. لا نراسل رقماً لم يراسلنا. | Your WhatsApp number is confirmed by you messaging us first. We never message a number that has not messaged us. | Votre numéro WhatsApp est confirmé quand vous nous écrivez en premier. Nous n'écrivons jamais à un numéro qui ne nous a pas écrit. | |
| `web.join_who_person` | شخص يقرأ كل طلب ويقرر. تقديم الطلب لا يجعلك مندوباً. | A person reads every application and decides. Applying does not make you a rider. | Une personne lit chaque candidature et décide. Postuler ne fait pas de vous un livreur. | |
| `web.join_cash_h` | النقد وحدّه | Cash and its limit | L'argent liquide et sa limite | |
| `web.join_cash_text` | كثير من الزبائن يدفعون نقداً عند التسليم، وأنت تحمل هذا النقد للمستودع. من {soft} لا تُعرض عليك طلبات نقدية جديدة، ولا بعد {hard} أبداً، إلى أن تسلّم النقد في المستودع. | Many customers pay cash on delivery, and you carry that cash for the hub. From {soft} you are not offered new cash orders, and never past {hard}, until you hand cash over at the hub. | Beaucoup de clients paient en espèces à la livraison, et vous portez cet argent pour le centre. À partir de {soft} on ne vous propose plus de commande en espèces, et jamais au-delà de {hard}, jusqu'à ce que vous remettiez l'argent au centre. | |
| `web.join_terms_h` | الشروط المكتوبة | Written terms | Conditions écrites | |
| `web.join_terms_text` | كل شيء مكتوب. تُوقَّع شروطك المكتوبة وتُحفظ عندنا قبل أن تحمل نقداً أو تأخذ توصيلة. | Everything is in writing. Your written terms are signed and kept on file before you carry cash or take a delivery. | Tout est par écrit. Vos conditions écrites sont signées et conservées avant que vous portiez de l'argent ou preniez une livraison. | |
| `web.join_terms_owed` | قد يُسجَّل عجز النقد ديناً عليك، لكنه لا يُخصم أبداً من رسومك أو إكرامياتك أو أرباحك تلقائياً. | A shortfall may be recorded as owed by you, but it is never taken out of your fees, tips or earnings automatically. | Un manque peut être noté comme dû par vous, mais il n'est jamais retiré automatiquement de vos frais, pourboires ou gains. | |
| `web.join_terms_rating` | لا يُقيَّم المناديب ولا تُعطى لهم درجات ولا يُرتَّبون. | Riders are never rated, scored or ranked. | Les livreurs ne sont ni notés, ni classés. | |
| `web.join_apply_h` | قدّم طلبك | Apply | Postuler | |
| `web.join_confirm_h` | أكّد رقمك على واتساب | Confirm your number on WhatsApp | Confirmez votre numéro sur WhatsApp | |
| `web.join_confirm_rider` | أنت تراسلنا أولاً، فنعرف أن الرقم لك. احصل على رمز ثم أرسله إلينا على واتساب. لا نراسل رقماً لم يراسلنا. | You message us first, so we know the number is yours. Get a code, then send it to us on WhatsApp. We never message a number that has not messaged us. | Vous nous écrivez en premier, pour que nous sachions que le numéro est le vôtre. Obtenez un code, puis envoyez-le-nous sur WhatsApp. Nous n'écrivons jamais à un numéro qui ne nous a pas écrit. | |
| `web.join_confirm_vendor` | أرسل الرمز من رقم واتساب صاحب المكان أو مديره، لنعرف من نكتب إليه. أنت تراسلنا أولاً. لا نراسل رقماً لم يراسلنا. | Send the code from the WhatsApp number of the owner or manager, so we know who to write to. You message us first. We never message a number that has not messaged us. | Envoyez le code depuis le numéro WhatsApp du propriétaire ou du gérant, pour que nous sachions à qui écrire. Vous nous écrivez en premier. Nous n'écrivons jamais à un numéro qui ne nous a pas écrit. | |
| `web.join_confirm_get` | أعطني الرمز | Get my code | Obtenir mon code | |
| `web.join_code_h` | رمزك | Your code | Votre code | |
| `web.join_code_send` | افتح واتساب وأرسل الرمز | Open WhatsApp and send the code | Ouvrir WhatsApp et envoyer le code | |
| `web.join_code_plain` | أرسل {code} إلى رقم واتساب الخاص بنا. | Send {code} to our WhatsApp number. | Envoyez {code} à notre numéro WhatsApp. | |
| `web.join_code_note` | الرمز يعمل لبضع دقائق. إذا توقف عن العمل فاحصل على رمز جديد. | The code works for a few minutes. If it stops working, get a new one. | Le code fonctionne quelques minutes. S'il ne marche plus, obtenez-en un nouveau. | |
| `web.join_code_check` | أرسلته | I have sent it | Je l'ai envoyé | |
| `web.join_code_new` | رمز جديد | Get a new code | Nouveau code | |
| `web.join_confirmed` | تم تأكيد رقمك. | Your number is confirmed. | Votre numéro est confirmé. | |
| `web.join_name` | اسمك | Your name | Votre nom | |
| `web.join_village` | قريتك | Your village | Votre village | |
| `web.join_vehicle` | وسيلة النقل | Your vehicle | Votre véhicule | |
| `web.join_vehicle_choose` | اختر | Choose | Choisir | |
| `web.join_vehicle_motorbike` | دراجة نارية | Motorbike | Moto | |
| `web.join_vehicle_car` | سيارة | Car | Voiture | |
| `web.join_vehicle_bicycle` | دراجة هوائية | Bicycle | Vélo | |
| `web.join_licence` | هل عندك رخصة قيادة؟ | Do you have a driving licence? | Avez-vous un permis de conduire ? | |
| `web.join_yes` | نعم | Yes | Oui | |
| `web.join_no` | لا | No | Non | |
| `web.join_days` | الأيام التي تستطيع العمل فيها | Days you can ride | Jours où vous pouvez livrer | |
| `web.join_shifts` | الورديات التي تستطيع العمل فيها | Shifts you can ride | Créneaux où vous pouvez livrer | |
| `web.join_day_mon` | الاثنين | Monday | Lundi | |
| `web.join_day_tue` | الثلاثاء | Tuesday | Mardi | |
| `web.join_day_wed` | الأربعاء | Wednesday | Mercredi | |
| `web.join_day_thu` | الخميس | Thursday | Jeudi | |
| `web.join_day_fri` | الجمعة | Friday | Vendredi | |
| `web.join_day_sat` | السبت | Saturday | Samedi | |
| `web.join_day_sun` | الأحد | Sunday | Dimanche | |
| `web.join_submit` | أرسل طلبي | Send my application | Envoyer ma candidature | |
| `web.join_err_name` | اكتب اسمك. | Write your name. | Écrivez votre nom. | |
| `web.join_err_village` | اكتب اسم قريتك. | Write your village. | Écrivez votre village. | |
| `web.join_err_vehicle` | اختر وسيلة النقل. | Choose your vehicle. | Choisissez votre véhicule. | |
| `web.join_err_licence` | أخبرنا هل عندك رخصة: نعم أو لا. | Tell us whether you have a licence: yes or no. | Dites-nous si vous avez un permis : oui ou non. | |
| `web.join_err_hours` | اختر يوماً واحداً على الأقل ووردية واحدة على الأقل. | Choose at least one day and one shift. | Choisissez au moins un jour et un créneau. | |
| `web.join_err_confirm` | أكّد رقمك على واتساب أولاً. | Confirm your number on WhatsApp first. | Confirmez d'abord votre numéro sur WhatsApp. | |
| `web.join_err_limit` | طلبات كثيرة من هذا الجهاز اليوم. حاول غداً، أو راسلنا على واتساب. | Too many applications from this device today. Try again tomorrow, or message us on WhatsApp. | Trop de candidatures depuis cet appareil aujourd'hui. Réessayez demain, ou écrivez-nous sur WhatsApp. | |
| `web.join_err_failed` | حدث خطأ. حاول مرة أخرى. | Something went wrong. Try again. | Une erreur s'est produite. Réessayez. | |
| `web.join_done_h` | طلبك وصلنا. | Your application is with us. | Votre candidature est chez nous. | |
| `web.join_done_text` | شخص يقرؤه ويقرر. تقديم الطلب لا يجعلك مندوباً. نكتب إليك على واتساب، في المحادثة التي أرسلت منها الرمز. | A person reads it and decides. Applying does not make you a rider. We write to you on WhatsApp, on the chat where you sent your code. | Une personne la lit et décide. Postuler ne fait pas de vous un livreur. Nous vous écrivons sur WhatsApp, dans la conversation où vous avez envoyé votre code. | |
| `web.vend_eyebrow` | بع عبر ألو كينغ | Sell on Alo King | Vendre sur Alo King | |
| `web.vend_title` | بِع لأهل الشوف من واتساب. | Sell to the Chouf from WhatsApp. | Vendez au Chouf depuis WhatsApp. | |
| `web.vend_lead` | عائلات في الشوف تطلب منا. نريد أن نقدّم طعاماً من المطابخ والمحلات التي تعرفها. تصلك الطلبات على واتساب، ونستطيع توصيلها. | Families across the Chouf order from us. We want to carry food from the kitchens and shops they know. Orders reach you on WhatsApp, and we can deliver them. | Des familles du Chouf commandent chez nous. Nous voulons proposer la cuisine et les commerces qu'elles connaissent. Les commandes vous arrivent sur WhatsApp, et nous pouvons les livrer. | |
| `web.vend_notopen` | لا يوجد مطبخ أو محل مفتوح على ألو كينغ بعد. نبدأ مع الأماكن التي نتفق معها على الشروط. | No kitchen or shop is open on Alo King yet. We start with the places we agree terms with. | Aucune cuisine ni aucun commerce n'est encore ouvert sur Alo King. Nous commençons avec les lieux dont nous avons convenu des conditions. | |
| `web.vend_cta` | قدّم طلبك في دقيقتين | Apply in 2 minutes | Postulez en 2 minutes | |
| `web.vend_listed` | هل مكانك مدرج؟ ابحث عنه | Already listed? Find your place | Déjà listé ? Trouvez votre lieu | |
| `web.vend_offer_h` | ماذا تقدّم ألو كينغ | What Alo King offers | Ce qu'offre Alo King | |
| `web.vend_o1_t` | طلبات على واتساب | Orders on WhatsApp | Commandes sur WhatsApp | |
| `web.vend_o1` | يصلك كل طلب رسالةً وتجيب عليه هناك. بلا جهاز لوحي وبلا تطبيق. | Each order reaches you as a message, and you answer it there. No tablet and no app. | Chaque commande vous arrive en message, et vous y répondez là. Pas de tablette, pas d'application. | |
| `web.vend_o2_t` | التوصيل | Delivery | Livraison | |
| `web.vend_o2` | نستطيع إيصال الطلب إلى الزبون: يسلّمه المندوب عند الباب ويأخذ الرمز والنقد. | We can bring the order to the customer: the rider hands it over at the door and takes the code and the cash. | Nous pouvons porter la commande au client : le livreur la remet à la porte et prend le code et l'argent. | |
| `web.vend_o3_t` | ظهور منصف | Found fairly | Trouvé équitablement | |
| `web.vend_o3` | يجد الزبائن الأماكن بحسب ما يطلبونه وبحسب المسافة. لا نقيّم مكاناً ولا نرتّبه ولا نمدحه. | Customers find places by what they ask for and by distance. We never rate, rank or praise a place. | Les clients trouvent les lieux selon ce qu'ils demandent et la distance. Nous ne notons, ne classons ni ne vantons aucun lieu. | |
| `web.vend_o4_t` | شروط تُتفق أولاً | Terms, agreed first | Conditions convenues d'abord | |
| `web.vend_o4` | عمولتنا جزء من الشروط التي نتفق عليها معك قبل أن تبدأ. لا يوجد رقم في هذه الصفحة. | Our commission is part of the terms we agree with you before you start. There is no figure on this page. | Notre commission fait partie des conditions que nous convenons avec vous avant de commencer. Il n'y a pas de chiffre sur cette page. | |
| `web.vend_next_h` | ماذا يحدث بعد طلبك | What happens after you apply | Ce qui se passe après votre candidature | |
| `web.vend_n1` | تؤكّد رقمك بأن تراسلنا. | You confirm your number by messaging us. | Vous confirmez votre numéro en nous écrivant. | |
| `web.vend_n2` | شخص من فريقنا يقرأ طلبك ويكتب إليك. | A person from our team reads your application and writes to you. | Une personne de notre équipe lit votre candidature et vous écrit. | |
| `web.vend_n3` | نتفق على الشروط كتابةً، ونراجع قائمتك وأسعارك. | We agree the terms in writing, and check your menu and your prices. | Nous convenons des conditions par écrit, et vérifions votre menu et vos prix. | |
| `web.vend_n4` | وعندها فقط يُفتح مكانك. تقديم الطلب لا يفتح مكانك. | Only then is your place opened. Applying does not open your place. | Alors seulement votre lieu est ouvert. Postuler n'ouvre pas votre lieu. | |
| `web.vend_apply_h` | قدّم طلبك | Apply | Postuler | |
| `web.vend_name` | اسم المكان | Name of the place | Nom du lieu | |
| `web.vend_kind` | نوع المكان | What kind of place | Type de lieu | |
| `web.vend_kind_choose` | اختر | Choose | Choisir | |
| `web.vend_village` | القرية | Village | Village | |
| `web.vend_place_h` | مكانك في قائمتنا | Your place on our list | Votre lieu sur notre liste | |
| `web.vend_claim_note` | أنت تقدّم طلباً باسم {name}. وهذا يُحتسب مطالبةً بتلك الصفحة. | You are applying for {name}. This counts as your claim of that page. | Vous postulez pour {name}. Cela compte comme votre revendication de cette page. | |
| `web.vend_claim_other` | ليس هذا المكان؟ قدّم الطلب بدونه | Not this place? Apply without it | Pas ce lieu ? Postulez sans lui | |
| `web.vend_submit` | أرسل طلبي | Send my application | Envoyer ma candidature | |
| `web.vend_err_name` | اكتب اسم المكان. | Write the name of the place. | Écrivez le nom du lieu. | |
| `web.vend_err_kind` | اختر نوع المكان. | Choose what kind of place it is. | Choisissez le type de lieu. | |
| `web.vend_done_text` | شخص يقرؤه ويكتب إليك على واتساب، في المحادثة التي أرسلت منها الرمز. تقديم الطلب لا يفتح مكانك. | A person reads it and writes to you on WhatsApp, on the chat where you sent your code. Applying does not open your place. | Une personne la lit et vous écrit sur WhatsApp, dans la conversation où vous avez envoyé votre code. Postuler n'ouvre pas votre lieu. | |

### The consent a sender gives by sending their code (migration 0233, `claim_link_code`)

| Purpose | Arabic | English | Read by |
|---|---|---|---|
| `rider` | بإرسال الرمز بتأكد رقمك وبتوافق نردّ عليك على هالمحادثة بخصوص طلب انضمامك كمندوب | By sending the code you confirm your number and agree that we answer you on this chat about your application to ride. | |
| `vendor` | بإرسال الرمز بتأكد رقمك وبتوافق نردّ عليك على هالمحادثة بخصوص طلب انضمام محلّك | By sending the code you confirm your number and agree that we answer you on this chat about your place's application. | |
| `checkout` (as before) | بإرسال الرمز بتأكد رقمك وبتوافق نبعتلك تحديثات طلباتك على هالمحادثة | By sending the code you confirm your number and agree that we send you your order updates on this chat. | RA 17 Nov |

### The console, Riders, Applicants tab

| English | Arabic | Read by |
|---|---|---|
| Applicants | المتقدّمون | |
| Vehicle | وسيلة النقل | |
| Licence | رخصة | |
| Licence: yes | رخصة: نعم | |
| Licence: no | رخصة: لا | |
| Days | الأيام | |
| Shifts | الورديات | |
| WhatsApp number | رقم واتساب | |
| Applied | قُدّم | |
| Its case in the Inbox (resolved) | حالته في الوارد (مُغلقة) | |
| Open its case in the Inbox | افتح حالته في الوارد | |
| Accept | قبول | |
| Why (kept with the decision) | السبب (يُحفظ مع القرار) | |
| Accepted | مقبول | |
| People who applied on the website after confirming their number on WhatsApp (they messaged us first). Each is not a rider yet: accepting is what makes them one. It starts no shift, records no terms and sends no message; answer them from the Inbox case, and record their written terms on the roster before they carry cash. | أشخاص قدّموا طلباً على الموقع بعد أن أكّدوا رقمهم على واتساب (راسلونا أولاً). ليس أحدهم مندوباً بعد: القبول هو ما يجعله مندوباً. لا يبدأ وردية ولا يسجّل شروطاً ولا يرسل رسالة؛ أجبهم من حالتهم في الوارد، وسجّل شروطهم المكتوبة في القائمة قبل أن يحملوا نقداً. | |
| Waiting (${open.length}) | بالانتظار (${open.length}) | |
| Nobody is waiting. | لا أحد بالانتظار. | |
| Decided | تم البتّ فيها | |
| No application has been decided yet. | لم يُبتّ في أي طلب بعد. | |
| Someone already decided this application. | بتّ شخص آخر في هذا الطلب. | |
| This number is already on the ops line, so they are a rider or staff already. Nothing was changed. | هذا الرقم موجود أصلاً على خط العمليات، فهو مندوب أو موظف بالفعل. لم يتغيّر شيء. | |
| This application has no confirmed number, so no rider can be made from it. | لا رقم مؤكَّد لهذا الطلب، فلا يمكن إنشاء مندوب منه. | |
| ${name} is now a rider. Next: record their written terms on the roster. | ${name} صار مندوباً. الخطوة التالية: سجّل شروطه المكتوبة في القائمة. | |
| Declined. The reason is kept. | تم الرفض. السبب محفوظ. | |
