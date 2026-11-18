// WH1a: what the warehouse pages share (purchase orders, receiving, bins, the temperature log, Stock's lots): the hub, plain words for the
// database's refusals in the staff member's language, units and zones in words, and the form's one-time key.
import { attempt, flashRedirect, UserError, type Ctx } from "../app";
import { DbError } from "../db";
import { pick, type Lang } from "../i18n";

export async function hubId(c: Ctx): Promise<string> {
  const s = (await c.deps.db.rows<{ id: string }>("sources", { select: "id", where: { kind: "dark_store" }, order: [{ col: "id" }], limit: 1 }))[0];
  if (!s) throw new UserError(pick(c.lang, "There is no hub (dark store) in the database.", "لا يوجد مستودع في قاعدة البيانات."));
  return s.id;
}

/** The form's one-time key (html.ts puts one in every form), so a double tap is one action. */
export const formKey = (c: Ctx, prefix = "console") => { const k = (c.form._key ?? "").replace(/[^A-Za-z0-9_-]/g, ""); return k.length >= 8 ? `${prefix}:${k}` : null; };

export const ZONES = ["ambient", "fresh", "chilled", "frozen"] as const;
const ZONE_WORDS: Record<string, [string, string]> = { ambient: ["Ambient", "عادي"], fresh: ["Fresh", "طازج"], chilled: ["Chilled", "مبرّد"], frozen: ["Frozen", "مجمّد"] };
export const zoneWord = (L: Lang, z: string) => { const w = ZONE_WORDS[z]; return w ? pick(L, w[0], w[1]) : z; };
const UNIT_WORDS: Record<string, [string, string]> = { each: ["each", "حبّة"], piece: ["piece", "حبّة"], kg: ["kg", "كغ"], g: ["g", "غ"], l: ["L", "ل"], pack: ["pack", "علبة"] };
export const unitWord = (L: Lang, u: string | null | undefined) => { const w = UNIT_WORDS[(u ?? "each").toLowerCase()]; return w ? pick(L, w[0], w[1]) : (u ?? ""); };
export const qty = (v: number | string | null | undefined) => String(Math.round(Number(v ?? 0) * 1000) / 1000);

