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

## WEB2, the website's basket, sign-in, checkout, order page, history, account and "How it works" (17 November 2026)

Written by a model; **not yet read by a person**: the "Read by" column is empty and the Arabic, English and French all wait for a reader.
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
| `web.w2_basket` | السلة | Basket | Panier | |
| `web.w2_basket_n` | السلة، {n} منتج | Basket, {n} items | Panier, {n} articles | |
| `web.w2_account` | حسابي | Account | Compte | |
| `web.w2_orders` | طلباتك | Your orders | Vos commandes | |
| `web.w2_how` | كيف يعمل | How it works | Comment ça marche | |
| `web.w2_add` | أضف إلى السلة | Add to basket | Ajouter au panier | |
| `web.w2_added` | أُضيف إلى سلتك. | Added to your basket. | Ajouté à votre panier. | |
| `web.w2_view_basket` | اعرض السلة | View basket | Voir le panier | |
| `web.w2_basket_title` | سلتك | Your basket | Votre panier | |
| `web.w2_basket_empty` | سلتك فارغة. | Your basket is empty. | Votre panier est vide. | |
| `web.w2_basket_empty_text` | أضف منتجات من الأقسام أو من البحث. | Add items from the aisles or from search. | Ajoutez des articles depuis les rayons ou la recherche. | |
| `web.w2_browse` | تصفّح الأقسام | Browse the aisles | Parcourir les rayons | |
| `web.w2_qty` | الكمية | Quantity | Quantité | |
| `web.w2_less` | أنقص واحدًا | One less | Un de moins | |
| `web.w2_more` | زِد واحدًا | One more | Un de plus | |
| `web.w2_remove` | احذف | Remove | Retirer | |
| `web.w2_items_total` | المنتجات | Items | Articles | |
| `web.w2_delivery` | التوصيل | Delivery | Livraison | |
| `web.w2_delivery_to` | التوصيل إلى {village} | Delivery to {village} | Livraison à {village} | |
| `web.w2_small_fee` | رسم الطلب الصغير | Small-order fee | Frais de petite commande | |
| `web.w2_credit` | رصيدك | Your credit | Votre crédit | |
| `web.w2_dues` | مستحق من قبل | Owed from before | Dû d'avant | |
| `web.w2_total` | المجموع | Total | Total | |
| `web.w2_in_lira` | بالليرة، بسعر اليوم | In lira, at today's rate | En livres, au taux du jour | |
| `web.w2_fee_pick` | اختر قريتك لترى رسم التوصيل. | Choose your village to see the delivery fee. | Choisissez votre village pour voir les frais de livraison. | |
| `web.w2_village` | قريتك | Your village | Votre village | |
| `web.w2_village_show` | اعرض الرسم | Show the fee | Voir les frais | |
| `web.w2_min_missing` | الحد الأدنى للطلب {min}. أضف {gap} لتتمكّن من إتمام الطلب. | The minimum order is {min}. Add {gap} more to check out. | La commande minimum est de {min}. Ajoutez encore {gap} pour commander. | |
| `web.w2_min_ok` | بلغت الحد الأدنى للطلب. | The minimum order is reached. | La commande minimum est atteinte. | |
| `web.w2_checkout` | أتمّ الطلب | Check out | Commander | |
| `web.w2_sold_out` | نفد الآن، لذلك لم يُحسب: | Sold out now, so it is left out: | Épuisé pour l'instant, donc laissé de côté : | |
| `web.w2_coming_soon` | قريباً، لا نستطيع أخذه بعد: | Coming soon, we can't take it yet: | Bientôt disponible, nous ne pouvons pas encore le prendre : | |
| `web.w2_unknown` | لم يعد يُباع، لذلك لم يُحسب: | No longer sold, so it is left out: | Plus vendu, donc laissé de côté : | |
| `web.w2_price_changed` | تغيّر السعر منذ أضفته: | The price changed since you added it: | Le prix a changé depuis l'ajout : | |
| `web.w2_again_missing` | غير متوفر الآن، لذلك لم يُضَف: | Not available now, so not added: | Indisponible pour l'instant, donc pas ajouté : | |
| `web.w2_again_done` | طلبك الأخير في السلة بأسعار اليوم. | Your last order is in the basket at today's prices. | Votre dernière commande est dans le panier, aux prix du jour. | |
| `web.w2_prices_note` | نقرأ الأسعار والتوفر من متجرنا من جديد في كل مرة تفتح فيها هذه الصفحة. | Prices and stock are read again from our shop each time you open this page. | Les prix et le stock sont relus dans notre magasin à chaque ouverture de cette page. | |
| `web.w2_rider_fee_note` | رسم التوصيل يذهب كاملًا إلى عامل التوصيل. | The delivery fee goes to the rider in full. | Les frais de livraison vont entièrement au livreur. | |
| `web.w2_signin_title` | أكّد رقمك على واتساب | Confirm your number on WhatsApp | Confirmez votre numéro sur WhatsApp | |
| `web.w2_signin_lead` | لا كلمة مرور ولا شيء لتكتبه. رسالة واحدة من واتساب الخاص بك تؤكد رقمك وتُبقي هذا الجهاز مسجّلًا لمدة {days} يومًا. | No password, nothing to type. One message from your own WhatsApp confirms your number and signs in this device for {days} days. | Pas de mot de passe, rien à taper. Un message depuis votre propre WhatsApp confirme votre numéro et garde cet appareil connecté pendant {days} jours. | |
| `web.w2_signin_button` | أكّد رقمك على واتساب | Confirm your number on WhatsApp | Confirmer votre numéro sur WhatsApp | |
| `web.w2_signin_step1` | اضغط الزر. يُفتح واتساب والرمز مكتوب مسبقًا. | Tap the button. WhatsApp opens with a code already typed. | Appuyez sur le bouton. WhatsApp s'ouvre avec un code déjà écrit. | |
| `web.w2_signin_step2` | اضغط إرسال. لا تغيّر الرمز. | Press send. Do not change the code. | Appuyez sur envoyer. Ne changez pas le code. | |
| `web.w2_signin_step3` | عُد إلى هذه الصفحة. تتحدّث وحدها. | Come back to this page. It updates by itself. | Revenez sur cette page. Elle se met à jour toute seule. | |
| `web.w2_signin_code` | رمزك | Your code | Votre code | |
| `web.w2_signin_open` | افتح واتساب | Open WhatsApp | Ouvrir WhatsApp | |
| `web.w2_signin_waiting` | بانتظار رسالتك. | Waiting for your message. | En attente de votre message. | |
| `web.w2_signin_expires` | يعمل الرمز لمدة {n} دقائق. | The code works for {n} minutes. | Le code est valable {n} minutes. | |
| `web.w2_signin_done` | تأكّد رقمك. هذا الجهاز مسجّل الدخول. | Your number is confirmed. This device is signed in. | Votre numéro est confirmé. Cet appareil est connecté. | |
| `web.w2_signin_continue` | تابِع | Continue | Continuer | |
| `web.w2_signin_consent` | بإرسال الرمز تؤكد رقمك وتسمح لنا بإرسال تحديثات طلباتك في هذه المحادثة. | Sending the code confirms your number and lets us send your order updates in this chat. | Envoyer le code confirme votre numéro et nous permet d'envoyer le suivi de vos commandes dans cette conversation. | |
| `web.w2_signin_no_wa` | عنوان واتساب الخاص بنا غير محدّد بعد، لذلك لا يمكن تسجيل الدخول الآن. | Our WhatsApp address is not set yet, so signing in is not possible yet. | Notre adresse WhatsApp n'est pas encore définie : la connexion n'est pas encore possible. | |
| `web.w2_signin_b1` | كل طلباتك في مكان واحد | Every order in one place | Toutes vos commandes au même endroit | |
| `web.w2_signin_b1_text` | الطلبات التي أرسلتها عبر واتساب وهنا. | Orders you placed on WhatsApp and here. | Les commandes passées sur WhatsApp et ici. | |
| `web.w2_signin_b2` | أماكنك | Your places | Vos adresses | |
| `web.w2_signin_b2_text` | تُحفظ مرة وتُستعمل في الاثنين. | Saved once, used on both. | Enregistrées une fois, utilisées des deux côtés. | |
| `web.w2_signin_b3` | أنت فقط | Only you | Vous seul | |
| `web.w2_signin_b3_text` | يُثبت رقمك برسالة من واتساب الخاص بك. يمكنك تسجيل الخروج من كل الأجهزة في أي وقت. | Your number is proven by a message from your own WhatsApp. Sign out on every device at any time. | Votre numéro est prouvé par un message depuis votre propre WhatsApp. Déconnectez tous vos appareils à tout moment. | |
| `web.w2_checkout_title` | إتمام الطلب | Checkout | Commande | |
| `web.w2_step_place` | إلى أين؟ | Where to? | Où livrer ? | |
| `web.w2_saved_places` | الأماكن المحفوظة | Saved places | Adresses enregistrées | |
| `web.w2_no_places` | لا يوجد مكان محفوظ بعد. | No saved place yet. | Aucune adresse enregistrée. | |
| `web.w2_use_location` | استعمل موقعي | Use my location | Utiliser ma position | |
| `web.w2_location_hint` | يطلب هاتفك مرة واحدة مشاركة موقعك. الموقع يحدّد القرية ورسم التوصيل. | Your phone asks once to share your location. The pin decides the village and the fee. | Votre téléphone demande une fois de partager votre position. La position décide du village et des frais. | |
| `web.w2_paste_pin` | أو الصق رابط خريطة أو إحداثيات | Or paste a map link or coordinates | Ou collez un lien de carte ou des coordonnées | |
| `web.w2_paste_hint` | مثلًا رابط من خرائط Google، أو 33.68, 35.56 | For example a Google Maps link, or 33.68, 35.56 | Par exemple un lien Google Maps, ou 33.68, 35.56 | |
| `web.w2_save_pin` | احفظ هذا الموقع | Save this pin | Enregistrer cette position | |
| `web.w2_send_location` | أرسل موقعي عبر واتساب | Send my location on WhatsApp | Envoyer ma position sur WhatsApp | |
| `web.w2_send_location_hint` | في المحادثة، اضغط على المشبك، ثم الموقع، ثم إرسال. يظهر مكانك هنا بعد ذلك. | In the chat, tap the clip, then Location, then send. Your place then appears here. | Dans la conversation, touchez le trombone, puis Position, puis envoyer. Votre adresse apparaît ensuite ici. | |
| `web.w2_refresh` | أرسلته، حدّث الصفحة | I sent it, refresh | Je l'ai envoyée, actualiser | |
| `web.w2_pin_located` | الموقع في {village}. | Pinned in {village}. | Position à {village}. | |
| `web.w2_pin_unsure` | في أي قرية هذا الموقع؟ | Which village is this pin in? | Dans quel village est cette position ? | |
| `web.w2_pin_outside` | لا نوصّل إلى هناك بعد. يمكنك أن تسألنا عبر واتساب. | We don't deliver there yet. You can ask us on WhatsApp. | Nous ne livrons pas encore là-bas. Vous pouvez nous demander sur WhatsApp. | |
| `web.w2_pin_not_served` | لا نوصّل إلى {village} بعد. | We don't deliver to {village} yet. | Nous ne livrons pas encore à {village}. | |
| `web.w2_pin_bad` | لم نستطع قراءة موقع من هذا. | We could not read a position from that. | Nous n'avons pas pu lire de position. | |
| `web.w2_pin_choose` | اختر | Choose | Choisir | |
| `web.w2_house` | البيت أو المبنى | House or building | Maison ou immeuble | |
| `web.w2_floor` | الطابق | Floor | Étage | |
| `web.w2_directions` | إرشادات لعامل التوصيل (اختياري) | Directions for the rider (optional) | Indications pour le livreur (facultatif) | |
| `web.w2_save` | احفظ | Save | Enregistrer | |
| `web.w2_has_pin` | محدّد على الخريطة | Pinned | Position enregistrée | |
| `web.w2_no_pin` | بلا موقع | No pin | Sans position | |
| `web.w2_step_when` | متى؟ | When? | Quand ? | |
| `web.w2_now` | بأسرع وقت | As soon as possible | Dès que possible | |
| `web.w2_now_eta` | بأسرع وقت (حوالي {n} دقيقة) | As soon as possible (about {n} min) | Dès que possible (environ {n} min) | |
| `web.w2_now_closed` | نحن مغلقون الآن. اختر موعدًا للتوصيل. | We're closed now. Choose a delivery window. | Nous sommes fermés. Choisissez un créneau de livraison. | |
| `web.w2_windows_none` | لا مواعيد توصيل في الأيام القادمة. | No delivery windows in the coming days. | Aucun créneau de livraison dans les prochains jours. | |
| `web.w2_step_missing` | إذا نقص منتج | If an item is missing | Si un article manque | |
| `web.w2_missing_best_match` | الأقرب إليه | The closest match | Le plus proche | |
| `web.w2_missing_ask` | راسلني أولًا | Message me first | M'écrire d'abord | |
| `web.w2_missing_remove` | احذفه | Leave it out | Le retirer | |
| `web.w2_missing_per_item` | اختر لكل منتج | Choose per item | Choisir article par article | |
| `web.w2_missing_same` | كما في الأعلى | Same as above | Comme ci-dessus | |
| `web.w2_step_pay` | الدفع | Payment | Paiement | |
| `web.w2_pay_usd` | نقدًا بالدولار | Cash in dollars | Espèces en dollars | |
| `web.w2_pay_lbp` | نقدًا بالليرة، بسعر اليوم | Cash in lira, at today's rate | Espèces en livres, au taux du jour | |
| `web.w2_pay_rate` | سعر اليوم للدولار الواحد: | Today's rate for one dollar: | Le taux du jour pour un dollar : | |
| `web.w2_pay_whish` | تحويل عبر Whish | Whish transfer | Virement Whish | |
| `web.w2_pay_omt` | تحويل عبر OMT | OMT transfer | Virement OMT | |
| `web.w2_pay_transfer_note` | يتحقق شخص من تحويلك قبل أن نجهّز الطلب. نرسل لك التفاصيل عبر واتساب بعد أن تؤكد. | A person checks your transfer before we pack. We send the details on WhatsApp after you confirm. | Une personne vérifie votre virement avant la préparation. Nous envoyons les détails sur WhatsApp après votre confirmation. | |
| `web.w2_note` | بأي ورقة ستدفع؟ | Which note will you pay with? | Avec quel billet payerez-vous ? | |
| `web.w2_note_exact` | المبلغ تمامًا | The exact amount | Le montant exact | |
| `web.w2_note_lbp` | كم ستدفع؟ | How much will you hand over? | Combien donnerez-vous ? | |
| `web.w2_no_card` | الدفع بالبطاقة أو Whish Pay لاحقًا. | Paying by card or Whish Pay comes later. | Le paiement par carte ou Whish Pay viendra plus tard. | |
| `web.w2_first_cap` | يُدفع الطلب الأول نقدًا حتى {cap}. هذا الطلب أكبر، فاختر Whish أو OMT. | A first order is paid in cash up to {cap}. This order is larger, so choose Whish or OMT. | Une première commande se paie en espèces jusqu'à {cap}. Celle-ci est plus grande : choisissez Whish ou OMT. | |
| `web.w2_step_notes` | شيء آخر؟ (اختياري) | Anything else? (optional) | Autre chose ? (facultatif) | |
| `web.w2_card` | بطاقة طلبك | Your order card | Votre bon de commande | |
| `web.w2_update` | حدّث البطاقة | Update the card | Mettre à jour le bon | |
| `web.w2_send_card` | أرسل الطلب إلى واتساب الخاص بي | Send the order to my WhatsApp | Envoyer la commande sur mon WhatsApp | |
| `web.w2_confirm_on_wa` | لم يُطلب شيء بعد. نرسل هذه البطاقة إلى واتساب الخاص بك، ويُرسل الطلب عندما تضغط «تأكيد» هناك. | Nothing is ordered yet. We send this card to your WhatsApp, and the order is placed when you tap Confirm there. | Rien n'est encore commandé. Nous envoyons ce bon sur votre WhatsApp, et la commande est passée quand vous touchez Confirmer là-bas. | |
| `web.w2_need_place` | اختر مكانًا أو حدّد موقعًا أولًا. | Choose or pin a place first. | Choisissez ou enregistrez d'abord une adresse. | |
| `web.w2_need_details` | أضف البيت والطابق ليجدك عامل التوصيل. | Add the house and floor, so the rider finds you. | Ajoutez la maison et l'étage, pour que le livreur vous trouve. | |
| `web.w2_err_not_ready` | تغيّر شيء في البطاقة. راجعها وأرسلها من جديد. | Something on the card changed. Check it and send again. | Quelque chose a changé sur le bon. Vérifiez-le et renvoyez-le. | |
| `web.w2_err_note_too_small` | هذا المبلغ ليس أكثر من المجموع. | That amount is not more than the total. | Ce montant n'est pas supérieur au total. | |
| `web.w2_err_unknown_note` | اختر أحد المبالغ في القائمة. | Choose one of the amounts in the list. | Choisissez un des montants de la liste. | |
| `web.w2_err_closed` | نحن مغلقون الآن. اختر موعدًا للتوصيل. | We're closed now. Choose a delivery window. | Nous sommes fermés. Choisissez un créneau de livraison. | |
| `web.w2_err_village` | لا نوصّل إلى هذا المكان بعد. | We don't deliver to this place yet. | Nous ne livrons pas encore à cette adresse. | |
| `web.w2_err_fx` | نحدّث سعر اليوم الآن. حاول بعد دقائق. | We're updating today's rate. Try again in a few minutes. | Nous mettons à jour le taux du jour. Réessayez dans quelques minutes. | |
| `web.w2_err_empty` | سلتك فارغة. | Your basket is empty. | Votre panier est vide. | |
| `web.w2_err_window` | لم يعد هذا الموعد متاحًا. اختر موعدًا آخر. | That delivery window is no longer open. Choose another. | Ce créneau n'est plus ouvert. Choisissez-en un autre. | |
| `web.w2_err_not_linked` | أكّد رقمك أولًا. | Confirm your number first. | Confirmez d'abord votre numéro. | |
| `web.w2_err_any` | لم نستطع الإرسال. حاول بعد قليل. | We could not send it. Try again in a moment. | L'envoi n'a pas abouti. Réessayez dans un instant. | |
| `web.w2_order_title` | الطلب {code} | Order {code} | Commande {code} | |
| `web.w2_order_waiting` | بطاقة طلبك على واتساب. اضغط «تأكيد» هناك لإرسال الطلب. | Your order card is on WhatsApp. Tap Confirm there to place the order. | Votre bon de commande est sur WhatsApp. Touchez Confirmer là-bas pour passer la commande. | |
| `web.w2_order_waiting_note` | لا نحجز شيئًا قبل أن تؤكد. تنتهي البطاقة بعد {n} دقيقة من إنشائها. | Nothing is held until you confirm. The card lapses {n} minutes after it was made. | Rien n'est réservé avant votre confirmation. Le bon expire {n} minutes après sa création. | |
| `web.w2_order_resend` | لم تصلك البطاقة؟ افتح واتساب وأرسل الرسالة المكتوبة: تعود البطاقة فورًا. | Didn't get the card? Open WhatsApp and send the message we typed: the card comes back at once. | Vous n'avez pas reçu le bon ? Ouvrez WhatsApp et envoyez le message préparé : le bon revient aussitôt. | |
| `web.w2_order_open_wa` | افتح واتساب | Open WhatsApp | Ouvrir WhatsApp | |
| `web.w2_order_steps` | أين طلبك | Where your order is | Où en est votre commande | |
| `web.w2_order_window` | التوصيل: {when} | Delivery: {when} | Livraison : {when} | |
| `web.w2_order_eta` | التوصيل خلال حوالي {n} دقيقة بعد خروجه من المستودع. | Delivery in about {n} minutes once it leaves the hub. | Livraison en environ {n} minutes une fois partie du dépôt. | |
| `web.w2_order_changed` | ما الذي تغيّر | What changed | Ce qui a changé | |
| `web.w2_order_removed` | حُذف: | Taken off: | Retiré : | |
| `web.w2_order_substituted` | {name} بدل {for} | {name} instead of {for} | {name} à la place de {for} | |
| `web.w2_order_code` | رمز التسليم | Your handover code | Votre code de remise | |
| `web.w2_order_code_note` | أعطه فقط عندما يصبح طلبك بين يديك. | Give it only when you have your order in your hands. | Donnez-le seulement quand vous avez votre commande en main. | |
| `web.w2_order_person` | تحدّث إلى شخص | Talk to a person | Parler à une personne | |
| `web.w2_order_cancelled` | هذا الطلب مُلغى. | This order is cancelled. | Cette commande est annulée. | |
| `web.w2_order_items` | في هذا الطلب | In this order | Dans cette commande | |
| `web.w2_order_updates` | تتحدّث هذه الصفحة وحدها. | This page updates by itself. | Cette page se met à jour toute seule. | |
| `web.w2_order_payment` | الدفع | Payment | Paiement | |
| `web.w2_today` | اليوم | today | aujourd'hui | |
| `web.w2_tomorrow` | غدًا | tomorrow | demain | |
| `web.w2_orders_title` | طلباتك | Your orders | Vos commandes | |
| `web.w2_orders_none` | لا طلبات بعد. | No orders yet. | Pas encore de commande. | |
| `web.w2_on_whatsapp` | عبر واتساب | On WhatsApp | Sur WhatsApp | |
| `web.w2_on_web` | عبر الموقع | On the website | Sur le site | |
| `web.w2_order_again` | اطلبه مجددًا | Order again | Commander à nouveau | |
| `web.w2_view` | اعرض | View | Voir | |
| `web.w2_items_n` | {n} منتج | {n} items | {n} articles | |
| `web.w2_account_title` | حسابك | Your account | Votre compte | |
| `web.w2_places` | الأماكن المحفوظة | Saved places | Adresses enregistrées | |
| `web.w2_language` | اللغة | Language | Langue | |
| `web.w2_memory` | ما نتذكّره | What we remember | Ce que nous retenons | |
| `web.w2_memory_intro` | ما نستعمله لتسريع الطلب. يمكنك أن تراه أو تمحوه أو توقفه، هنا أو عبر واتساب. | What we use to make ordering quicker. You can see it, forget it or stop it, here or on WhatsApp. | Ce qui nous sert à rendre la commande plus rapide. Vous pouvez le voir, l'effacer ou l'arrêter, ici ou sur WhatsApp. | |
| `web.w2_mem_restrictions` | القيود التي طلبت أن نحفظها (تُطبَّق دائمًا) | Restrictions you asked us to keep (always applied) | Restrictions que vous nous avez demandé de garder (toujours appliquées) | |
| `web.w2_mem_usuals` | منتجات تطلبها كثيرًا | Items you often order | Articles que vous commandez souvent | |
| `web.w2_mem_brands` | ماركات اخترتها | Brands you chose | Marques choisies | |
| `web.w2_mem_notes` | ملاحظات | Notes | Notes | |
| `web.w2_mem_payment` | طريقة دفعك المعتادة | How you usually pay | Votre façon habituelle de payer | |
| `web.w2_mem_none` | لا شيء بعد. | Nothing yet. | Rien pour l'instant. | |
| `web.w2_mem_paused` | التذكّر متوقف: لا نتعلّم شيئًا جديدًا ولا نستعمل ما تعلّمناه. القيود التي طلبت حفظها ما زالت تُطبَّق. | Remembering is stopped: we learn nothing new and use nothing learned. Restrictions you asked us to keep still apply. | La mémoire est arrêtée : nous n'apprenons rien de nouveau et n'utilisons rien d'appris. Les restrictions que vous avez demandé de garder s'appliquent toujours. | |
| `web.w2_forget` | امحُ ما تعلّمناه | Forget what we learned | Effacer ce que nous avons appris | |
| `web.w2_forget_done` | تم. محونا ما تعلّمناه، هنا وعلى واتساب. | Done. We forgot what we had learned, here and on WhatsApp. | C'est fait. Nous avons effacé ce que nous avions appris, ici et sur WhatsApp. | |
| `web.w2_stop` | أوقف التذكّر | Stop remembering | Arrêter de retenir | |
| `web.w2_start` | تذكّر من جديد | Remember again | Retenir à nouveau | |
| `web.w2_signout` | سجّل الخروج من هذا الجهاز | Sign out of this device | Se déconnecter de cet appareil | |
| `web.w2_signout_all` | سجّل الخروج من كل الأجهزة | Sign out on every device | Se déconnecter de tous les appareils | |
| `web.w2_signout_all_done` | سُجّل الخروج من كل الأجهزة. | Signed out on every device. | Déconnecté de tous les appareils. | |
| `web.w2_signed_out` | سُجّل خروجك من هذا الجهاز. | You're signed out of this device. | Vous êtes déconnecté de cet appareil. | |
| `web.w2_signed_in_until` | يبقى هذا الجهاز مسجّلًا حتى {date}. | This device stays signed in until {date}. | Cet appareil reste connecté jusqu'au {date}. | |
| `web.w2_signout_wa` | يمكنك أيضًا أن ترسل لنا «تسجيل الخروج» عبر واتساب. | You can also send "sign out" to us on WhatsApp. | Vous pouvez aussi nous envoyer « déconnexion » sur WhatsApp. | |
| `web.w2_need_signin` | أكّد رقمك لترى هذه الصفحة. | Confirm your number to see this page. | Confirmez votre numéro pour voir cette page. | |
| `web.w2_pay_cod` | نقدًا عند الاستلام | Cash on delivery | Espèces à la livraison | |
| `web.w2_how_title` | كيف يعمل ألو كينغ | How Alo King works | Comment fonctionne Alo King | |
| `web.w2_how_lead` | بقالة من متجرنا في الشوف، يوصلها عمّال التوصيل لدينا. اطلب عبر واتساب أو هنا؛ وتؤكد كل طلب عبر واتساب. | Groceries from our own shop in the Chouf, brought by our riders. Order on WhatsApp or here; you confirm every order on WhatsApp. | Des courses de notre propre magasin dans le Chouf, apportées par nos livreurs. Commandez sur WhatsApp ou ici ; vous confirmez chaque commande sur WhatsApp. | |
| `web.w2_how_ways` | ثلاث طرق للطلب | Three ways to order | Trois façons de commander | |
| `web.w2_how_way_text` | اكتب طلبك على واتساب. | Type your order on WhatsApp. | Écrivez votre commande sur WhatsApp. | |
| `web.w2_how_way_voice` | أرسل رسالة صوتية على واتساب. | Send a voice note on WhatsApp. | Envoyez un message vocal sur WhatsApp. | |
| `web.w2_how_way_web` | املأ سلة هنا، ثم أكّد عبر واتساب. | Fill a basket here, then confirm on WhatsApp. | Remplissez un panier ici, puis confirmez sur WhatsApp. | |
| `web.w2_how_steps` | من السلة إلى الباب | From basket to door | Du panier à la porte | |
| `web.w2_how_step1` | اختر منتجاتك. الأسعار والتوفر من متجرنا. | Choose your items. Prices and stock come from our shop. | Choisissez vos articles. Prix et stock viennent de notre magasin. | |
| `web.w2_how_step2` | نرسل بطاقة الطلب إلى واتساب الخاص بك. | We send the order card to your WhatsApp. | Nous envoyons le bon de commande sur votre WhatsApp. | |
| `web.w2_how_step3` | اضغط «تأكيد» على البطاقة. عندها فقط يُرسل الطلب. | Tap Confirm on the card. Only then is it ordered. | Touchez Confirmer sur le bon. C'est seulement alors que c'est commandé. | |
| `web.w2_how_step4` | نجهّزه ويوصله عامل التوصيل. تدفع عند الاستلام. | We pack it and our rider brings it. Pay when it arrives. | Nous préparons et notre livreur l'apporte. Vous payez à l'arrivée. | |
| `web.w2_how_when` | الساعات والحد الأدنى | Hours and minimum | Horaires et minimum | |
| `web.w2_how_hours` | مفتوح كل يوم، {hours}. | Open every day, {hours}. | Ouvert tous les jours, {hours}. | |
| `web.w2_how_min` | الحد الأدنى للطلب: | Minimum order: | Commande minimum : | |
| `web.w2_how_fees` | رسم التوصيل حسب القرية | Delivery fee by village | Frais de livraison par village | |
| `web.w2_how_village` | القرية | Village | Village | |
| `web.w2_how_fee` | الرسم | Fee | Frais | |
| `web.w2_how_time` | الوقت | Time | Délai | |
| `web.w2_how_small` | رسم الطلب الصغير دون {below}: | Small-order fee under {below}: | Frais de petite commande en dessous de {below} : | |
| `web.w2_how_pay` | الدفع | Paying | Payer | |
| `web.w2_how_pay_cash` | نقدًا بالدولار، أو بالليرة بسعر اليوم. قل بأي ورقة ستدفع ويحضر لك عامل التوصيل الباقي. | Cash in dollars, or in lira at the day's rate. Say which note you'll pay with and the rider brings change. | En espèces, en dollars ou en livres au taux du jour. Dites avec quel billet vous payez et le livreur apporte la monnaie. | |
| `web.w2_how_pay_rate` | سعر اليوم للدولار الواحد: | Today's rate for one dollar: | Le taux du jour pour un dollar : | |
| `web.w2_how_pay_transfer` | تحويل عبر Whish أو OMT: أرسل صورة الإيصال في المحادثة. يتحقق منه شخص قبل أن نجهّز الطلب. | Whish or OMT transfer: send the receipt photo in the chat. A person checks it before we pack. | Virement Whish ou OMT : envoyez la photo du reçu dans la conversation. Une personne le vérifie avant la préparation. | |
| `web.w2_how_first` | يُدفع الطلب الأول نقدًا حتى {cap}؛ وما فوق ذلك بالتحويل. | A first order is paid in cash up to {cap}; above that, by transfer. | Une première commande se paie en espèces jusqu'à {cap} ; au-delà, par virement. | |
| `web.w2_how_missing` | إذا نقص شيء | If something is missing | Si quelque chose manque | |
| `web.w2_how_missing_text` | تختار في كل طلب: الأقرب إليه، أو رسالة أولًا، أو حذفه، للكل أو لكل منتج. | You choose on each order: the closest match, a message first, or leave it out, for everything or per item. | Vous choisissez à chaque commande : le plus proche, un message d'abord, ou le retirer, pour tout ou article par article. | |
| `web.w2_how_confirm` | التأكيد | Confirming | Confirmer | |
| `web.w2_how_confirm_text` | لا نحجز شيئًا قبل أن تضغط «تأكيد». تذكير واحد بعد {r} دقيقة؛ تنتهي البطاقة بعد {l} دقيقة، ويمكنك فتحها من جديد. | Nothing is held until you tap Confirm. One reminder after {r} minutes; the card lapses after {l} minutes, and you can open it again. | Rien n'est réservé avant que vous touchiez Confirmer. Un rappel après {r} minutes ; le bon expire après {l} minutes, et vous pouvez le rouvrir. | |
| `web.w2_how_code` | رمز التسليم | The handover code | Le code de remise | |
| `web.w2_how_code_text` | الطلب المدفوع مسبقًا لا يُسلَّم إلا مقابل رمز من 4 أرقام نرسله لك. | A prepaid order is handed over only against a 4-digit code we send you. | Une commande payée d'avance n'est remise que contre un code à 4 chiffres que nous vous envoyons. | |
| `web.w2_how_account` | حسابك وخصوصيتك | Your account and privacy | Votre compte et votre vie privée | |
| `web.w2_how_account_text` | لا كلمة مرور: رسالة واحدة عبر واتساب تؤكد رقمك. سجّل الخروج متى شئت، واطّلع على ما نتذكّره أو امحُه. | No password: one WhatsApp message confirms your number. Sign out at any time, and see or forget what we remember. | Pas de mot de passe : un message WhatsApp confirme votre numéro. Déconnectez-vous à tout moment, voyez ou effacez ce que nous retenons. | |
| `web.w2_how_cta` | ابدأ التسوّق | Start shopping | Commencer les courses | |
| `web.w2_page_prev` | السابق | Previous | Précédent | |
| `web.w2_page_next` | التالي | Next | Suivant | |
| `web.w2_page_n` | الصفحة {n} من {total} | Page {n} of {total} | Page {n} sur {total} | |

