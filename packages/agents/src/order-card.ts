// The order card: the one message that turns a conversation into a commitment. Built from the quote, never from model text.
import { buttons, list, type Outbound } from "@ak/wa/kapso";

export interface QuoteLine { name: string; name_ar: string | null; qty: number; unit: string; line_total_usd: number; modifiers?: string[]; note?: string | null }
export interface Quote {
  ok: boolean; issues: { code: string; [k: string]: unknown }[]; lines: QuoteLine[];
  subtotal_usd: number; delivery_fee_usd: number; total_usd: number; fx_rate_lbp: number | null; total_lbp: number | null;
  eta_minutes: number | null; pickup: boolean; village: string | null; village_ar: string | null; village_id: string | null;
  /** Owed from an earlier delivery nobody answered (fee, cooked food). Set by create_order_from_quote; included in total_usd. */
  dues_usd?: number;
  /** Company income on a small basket (1.16): its own line, never part of the rider's delivery fee. Included in total_usd. */
  small_order_fee_usd?: number;
  /** What we owed the customer, taken off this order (apply_customer_credit, C2's request). Already taken off total_usd. */
  credit_usd?: number;
  /** W1 (0118): quoted for a window (quote_order with a slot): the window, and whether a line is bought for the order (fresh). */
  slot_id?: string | null; window?: DeliveryWindow | null; bought_to_order?: boolean;
}
/** A delivery window as the database gives it (window_json, migration 0040): the hub's local date and times, never computed here. */
export interface DeliveryWindow { slot_id: string; date: string; dow: number; day_offset: number; starts: string; ends: string }
export interface CardInput { orderId: string; shortCode: string; quote: Quote; paymentMethod: "cod" | "whish" | "omt"; changeForUsd?: number | null;
  /** Why cash on delivery was refused and the order is paid in advance (from create_order_from_quote's issues). */
  prepay?: { reason: "dues" } | { reason: "first_order"; maxCodUsd: number } | null;
  /** 2.8: the window the customer chose (request_delivery_window). Absent: deliver now. */
  window?: DeliveryWindow | null;
  /** 2.8: this card changes an order already confirmed (link_replacement_order): its short code. */
  replaces?: string | null }

const money = (n: number) => `$${Number(n).toFixed(2)}`;
const lbp = (n: number) => `${Math.round(n).toLocaleString("en-US")} ل.ل`;
const qty = (q: number) => (Number.isInteger(q) ? String(q) : String(q));
const PAY: Record<CardInput["paymentMethod"], string> = { cod: "كاش عند التسليم", whish: "تحويل Whish", omt: "تحويل OMT" };
export const CONSENT_LINE = "بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة.";
export const orderButtonId = (action: "confirm" | "edit" | "cancel", orderId: string) => `order:${action}:${orderId}`;
export function parseOrderButton(id: string): { action: "confirm" | "edit" | "cancel"; orderId: string } | null {
  const m = /^order:(confirm|edit|cancel):([0-9a-f-]{36})$/.exec(id);
  return m ? { action: m[1] as "confirm" | "edit" | "cancel", orderId: m[2]! } : null;
}

/** K1: the button under the "we're closed, your order is kept" message. Tapped once we are open, it carries the kept basket on. */
export const KEPT_BUTTON = "kept:send";

export const pinVillageButtonId = (villageId: string) => `pinvillage:${villageId}`;
export function parsePinVillageButton(id: string): string | null {
  const m = /^pinvillage:([0-9a-f-]{36})$/.exec(id);
  return m ? m[1]! : null;
}

