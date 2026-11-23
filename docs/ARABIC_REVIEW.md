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
`packages/agents/src/customer-pack.ts` and `docs/log/cx1.md`. Model-written; read by the founder on 16 November ("RA 16 Nov"), who changed the privacy line: the new wording is kept per customer from now on in `customer_welcomes`, and earlier rows keep the words they were shown. The privacy line
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
(and the changed `cx.pickupReady` above). When each is sent: `docs/log/cfg1.md`. Written by a model; read by the coordinator on 17 November 2026 ("RA 17 Nov"), who changed `notice.confirmReminder` (since AR1 «الورقة» means the banknote) and `card.reopenedFrom`. The coordinator wrote `card.reopenedFrom` with a leading 🔁; the line is stored without it, as in `en.ts` and `fr.ts`, because the message rules allow only a fixed set of emoji (rule 4, `messages.rules.test.ts`) and 🔁 is not in it.
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
Said by code, never by the model, only while the setting `sell_requires_label` is on and only for a packaged item whose label has not been read and approved by a person; `docs/log/sell1.md`.
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

## WEB4a, the website's frame and home page in the reference's design (18 November 2026)

Written by a model (session WEB4a); **not yet read by an Arabic reader**. The website's words for the reference's header, village picker, footer, phone bottom bar
and home page: the `w4_` keys of `apps/web/src/lib/i18n-web4a.ts`, merged into the site's dictionary (`test/ci/web4a-words.test.ts` checks this table lists every
one, word for word). The site's register (formal Arabic); the WhatsApp messages a link types for the visitor (`w4_msg_*`) are Lebanese, as the chat is.
Neutral wording only: no rating, praise, health, diet or "popular" word (invariants 14 and 15). `{n}`, `{total}`, `{gap}`, `{min}`, `{village}`, `{time}`, `{items}`,
`{hours}` and `{name}` are filled by code from the database.

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `web.w4_nav` | الأقسام | Sections | Rubriques | not yet |
| `web.w4_nav_main` | التنقل | Main | Navigation | not yet |
| `web.w4_home` | الرئيسية | Home | Accueil | not yet |
| `web.w4_food` | الطعام | Food | Restauration | not yet |
| `web.w4_groceries` | البقالة | Groceries | Épicerie | not yet |
| `web.w4_search` | بحث | Search | Rechercher | not yet |
| `web.w4_you` | حسابي | You | Vous | not yet |
| `web.w4_account_label` | طلباتك وحسابك | Your orders and account | Vos commandes et votre compte | not yet |
| `web.w4_basket` | السلة | Basket | Panier | not yet |
| `web.w4_basket_label` | السلة، {n} منتج، {total} | Basket, {n} items, {total} | Panier, {n} articles, {total} | not yet |
| `web.w4_view_basket` | عرض السلة | View basket | Voir le panier | not yet |
| `web.w4_min_more` | أضف {gap} لتبلغ الحد الأدنى {min} | Add {gap} more to reach the {min} minimum | Ajoutez {gap} pour atteindre le minimum de {min} | not yet |
| `web.w4_delivering_to` | التوصيل إلى | Delivering to | Livraison à | not yet |
| `web.w4_choose_village` | اختر قريتك | Choose your village | Choisissez votre village | not yet |
| `web.w4_change_village` | التوصيل إلى {village}. تغيير | Deliver to {village}. Change | Livraison à {village}. Changer | not yet |
| `web.w4_eta` | حوالي {n} دقيقة | about {n} min | environ {n} min | not yet |
| `web.w4_closed_opens` | مغلق، نفتح الساعة {time} | Closed, opens {time} | Fermé, ouvre à {time} | not yet |
| `web.w4_picker_title` | التوصيل إلى | Deliver to | Livraison à | not yet |
| `web.w4_use_location` | استخدم موقعي | Use my location | Utiliser ma position | not yet |
| `web.w4_use_location_note` | يحدّد قريتك والوقت ورسم التوصيل. نحفظ القرية فقط، لا موقعك. | Sets your village, the time and the fee. Only the village is kept, not your position. | Fixe votre village, le délai et les frais. Seul le village est gardé, pas votre position. | not yet |
| `web.w4_picker_search` | ابحث عن قريتك | Search your village | Cherchez votre village | not yet |
| `web.w4_picker_none` | لا نوصّل إلى هذه القرية بعد. أخبرنا أين أنت: نفتح القرى التي يطلبها الناس. | We don't reach this village yet. Tell us where you are: we open villages where people ask. | Nous ne livrons pas encore ce village. Dites-nous où vous êtes : nous ouvrons les villages qui le demandent. | not yet |
| `web.w4_ask_wa` | اسألنا عبر واتساب | Ask on WhatsApp | Demander sur WhatsApp | not yet |
| `web.w4_picker_pin` | الموقع الذي ترسله عند إتمام الطلب يحدّد رسم التوصيل بدقة. | The pin you send at checkout sets the exact fee. | La position envoyée au moment de commander fixe les frais exacts. | not yet |
| `web.w4_picker_close` | إغلاق | Close | Fermer | not yet |
| `web.w4_unsure` | أيّ هذه القرى قريتك؟ | Which of these is your village? | Lequel de ces villages est le vôtre ? | not yet |
| `web.w4_outside` | لا نوصّل إلى هناك بعد | We don't deliver there yet | Nous ne livrons pas encore là | not yet |
| `web.w4_outside_text` | نفتح القرى التي يطلبها الناس. أخبرنا أين أنت عبر واتساب. | We open villages where people ask. Tell us where you are on WhatsApp. | Nous ouvrons les villages qui le demandent. Dites-nous où vous êtes sur WhatsApp. | not yet |
| `web.w4_locating` | نبحث عن قريتك… | Finding your village… | Recherche de votre village… | not yet |
| `web.w4_locate_failed` | تعذّرت قراءة موقعك. اختر قريتك من القائمة. | We could not read your location. Choose your village from the list. | Nous n'avons pas pu lire votre position. Choisissez votre village dans la liste. | not yet |
| `web.w4_village_set` | سنعرض الوقت ورسم التوصيل إلى {village}. | We will show the time and fee for {village}. | Nous afficherons le délai et les frais pour {village}. | not yet |
| `web.w4_hero_a` | الشوف، | The Chouf, | Le Chouf, | not yet |
| `web.w4_hero_b` | إلى بابك | delivered | livré | not yet |
| `web.w4_hero_c` | . | . | . | not yet |
| `web.w4_hero_text` | بقالة من متجرنا، يوصلها سائقونا. اطلب هنا أو عبر واتساب، وادفع نقدًا عند الباب. | Groceries from our own store, brought by our riders. Order here or on WhatsApp, and pay cash at the door. | Les courses de notre propre magasin, apportées par nos livreurs. Commandez ici ou sur WhatsApp, et payez en espèces à la porte. | not yet |
| `web.w4_search_placeholder` | لبنة، خبز، قهوة… | Labneh, bread, coffee… | Labneh, pain, café… | not yet |
| `web.w4_search_label` | ابحث في البقالة | Search groceries | Rechercher dans l'épicerie | not yet |
| `web.w4_doors` | ماذا تريد؟ | What would you like? | Que voulez-vous ? | not yet |
| `web.w4_door_groceries` | تسوّق البقالة | Shop groceries | Faire les courses | not yet |
| `web.w4_door_groceries_sub` | {n} منتج من متجرنا | {n} items from our own store | {n} articles de notre propre magasin | not yet |
| `web.w4_door_food` | أماكن الطعام | Food places | Restaurants | not yet |
| `web.w4_door_food_sub` | قريبة منك، ليست على ألو كينغ بعد | Near you, not on Alo King yet | Près de chez vous, pas encore sur Alo King | not yet |
| `web.w4_or_whatsapp` | أو اطلب عبر واتساب | Or order on WhatsApp | Ou commandez sur WhatsApp | not yet |
| `web.w4_type_it` | اكتبها | Type it | Écrivez-la | not yet |
| `web.w4_voice_note` | رسالة صوتية | Voice note | Note vocale | not yet |
| `web.w4_msg_type_v` | مرحبا ألو كينغ، بدي اطلب. ضيعتي: {village}. | Hi Alo King, I'd like to order. My village: {village}. | Bonjour Alo King, je voudrais commander. Mon village : {village}. | not yet |
| `web.w4_msg_voice` | مرحبا ألو كينغ، رح ابعت طلبي برسالة صوتية. | Hi Alo King, I'll send my list as a voice note. | Bonjour Alo King, j'envoie ma liste en note vocale. | not yet |
| `web.w4_msg_voice_v` | مرحبا ألو كينغ، رح ابعت طلبي برسالة صوتية. ضيعتي: {village}. | Hi Alo King, I'll send my list as a voice note. My village: {village}. | Bonjour Alo King, j'envoie ma liste en note vocale. Mon village : {village}. | not yet |
| `web.w4_opens_whatsapp` | (يفتح واتساب) | (opens WhatsApp) | (ouvre WhatsApp) | not yet |
| `web.w4_mock_label` | مثال على محادثة واتساب مع ألو كينغ | An example WhatsApp conversation with Alo King | Un exemple de conversation WhatsApp avec Alo King | not yet |
| `web.w4_mock_sub` | حساب تجاري | Business account | Compte professionnel | not yet |
| `web.w4_mock_got` | وصلنا: {items}. بدك شي تاني؟ | Got it: {items}. Anything else? | C'est noté : {items}. Autre chose ? | not yet |
| `web.w4_mock_basket` | سلتك | Your basket | Votre panier | not yet |
| `web.w4_mock_items` | {n} منتج | {n} items | {n} articles | not yet |
| `web.w4_mock_fee` | التوصيل (كله للسائق) | Delivery (all to the rider) | Livraison (tout pour le livreur) | not yet |
| `web.w4_mock_total` | المجموع | Total | Total | not yet |
| `web.w4_mock_cash` | الدفع نقدًا عند الباب؟ | Pay cash at the door? | Paiement en espèces à la porte ? | not yet |
| `web.w4_mock_confirm` | تأكيد | Confirm | Confirmer | not yet |
| `web.w4_mock_change` | تعديل | Change something | Modifier | not yet |
| `web.w4_mock_to` | إلى {village} | to {village} | vers {village} | not yet |
| `web.w4_browse` | تصفّح الأقسام | Browse the aisles | Parcourir les rayons | not yet |
| `web.w4_fresh` | طازج كل يوم | Fresh every day | Frais chaque jour | not yet |
| `web.w4_pantry` | المؤونة والمشروبات والبيت | Pantry, drinks and home | Épicerie, boissons et maison | not yet |
| `web.w4_see_all` | عرض الكل | See all | Tout voir | not yet |
| `web.w4_all_aisles` | كل الأقسام | All aisles | Tous les rayons | not yet |
| `web.w4_most_ordered` | الأكثر طلبًا في آخر 30 يومًا | Most ordered in the last 30 days | Les plus commandés sur 30 jours | not yet |
| `web.w4_most_ordered_sub` | بعدد الطلبات، لا بتقييم منّا | Counted from orders, not ranked by us | Comptés d'après les commandes, sans classement de notre part | not yet |
| `web.w4_rail_sub` | بترتيب القسم | In the aisle's order | Dans l'ordre du rayon | not yet |
| `web.w4_add` | أضف {name} إلى السلة | Add {name} to the basket | Ajouter {name} au panier | not yet |
| `web.w4_wa_kicker` | الطلب عبر واتساب | WhatsApp ordering | Commander sur WhatsApp | not yet |
| `web.w4_wa_title` | بلا تطبيق. راسلنا فقط. | No app needed. Just message us. | Pas d'application. Écrivez-nous. | not yet |
| `web.w4_wa_text` | نردّ عليك بسلتك ومجموعها. تؤكّد أنت، ونوصّل نحن. وتصلك أخبار الطلب في المحادثة نفسها. | We reply with your basket and total. You confirm, we deliver. Updates come to the same chat. | Nous répondons avec votre panier et le total. Vous confirmez, nous livrons. Le suivi arrive dans la même conversation. | not yet |
| `web.w4_way_type_b` | «2 لبنة، خبز، 1 كيلو بندورة». بأي لغة وبأي كتابة. | "2 labneh, bread, 1 kg tomatoes". Any language, any spelling. | « 2 labneh, du pain, 1 kg de tomates ». Toute langue, toute orthographe. | not yet |
| `web.w4_way_voice` | قلها | Say it | Dites-la | not yet |
| `web.w4_way_voice_b` | أرسل رسالة صوتية. نكتبها لك وأنت تؤكّد. | Send a voice note. We write it up and you confirm. | Envoyez une note vocale. Nous l'écrivons et vous confirmez. | not yet |
| `web.w4_no_promos` | لا نرسل إعلانات أبدًا. اكتب STOP في أي وقت فنتوقف عن مراسلتك. | We never send promotions. Write STOP any time and we stop messaging you. | Nous n'envoyons jamais de promotions. Écrivez STOP à tout moment et nous arrêtons de vous écrire. | not yet |
| `web.w4_ask_title` | اسأل ألو كينغ | Ask Alo King | Demandez à Alo King | not yet |
| `web.w4_ask_text` | اكتب قائمة أو سؤالًا. يصلك الجواب عبر واتساب. لا يُطلب شيء قبل أن تؤكّد. | Type a list or a question. The answer comes on WhatsApp. Nothing is ordered until you confirm. | Écrivez une liste ou une question. La réponse arrive sur WhatsApp. Rien n'est commandé avant votre confirmation. | not yet |
| `web.w4_ask_try` | جرّب | Try | Essayez | not yet |
| `web.w4_ask_p1` | 2 لبنة، خبز و1 كيلو بندورة | 2 labneh, bread and 1 kg tomatoes | 2 labneh, du pain et 1 kg de tomates | not yet |
| `web.w4_ask_p2` | فطور لأربعة | Breakfast for 4 | Petit-déjeuner pour 4 | not yet |
| `web.w4_ask_p3` | ما المتوفر اليوم؟ | What is in stock today? | Qu'y a-t-il en stock aujourd'hui ? | not yet |
| `web.w4_good` | معلومات مفيدة | Good to know | Bon à savoir | not yet |
| `web.w4_vendor_title` | عندك مطعم أو مخبز أو مقهى في الشوف؟ | Own a restaurant, bakery or café in the Chouf? | Vous avez un restaurant, une boulangerie ou un café dans le Chouf ? | not yet |
| `web.w4_vendor_text` | استقبل طلبات التوصيل وأدِر كل شيء من واتساب. بلا جهاز لوحي وبلا تطبيق. | Take delivery orders and run everything from WhatsApp. No tablet, no app. | Recevez des commandes à livrer et gérez tout depuis WhatsApp. Sans tablette, sans application. | not yet |
| `web.w4_how` | كيف نعمل | How it works | Comment ça marche | not yet |
| `web.w4_footer_text` | البقالة في الشوف إلى بابك. نجهّزها في مستودعنا ويوصلها سائقونا. | Groceries in the Chouf, at your door. Packed at our own hub, delivered by our riders. | Les courses dans le Chouf, à votre porte. Préparées dans notre propre dépôt, livrées par nos livreurs. | not yet |
| `web.w4_chat` | راسلنا | Chat with us | Écrivez-nous | not yet |
| `web.w4_shop` | تسوّق | Shop | Courses | not yet |
| `web.w4_more` | المزيد | More | Plus | not yet |
| `web.w4_food_places` | أماكن الطعام | Food places | Restaurants | not yet |
| `web.w4_sell` | بِع على ألو كينغ | Sell on Alo King | Vendre sur Alo King | not yet |
| `web.w4_ride` | اعمل سائقًا مع ألو كينغ | Ride with Alo King | Livrer avec Alo King | not yet |
| `web.w4_signin` | سجّل الدخول عبر واتساب | Sign in with WhatsApp | Se connecter avec WhatsApp | not yet |
| `web.w4_open_daily` | مفتوح يوميًا {hours} | Open daily {hours} | Ouvert tous les jours {hours} | not yet |
| `web.w4_pay_ways` | نقدًا بالدولار أو بالليرة، أو تحويل عبر Whish أو OMT | Cash in $ or LL, or a Whish or OMT transfer | Espèces en $ ou en LL, ou virement Whish ou OMT | not yet |
| `web.w4_not_sold` | لا تبغ ولا كحول ولا أدوية | No tobacco, alcohol or pharmacy items | Pas de tabac, d'alcool ni de pharmacie | not yet |
| `web.w4_photos` | الصور | Photos | Photos | not yet |
| `web.w4_photos_text` | صور الأقسام من Unsplash (unsplash.com)، مجانية بموجب رخصة Unsplash. كل صورة محفوظة على هذا الموقع، لا تُحمَّل من موقعهم: | The category photos are from Unsplash (unsplash.com), free to use under the Unsplash License. Each one is kept on this site, not loaded from theirs: | Les photos des rayons viennent d'Unsplash (unsplash.com), libres d'utilisation sous la licence Unsplash. Chacune est gardée sur ce site, pas chargée depuis le leur : | not yet |
| `web.w4_per_kg` | للكيلو | per kg | le kg | not yet |
| `web.w4_per_pack_about` | للعبوة، حوالي {g} غ | per pack of about {g} g | la barquette d'environ {g} g | not yet |
| `web.w4_per_pack` | للعبوة، الوزن لم يتأكد بعد | per pack, weight not confirmed yet | la barquette, poids pas encore confirmé | not yet |
| `web.w4_aisles_kicker` | البقالة | Groceries | Épicerie | not yet |
| `web.w4_aisles_title` | متجرنا، نجهّز طلبك عند الطلب. | Our own store, packed to order. | Notre propre magasin, préparé à la commande. | not yet |
| `web.w4_aisles_text` | {n} منتج يومي، يختارها فريقنا ويتحقق منها ويجهّزها في مستودعنا. | {n} everyday items, picked, checked and packed by our team at our own hub. | {n} articles du quotidien, choisis, vérifiés et préparés par notre équipe dans notre dépôt. | not yet |
| `web.w4_aisles_out` | نعرض ما نفد، ولا نخفيه | Out of stock is shown, never hidden | Les ruptures sont affichées, jamais cachées | not yet |
| `web.w4_jump` | انتقل إلى قسم | Jump to an aisle | Aller à un rayon | not yet |
| `web.w4_back_aisles` | الأقسام | Aisles | Rayons | not yet |
| `web.w4_filter` | تصفية | Filter | Filtrer | not yet |
| `web.w4_all` | الكل | All | Tout | not yet |
| `web.w4_all_brands` | كل الماركات | All brands | Toutes les marques | not yet |
| `web.w4_more_in` | المزيد في {aisle} | More in {aisle} | Plus dans {aisle} | not yet |
| `web.w4_ask_item` | اسألنا عن هذا المنتج عبر واتساب | Ask about this item on WhatsApp | Poser une question sur WhatsApp à propos de cet article | not yet |
| `web.w4_results` | {n} نتيجة لـ«{q}» | {n} results for “{q}” | {n} résultats pour « {q} » | not yet |
| `web.w4_browse_or` | أو تصفّح قسمًا | Or browse an aisle | Ou parcourez un rayon | not yet |
| `web.w4_clear` | امسح البحث | Clear search | Effacer la recherche | not yet |
| `web.w4_by_aisle` | تصفية حسب القسم | Filter by aisle | Filtrer par rayon | not yet |
| `web.w4_change` | تغيير | Change | Changer | not yet |

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

## WEB4b, the website's food pages (19 November 2026)

