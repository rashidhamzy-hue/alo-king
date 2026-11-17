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

## UX2b, Approve, Intake, Money, Settings and Riders (console, staff-facing, written by a model; 17 November 2026)

Source: the `pick(L, "English", "Arabic")` pairs and the `{ en, ar }` entries added to `apps/console/src/pages/{approve,intakeframe,intake,readiness,moneyframe,payments,money,refunds,riders,settings,settingmeta}.ts`, and one line of `labelqueue.ts`. Staff read these, never a customer. Words with `${…}` stand for a number or a name the page fills in. The hub is «المستودع» everywhere (never «المركز»). Lines already in an earlier table of this file (UX2a, LB1, SELL1) are not repeated. The database's refusals (`explain()` in `app.ts`) stay English, as for every older page. A test (`test/ci/ux2b-arabic.test.ts`) holds this table equal to the pages.

| English | Arabic | Read by |
|---|---|---|
| Cards | البطاقات | unread |
| Card ${n + 1} of ${total} | البطاقة ${n + 1} من ${total} | unread |
| Previous | السابقة | unread |
| Skip for now | تخطَّ الآن | unread |
| Reason (needed to reject) | السبب (مطلوب للرفض) | unread |
| Prefer a list?  | تفضّل قائمة؟  | unread |
| See all of these as a list | اعرض كلها كقائمة | unread |
| This item is not in the catalog database, so nothing can be applied. | هذا الصنف غير موجود في قاعدة الكتالوج، فلا يمكن تطبيق شيء. | unread |
| The catalog name has changed since this was proposed: check that the proposal still fits. | تغيّر اسم الكتالوج منذ اقتراح هذا: تأكد أن الاقتراح ما زال مناسباً. | unread |
| The Arabic was written by a model: it needs a person who reads Arabic. | العربية كتبها نموذج: تحتاج شخصاً يقرأ العربية. | unread |
| Words the generator had to add: | كلمات اضطر المولّد لإضافتها: | unread |
| no brand | بلا علامة | unread |
| In the catalog now | في الكتالوج الآن | unread |
| English name | الاسم بالإنجليزية | unread |
| Arabic name | الاسم بالعربية | unread |
| Proposed | المقترح | unread |
| Will be saved as | سيُحفظ باسم | unread |
| Open Food Facts calls it: | يسمّيه Open Food Facts: | unread |
| Approving saves the name, queues its search words again, and shows an Undo for a moment: undoing puts the earlier name back. | الموافقة تحفظ الاسم وتعيد بناء كلمات بحثه، وتظهر «تراجع» للحظات: التراجع يعيد الاسم السابق. | unread |
| Correct it first | صحّحه أولاً | unread |
| English size | الحجم بالإنجليزية | unread |
| Arabic size | الحجم بالعربية | unread |
| Note (why) | ملاحظة (السبب) | unread |
| Save my correction | احفظ تصحيحي | unread |
| barcode | الباركود | unread |
| Proposed picture of | الصورة المقترحة لـ | unread |
| Picture not available. | الصورة غير متاحة. | unread |
| Source | المصدر | unread |
| original | الأصل | unread |
| Licence | الترخيص | unread |
| Fetched | جُلبت | unread |
| Never shown to customers | لا تُعرض للزبائن أبداً | unread |
| (licence unknown): approving keeps it only as a guide for the intake photo. | (الترخيص غير معروف): الموافقة تبقيها دليلاً لصورة الإدخال فقط. | unread |
| Approve only if the picture shows exactly this item: same brand, product and size, one pack, plain background, no price tag, shop logo or text on top. | وافق فقط إن كانت الصورة تُظهر هذا الصنف تماماً: العلامة والمنتج والحجم نفسها، عبوة واحدة، خلفية سادة، بلا بطاقة سعر أو شعار متجر أو كتابة فوقها. | unread |
| A picture's approval cannot be undone from here: it replaces the earlier picture. A wrong one is rejected on the Pictures page. | لا يمكن التراجع عن الموافقة على صورة من هنا: فهي تحلّ محل الصورة السابقة. الصورة الخاطئة تُرفض في صفحة الصور. | unread |
| The pack says | العبوة تقول | unread |
| One line each, as printed | سطر لكل تحذير كما هو مطبوع | unread |
| As printed | كما هو مطبوع | unread |
| Group ${x.group} of 5: ${GROUP(L, x.group)[0]} | المجموعة ${x.group} من 5: ${GROUP(L, x.group)[0]} | unread |
| no photo | لا صورة | unread |
| Printed words | الكلمات المطبوعة | unread |
| Read from | مأخوذ من | unread |
| Another source said otherwise: | مصدر آخر قال غير ذلك: | unread |
| The label's reading wins; check the photo. | قراءة الملصق هي المعتمدة؛ تحقق من الصورة. | unread |
| I looked at the label photo and it says this. | نظرت إلى صورة الملصق وهو يقول هذا. | unread |
| Nothing is published until you confirm it, and a confirmation cannot be undone here: a wrong fact is corrected on the item's own page. | لا يُنشر شيء حتى تؤكده، ولا يمكن التراجع عن التأكيد من هنا: تُصحَّح المعلومة الخاطئة في صفحة الصنف. | unread |
| on order | على الطلب | unread |
| given back as | يُعاد عبر | unread |
| A refund above ${usd(limits?.refund_usd ?? 10)} needs a second person. | استرداد فوق ${usd(limits?.refund_usd ?? 10)} يحتاج شخصاً ثانياً. | unread |
| A price change of more than ${limits?.price_change_pct ?? 10}% needs a second person. | تغيير سعر بأكثر من ${limits?.price_change_pct ?? 10}% يحتاج شخصاً ثانياً. | unread |
| Exchange rate | سعر الصرف | unread |
| Any change to the LBP rate needs a second person. | أي تغيير في سعر الليرة يحتاج شخصاً ثانياً. | unread |
| Setting | إعداد | unread |
| A change to this rule needs a second person. | تغيير هذه القاعدة يحتاج شخصاً ثانياً. | unread |
| A transfer more than 5% over the order total needs a second person. | تحويل يزيد عن مجموع الطلب بأكثر من 5% يحتاج شخصاً ثانياً. | unread |
| Two-person rule | قاعدة الشخصين | unread |
| Asked by | طلبها | unread |
| Waiting for someone else: the person who asked can never approve. | بانتظار شخص آخر: من طلبها لا يستطيع الموافقة أبداً. | unread |
| Needs you as the second person. | تحتاجك كشخص ثانٍ. | unread |
| Approve: make the change | وافق: نفّذ التغيير | unread |
| Approving makes the change as it was asked, in the asker's name. Money and settings are not undone from here. | الموافقة تنفّذ التغيير كما طُلب، باسم من طلبه. لا يُتراجع عن المال والإعدادات من هنا. | unread |
| Why (optional) | السبب (اختياري) | unread |
| Withdraw my request | اسحب طلبي | unread |
| Names | الأسماء | unread |
| Second approvals | الموافقات الثانية | unread |
| This list is not available yet: the database is missing a part of it. | هذه القائمة غير متاحة بعد: قاعدة البيانات ينقصها جزء منها. | unread |
| Nothing waits here. | لا شيء ينتظر هنا. | unread |
| One card at a time. Nothing is decided by moving between cards, and nothing is decided by a swipe. | بطاقة واحدة في كل مرة. لا يُقرَّر شيء بالتنقل بين البطاقات، ولا بالسحب. | unread |
|  Keys: a approves, r rejects (it asks for a reason), the arrow or space skips. |  المفاتيح: a للموافقة، r للرفض (يطلب سبباً)، السهم أو المسافة للتخطي. | unread |
| Approval pages as lists | صفحات الموافقات كقوائم | unread |
| Progress | التقدّم | unread |
| Readiness | الجاهزية | unread |
| Intake | الإدخال | unread |
| Photographed | صُوّر | unread |
| ${progress.left} left | بقي ${progress.left} | unread |
| front and back of every pack | واجهة كل عبوة وخلفها | unread |
| to decide | للبتّ | unread |
| label readings, allergens first | قراءات الملصقات، المسبّبات أولاً | unread |
| Sellable | قابل للبيع | unread |
| the core is complete | الأساسيات مكتملة | unread |
| Label-ready | جاهز بملصقه | unread |
| of the packaged items | من المنتجات المعبّأة | unread |
| to do | للعمل | unread |
| Selling requires a label | لا بيع قبل الملصق | unread |
| On | مفعّل | unread |
| Off | معطّل | unread |
| Shown here and never changed from here. It is the setting | يُعرض هنا ولا يتغيّر من هنا. إنه الإعداد | unread |
| When it is on, a packaged item whose label has not been read and approved by a person cannot be quoted, added to a card or shown as orderable: the chat and the site say “coming soon”. Loose produce, meat and bakery with no real barcode are not packaged and sell on the core. | عند تفعيله لا يمكن تسعير منتج معبّأ لم يُقرأ ملصقه ويعتمده شخص، ولا إضافته إلى بطاقة ولا عرضه قابلاً للطلب: تقول المحادثة والموقع «جايي قريباً». الخضار والفواكه واللحوم والمخبوزات السائبة بلا باركود حقيقي ليست معبّأة وتُباع على الأساسيات. | unread |
| The steps to turn it on | خطوات التفعيل | unread |
| Photograph every pack | صوّر كل عبوة | unread |
| Front and back of each item, on the Photograph tab (the label day). | واجهة كل منتج وخلفه، في تبويب التصوير (يوم الملصقات). | unread |
| Run the label reading | شغّل قراءة الملصقات | unread |
| Once the photos are in: GitHub, Actions, label-read, Run workflow (the Founder actions in the handoff say exactly where). | بعد وصول الصور: GitHub ثم Actions ثم label-read ثم Run workflow (يوضّح قسم إجراءات المؤسس في وثيقة التسليم المكان بالضبط). | unread |
| Approve the readings | اعتمد القراءات | unread |
| Label approvals: allergens first, then halal and certificates, warnings, disagreements, the rest. Each against the photo. | موافقات الملصقات: المسبّبات أولاً ثم الحلال والشهادات والتحذيرات والاختلافات وبقية القراءات. كل واحدة مقابل الصورة. | unread |
| Nothing in stock is left unlabelled | لا شيء في المخزون بلا ملصق | unread |
| ${notReadyInStock} packaged item(s) in stock are not label-ready. The Readiness tab lists them under “packaged, not label-ready”. | ${notReadyInStock} منتج معبّأ في المخزون ليس جاهزاً بملصقه. تعرضها تبويب الجاهزية تحت «معبّأ، ملصقه غير جاهز». | unread |
| The Readiness tab lists what is left. | يعرض تبويب الجاهزية ما تبقّى. | unread |
| Switch it on in Settings | فعّله من الإعدادات | unread |
| The admin turns it on under Settings, Switches; it needs a second person to approve (the ops lead or another admin). It can be switched off at once. | يفعّله المدير من الإعدادات ثم المفاتيح؛ ويحتاج موافقة شخص ثانٍ (مسؤول العمليات أو مدير آخر). ويمكن إيقافه فوراً. | unread |
| Open Settings | افتح الإعدادات | unread |
| Scan a pack | امسح عبوة | unread |
| Barcode or SKU | الباركود أو الرمز | unread |
|  and read the label |  واقرأ الملصق | unread |
| The label is read by a model to save typing. What it reads is only a proposal: a person checks every field against the pack. | يقرأ نموذج الملصق لتوفير الكتابة. ما يقرأه مجرد اقتراح: يتحقق شخص من كل حقل مقابل العبوة. | unread |
| No label reader is set up on this console (no model key): the photos are saved, and the fields are typed from the pack on the item's page. | لا قارئ ملصقات مهيّأ في هذه اللوحة (لا مفتاح نموذج): تُحفظ الصور وتُكتب الحقول من العبوة في صفحة الصنف. | unread |
| Waiting to be checked against the pack (${waiting.length} items) | بانتظار التحقق مقابل العبوة (${waiting.length} منتج) | unread |
| Items with fields to check | منتجات فيها حقول للتحقق | unread |
| Nothing waits. | لا شيء ينتظر. | unread |
| Barcode | الباركود | unread |
| Fields | الحقول | unread |
| Label reading | قراءة الملصق | unread |
| Staff | الموظفون | unread |
| all items | كل المنتجات | unread |
| not sellable | غير قابل للبيع | unread |
| sellable, facts not confirmed | قابل للبيع، حقائقه غير مؤكدة | unread |
| fact-complete | حقائقه مكتملة | unread |
| packaged, not label-ready | معبّأ، ملصقه غير جاهز | unread |
| blocks the catalog | يمنع الكتالوج | unread |
| something missing | ينقصه شيء | unread |
| sellable | قابل للبيع | unread |
| for fact-complete: | لتكتمل حقائقه: | unread |
| needs: | يحتاج: | unread |
| loose | سائب | unread |
| packaged, label-ready | معبّأ، ملصقه جاهز | unread |
| label missing: | ينقص الملصق: | unread |
| approved | معتمد | unread |
| waiting | بالانتظار | unread |
| kept as is | كما هو | unread |
| not reviewed | لم يُراجَع | unread |
| approved | معتمدة | unread |
| guide only (licence unknown) | دليل فقط (ترخيص مجهول) | unread |
| Food facts | المعلومات الغذائية | unread |
| all ${r.facts.allergens_of} allergens | كل مسبّبات الحساسية (${r.facts.allergens_of}) | unread |
| ingredients ok | المكوّنات سليمة | unread |
| no ingredients | لا مكوّنات | unread |
| allergens | المسبّبات | unread |
| Cost | التكلفة | unread |
| known | معروفة | unread |
| Search words | كلمات البحث | unread |
| queued | في الطابور | unread |
| failed | فشلت | unread |
| not placed | غير موضوع | unread |
| none | لا يوجد | unread |
| unavailable | غير متاح | unread |
| Packaged items and their labels | المنتجات المعبّأة وملصقاتها | unread |
| Selling requires a label:  | لا بيع قبل الملصق:  | unread |
| on | مفعّل | unread |
| off | معطّل | unread |
| The setting | الإعداد | unread |
| , read only here: the steps are on the Progress tab and the switch is in Settings. When on, a packaged item whose label has not been read and approved by a person cannot be quoted, added to a card, found as orderable or shown as orderable: the chat and the site say “coming soon”. Loose produce, meat and bakery with no real barcode are not packaged and sell on the core. | ، للقراءة فقط هنا: الخطوات في تبويب التقدّم والمفتاح في الإعدادات. عند تفعيله لا يمكن تسعير منتج معبّأ لم يُقرأ ملصقه ويعتمده شخص، ولا إضافته إلى بطاقة ولا عرضه قابلاً للطلب: تقول المحادثة والموقع «جايي قريباً». الخضار والفواكه واللحوم والمخبوزات السائبة بلا باركود حقيقي ليست معبّأة وتُباع على الأساسيات. | unread |
| Readiness per template | الجاهزية لكل قالب | unread |
| Template | القالب | unread |
| Fact-complete | حقائقه مكتملة | unread |
| Packaged | معبّأ | unread |
| Label-ready | ملصقه جاهز | unread |
| The packaged items not label-ready, with what each misses, are under “packaged, not label-ready” below. | المنتجات المعبّأة غير الجاهزة بملصقاتها، وما ينقص كل واحد، تحت «معبّأ، ملصقه غير جاهز» أدناه. | unread |
| Product readiness | جاهزية المنتجات | unread |
| ${counts.not_sellable} not sellable | ${counts.not_sellable} غير قابل للبيع | unread |
| answers a filter such as “no added sugar” | يجيب عن مرشّح مثل «بلا سكر مضاف» | unread |
| ${counts.label} packaged not ready | ${counts.label} معبّأ غير جاهز | unread |
| customers cannot order these | لا يستطيع الزبائن طلبها | unread |
| the core is complete (names in English and Arabic, category with its template, storage, sale unit, price); it can be ordered and its facts read “not confirmed yet”. | الأساسيات مكتملة (الاسم بالإنجليزية والعربية، الفئة مع قالبها، التخزين، وحدة البيع، السعر)؛ يمكن طلبه وتُقرأ حقائقه «غير مؤكدة بعد». | unread |
| its template is complete too (for packaged food: ingredients, the 14 allergens and the nutrition panel; for a cleaning product: hazard warnings as printed); only these answer a filter such as “no added sugar” or “fragrance-free”. Facts need a re-check after 12 months. | قالبه مكتمل أيضاً (للأغذية المعبّأة: المكوّنات ومسبّبات الحساسية الأربعة عشر وجدول القيم الغذائية؛ ولمنتج التنظيف: تحذيرات الخطر كما هي مطبوعة)؛ هذه وحدها تجيب عن مرشّح مثل «بلا سكر مضاف» أو «بلا عطر». تحتاج الحقائق إعادة فحص بعد 12 شهراً. | unread |
| Level | المستوى | unread |
| What blocks | ما يمنع | unread |
| Blocks the catalog | يمنع الكتالوج | unread |
| the WhatsApp catalog leaves the item out (no approved picture a customer may see, not placed in a category, or no price). | يستبعد كتالوج واتساب المنتج (لا صورة معتمدة يجوز للزبون رؤيتها، أو غير موضوع في فئة، أو بلا سعر). | unread |
| a customer cannot order it at all (no price at the hub, or marked unavailable). A missing picture blocks the catalog, not ordering. Names, food facts, cost and search words do not stop a sale; they are listed so nothing is forgotten. Click what is missing to open the page that fixes it. | لا يستطيع الزبون طلبه أبداً (لا سعر في المستودع، أو معلَّم غير متاح). غياب الصورة يمنع الكتالوج لا الطلب. الأسماء والحقائق الغذائية والتكلفة وكلمات البحث لا توقف البيع؛ تُسرد كي لا يُنسى شيء. اضغط على الناقص لتفتح الصفحة التي تصلحه. | unread |
| Find an item | ابحث عن منتج | unread |
| SKU, name or brand | الرمز أو الاسم أو العلامة | unread |
| Nothing here. | لا شيء هنا. | unread |
| The first 200 of ${rows.length} are shown: search to find the rest. | المعروض أول 200 من ${rows.length}: ابحث لتجد البقية. | unread |
| To confirm | للتأكيد | unread |
| Refunds | المبالغ المستردة | unread |
| Money | المال | unread |
| Also: | أيضاً: | unread |
| Day open | فتح اليوم | unread |
| Day close | إغلاق اليوم | unread |
| ${n.approvals} waiting for a second person | ${n.approvals} بانتظار شخص ثانٍ | unread |
| Already ${r.already}; nothing changed. | سبق أن ${r.already}؛ لم يتغيّر شيء. | unread |
| The amount is ${Number(r.over_pct ?? 0).toFixed(1)}% over the order total: it waits for a second person on Approvals. Nothing is booked yet. | المبلغ يزيد ${Number(r.over_pct ?? 0).toFixed(1)}% عن مجموع الطلب: ينتظر شخصاً ثانياً في الموافقات. لم يُسجَّل شيء بعد. | unread |
| This late payment was already booked; nothing changed. | سُجّلت هذه الدفعة المتأخرة من قبل؛ لم يتغيّر شيء. | unread |
| Late payment booked as the customer's credit (${usd(r.amount_usd ?? 0)}). The order stays cancelled; the credit comes off their next order or is paid out on Refunds. | سُجّلت الدفعة المتأخرة رصيداً للزبون (${usd(r.amount_usd ?? 0)}). يبقى الطلب ملغى؛ ويُخصم الرصيد من طلبه التالي أو يُدفع من صفحة المبالغ المستردة. | unread |
| This order was already paid; the screenshot is closed. | هذا الطلب مدفوع من قبل؛ أُغلقت اللقطة. | unread |
| Payment confirmed and booked. ${usd(credit)} over the total is the customer's credit. | تم تأكيد الدفعة وتسجيلها. ${usd(credit)} فوق المجموع رصيد للزبون. | unread |
| Payment confirmed and booked. | تم تأكيد الدفعة وتسجيلها. | unread |
| Payments to confirm | دفعات للتأكيد | unread |
| Check the money in the Whish or OMT account first. Type the amount and the reference you see there, not what the screenshot says. | تحقق من المبلغ في حساب Whish أو OMT أولاً. اكتب المبلغ والمرجع كما تراهما هناك، لا كما في اللقطة. | unread |
| Screenshots | اللقطات | unread |
| None waiting. | لا شيء ينتظر. | unread |
| payment screenshot | لقطة الدفع | unread |
| expected | المتوقع | unread |
| Late payment. | دفعة متأخرة. | unread |
| The payment timer cancelled this order. If the money is in the account, confirm it: it becomes the customer's credit and the order stays cancelled. | ألغى مؤقّت الدفع هذا الطلب. إن كان المال في الحساب فأكّده: يصبح رصيداً للزبون ويبقى الطلب ملغى. | unread |
| Waiting for a second person | بانتظار شخص ثانٍ | unread |
| Approvals | الموافقات | unread |
| the amount is more than 5% over the total. | المبلغ يزيد عن المجموع بأكثر من 5%. | unread |
| This picture was sent before for another payment. | أُرسلت هذه الصورة من قبل لدفعة أخرى. | unread |
| Check the account carefully. | تحقق من الحساب بعناية. | unread |
| Read by the model (a hint, may be wrong): | قرأها النموذج (تلميح قد يكون خاطئاً): | unread |
| Amount received, USD | المبلغ المستلم بالدولار | unread |
| Reference | المرجع | unread |
| Book as the customer's credit | سجّلها رصيداً للزبون | unread |
| Confirm payment | أكّد الدفعة | unread |
| Reject screenshot | ارفض اللقطة | unread |
| Transfers without a screenshot | تحويلات بلا لقطة | unread |
| None. | لا شيء. | unread |
| Method | الطريقة | unread |
| Since | منذ | unread |
| Confirm, once the money is in the account | أكّد بعد وصول المال إلى الحساب | unread |
| amount USD | المبلغ بالدولار | unread |
| reference | المرجع | unread |
| Screenshot rejected. The customer still owes the transfer. | رُفضت اللقطة. ما زال الزبون مديناً بالتحويل. | unread |
| Already paid; nothing changed. | مدفوع من قبل؛ لم يتغيّر شيء. | unread |
| The drawer, by the books | الصندوق بحسب الدفاتر | unread |
| The bank | البنك | unread |
| transfers to check | تحويلات للتحقق | unread |
| to count with a rider | للعدّ مع مندوب | unread |
| Drawer by the books:  | الصندوق بحسب الدفاتر:  | unread |
| bank: | البنك: | unread |
| Count the drawer at day close; what is in it must match the books. Everything that leaves it is recorded here. | اعدّ الصندوق عند إغلاق اليوم؛ ما فيه يجب أن يطابق الدفاتر. كل ما يخرج منه يُسجَّل هنا. | unread |
| Today's takings by method | مقبوضات اليوم حسب الطريقة | unread |
| Today (${v.movements.length}) | اليوم (${v.movements.length}) | unread |
| Nothing yet today. | لا شيء بعد اليوم. | unread |
| The day's cash movements | حركات النقد اليوم | unread |
| By | بواسطة | unread |
| Proof | الإثبات | unread |
| bank | البنك | unread |
| drawer | الصندوق | unread |
| Cash out of the drawer | نقد يخرج من الصندوق | unread |
| Cash to the bank | نقد إلى البنك | unread |
| Slip number | رقم الإيصال | unread |
| Slip photo | صورة الإيصال | unread |
| Record deposit | سجّل الإيداع | unread |
| Petty cash | النثرية | unread |
| For what | لأي غرض | unread |
| Who spent it or was paid | من أنفقها أو دُفعت له | unread |
| Receipt photo | صورة الإيصال | unread |
| Expense | مصروف | unread |
| Paid from | دُفع من | unread |
| the drawer | الصندوق | unread |
| the bank | البنك | unread |
| Category | الفئة | unread |
| Paid to | دُفع إلى | unread |
| Invoice or receipt number | رقم الفاتورة أو الإيصال | unread |
| Record expense | سجّل المصروف | unread |
| No order ${code}. | لا يوجد طلب ${code}. | unread |
| small-order fee | رسم الطلب الصغير | unread |
| nothing yet | لا شيء بعد | unread |
| placed | وقت الطلب | unread |
| Items | البنود | unread |
| Item | الصنف | unread |
| Line | السطر | unread |
| Refunded on this order: | المُسترد على هذا الطلب: | unread |
| the customer's credit: | رصيد الزبون: | unread |
| owed | مستحق | unread |
| free to use | حرّ للاستعمال | unread |
| Only money that was paid can be refunded. An unpaid order is corrected, not refunded. | يُستردّ المال المدفوع فقط. الطلب غير المدفوع يُصحَّح ولا يُسترد. | unread |
| A refund above the limit waits for a second person. | الاسترداد فوق الحد ينتظر شخصاً ثانياً. | unread |
| Amount USD | المبلغ بالدولار | unread |
| Charged to | يُحمَّل على | unread |
| (whole order) | (الطلب كله) | unread |
| Give it back as | يُعاد عبر | unread |
| Transfer reference (Whish, OMT) | مرجع التحويل (Whish، OMT) | unread |
| Use credit on this order | استعمل الرصيد على هذا الطلب | unread |
| Take ${usd(Math.min(Number(view.available_usd), Number(order.total_usd)))} off this order | اخصم ${usd(Math.min(Number(view.available_usd), Number(order.total_usd)))} من هذا الطلب | unread |
| Refunds and credit | المبالغ المستردة والرصيد | unread |
| Customers we owe (${owed.length}) | زبائن لهم عندنا (${owed.length}) | unread |
| Nobody. | لا أحد. | unread |
| Owed | المستحق | unread |
| Free to use | الحرّ للاستعمال | unread |
| Last refunds | آخر المبالغ المستردة | unread |
| Pay out | ادفع | unread |
| taken off an open order | خُصم من طلب مفتوح | unread |
| Cash drops and rider payouts | تسليم النقد ودفعات المناديب | unread |
| Count the cash with the rider, note by note, per currency. Confirm only what you counted. The counted figure is recorded; the expected one is never edited. | اعدّ النقد مع المندوب ورقة ورقة لكل عملة. أكّد ما عددته فقط. يُسجَّل المبلغ المعدود ولا يُعدَّل المتوقع أبداً. | unread |
| Cash drops to confirm (${declared.length}) | تسليمات نقد للتأكيد (${declared.length}) | unread |
| No rider on shift or holding money. | لا مندوب في الوردية ولا يحمل مالاً. | unread |
| on shift since | في الوردية منذ | unread |
| shift ended | انتهت الوردية | unread |
| Cash held | النقد معه | unread |
| Earnings owed (fees and tips) | الأرباح المستحقة (الرسوم والإكراميات) | unread |
| To hand over | يسلّم للمحل | unread |
| Cash over/short today | فائض أو عجز النقد اليوم | unread |
| Declared | المُصرَّح به | unread |
| receipt | الإيصال | unread |
| Counted: confirm | عددتُه: أكّد | unread |
| Pay earnings | ادفع الأرباح | unread |
| Send statement on WhatsApp | أرسل الكشف عبر واتساب | unread |
| Pay earnings: the rider keeps their fees and tips out of the cash they carry (dollars first, then lira); anything more is paid from the hub till, never more than it holds. The database works it out. | دفع الأرباح: يحتفظ المندوب برسومه وإكرامياته من النقد الذي يحمله (الدولار أولاً ثم الليرة)؛ وأي زيادة تُدفع من صندوق المستودع ولا تتجاوز ما فيه. تحسبها قاعدة البيانات. | unread |
| Over/short: a few cents of lira rounding at the door is the company's; a shortfall beyond it (up to a dollar) is owed by the rider and flagged. More than a dollar is refused at the door. | الفائض والعجز: بضعة سنتات تقريب بالليرة عند الباب على الشركة؛ وما زاد عنها (حتى دولار) يدين به المندوب ويُعلَّم. وأكثر من دولار يُرفض عند الباب. | unread |
| Damaged notes | الأوراق التالفة | unread |
| A note in a confirmed drop that cannot be used. It leaves the drawer once: the first this month is the company's, later ones are the rider's. | ورقة في تسليم مؤكّد لا يمكن استعمالها. تخرج من الصندوق مرة واحدة: أول واحدة هذا الشهر على الشركة والتالية على المندوب. | unread |
| No confirmed drop at the hub yet. | لا تسليم مؤكّد في المستودع بعد. | unread |
| damaged so far | التالف حتى الآن | unread |
| Record damaged note | سجّل ورقة تالفة | unread |
| under the caps | تحت السقفين | unread |
| a job in hand | في مهمة | unread |
| ${usd(exposure)} of the ${usd(hard)} hard cap | ${usd(exposure)} من السقف الصارم ${usd(hard)} | unread |
|  · soft ${usd(soft)}, hard ${usd(hard)} (set in Settings) |  · مرن ${usd(soft)}، صارم ${usd(hard)} (من الإعدادات) | unread |
| Written terms | الشروط المكتوبة | unread |
| on file | محفوظة | unread |
| signed | وُقّعت | unread |
| open the document | افتح المستند | unread |
| Recorded by | سجّلها | unread |
| not on file | غير محفوظة | unread |
| A rider carries cash and fees only with their written terms on file. | لا يحمل المندوب نقداً ورسوماً إلا بعد حفظ شروطه المكتوبة. | unread |
| Record newer terms | سجّل شروطاً أحدث | unread |
| Record the written terms | سجّل الشروط المكتوبة | unread |
| Document and version | المستند والإصدار | unread |
| Signed on | تاريخ التوقيع | unread |
| Scan or photo (optional) | مسح أو صورة (اختياري) | unread |
| End shift | أنهِ الوردية | unread |
| Start shift | ابدأ الوردية | unread |
| Cash drops and payouts | تسليم النقد والدفعات | unread |
| Who rides, who is on shift, the cash each holds against the caps, and whether their written terms are on file. Riders are never rated or scored here: this page measures the service, not people. | من يوصّل، ومن في الوردية، والنقد الذي يحمله كل واحد مقابل السقفين، وهل شروطه المكتوبة محفوظة. لا تقييم ولا درجات للمناديب هنا: تقيس هذه الصفحة الخدمة لا الأشخاص. | unread |
| On shift (${on.length}) | في الوردية (${on.length}) | unread |
| Off shift (${off.length}) | خارج الوردية (${off.length}) | unread |
| Dispatching, jobs and incidents are on the  | التوزيع والمهام والحوادث في صفحة  | unread |
| Their shift was already open. | ورديته مفتوحة بالفعل. | unread |
| Their shift is open. They can be offered jobs. | فُتحت ورديته. يمكن عرض مهام عليه. | unread |
| Name the document and its version. | سمِّ المستند وإصداره. | unread |
| Choose the day it was signed. | اختر يوم التوقيع. | unread |
| Newer terms recorded; the earlier ones stay as history. | سُجّلت شروط أحدث؛ وتبقى السابقة في السجل. | unread |
| The written terms are on file. | حُفظت الشروط المكتوبة. | unread |
| Drop confirmed. The rider still holds ${usd(left)} in value. | تم تأكيد التسليم. ما زال المندوب يحمل ما قيمته ${usd(left)}. | unread |
| not set | غير مضبوط | unread |
| Not available yet: the database has no console_settings() (migration 0231 is not applied there yet). | غير متاح بعد: لا توجد console_settings() في قاعدة البيانات (لم تُطبَّق الهجرة 0231 هناك بعد). | unread |
| New value | القيمة الجديدة | unread |
| Turn on | فعّل | unread |
| Turn off | عطّل | unread |
| : a second person approves | : يوافق شخص ثانٍ | unread |
| Ask for a second person to approve | اطلب موافقة شخص ثانٍ | unread |
| two-person | شخصان | unread |
| Last changed by ${i.changed_by_name ?? "staff"}, ${when(i.changed_at)} | آخر تغيير: ${i.changed_by_name ?? "موظف"}، ${when(i.changed_at)} | unread |
| Not changed from this page yet. | لم يُغيَّر من هذه الصفحة بعد. | unread |
| Waiting for a second person: | بانتظار شخص ثانٍ: | unread |
| asked by | طلبها | unread |
| Open it on the Approve page | افتحها في صفحة الموافقات | unread |
| Why (logged with your name) | السبب (يُسجَّل باسمك) | unread |
| This change waits for another ops lead or admin; the person who asked can never approve it. | ينتظر هذا التغيير مسؤول عمليات أو مدير آخر؛ ومن طلبه لا يستطيع الموافقة عليه أبداً. | unread |
| People and roles | الأشخاص والأدوار | unread |
| add, change a role, block | إضافة وتغيير دور وحظر | unread |
| Zones, villages and delivery fees | المناطق والقرى ورسوم التوصيل | unread |
| which villages are served, each zone's fee and time | أي قرى تُخدم، ورسم كل منطقة ووقتها | unread |
| Delivery windows and the calendar | نوافذ التوصيل والتقويم | unread |
| capacity, cut-offs, Ramadan and holidays | السعة وآخر المواعيد ورمضان والعطل | unread |
| Message templates | قوالب الرسائل | unread |
| their status and what is sent meanwhile | حالتها وما يُرسل في الأثناء | unread |
| Alerts on this phone, language, appearance | التنبيهات على هذا الهاتف واللغة والمظهر | unread |
| switch push alerts on for this phone | فعّل تنبيهات الدفع على هذا الهاتف | unread |
| Admin only. Each change is logged with who and when. A rule that needs two people waits on the Approve page until another ops lead or admin approves it. The database checks every value again. | للمدير فقط. يُسجَّل كل تغيير بالاسم والوقت. القاعدة التي تحتاج شخصين تنتظر في صفحة الموافقات حتى يوافق مسؤول عمليات أو مدير آخر. وتفحص قاعدة البيانات كل قيمة من جديد. | unread |
| Change log | سجل التغييرات | unread |
| Changes made on this page | التغييرات التي جرت في هذه الصفحة | unread |
| No change made from this page yet. | لم يُجرَ أي تغيير من هذه الصفحة بعد. | unread |
| Setting | الإعداد | unread |
| That is not a setting this page changes. | هذا ليس إعداداً تغيّره هذه الصفحة. | unread |
| Write why: the reason is logged with your name. | اكتب السبب: يُسجَّل باسمك. | unread |
| Choose on or off. | اختر التفعيل أو التعطيل. | unread |
| Type a number. | اكتب رقماً. | unread |
| ${name} is already waiting for a second person. | ${name} بانتظار شخص ثانٍ بالفعل. | unread |
| Waiting for a second person: ${name} changes when another ops lead or admin approves it on the Approve page. | بانتظار شخص ثانٍ: يتغيّر «${name}» حين يوافق مسؤول عمليات أو مدير آخر في صفحة الموافقات. | unread |
| Nothing changed: ${name} already is ${show(L, it, value)}. | لم يتغيّر شيء: «${name}» هو ${show(L, it, value)} بالفعل. | unread |
| Saved: ${name} is now ${show(L, it, value)}. | تم الحفظ: «${name}» الآن ${show(L, it, value)}. | unread |
| Hours and minimum order | ساعات العمل والحد الأدنى للطلب | unread |
| When the shop takes orders, and the smallest order it takes. | متى يستقبل المتجر الطلبات، وأصغر طلب يقبله. | unread |
| Fees | الرسوم | unread |
| The small-order fee is company income. The delivery fee and tips belong to whoever delivers; delivery fees are set per zone on the Zones page. | رسم الطلب الصغير دخل للشركة. أما رسم التوصيل والإكراميات فهي لمن يوصّل؛ ورسوم التوصيل تُضبط لكل منطقة في صفحة المناطق. | unread |
| Timers | المؤقتات | unread |
| How long an order card, a payment or a draft waits before the system acts. | كم تنتظر بطاقة الطلب أو الدفع أو المسودة قبل أن يتصرف النظام. | unread |
| Cash caps | سقوف النقد | unread |
| What a rider may carry. The database refuses a new cash order past the hard cap. A change needs a second person. | ما يحق للمندوب حمله. ترفض قاعدة البيانات طلب نقد جديداً بعد السقف الصلب. التغيير يحتاج شخصاً ثانياً. | unread |
| Pickup place | مكان الاستلام | unread |
| Where a customer collects an order, when pickup is on. | أين يستلم الزبون طلبه حين يكون الاستلام مفعّلاً. | unread |
| Escalation steps | خطوات التصعيد | unread |
| Minutes a customer waits for a person before each step (the Inbox shows them). | الدقائق التي ينتظرها الزبون شخصاً قبل كل خطوة (يعرضها الوارد). | unread |
| Two-person limits | حدود الشخصين | unread |
| Above these a second person must approve. Changing a limit also needs a second person. | فوق هذه الحدود يجب أن يوافق شخص ثانٍ. وتغيير الحد نفسه يحتاج شخصاً ثانياً. | unread |
| Switches | المفاتيح | unread |
| Rules that are on or off. | قواعد مفعّلة أو معطّلة. | unread |
| Beirut time. | بتوقيت بيروت. | unread |
| Closes | يغلق | unread |
| Small-order fee applies below | رسم الطلب الصغير ينطبق تحت | unread |
| USD of goods; 0 is off | دولار من المشتريات؛ 0 يعني معطّل | unread |
| Small-order fee | رسم الطلب الصغير | unread |
| A transfer waits for payment | التحويل ينتظر الدفع | unread |
| An order card waits for the customer's tap | بطاقة الطلب تنتظر ضغطة الزبون | unread |
| One reminder for an unconfirmed card after | تذكير واحد بالبطاقة غير المؤكدة بعد | unread |
| A draft is dropped after | تُترك المسودة بعد | unread |
| Soft cap: warn above | السقف المرن: تحذير فوق | unread |
| USD a rider holds | دولار مع المندوب | unread |
| Hard cap: no new cash order above | السقف الصلب: لا طلب نقد جديد فوق | unread |
| Stays off until the pickup place below is set. | يبقى معطّلاً حتى يُضبط مكان الاستلام أدناه. | unread |
| Pickup place (English) | مكان الاستلام (بالإنجليزية) | unread |
| Pickup place (Arabic) | مكان الاستلام (بالعربية) | unread |
| Step 1: the ops lead is alerted after | الخطوة 1: يُنبَّه مسؤول العمليات بعد | unread |
| Step 2: the founder is alerted after | الخطوة 2: يُنبَّه المؤسس بعد | unread |
| Step 3: the case is marked late after | الخطوة 3: تُعلَّم الحالة متأخرة بعد | unread |
| A refund above this needs a second person | استرداد فوق هذا يحتاج شخصاً ثانياً | unread |
| A price change above this needs a second person | تغيير سعر فوق هذا يحتاج شخصاً ثانياً | unread |
| percent | بالمئة | unread |
| Any change to the LBP rate needs a second person | أي تغيير في سعر الليرة يحتاج شخصاً ثانياً | unread |
| Switching this off needs a second person. | إيقافه يحتاج شخصاً ثانياً. | unread |
| A packaged item is sold only after its label is read and approved | لا يُباع المنتج المعبّأ إلا بعد قراءة ملصقه واعتماده | unread |
| On: every packaged item without an approved label reading reads “coming soon”. Turning it on needs a second person; turning it off is immediate. Read the steps on the Intake page first. | مفعّل: كل منتج معبّأ بلا قراءة ملصق معتمدة يظهر «جايي قريباً». التفعيل يحتاج شخصاً ثانياً؛ والإيقاف فوري. اقرأ الخطوات في صفحة الإدخال أولاً. | unread |
| Search by meaning (embeddings) | البحث بالمعنى (المتجهات) | unread |
| On only once the model's vectors are in the database and the search evaluation shows it beats words alone. | يُفعَّل فقط بعد أن تصبح متجهات النموذج في قاعدة البيانات وبعد أن يُظهر تقييم البحث أنه يتفوق على الكلمات وحدها. | unread |
| Decide one card at a time | قرّر بطاقة بطاقة | unread |
| Price / Refund / Payment / Exchange rate / Setting (the kind of a second approval) | سعر / استرداد / دفعة / سعر الصرف / إعداد | unread |