// 2.8: the windows a card may offer, one list row each. The database lists only open windows with room (open_delivery_windows).
// W1: a row for the basket in hand (no order yet: after hours, or before the pin) has orderId null, "basket" in the id.
export const windowButtonId = (slotId: string | "now", orderId: string | null) => `slot:${slotId}:${orderId ?? "basket"}`;
export function parseWindowButton(id: string): { slotId: string | null; orderId: string | null } | null {
  const m = /^slot:([0-9a-f-]{36}|now):([0-9a-f-]{36}|basket)$/.exec(id);
  return m ? { slotId: m[1] === "now" ? null : m[1]!, orderId: m[2] === "basket" ? null : m[2]! } : null;
}
const DAY_AR = ["", "الاتنين", "التلاتا", "الأربعا", "الخميس", "الجمعة", "السبت", "الأحد"];
/** «بكرا 10:00-12:00», «الجمعة 21/11، 10:00-12:00». From the database's local date and times; no clock or time zone here. */
export function windowLabel(w: DeliveryWindow): string {
  const [, mm, dd] = w.date.split("-");
  const day = w.day_offset === 0 ? "اليوم" : w.day_offset === 1 ? "بكرا" : `${DAY_AR[w.dow] ?? ""} ${Number(dd)}/${Number(mm)}،`;
  return `${day} ${w.starts}-${w.ends}`;
}

/** A list row: WhatsApp cuts a row title at 24 characters, so a longer label puts the times in the row's description (W1). */
export function windowRow(w: DeliveryWindow): { title: string; description?: string } {
  const label = windowLabel(w);
  if (label.length <= ROW_TITLE_LIMIT) return { title: label };
  return { title: label.slice(0, label.length - `${w.starts}-${w.ends}`.length).replace(/[،\s]+$/u, ""), description: `${w.starts}-${w.ends}` };
}
const ROW_TITLE_LIMIT = 24;   // WhatsApp's limit for a list row title

const BODY_LIMIT = 1024;   // WhatsApp's limit for an interactive message body

export const CARD_TEXT = {
  duesLine: "مستحق من طلب سابق ما قدرنا نسلّمو",
  creditLine: "رصيد إلك من قبل",
  smallOrderLine: "رسم الطلبات الصغيرة",
  prepayFirst: (how: string, cap: string) => `أول طلب كاش لحدّ ${cap}. هالطلب أكبر، فبينّدفع سلف (${how}) قبل ما نبلّش بالتحضير. بعد التأكيد منبعتلك التفاصيل.`,
  prepay: (how: string) => `بما إنو في مبلغ مستحق من قبل، هالطلب بينّدفع سلف (${how}) قبل ما نبلّش بالتحضير. بعد التأكيد منبعتلك التفاصيل.`,
  /** 2.8 */
  windowLine: "التوصيل",
  replaces: (code: string) => `هالورقة بتحلّ محل طلبك ${code}. ما بيتغيّر شي قبل ما تأكّدها.`,
  chooseWindow: "أيمتى بدك ياه؟ هيدي الأوقات يلي فينا نوصّل فيها:",
  windowButton: "اختار الوقت",
  now: "هلّق (أقرب وقت)",
  noWindow: "ما في أوقات فاضية للتوصيل بالأيام الجاية. فيك تطلب هلّق، أو تكتبلنا ومنشوف.",
  /** W1 */
  windowGone: "الوقت يلي اخترتو ما بقى متوفّر. هيدي الأوقات يلي فينا نوصّل فيها:",
  noneAt: "ما في وقت فاضي للتوصيل متل ما طلبت. هيدي الأوقات يلي فينا نوصّل فيها:",
  noneAtAll: "ما في أوقات للتوصيل بوقت محدّد بالأيام الجاية.",
  nowUnavailable: "ما فينا نوصّل هالطلب هلّق. اختار وقت للتوصيل:",
  orChoose: "أو اختار من هون وقت للتوصيل:",
  freshForWindow: (names: string[]) => `${names.join("، ")} منجيبن طازة عالطلب، فبيوصلو بوقت محدّد. اختار الوقت:`,
  pickupNoWindow: "الاستلام من المحل ما إلو وقت محدّد: فيك تمرق وقت الدوام.",
  restaurantNoWindow: "طلبات المطاعم ما إلها وقت محدّد هلّق: بتوصل لما تجهز.",
  notChangeable: (code: string) => `طلبك ${code} تأكّد وما عاد فينا نغيّر وقتو من هون. إذا في شي ضروري اكتبلنا.`,
};