Written by a model (session WEB4b); **not yet read by an Arabic reader**. The website's words for the places a visitor may order from, a place's menu with its
choices, the food basket and the food checkout: the `w4b_` keys of `apps/web/src/lib/i18n-web4b.ts`, merged into the site's dictionary (`test/ci/web4b-words.test.ts`
checks this table lists every one, word for word). The site's register (formal Arabic). Neutral wording only: no rating, praise or health word, and never "safe": a
fact is «مُصرَّح به من المحل» or «لم يتأكد بعد: اسألنا» (invariants 14 and 15). `{n}`, `{name}`, `{place}`, `{old}`, `{new}`, `{group}`, `{dish}`, `{time}`, `{gap}`,
`{min}`, `{max}` and `{list}` are filled by code from the database.

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `web.w4b_order_from` | اطلب من هذه الأماكن | Order from these places | Commander chez ces lieux | not yet |
| `web.w4b_order_from_note` | حالياً لا يرى هذه الأماكن إلا من يجرّبون ألو كينغ. | Only the people testing Alo King see these places for now. | Pour l'instant, seules les personnes qui testent Alo King voient ces lieux. | not yet |
| `web.w4b_listed` | ليست على ألو كينغ بعد | Not on Alo King yet | Pas encore sur Alo King | not yet |
| `web.w4b_prep` | يُحضَّر خلال {n} دقيقة تقريباً | Prepared in about {n} min | Préparé en {n} min environ | not yet |
| `web.w4b_open` | يستقبل الطلبات الآن | Taking orders now | Prend les commandes maintenant | not yet |
| `web.w4b_closed_opens` | مغلق، يفتح الساعة {time} | Closed, opens {time} | Fermé, ouvre à {time} | not yet |
| `web.w4b_closed_today` | مغلق اليوم | Closed today | Fermé aujourd'hui | not yet |
| `web.w4b_back_food` | أماكن الطعام | Food places | Lieux pour manger | not yet |
| `web.w4b_sections` | الأقسام | Sections | Rubriques | not yet |
| `web.w4b_from` | من {place} | From {place} | De {place} | not yet |
| `web.w4b_how` | يشتري مندوبنا طلبك من المحل ويوصله إليك. تدفع للمندوب نقداً عند الباب. | Our rider buys your order at the counter and brings it. You pay the rider in cash at the door. | Notre livreur achète votre commande au comptoir et vous l'apporte. Vous payez le livreur en espèces à la porte. | not yet |
| `web.w4b_choose` | اختر | Choose | Choisir | not yet |
| `web.w4b_add` | أضف | Add | Ajouter | not yet |
| `web.w4b_add_named` | أضف {name} إلى سلة الطعام | Add {name} to the food basket | Ajouter {name} au panier repas | not yet |
| `web.w4b_required` | مطلوب | Required | Obligatoire | not yet |
| `web.w4b_optional` | اختياري | Optional | Facultatif | not yet |
| `web.w4b_pick_one` | اختر واحداً | Choose one | Choisissez-en un | not yet |
| `web.w4b_pick_up_to` | اختر حتى {n} | Choose up to {n} | Jusqu'à {n} | not yet |
| `web.w4b_pick_range` | اختر من {min} إلى {max} | Choose {min} to {max} | De {min} à {max} | not yet |
| `web.w4b_no_thanks` | لا، شكراً | No, thanks | Non, merci | not yet |
| `web.w4b_qty` | العدد | How many | Combien | not yet |
| `web.w4b_need_choice` | اختر {group} أولاً، ثم أضفه. | Choose {group} first, then add it. | Choisissez d'abord : {group}, puis ajoutez-le. | not yet |
| `web.w4b_bad_choice` | هذا الخيار لم يعد في هذا الطبق. اختر من جديد. | That choice is not on this dish any more. Choose again. | Ce choix n'existe plus pour ce plat. Choisissez à nouveau. | not yet |
| `web.w4b_added` | أُضيف إلى سلة الطعام. | Added to your food basket. | Ajouté à votre panier repas. | not yet |
| `web.w4b_facts` | مسببات الحساسية والنظام الغذائي | Allergens and diet | Allergènes et régime | not yet |
| `web.w4b_facts_intro` | فقط ما صرّح به المحل. «لم يتأكد بعد» تعني أننا لا نعرف: اسألنا قبل أن تطلب، واكتب أي حساسية في طلبك. نخبر المحل حين نتصل به. | Only what the place has declared. "Not confirmed yet" means we do not know: ask us before you order, and write any allergy in your order. We tell the place when we call. | Seulement ce que le lieu a déclaré. « Pas encore confirmé » veut dire que nous ne savons pas : demandez-nous avant de commander, et écrivez toute allergie dans votre commande. Nous le disons au lieu quand nous l'appelons. | not yet |
| `web.w4b_declared` | مُصرَّح به من المحل | declared by the place | déclaré par le lieu | not yet |
| `web.w4b_not_confirmed` | لم يتأكد بعد: اسألنا | not confirmed yet: ask us | pas encore confirmé : demandez-nous | not yet |
| `web.w4b_all_not_confirmed` | مسببات الحساسية والنظام الغذائي: لم يتأكد بعد: اسألنا. | Allergens and diet: not confirmed yet: ask us. | Allergènes et régime : pas encore confirmé : demandez-nous. | not yet |
| `web.w4b_rest_not_confirmed` | لم يتأكد بعد: اسألنا: {list} | Not confirmed yet: ask us: {list} | Pas encore confirmé : demandez-nous : {list} | not yet |
| `web.w4b_v_contains` | يحتوي | contains | contient | not yet |
| `web.w4b_v_may_contain` | قد يحتوي | may contain | peut contenir | not yet |
| `web.w4b_v_free` | لا يحتوي | does not contain | ne contient pas | not yet |
| `web.w4b_v_yes` | نعم | yes | oui | not yet |
| `web.w4b_v_no` | لا | no | non | not yet |
| `web.w4b_fact_gluten` | غلوتين | Gluten | Gluten | not yet |
| `web.w4b_fact_crustaceans` | قشريات | Crustaceans | Crustacés | not yet |
| `web.w4b_fact_eggs` | بيض | Eggs | Œufs | not yet |
| `web.w4b_fact_fish` | سمك | Fish | Poisson | not yet |
| `web.w4b_fact_peanuts` | فول سوداني | Peanuts | Arachides | not yet |
| `web.w4b_fact_soy` | صويا | Soy | Soja | not yet |
| `web.w4b_fact_milk` | حليب | Milk | Lait | not yet |
| `web.w4b_fact_tree_nuts` | مكسرات | Tree nuts | Fruits à coque | not yet |
| `web.w4b_fact_celery` | كرفس | Celery | Céleri | not yet |
| `web.w4b_fact_mustard` | خردل | Mustard | Moutarde | not yet |
| `web.w4b_fact_sesame` | سمسم | Sesame | Sésame | not yet |
| `web.w4b_fact_sulphites` | كبريتيت | Sulphites | Sulfites | not yet |
| `web.w4b_fact_lupin` | ترمس | Lupin | Lupin | not yet |
| `web.w4b_fact_molluscs` | رخويات | Molluscs | Mollusques | not yet |
| `web.w4b_fact_halal` | حلال | Halal | Halal | not yet |
| `web.w4b_fact_vegetarian` | نباتي | Vegetarian | Végétarien | not yet |
| `web.w4b_fact_vegan` | نباتي صرف | Vegan | Végan | not yet |
| `web.w4b_fact_fasting` | صيامي | Fasting (siyami) | Carême (siyami) | not yet |
| `web.w4b_fact_contains_sugar` | يحتوي سكراً | Contains sugar | Contient du sucre | not yet |
| `web.w4b_fact_spicy` | حار | Spicy | Épicé | not yet |
| `web.w4b_ask_us` | اسألنا على واتساب | Ask us on WhatsApp | Demandez-nous sur WhatsApp | not yet |
| `web.w4b_basket_title` | سلة الطعام | Your food basket | Votre panier repas | not yet |
| `web.w4b_basket_empty` | سلة الطعام فارغة. | Your food basket is empty. | Votre panier repas est vide. | not yet |
| `web.w4b_basket_empty_text` | اختر الأطباق من صفحة المحل. | Choose dishes on a place's page. | Choisissez des plats sur la page d'un lieu. | not yet |
| `web.w4b_view_basket` | سلة الطعام · {n} | Food basket · {n} | Panier repas · {n} | not yet |
| `web.w4b_basket_label` | سلة الطعام، {n} أطباق | Food basket, {n} dishes | Panier repas, {n} plats | not yet |
| `web.w4b_apart` | سلة الطعام منفصلة عن سلة البقالة: طلب الطعام وطلب البقالة طلبان، لكلٍّ بطاقته. | Your food basket is kept apart from your grocery basket: a food order and a grocery order are two orders, each with its own card. | Votre panier repas est séparé de votre panier de courses : une commande de repas et une commande de courses sont deux commandes, chacune avec sa carte. | not yet |
| `web.w4b_more_dishes` | أضف المزيد من {place} | Add more from {place} | Ajouter d'autres plats de {place} | not yet |
| `web.w4b_empty` | أفرغ سلة الطعام | Empty the food basket | Vider le panier repas | not yet |
| `web.w4b_checkout` | إلى الدفع | Go to checkout | Passer à la commande | not yet |
| `web.w4b_full` | سلة الطعام ممتلئة. أرسل هذا الطلب أولاً، أو أخرج شيئاً منها. | Your food basket is full. Send this order first, or take something out. | Votre panier repas est plein. Envoyez d'abord cette commande, ou retirez quelque chose. | not yet |
| `web.w4b_switch_title` | تبدأ سلة طعام جديدة؟ | Start a new food basket? | Commencer un nouveau panier repas ? | not yet |
| `web.w4b_switch_text` | في سلة الطعام أطباق من {old}. طلب الطعام يكون من محل واحد. تبدأ سلة جديدة من {new}؟ | Your food basket has dishes from {old}. A food order comes from one place. Start a new basket with {new}? | Votre panier repas contient des plats de {old}. Une commande de repas vient d'un seul lieu. Commencer un nouveau panier avec {new} ? | not yet |
| `web.w4b_switch_yes` | ابدأ سلة جديدة من {new} | Start a new basket with {new} | Nouveau panier avec {new} | not yet |
| `web.w4b_switch_no` | أبقِ سلتي من {old} | Keep my basket from {old} | Garder mon panier de {old} | not yet |
| `web.w4b_dishes` | الأطباق | Dishes | Plats | not yet |
| `web.w4b_service_fee` | رسم الخدمة | Service fee | Frais de service | not yet |
| `web.w4b_delivery` | التوصيل (كله للمندوب) | Delivery (all to the rider) | Livraison (tout au livreur) | not yet |
| `web.w4b_total` | المجموع | Total | Total | not yet |
| `web.w4b_fee_later` | يُضاف رسم التوصيل عند الدفع، حين نعرف إلى أين نوصله. | The delivery fee is added at checkout, once we know where to bring it. | Les frais de livraison s'ajoutent à la commande, une fois l'adresse connue. | not yet |
| `web.w4b_eta` | يصل خلال {n} دقيقة تقريباً | Arrives in about {n} min | Arrive dans {n} min environ | not yet |
| `web.w4b_issue_closed` | {place} مغلق الآن. يفتح الساعة {time}. | {place} is closed now. It opens at {time}. | {place} est fermé maintenant. Ouverture à {time}. | not yet |
| `web.w4b_issue_closed_today` | {place} مغلق اليوم. | {place} is closed today. | {place} est fermé aujourd'hui. | not yet |
| `web.w4b_issue_choice` | {dish}: اختر {group}. | {dish}: choose {group}. | {dish} : choisissez {group}. | not yet |
| `web.w4b_issue_gone` | {dish} ليس في القائمة الآن. أخرجه لتكمل. | {dish} is not on the menu now. Take it out to go on. | {dish} n'est plus au menu. Retirez-le pour continuer. | not yet |
| `web.w4b_issue_min` | أضف {gap} لتصل إلى الحد الأدنى {min}. | Add {gap} more to reach the {min} minimum. | Ajoutez {gap} pour atteindre le minimum de {min}. | not yet |
| `web.w4b_issue_shop_closed` | نحن مغلقون الآن. نستقبل الطلبات من جديد الساعة {time}. | We are closed now. Orders open again at {time}. | Nous sommes fermés. Les commandes reprennent à {time}. | not yet |
| `web.w4b_issue_other` | في السلة شيء يحتاج إلى تعديل قبل إرسالها. | Something in the basket needs a change before it can be sent. | Quelque chose dans le panier doit changer avant l'envoi. | not yet |
| `web.w4b_checkout_title` | أرسل طلب الطعام | Send your food order | Envoyer votre commande de repas | not yet |
| `web.w4b_where` | إلى أين | Where to | Où livrer | not yet |
| `web.w4b_cash` | الدفع نقداً عند الاستلام: تدفع للمندوب بالدولار أو بالليرة عند الباب. | Cash on delivery: pay the rider in dollars or lira at the door. | Paiement à la livraison : payez le livreur en dollars ou en livres à la porte. | not yet |
| `web.w4b_notes` | طلب أو حساسية، للمحل | A request or an allergy, for the place | Une demande ou une allergie, pour le lieu | not yet |
| `web.w4b_notes_hint` | نقرأه للمحل حين نتصل به. أي حساسية تكتبها نعاملها كحساسية. | We read it to the place when we call. An allergy you write is treated as an allergy. | Nous la lisons au lieu quand nous l'appelons. Une allergie écrite est traitée comme une allergie. | not yet |
| `web.w4b_card` | بطاقة طلبك | Your order card | Votre carte de commande | not yet |
| `web.w4b_send` | أرسل الطلب إلى واتساب | Send the order to my WhatsApp | Envoyer la commande sur mon WhatsApp | not yet |
| `web.w4b_confirm_on_wa` | يُسجَّل الطلب حين تضغط «تأكيد» على واتساب. لا يُطلب شيء قبل ذلك. | The order is placed when you tap Confirm on WhatsApp. Nothing is ordered before that. | La commande est passée quand vous touchez « Confirmer » sur WhatsApp. Rien n'est commandé avant. | not yet |
| `web.w4b_err_not_ready` | السلة تحتاج إلى تعديل قبل إرسالها: انظر أعلاه. | The basket needs a change before it can be sent: see above. | Le panier doit changer avant l'envoi : voir plus haut. | not yet |
| `web.w4b_err_place` | اختر أولاً إلى أين نوصل الطلب. | Choose where to bring the order first. | Choisissez d'abord où livrer la commande. | not yet |
| `web.w4b_err_any` | لم نتمكن من إرسال الطلب. حاول مرة أخرى بعد قليل. | We could not send the order. Please try again in a moment. | Nous n'avons pas pu envoyer la commande. Réessayez dans un instant. | not yet |

The console's Settings page (`apps/console/src/pages/settingmeta.ts`), the rider shifts made editable by migration 0252:

| Arabic | English | Read by |
|---|---|---|
| تبدأ وردية المندوبين الصباحية | Morning rider shift starts | not yet |
| تنتهي وردية المندوبين الصباحية | Morning rider shift ends | not yet |
| تبدأ وردية المندوبين المسائية | Evening rider shift starts | not yet |
| تنتهي وردية المندوبين المسائية | Evening rider shift ends | not yet |

## UX3, the join pages and the Applicants tab (17 November 2026)