/** The day in the hub's time zone, as YYYY-MM-DD, n days from now. */
export const hubDay = (now: Date, n = 0) => new Date(now.getTime() + n * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Beirut" });

/** Plain words for the warehouse functions' refusals (0236 to 0240, and receive_goods and adjust_stock under them). The database decides. */
export function plain(L: Lang, e: unknown): unknown {
  if (!(e instanceof DbError)) return e;
  const m = e.message;
  const say = (en: string, ar: string) => new UserError(pick(L, en, ar));
  const name = (re: RegExp) => (re.exec(m)?.[1] ?? "").trim();
  if (/^NOT_AUTHORISED/.test(m)) return say("Your role cannot do this.", "دورك لا يسمح بهذا.");
  if (/^NO_LINES/.test(m)) return say("Add at least one item.", "أضف صنفاً واحداً على الأقل.");
  if (/^BAD_QTY/.test(m)) return say("Type a quantity above zero (and not more than the lot holds).", "اكتب كمية أكبر من صفر (ولا تتجاوز ما في الدفعة).");
  if (/^DUPLICATE_ITEM/.test(m)) return say(`${name(/^DUPLICATE_ITEM (.*)$/)} is on the order twice: put it on one line.`, `${name(/^DUPLICATE_ITEM (.*)$/)} مكرّر في الطلب: اجعله في سطر واحد.`);
  if (/^EXPECTED_DATE_REQUIRED/.test(m)) return say("Choose the day you expect the goods.", "اختر اليوم الذي تتوقّع فيه البضاعة.");
  if (/^EXPECTED_DATE_PAST/.test(m)) return say("The expected day is in the past.", "اليوم المتوقّع مضى.");
  if (/^UNKNOWN_SUPPLIER/.test(m)) return say("That supplier is not active.", "هذا المورّد غير فعّال.");
  if (/^NOT_A_HUB_ITEM/.test(m)) return say("A restaurant's dish is never on a purchase order.", "طبق المطعم لا يدخل في طلب شراء.");
  if (/^REASON_REQUIRED/.test(m)) return say("Write the reason (at least 3 characters).", "اكتب السبب (3 أحرف على الأقل).");
  if (/^PO_CANCELLED/.test(m)) return say("This purchase order was cancelled.", "أُلغي طلب الشراء هذا.");
  if (/^PO_NOT_OPEN/.test(m)) return say("This purchase order is no longer open.", "طلب الشراء هذا لم يعد مفتوحاً.");
  if (/^LINE_NOT_COUNTED/.test(m)) return say(`Count every line, even if none came (type 0): ${name(/^LINE_NOT_COUNTED (.*)$/)}.`, `عُدّ كل سطر، حتى لو لم يصل شيء (اكتب 0): ${name(/^LINE_NOT_COUNTED (.*)$/)}.`);
  if (/^BAD_COUNT/.test(m)) return say("Type a count of zero or more.", "اكتب عدداً صفراً أو أكثر.");
  if (/^BAD_DAMAGED/.test(m)) return say(`Damaged cannot be more than came: ${name(/^BAD_DAMAGED (.*)$/)}.`, `التالف لا يمكن أن يزيد عمّا وصل: ${name(/^BAD_DAMAGED (.*)$/)}.`);
  if (/^COST_REQUIRED/.test(m)) return say(`Type the unit cost from the invoice: ${name(/^COST_REQUIRED (.*)$/)}.`, `اكتب سعر الوحدة من الفاتورة: ${name(/^COST_REQUIRED (.*)$/)}.`);
  if (/^EXPIRY_REQUIRED/.test(m)) return say(`Chilled, frozen and fresh goods need their expiry date: ${name(/^EXPIRY_REQUIRED (.*) is/)}.`, `المبرّد والمجمّد والطازج يحتاج تاريخ انتهاء الصلاحية: ${name(/^EXPIRY_REQUIRED (.*) is/)}.`);
  if (/^EXPIRED_ON_ARRIVAL/.test(m)) return say("That date has passed: expired goods are not received. Count them as damaged.", "هذا التاريخ مضى: لا تُستلم بضاعة منتهية الصلاحية. سجّلها تالفة.");
  if (/^SUPPLIER_REF_USED/.test(m)) return say("That invoice number was already used for another delivery from this supplier.", "رقم الفاتورة هذا استُعمل لتسليم آخر من هذا المورّد.");
  if (/^NEEDS_OPS_LEAD to pay from the till/.test(m)) return say("Only the ops lead pays from the drawer. Receive it on credit.", "مسؤول العمليات وحده يدفع من الصندوق. استلمها بالدَّين.");
  if (/^NEEDS_OPS_LEAD/.test(m)) return say("Above the picker limit: an ops lead must make this change.", "فوق حدّ المجهّز: يجب أن يقوم مسؤول العمليات بهذا التغيير.");
  if (/^NOT_ENOUGH_CASH hub_cash/.test(m)) return say("The drawer does not hold that much by the books. Count it, and check what came in today.", "الصندوق لا يحوي هذا المبلغ حسب الدفاتر. عُدّه وراجع ما دخل اليوم.");
  if (/^BELOW_RESERVED/.test(m)) return say("That would leave less on the shelf than is reserved for open orders.", "هذا يترك على الرف أقل ممّا هو محجوز لطلبات مفتوحة.");
  if (/^UNKNOWN_LOT/.test(m)) return say("That lot was not found.", "لم يُعثر على هذه الدفعة.");
  if (/^UNKNOWN_REASON/.test(m)) return say("Choose a reason from the list.", "اختر سبباً من القائمة.");
  if (/^BIN_CODE/.test(m)) return say("A bin code is letters, digits and a dash, up to 12 (A1, C-02).", "رمز الرف أحرف وأرقام وشرطة، حتى 12 (A1، C-02).");
  if (/^BIN_EXISTS/.test(m)) return say("A bin with that code already exists.", "يوجد رف بهذا الرمز.");
  if (/^BIN_ZONE the item is (\w+), the bin is (\w+)/.test(m)) { const [, a, b] = /^BIN_ZONE the item is (\w+), the bin is (\w+)/.exec(m)!; return say(`The item is ${zoneWord("en", a!).toLowerCase()} and the bin is ${zoneWord("en", b!).toLowerCase()}: choose a bin in the item's own zone.`, `الصنف ${zoneWord("ar", a!)} والرف ${zoneWord("ar", b!)}: اختر رفاً في منطقة الصنف نفسها.`); }
  if (/^UNKNOWN_BIN/.test(m)) return say("That bin was not found.", "لم يُعثر على هذا الرف.");
  if (/^UNKNOWN_ZONE/.test(m)) return say("That zone has no log.", "لا سجلّ لهذه المنطقة.");
  if (/^PHOTO_REQUIRED/.test(m)) return say("Take the photo of the thermometer first.", "التقط صورة ميزان الحرارة أولاً.");
  if (/^BAD_READING/.test(m)) return say("Type the number the thermometer shows (between −40 and 60).", "اكتب الرقم الذي يظهره ميزان الحرارة (بين −40 و60).");
  if (/^LOT_EXPIRED/.test(m)) return say("Only an expired lot is left: mark the line missing, and write the lot off on the Stock page.", "لم يبقَ إلا دفعة منتهية الصلاحية: سجّل البند ناقصاً، وأتلف الدفعة من صفحة المخزون.");
  return e;
}

/** One action: logged first, the SQL called, logged again; the message in the staff member's language. */
export async function doAct(c: Ctx, action: string, args: Record<string, unknown>, back: string, run: () => Promise<{ msg: string; to?: string }>): Promise<Response> {
  let to = back;
  const r = await attempt(c, action, args, async () => {
    try { const x = await run(); if (x.to) to = x.to; return x.msg; } catch (e) { throw plain(c.lang, e); }
  });
  return flashRedirect(c.deps, r.logged && r.ok ? to : back, r.logged ? r.msg : { err: pick(c.lang, "Not done: the action log could not be written. Try again in a minute.", "لم يتم: تعذّر تسجيل الإجراء. حاول بعد دقيقة.") });
}
