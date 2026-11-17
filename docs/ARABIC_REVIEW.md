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
It promises no date and gives no reason about the product (invariants 14 and 15). Written by a model; **not read by a person yet** (the same rule as every other new line).

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `basket.comingSoon(["لبنة"])` | جاي قريباً، لسّا ما فينا نبيعو:<br>• لبنة<br>قلّي شو بدك بدالو، أو منشيلو. | Coming soon, we can't take it yet:<br>• لبنة<br>Tell me what you'd like instead, or remove it. | Bientôt disponible, nous ne pouvons pas encore le vendre :<br>• لبنة<br>Dites-moi ce que vous voulez à la place, ou retirez-le. | |
| `basket.comingSoon(["لبنة", "خبز"])` | جاي قريباً، لسّا ما فينا نبيعو:<br>• لبنة<br>• خبز<br>قلّي شو بدك بدالو، أو منشيلو. | Coming soon, we can't take it yet:<br>• لبنة<br>• خبز<br>Tell me what you'd like instead, or remove it. | Bientôt disponible, nous ne pouvons pas encore le vendre :<br>• لبنة<br>• خبز<br>Dites-moi ce que vous voulez à la place, ou retirez-le. | |
| website `coming_soon` (the label that replaces "In stock" on a card and on the page) | قريباً | Coming soon | Bientôt disponible | |
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

## LV1, the Chouf food places listed before they sign (17 November 2026)

Written by a model; **not yet read by a person**: the "Read by" column is empty and the Arabic, English and French all wait for a reader.
Three places hold words: the website (the `ar`, `en` and `fr` dictionaries in `apps/web/src/lib/i18n.ts`, the keys `food*` and `kind_*`: the test
`test/ci/listings-lv1.test.ts` checks this table lists every one, word for word), the one WhatsApp line (`messages(...).fixed.listingClaimed`), and the
console's Listings page (staff only, `apps/console/src/pages/listings.ts`, beside its English with `pick(L, en, ar)`). Neutral wording only: no
rating, praise, health or diet word, no promise that anything can be ordered from a listing (invariants 11 and 14). The names of the places are the
founder's file as it is: a business's name is not translated. The website's Arabic is the site's register (formal Arabic); the WhatsApp line is Lebanese, as every
fixed message is. `{km}`, `{n}`, `{total}` and `{name}` are filled by code.