Written by a model; **read by the coordinator on 18 November** ("RA 18 Nov"; applied by B1e: `web.join_cash_h` «سقف النقد» and the two consent lines, migration 0235; every other row as written). Three places hold words:
the website's two pages (the keys `join_*`, `vend_*`, `kind_shop` in `apps/web/src/lib/join-words.ts`, merged into the three dictionaries in `apps/web/src/lib/i18n.ts`; the test `test/ci/ux3-arabic.test.ts` holds this table equal to them, word for word),
the one Postgres line (the consent a sender gives by sending their code, `claim_link_code`, migration 0233; Lebanese, as the checkout's is), and the console's Applicants tab (staff only, `apps/console/src/pages/riders.ts`, beside its English with `pick(L, en, ar)`).
Rules the words keep: a rider keeps the whole delivery fee and all tips (invariant 10); no commission figure for a place is published; applying opens nothing (invariant 11); no rating, praise or promise of income (invariant 14);
**the hub is «المستودع»**, never «المركز»; nobody is messaged who has not messaged us first (invariant 17). `{min}`, `{max}`, `{soft}`, `{hard}`, `{vehicles}`, `{code}` and `{name}` are filled by code, from the database.
The shifts (morning 08:00 to 15:30, evening 15:30 to 23:00) are a draft taken from the founder's reference and live in `settings.join`; the amounts come from `zones` and `settings.cash_cap`.

### The website

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `web.join_footer_rider` | كن مندوباً معنا | Ride with us | Livrer avec nous | RA 18 Nov |
| `web.join_footer_vendor` | بع عبر ألو كينغ | Sell on Alo King | Vendre sur Alo King | RA 18 Nov |
| `web.vend_from_place` | هل هذا مكانك؟ قدّم طلباً للبيع عبر ألو كينغ | Own this place? Apply to sell on Alo King | C'est votre établissement ? Demandez à vendre sur Alo King | RA 18 Nov |
| `web.kind_shop` | متجر | Shop | Magasin | RA 18 Nov |
| `web.join_rider_eyebrow` | كن مندوباً مع ألو كينغ | Ride with Alo King | Livrer avec Alo King | RA 18 Nov |
| `web.join_rider_title` | وصّل في الشوف. وخذ الرسوم كاملة. | Deliver in the Chouf. Keep the whole fee. | Livrez dans le Chouf. Gardez tous les frais. | RA 18 Nov |
| `web.join_rider_lead` | البقالة تخرج من مستودعنا إلى قرىً تعرفها. كل رسم توصيل وكل إكرامية لك. | Groceries leave our hub and go to villages you know. Every delivery fee and every tip is yours. | Les courses partent de notre centre vers des villages que vous connaissez. Chaque frais de livraison et chaque pourboire sont à vous. | RA 18 Nov |
| `web.join_apply_cta` | قدّم طلبك في دقيقتين | Apply in 2 minutes | Postulez en 2 minutes | RA 18 Nov |
| `web.join_how_cta` | كيف تربح | How you earn | Comment vous gagnez | RA 18 Nov |
| `web.join_earn_h` | ما الذي تربحه | What you earn | Ce que vous gagnez | RA 18 Nov |
| `web.join_fee_t` | 100٪ من رسم التوصيل | 100% of the delivery fee | 100 % des frais de livraison | RA 18 Nov |
| `web.join_fee_range` | التوصيلة تدفع من {min} إلى {max}، حسب القرية. | A delivery pays {min} to {max}, depending on the village. | Une livraison rapporte de {min} à {max}, selon le village. | RA 18 Nov |
| `web.join_fee_text` | الرسم يُحصَّل لك أنت، لا لألو كينغ. لا نأخذ منه شيئاً. | The fee is collected for you, not for Alo King. We take nothing from it. | Les frais sont encaissés pour vous, pas pour Alo King. Nous n'en prélevons rien. | RA 18 Nov |
| `web.join_tips_t` | 100٪ من الإكراميات | 100% of tips | 100 % des pourboires | RA 18 Nov |
| `web.join_tips_text` | كل إكرامية لك كاملة. | Every tip is yours, in full. | Chaque pourboire est à vous, en entier. | RA 18 Nov |
| `web.join_pay_t` | الدفع عن كل توصيلة | Paid per delivery | Payé à la livraison | RA 18 Nov |
| `web.join_pay_text` | لا يوجد أجر بالساعة. ما تربحه هو رسم كل توصيلة تنجزها وإكراميتها. | There is no hourly wage. What you earn is the fee and the tip of each delivery you make. | Il n'y a pas de salaire horaire. Vous gagnez les frais et le pourboire de chaque livraison que vous faites. | RA 18 Nov |
| `web.join_shifts_h` | الورديات | Shifts | Créneaux | RA 18 Nov |
| `web.join_shifts_lead` | أخبرنا بالأيام والورديات التي تستطيع العمل فيها. | Tell us the days and shifts you can ride. | Dites-nous les jours et les créneaux où vous pouvez livrer. | RA 18 Nov |
| `web.join_shift_morning` | صباحية | Morning | Matin | RA 18 Nov |
| `web.join_shift_evening` | مسائية | Evening | Soir | RA 18 Nov |
| `web.join_who_h` | من يستطيع التوصيل | Who can ride | Qui peut livrer | RA 18 Nov |
| `web.join_who_vehicle` | عندك وسيلة نقل: {vehicles}. | You have a vehicle: {vehicles}. | Vous avez un véhicule : {vehicles}. | RA 18 Nov |
| `web.join_who_licence` | تخبرنا هل عندك رخصة قيادة، نعم أو لا. نقرأ الجواب مع باقي طلبك. | You tell us whether you have a driving licence, yes or no. We read the answer with the rest of your application. | Vous nous dites si vous avez un permis de conduire, oui ou non. Nous lisons la réponse avec le reste de votre candidature. | RA 18 Nov |
| `web.join_who_hours` | تستطيع العمل في الأيام والورديات التي تختارها. | You can ride the days and shifts you choose. | Vous livrez les jours et les créneaux que vous choisissez. | RA 18 Nov |
| `web.join_who_number` | رقم واتساب الخاص بك يُؤكَّد بأن تراسلنا أنت أولاً. لا نراسل رقماً لم يراسلنا. | Your WhatsApp number is confirmed by you messaging us first. We never message a number that has not messaged us. | Votre numéro WhatsApp est confirmé quand vous nous écrivez en premier. Nous n'écrivons jamais à un numéro qui ne nous a pas écrit. | RA 18 Nov |
| `web.join_who_person` | شخص يقرأ كل طلب ويقرر. تقديم الطلب لا يجعلك مندوباً. | A person reads every application and decides. Applying does not make you a rider. | Une personne lit chaque candidature et décide. Postuler ne fait pas de vous un livreur. | RA 18 Nov |
| `web.join_cash_h` | سقف النقد | Cash and its limit | L'argent liquide et sa limite | RA 18 Nov |
| `web.join_cash_text` | كثير من الزبائن يدفعون نقداً عند التسليم، وأنت تحمل هذا النقد للمستودع. من {soft} لا تُعرض عليك طلبات نقدية جديدة، ولا بعد {hard} أبداً، إلى أن تسلّم النقد في المستودع. | Many customers pay cash on delivery, and you carry that cash for the hub. From {soft} you are not offered new cash orders, and never past {hard}, until you hand cash over at the hub. | Beaucoup de clients paient en espèces à la livraison, et vous portez cet argent pour le centre. À partir de {soft} on ne vous propose plus de commande en espèces, et jamais au-delà de {hard}, jusqu'à ce que vous remettiez l'argent au centre. | RA 18 Nov |
| `web.join_terms_h` | الشروط المكتوبة | Written terms | Conditions écrites | RA 18 Nov |
| `web.join_terms_text` | كل شيء مكتوب. تُوقَّع شروطك المكتوبة وتُحفظ عندنا قبل أن تحمل نقداً أو تأخذ توصيلة. | Everything is in writing. Your written terms are signed and kept on file before you carry cash or take a delivery. | Tout est par écrit. Vos conditions écrites sont signées et conservées avant que vous portiez de l'argent ou preniez une livraison. | RA 18 Nov |
| `web.join_terms_owed` | قد يُسجَّل عجز النقد ديناً عليك، لكنه لا يُخصم أبداً من رسومك أو إكرامياتك أو أرباحك تلقائياً. | A shortfall may be recorded as owed by you, but it is never taken out of your fees, tips or earnings automatically. | Un manque peut être noté comme dû par vous, mais il n'est jamais retiré automatiquement de vos frais, pourboires ou gains. | RA 18 Nov |
| `web.join_terms_rating` | لا يُقيَّم المناديب ولا تُعطى لهم درجات ولا يُرتَّبون. | Riders are never rated, scored or ranked. | Les livreurs ne sont ni notés, ni classés. | RA 18 Nov |
| `web.join_apply_h` | قدّم طلبك | Apply | Postuler | RA 18 Nov |
| `web.join_confirm_h` | أكّد رقمك على واتساب | Confirm your number on WhatsApp | Confirmez votre numéro sur WhatsApp | RA 18 Nov |
| `web.join_confirm_rider` | أنت تراسلنا أولاً، فنعرف أن الرقم لك. احصل على رمز ثم أرسله إلينا على واتساب. لا نراسل رقماً لم يراسلنا. | You message us first, so we know the number is yours. Get a code, then send it to us on WhatsApp. We never message a number that has not messaged us. | Vous nous écrivez en premier, pour que nous sachions que le numéro est le vôtre. Obtenez un code, puis envoyez-le-nous sur WhatsApp. Nous n'écrivons jamais à un numéro qui ne nous a pas écrit. | RA 18 Nov |
| `web.join_confirm_vendor` | أرسل الرمز من رقم واتساب صاحب المكان أو مديره، لنعرف من نكتب إليه. أنت تراسلنا أولاً. لا نراسل رقماً لم يراسلنا. | Send the code from the WhatsApp number of the owner or manager, so we know who to write to. You message us first. We never message a number that has not messaged us. | Envoyez le code depuis le numéro WhatsApp du propriétaire ou du gérant, pour que nous sachions à qui écrire. Vous nous écrivez en premier. Nous n'écrivons jamais à un numéro qui ne nous a pas écrit. | RA 18 Nov |
| `web.join_confirm_get` | أعطني الرمز | Get my code | Obtenir mon code | RA 18 Nov |
| `web.join_code_h` | رمزك | Your code | Votre code | RA 18 Nov |
| `web.join_code_send` | افتح واتساب وأرسل الرمز | Open WhatsApp and send the code | Ouvrir WhatsApp et envoyer le code | RA 18 Nov |
| `web.join_code_plain` | أرسل {code} إلى رقم واتساب الخاص بنا. | Send {code} to our WhatsApp number. | Envoyez {code} à notre numéro WhatsApp. | RA 18 Nov |
| `web.join_code_note` | الرمز يعمل لبضع دقائق. إذا توقف عن العمل فاحصل على رمز جديد. | The code works for a few minutes. If it stops working, get a new one. | Le code fonctionne quelques minutes. S'il ne marche plus, obtenez-en un nouveau. | RA 18 Nov |
| `web.join_code_check` | أرسلته | I have sent it | Je l'ai envoyé | RA 18 Nov |
| `web.join_code_new` | رمز جديد | Get a new code | Nouveau code | RA 18 Nov |
| `web.join_confirmed` | تم تأكيد رقمك. | Your number is confirmed. | Votre numéro est confirmé. | RA 18 Nov |
| `web.join_name` | اسمك | Your name | Votre nom | RA 18 Nov |
| `web.join_village` | قريتك | Your village | Votre village | RA 18 Nov |
| `web.join_vehicle` | وسيلة النقل | Your vehicle | Votre véhicule | RA 18 Nov |
| `web.join_vehicle_choose` | اختر | Choose | Choisir | RA 18 Nov |
| `web.join_vehicle_motorbike` | دراجة نارية | Motorbike | Moto | RA 18 Nov |
| `web.join_vehicle_car` | سيارة | Car | Voiture | RA 18 Nov |
| `web.join_vehicle_bicycle` | دراجة هوائية | Bicycle | Vélo | RA 18 Nov |
| `web.join_licence` | هل عندك رخصة قيادة؟ | Do you have a driving licence? | Avez-vous un permis de conduire ? | RA 18 Nov |
| `web.join_yes` | نعم | Yes | Oui | RA 18 Nov |
| `web.join_no` | لا | No | Non | RA 18 Nov |
| `web.join_days` | الأيام التي تستطيع العمل فيها | Days you can ride | Jours où vous pouvez livrer | RA 18 Nov |
| `web.join_shifts` | الورديات التي تستطيع العمل فيها | Shifts you can ride | Créneaux où vous pouvez livrer | RA 18 Nov |
| `web.join_day_mon` | الاثنين | Monday | Lundi | RA 18 Nov |
| `web.join_day_tue` | الثلاثاء | Tuesday | Mardi | RA 18 Nov |
| `web.join_day_wed` | الأربعاء | Wednesday | Mercredi | RA 18 Nov |
| `web.join_day_thu` | الخميس | Thursday | Jeudi | RA 18 Nov |
| `web.join_day_fri` | الجمعة | Friday | Vendredi | RA 18 Nov |
| `web.join_day_sat` | السبت | Saturday | Samedi | RA 18 Nov |
| `web.join_day_sun` | الأحد | Sunday | Dimanche | RA 18 Nov |
| `web.join_submit` | أرسل طلبي | Send my application | Envoyer ma candidature | RA 18 Nov |
| `web.join_err_name` | اكتب اسمك. | Write your name. | Écrivez votre nom. | RA 18 Nov |
| `web.join_err_village` | اكتب اسم قريتك. | Write your village. | Écrivez votre village. | RA 18 Nov |
| `web.join_err_vehicle` | اختر وسيلة النقل. | Choose your vehicle. | Choisissez votre véhicule. | RA 18 Nov |
| `web.join_err_licence` | أخبرنا هل عندك رخصة: نعم أو لا. | Tell us whether you have a licence: yes or no. | Dites-nous si vous avez un permis : oui ou non. | RA 18 Nov |
| `web.join_err_hours` | اختر يوماً واحداً على الأقل ووردية واحدة على الأقل. | Choose at least one day and one shift. | Choisissez au moins un jour et un créneau. | RA 18 Nov |
| `web.join_err_confirm` | أكّد رقمك على واتساب أولاً. | Confirm your number on WhatsApp first. | Confirmez d'abord votre numéro sur WhatsApp. | RA 18 Nov |
| `web.join_err_limit` | طلبات كثيرة من هذا الجهاز اليوم. حاول غداً، أو راسلنا على واتساب. | Too many applications from this device today. Try again tomorrow, or message us on WhatsApp. | Trop de candidatures depuis cet appareil aujourd'hui. Réessayez demain, ou écrivez-nous sur WhatsApp. | RA 18 Nov |
| `web.join_err_failed` | حدث خطأ. حاول مرة أخرى. | Something went wrong. Try again. | Une erreur s'est produite. Réessayez. | RA 18 Nov |
| `web.join_done_h` | طلبك وصلنا. | Your application is with us. | Votre candidature est chez nous. | RA 18 Nov |
| `web.join_done_text` | شخص يقرؤه ويقرر. تقديم الطلب لا يجعلك مندوباً. نكتب إليك على واتساب، في المحادثة التي أرسلت منها الرمز. | A person reads it and decides. Applying does not make you a rider. We write to you on WhatsApp, on the chat where you sent your code. | Une personne la lit et décide. Postuler ne fait pas de vous un livreur. Nous vous écrivons sur WhatsApp, dans la conversation où vous avez envoyé votre code. | RA 18 Nov |
| `web.vend_eyebrow` | بع عبر ألو كينغ | Sell on Alo King | Vendre sur Alo King | RA 18 Nov |
| `web.vend_title` | بِع لأهل الشوف من واتساب. | Sell to the Chouf from WhatsApp. | Vendez au Chouf depuis WhatsApp. | RA 18 Nov |
| `web.vend_lead` | عائلات في الشوف تطلب منا. نريد أن نقدّم طعاماً من المطابخ والمحلات التي تعرفها. تصلك الطلبات على واتساب، ونستطيع توصيلها. | Families across the Chouf order from us. We want to carry food from the kitchens and shops they know. Orders reach you on WhatsApp, and we can deliver them. | Des familles du Chouf commandent chez nous. Nous voulons proposer la cuisine et les commerces qu'elles connaissent. Les commandes vous arrivent sur WhatsApp, et nous pouvons les livrer. | RA 18 Nov |
| `web.vend_notopen` | لا يوجد مطبخ أو محل مفتوح على ألو كينغ بعد. نبدأ مع الأماكن التي نتفق معها على الشروط. | No kitchen or shop is open on Alo King yet. We start with the places we agree terms with. | Aucune cuisine ni aucun commerce n'est encore ouvert sur Alo King. Nous commençons avec les lieux dont nous avons convenu des conditions. | RA 18 Nov |
| `web.vend_cta` | قدّم طلبك في دقيقتين | Apply in 2 minutes | Postulez en 2 minutes | RA 18 Nov |
| `web.vend_listed` | هل مكانك مدرج؟ ابحث عنه | Already listed? Find your place | Déjà listé ? Trouvez votre lieu | RA 18 Nov |
| `web.vend_offer_h` | ماذا تقدّم ألو كينغ | What Alo King offers | Ce qu'offre Alo King | RA 18 Nov |
| `web.vend_o1_t` | طلبات على واتساب | Orders on WhatsApp | Commandes sur WhatsApp | RA 18 Nov |
| `web.vend_o1` | يصلك كل طلب رسالةً وتجيب عليه هناك. بلا جهاز لوحي وبلا تطبيق. | Each order reaches you as a message, and you answer it there. No tablet and no app. | Chaque commande vous arrive en message, et vous y répondez là. Pas de tablette, pas d'application. | RA 18 Nov |
| `web.vend_o2_t` | التوصيل | Delivery | Livraison | RA 18 Nov |
| `web.vend_o2` | نستطيع إيصال الطلب إلى الزبون: يسلّمه المندوب عند الباب ويأخذ الرمز والنقد. | We can bring the order to the customer: the rider hands it over at the door and takes the code and the cash. | Nous pouvons porter la commande au client : le livreur la remet à la porte et prend le code et l'argent. | RA 18 Nov |
| `web.vend_o3_t` | ظهور منصف | Found fairly | Trouvé équitablement | RA 18 Nov |
| `web.vend_o3` | يجد الزبائن الأماكن بحسب ما يطلبونه وبحسب المسافة. لا نقيّم مكاناً ولا نرتّبه ولا نمدحه. | Customers find places by what they ask for and by distance. We never rate, rank or praise a place. | Les clients trouvent les lieux selon ce qu'ils demandent et la distance. Nous ne notons, ne classons ni ne vantons aucun lieu. | RA 18 Nov |
| `web.vend_o4_t` | شروط تُتفق أولاً | Terms, agreed first | Conditions convenues d'abord | RA 18 Nov |
| `web.vend_o4` | عمولتنا جزء من الشروط التي نتفق عليها معك قبل أن تبدأ. لا يوجد رقم في هذه الصفحة. | Our commission is part of the terms we agree with you before you start. There is no figure on this page. | Notre commission fait partie des conditions que nous convenons avec vous avant de commencer. Il n'y a pas de chiffre sur cette page. | RA 18 Nov |
| `web.vend_next_h` | ماذا يحدث بعد طلبك | What happens after you apply | Ce qui se passe après votre candidature | RA 18 Nov |
| `web.vend_n1` | تؤكّد رقمك بأن تراسلنا. | You confirm your number by messaging us. | Vous confirmez votre numéro en nous écrivant. | RA 18 Nov |
| `web.vend_n2` | شخص من فريقنا يقرأ طلبك ويكتب إليك. | A person from our team reads your application and writes to you. | Une personne de notre équipe lit votre candidature et vous écrit. | RA 18 Nov |
| `web.vend_n3` | نتفق على الشروط كتابةً، ونراجع قائمتك وأسعارك. | We agree the terms in writing, and check your menu and your prices. | Nous convenons des conditions par écrit, et vérifions votre menu et vos prix. | RA 18 Nov |
| `web.vend_n4` | وعندها فقط يُفتح مكانك. تقديم الطلب لا يفتح مكانك. | Only then is your place opened. Applying does not open your place. | Alors seulement votre lieu est ouvert. Postuler n'ouvre pas votre lieu. | RA 18 Nov |
| `web.vend_apply_h` | قدّم طلبك | Apply | Postuler | RA 18 Nov |
| `web.vend_name` | اسم المكان | Name of the place | Nom du lieu | RA 18 Nov |
| `web.vend_kind` | نوع المكان | What kind of place | Type de lieu | RA 18 Nov |
| `web.vend_kind_choose` | اختر | Choose | Choisir | RA 18 Nov |
| `web.vend_village` | القرية | Village | Village | RA 18 Nov |
| `web.vend_place_h` | مكانك في قائمتنا | Your place on our list | Votre lieu sur notre liste | RA 18 Nov |
| `web.vend_claim_note` | أنت تقدّم طلباً باسم {name}. وهذا يُحتسب مطالبةً بتلك الصفحة. | You are applying for {name}. This counts as your claim of that page. | Vous postulez pour {name}. Cela compte comme votre revendication de cette page. | RA 18 Nov |
| `web.vend_claim_other` | ليس هذا المكان؟ قدّم الطلب بدونه | Not this place? Apply without it | Pas ce lieu ? Postulez sans lui | RA 18 Nov |
| `web.vend_submit` | أرسل طلبي | Send my application | Envoyer ma candidature | RA 18 Nov |
| `web.vend_err_name` | اكتب اسم المكان. | Write the name of the place. | Écrivez le nom du lieu. | RA 18 Nov |
| `web.vend_err_kind` | اختر نوع المكان. | Choose what kind of place it is. | Choisissez le type de lieu. | RA 18 Nov |
| `web.vend_done_text` | شخص يقرؤه ويكتب إليك على واتساب، في المحادثة التي أرسلت منها الرمز. تقديم الطلب لا يفتح مكانك. | A person reads it and writes to you on WhatsApp, on the chat where you sent your code. Applying does not open your place. | Une personne la lit et vous écrit sur WhatsApp, dans la conversation où vous avez envoyé votre code. Postuler n'ouvre pas votre lieu. | RA 18 Nov |

### The consent a sender gives by sending their code (migration 0233, `claim_link_code`)

| Purpose | Arabic | English | Read by |
|---|---|---|---|
| `rider` | لمّا تبعت الرمز، بتأكّد رقمك وبتوافق إنّو نردّ عليك بهالمحادثة على طلب انضمامك كدليفري. | By sending the code you confirm your number and agree that we answer you on this chat about your application to ride. | RA 18 Nov |
| `vendor` | لمّا تبعت الرمز، بتأكّد رقمك وبتوافق إنّو نردّ عليك بهالمحادثة على طلب انضمام محلّك. | By sending the code you confirm your number and agree that we answer you on this chat about your place's application. | RA 18 Nov |
| `checkout` (as before) | بإرسال الرمز بتأكد رقمك وبتوافق نبعتلك تحديثات طلباتك على هالمحادثة | By sending the code you confirm your number and agree that we send you your order updates on this chat. | RA 17 Nov |

### The console, Riders, Applicants tab

| English | Arabic | Read by |
|---|---|---|
| Applicants | المتقدّمون | RA 18 Nov |
| Vehicle | وسيلة النقل | RA 18 Nov |
| Licence | رخصة | RA 18 Nov |
| Licence: yes | رخصة: نعم | RA 18 Nov |
| Licence: no | رخصة: لا | RA 18 Nov |
| Days | الأيام | RA 18 Nov |
| Shifts | الورديات | RA 18 Nov |
| WhatsApp number | رقم واتساب | RA 18 Nov |
| Applied | قُدّم | RA 18 Nov |
| Its case in the Inbox (resolved) | حالته في الوارد (مُغلقة) | RA 18 Nov |
| Open its case in the Inbox | افتح حالته في الوارد | RA 18 Nov |
| Accept | قبول | RA 18 Nov |
| Why (kept with the decision) | السبب (يُحفظ مع القرار) | RA 18 Nov |
| Accepted | مقبول | RA 18 Nov |
| People who applied on the website after confirming their number on WhatsApp (they messaged us first). Each is not a rider yet: accepting is what makes them one. It starts no shift, records no terms and sends no message; answer them from the Inbox case, and record their written terms on the roster before they carry cash. | أشخاص قدّموا طلباً على الموقع بعد أن أكّدوا رقمهم على واتساب (راسلونا أولاً). ليس أحدهم مندوباً بعد: القبول هو ما يجعله مندوباً. لا يبدأ وردية ولا يسجّل شروطاً ولا يرسل رسالة؛ أجبهم من حالتهم في الوارد، وسجّل شروطهم المكتوبة في القائمة قبل أن يحملوا نقداً. | RA 18 Nov |
| Waiting (${open.length}) | بالانتظار (${open.length}) | RA 18 Nov |
| Nobody is waiting. | لا أحد بالانتظار. | RA 18 Nov |
| Decided | تم البتّ فيها | RA 18 Nov |
| No application has been decided yet. | لم يُبتّ في أي طلب بعد. | RA 18 Nov |
| Someone already decided this application. | بتّ شخص آخر في هذا الطلب. | RA 18 Nov |
| This number is already on the ops line, so they are a rider or staff already. Nothing was changed. | هذا الرقم موجود أصلاً على خط العمليات، فهو مندوب أو موظف بالفعل. لم يتغيّر شيء. | RA 18 Nov |
| This application has no confirmed number, so no rider can be made from it. | لا رقم مؤكَّد لهذا الطلب، فلا يمكن إنشاء مندوب منه. | RA 18 Nov |
| ${name} is now a rider. Next: record their written terms on the roster. | ${name} صار مندوباً. الخطوة التالية: سجّل شروطه المكتوبة في القائمة. | RA 18 Nov |
| Declined. The reason is kept. | تم الرفض. السبب محفوظ. | RA 18 Nov |

## WH1a, warehouse basics (console, staff-facing, written by a model; 18 November 2026)

Source: the `pick(L, "English", "Arabic")` pairs of `apps/console/src/pages/{purchaseorders,bins,temperature,warehouse}.ts` and the lines WH1a added to `stock.ts` and `pick.ts`, plus the zone, status, slot and reason words. Staff read these, never a customer; the printed purchase order (`/purchase-orders/<id>/print?lang=ar`) goes to a supplier. Words with `${…}` stand for a number, a code or a name the page fills in. The hub is «المستودع». Unlike older pages, the warehouse pages say the database's refusals in Arabic too (`plain()` in `warehouse.ts`). **Not read by a person yet.**

| English | Arabic | Read by |
|---|---|---|
| Add the supplier first, on the Receiving page. | أضف المورّد أولاً من صفحة الاستلام. | unread |
| Receiving | الاستلام | unread |
| New purchase order | طلب شراء جديد | unread |
| Supplier | المورّد | unread |
| Expected on | متوقّع في | unread |
| Item: type its name or SKU and pick it from the list (a barcode works too). The cost is optional: the invoice's cost is typed at receiving otherwise. | الصنف: اكتب اسمه أو رمزه واختره من القائمة (الباركود يعمل أيضاً). السعر اختياري: يُكتب سعر الفاتورة عند الاستلام. | unread |
| Item ${i + 1} | الصنف ${i + 1} | unread |
| Quantity | الكمية | unread |
| Unit cost USD (optional) | سعر الوحدة بالدولار (اختياري) | unread |
| Note for the supplier (optional) | ملاحظة للمورّد (اختيارية) | unread |
| Write the purchase order | اكتب طلب الشراء | unread |
| Expected ${x.expected_date} · ${x.lines} item(s) | متوقّع ${x.expected_date} · ${x.lines} صنف | unread |
| Purchase orders | طلبات الشراء | unread |
| Open | مفتوحة | unread |
| Received and cancelled | مُستلمة وملغاة | unread |
| No purchase order is open. | لا طلب شراء مفتوح. | unread |
| None in the last 30 days. | لا شيء في آخر 30 يوماً. | unread |
| Goods come in only by receiving a purchase order. A delivery with no order: the ops lead writes one here first, then it is received. | تدخل البضاعة فقط باستلام طلب شراء. تسليم بلا طلب: يكتب مسؤول العمليات طلباً هنا أولاً ثم يُستلم. | unread |
| Choose the supplier. | اختر المورّد. | unread |
| Choose the day you expect the goods. | اختر اليوم الذي تتوقّع فيه البضاعة. | unread |
| Item ${i + 1}: type a quantity above zero. | الصنف ${i + 1}: اكتب كمية أكبر من صفر. | unread |
| Item ${i + 1}: the cost is not a number. | الصنف ${i + 1}: السعر ليس رقماً. | unread |
| Add at least one item. | أضف صنفاً واحداً على الأقل. | unread |
| No item with SKU or barcode ${l.code}. | لا صنف بالرمز أو الباركود ${l.code}. | unread |
| ${r.number} was already written. | ${r.number} مكتوب بالفعل. | unread |
| Purchase order ${r.number} written for ${name}. | كُتب طلب الشراء ${r.number} لـ ${name}. | unread |
| That record is not valid. | هذا السجل غير صالح. | unread |
| Purchase order | طلب شراء | unread |
| No such purchase order. | لا يوجد طلب شراء كهذا. | unread |
| Status | الحالة | unread |
| Written by | كتبه | unread |
| Note | ملاحظة | unread |
| Cancelled because | أُلغي لأن | unread |
| Received by | استلمه | unread |
| Print in English | اطبع بالإنجليزية | unread |
| Print in Arabic | اطبع بالعربية | unread |
| ordered ${qty(l.qty)} ${unitWord(L, l.unit)} | المطلوب ${qty(l.qty)} ${unitWord(L, l.unit)} | unread |
| Came (count) | وصل (العدد) | unread |
| Of those, damaged | منها تالف | unread |
| Lot (on the pack) | رقم الدفعة (على العبوة) | unread |
| Expiry (if the pack has one) | انتهاء الصلاحية (إن وُجد على العبوة) | unread |
| Expiry (needed) | انتهاء الصلاحية (مطلوب) | unread |
| Unit cost USD (invoice) | سعر الوحدة بالدولار (الفاتورة) | unread |
| Note (short or damaged) | ملاحظة (ناقص أو تالف) | unread |
| Receive | استلام | unread |
| Count every line, even if none came (type 0). Damaged units do not go on the shelf. Chilled, frozen and fresh goods need their expiry date. | عُدّ كل سطر، حتى لو لم يصل شيء (اكتب 0). الوحدات التالفة لا تدخل الرف. المبرّد والمجمّد والطازج يحتاج تاريخ انتهاء الصلاحية. | unread |
| Invoice or delivery-note number | رقم الفاتورة أو إشعار التسليم | unread |
| Paid | الدفع | unread |
| on credit (we owe the supplier) | بالدَّين (ندين للمورّد) | unread |
| from the drawer, now | من الصندوق، الآن | unread |
| Receive these goods | استلم هذه البضاعة | unread |
| Cancel this purchase order | ألغِ طلب الشراء هذا | unread |
| Why (required) | السبب (مطلوب) | unread |
| Cancel the order | ألغِ الطلب | unread |
| ordered ${qty(l.qty)} | المطلوب ${qty(l.qty)} | unread |
| came ${qty(x.counted)}, damaged ${qty(x.damaged)}, on the shelf ${qty(x.received)} | وصل ${qty(x.counted)}، تالف ${qty(x.damaged)}، على الرف ${qty(x.received)} | unread |
| short ${qty(x.short)} | ناقص ${qty(x.short)} | unread |
| Lot ${x.lot} | الدفعة ${x.lot} | unread |
| use by ${x.expiry_date} | يُستهلك قبل ${x.expiry_date} | unread |
| What came | ما وصل | unread |
| Items | الأصناف | unread |
| Short | ناقص | unread |
| ${qty(s.short)} of ${qty(s.ordered)} did not come | ${qty(s.short)} من ${qty(s.ordered)} لم يصل | unread |
| Damaged | تالف | unread |
| For short and damaged goods, agree a credit note with the supplier (Receiving page, the supplier's balance). | للناقص والتالف: اتّفق مع المورّد على إشعار دائن (صفحة الاستلام، رصيد المورّد). | unread |
| Label day | يوم الملصقات | unread |
| ${capture.length} item(s) from this delivery are packaged and not label-ready. Those not yet photographed are first on the label day's list. | ${capture.length} صنف من هذا التسليم معبّأ وغير جاهز الملصق. غير المصوَّر منها في أول قائمة تصوير الملصقات. | unread |
| photographed, waiting to be read or approved | مصوَّر، بانتظار القراءة أو الموافقة | unread |
| to photograph | للتصوير | unread |
| Start photographing | ابدأ التصوير | unread |
| Every item from this delivery is loose or label-ready. | كل أصناف هذا التسليم سائبة أو جاهزة الملصق. | unread |
| Purchase order ${d.number} | طلب شراء ${d.number} | unread |
| All purchase orders | كل طلبات الشراء | unread |
| Use the browser's Print (or Share, then Print) to print this page or save it as a PDF. | استعمل «طباعة» في المتصفح (أو «مشاركة» ثم «طباعة») لطباعة هذه الصفحة أو حفظها PDF. | unread |
| Back | رجوع | unread |
| From | من | unread |
| Written on | تاريخ الطلب | unread |
| Expected on | التسليم المتوقّع | unread |
| Item and code | الصنف والرمز | unread |
| Unit cost | سعر الوحدة | unread |
| Please write this order's number on the invoice or the delivery note. | الرجاء كتابة رقم هذا الطلب على الفاتورة أو إشعار التسليم. | unread |
| Received by: ____________________   Date: ____________ | استلمه: ____________________   التاريخ: ____________ | unread |
| Line ${i}: ${what} is not a number. | السطر ${i}: ${what} ليس رقماً. | unread |
| Line ${l.n}: the expiry date is not a date. | السطر ${l.n}: تاريخ انتهاء الصلاحية ليس تاريخاً. | unread |
| the count | العدد | unread |
| damaged | التالف | unread |
| the cost | السعر | unread |
| ${d.number} was already received; nothing changed. | استُلم ${d.number} من قبل؛ لم يتغيّر شيء. | unread |
| Received ${d.number}: ${qty(units)} unit(s) on the shelf, ${usd(r.total_usd)} at cost. | استُلم ${d.number}: ${qty(units)} وحدة على الرف، بكلفة ${usd(r.total_usd)}. | unread |
| ${r.short.length} line(s) short. | ${r.short.length} سطر ناقص. | unread |
| ${r.damaged.length} line(s) with damaged units. | ${r.damaged.length} سطر فيه تالف. | unread |
| ${r.label_capture.length} item(s) go to the label day's list. | ${r.label_capture.length} صنف إلى قائمة تصوير الملصقات. | unread |
| ${number} cancelled. | أُلغي ${number}. | unread |
| walk ${b.walk_order} | الترتيب ${b.walk_order} | unread |
| Empty. | فارغ. | unread |
| Bins | الرفوف | unread |
| Each item has one shelf place, in its own zone. The pick list walks ambient, fresh, chilled, then frozen, and in each zone the bins in their walk order. | لكل صنف مكان واحد على الرف في منطقته. قائمة التجهيز تمشي: عادي، طازج، مبرّد، ثم مجمّد، وفي كل منطقة الرفوف بترتيب المشي. | unread |
| Put an item in a bin | ضع صنفاً في رف | unread |
| Item SKU or barcode | رمز الصنف أو الباركود | unread |
| Bin | الرف | unread |
| Save the place | احفظ المكان | unread |
| ${x.unplaced} item(s) of this zone have no bin yet: they come at the end of the zone on the pick list. | ${x.unplaced} صنف من هذه المنطقة بلا رف بعد: تأتي في آخر المنطقة في قائمة التجهيز. | unread |
| No bins yet. | لا رفوف بعد. | unread |
| Make the first one below. | أنشئ الأول أدناه. | unread |
| An ops lead makes them. | ينشئها مسؤول العمليات. | unread |
| New bin | رف جديد | unread |
| Code on the shelf (A1, C-02) | الرمز على الرف (A1، C-02) | unread |
| Zone | المنطقة | unread |
| Place in the walk (optional: after the last) | ترتيبه في المشي (اختياري: بعد الأخير) | unread |
| Make the bin | أنشئ الرف | unread |
| Choose the zone. | اختر المنطقة. | unread |
| The place in the walk is a whole number from 1. | الترتيب رقم صحيح من 1. | unread |
| Bin ${code} made (${zoneWord("en", zone).toLowerCase()}). | أُنشئ الرف ${code} (${zoneWord("ar", zone)}). | unread |
| Type the item's SKU or barcode. | اكتب رمز الصنف أو الباركود. | unread |
| Choose the bin. | اختر الرف. | unread |
| No item with SKU or barcode ${code}. | لا صنف بالرمز أو الباركود ${code}. | unread |
| ${p.name_en} is now in bin ${binCode}. | ${p.name_ar // p.name_en} الآن في الرف ${binCode}. | unread |
| from ${s.from}, by ${s.by} | من ${s.from} حتى ${s.by} | unread |
| out of range | خارج المدى | unread |
| Temperature log | سجل الحرارة | unread |
| ${zoneWord(L, z)}: ${range(today.zones[z])}. | ${zoneWord(L, z)}: ${rangeAr(today.zones[z])}. | unread |
| Twice a day: photograph the thermometer and type what it shows. | مرّتان في اليوم: صوّر ميزان الحرارة واكتب ما يظهره. | unread |
| Today, ${today.day} | اليوم، ${today.day} | unread |
| Take a reading | سجّل قراءة | unread |
| The thermometer shows (°C) | ميزان الحرارة يظهر (°م) | unread |
| Photo of the thermometer | صورة ميزان الحرارة | unread |
| Note (what you did, if out of range) | ملاحظة (ما فعلت إن كانت خارج المدى) | unread |
| Save the reading | احفظ القراءة | unread |
| Today's readings | قراءات اليوم | unread |
| in range | ضمن المدى | unread |
| the photo | الصورة | unread |
| The last 14 days | آخر 14 يوماً | unread |
| Day | اليوم | unread |
| Type the number the thermometer shows. | اكتب الرقم الذي يظهره ميزان الحرارة. | unread |
| Take the photo of the thermometer first. | التقط صورة ميزان الحرارة أولاً. | unread |
| That reading was already saved. | حُفظت هذه القراءة بالفعل. | unread |
| Saved: ${deg(reading)}, in range. | حُفظت: ${deg(reading)}، ضمن المدى. | unread |
| Saved: ${deg(reading)}, OUT OF RANGE (${range(rg)}). The staff alert was raised: move the chilled goods to a working fridge, or hold them. | حُفظت: ${deg(reading)}، خارج المدى (${rangeAr(rg)}). أُطلق تنبيه الفريق: انقل المبرّدات إلى برّاد يعمل، أو أوقف بيعها. | unread |
| Not done: the action log could not be written. Try again in a minute. | لم يتم: تعذّر تسجيل الإجراء. حاول بعد دقيقة. | unread |
| There is no hub (dark store) in the database. | لا يوجد مستودع في قاعدة البيانات. | unread |
| Your role cannot do this. | دورك لا يسمح بهذا. | unread |
| Type a quantity above zero (and not more than the lot holds). | اكتب كمية أكبر من صفر (ولا تتجاوز ما في الدفعة). | unread |
| ${name(/^DUPLICATE_ITEM (.*)$/)} is on the order twice: put it on one line. | ${name(/^DUPLICATE_ITEM (.*)$/)} مكرّر في الطلب: اجعله في سطر واحد. | unread |
| The expected day is in the past. | اليوم المتوقّع مضى. | unread |
| That supplier is not active. | هذا المورّد غير فعّال. | unread |
| A restaurant's dish is never on a purchase order. | طبق المطعم لا يدخل في طلب شراء. | unread |
| Write the reason (at least 3 characters). | اكتب السبب (3 أحرف على الأقل). | unread |
| This purchase order was cancelled. | أُلغي طلب الشراء هذا. | unread |
| This purchase order is no longer open. | طلب الشراء هذا لم يعد مفتوحاً. | unread |
| Count every line, even if none came (type 0): ${name(/^LINE_NOT_COUNTED (.*)$/)}. | عُدّ كل سطر، حتى لو لم يصل شيء (اكتب 0): ${name(/^LINE_NOT_COUNTED (.*)$/)}. | unread |
| Type a count of zero or more. | اكتب عدداً صفراً أو أكثر. | unread |
| Damaged cannot be more than came: ${name(/^BAD_DAMAGED (.*)$/)}. | التالف لا يمكن أن يزيد عمّا وصل: ${name(/^BAD_DAMAGED (.*)$/)}. | unread |
| Type the unit cost from the invoice: ${name(/^COST_REQUIRED (.*)$/)}. | اكتب سعر الوحدة من الفاتورة: ${name(/^COST_REQUIRED (.*)$/)}. | unread |
| Chilled, frozen and fresh goods need their expiry date: ${name(/^EXPIRY_REQUIRED (.*) is/)}. | المبرّد والمجمّد والطازج يحتاج تاريخ انتهاء الصلاحية: ${name(/^EXPIRY_REQUIRED (.*) is/)}. | unread |
| That date has passed: expired goods are not received. Count them as damaged. | هذا التاريخ مضى: لا تُستلم بضاعة منتهية الصلاحية. سجّلها تالفة. | unread |
| That invoice number was already used for another delivery from this supplier. | رقم الفاتورة هذا استُعمل لتسليم آخر من هذا المورّد. | unread |
| Only the ops lead pays from the drawer. Receive it on credit. | مسؤول العمليات وحده يدفع من الصندوق. استلمها بالدَّين. | unread |
| Above the picker limit: an ops lead must make this change. | فوق حدّ المجهّز: يجب أن يقوم مسؤول العمليات بهذا التغيير. | unread |
| The drawer does not hold that much by the books. Count it, and check what came in today. | الصندوق لا يحوي هذا المبلغ حسب الدفاتر. عُدّه وراجع ما دخل اليوم. | unread |
| That would leave less on the shelf than is reserved for open orders. | هذا يترك على الرف أقل ممّا هو محجوز لطلبات مفتوحة. | unread |
| That lot was not found. | لم يُعثر على هذه الدفعة. | unread |
| Choose a reason from the list. | اختر سبباً من القائمة. | unread |
| A bin code is letters, digits and a dash, up to 12 (A1, C-02). | رمز الرف أحرف وأرقام وشرطة، حتى 12 (A1، C-02). | unread |
| A bin with that code already exists. | يوجد رف بهذا الرمز. | unread |
| The item is ${zoneWord("en", a!).toLowerCase()} and the bin is ${zoneWord("en", b!).toLowerCase()}: choose a bin in the item's own zone. | الصنف ${zoneWord("ar", a!)} والرف ${zoneWord("ar", b!)}: اختر رفاً في منطقة الصنف نفسها. | unread |
| That bin was not found. | لم يُعثر على هذا الرف. | unread |
| That zone has no log. | لا سجلّ لهذه المنطقة. | unread |
| Type the number the thermometer shows (between −40 and 60). | اكتب الرقم الذي يظهره ميزان الحرارة (بين −40 و60). | unread |
| Only an expired lot is left: mark the line missing, and write the lot off on the Stock page. | لم يبقَ إلا دفعة منتهية الصلاحية: سجّل البند ناقصاً، وأتلف الدفعة من صفحة المخزون. | unread |
| ${fmtQty(t.qty)} with no lot: check the date on the pack | ${fmtQty(t.qty)} بلا دفعة: تحقّق من التاريخ على العبوة | unread |
| Bin ${x.bin} | الرف ${x.bin} | unread |
| Only an expired lot is left for this line: do not pick it. Mark the line missing, and write the lot off on the Stock page. | لم يبقَ لهذا البند إلا دفعة منتهية الصلاحية: لا تأخذها. سجّل البند ناقصاً، وأتلف الدفعة من صفحة المخزون. | unread |
| Bin ${binOf.get(p.id)} | الرف ${binOf.get(p.id)} | unread |
| expired: take it off the shelf | منتهي الصلاحية: أنزله عن الرف | unread |
| Lot ${x.lot ?? "(no code)"} · use by ${x.expiry_date} · ${num_(n(x.qty_left))} left | الدفعة ${x.lot ?? "(بلا رقم)"} · يُستهلك قبل ${x.expiry_date} · بقي ${num_(n(x.qty_left))} | unread |
|  · bin ${binOf.get(p.id)} |  · الرف ${binOf.get(p.id)} | unread |
| Write this lot off | أتلف هذه الدفعة | unread |
| How many | كم وحدة | unread |
| Reason (required) | السبب (مطلوب) | unread |
| Choose a reason | اختر سبباً | unread |
| Write off | أتلف | unread |
| Use within ${USE_SOON_DAYS} days | يُستهلك خلال ${USE_SOON_DAYS} أيام | unread |
| Nothing expires soon. | لا شيء تنتهي صلاحيته قريباً. | unread |
| Needs a look | يحتاج نظرة | unread |
| Every item | كل الأصناف | unread |
| (no code) | (بلا رقم) | unread |
| That write-off was already saved. | حُفظ هذا الإتلاف بالفعل. | unread |
| Written off: ${num_(qty)} from lot ${code}. ${num_(n(r?.qty_left ?? 0))} left in it. | أُتلف ${num_(qty)} من الدفعة ${code}. بقي فيها ${num_(n(r?.qty_left ?? 0))}. | unread |
| Ambient | عادي | unread |
| Fresh | طازج | unread |
| Chilled | مبرّد | unread |
| Frozen | مجمّد | unread |
| Open | مفتوح | unread |
| Received | مُستلم | unread |
| Cancelled | ملغى | unread |
| done | تمّ | unread |
| late | متأخّر | unread |
| missed | فات | unread |
| to do | مطلوب | unread |
| log not started | السجل لم يبدأ | unread |
| Morning | الصباح | unread |
| Evening | المساء | unread |
| Expired | منتهي الصلاحية | unread |
| Spoiled | فاسد | unread |
| Recalled | مسحوب من السوق | unread |
| Purchase orders (menu) | طلبات الشراء | unread |
| Bins (menu) | الرفوف | unread |
| Temperature log (menu) | سجل الحرارة | unread |

### The Receiving page (`receiving.ts`), put into Arabic at the coordinator's request, 18 November

Suppliers, what we owe them, paying from the drawer, the last receipts. Its refusals from the database are said in both languages through `plain()` in `warehouse.ts`.

| English | Arabic | Read by |
|---|---|---|
| Receiving | الاستلام | unread |
| Goods in | البضاعة الداخلة | unread |
| No supplier yet. | لا مورّد بعد. | unread |
| Add one below first. | أضف واحداً أدناه أولاً. | unread |
| Ask the ops lead to add the supplier. | اطلب من مسؤول العمليات إضافة المورّد. | unread |
| Goods come in only against a purchase order: open it on Purchase orders, count each line, and receive it there. A delivery with no order: the ops lead writes one first. | تدخل البضاعة فقط مقابل طلب شراء: افتحه في «طلبات الشراء»، عُدّ كل سطر، واستلمه هناك. تسليم بلا طلب: يكتب مسؤول العمليات طلباً أولاً. | unread |
| Last receipts | آخر الاستلامات | unread |
| None. | لا شيء. | unread |
| on credit | بالدَّين | unread |
| from the drawer | من الصندوق | unread |
| Number | الرقم | unread |
| none | لا يوجد | unread |
| Total at cost | المجموع بالكلفة | unread |
| Stock at cost | المخزون بالكلفة | unread |
| books | الدفاتر | unread |
| ${uncosted} items on the shelf have no cost yet | ${uncosted} صنف على الرف بلا كلفة بعد | unread |
| Suppliers | المورّدون | unread |
| We owe ${usd(balances[i])} | ندين ${usd(balances[i])} | unread |
| Pay from the drawer | ادفع من الصندوق | unread |
| Amount USD | المبلغ بالدولار | unread |
| Receipt number | رقم الإيصال | unread |
| Pay | ادفع | unread |
| Add a supplier | أضف مورّداً | unread |
| Name | الاسم | unread |
| Phone | الهاتف | unread |
| Terms | الشروط | unread |
| cash on delivery, 30 days | نقداً عند التسليم، 30 يوماً | unread |
| Add | أضف | unread |
| Write the supplier's name. | اكتب اسم المورّد. | unread |
| Supplier ${name} saved. | حُفظ المورّد ${name}. | unread |
| That record is not valid. | هذا السجل غير صالح. | unread |
| Type the receipt number. | اكتب رقم الإيصال. | unread |
| That payment was already recorded. | سُجّلت هذه الدفعة من قبل. | unread |
| Paid ${usd(amount)} from the drawer. We now owe ${usd(r.owed_usd)}. | دُفع ${usd(amount)} من الصندوق. ندين الآن ${usd(r.owed_usd)}. | unread |

## B1e, the offer to remember a restriction, in the customer's language (18 November 2026)

Written by a model; **waits for a reader** (the last column is empty). The offer (build plan 1.14) was Arabic only and always said «على طلبك», even with no
order (QA1: «سجّلنا «no sugar» على طلبك» in Arabic to an English customer who had no order). It now has the customer's language (`remember` in
`packages/agents/src/messages/{ar,en,fr}.ts`) and a second form for when no basket, card or order is in hand. The Arabic with an order and the
Arabic buttons and answers are the lines read before (moved from `memory.ts`, one line break added so no line passes 120 characters). `{r}` is
the customer's own words.

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `remember.offer` (an order in hand) | سجّلنا «{r}» على طلبك، ولازم المطبخ يأكّد.<br>بتحب نتذكّرها لطلباتك الجاية؟ | I've put “{r}” on your order; the kitchen must confirm it.<br>Shall we remember it for your next orders? | J'ai mis « {r} » sur votre commande ; la cuisine doit le confirmer.<br>On le retient pour vos prochaines commandes ? | |
| `remember.offer` (no order yet) | سجّلنا «{r}»، ولازم المطبخ يأكّدها بكل طلب.<br>بتحب نتذكّرها لطلباتك الجاية؟ | Noted: “{r}”; the kitchen must confirm it on each order.<br>Shall we remember it for your next orders? | C'est noté : « {r} » ; la cuisine doit le confirmer à chaque commande.<br>On le retient pour vos prochaines commandes ? | |
| `remember.yes` | إيه، تذكّرها | Yes, remember it | Oui, retenez-le | |
| `remember.no` | بس هالمرة | Just this time | Juste cette fois | |
| `remember.kept` | تم، رح نتذكّرها ونحطّها على كل طلب. فيك تقلّي «إنسى» بأي وقت. | Done: we'll remember it and put it on every order. Say “forget me” any time. | C'est fait : on le retient et on le met sur chaque commande. Dites « oubliez-moi » quand vous voulez. | |
| `remember.notKept` | تمام، بس لهالطلب. | OK, just for this order. | D'accord, juste pour cette commande. | |

Still Arabic only, unchanged (not B1e's): the memory answers ("what do you know about me", "forget", "stop remembering"; `MEMORY_TEXT` in `memory.ts`).


## CX2, a line we could not find, and the redesigned customer messages (18 November 2026)

Stage 1 adds one customer line in code (`honest.notFound`, said when a line of the order was not found: never dropped in silence). The
redesigned messages are a proposal in `docs/MESSAGES.md` (Arabic and English, before and after) and on the console's Screens page (session
cx2); their Arabic is read there before stage 2 puts it in the code.

| Key | Arabic | English | French | Read by |
|---|---|---|---|---|
| `honest.notFound` | ما لقيت «{x}» عنّا. إذا قصدك شي تاني، قلّي ياه بكلمات تانية. | I couldn't find “{x}” in our shop. If you meant something else, tell me in other words. | Je n'ai pas trouvé « {x} » chez nous. Si vous pensiez à autre chose, dites-le autrement. | |

## FD1, the Places and Menus pages (console, staff-facing, written by a model; 18 November 2026)

Written by a model; **not yet read by an Arabic reader**. The console's two new pages (`apps/console/src/pages/places.ts`, `menus.ts`), their menu
names (`/places` «الأماكن», `/menus` «القوائم» in `NAV_AR`) and the Settings page's food service fee (`settingmeta.ts`). The test
`test/ci/fd1-arabic.test.ts` keeps this table equal to the pages. Rules the words keep: no rating, praise or health word (invariant 14); a place is
«مكان», a dish «طبق»; "testers only" is «للمختبرين فقط»; we never message a place's number. `${...}` and `{n}`, `{i}` are filled in by the page.

| Page | English | Arabic | Reader's note |
|---|---|---|---|
| places | no village | بلا قرية | |
| places | Approved, off | موافق عليه، متوقف | |
| places | Orderable | يمكن الطلب منه | |
| places | ${p.photos_waiting} photo(s) wait for the reading | ${p.photos_waiting} صورة بانتظار القراءة | |
| places | ${p.dishes_waiting} dish(es) to check | ${p.dishes_waiting} طبق للمراجعة | |
| places | No menu yet | لا قائمة بعد | |
| places | Menu not stamped | القائمة غير مختومة | |
| places | Ready to approve | جاهز للموافقة | |
| places | Opens | يفتح | |
| places | Closes | يغلق | |
| places | Days off | أيام العطلة | |
| places | Preparation time (minutes) | وقت التحضير (دقائق) | |
| places | Village | القرية | |
| places | Choose | اختر | |
| places |  (not served) |  (خارج الخدمة) | |
| places | Opening and closing are times like 11:00. | الفتح والإغلاق أوقات مثل 11:00. | |
| places | Places | الأماكن | |
| places | New place | مكان جديد | |
| places | Testers | المختبرون | |
| places | Restaurants for the friends' test. Alo King buys for the customer: a rider orders and pays at the counter, or we call the order in. The restaurant does nothing new. A place is orderable only once approved, and only by those its visibility allows; public needs the owner's claim or application on file. We never message a place's number. | مطاعم تجربة الأصدقاء. ألو كينغ يشتري عن الزبون: المندوب يطلب ويدفع على الصندوق، أو نتصل بالطلب. لا يفعل المطعم شيئاً جديداً. لا يمكن الطلب من مكان إلا بعد الموافقة عليه، ولمن تسمح لهم الرؤية فقط؛ وللجميع يتطلّب مطالبة صاحبه أو طلبه. لا نراسل رقم أي مكان أبداً. | |
| places | Customers whose WhatsApp number is here see and order from places that are "testers only". | الزبائن الذين رقم واتساب الخاص بهم هنا يرون الأماكن "للمختبرين فقط" ويطلبون منها. | |
| places | Number | الرقم | |
| places | Remove | إزالة | |
| places | Remove | أزل | |
| places | No tester yet. | لا مختبرين بعد. | |
| places | A customer's WhatsApp number, in full (+961...) | رقم واتساب الزبون كاملاً (+961...) | |
| places | Add the tester | أضف المختبر | |
| places | Listing name or village | اسم الإدراج أو القرية | |
| places | Find the listing | ابحث عن الإدراج | |
| places | Find | ابحث | |
| places | Listings | الإدراجات | |
| places | Place | المكان | |
| places | map | الخريطة | |
| places | already a place | مكان من قبل | |
| places | Make a place | اصنع مكاناً | |
| places | No listing matches. | لا إدراج يطابق. | |
| places | Name | الاسم | |
| places | The place's public phone (shown here only) | هاتف المكان العام (يظهر هنا فقط) | |
| places | A new place is off: nobody sees it until you set its visibility and approve it. | المكان الجديد متوقف: لا يراه أحد حتى تضبط رؤيته وتوافق عليه. | |
| places | Make the place | اصنع المكان | |
| places | Phone | الهاتف | |
| places | Visibility | الرؤية | |
| places | Dishes | الأطباق | |
| places | Menu checked | فُحصت القائمة | |
| places | State | الحالة | |
| places | none | لا يوجد | |
| places | not yet | ليس بعد | |
| places | No place yet. | لا مكان بعد. | |
| places | Make one from its listing: New place. | اصنع واحداً من إدراجه: مكان جديد. | |
| places | That place was not found. | لم يُعثر على هذا المكان. | |
| places | Who sees and orders from it | من يراه ويطلب منه | |
| places | The owner's claim or application is on file: public is allowed. | مطالبة صاحب المكان أو طلبه موجودة: يُسمح بالعرض للجميع. | |
| places | No claim or application from the owner yet: public is refused until there is one. | لا مطالبة ولا طلب من صاحب المكان بعد: يُرفض العرض للجميع حتى يوجد أحدهما. | |
| places | Reason | السبب | |
| places | Set the visibility | اضبط الرؤية | |
| places | Approved | موافق عليه | |
| places | Orderable for its visibility only. | يمكن الطلب منه حسب رؤيته فقط. | |
| places | Approving needs approved dishes and the "menu checked" stamp. No commission and no terms: Alo King buys at the counter. | الموافقة تحتاج أطباقاً موافقاً عليها وختم "فُحصت القائمة". لا عمولة ولا شروط: ألو كينغ يشتري على الصندوق. | |
| places | Approve the place | وافق على المكان | |
| places | All places | كل الأماكن | |
| places | Menu | القائمة | |
| places | Approval | الموافقة | |
| places | Details | التفاصيل | |
| places | The place's public phone (shown here only; empty removes it) | هاتف المكان العام (يظهر هنا فقط؛ فارغ يحذفه) | |
| places | Save the details | احفظ التفاصيل | |
| places | That listing is not valid. | هذا الإدراج غير صالح. | |
| places | The place is made. It is off: photograph its menu next. | صُنع المكان. هو متوقف: صوّر قائمته الآن. | |
| places | Saved. | تم الحفظ. | |
| places | Choose off, testers only or public. | اختر متوقف أو للمختبرين فقط أو للجميع. | |
| places | Write the reason (at least 3 characters). | اكتب السبب (٣ أحرف على الأقل). | |
| places | Visibility: ${VIS[v as Place["visibility"]][0]}. | الرؤية: ${VIS[v as Place["visibility"]][1]}. | |
| places | Approved: ${r.items} dish(es), orderable for its visibility (${r.visibility}). | تمت الموافقة: ${r.items} طبق، يمكن الطلب منه حسب رؤيته (${r.visibility}). | |
| places | Added. | أُضيف. | |
| places | Removed. | أُزيل. | |
| menus | Sizes | الأحجام | |
| menus | required | إلزامي | |
| menus | optional | اختياري | |
| menus | Add-ons | إضافات | |
| menus | The name praises or makes a health claim: change it | الاسم يمدح أو يدّعي فائدة صحية: غيّره | |
| menus | printed | مطبوع | |
| menus | no price | بلا سعر | |
| menus | the photo | الصورة | |
| menus | Name in Arabic | الاسم بالعربية | |
| menus | Name in English | الاسم بالإنكليزية | |
| menus | Section | القسم | |
| menus | Price as printed | السعر كما هو مطبوع | |
| menus | Currency | العملة | |
| menus | as read | كما قُرئت | |
| menus | Approve this dish | وافق على هذا الطبق | |
| menus | Reason to reject | سبب الرفض | |
| menus | Reject | ارفض | |
| menus | Menus | القوائم | |
| menus | Photograph a place's menu, run the reading, check every dish, then stamp the menu as checked. | صوّر قائمة المكان، شغّل القراءة، راجع كل طبق، ثم اختم القائمة كمفحوصة. | |
| menus | Photos waiting | صور بالانتظار | |
| menus | Dishes to check | أطباق للمراجعة | |
| menus | On sale | معروض | |
| menus | Make one on the Places page first. | اصنع واحداً في صفحة الأماكن أولاً. | |
| menus | Shrinking and sending photo {i} of {n}… | جارٍ تصغير الصورة {i} من {n} وإرسالها… | |
| menus | {n} photo(s) were not saved: choose them again. | لم تُحفظ {n} صورة: اخترها من جديد. | |
| menus | Photograph a menu page | صوّر صفحة من القائمة | |
| menus | Save the photo | احفظ الصورة | |
| menus | One page per photo, flat and sharp, the whole page in the frame. | صفحة واحدة في كل صورة، مسطحة وواضحة، والصفحة كلها داخل الإطار. | |
| menus | Photos | الصور | |
| menus | Taken | التُقطت | |
| menus | Reading | القراءة | |
| menus | Photo | صورة | |
| menus | Read | قُرئت | |
| menus | Failed ${p.failures}×: waits for the next run | فشلت ${p.failures} مرة: تنتظر القراءة التالية | |
| menus | Waits for the reading run | بانتظار القراءة | |
| menus | No photo yet. | لا صور بعد. | |
| menus | Dish | الطبق | |
| menus | Today | اليوم | |
| menus | Choices | الخيارات | |
| menus | Food facts | المعلومات الغذائية | |
| menus | ${d.declared} declared by the vendor; the rest not confirmed yet | ${d.declared} صرّح بها البائع؛ والباقي غير مؤكد بعد | |
| menus | Not confirmed yet | غير مؤكدة بعد | |
| menus | No dish approved yet. | لا طبق موافق عليه بعد. | |
| menus | Menu checked on ${m.place.menu_checked_on} | فُحصت القائمة في ${m.place.menu_checked_on} | |
| menus | All menus | كل القوائم | |
| menus | ${waitingPhotos} photo(s) wait for the reading run: GitHub, Actions, menu-read, Run workflow, branch main. | ${waitingPhotos} صورة بانتظار القراءة: GitHub، Actions، menu-read، Run workflow، الفرع main. | |
| menus | Today's rate: ${Number(m.fx).toLocaleString("en-US")} LBP to the dollar. A lira price follows the day's rate. | سعر اليوم: ${Number(m.fx).toLocaleString("en-US")} ليرة للدولار. السعر بالليرة يتبع سعر اليوم. | |
| menus | No lira rate is recorded: a lira price cannot be approved until one is. | لا يوجد سعر صرف مسجّل: لا يمكن الموافقة على سعر بالليرة قبل تسجيله. | |
| menus | Nothing to check. | لا شيء للمراجعة. | |
| menus | ${m.rejected} dish(es) rejected. | ${m.rejected} طبق مرفوض. | |
| menus | On sale once the place is approved | يُعرض بعد الموافقة على المكان | |
| menus | Stamp it once every dish here matches the menu as printed today. | اختمها حين يطابق كل طبق هنا القائمة المطبوعة اليوم. | |
| menus | Stamp: menu checked today | اختم: فُحصت القائمة اليوم | |
| menus | The stamp waits until every photo is read and every dish is decided. | الختم ينتظر قراءة كل صورة والبت في كل طبق. | |
| menus | Saved already. | محفوظة من قبل. | |
| menus | Saved. It waits for the reading run. | حُفظت. تنتظر القراءة. | |
| menus | Not done: the action log could not be written. Try again. | لم يتم: تعذّر تسجيل الإجراء. حاول من جديد. | |
| menus | Choose approve or reject. | اختر موافقة أو رفض. | |
| menus | The price is not a number above zero. | السعر ليس رقماً أكبر من صفر. | |
| menus | Approved at $${Number(r.price_usd ?? 0).toFixed(2)} today. | تمت الموافقة بسعر $${Number(r.price_usd ?? 0).toFixed(2)} اليوم. | |
| menus | Rejected. | رُفض. | |
| menus | Menu checked on ${r.menu_checked_on}. | فُحصت القائمة في ${r.menu_checked_on}. | |
| settingmeta | Food service fee (per restaurant order) | رسم خدمة الطعام (لكل طلب من مطعم) | |
| settingmeta | USD; 0 is off | دولار؛ 0 يعني معطّل | |
| settingmeta | Company income. The delivery fee for food is the zone's and belongs to whoever delivers. | دخل للشركة. رسم توصيل الطعام هو رسم المنطقة ويعود لمن يوصّل. | |
| places (lists) | Off | متوقف | |
| places (lists) | Testers only | للمختبرين فقط | |
| places (lists) | Public | للجميع | |
| places (lists) | Mon | الاثنين | |
| places (lists) | Tue | الثلاثاء | |
| places (lists) | Wed | الأربعاء | |
| places (lists) | Thu | الخميس | |
| places (lists) | Fri | الجمعة | |
| places (lists) | Sat | السبت | |
| places (lists) | Sun | الأحد | |
| places (lists) | Places | الأماكن | |
| places (lists) | Menus | القوائم | |
| Places (FD2) | Other names customers use for it, separated by commas (the chat finds the place by these too) | أسماء أخرى يستعملها الزبائن له، تفصل بينها فواصل (المحادثة تجد المكان بها أيضاً) | |

### MENU2 additions to the Menus page (19 November 2026)

Written by a model; **not yet read by an Arabic reader**. The "Add a menu" box, the sources, the flags a reading puts on a dish, "approve all clean dishes in this section", and what a re-import shows. Same rules as above.

| Page | English | Arabic | Reader's note |
|---|---|---|---|
| menus | Price changed (was ${before}) | تغيّر السعر (كان ${before}) | |
| menus | the screenshot | لقطة الشاشة | |
| menus | the PDF | ملف PDF | |
| menus | the text | النص | |
| menus | the web page | صفحة الويب | |
| menus | No longer in the menu | لم يعد في القائمة | |
| menus | price to confirm | السعر للتأكيد | |
| menus | Price to confirm: type it from the source | السعر للتأكيد: اكتبه من المصدر | |
| menus | Reader's note | ملاحظة القارئ | |
| menus | Source line | سطر المصدر | |
| menus | Description as printed | الوصف كما هو مطبوع | |
| menus | This dish is on sale but the new menu no longer shows it. | هذا الطبق معروض لكن القائمة الجديدة لم تعد تذكره. | |
| menus | Take it off sale | أوقف عرضه | |
| menus | Why keep it on sale | لماذا يبقى معروضاً | |
| menus | Keep it on sale | أبقه معروضاً | |
| menus | Add a place's menu (photos, a PDF, a link, text, a Word or Excel file), run the reading, check every dish, then stamp the menu as checked. | أضف قائمة المكان (صور، PDF، رابط، نص، ملف Word أو Excel)، شغّل القراءة، راجع كل طبق، ثم اختم القائمة كمفحوصة. | |
| menus | Could not be fetched: ${s.last_failure ?? ""} | تعذّر جلبه: ${s.last_failure ?? ""} | |
| menus | Fetch failed ${s.failures}×: tried again by the next run | فشل الجلب ${s.failures} مرة: يُعاد في القراءة التالية | |
| menus | ${s.pages_waiting} page(s) wait for the reading run | ${s.pages_waiting} صفحة بانتظار القراءة | |
| menus | Add a menu | أضف قائمة | |
| menus | Use whatever you have; several may be added for one place. Every dish still waits for a person here. | استعمل ما لديك؛ يمكن إضافة أكثر من مصدر للمكان نفسه. كل طبق ينتظر موافقة شخص هنا. | |
| menus | A file: PDF, Word (.docx), Excel (.xlsx) or CSV (a photo works too) | ملف: PDF أو Word (.docx) أو Excel (.xlsx) أو CSV (والصورة أيضاً) | |
| menus | A link to the menu's web page | رابط صفحة القائمة على الويب | |
| menus | Or paste the menu's text | أو الصق نص القائمة | |
| menus | This is the whole menu (a later import then shows what is gone) | هذه القائمة كاملة (فيُظهر الاستيراد اللاحق ما حُذف) | |
| menus | Then: GitHub, Actions, menu-read, Run workflow, branch main. Links and files are fetched, then everything waiting is read. | ثم: GitHub، Actions، menu-read، Run workflow، الفرع main. تُجلب الروابط والملفات ثم يُقرأ كل ما ينتظر. | |
| menus | Other sources | مصادر أخرى | |
| menus | Source | المصدر | |
| menus | Added | أضيف | |
| menus | Pages | الصفحات | |
| menus | whole menu | قائمة كاملة | |
| menus | Pages kept but not read | صفحات محفوظة لم تُقرأ | |
| menus | No section | بلا قسم | |
| menus | Approve all ${clean.length} clean dish(es) in this section | وافق على كل الأطباق السليمة في هذا القسم (${clean.length}) | |
| menus | Clear name and price, no flag. Each is recorded under your name. | اسم وسعر واضحان، بلا ملاحظة. يُسجَّل كل طبق باسمك. | |
| menus | ${rest.length} to approve one by one: | ${rest.length} للموافقة واحداً واحداً: | |
| menus | Sources | المصادر | |
| menus | No menu added yet. | لم تُضف قائمة بعد. | |
| menus | ${waitingPhotos + waitingSources} item(s) wait for the reading run: GitHub, Actions, menu-read, Run workflow, branch main. | ${waitingPhotos + waitingSources} عنصر بانتظار القراءة: GitHub، Actions، menu-read، Run workflow، الفرع main. | |
| menus | This place already has dishes on sale: only what changed is listed (new, price changed, no longer in the menu). | لهذا المكان أطباق معروضة: تظهر هنا التغييرات فقط (جديد، تغيّر السعر، لم يعد في القائمة). | |
| menus | ${m.unchanged} dish(es) read again unchanged: nothing to do. | ${m.unchanged} طبق قُرئ من جديد دون تغيير: لا شيء لفعله. | |
| menus | The stamp waits until every photo and source is read and every dish is decided. | الختم ينتظر قراءة كل صورة ومصدر والبت في كل طبق. | |
| menus | Choose a file, type a link or paste the text first. | اختر ملفاً أو اكتب رابطاً أو الصق النص أولاً. | |
| menus | A menu file is a photo, a PDF, a Word file (.docx), an Excel file (.xlsx) or a CSV file. | ملف القائمة صورة أو PDF أو ملف Word (.docx) أو Excel (.xlsx) أو CSV. | |
| menus | The file is larger than 8 MB. | الملف أكبر من 8 ميغابايت. | |
| menus | Added ${n}. It waits for the reading run. | أضيف ${n}. ينتظر القراءة. | |
| menus | ${again} was already added. | ${again} مضاف من قبل. | |
| menus | Type one price for each size. | اكتب سعراً لكل حجم. | |
| menus | Taken off sale. | أوقف عرضه. | |
| menus | No dish to approve in that section. | لا طبق للموافقة في هذا القسم. | |
| menus | Approved ${r.approved}. ${r.left} changed since the page was shown: check them one by one. | تمت الموافقة على ${r.approved}. ${r.left} تغيّر منذ عرض الصفحة: راجعها واحداً واحداً. | |
| menus | Approved ${r.approved}. | تمت الموافقة على ${r.approved}. | |
| menus | That page was not found. | لم يُعثر على هذه الصفحة. | |
| menus | Source text | نص المصدر | |
| menus | Back to the menu | العودة إلى القائمة | |
| menus | Cut off in the source | مقطوع في المصدر | |
| menus | Name unclear | الاسم غير واضح | |
| menus | Price unclear | السعر غير واضح | |
| menus | A price range, not one price | نطاق أسعار وليس سعراً واحداً | |
| menus | Section unclear | القسم غير واضح | |
| menus | Something unclear | أمر غير واضح | |
| menus | The description praises or makes a health claim: change it | الوصف يمدح أو يدّعي فائدة صحية: غيّره | |
| menus | Web page | صفحة ويب | |
| menus | Pasted text | نص ملصوق | |
| menus | Word file | ملف Word | |
| menus | Excel or CSV file | ملف Excel أو CSV | |


AUTO1 additions to the place's page (prices to confirm, the hours and phone read from the menu):

| Arabic | English | Read |
|---|---|---|
| أسعار للتأكيد | Prices to confirm | not yet |
| القائمة لا تُظهر سعراً واحداً واضحاً لهذه. اتصل بالمكان | The menu does not show one clear price for these. Call the place | not yet |
|  (لا هاتف مسجّل) |  (no phone on file) | not yet |
| ثم اكتب كل سعر في صفحة القوائم. | then type each price on the Menus page. | not yet |
| الظاهر في القائمة | Shown on the menu | not yet |
| اكتب الأسعار في صفحة القوائم | Type the prices on the Menus page | not yet |
| مقروء من القائمة | Read from the menu | not yet |
| الساعات | Hours | not yet |
| مغلق | closed | not yet |
| استعمل هذه | Use these | not yet |
| غير صحيح | Not right | not yet |
| تم القرار سابقاً. | Already decided. | not yet |
| أصبحت الساعات والهاتف من القائمة للمكان. | The hours and phone from the menu are now the place's. | not yet |
| تم تجاهلها. | Put aside. | not yet |
## CX2 stage 2, the customer messages in the approved layout (18 November 2026)

The founder approved the redesign (`docs/MESSAGES.md`) with five changes; these are the Arabic lines as the code now writes them (sample values: AK-1234, لبنة, 08:00). Same meaning as the lines above; new are the bold headings, the emojis at the start of a line, « · » before an amount, and the words of the approved proposal. Every other customer line is in `packages/agents/test/__snapshots__/messages.ar.md`.

| Arabic | Read by |
|---|---|
| 💬 *وصلت رسالتك لحدا من الفريق*<br>رح يردّ عليك خلال دقايق.<br>بهالوقت فيك تكمّل طلبك معي عادي. | |
| 💬 رسالتك عند الفريق، وحدا رح يردّ عليك. | |
| 💬 *بعدنا عم نتابع رسالتك*<br>حدا من الفريق رح يردّ عليك.<br>بتكمّل الطلب، منتصل فيك، أو بتبعت رسالة صوتية؟ | |
| 💬 *رجعت معك*<br>رسالتك بعدها عند الفريق ورح يردّوا عليك.<br>شو فيني ساعدك هلّق؟ | |
| 🌙 *مسكّرين هلّق، منفتح الساعة 08:00*<br>سجّلنا طلبك، وحدا من الفريق بيجاوبك أول ما نفتح.<br>فيك تطلب هلّق ومنحفظلك الطلب لوقت ما نفتح. | |
| ✅ *خلّصنا موضوعك*<br>إذا بدك شي تاني، اكتبلنا هون. | |
| 🛒 كمّل الطلب | |
| ✅ تمام، حدا من الفريق رح يتصل فيك على هالرقم. | |
| 🛒 تفضّل، شو بتحب تطلب؟ | |
| 💬 ابعت رسالتك الصوتية هون، ويلّي عم يتابعك من الفريق رح يسمعها. | |
| ⚠️ *صار في مشكلة تقنية صغيرة من عنّا*<br>ابعت رسالتك كمان مرة بعد دقيقة. | |
| ⚠️ *خلّينا نكمّل من هون*<br>اختار من تحت. | |
| 💬 *عفواً، ما فهمت عليك منيح*<br>شو بتحب تعمل؟ | |
| 🔎 شوف الأغراض | |
| 📦 وين طلبي | |
| 💬 احكي مع حدا | |
| ⚠️ *ما زبطت هالكبسة من عنّا*<br>جرّب كمان مرة. | |
| 🔁 جرّب كمان مرة | |
| ⚠️ *هالمعلومة مش مأكّدة بسجلاتنا*<br>فما فينا نقول إنها مناسبة إلك. بتحب نختار شي تاني؟ | |
| 🔎 اكتبلي شو بدك، وبدوّرلك عليه. | |
| 💬 مرحبا، معك فريق ألو كينغ بخصوص الطلب *AK-1234*.<br>كيف فينا نساعدك؟ | |
| 💬 مرحبا، معك فريق ألو كينغ بخصوص الطلب *AK-1234*.<br>آسفين عالإزعاج. خبّرنا شو صار بالزبط؟ | |
| 💬 مرحبا، معك فريق ألو كينغ بخصوص الطلب *AK-1234*.<br>وصلنا طلبك ورح نراجعه ونرجعلك بالجواب. | |
| 💬 مرحبا، معك فريق ألو كينغ بخصوص الدفع للطلب *AK-1234*.<br>عم نراجعه هلّق. | |
| 💬 مرحبا، معك فريق ألو كينغ بخصوص الطلب *AK-1234*.<br>وصلتنا رسالتك وعم نتابعها هلّق. خبّرنا شو صار؟ | |
| 🛒 *طلبك أقل من الحد الأدنى*<br><br>الحد الأدنى للطلب · $5.00<br>طلبك هلّق · $0.69<br>*ناقصك · $4.31*<br><br>زيد شي، أو اختار من تحت. | |
| 🛒 *الحد الأدنى للطلب · $5.00*<br>شو بتحب تطلب؟ | |
| ❌ إلغاء الطلب | |
| ✅ *تمام، ما رح نبعت شي*<br>سلّتك فاضية. اكتبلي أيمتى ما بدك تطلب. | |
| 🛒 *طلبك لسّا ما انبعت*<br>بسلّتك:<br>• 1 × لبنة<br>• 2 × خبز | |
| ✅ *عدّلنا طلبك*<br>خبز: 2 → 4 | |
| ⚠️ *مش متوفّر هلّق*<br>• لبنة<br>قلّي شو بدك بدالو، أو منشيلو. | |
| 📦 *طلبك AK-1234 عم يتحضّر هلّق*<br>ما فينا نلغيه من هون. حدا من فريقنا رح يتّصل فيك بخصوصه. | |
| 📍 *تمام، منوصّل على بعقلين بلا موقع*<br>السائق رح يتّصل فيك قبل ما يطلع ليتأكّد من العنوان. | |
| 📍 *ما في مشكلة بلا موقع*<br>اكتبلي اسم الضيعة وأقرب معلم للبيت (جامع، كنيسة، مدرسة، فرن). | |
| 🙏 العفو، تكرم عينك. إذا بدك شي، اكتبلي هون. | |
| 👋 *أهلا فيك بألو كينغ!*<br>منوصّلك أغراض البيت لعند بابك بالشوف.<br><br>🛒 اكتبلي شو بدك، أو ابعت رسالة صوتية.<br>🕘 فاتحين كل يوم من 08:00 لـ 22:00.<br><br>_لمّا تراسلنا، بتوافق إنّو نحفظ رسايلك وطلباتك بس لنخدمك. فيك تكتب STOP بأي وقت لنوقّف._ | |
| _لمّا تراسلنا، بتوافق إنّو نحفظ رسايلك وطلباتك بس لنخدمك. فيك تكتب STOP بأي وقت لنوقّف._ | |
| 🛒 اطلب | |
| 📍 بتوصلو لعندي؟ | |
| 🛒 تفضّل، اكتبلي شو بدك أو ابعت رسالة صوتية. | |
| 📍 *منوصّل لعندك؟*<br>ابعتلنا موقعك من الزر تحت أو اكتب اسم الضيعة، ومنقلّك. | |
| ✅ *تمام*<br>الدفع بالمبلغ المظبوط. | |
| 💵 أوّل شي، اختار الورقة يلي رح تدفع فيها. | |
| ❌ إيه، ألغيه | |
| 🏠 لسّا ما في استلام من عنّا، فمنوصّلك لعند البيت. | |
| 🔁 *إذا في غرض ناقص*<br>منحطّ أقرب بديل | |
| ✅ *تمام*<br>إذا في غرض ناقص منحطّ أقرب بديل. | |
| 🔁 *إذا في غرض ناقص*<br>منسألك قبل ما نبدّل | |
| ✅ *تمام*<br>إذا في غرض ناقص منسألك قبل ما نبدّل. | |
| 🔁 *إذا في غرض ناقص*<br>منشيلو من الطلب | |
| ✅ *تمام*<br>إذا في غرض ناقص منشيلو من الطلب. | |
| ✅ *تمام، منجيبلك فراطة للـ$20.00*<br>الفراطة · $12.73 | |
| ✅ *تمام، ما منرجّعلك فراطة*<br>بتصير رصيد إلك بعد الدفع · $12.73 | |
| ⚠️ هالورقة أقل من المجموع · $7.27 | |
| 📦 *بلّشنا نحضّر طلبك AK-1234*<br>ما بقى فينا نغيّر هالخيار. | |
| ❌ *بدك نلغي طلبك AK-1234؟*<br>لسّا ما بلّشنا نحضّرو. | |
| ❌ *بدك نلغي طلبك AK-1234؟*<br>لسّا ما بلّشنا نحضّرو.<br>المبلغ يلي دفعتو بيرجع رصيد إلك · $7.27 | |
| 📦 *بلّشنا نحضّر طلبك AK-1234*<br>ما فينا نلغيه من هون.<br>إذا لغيناه، بيرجعلك رصيد · $5.27<br>ما بيرجعو عالرفّ: لبنة.<br>💬 حدا من الفريق رح يحكيك هلّق. | |
| 📦 *بلّشنا نحضّر طلبك AK-1234*<br>ما فينا نلغيه من هون. ما دفعت شي بعد.<br>💬 حدا من الفريق رح يحكيك هلّق. | |
| 🛵 *طلبك AK-1234 صار عالطريق*<br>ما فينا نلغيه من هون.<br>💬 حدا من الفريق رح يحكيك هلّق. | |
| 🔢 *رمز الاستلام: 4821*<br>عطيه للدليفري بس لمّا يوصلك الطلب. | |
| 🏠 *الاستلام*<br>مستودع ألو كينغ، بلا رسم توصيل | |
| 📦 *طلبك AK-1234 جاهز للاستلام*<br>من مستودع ألو كينغ. جيب معك رمز الاستلام. | |
| 🔎 *«ربطة خبز»: أي واحد بدك؟*<br>عنّا 2. اختار من القائمة. | |
| 🛒 *«ربطة خبز»: حطّينالك Wooden Bakery Pita White Medium 400G*<br>إذا بدك غيرو، قلّي. | |
| 🛒 *ما عندك طلب مفتوح هلّق*<br>اكبس تحت لنجهّزلك نفس آخر طلب إلك بأسعار اليوم:<br>لبنة، خبز | |
| 🛒 *طلبك أقل من الحد الأدنى*<br>بسلّتك:<br>• 1 × لبنة<br><br>الحد الأدنى للطلب · $5.00<br>طلبك هلّق · $0.69<br>*ناقصك · $4.31*<br><br>زيد شي، أو اختار من تحت. | |
| 🌙 *مسكّرين هلّق، منفتح الساعة 08:00*<br><br>✅ طلبك محفوظ:<br>• 1 × لبنة<br><br>بس نفتح، اكبس *ابعت طلبي* ومنكمّل من هون. | |
| 🛒 *طلبك AK-1234 بعدو ناطرك*<br>اكبس *تأكيد الطلب* عالورقة يلي فوق لنبعتو، أو *تعديل* لتغيّر شي. | |
| 🔁 رجعنا فتحنا طلبك من *AK-1234*، بأسعار اليوم. | |
| 🔁 افتح الطلب | |
| 🔢 *رمز الاستلام: 4821*<br>عطيه لموظف المستودع بس لمّا تاخد طلبك. | |
| 🕘 *جايي قريباً، لسّا ما فينا نبيعو*<br>• لبنة<br>قلّي شو بدك بدالو، أو منشيلو. | |
| 🕘 *جايي قريباً، لسّا ما فينا نبيعو*<br>• لبنة<br>• خبز<br>قلّي شو بدك بدالو، أو منشيلو. | |

WEB2's WhatsApp lines (the website's sign-in and card), in the new layout, with English and French:

| Arabic | English | French |
|---|---|---|
| ✅ *تأكّد رقمك*<br>ارجع عالموقع وكمّل طلبك من هونيك. | ✅ *Your number is confirmed*<br>Go back to the website to finish your order. | ✅ *Votre numéro est confirmé*<br>Retournez sur le site pour terminer votre commande. |
| ⚠️ *هالرمز انتهت صلاحيته*<br>ارجع عالموقع واضغط «أكّد رقمك على واتساب» من جديد. | ⚠️ *This code has expired*<br>Go back to the website and tap "Confirm your number on WhatsApp" again. | ⚠️ *Ce code a expiré*<br>Retournez sur le site et appuyez à nouveau sur « Confirmer votre numéro sur WhatsApp ». |
| ⚠️ *هالرمز انستعمل من رقم تاني*<br>ارجع عالموقع واطلب رمز جديد. | ⚠️ *Another number already used this code*<br>Go back to the website for a new one. | ⚠️ *Un autre numéro a déjà utilisé ce code*<br>Retournez sur le site pour en obtenir un nouveau. |
| ⚠️ *ما عرفنا هالرمز*<br>ارجع عالموقع واضغط «أكّد رقمك على واتساب» من جديد. | ⚠️ *We don't know this code*<br>Go back to the website and tap "Confirm your number on WhatsApp" again. | ⚠️ *Nous ne connaissons pas ce code*<br>Retournez sur le site et appuyez à nouveau sur « Confirmer votre numéro sur WhatsApp ». |
| ✅ *طلّعناك من حسابك عالموقع*<br>طلباتك ومحادثتك هون باقيين متل ما هنّي. | ✅ *You are signed out of the website*<br>Your orders and this chat stay as they are. | ✅ *Vous êtes déconnecté du site*<br>Vos commandes et cette conversation restent telles quelles. |
| ✅ *طلّعناك من حسابك عالموقع على كل الأجهزة*<br>طلباتك ومحادثتك هون باقيين متل ما هنّي. | ✅ *You are signed out of the website on every device*<br>Your orders and this chat stay as they are. | ✅ *Vous êtes déconnecté du site sur tous les appareils*<br>Vos commandes et cette conversation restent telles quelles. |
| 💬 ما في جهاز مسجّل دخول على الموقع برقمك. | 💬 No device is signed in to the website with your number. | 💬 Aucun appareil n'est connecté au site avec votre numéro. |
| 📦 *طلبك AK-1042 ما عاد ناطر تأكيد*<br>إذا بدك تعرف وين صار، اسألني هون. | 📦 *Order AK-1042 is no longer waiting for your Confirm*<br>Ask me here if you want to know where it is. | 📦 *La commande AK-1042 n'attend plus votre confirmation*<br>Demandez-moi ici si vous voulez savoir où elle en est. |
| 🔎 *ما لقينا طلب إلك بهالرقم*<br>اكتبلي شو بدك ومنساعدك. | 🔎 *We found no order of yours with that number*<br>Tell me what you need and we'll help. | 🔎 *Nous n'avons trouvé aucune commande à vous avec ce numéro*<br>Dites-moi ce qu'il vous faut et nous vous aiderons. |
| رح تدفع بالليرة، ومعك<br>2,000,000 ل.ل | You pay in lira, with<br>2,000,000 LBP | Vous payez en livres, avec<br>2,000,000 LBP |
| Labneh 500 g: منحطّ أقرب بديل | Labneh 500 g: we put the closest match | Labneh 500 g : nous mettons le plus proche |
| Labneh 500 g: منسألك قبل ما نبدّل | Labneh 500 g: we ask you before swapping | Labneh 500 g : nous vous demandons avant de remplacer |
| Labneh 500 g: منشيلو من الطلب | Labneh 500 g: we take it off | Labneh 500 g : nous le retirons |

## FD2, the Food page (console, staff-facing, written by a model; 18 November 2026)

Written by a model; **not yet read by an Arabic reader**. The console's Food page (`apps/console/src/pages/food.ts`): the call-ahead tasks and
the riders' cash; its menu name `/food` «الأكل» in `NAV_AR`. The test `test/ci/fd2-arabic.test.ts` keeps this table equal to the page. The
customer's food messages (the card's «🍗 من: …», the choices, what staff found on the phone) are in `packages/agents/src/messages/ar.ts`
(`food`, `card.from`, `card.serviceFee`) and every one of them, as sent, in `packages/agents/test/__snapshots__/messages.ar.md`. Rules the words
keep: no rating, praise or health word (invariant 14); a place is «مكان», a dish «طبق»; we never message a place's number; a difference is
shown, never deducted. `${...}` is filled in by the page.

