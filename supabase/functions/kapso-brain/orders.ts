// Pure helpers for the vendor order card, its taps, the customer notices and the 90 s escalation rule.
import type { Lang } from "./broadcast.ts";

export const ESCALATE_AFTER_MS = 90_000;
/** Orders older than this are never escalated (avoids messaging about stale pending rows). */
export const ESCALATE_MAX_AGE_MS = 30 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrderLine = { quantity: number; name_en: string; choices?: { option: string }[] };

/** Interactive card for the kitchen: items, total (pre-formatted USD + LBP by the caller), address, Accept / Reject. */
export function buildVendorOrderCard(to: string, o: { orderId: string; shortCode: string; customerName: string; village: string; landmark: string; lines: OrderLine[]; totalText: string; notes?: string | null }) {
  const items = o.lines.slice(0, 12).map((l) => `• ${l.quantity} × ${l.name_en}${l.choices?.length ? ` (${l.choices.map((c) => c.option).join(", ")})` : ""}`);
  if (o.lines.length > 12) items.push(`• … +${o.lines.length - 12} more`);
  const body = [
    `🛎️ *NEW ORDER #${o.shortCode}*`,
    `👤 ${o.customerName.slice(0, 60)}`,
    "",
    ...items,
    "",
    `💰 *${o.totalText}* · Cash on delivery`,
    `📍 ${o.village} — ${o.landmark}`.slice(0, 200),
    ...(o.notes ? [`📝 ${o.notes.replace(/\s+/g, " ").slice(0, 200)}`] : []),
    "",
    "Accept or reject:",
  ].join("\n").slice(0, 1024);
  return {
    messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive",
    interactive: {
      type: "button", body: { text: body }, footer: { text: "Alo King · kitchen" },
      action: { buttons: [
        { type: "reply", reply: { id: `ORDER|ACC|${o.orderId}`, title: "✅ Accept" } },
        { type: "reply", reply: { id: `ORDER|REJ|${o.orderId}`, title: "❌ Reject" } },
      ] },
    },
  };
}

export function parseOrderTap(id: string): { accept: boolean; orderId: string } | null {
  const [kind, act, orderId] = String(id ?? "").split("|");
  if (kind !== "ORDER" || (act !== "ACC" && act !== "REJ") || !UUID.test(orderId ?? "")) return null;
  return { accept: act === "ACC", orderId };
}

const T = {
  accepted: (l: Lang, code: string, vendor: string, prep?: number | null) => l === "ar"
    ? `✅ *${vendor}* قبل طلبك #${code}.${prep ? ` حوالي ${prep} دقيقة.` : ""} رح نبقيك على اطلاع 👑`
    : `✅ *${vendor}* accepted your order #${code}.${prep ? ` About ${prep} min.` : ""} We'll keep you posted. 👑`,
  rejected: (l: Lang, code: string, vendor: string) => l === "ar"
    ? `عذراً، *${vendor}* ما فيه ياخد الطلب #${code} هلأ 🙏 خبرني شو بدك وبدلك على مطبخ تاني.`
    : `Sorry, *${vendor}* can't take order #${code} right now 🙏 Tell me what you'd like and I'll find you another kitchen.`,
  stillConfirming: (l: Lang, code: string, vendor: string) => l === "ar"
    ? `⏳ طلبك #${code} لسا عم يتأكد منه *${vendor}*. نحنا عم نتابع 🙏`
    : `⏳ Order #${code} is still being confirmed by *${vendor}*. Hang tight, we're on it. 🙏`,
};
export const customerNotice = T;

export const adminPing = (code: string, vendor: string, customerMasked: string, totalText: string) =>
  `⏱️ Order #${code} at ${vendor} has had no answer for 90 s.\nCustomer ${customerMasked} · ${totalText}`;

/** Pending, not yet escalated, older than 90 s but not stale, and a real WhatsApp customer (not the web demo). */
export function needsEscalation(o: { status: string; created_at: string; escalated_at: string | null; customer_phone: string }, now = Date.now()): boolean {
  const age = now - new Date(o.created_at).getTime();
  return o.status === "pending" && !o.escalated_at && age >= ESCALATE_AFTER_MS && age <= ESCALATE_MAX_AGE_MS && /^\d{8,15}$/.test(o.customer_phone);
}