### The website

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `web.food` | أماكن الطعام | Food places | Lieux pour manger | |
| `web.food_title` | أماكن الطعام في الشوف | Food places in the Chouf | Lieux pour manger dans le Chouf | |
| `web.food_tile_note` | ليس على ألو كينغ بعد | Not on Alo King yet | Pas encore sur Alo King | |
| `web.food_intro` | أماكن قريبة منك ليست على ألو كينغ بعد. لا يمكنك الطلب منها من هنا. أخبرنا أيّها تريد. ويستطيع أصحاب الأماكن المطالبة بصفحتهم أو إزالتها. | Places near you that are not on Alo King yet. You can't order from them here. Tell us which ones you want. Owners can claim a page or have it removed. | Des lieux près de chez vous qui ne sont pas encore sur Alo King. Vous ne pouvez pas y commander d'ici. Dites-nous lesquels vous voulez. Les propriétaires peuvent revendiquer leur page ou la faire retirer. | |
| `web.food_not_yet` | ليس على ألو كينغ بعد. لا يمكنك الطلب من هنا بعد. | Not on Alo King yet. You can't order from here yet. | Pas encore sur Alo King. Vous ne pouvez pas encore commander ici. | |
| `web.food_places` | عدد الأماكن: {n} | Places: {n} | Lieux : {n} | |
| `web.food_none` | لا توجد أماكن تطابق هذا. | No places match this. | Aucun lieu ne correspond. | |
| `web.food_km` | {km} كم من مركزنا | {km} km from our hub | {km} km de notre centre | |
| `web.food_village_none` | القرية غير مذكورة | Village not listed | Village non indiqué | |
| `web.food_kind` | النوع | Kind | Type | |
| `web.food_village` | القرية | Village | Village | |
| `web.food_sort_distance` | المسافة من مركزنا | Distance from our hub | Distance de notre centre | |
| `web.food_sort_name` | الاسم | Name | Nom | |
| `web.food_next` | التالي | Next | Suivant | |
| `web.food_prev` | السابق | Previous | Précédent | |
| `web.food_page` | الصفحة {n} من {total} | Page {n} of {total} | Page {n} sur {total} | |
| `web.food_map` | افتح في خرائط Google | Open in Google Maps | Ouvrir dans Google Maps | |
| `web.food_want` | أريد الطلب من هنا | I want to order from here | Je veux commander ici | |
| `web.food_asked` | شكرًا. سجّلنا أنك تريد الطلب من {name}. لا يلزمك أي شيء آخر. | Thanks. We've noted that you want to order from {name}. Nothing else is needed from you. | Merci. Nous avons noté que vous voulez commander chez {name}. Rien d'autre n'est nécessaire de votre part. | |
| `web.food_claim` | هل هذا مكانك؟ اطلب إدارته | Is this your place? Claim it | C'est votre établissement ? Revendiquez-le | |
| `web.food_claim_note` | يفتح هذا واتساب مع رسالة إلينا مكتوبة مسبقًا. أرسلها وسنتواصل معك. | This opens WhatsApp with a message to us already typed. Send it and we will get in touch. | Cela ouvre WhatsApp avec un message pour nous déjà écrit. Envoyez-le et nous vous contacterons. | |
| `web.food_remove` | إزالة هذه الصفحة | Remove this listing | Retirer cette page | |
| `web.food_remove_title` | إزالة هذه الصفحة | Remove this listing | Retirer cette page | |
| `web.food_remove_intro` | هذا يُخفي صفحة {name} فورًا. يُبلَّغ فريقنا وسينظر في الأمر. | This hides the page for {name} right away. Our team is told and will look at it. | Cela masque tout de suite la page de {name}. Notre équipe est prévenue et l'examinera. | |
| `web.food_who` | من أنت؟ | Who are you? | Qui êtes-vous ? | |
| `web.food_who_choose` | اختر | Choose | Choisir | |
| `web.food_who_owner` | صاحب المكان | The owner | Le propriétaire | |
| `web.food_who_manager` | مدير | A manager | Un gérant | |
| `web.food_who_staff` | موظف | Staff | Un employé | |
| `web.food_who_other` | شخص آخر | Someone else | Quelqu'un d'autre | |
| `web.food_who_error` | اختر من أنت. | Choose who you are. | Choisissez qui vous êtes. | |
| `web.food_reason` | لماذا؟ (اختياري) | Why? (optional) | Pourquoi ? (facultatif) | |
| `web.food_reason_hint` | من فضلك لا تكتب تفاصيل خاصة مثل الأرقام أو العناوين. | Please don't include private details such as numbers or addresses. | N'indiquez pas de détails privés, comme des numéros ou des adresses. | |
| `web.food_remove_go` | أخفِ هذه الصفحة | Hide this page | Masquer cette page | |
| `web.food_cancel` | إلغاء | Cancel | Annuler | |
| `web.food_removed` | تم. الصفحة مخفية وقد أُبلغ فريقنا. | Done. The page is hidden and our team has been told. | C'est fait. La page est masquée et notre équipe est prévenue. | |
| `web.food_remove_queued` | وصلنا طلبك. سينظر فريقنا فيه. | We have your request. Our team will look at it. | Nous avons votre demande. Notre équipe va l'examiner. | |
| `web.kind_restaurant` | مطعم | Restaurant | Restaurant | |
| `web.kind_cafe` | مقهى | Café | Café | |
| `web.kind_bakery` | مخبز | Bakery | Boulangerie | |
| `web.kind_sweets` | حلويات | Sweets | Pâtisserie | |
| `web.kind_catering` | تموين وضيافة | Catering | Traiteur | |
| `web.kind_butcher` | ملحمة | Butcher | Boucherie | |