| Page | English | Arabic | Reader's note |
|---|---|---|---|
| Food | The customer was asked; their tap decides. Then call the place again. | سُئل الزبون؛ نقرته تقرر. ثم اتصل بالمكان من جديد. | |
| Food | The place took it: ready in (minutes) | قبل المكان الطلب: جاهز خلال (دقائق) | |
| Food | Accepted | قُبل | |
| Food | An item is missing | صنف غير متوفر | |
| Food | Ask the customer | اسأل الزبون | |
| Food | A price changed | تغيّر سعر | |
| Food | The new price of one (USD) | السعر الجديد للواحد (دولار) | |
| Food | Record the price | سجّل السعر | |
| Food | The place is closed: cancel the order | المكان مغلق: ألغِ الطلب | |
| Food | Call ${k.place} | اتصل بـ ${k.place} | |
| Food | no phone on file (Places page) | لا هاتف مسجّل (صفحة الأماكن) | |
| Food | ready at | جاهز | |
| Food | Read out to the place: | اقرأ للمكان: | |
| Food | Customer's notes (ask about any allergy): | ملاحظات الزبون (اسأل عن أي حساسية): | |
| Food | Food | الأكل | |
| Food | the customer pays | يدفع الزبون | |
| Food | On shift | في الدوام | |
| Food | Since | منذ | |
| Food | Float given | عهدة أُعطيت | |
| Food | Paid to places | دُفع للأماكن | |
| Food | Float returned | عهدة أُعيدت | |
| Food | Float the rider holds | العهدة مع المندوب | |
| Food | Cash collected at the door | كاش حُصّل على الباب | |
| Food | Cash dropped | كاش سُلّم | |
| Food | Cash the rider holds | الكاش مع المندوب | |
| Food | Food orders: owed to the place against paid | طلبات الأكل: المستحق للمكان مقابل المدفوع | |
| Food | Order | الطلب | |
| Food | Place | المكان | |
| Food | Owed | المستحق | |
| Food | Paid | المدفوع | |
| Food | Difference | الفرق | |
| Food | Receipt | الإيصال | |
| Food | photo | صورة | |
| Food | none | لا يوجد | |
| Food | No food order in this shift. | لا طلبات أكل في هذه الوردية. | |
| Food | ${b.differences} order(s) with a difference or no counter payment recorded. Shown, never deducted. | ${b.differences} طلب فيه فرق أو بلا دفع مسجّل. يُعرض فقط ولا يُخصم أبداً. | |
| Food | Calls | الاتصالات | |
| Food | Riders' cash | كاش المناديب | |
| Food | No food order to call about. | لا طلب أكل للاتصال بشأنه. | |
| Food | A confirmed food order appears here. | يظهر هنا كل طلب أكل مؤكَّد. | |
| Food | Rider | المندوب | |
| Food | The float | العهدة | |
| Food | Amount (USD) | المبلغ (دولار) | |
| Food | Give the float | أعطِ العهدة | |
| Food | Float returned | أُعيدت العهدة | |
| Food | The rider paid the place | المندوب دفع للمكان | |
| Food | Shrinking and sending the receipt… | جارٍ تصغير الإيصال وإرساله… | |
| Food | The receipt was not saved: choose it again. | لم يُحفظ الإيصال: اختره من جديد. | |
| Food | Amount on the receipt (USD) | المبلغ على الإيصال (دولار) | |
| Food | Photograph the receipt and save | صوّر الإيصال واحفظ | |
| Food | Save | احفظ | |
| Food | No accepted food order waiting for a counter payment. | لا طلب أكل مقبول بانتظار دفع على الصندوق. | |
| Food | End-of-shift balance | رصيد نهاية الوردية | |
| Food | No rider on shift or holding a float. | لا مندوب في الدوام أو معه عهدة. | |
| Food | Food orders: call the place, record what it said; the customer is told each step in their language. A rider is offered the job only once the place took it. We never message a place's number: staff call it. | طلبات الأكل: اتصل بالمكان وسجّل ما قاله؛ يُخبَر الزبون بكل خطوة بلغته. لا يُعرض الطلب على مندوب إلا بعد أن يقبله المكان. لا نراسل رقم أي مكان: الموظفون يتصلون. | |
| Food |  The customer was told. |  أُخبر الزبون. | |
| Food |  The customer could not be told (${n.why ?? "not sent"}): write to them from the Inbox. |  تعذّر إخبار الزبون (${n.why ?? "لم تُرسل"}): راسله من صندوق الوارد. | |
| Food | Recorded: the place took it. A rider is offered the job now. | سُجّل: قبل المكان الطلب. يُعرض الآن على مندوب. | |
| Food | Recorded. The customer is asked: go on without it, or cancel. | سُجّل. سُئل الزبون: المتابعة بدونه أو الإلغاء. | |
| Food | Recorded: the order is cancelled and the place is closed for today. | سُجّل: أُلغي الطلب وأُغلق المكان لليوم. | |
| Food | Recorded. | سُجّل. | |
| Food | Recorded. The rider now holds $${Number(r.float_usd).toFixed(2)} of float. | سُجّل. مع المندوب الآن $${Number(r.float_usd).toFixed(2)} عهدة. | |
| Food | Recorded. It differs from the food's price by $${d.toFixed(2)}: shown on the balance, never deducted. | سُجّل. يختلف عن سعر الأكل بـ $${d.toFixed(2)}: يظهر في الرصيد ولا يُخصم أبداً. | |
| Food | Not done: the action log could not be written. Try again. | لم يتم: تعذّر تسجيل الإجراء. حاول من جديد. | |
## B1f, "Weights to record on label day" (console, staff-facing, written by a model; 18 November 2026)
No customer message changed. The page's words in `apps/console/src/pages/weights.ts`; the questions themselves are English data (`price_basis_checks.question`).

