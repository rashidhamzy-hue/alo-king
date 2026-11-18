// CX2 stage 1: every customer message the founder named, before (today's code, or the founder's own staging chat of 18 November where
// today's code is not a pure function) and after (the proposal, docs/MESSAGES.md), in Arabic and English. One source for the document
// (test/screens/cx2-doc.test.ts writes docs/MESSAGES.md from it) and for the WhatsApp-style screenshots (test/screens/cx2.test.ts).
// Stage 2 moves the approved "after" into packages/agents/src/messages/{ar,en,fr}.ts and the code that sends them. Invented data only.
import type { Outbound } from "@ak/wa/kapso";
import { messages, productName, usd } from "@ak/agents/messages";
import { formatOrderCard, formatWindowChoice, type DeliveryWindow, type Quote, type QuoteLine } from "@ak/agents/order-card";
import { statusText } from "@ak/agents/answers";
import { FEEDBACK_TEXT } from "@ak/agents/feedback";

export type L = "ar" | "en";
export const LS: L[] = ["ar", "en"];

/** One WhatsApp message as the customer sees it. `them` is the customer's own message, shown for context. */
export interface Bubble {
  body: string;
  buttons?: string[];
  list?: { button: string; rows: { title: string; description?: string }[] };
  location?: string;                 // WhatsApp's "Send location" button, with its label
  template?: string;                 // a Meta template, by name
  them?: boolean;
}
export interface Screen { key: string; title: string; why: string; before: Record<L, Bubble[]>; after: Record<L, Bubble[]> }

// ---------------- sample values (invented) ----------------
const CODE = "AK-1062";
const ORDER = "99999999-8888-4777-8666-555555555555";
const LINES: QuoteLine[] = [
  { product_id: "p1", name: "Tannourine water 6 × 2 L", name_ar: "مياه معدنية تنورين 6 × 2 ل", qty: 3, unit: "pack", line_total_usd: 6.03 },
  { product_id: "p2", name: "Najjar Classic coffee 180 g", name_ar: "النجار قهوة كلاسيك عادية 180 غ", qty: 1, unit: "each", line_total_usd: 3.25 },
  { product_id: "p3", name: "Coffee Mate Original 450 g", name_ar: "كوفي ميت مبيض قهوة أوريجينال 450 غ", qty: 1, unit: "each", line_total_usd: 2.85 },
];
const QUOTE: Quote = { ok: true, issues: [], lines: LINES, subtotal_usd: 12.13, delivery_fee_usd: 1, total_usd: 13.13, fx_rate_lbp: 89500, total_lbp: 1175000,
  eta_minutes: 30, pickup: false, village: "Baakline", village_ar: "بعقلين", village_id: null };
const ADDRESS = { village_en: "Baakline", village_ar: "بعقلين", building: "Test house", floor: "Floor 2" };
const ADDRESS_AR = { ...ADDRESS, building: "بيت الاختبار", floor: "الطابق 2" };
const W: DeliveryWindow = { slot_id: "11111111-2222-4333-8444-555555555555", date: "2026-11-19", dow: 4, day_offset: 1, starts: "10:00", ends: "12:00" };
const NESCAFE = [
  { name: "Nescafé 3in1 Classic 20 g", name_ar: "نسكافيه قهوة سريعة التحضير 3 في 1 كلاسيك 20 غ", price: 0.19 },
  { name: "Nescafé Gold pouch 100 g", name_ar: "نسكافيه قهوة سريعة التحضير غولد كيس 100 غ", price: 4.37 },
];
const HOURS = { open: "09:00", close: "21:00" };   // settings.hours from 0255 (09:00 to 21:00)