/** 2.8: the open windows as a list (at most ten rows; the database never lists a full one). `withNow` adds "now" as a row. */
export function formatWindowChoice(orderId: string | null, windows: DeliveryWindow[], opts: { withNow?: boolean; body?: string } = {}): Outbound {
  if (windows.length === 0) return { type: "text", text: { body: CARD_TEXT.noWindow } };
  const rows = [...(opts.withNow ? [{ id: windowButtonId("now", orderId), title: CARD_TEXT.now }] : []),
                ...windows.map((w) => ({ id: windowButtonId(w.slot_id, orderId), ...windowRow(w) }))];
  return list(opts.body ?? CARD_TEXT.chooseWindow, CARD_TEXT.windowButton, rows.slice(0, 10));
}

export function formatOrderCard(input: CardInput): Outbound {
  const { quote: q } = input;
  const head = [`طلبك ${input.shortCode}`];
  const tail: string[] = [];
  const dues = Number(q.dues_usd ?? 0);
  tail.push(`المجموع الفرعي: ${money(q.subtotal_usd)}`);
  if (!q.pickup) tail.push(`التوصيل${q.village_ar ? ` (${q.village_ar})` : ""}: ${money(q.delivery_fee_usd)}`);
  const small = Number(q.small_order_fee_usd ?? 0);
  if (small > 0) tail.push(`${CARD_TEXT.smallOrderLine}: ${money(small)}`);
  // What is owed from a delivery nobody answered is its own line, so the total adds up on the card (1.4).
  if (dues > 0) tail.push(`${CARD_TEXT.duesLine}: ${money(dues)}`);
  // What we owed them, taken off this order, on its own line so the card still adds up (C2's request).
  const credit = Number(q.credit_usd ?? 0);
  if (credit > 0) tail.push(`${CARD_TEXT.creditLine}: -${money(credit)}`);
  tail.push(`الإجمالي: ${money(q.total_usd)}${q.total_lbp ? ` أو ${lbp(q.total_lbp)}` : ""}`);
  tail.push(q.pickup ? "استلام من المحل" : input.window ? `${CARD_TEXT.windowLine}: ${windowLabel(input.window)}`
                    : q.eta_minutes ? `الوصول خلال حوالي ${q.eta_minutes} دقيقة` : "توصيل");
  tail.push(`الدفع: ${PAY[input.paymentMethod]}`);
  // Policy (0004): someone who owes pays the next order in advance. Say so on the card, before the tap, not after.
  if (input.paymentMethod !== "cod" && input.prepay?.reason === "first_order") tail.push(CARD_TEXT.prepayFirst(PAY[input.paymentMethod], money(input.prepay.maxCodUsd)));
  else if (dues > 0 && input.paymentMethod !== "cod") tail.push(CARD_TEXT.prepay(PAY[input.paymentMethod]));
  if (input.changeForUsd && input.paymentMethod === "cod") tail.push(`الصرافة: منجيب معنا فراطة لـ ${money(input.changeForUsd)}`);
  if (input.replaces) tail.push(CARD_TEXT.replaces(input.replaces));
  tail.push("", CONSENT_LINE);

  const itemLines = q.lines.map((l) => {
    const extras = [...(l.modifiers ?? []), ...(l.note ? [l.note] : [])];
    return `• ${qty(l.qty)} × ${l.name_ar ?? l.name}${extras.length ? ` (${extras.join("، ")})` : ""} — ${money(l.line_total_usd)}`;
  });
  // Never let a long basket push the totals or the consent line out of the message.
  const fixed = [...head, "", ...tail].join("\n").length + 2;
  const shown: string[] = [];
  let used = fixed;
  for (let i = 0; i < itemLines.length; i++) {
    const more = `… و${itemLines.length - i} أغراض تانية`;
    if (used + itemLines[i]!.length + 1 + (i < itemLines.length - 1 ? more.length + 1 : 0) > BODY_LIMIT) { shown.push(more); break; }
    shown.push(itemLines[i]!); used += itemLines[i]!.length + 1;
  }
  const body = [...head, ...shown, "", ...tail].join("\n");
  return buttons(body, [
    { id: orderButtonId("confirm", input.orderId), title: "تأكيد الطلب" },
    { id: orderButtonId("edit", input.orderId), title: "تعديل" },
    { id: orderButtonId("cancel", input.orderId), title: "إلغاء" },
  ]);
}

