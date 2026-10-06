// Pure helpers for the order lifecycle (flow spec item 4): status messages, rating, cancel / substitute taps, money math for a substitute.
// No I/O. Used by kapso-brain (taps + sweep) and the order-notify function. Prices are never taken from a customer or a model.

export type Lang = "ar" | "en";

const NOTIFIABLE = new Set(["accepted", "preparing", "out_for_delivery", "delivered", "cancelled", "rejected"]);
export const isNotifiable = (status: string) => NOTIFIABLE.has(status);
/** Statuses that are recorded as handled but never messaged: the customer hears accepted (with the ETA), on the way, delivered (with the rating) and cancelled / rejected, not every kitchen step. */
export const isSilentStatus = (status: string) => status === "preparing";

type Ctx = { code: string; vendor: string; prepMin?: number | null; trackUrl?: string | null; etaMin?: number | null };

const toRad = (d: number) => (d * Math.PI) / 180;
const kmBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
type Pt = { lat: number; lng: number };
const pt = (lat: unknown, lng: unknown): Pt | null => { if (lat == null || lng == null || lat === "" || lng === "") return null; const la = Number(lat), ln = Number(lng); return Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180 && !(la === 0 && ln === 0) ? { lat: la, lng: ln } : null; };
/** Minutes until the order arrives, for the "on the way" message: straight-line distance from the driver (else the restaurant) to the customer, x1.3 for the roads, at 25 km/h
 *  (the same speed the tracking page uses), plus 3 minutes when it is still leaving the restaurant; rounded UP to 5, between 5 and 90. Null when a point is missing or it is implausibly far (never a guess). */
export function etaMinutes(o: { driverLat?: unknown; driverLng?: unknown; vendorLat?: unknown; vendorLng?: unknown; customerLat?: unknown; customerLng?: unknown }): number | null {
  const to = pt(o.customerLat, o.customerLng); if (!to) return null;
  const driver = pt(o.driverLat, o.driverLng), from = driver ?? pt(o.vendorLat, o.vendorLng); if (!from) return null;
  const km = kmBetween(from, to); if (km > 40) return null;
  const min = (km * 1.3 / 25) * 60 + (driver ? 0 : 3);
  return Math.min(90, Math.max(5, Math.ceil(min / 5) * 5));
}
export function lifecycleText(status: string, lang: Lang, o: Ctx): string {
  const c = `#${o.code}`;
  const ar = lang === "ar";
  switch (status) {
    case "accepted":
      return ar ? `✅ *${o.vendor}* قبلوا طلبك ${c}${o.prepMin ? `\n⏱ حوالي ${o.prepMin} دقيقة` : ""}\nبخبرك أول ما يصير بالطريق إلك 👑` : `✅ *${o.vendor}* accepted your order ${c}${o.prepMin ? `\n⏱ About ${o.prepMin} min` : ""}\nI'll message you when it's on the way 👑`;
    case "preparing": // not sent to customers any more (isSilentStatus); kept for the track page and tests

      return ar ? `👨‍🍳 طلبك ${c} عم يتحضّر عند *${o.vendor}*` : `👨‍🍳 Your order ${c} is being prepared at *${o.vendor}*`;
    case "out_for_delivery":
      return ar ? `🛵 طلبك ${c} بالطريق إلك!${o.etaMin ? `\n⏱ بيوصل خلال حوالي ${o.etaMin} دقيقة` : ""}${o.trackUrl ? `\n🔗 تابعه مباشرة: ${o.trackUrl}` : ""}` : `🛵 Your order ${c} is on the way!${o.etaMin ? `\n⏱ Arriving in about ${o.etaMin} min` : ""}${o.trackUrl ? `\n🔗 Track it live: ${o.trackUrl}` : ""}`;
    case "delivered":
      return ar ? `🎉 وصل طلبك ${c}! بالهنا والشفا 🙏` : `🎉 Your order ${c} has been delivered! Enjoy 🙏`;
    case "cancelled":
      return ar ? `❌ تم إلغاء طلبك ${c} من *${o.vendor}*.` : `❌ Your order ${c} from *${o.vendor}* was cancelled.`;
    case "rejected":
      return ar ? `😔 *${o.vendor}* ما قدروا يستقبلوا طلبك ${c} هلأ. خبرني وبلاقيلك بديل 🙏` : `😔 *${o.vendor}* can't take your order ${c} right now. Tell me and I'll find you an alternative 🙏`;
    default:
      return "";
  }
}

// ---- rating prompt (list message, five rows) ----
export const ratingTapId = (orderId: string, stars: number) => `RATE|${orderId}|${stars}`;
export function ratingRows(orderId: string, lang: Lang) {
  const label: Record<number, [string, string]> = { 5: ["Loved it", "ممتاز"], 4: ["Good", "منيح"], 3: ["OK", "عادي"], 2: ["Not great", "مش كتير منيح"], 1: ["Bad", "سيء"] };
  return [5, 4, 3, 2, 1].map((n) => ({ id: ratingTapId(orderId, n), title: `${"⭐".repeat(n)}`, description: label[n][lang === "ar" ? 1 : 0] }));
}

export type LifecycleTap =
  | { kind: "CANCEL" | "KEEP"; orderId: string }
  | { kind: "RATE"; orderId: string; stars: number }
  | { kind: "SUB"; offerId: string; answer: "ok" | "up" | "cancel" };