const name = (l: { name: string; name_ar: string | null }, lang: L) => productName(l, lang);
const bubbles = (os: Outbound[]): Bubble[] => os.map(bubble);
function bubble(o: Outbound): Bubble {
  if (o.type === "text") return { body: o.text.body };
  if (o.type === "template") return { body: JSON.stringify((o as { template: unknown }).template), template: "template" };
  const i = (o as unknown as { interactive: { type: string; body: { text: string }; action: { buttons?: { reply: { title: string } }[];
    button?: string; sections?: { rows: { title: string; description?: string }[] }[]; name?: string } } }).interactive;
  if (i.type === "location_request_message") return { body: i.body.text, location: "Send location" };
  if (i.type === "list") return { body: i.body.text, list: { button: i.action.button ?? "", rows: (i.action.sections ?? []).flatMap((s) => s.rows) } };
  return { body: i.body.text, buttons: (i.action.buttons ?? []).map((b) => b.reply.title) };
}
const text = (body: string, extra: Partial<Bubble> = {}): Bubble => ({ body, ...extra });
const them = (body: string): Bubble => ({ body, them: true });

// ---------------- the proposal: the order card ----------------
/** The card's words, after: one line per item with its amount after " · ", the totals block, then four short sections. */
export function cardAfter(lang: L, o: { window?: DeliveryWindow | null; pickup?: string | null; extras?: boolean; long?: boolean } = {}): Bubble[] {
  const ar = lang === "ar";
  const lines = o.long ? Array.from({ length: 24 }, (_, i) => ({ ...LINES[i % 3]!, qty: (i % 4) + 1 })) : LINES;
  const items = lines.map((l) => `${l.qty} × ${name(l, lang)} · ${usd(l.line_total_usd)}`);
  const head = ar ? `🛒 *طلبك ${CODE}*` : `🛒 *Your order ${CODE}*`;
  const sums = [
    ar ? `الأغراض · ${usd(12.13)}` : `Items · ${usd(12.13)}`,
    ...(o.pickup ? [] : [ar ? `التوصيل لبعقلين · ${usd(1)}` : `Delivery to Baakline · ${usd(1)}`]),
    ...(o.extras ? [ar ? `مستحق من طلب ما قدرنا نسلّمو · ${usd(1.5)}` : `Owed from an order we could not deliver · ${usd(1.5)}`,
                    ar ? `رصيدك من قبل · -${usd(1.25)}` : `Your credit from before · -${usd(1.25)}`] : []),
    ar ? `*المجموع · ${usd(o.pickup ? 12.13 : o.extras ? 13.38 : 13.13)}*` : `*Total · ${usd(o.pickup ? 12.13 : o.extras ? 13.38 : 13.13)}*`,
    ar ? "أو 1,175,000 ل.ل" : "or 1,175,000 LBP",
  ];
  const where = o.pickup
    ? [ar ? "🏠 *الاستلام*" : "🏠 *Pickup*", o.pickup]
    : [ar ? "📍 *العنوان*" : "📍 *Deliver to*", ar ? "بعقلين، بيت الاختبار، الطابق 2" : "Baakline, Test house, Floor 2",
       o.window ? (ar ? "⏱️ بكرا الخميس، 10:00 لـ 12:00" : "⏱️ Tomorrow, Thursday, 10:00 to 12:00") : (ar ? "⏱️ خلال حوالي 30 دقيقة" : "⏱️ In about 30 minutes")];
  const pay = o.extras
    ? [ar ? "💵 *الدفع*" : "💵 *Payment*", ar ? "تحويل Whish، قبل ما نحضّر الطلب" : "Whish transfer, before we prepare it",
       ar ? "منبعتلك التفاصيل بعد التأكيد." : "We send the details after you confirm."]
    : [ar ? "💵 *الدفع*" : "💵 *Payment*", ar ? "كاش عند الاستلام" : "Cash on delivery"];
  const missing = [ar ? "🔁 *إذا في غرض ناقص*" : "🔁 *If an item is missing*", ar ? "منسألك قبل" : "We ask you first"];
  const consent = ar ? "_بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة._" : "_By confirming, you agree that we send updates about your orders in this chat._";
  const btn = ar ? ["✅ تأكيد الطلب", "✏️ تعديل", "❌ إلغاء"] : ["✅ Confirm order", "✏️ Edit", "❌ Cancel"];
  const tail = ["", ...sums, "", ...where, "", ...pay, "", ...missing, "", consent];
  if (o.long) {
    const n = lines.length;
    return [text([ar ? `🛒 *طلبك ${CODE}* · ${n} غرض` : `🛒 *Your order ${CODE}* · ${n} items`, "", ...items].join("\n")),
            { body: [head, ar ? `(الأغراض بالرسالة يلي فوق)` : `(the items are in the message above)`, ...tail].join("\n"), buttons: btn }];
  }
  return [{ body: [head, "", ...items, ...tail].join("\n"), buttons: btn }];
}