/** Fixed replies to the three buttons. Deterministic text, no model. 2.8 adds the window and the scheduled-order answers. */
export function buttonReplyText(r: { status: string; short_code: string; changed: boolean; payment_method?: string; total_usd?: number;
                                     window?: DeliveryWindow | null; replaces?: string; credit_usd?: number },
                                transferTo: { whish?: string; omt?: string } = {}): string {
  const when = r.window ? windowLabel(r.window) : null;
  switch (r.status) {
    case "confirmed":
      if (r.replaces && when) return `تم التعديل ✅ طلبك ${r.short_code} بدل ${r.replaces}، والتوصيل ${when}.`;
      return when ? `تم تأكيد طلبك ${r.short_code} ✅ التوصيل ${when}.` : `تم تأكيد طلبك ${r.short_code} ✅ عم نحضّرو هلق.`;
    case "awaiting_payment": {
      const ch = r.payment_method === "omt" ? `OMT${transferTo.omt ? ` على ${transferTo.omt}` : ""}` : `Whish${transferTo.whish ? ` على ${transferTo.whish}` : ""}`;
      return `تم حجز طلبك ${r.short_code}${when ? ` للتوصيل ${when}` : ""}. حوّل ${money(r.total_usd ?? 0)} عبر ${ch} وابعت صورة الإيصال هون لنبلّش بالتحضير.`;
    }
    case "draft": return `تمام، شو بتحب تغيّر بطلب ${r.short_code}؟`;
    case "cancelled": return `تم إلغاء طلب ${r.short_code}.${Number(r.credit_usd ?? 0) > 0 ? ` المبلغ يلي دفعتو (${money(r.credit_usd!)}) صار رصيد إلك، منرجّعلك ياه أو منحسمو من طلبك الجاي.` : ""}`;
    case "slot_full": return `الوقت يلي اخترتو${when ? ` (${when})` : ""} امتلى قبل ما تأكّد، فما ثبّتنا الطلب ${r.short_code}. اختار وقت تاني أو اكتبلنا.`;
    case "slot_closed": return `ما عاد فينا نوصّل${when ? ` ${when}` : " بهالوقت"}: فات آخر وقت للطلب، فما ثبّتنا الطلب ${r.short_code}. اختار وقت تاني أو اكتبلنا.`;
    case "change_open": return `تمام، شو بتحب تغيّر بطلب ${r.short_code}${when ? ` (${when})` : ""}؟ منبعتلك ورقة جديدة، وما بيتغيّر شي قبل ما تأكّدها.`;
    case "too_late":
    case "change_too_late": return `فات آخر وقت لتغيير طلب ${r.short_code}${when ? ` (${when})` : ""} أو إلغائو من هون. إذا في شي ضروري اكتبلنا ومنشوف.`;
    default: return `طلبك ${r.short_code} صار قيد التنفيذ وما بقى فينا نعدّلو من هون. إذا في شي ضروري اكتبلنا.`;
  }
}