export function parseLifecycleTap(id: string): LifecycleTap | null {
  const p = id.split("|");
  if ((p[0] === "CANCEL" || p[0] === "KEEP") && p.length === 2 && p[1]) return { kind: p[0], orderId: p[1] };
  if (p[0] === "RATE" && p.length === 3 && p[1]) { const n = Number(p[2]); return Number.isInteger(n) && n >= 1 && n <= 5 ? { kind: "RATE", orderId: p[1], stars: n } : null; }
  if (p[0] === "SUB" && p.length === 3 && p[1] && (p[2] === "ok" || p[2] === "up" || p[2] === "cancel")) return { kind: "SUB", offerId: p[1], answer: p[2] };
  return null;
}

/** Free-form WhatsApp messages are only allowed within 24h of the customer's last message. */
export function windowOpen(lastInboundIso: string | null | undefined, now = Date.now()): boolean {
  const t = Date.parse(String(lastInboundIso ?? ""));
  return Number.isFinite(t) && now - t < 24 * 3600_000;
}

// ---- sold-out substitute ----
const sec = (s: string | null | undefined) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
type Cand = { item_id: string; item_name_en: string | null; item_name_ar: string | null; price_usd: number | string; section?: string | null; is_popular?: boolean | null; available?: boolean | null };
/** Same section, available, priced, not already in the order, at most 25% dearer. Closest price first, then popular. */
export function pickSubstitute(missing: { item_id: string; section?: string | null; price_usd: number | string }, candidates: Cand[], inOrder: string[]): Cand | null {
  const base = Number(missing.price_usd);
  const ok = candidates.filter((c) => c.item_id !== missing.item_id && !inOrder.includes(c.item_id) && c.available !== false && Number(c.price_usd) > 0 && sec(c.section) === sec(missing.section) && Number(c.price_usd) <= base * 1.25 + 1e-9);
  ok.sort((a, b) => Math.abs(Number(a.price_usd) - base) - Math.abs(Number(b.price_usd) - base) || Number(!!b.is_popular) - Number(!!a.is_popular));
  return ok[0] ?? null;
}

const r2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;
type Line = { item_id: string; name_en?: string | null; name_ar?: string | null; unit_price_usd: number; quantity: number; choices?: unknown[]; [k: string]: unknown };
export type Swap = { ok: true; lines: Line[]; subtotal: number; total: number; delta: number } | { ok: false; reason: string };
/** Replace one order line with a substitute priced from the database; quantity is kept; fee and COD cap are enforced. */
export function swapLine(lines: Line[], missingId: string, sub: { item_id: string; item_name_en: string | null; item_name_ar: string | null; price_usd: number }, fee: number, codCap: number): Swap {
  const i = lines.findIndex((l) => l.item_id === missingId);
  if (i < 0) return { ok: false, reason: "line not found" };
  if ((lines[i].choices ?? []).length) return { ok: false, reason: "line has options" };
  if (!(Number(sub.price_usd) > 0)) return { ok: false, reason: "substitute has no price" };
  const next = lines.map((l, k) => (k === i ? { ...l, item_id: sub.item_id, name_en: sub.item_name_en, name_ar: sub.item_name_ar, unit_price_usd: Number(sub.price_usd), calories: null, protein_grams: null } : l));
  const oldSub = r2(lines.reduce((s, l) => s + l.unit_price_usd * l.quantity, 0));
  const subtotal = r2(next.reduce((s, l) => s + l.unit_price_usd * l.quantity, 0));
  const total = r2(subtotal + fee);
  if (total > codCap) return { ok: false, reason: "over cash-on-delivery cap" };
  return { ok: true, lines: next, subtotal, total, delta: r2(subtotal - oldSub) };
}

/** A swap that raises what the customer pays needs its own explicit "Accept new total" tap (SUB|id|up); a plain swap tap can never apply it. */
export const isPriceIncrease = (newTotal: number, currentTotal: number) => r2(Number(newTotal)) > r2(Number(currentTotal));
/** One line for the order notes / the vendor message, so the kitchen sees exactly what changed. */
export function swapNote(o: { code: string; fromName: string; toName: string; oldTotal: number; newTotal: number }): string {
  return `SWAP #${o.code}: ${o.fromName} -> ${o.toName}; total ${r2(o.oldTotal).toFixed(2)} -> ${r2(o.newTotal).toFixed(2)} USD (customer accepted)`;
}

/** The "how was your order?" list message (five rows, one tap). */
export function buildRatingList(to: string, orderId: string, lang: Lang) {
  const ar = lang === "ar";
  return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive", interactive: { type: "list",
    body: { text: ar ? "كيف كانت تجربتك؟ ⭐" : "How was your order? ⭐" }, footer: { text: "Alo King 👑" },
    action: { button: ar ? "قيّم" : "Rate", sections: [{ title: ar ? "التقييم" : "Your rating", rows: ratingRows(orderId, lang) }] } } };
}

/** Delivered and the rating prompt as ONE list message (instead of a text followed by a list). */
export function buildDeliveredRatingList(to: string, orderId: string, lang: Lang, o: { code: string; vendor?: string }) {
  const ar = lang === "ar";
  const body = ar ? `🎉 وصل طلبك #${o.code}! بالهنا والشفا 🙏\n\nكيف كانت تجربتك؟ ⭐` : `🎉 Your order #${o.code} has been delivered! Enjoy 🙏\n\nHow was your order? ⭐`;
  return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive", interactive: { type: "list",
    body: { text: body.slice(0, 1024) }, footer: { text: "Alo King 👑" },
    action: { button: ar ? "قيّم" : "Rate", sections: [{ title: ar ? "التقييم" : "Your rating", rows: ratingRows(orderId, lang) }] } } };
}