| Arabic | English | Read |
| --- | --- | --- |
| أوزان للتسجيل يوم الملصقات | Weights to record on label day | not yet |
| للعلبة، الوزن غير مؤكّد بعد | per pack, weight not confirmed yet | not yet |
| للعلبة، حوالي {g} غ | per pack of about {g} g | not yet |
| بالكيلو · بالحبة (لا يُذكر شيء) | per kg · per piece (nothing said) | not yet |
| زِن علبة · أساس السعر للتأكيد · لا يُباع قبل الجواب | weigh one pack · price basis to confirm · not sold until answered | not yet |
| سعرنا هو: للعلبة / للكيلو · كيف تعرف (فاتورة، ميزان، كرتونة) · احفظ الجواب | Our price is: for the pack / per kg · How you know (invoice, scale, tray) · Save the answer | not yet |
| حُفظ: السعر للكيلو؛ تقول الصفحات الآن «بالكيلو». · حُفظ: السعر للعلبة. | Saved: the price is per kg; the pages now say "per kg". · Saved: the price is for the pack. | not yet |
| كل منتج أدناه يُباع بالعلبة، لكن لا وزن معتمداً للعلبة بعد، أو قد يكون سعر المورّد للكيلو لا للعلبة… | Each item below is sold by the pack, but no pack weight is approved yet, or the supplier's price may be per kg… | not yet |