### French status words (the label table has Arabic and English; French reads these for the same ids)

| Status id | French | Read by |
|---|---|---|
| `draft` | Pas encore envoyée | |
| `awaiting_confirmation` | En attente de votre confirmation | |
| `awaiting_payment` | En attente du paiement | |
| `confirmed` | Confirmée | |
| `preparing` | En préparation au dépôt | |
| `ready` | Prête | |
| `out_for_delivery` | En route | |
| `arrived` | À votre porte | |
| `delivered` | Livrée | |
| `failed_delivery` | Non livrée | |
| `returned` | Retournée | |
| `closed` | Livrée | |
| `cancelled` | Annulée | |

### On WhatsApp (read by code before any model; and two new lines on the order card)

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `web.linked` | ✅ تأكّد رقمك.<br>ارجع عالموقع وكمّل طلبك من هونيك. | ✅ Your number is confirmed.<br>Go back to the website to finish your order. | ✅ Votre numéro est confirmé.<br>Retournez sur le site pour terminer votre commande. | |
| `web.codeExpired` | هالرمز انتهت صلاحيته.<br>ارجع عالموقع واضغط «أكّد رقمك على واتساب» من جديد. | This code has expired.<br>Go back to the website and tap "Confirm your number on WhatsApp" again. | Ce code a expiré.<br>Retournez sur le site et appuyez de nouveau sur « Confirmer votre numéro sur WhatsApp ». | |
| `web.codeUsed` | هالرمز استُعمل من رقم تاني.<br>ارجع عالموقع واطلب رمز جديد. | Another number already used this code.<br>Go back to the website for a new one. | Un autre numéro a déjà utilisé ce code.<br>Retournez sur le site pour en avoir un nouveau. | |
| `web.codeUnknown` | ما عرفنا هالرمز.<br>ارجع عالموقع واضغط «أكّد رقمك على واتساب» من جديد. | We don't know this code.<br>Go back to the website and tap "Confirm your number on WhatsApp" again. | Nous ne connaissons pas ce code.<br>Retournez sur le site et appuyez de nouveau sur « Confirmer votre numéro sur WhatsApp ». | |
| `web.signedOut(1)` | ✅ سكّرنا حسابك على الموقع.<br>طلباتك ومحادثتك هون باقيين متل ما هنّي. | ✅ You are signed out of the website.<br>Your orders and this chat stay as they are. | ✅ Vous êtes déconnecté du site.<br>Vos commandes et cette conversation restent telles quelles. | |
| `web.signedOut(2)` | ✅ سكّرنا حسابك على الموقع على كل الأجهزة.<br>طلباتك ومحادثتك هون باقيين متل ما هنّي. | ✅ You are signed out of the website on every device.<br>Your orders and this chat stay as they are. | ✅ Vous êtes déconnecté du site sur tous vos appareils.<br>Vos commandes et cette conversation restent telles quelles. | |
| `web.notSignedIn` | ما في جهاز مسجّل دخول على الموقع برقمك. | No device is signed in to the website with your number. | Aucun appareil n'est connecté au site avec votre numéro. | |
| `web.cardNotWaiting("AK-1042")` | الطلب AK-1042 ما عاد ناطر تأكيد.<br>إذا بدك تعرف وين صار، اسألني هون. | Order AK-1042 is no longer waiting for your Confirm.<br>Ask me here if you want to know where it is. | La commande AK-1042 n'attend plus votre confirmation.<br>Demandez-moi ici si vous voulez savoir où elle en est. | |
| `web.cardUnknown` | ما لقينا طلب إلك بهالرقم.<br>اكتبلي شو بدك ومنساعدك. | We found no order of yours with that number.<br>Tell me what you need and we'll help. | Nous n'avons trouvé aucune commande à vous avec ce numéro.<br>Dites-moi ce qu'il vous faut et nous vous aiderons. | |
| `card.changeForLbp` | رح تدفع بالليرة، ومعك:<br>2,000,000 ل.ل | You pay in lira, with:<br>2,000,000 LBP | Vous payez en livres, avec :<br>2,000,000 LBP | |
| `cx.missingItemLine("Labneh 500 g", best_match)` | Labneh 500 g: منحطّ أقرب بديل | Labneh 500 g: we put the closest match | Labneh 500 g : nous mettons le plus proche | |
| `cx.missingItemLine("Labneh 500 g", ask)` | Labneh 500 g: منسألك | Labneh 500 g: we ask you | Labneh 500 g : nous vous demandons | |
| `cx.missingItemLine("Labneh 500 g", remove)` | Labneh 500 g: منشيلو من الطلب | Labneh 500 g: we take it off | Labneh 500 g : nous le retirons | |

