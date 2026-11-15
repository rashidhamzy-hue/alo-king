# Arabic for a person to read

Every customer-facing Arabic line added since the last human read, with its English, for a native Lebanese speaker to check before
the friends' test (gate A). Written by models; not yet read by a person. A line the reader changes is changed in
`packages/agents/src/messages/ar.ts` (the test `packages/agents/test/arabic-review.test.ts` checks this file lists every line, so
update both together). Mark each row read with the reader's initials in the last column.

What to check: natural Lebanese Arabic as a shop would write it on WhatsApp; nothing promised that the system does not do; no
rating, praise, health or diet word (invariants 14-15); short.

## HO1, the never-stranded hand-off (15 November 2026)

Source: `messages(...).support` in `packages/agents/src/messages/ar.ts`. When each is sent: `docs/strategy/05-console-website-design-handoff.md` section D.

| Key | Arabic | English | Read by |
|---|---|---|---|
| `opened` | ✅ وصل طلبك لحدا من الفريق، رح يجاوبك خلال دقايق.<br>بهالوقت فيك تكمّل طلبك معي عادي. | ✅ A person from our team will answer you within minutes.<br>Meanwhile you can keep ordering with me as usual. | |
| `reminder` | طلبك مفتوح، وحدا من الفريق رح يجاوبك. | Your request is open; a person from our team will answer you. | |
| `stillOnIt` | بعدنا عم نشتغل على طلبك، وحدا من الفريق رح يجاوبك.<br>بتكمّل الطلب، منتصل فيك، أو بتبعت رسالة صوتية؟ | We are still on it; a person from our team will answer you.<br>Keep ordering, get a call back, or leave a voice note? | |
| `resumed` | رجعت معك. طلبك بعدو مفتوح، وحدا من الفريق رح يجاوبك.<br>شو فيني ساعدك هلّق؟ | I'm back with you. Your request is still open and a person will answer you.<br>How can I help now? | |
| `afterHours("08:00")` | 🌙 هلّق مسكّرين، منفتح الساعة 08:00.<br>سجّلنا طلبك، وحدا من الفريق بيجاوبك أول ما نفتح.<br>فيك تطلب هلّق ومنحفظلك الطلب لوقت ما نفتح. | 🌙 We are closed now and open at 08:00.<br>Your request is recorded; a person will answer you when we open.<br>You can order now and we keep it until we open. | |
| `resolved` | ✅ سكّرنا طلبك. إذا بدك شي تاني، اكتبلنا هون. | ✅ Your request is closed. If you need anything else, write to us here. | |
| `callbackButton` | اتصلوا فيي | Call me back | |
| `keepOrderingButton` | كمّل الطلب | Keep ordering | |
| `voiceNoteButton` | رسالة صوتية | Voice note | |
| `callbackNoted` | تمام، حدا من الفريق رح يتصل فيك على هالرقم. | Noted: a person from our team will call you on this number. | |
| `keepOrdering` | تفضّل، شو بتحب تطلب؟ | Go ahead: what would you like to order? | |
| `voiceNoteAsk` | ابعت رسالتك الصوتية هون، والشخص الماسك طلبك رح يسمعها. | Send your voice note here; the person handling your request will listen to it. | |
| `technical` | ⚠️ صار في مشكلة تقنية صغيرة من عنا.<br>ابعت رسالتك كمان مرة بعد دقيقة. | ⚠️ A short technical problem on our side.<br>Send your message again in a minute. | |
| `capMenu` | وصلنا لحد الرسايل بهالساعة.<br>اختار من تحت: | We reached this hour's message limit.<br>Choose below: | |
| `stalled` | عفواً، ما فهمت عليك منيح.<br>شو بتحب تعمل؟ | Sorry, I did not get that.<br>What would you like to do? | |
| `browseButton` | تصفّح الأغراض | Browse | |
| `myOrderButton` | وين طلبي | My order | |
| `personButton` | احكي مع حدا | Talk to a person | |
| `buttonError` | ⚠️ ما زبطت هالكبسة من عنا.<br>جرّب كمان مرة. | ⚠️ That tap did not go through on our side.<br>Please try again. | |
| `retryButton` | جرّب كمان مرة | Try again | |
| `notOnRecord` | هالمعلومة مش مأكّدة بسجلاتنا، فما فينا نقول إنها مناسبة إلك.<br>بتحب نختار شي تاني؟ | This is not confirmed in our records, so we cannot say it suits you.<br>Would you like to choose something else? | |
| `browseInWords` | اكتبلي شو بدك، وبدوّرلك عليه. | Tell me what you need and I will look for it. | |
| `draft(person_requested, "AK-1234")` | مرحبا، معك فريق ألو كينغ بخصوص الطلب AK-1234.<br>كيف فينا نساعدك؟ | Hello, this is the Alo King team about your order AK-1234.<br>How can we help you? | |
| `draft(order_problem, "AK-1234")` | مرحبا، معك فريق ألو كينغ بخصوص الطلب AK-1234.<br>آسفين عالإزعاج. خبّرنا شو صار بالزبط؟ | Hello, this is the Alo King team about your order AK-1234.<br>We are sorry for the trouble. What happened exactly? | |
| `draft(complaint, "AK-1234")` | مرحبا، معك فريق ألو كينغ بخصوص الطلب AK-1234.<br>آسفين عالإزعاج. خبّرنا شو صار بالزبط؟ | Hello, this is the Alo King team about your order AK-1234.<br>We are sorry for the trouble. What happened exactly? | |
| `draft(refund, "AK-1234")` | مرحبا، معك فريق ألو كينغ بخصوص الطلب AK-1234.<br>وصلنا طلبك ورح نراجعه ونرجعلك بالجواب. | Hello, this is the Alo King team about your order AK-1234.<br>We have your request; we will check it and get back to you with the answer. | |
| `draft(payment, "AK-1234")` | مرحبا، معك فريق ألو كينغ بخصوص الدفع للطلب AK-1234.<br>عم نراجعه هلّق. | Hello, this is the Alo King team about the payment for order AK-1234.<br>We are checking it now. | |
| `draft(safety, "AK-1234")` | مرحبا، معك فريق ألو كينغ بخصوص الطلب AK-1234.<br>وصلتنا رسالتك وعم نتابعها هلّق. خبّرنا شو صار؟ | Hello, this is the Alo King team about your order AK-1234.<br>We have your message and are on it now. What happened? | |
| `draft(other, "AK-1234")` | مرحبا، معك فريق ألو كينغ بخصوص الطلب AK-1234.<br>كيف فينا نساعدك؟ | Hello, this is the Alo King team about your order AK-1234.<br>How can we help you? | |
| `ops.turnCap(20) (staff line)` | ⚠️ زبون تخطّى 20 رسالة للمساعد بساعة.<br>عم نجاوبو بقائمة ثابتة لآخر الساعة. | ⚠️ A customer passed 20 assistant messages in an hour.<br>They get a fixed menu until the hour turns. | |