function cardBefore(lang: L, o: { window?: DeliveryWindow | null; pickup?: string | null; extras?: boolean; long?: boolean } = {}): Bubble[] {
  const lines = o.long ? Array.from({ length: 24 }, (_, i) => ({ ...LINES[i % 3]!, qty: (i % 4) + 1 })) : LINES;
  const quote = { ...QUOTE, lines, ...(o.pickup ? { pickup: true, delivery_fee_usd: 0, total_usd: 12.13 } : {}),
                  ...(o.extras ? { dues_usd: 1.5, credit_usd: 1.25, total_usd: 13.38 } : {}) };
  return bubbles(formatOrderCard({ orderId: ORDER, shortCode: CODE, quote, paymentMethod: o.extras ? "whish" : "cod", lang, window: o.window ?? null,
    address: lang === "ar" ? ADDRESS_AR : ADDRESS, pickupPlace: o.pickup ?? null, prepay: o.extras ? { reason: "dues" } : null }));
}

// ---------------- the screens ----------------
export function screens(): Screen[] {
  const S: Screen[] = [];
  const both = (f: (lang: L) => Bubble[]): Record<L, Bubble[]> => ({ ar: f("ar"), en: f("en") });
  const add = (key: string, title: string, why: string, before: (lang: L) => Bubble[], after: (lang: L) => Bubble[]) =>
    S.push({ key, title, why, before: both(before), after: both(after) });
  const M = (lang: L) => messages(lang);

  add("card", "The order card", "One line per item with its amount; a clear totals block; bold section headings with 🛒 📍 ⏱️ 💵 🔁; short lines. The amount now ends its item's line after « · » instead of standing on a line of its own (rule 7 changed on purpose).",
    (l) => cardBefore(l), (l) => cardAfter(l));
  add("card-window", "The order card, for a time chosen", "The time is its own line under the address, with ⏱️.",
    (l) => cardBefore(l, { window: W }), (l) => cardAfter(l, { window: W }));
  add("card-pickup", "The order card, pickup (off until the hub's place is named)", "The pickup place replaces the address; no delivery line.",
    (l) => cardBefore(l, { pickup: l === "ar" ? "مستودع ألو كينغ، بعقلين" : "the Alo King hub, Baakline" }),
    (l) => cardAfter(l, { pickup: l === "ar" ? "مستودع ألو كينغ، بعقلين" : "the Alo King hub, Baakline" }));
  add("card-extras", "The order card, with an amount owed, a credit and paid in advance", "Every amount is a line of the totals block; the advance payment is said under 💵 in two short lines.",
    (l) => cardBefore(l, { extras: true }), (l) => cardAfter(l, { extras: true }));
  add("card-long", "A long basket (two messages)", "The items go first as one message with the heading and the count; the card follows with the totals and the buttons.",
    (l) => cardBefore(l, { long: true }), (l) => cardAfter(l, { long: true }));

  add("picker", "«Which one?» (a picker)", "A WhatsApp list message: each row a product's short name, its full name and price underneath, up to ten rows. Replaces the paragraph with three cut-off buttons (the founder's chat, 08:39).",
    (l) => [them(l === "ar" ? "🎤 ... وقهوة نجار ونسكافيه please ..." : "🎤 ... and Najjar coffee and Nescafé please ..."),
            { body: M(l).basket.which(l === "ar" ? "نسكافيه" : "Nescafé", NESCAFE.map((n) => `${name(n, l)}: ${usd(n.price)}`)),
              buttons: l === "ar" ? ["1. نسكافيه قهوة سريع", "2. نسكافيه قهوة سريع"] : ["Nescafé 3in1 Clas 20g", "Nescafé Gold pouch 100g".slice(0, 20)] }],
    (l) => [them(l === "ar" ? "🎤 ... وقهوة نجار ونسكافيه please ..." : "🎤 ... and Najjar coffee and Nescafé please ..."),
            { body: l === "ar" ? "🔎 *أيّا نسكافيه بدك؟*\nعنّا نوعين. اختار من القائمة 👇" : "🔎 *Which Nescafé would you like?*\nWe have two. Choose from the list 👇",
              list: { button: l === "ar" ? "اختار" : "Choose", rows: NESCAFE.map((n) => ({ title: shortTitle(name(n, l)), description: `${name(n, l)} · ${usd(n.price)}` })) } }]);

  add("welcome", "The welcome (a first message)", "A bold greeting, what we do in one line, then how to order and the hours, each with its emoji; the privacy line in italics. The hours come from settings.hours (09:00 to 21:00 now).",
    (l) => [{ body: M(l).cx.welcome(HOURS.open, HOURS.close), buttons: [M(l).cx.orderButton, M(l).cx.areaButton] }],
    (l) => [{ body: l === "ar"
      ? "👋 *أهلا فيك بألو كينغ!*\nمنوصّلك أغراض البيت لعند بابك بالشوف.\n\n🛒 اكتبلي شو بدك، أو ابعت رسالة صوتية.\n🕘 فاتحين كل يوم من 09:00 لـ 21:00.\n\n_لمّا تراسلنا، بتوافق إنّو نحفظ رسايلك وطلباتك بس لنخدمك. فيك تكتب STOP بأي وقت لنوقّف._"
      : "👋 *Welcome to Alo King!*\nWe bring home groceries to your door in the Chouf.\n\n🛒 Tell me what you need, in writing or by voice note.\n🕘 Open every day from 09:00 to 21:00.\n\n_By writing to us you agree that we keep your messages and orders only to serve them. Write STOP at any time._",
      buttons: l === "ar" ? ["🛒 اطلب", "📍 بتوصلو لعندي؟"] : ["🛒 Order", "📍 Do you deliver?"] }]);

  const kept = (l: L) => [`3 × ${name(LINES[0]!, l)}`, `1 × ${name(LINES[1]!, l)}`];
  add("closed", "Closed hours, the order kept", "The heading says we are closed and when we open; the basket is a short list; the button is named in bold.",
    (l) => [them(l === "ar" ? "🎤 بدي كرتونة مي تنورين وقهوة نجار…" : "🎤 I want a pack of Tannourine water and Najjar coffee…"),
            { body: M(l).fixed.closedKept(HOURS.open, kept(l)), buttons: [M(l).fixed.keptButton] }],
    (l) => [them(l === "ar" ? "🎤 بدي كرتونة مي تنورين وقهوة نجار…" : "🎤 I want a pack of Tannourine water and Najjar coffee…"),
            { body: l === "ar"
      ? `🌙 *مسكّرين هلّق، منفتح الساعة 09:00*\n\n✅ طلبك محفوظ:\n${kept(l).map((x) => `• ${x}`).join("\n")}\n\nبس نفتح، اكبس *ابعت طلبي* ومنكمّل من هون.`
      : `🌙 *We're closed now and open at 09:00*\n\n✅ Your order is saved:\n${kept(l).map((x) => `• ${x}`).join("\n")}\n\nWhen we open, tap *Send my order* and we'll carry on here.`,
      buttons: l === "ar" ? ["🛒 ابعت طلبي"] : ["🛒 Send my order"] }]);
  add("closed-open", "We are open: the kept order", "Sent once when we open, inside the 24 hours.",
    (l) => [{ body: M(l).fixed.keptOpen, buttons: [M(l).fixed.keptButton] }],
    (l) => [{ body: l === "ar" ? "☀️ *صباح الخير، فتحنا*\nطلبك يلي بعتّو وكنّا مسكّرين بعدو محفوظ.\nاكبس *ابعت طلبي* ومنكمّل." : "☀️ *Good morning, we're open*\nThe order you sent while we were closed is saved.\nTap *Send my order* and we'll carry on.",
              buttons: l === "ar" ? ["🛒 ابعت طلبي"] : ["🛒 Send my order"] }]);
  add("hours", "The hours, asked", "Two short lines.",
    (l) => [text(M(l).answer.hours(HOURS.open, HOURS.close, false))],
    (l) => [text(l === "ar" ? "🕘 *فاتحين كل يوم من 09:00 لـ 21:00*\n🌙 هلّق مسكّرين. فيك تبعت طلبك ومنحفظلك ياه." : "🕘 *We're open every day, 09:00 to 21:00*\n🌙 We're closed now. Send your order and we'll keep it for you.")]);

  add("area-out", "A village we do not deliver to", "Never a list of 25 villages: we ask for the village or the location (the founder's chat, 07:38, sent all 25).",
    (l) => [them(l === "ar" ? "📍 (موقع بصيدا)" : "📍 (a pin in Saida)"),
            text(M(l).answer.outOfArea(l === "ar" ? "صيدا" : "Saida", (l === "ar" ? VILLAGES_AR : VILLAGES_EN)))],
    (l) => [them(l === "ar" ? "📍 (موقع بصيدا)" : "📍 (a pin in Saida)"),
            { body: l === "ar" ? "📍 *لهلّق ما منوصّل على صيدا*\nمنوصّل بالشوف حوالي بعقلين.\nإذا الطلب لمحلّ تاني، ابعت موقعو من الزر أو اكتب اسم الضيعة."
                                 : "📍 *We don't deliver to Saida yet*\nWe deliver in the Chouf, around Baakline.\nIf the order is for another place, send its location with the button or type the village.",
              location: l === "ar" ? "ابعت الموقع" : "Send location" }]);
  add("area-in", "A village we deliver to", "Yes, the fee and the time, one line each.",
    (l) => [text(M(l).answer.inArea(l === "ar" ? "بيت الدين" : "Beiteddine", 1.5, 30))],
    (l) => [text(l === "ar" ? "✅ *إيه، منوصّل على بيت الدين*\n🛵 التوصيل · $1.50\n⏱️ عادةً حوالي 30 دقيقة" : "✅ *Yes, we deliver to Beiteddine*\n🛵 Delivery · $1.50\n⏱️ Usually about 30 minutes")]);
  add("ask-pin", "Where to deliver (the location request)", "One heading and one line; WhatsApp's own Send location button.",
    (l) => [{ body: M(l).fixed.askPin, location: "Send location" }],
    (l) => [{ body: l === "ar" ? "📍 *وين منوصّلك؟*\nابعتلنا موقعك من الزر تحت، ومنبعتلك ورقة الطلب." : "📍 *Where should we deliver?*\nSend your location with the button below and your order card follows.",
              location: l === "ar" ? "ابعت الموقع" : "Send location" }]);
  add("pin-outside", "A location outside the area", "Says what to do next: the location again, or the village typed.",
    (l) => [{ body: M(l).fixed.pinOutside, location: "Send location" }],
    (l) => [{ body: l === "ar" ? "📍 *هالموقع برّا منطقتنا هلّق*\nإذا في غلط، ابعت الموقع من جديد، أو اكتب اسم الضيعة." : "📍 *This location is outside our area for now*\nIf that's a mistake, send the location again, or type your village.",
              location: l === "ar" ? "ابعت الموقع" : "Send location" }]);

  add("confirmed", "Order confirmed", "A bold heading with the code, what happens next with the time; the options list stays under it.",
    (l) => [{ body: M(l).tap.confirmed(CODE), list: { button: M(l).cx.choicesButton, rows: optionRows(l) } }],
    (l) => [{ body: l === "ar" ? `✅ *تأكّد طلبك ${CODE}*\nعم نحضّرو هلّق.\n⏱️ بيوصل خلال حوالي 30 دقيقة.\n\nبدك تغيّر شي؟ اختار من *خيارات* 👇`
                               : `✅ *Order ${CODE} confirmed*\nWe're preparing it now.\n⏱️ It arrives in about 30 minutes.\n\nWant to change something? Choose from *Options* 👇`,
              list: { button: l === "ar" ? "خيارات" : "Options", rows: optionRows(l) } }]);
  add("on-the-way", "On the way", "The rider's name is never shown; the amount to have ready when it is cash.",
    (l) => [text(M(l).notice.onTheWay(CODE))],
    (l) => [text(l === "ar" ? `🛵 *طلبك ${CODE} عالطريق*\n💵 حضّر ${usd(13.13)} كاش، أو 1,175,000 ل.ل.` : `🛵 *Order ${CODE} is on its way*\n💵 Please have ${usd(13.13)} ready in cash, or 1,175,000 LBP.`)]);
  add("at-door", "The rider at the door", "Short; one emoji.",
    (l) => [text(M(l).notice.riderAtDoor(CODE))],
    (l) => [text(l === "ar" ? `🛵 *الدليفري واصل لعندك*\nطلبك ${CODE} عالباب، وعم يستناك.` : `🛵 *The rider is at your door*\nOrder ${CODE} is here and waiting for you.`)]);
  add("delivered", "Delivered, asked", "Delivered, and how to say if something is missing.",
    (l) => [text(statusText({ short_code: CODE, status: "delivered", total_usd: 13.13, payment_method: "cod", is_pickup: false, eta_remaining_minutes: null }, l))],
    (l) => [text(l === "ar" ? `📦 *تسلّم طلبك ${CODE}*\nإذا في شي ناقص أو مش مزبوط، اكتبلنا هون.` : `📦 *Order ${CODE} delivered*\nIf anything is missing or wrong, write to us here.`)]);
  add("payment", "Payment received", "Today a Meta template went in Arabic inside the 24-hour window (the founder's chat, 08:45), with «9.44$ نقداً» as its amount. After: a session message in the customer's language; the template stays for outside the window only.",
    (l) => [{ body: "[template ak_payment_received_v1, Arabic]\n" + M("ar").notice.paymentReceived(CODE, "13.13$ نقداً"), template: "ak_payment_received_v1" }],
    (l) => [text(l === "ar" ? `✅ *وصلنا دفعك*\nطلبك ${CODE} · ${usd(13.13)} كاش\nشكراً إلك 🙏` : `✅ *Payment received*\nOrder ${CODE} · ${usd(13.13)} in cash\nThank you 🙏`)]);
  add("feedback", "Did it arrive all right? (the feedback question)", "Today it is Arabic only, whatever the customer's language. After: in their language, a bold question, and the two buttons with an emoji each; the thank-you in their language.",
    (l) => [{ body: FEEDBACK_TEXT.ask(CODE), buttons: ["وصل تمام ✅", "في مشكلة"] }, them("وصل تمام ✅"), text("تمام، شكراً 🙏")],
    (l) => [{ body: l === "ar" ? `📦 *وصلك طلبك ${CODE} مزبوط؟*\nإذا في شي ناقص أو مش مزبوط، اكبس *في مشكلة* وبيحكيك حدا من الفريق.` : `📦 *Did order ${CODE} arrive all right?*\nIf anything is missing or wrong, tap *A problem* and someone from the team will talk to you.`,
              buttons: l === "ar" ? ["✅ وصل تمام", "⚠️ في مشكلة"] : ["✅ All good", "⚠️ A problem"] },
            them(l === "ar" ? "✅ وصل تمام" : "✅ All good"), text(l === "ar" ? "🙏 تمام، شكراً إلك!" : "🙏 Great, thank you!")]);

  add("honest", "The honest answer (a kind we do not carry)", "PD1's words, with a bold heading; the request is noted.",
    (l) => [text(M(l).honest.notCarried([l === "ar" ? "ألواح بروتين" : "protein bars"]))],
    (l) => [text(l === "ar" ? "🔎 *لسّا ما عنّا ألواح بروتين*\nسجّلنا طلبك، ومنخبّرك إذا صار عنّا." : "🔎 *We don't carry protein bars yet*\nI've noted your request.")]);
  add("not-found", "A word we could not find", "New in CX2 (fix 1): nothing asked for is dropped in silence.",
    (l) => [them("🎤 … وكمان بدي نص كفوف"), text(l === "ar" ? "(nothing was said)" : "(nothing was said)")],
    (l) => [them("🎤 … وكمان بدي نص كفوف"),
            text(l === "ar" ? "🔎 *ما لقيت «نص كفوف» عنّا*\nإذا قصدك شي تاني، قلّي ياه بكلمات تانية." : "🔎 *I couldn't find “nos kfouf”*\nIf you meant something else, tell me in other words.")]);
  add("honest-fits", "What fits a fact asked (no sugar)", "Each item on one line with its amount, then the fact and its source under it.",
    (l) => [text([M(l).honest.fits([l === "ar" ? "سناكس" : "snacks"]), M(l).fixed.priced("Crunchy Kids Rice Cakes Apple No Added Sugar 30 g", 0.85, true), M(l).honest.closeFits].join("\n"))],
    (l) => [text(l === "ar" ? `🔎 *يلي بيناسب من السناكس*\nحسب المكتوب على العلبة:\n\n• Crunchy Kids Rice Cakes Apple 30 g · ${usd(0.85)}\n  بلا سكر مضاف (العلبة)\n\nقلّي أيّا واحد بدك وقدّيش.`
                            : `🔎 *What fits: snacks*\nBy what the pack says:\n\n• Crunchy Kids Rice Cakes Apple 30 g · ${usd(0.85)}\n  No added sugar (the pack)\n\nTell me which one and how many.`)]);

  add("reminder", "The reminder (a card not confirmed after 20 minutes)", "Names the buttons on the card above; once per order.",
    (l) => [text(M(l).notice.confirmReminder(CODE))],
    (l) => [text(l === "ar" ? `🛒 *طلبك ${CODE} بعدو ناطرك*\nاكبس *تأكيد الطلب* عالورقة يلي فوق لنبعتو، أو *تعديل* لتغيّر شي.` : `🛒 *Order ${CODE} is still waiting for you*\nTap *Confirm order* on the card above to send it, or *Edit* to change it.`)]);
  add("reopen", "A card that lapsed, and reopen", "Why, and one button that makes a new card at today's prices.",
    (l) => [{ body: M(l).notice.orderCancelled(CODE, l === "ar" ? "ما تأكّد الطلب بالوقت المحدد" : "it was not confirmed in time"), buttons: [M(l).cx.reopenButton] }],
    (l) => [{ body: l === "ar" ? `🕘 *انلغى طلبك ${CODE}*\nما تأكّد بالوقت.\nاكبس *افتح الطلب* ومنبعتلك ورقة جديدة بأسعار اليوم.` : `🕘 *Order ${CODE} was cancelled*\nIt was not confirmed in time.\nTap *Reopen order* for a new card at today's prices.`,
              buttons: l === "ar" ? ["🔁 افتح الطلب"] : ["🔁 Reopen order"] }]);

  add("minimum", "Under the minimum order", "The basket with amounts, then the minimum and what is left to add; the gap in bold.",
    (l) => [{ body: M(l).basket.minimum(5, 3.25, 1.75, [`1 × ${name(LINES[1]!, l)}`]), buttons: [M(l).basket.cancelButton] }],
    (l) => [{ body: l === "ar" ? `🛒 *طلبك أقل من الحد الأدنى*\n• 1 × ${name(LINES[1]!, l)} · ${usd(3.25)}\n\nالحد الأدنى · ${usd(5)}\n*ناقصك · ${usd(1.75)}*\n\nزيد شي، أو اختار من تحت 👇`
                               : `🛒 *Your order is under the minimum*\n• 1 × ${name(LINES[1]!, l)} · ${usd(3.25)}\n\nMinimum order · ${usd(5)}\n*Still to add · ${usd(1.75)}*\n\nAdd something, or choose below 👇`,
              buttons: l === "ar" ? ["❌ إلغاء الطلب"] : ["❌ Cancel the order"] }]);
  add("windows", "When to deliver (the times)", "A list message as today; a bold question and the button «Choose a time».",
    (l) => [bubble(formatWindowChoice(ORDER, [W, { ...W, day_offset: 2, dow: 5, date: "2026-11-20" }], { withNow: true, lang: l }))],
    (l) => [{ body: l === "ar" ? "🕘 *أيمتى بدك ياه؟*\nهيدي الأوقات يلي فينا نوصّل فيها 👇" : "🕘 *When would you like it?*\nThese are the times we can deliver 👇",
              list: { button: l === "ar" ? "اختار وقت" : "Choose a time", rows: bubble(formatWindowChoice(ORDER, [W, { ...W, day_offset: 2, dow: 5, date: "2026-11-20" }], { withNow: true, lang: l })).list!.rows } }]);
  add("person", "A person will answer (a case opened)", "Says who and when; ordering goes on.",
    (l) => [text(M(l).support.opened)],
    (l) => [text(l === "ar" ? "💬 *وصلت رسالتك لحدا من الفريق*\nرح يردّ عليك خلال دقايق.\nبهالوقت فيك تكمّل طلبك معي عادي." : "💬 *A person from our team has your message*\nThey will answer you within minutes.\nMeanwhile you can keep ordering with me as usual.")]);
  return S;
}