### On WhatsApp (the reply to "Claim <listing_id>", read by code before any model)

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `fixed.listingClaimed("مخبز الشوف")` | وصلتنا رسالتك بخصوص مخبز الشوف.<br>رح يتواصل معك حدا من فريقنا هون على واتساب.<br>لحد ذاك ما رح يتغيّر شي على الصفحة. | We got your message about مخبز الشوف.<br>Someone from our team will get in touch with you here on WhatsApp.<br>Until then nothing changes on the page. | Nous avons bien reçu votre message au sujet de مخبز الشوف.<br>Quelqu'un de notre équipe vous contactera ici sur WhatsApp.<br>D'ici là, rien ne change sur la page. | |

### The console's Listings page (staff-facing)

| Place | Arabic | English | Read by |
|---|---|---|---|
| Menu and title | أماكن الطعام | Food places | |
| Tabs | بحث · المخفي والطلبات · المطالبات | Search · Hidden and requests · Claims | |
| Intro | أماكن طعام في الشوف مدرجة على الموقع قبل أن توقّع. الإدراج ليس تاجرًا: لا يمكن الطلب منه. يستطيع الزائر أن يقول إنه يريده، ويستطيع صاحب المكان المطالبة به أو إزالته. | Chouf food places listed on the website before they sign. A listing is not a merchant: nothing can be ordered from it. A visitor can say they want it, an owner can claim it or have it removed. | |
| Columns | المكان · النوع · القرية · كم · الطالبون · المطالبات · الحالة · إخفاء · الطلب · القرار · متى · أُرسلت من · الحالة | Place · Kind · Village · km · Wants · Claims · Status · Hide · Request · Decide · When · Sent from · Case | |
| States | ظاهر · مخفي · أغلق · بلا سبب · بلا رقم · غير مذكورة · مفتوحة: الوارد · مُغلقة | Listed · Hidden · closed · no reason given · no number · not listed · open: Inbox · resolved | |
| Who asked | صاحب المكان · مدير · موظف · شخص آخر | the owner · a manager · staff · someone else | |
| Limit note | تجاوز الحد: تُركت الصفحة ظاهرة لتقرّر أنت. | Over a limit: the page was left up for you to decide. | |
| Buttons | أعد الصفحة · أخفِ الصفحة · أخفِ · أغلق: أبقها مخفية · أغلق: أبقها ظاهرة · بحث | Restore the page · Hide the page · Hide · Close: keep it hidden · Close: leave it up · Search | |
| Fields | سبب الإعادة · سبب الإخفاء · السبب · ملاحظة · الاسم أو القرية | Reason to restore · Reason to hide · Reason · Note · Name or village | |
| Done | أُعيدت الصفحة وأُغلق الطلب. · أُخفيت الصفحة من الموقع. · أُبقيت مخفية وأُغلق الطلب. · أُغلق الطلب وتبقى الصفحة ظاهرة. | Restored: the page is back, and the request is closed. · Hidden: the page is gone from the website. · Kept hidden. The request is closed. · The request is closed and the page stays up. | |
| Refusals | اكتب السبب (٣ أحرف على الأقل). · هذا المكان غير صالح. · هذا الطلب غير صالح. | Write the reason (at least 3 characters). · That place is not valid. · That request is not valid. | |
| Empty | لا مطالبات بعد. · لا شيء مخفي ولا طلب بانتظار. · لا أماكن تطابق هذا. · تُعرض أول ٥٠: ابحث بالاسم أو القرية لتضييق النتائج. | No claims yet. · Nothing hidden and no request waiting. · No places match this. · The first 50 are shown: search by name or village to narrow it. | |
| Staff alert | مكان طعام طلب إزالة صفحته | A food place asked to be removed | |
