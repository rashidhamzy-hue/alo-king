// The order card: the one message that turns a conversation into a commitment. Built from the quote, never from model text.
import { buttons, type Outbound } from "@ak/wa/kapso";

export interface QuoteLine { name: string; name_ar: string | null; qty: number; unit: string; line_total_usd: number; modifiers?: string[]; note?: string | null }
export interface Quote {
  ok: boolean; issues: { code: string; [k: string]: unknown }[]; lines: QuoteLine[];
  subtotal_usd: number; delivery_fee_usd: number; total_usd: number; fx_rate_lbp: number | null; total_lbp: number | null;
  eta_minutes: number | null; pickup: boolean; village: string | null; village_ar: string | null; village_id: string | null;
}
export interface CardInput { orderId: string; shortCode: string; quote: Quote; paymentMethod: "cod" | "whish" | "omt"; changeForUsd?: number | null }

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

const BODY_LIMIT = 1024;   // WhatsApp's limit for an interactive message body

export function formatOrderCard(input: CardInput): Outbound {
  const { quote: q } = input;
  const head = [`طلبك ${input.shortCode}`];
  const tail: string[] = [];
  tail.push(`المجموع الفرعي: ${money(q.subtotal_usd)}`);
  if (!q.pickup) tail.push(`التوصيل${q.village_ar ? ` (${q.village_ar})` : ""}: ${money(q.delivery_fee_usd)}`);
  tail.push(`الإجمالي: ${money(q.total_usd)}${q.total_lbp ? ` أو ${lbp(q.total_lbp)}` : ""}`);
  tail.push(q.pickup ? "استلام من المحل" : q.eta_minutes ? `الوصول خلال حوالي ${q.eta_minutes} دقيقة` : "توصيل");
  tail.push(`الدفع: ${PAY[input.paymentMethod]}`);
  if (input.changeForUsd) tail.push(`الصرافة: منجيب معنا فراطة لـ ${money(input.changeForUsd)}`);
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

/** Fixed replies to the three buttons. Deterministic text, no model. */
export function buttonReplyText(r: { status: string; short_code: string; changed: boolean; payment_method?: string; total_usd?: number },
                                transferTo: { whish?: string; omt?: string } = {}): string {
  switch (r.status) {
    case "confirmed": return `تم تأكيد طلبك ${r.short_code} ✅ عم نحضّرو هلق.`;
    case "awaiting_payment": {
      const ch = r.payment_method === "omt" ? `OMT${transferTo.omt ? ` على ${transferTo.omt}` : ""}` : `Whish${transferTo.whish ? ` على ${transferTo.whish}` : ""}`;
      return `تم حجز طلبك ${r.short_code}. حوّل ${money(r.total_usd ?? 0)} عبر ${ch} وابعت صورة الإيصال هون لنبلّش بالتحضير.`;
    }
    case "draft": return `تمام، شو بتحب تغيّر بطلب ${r.short_code}؟`;
    case "cancelled": return `تم إلغاء طلب ${r.short_code}.`;
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
  askPin: "تمام، طلبك جاهز. بس بعتلنا موقعك 📍 من الزر تحت لنبعتلك ورقة الطلب.",
};