## CON1, the console's map, Today and the Approvals inbox (console, staff-facing, written by a model; 19 November 2026)
| Arabic | English | Read |
|---|---|---|
| الموافقات · المنتجات · الأشخاص · كل الأقسام · متقدّم · أنت وهذا الهاتف · إعداداتك · المستودع | Approvals · Products · People · Every section · Advanced · You and this phone · Your settings · The hub | not yet |
| المساعد · قريباً · مكان محجوز لمساعد الموظفين (جلسة AST1). سيجيب عن الأسئلة من تقارير للقراءة فقط ولن يتصرّف أبداً… | Assistant · Coming soon · A place kept for the staff assistant (session AST1)… never act… | not yet |
| يحتاج انتباهك · أرقام اليوم · متوسط وقت قبول المطعم · المزيد عن اليوم: اللوحة الحيّة والمناديب والصندوق | Needs attention · Today's numbers · Average restaurant acceptance time · More of today: the live board, the riders, the drawer | not yet |
| {code} تجاوز وقته الموعود بـ {n} د · {place} لم يُجب على الاتصال المسبق للطلب {code} · {place} وُجد مغلقاً اليوم · {code} ينتظر تأكيد الزبون | {code} is {n} min past its promised time · {place} has not answered the call ahead for {code} · {place} was found closed today · {code} waits for the customer's Confirm | not yet |
| افتح الطلب · اتصل بالمكان · استلم النقد · افتح المكان · أجب · وافق · اعرض المخزون · افتح Sentry | Open the order · Call the place · Take a cash drop · Open the place · Answer · Approve · See stock · Open Sentry | not yet |
| الأسماء · الصور · قراءات الملصقات · الأطباق · الأماكن · الموافقات الثانية · المبالغ المستردة · الموافقات التلقائية | Names · Photos · Label readings · Dishes · Places · Second approvals · Refunds · Auto-approvals | not yet |
| وافق كما قُرئ · وافق على المكان · صحيح · خطأ · عودة إلى بطاقة واحدة في كل مرة | Approve as read · Approve the place · Right · Wrong · Back to one card at a time | not yet |
| ١ التقدّم · ٢ التصوير · ٣ الموافقة على القراءات · ٤ المعلومات الغذائية · ٥ الجاهزية · عمل الملصقات | 1 Progress · 2 Photograph · 3 Approve readings · 4 Food facts · 5 Readiness · Label work | not yet |
| البقالة · الأكل · بقالة أو أكل · الاثنان · كقائمة (المعتمدة والمرفوضة) | Groceries · Food · Groceries or food · Both · As a list (approved, rejected) | not yet |