export const FIXED = {
  audioUnusable: "ما قدرت اسمع التسجيل منيح. فيك تعيدو أو تكتبلي الطلب؟",
  handoff: "رح يتواصل معك حدا من فريقنا بأقرب وقت.",
  optOut: "تم. ما رح نبعتلك رسائل بعد اليوم. إذا بدك تطلب، بس اكتبلنا.",
  optIn: "تم تفعيل العروض. شكراً!",
  outOfStock: "عفواً، في غرض خلص قبل ما نأكّد الطلب. بعتلي شو بتحب بدالو أو شيلو من الطلب.",
  error: "صار في مشكلة صغيرة من عنا. رح يتواصل معك حدا من الفريق.",
  notAvailable: (shops: string[]) => shops.length
    ? `${shops.join(" و")} مش متوفّر بعد على ألو كينغ، فما فينا ناخد طلب منو هلّق.`
    : "هالمحل مش متوفّر بعد على ألو كينغ، فما فينا ناخد طلب منو هلّق.",
  oneMoment: "لحظة صغيرة وبرجعلك 🙏",
  /** 1.18: anything unrelated to ordering, delivery or an order. One friendly line, then back to the job. */
  offTopic: "أنا هون بس لطلبات ألو كينغ: أغراض، توصيل، ووين صار طلبك. شو بتحب تطلب؟",
  askPhone: "قبل ما نبعتلك ورقة الطلب: شو رقم التلفون يلي فيه السائق يتّصل فيك عليه؟",
  badPhone: "الرقم مش واضح معي. فيك تبعتو هيك: 03123456 أو +9613123456؟",
  phoneSaved: "تمام، سجّلنا الرقم. شو بتحب تطلب؟",
  askPin: "تمام، طلبك جاهز. بس بعتلنا موقعك 📍 من الزر تحت لنبعتلك ورقة الطلب.",
  /** B4: a first delivery to a new place. The pin is in; the rider needs the house and the floor. The card waits for them. */
  askAddress: (villageAr: string) => `التوصيل على ${villageAr}. كرمال السائق: شو اسم البيت أو البناية، وأي طابق؟`,
  pinReceived: "وصلنا موقعك 📍",
  /** B4: the pin decides the village. Said when the customer had written another one. */
  pinVillage: (pinAr: string, saidAr: string) => `📍 الموقع اللي بعتّو بمنطقة ${pinAr}، مش ${saidAr}، فالتوصيل على ${pinAr}.`,
  /** B4: the pin is between villages. The customer taps the right one; nobody guesses. */
  askVillage: "📍 الموقع اللي بعتّو بين كذا ضيعة. وين بالزبط؟",
  /** B4: no village we know is near the pin. */
  pinOutside: "📍 هالموقع برّا المناطق يلي منوصل عليها هلّق. إذا في غلط، ابعت الموقع من جديد من الزر.",
  pinSaved: (villageAr: string) => `تمام، سجّلنا موقعك${villageAr ? ` (${villageAr})` : ""} 📍 شو بتحب تطلب؟`,
  /** D1 (3.8): the rate moved more than the allowed step today and waits for a person; nothing is priced until then. */
  fxPaused: "عم نحدّث سعر الصرف هلّق، فما فينا نسعّر الطلب هالدقيقة. طلبك محفوظ: ابعتلنا «تمام» بعد شوي ومنبعتلك الورقة.",
  pinVillageRefused: "ما قدرنا نعتمد هالضيعة لهالموقع. ابعت الموقع من جديد من الزر 📍",
  /** K1 (B4's leftover): an order after closing time is kept, never lost, and the customer is told when we open. No promise to send. */
  closedKept: (opens: string) => `مسكّرين هلّق، منفتح الساعة ${opens}. طلبك محفوظ: بس نفتح اكبس «ابعت طلبي» ومنكمّل من هون.`,
  closedKeptPin: (opens: string) => `وصلنا موقعك 📍 بس نحنا مسكّرين هلّق، منفتح الساعة ${opens}. طلبك محفوظ: بس نفتح اكبس «ابعت طلبي» ومنكمّل.`,
  keptButton: "ابعت طلبي",
  /** Audit item 4: sent once when we open, to someone whose order was kept overnight and who wrote to us within 23 hours. */
  keptOpen: "صباح الخير ☀️ فتحنا. طلبك يلي بعتّو وكنّا مسكّرين بعدو محفوظ: اكبس «ابعت طلبي» ومنكمّل.",
  /** The kept basket is gone (a newer order replaced it). Said plainly; the customer is not asked to retype what we still hold. */
  keptGone: "ما في طلب محفوظ هلّق. شو بتحب تطلب؟",
};