const VILLAGES_AR = ["عينبال", "عين وزين", "بعقلين", "بقعاتا", "جديدة الشوف", "السمقانية", "عترين", "عين قني", "بتلون", "بشتفين", "بيت الدين", "بطمة", "دير بابا", "دير دوريت", "دير القمر", "الفوارة", "غريفة", "الكحلونية", "كفرفاقود", "كفرحيم", "كفرنبرخ", "معاصر بيت الدين", "مزرعة الشوف", "المختارة", "الورهانية"];
const VILLAGES_EN = ["Ainbal", "Ain Wazein", "Baakline", "Baqaata", "Jdeidet El Chouf", "Semkanieh", "Atrine", "Ain Qeni", "Batloun", "Bchetfine", "Beiteddine", "Botmeh", "Deir Baba", "Deir Dourit", "Deir El Qamar", "Fouara", "Gharifeh", "Kahlounieh", "Kfarfakoud", "Kfarhim", "Kfarnabrakh", "Maasser Beiteddine", "Mazraat El Chouf", "Moukhtara", "Warhanieh"];

function optionRows(l: L) {
  const m = messages(l).cx;
  return [{ title: m.missingRow.best_match, description: l === "ar" ? "إذا في غرض ناقص" : "If an item is missing" },
          { title: m.missingRow.ask, description: l === "ar" ? "إذا في غرض ناقص" : "If an item is missing" },
          { title: m.missingRow.remove, description: l === "ar" ? "إذا في غرض ناقص" : "If an item is missing" },
          { title: m.exactRow, description: l === "ar" ? "الدفع كاش" : "Paying cash" }];
}

/** A list row's title: at most 24 characters, cut at a word, the size kept when it fits. */
export function shortTitle(n: string): string {
  if (n.length <= 24) return n;
  const size = /(\d+(?:[.,]\d+)?\s?(?:kg|g|ml|l|غ|ل|كغ|مل))$/u.exec(n)?.[1] ?? "";
  const room = 24 - (size ? size.length + 1 : 0);
  let head = n.slice(0, n.length - size.length).trim();
  while (head.length > room && head.includes(" ")) head = head.slice(0, head.lastIndexOf(" "));
  return (size ? `${head.slice(0, room).trim()} ${size}` : head.slice(0, 24)).trim();
}