### CON1, every new line word for word (the cards, Today, Photos, More, Orders)
| Arabic | English | Read |
|---|---|---|
| لا يمكن التراجع عن الموافقة على صورة من هنا: فهي تحلّ محل الصورة السابقة. الصورة الخاطئة تُسحب في صفحة الصور (المعتمدة). | A picture's approval cannot be undone from here: it replaces the earlier picture. A wrong one is withdrawn on the Photos page (Approved). | not yet |
| لم يُقرأ سعر | no price read | not yet |
| صورة القائمة | Menu photo | not yet |
| صورة القائمة غير متاحة. | Menu photo not available. | not yet |
| الأحجام والخيارات والإضافات | Sizes, choices, add-ons | not yet |
| الاسم يمدح الطبق أو يدّعي فائدة صحية: صحّحه في صفحة القوائم أولاً (ترفضه قاعدة البيانات كما هو). | The name praises the dish or makes a health claim: correct it on the Menus page first (the database refuses it as it is). | not yet |
| لتصحيح الاسم أو السعر أولاً افتح قائمة المكان:  | To correct a name or the price first, open the place's menu:  | not yet |
| صفحة القوائم | the Menus page | not yet |
| أطباق للبيع، بالانتظار | Dishes on sale, waiting | not yet |
| صور قائمة بانتظار القراءة | Menu photos waiting for the reading | not yet |
| الظهور | Visibility | not yet |
| مطالبة المالك في الملف | Owner's claim on file | not yet |
| لا يمكن الطلب من مكان إلا بهذه الموافقة، ولمن يسمح لهم ظهوره فقط. ترفضها قاعدة البيانات ما دامت صورة أو طبق بالانتظار، أو قبل ختم القائمة كمفحوصة. | A place is orderable only through this approval, and only by those its visibility allows. The database refuses it while a photo or a dish waits, or before the menu is stamped as checked. | not yet |
| فحص عيّنة | Spot check | not yet |
| وافقت عليه القاعدة | approved by the rule | not yet |
| القاعدة متوقفة: كانت ستوافق على هذا | the rule was off: it would have approved this | not yet |
| الفحوص الناجحة: | Checks passed: | not yet |
| «صحيح» على أول عيّنة لقاعدة يشغّلها؛ و«خطأ» واحد يوقفها ويتراجع عن تلك الموافقة. | Right on a rule's first sample switches it on; one wrong switches it off and undoes that approval. | not yet |
| ما الخطأ (مطلوب عند «خطأ») | What is wrong (needed for wrong) | not yet |
| ${waiting} بانتظار شخص | ${waiting} waiting for a person | not yet |
| تشبه صورة صنف آخر: ${rest("duplicate:")}. تأكد أنها ليست العبوة الخطأ. | Looks like the picture of another item: ${rest("duplicate:")}. Check it is not the wrong pack. | not yet |
| الخلفية ليست بيضاء (${rest("background:")}). | The background is not white (${rest("background:")}). | not yet |
| المنتج صغير داخل المربع (${rest("fill:")}). | The product is small in the square (${rest("fill:")}). | not yet |
| الصورة صغيرة (${rest("small:")}). | The picture is small (${rest("small:")}). | not yet |
| الملف ثقيل (${rest("heavy:")}). | The file is heavy (${rest("heavy:")}). | not yet |
| جهّزها نصّ المؤسس لشخص يحكم عليها. | The founder's script packaged it for a person to judge. | not yet |
| تقرير الجلب يصنّفها «${rest("report status:")}». | The fetch report marks it "${rest("report status:")}". | not yet |
| ملاحظة: ${rest("note:")}. | Note: ${rest("note:")}. | not yet |
| لكل صنف صورة بانتظار القرار أو معتمدة. | Every stocked item has a picture waiting or approved. | not yet |
| لا صورة لـ ${items.length} صنفاً. كل واحد منها «يحتاج صورة»: صورة الواجهة في يوم الملصقات تغلقه (المخزون، صور يوم الملصقات). | ${items.length} items have no picture. Each is marked "needs a photo": the front photo on label day closes it (Stock, Label day photos). | not yet |
| افتح صفحة يوم الملصقات | Open the label day page | not yet |
| يحتاج صورة | needs a photo | not yet |
| (رُفضت صورة سابقة) | (a picture was rejected before) | not yet |
| تحتاج مراجعة | Needs review | not yet |
| أعدها | Bring back | not yet |
| ملاحظة (السبب)، اختيارية | Note (why), optional | not yet |
| لماذا تحتاج نظرة ثانية | Why it needs a second look | not yet |
| وافق فقط إن كانت الصورة تُظهر هذا الصنف تماماً: العلامة والمنتج والحجم نفسها، عبوة واحدة، خلفية سادة، بلا بطاقة سعر أو شعار أو كتابة. | Approve only if the picture shows exactly this item: same brand, product and size, one pack, plain background, no price tag, logo or text. | not yet |
| بعد الموافقة تظهر للزبائن. | After approval it shows to customers. | not yet |
| ترخيصها ليس مما يجوز عرضه للزبائن: الموافقة تبقيها دليلاً فقط. | Its licence is not one customers may see: approving keeps it as a guide only. | not yet |
| المصدر:  | Source:  | not yet |
| الصورة ${n + 1} من ${total} | Picture ${n + 1} of ${total} | not yet |
| تحتاج صورة | Needs a photo | not yet |
| قائمة الصور غير متاحة بعد: قاعدة البيانات ينقصها جزء منها. | The picture queue is not available yet: the database is missing a part of it. | not yet |
| لا شيء مؤجَّل. | Nothing is put aside. | not yet |
| لا شيء يحتاج مراجعة. | Nothing needs review. | not yet |
| لا صور بانتظار القرار. | No pictures are waiting. | not yet |
| ${waiting} صورة للموافقة | ${waiting} pictures to approve | not yet |
| ، منها ${counts.review} تحتاج مراجعة | , ${counts.review} of them need review | not yet |
| لا يظهر شيء في الموقع أو واتساب حتى توافق عليه. المفاتيح: a للموافقة، r للرفض، l للتأجيل، والأسهم للتنقل. | Nothing shows on the website or WhatsApp until you approve it. Keys: a approves, r rejects, l puts it aside, the arrows move. | not yet |
| تفضّل قائمة، أو تريد سحب صورة معتمدة؟  | Prefer a list, or want to withdraw an approved picture?  | not yet |
| الصور كقائمة | Photos as a list | not yet |
| عن أمس، بالساعات نفسها | vs yesterday, same hours | not yet |
| عن اليوم نفسه الأسبوع الماضي | vs the same day last week | not yet |
| الأيام السبعة قبل اليوم | The seven days before today | not yet |
| لا توصيل بعد اليوم | No delivery yet today | not yet |
| المبيعات، البضاعة فقط | Sales, goods only | not yet |
| سُلّم ضمن وقت المنطقة | Delivered within the zone time | not yet |
| نقطة | points | not yet |
| ${k.today.onTime} من ${k.today.delivered} توصيل | ${k.today.onTime} of ${k.today.delivered} deliveries | not yet |
| متوسط وقت التوصيل | Average delivery time | not yet |
| من تأكيد الزبون إلى الباب | from the customer's confirmation to the door | not yet |
| كلفة الذكاء الاصطناعي لكل طلب | AI cost per order | not yet |
| عن أمس | vs yesterday | not yet |
| استثناءات مفتوحة | Open exceptions | not yet |
| الأقدم أولاً، في الأسفل | oldest first, below | not yet |
| ${o.short_code} تجاوز وقته الموعود بـ ${o.lateBy} د | ${o.short_code} is ${o.lateBy} min past its promised time | not yet |
| ${inbox.lateCases} زبون ينتظر شخصاً منذ وقت طويل | ${inbox.lateCases} customer(s) waiting too long for a person | not yet |
| ${k.place} لم يُجب على الاتصال المسبق للطلب ${k.short_code} | ${k.place} has not answered the call ahead for ${k.short_code} | not yet |
| بالانتظار منذ ${m(minutesSince(k.created_at, now) ?? 0)} | waiting ${m(minutesSince(k.created_at, now) ?? 0)} | not yet |
| ${r.name} يحمل ${usd(r.exposure)}: فوق سقف النقد ${hard ? "الصارم" : "المرن"} | ${r.name} holds ${usd(r.exposure)}: over the ${hard ? "hard" : "soft"} cash cap | not yet |
| المرن ${usd(d.cap.soft)}، الصارم ${usd(d.cap.hard)} | soft ${usd(d.cap.soft)}, hard ${usd(d.cap.hard)} | not yet |
| ${p.name} وُجد مغلقاً اليوم | ${p.name} was found closed today | not yet |
| لا يمكن الطلب منه بقية اليوم | not orderable for the rest of the day | not yet |
| ${o.short_code} ينتظر تأكيد الزبون | ${o.short_code} waits for the customer's Confirm | not yet |
| منذ ${m(o.age)} · ${usd(o.total_usd)} | for ${m(o.age)} · ${usd(o.total_usd)} | not yet |
| ${a.errors.count} خطأ في آخر 24 ساعة | ${a.errors.count} errors in the last 24 hours | not yet |
| بحسب Sentry | counted by Sentry | not yet |
| ${waiting} موافقة بالانتظار | ${waiting} approvals waiting | not yet |
| ${a.stock.low} صنفاً ينفد قريباً، ${a.stock.out} نافداً | ${a.stock.low} items running low, ${a.stock.out} out | not yet |
| الأخطاء في آخر 24 ساعة: Sentry غير موصول باللوحة بعد. | Errors in the last 24 hours: Sentry is not connected to the console yet. | not yet |
| الأخطاء في آخر 24 ساعة: لم يُجب Sentry. | Errors in the last 24 hours: Sentry did not answer. | not yet |
| لا خطأ في آخر 24 ساعة (Sentry). | No error in the last 24 hours (Sentry). | not yet |
| ${accept.n} طلب أكل، من الاتصال المسبق إلى «قُبل» | ${accept.n} food orders, from the call ahead to "accepted" | not yet |
| لم يُقبل طلب أكل بعد اليوم | no food order accepted yet today | not yet |
| نقد المستودع | Hub money | not yet |
| تأخير | late | not yet |
| د تأخير | min late | not yet |
| المُغلقة والمُلغاة: منذ منتصف الليل بتوقيت بيروت | closed and cancelled: since midnight, Beirut | not yet |
| لا طلبات مفتوحة. | No open orders. | not yet |
| ${usd(r.exposure)} من السقف الصارم ${usd(d.cap.hard)} | ${usd(r.exposure)} of the ${usd(d.cap.hard)} hard cap | not yet |
| التعرض | Exposure | not yet |
| النقد المحتفظ به | Cash held | not yet |
| التعرض هو النقد المحتفظ به مضافاً إليه النقد المنتظر تحصيله من المهام المقبولة. العلامة المتقطعة هي السقف المرن والمتصلة هي السقف الصارم. ترفض قاعدة البيانات أي مهمة تتجاوز السقف الصارم | Exposure is the cash held plus cash still to collect on accepted jobs. The dashed mark is the soft cap, the solid one the hard cap. The database refuses a job that would pass the hard cap | not yet |
| طرق العرض | Views | not yet |
| كل الطلبات المفتوحة | every open order | not yet |
| الأعمدة | Columns | not yet |
| المعروض: ${rows.length} | ${rows.length} shown | not yet |
| تنزيل CSV | Download as CSV | not yet |
| البحث يعرض أول 100 نتيجة: أضف تصفية لتضييقها. | The search shows its first 100 matches: add a filter to narrow it. | not yet |
| طلبات أقدم | Older orders | not yet |
| المعروض أول ${PAGE}: رتّب حسب الوقت لتصفّح البقية. | The first ${PAGE} are shown: sort by time to page through the rest. | not yet |
| افتح كصفحة | Open as a page | not yet |
| الرمز مطلوب عند الباب${h.attempts ? ` (${h.attempts} خاطئة من ${h.max})` : ""} | code needed at the door${h.attempts ? ` (${h.attempts} wrong of ${h.max})` : ""} | not yet |
| بقشيش | tip | not yet |
| اكتب سبب الإلغاء. | Write why you cancel it. | not yet |
| لم يعد ممكناً إلغاء هذا الطلب من هنا. | This order can no longer be cancelled here. | not yet |
| أُلغي. أُضيف ${usd(r.credit_usd)} إلى رصيد الزبون. | Cancelled. ${usd(r.credit_usd)} went to the customer's credit. | not yet |
| أُلغي. يُبلَّغ الزبون. | Cancelled. The customer is told. | not yet |
| أُلغي. دُفع ${usd(terms.paid_usd)}: أعده من صفحة الاسترداد. | Cancelled. ${usd(terms.paid_usd)} was paid: give it back on the Refunds page. | not yet |

## AST1, the console assistant (console, staff-facing, written by a model; 19 November 2026)
The assistant's own answers are written by the model at the time of asking, in the language of the question; they are not listed here. The
nightly digest's Arabic text is written the same way (claude-haiku-5-5). The fixed words of the panel, the page, Today's card and Settings:

| Arabic | English | Read |
|---|---|---|
| المساعد · يجيب من تقارير للقراءة فقط ولا يتصرّف أبداً: كل تغيير يبقى زراً في صفحته. | Assistant · Answers from read-only reports and never acts: every change stays a button on its own page. | not yet |
| ما المتأخر الآن؟ · أي مطعم كان الأبطأ اليوم؟ · ما الذي يجب أن أصلحه أولاً؟ | What's late right now? · Which restaurant was slowest today? · What should I fix first? | not yet |
| سؤالك · اسأل عن الطلبات، الأماكن، المناديب، المخزون… · اسأل · أقرأ البيانات… · المحادثة كاملة | Your question · Ask about orders, places, riders, stock… · Ask · Reading the data… · The whole conversation | not yet |
| يجيب من تقارير للقراءة فقط، بكلمات بسيطة، ولا يغيّر شيئاً أبداً: كل تغيير يبقى زراً في صفحته. كل رقم يأتي من البيانات التي قرأها لتلك الإجابة. | It answers from read-only reports, in plain words, and never changes anything: every change stays a button on its own page. Every number comes from the data it read for that answer. | not yet |
| انتهت ميزانية المساعد لليوم، فتوقّف حتى الغد. يستطيع المدير تغيير السقف في الإعدادات. · …لهذا الشهر، فتوقّف حتى الشهر القادم… | Today's assistant budget is used up, so it has stopped until tomorrow. The admin can change the cap in Settings. · …this month's… until next month… | not yet |
| المساعد متوقّف. · لم أستطع الإجابة بأرقام من البيانات وحدها، لذلك لا أعرض تخميناً. اسأل بشكل أضيق، أو افتح الصفحة. · لم يُجب المساعد. حاول مجدداً بعد دقيقة. | The assistant is off. · I could not answer this with figures from the data alone, so I am not showing a guess. Ask more narrowly, or open the page. · The assistant did not answer. Try again in a minute. | not yet |
| المساعد غير موصول: لا يملك الكونسول مفتاح النموذج. · المصروف اليوم · هذا الشهر | The assistant is not connected: the console has no model key. · Spent today · this month | not yet |
| خلاصة اليوم · خلاصة يوم {day} · اسأل المساعد · حُفظت الأرقام، لكن تعذّر التحقق من النص مقابلها، لذلك لا يُعرض. اسأل المساعد عن ذلك اليوم. | The day's digest · Digest of {day} · Ask the assistant · The figures were saved, but the text could not be checked against them, so it is not shown. Ask the assistant about that day. | not yet |
| مساعد الكونسول يجيب عن الأسئلة | The console assistant answers questions | not yet |
| يقرأ ولا يتصرّف أبداً. عند الإيقاف: تقول اللوحة إنه متوقّف. | It reads and never acts. Off: the panel says it is off. | not yet |
| المساعد: الإنفاق في اليوم | Assistant: spend per day | not yet |
| عند تجاوزه يتوقّف المساعد حتى الغد. | Over it, the assistant stops until tomorrow. | not yet |
| المساعد: الإنفاق في الشهر | Assistant: spend per month | not yet |
| عند تجاوزه يتوقّف المساعد حتى الشهر القادم. | Over it, the assistant stops until next month. | not yet |
## AUTO1 (19 November 2026): approvals by rule
Model-written; not yet read by an Arabic reader. Console only (staff), never customer-facing.

| Arabic | English | Read |
|---|---|---|
| تمت الموافقة عليه تلقائياً اليوم | Approved automatically today | not yet |
| يمكن التراجع عن كل واحد بنقرة. | Each can be undone in one tap. | not yet |
| الأطباق لا تُقبل بالقاعدة الآن | Dishes are not approved by rule now | not yet |
| الصور لا تُقرَّر بالقاعدة الآن | Pictures are not decided by rule now | not yet |
| فحص أسبوعي | Weekly check | not yet |
| طبق وافقت عليه القاعدة | A dish approved by the rule | not yet |
| صورة رفضتها القاعدة / صورة وافقت عليها القاعدة | A picture rejected / approved by the rule | not yet |
| «خطأ» يتراجع عنه فوراً. أكثر من خطأ واحد في عيّنة الأسبوع يوقف القاعدة، وتقول صفحة اليوم السبب. | Wrong undoes it at once. More than one wrong in a week's sample switches the rule off, and Today says why. | not yet |
| موافقة بقاعدة وافق عليها شخص | Approved by a rule a person approved | not yet |
| قرار المؤسس في 19 تشرين الثاني: شخص يوافق على القاعدة، والقاعدة توافق على الصنف. … | The founder's decision of 19 November: a person approves the rule; the rule approves the item. … | not yet |
| أطباق القوائم / صور المنتجات | Dishes from menus / Product pictures | not yet |
| تعمل / متوقفة | on / off | not yet |
| تراجع | Undo | not yet |
| فحوص هذا الأسبوع | This week's checks | not yet |
| إعادة فحص الصور المقبولة | Re-check of approved pictures | not yet |
| أسعار للتأكيد | Prices to confirm | not yet |
| القائمة لا تُظهر سعراً واحداً واضحاً لهذه. اتصل بالمكان … ثم اكتب كل سعر في صفحة القوائم. | The menu does not show one clear price for these. Call the place … then type each price on the Menus page. | not yet |
| مقروء من القائمة | Read from the menu | not yet |
| استعمل هذه / غير صحيح | Use these / Not right | not yet |
| أصبحت الساعات والهاتف من القائمة للمكان. | The hours and phone from the menu are now the place's. | not yet |
| الأطباق لا تُقبل بالقاعدة: كل طبق ينتظر شخصاً | Dishes are not approved by rule: every dish waits for a person | not yet |
| الصور لا تُقرَّر بالقاعدة: كل صورة تنتظر شخصاً | Pictures are not decided by rule: every picture waits for a person | not yet |
| اعرف السبب | See why | not yet |
| الأطباق تُقبل بالقاعدة (menu-dish-1) / الصور تُقرَّر بالقاعدة (photo-vision-2) | Dishes approved by rule / Pictures decided by rule (the Settings page) | not yet |
| قارن بالمصدر في صفحة القوائم. | Compare with the source on the Menus page. | not yet |
| ${n(k.dishes_approved)} طبق، ${n(k.photos_approved)} صورة مقبولة، ${n(k.photos_rejected)} صورة مرفوضة، ${n(k.menus_stamped)} قائمة مختومة | ${n(k.dishes_approved)} dish(es), ${n(k.photos_approved)} picture(s) approved, ${n(k.photos_rejected)} picture(s) rejected, ${n(k.menus_stamped)} menu(s) stamped | not yet |
|  (${n(k.undone)} تم التراجع عنها) |  (${n(k.undone)} undone) | not yet |
| مفعّل: الطبق النظيف الذي يوجد كل سعر له في نص القائمة، أو تعيده قراءة ثانية، يُقبل تلقائياً، مسجّلاً وقابلاً للتراجع (الموافقات، الموافقات التلقائية). الأسعار للتأكيد وكل ما عليه علامة يبقى لشخص. | On: a clean dish whose every price is found in the menu's text, or given again by a second reading, is approved automatically, recorded and undoable (Approvals, Auto-approvals). Prices to confirm and anything flagged still come to a person. | not yet |
| مفعّل: الصورة التي يؤكد فحص الرؤية علامتها ومنتجها وحجمها ونكهتها تُقبل؛ عدم التطابق الواضح يُرفض مع سببه؛ وكل ما هو غير مؤكد يأتي لشخص. | On: a picture whose brand, product, size and flavour a vision check confirms is approved; a clear mismatch is rejected with its reason; anything uncertain comes to a person. | not yet |
| الموافقة بالقاعدة ليست في قاعدة البيانات بعد (0263 و0264). | Approval by rule is not on this database yet (migrations 0263 and 0264). | not yet |
| قرار المؤسس في 19 تشرين الثاني: شخص يوافق على القاعدة، والقاعدة توافق على الصنف. كل قرار تلقائي مسجّل مع قاعدته ونسختها، ويمكن التراجع عنه بنقرة. | The founder's decision of 19 November: a person approves the rule; the rule approves the item. Every automatic decision is recorded with its rule and version, and can be undone in one tap. | not yet |
| تُشغَّل أو توقَف من صفحة الإعدادات (المدير). | Switched on or off on the Settings page (admin). | not yet |
| لا شيء بالقاعدة: سعر للتأكيد، اسم غير واضح، تغيير سعر أو حذف عند إعادة الاستيراد، مسببات الحساسية وقراءات الملصقات، صورة فيها كتابة عبرية أو ادعاء صحي أو علامة متجر آخر أو بطاقة سعر. الظهور والموافقة على مكان تبقى لشخص. | Never by rule: a price to confirm, an unclear name, a price change or removal on re-import, allergens and label readings, a picture with Hebrew text, a health claim, another shop's branding or a price tag. Visibility and approving a place stay a person's. | not yet |
| تمت الموافقة تلقائياً | Approved automatically | not yet |
| لم تقرّر القاعدة شيئاً في هذا اليوم. | Nothing decided by a rule on this day. | not yet |
| تم التراجع | undone | not yet |
| يوم آخر | Another day | not yet |
| كل إثنين تأتي هنا 50 من قرارات الأسبوع الماضي التلقائية من كل نوع، بطاقة بطاقة (الموافقات، الموافقات التلقائية). الخاطئ يُتراجع عنه فوراً؛ وأكثر من خطأ واحد يوقف تلك القاعدة، وتقول صفحة اليوم السبب. | Each Monday 50 of last week's automatic decisions of each kind come here, one card at a time (Approvals, Auto-approvals). A wrong one is undone at once; more than one wrong switches that rule off, and Today says why. | not yet |
| فُحصت ${rech.checked}: ${rech.agrees} متفقة، ${rech.disagrees} مختلفة، ${rech.unsure} غير متأكدة. لم يتغير شيء؛ اسحب الصورة من صفحة الصور إن كانت خاطئة. | ${rech.checked} checked: ${rech.agrees} agree, ${rech.disagrees} disagree, ${rech.unsure} unsure. Nothing was changed; withdraw a picture on Photos if it is wrong. | not yet |
| يقول الفحص | The check says | not yet |
| مختلف | disagrees | not yet |
| غير متأكد | unsure | not yet |

## TEST1 (23 November 2026): the friends' test mode
Model-written; not yet read by an Arabic reader. The first two are customer-facing (WhatsApp, staging's friends' test only); the rest are console (staff).

| Arabic | English | Read |
|---|---|---|
| 🧪 طلب تجريبي: ما في توصيل ولا دفع | 🧪 Test order: no delivery, no payment (the founder's own words) | the founder's |
| 👋 *أهلا فيك عند ألو كينغ* / لسّا ما فتحنا: عم نجرّب الخدمة مع مجموعة صغيرة. / 🙏 شكراً لصبرك. | 👋 *Welcome to Alo King* / We're not open yet: we're trying the service with a small group. / 🙏 Thank you for your patience. | not yet |
| 🧪 تجريبي: لا توصيل ولا دفع | 🧪 Test: no delivery, no payment | not yet |
| امسح الطلبات التجريبية | Clear test orders | not yet |
| طلب(ات) تجريبية من تجربة الأصدقاء. المسح يلغي المفتوح منها بلا إبلاغ المجرّب ويزيلها كلها من هذه القائمة. الطلبات الحقيقية لا تُمسّ. | test order(s) from the friends' test. Clearing cancels the open ones without telling the tester and takes them all off this list. Real orders are never touched. | not yet |
| اكتب سبب المسح. | Write why you clear them. | not yet |
| مُسح | cleared | not yet |
| وضع تجربة الأصدقاء (بيئة التجربة فقط) | Friends' test mode (staging only) | not yet |
