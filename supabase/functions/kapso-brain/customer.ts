// Pure helpers for the customer side: acquisition source, greetings / reorder requests, the reorder card.
import type { Lang } from "./broadcast.ts";

export type Acquisition = { source: "ctwa" | "qr"; ref: Record<string, string | null> };

const clip = (v: unknown, n: number) => (v == null ? null : String(v).slice(0, n));

/** Click-to-WhatsApp: the first inbound message of an ad click carries a `referral` object. */
export function parseReferral(m: any): Acquisition | null {
  const r = m?.referral;
  if (!r || typeof r !== "object") return null;
  if (!r.source_id && !r.ctwa_clid && !r.source_url) return null;
  return { source: "ctwa", ref: { source_type: clip(r.source_type, 20), source_id: clip(r.source_id, 64), source_url: clip(r.source_url, 300), headline: clip(r.headline, 200), ctwa_clid: clip(r.ctwa_clid, 300) } };
}

const QR = /^(ORDER|EXPRESS|REORDER)_([A-Z0-9]{2,16})_([A-Z0-9]{2,32})(?:_([A-Z0-9]{1,16}))?$/i;
/** QR deep links pre-fill `ORDER_<VILLAGE>_<MERCHANT>_<TABLE>` (also EXPRESS_… pickup, REORDER_… bag sticker). */
export function parseQrText(text: string): Acquisition | null {
  const t = String(text ?? "").trim();
  const m = t.match(QR);
  if (!m) return null;
  return { source: "qr", ref: { code: t.toUpperCase(), kind: m[1].toUpperCase(), village: m[2].toUpperCase(), merchant: m[3].toUpperCase(), location: m[4]?.toUpperCase() ?? null } };
}

const GREETING = /^\s*(hi|hello|hey|hola|bonjour|salut|good (morning|evening|afternoon)|marhaba|mar7aba|ahla|ahlan|salam|مرحبا|مرحباً|مرحبتين|أهلا|اهلا|أهلاً|هلا|هلّا|سلام|السلام عليكم|صباح الخير|مساء الخير)\s*[!.،,؟?]*\s*$/i;
export const isGreeting = (s: string) => GREETING.test(String(s ?? ""));
const REORDER = /^\s*(reorder|re-order|same( order)?( again)?|order (the )?same( again)?|repeat( my)?( last)?( order)?|نفس الطلب|اطلب نفس الطلب|كرر الطلب|عيد الطلب)\s*[!.،,؟?]*\s*$/i;
export const isReorderRequest = (s: string) => REORDER.test(String(s ?? ""));

export type PastLine = { quantity: number; name_en: string };
/** "Welcome back" card with a one-tap reorder. No prices here: the summary after the tap is re-priced by the server. */
export function buildReorderCard(to: string, lang: Lang, o: { orderId: string; vendorId: string; vendorName: string; lines: PastLine[] }) {
  const items = o.lines.slice(0, 6).map((l) => `${l.quantity} × ${l.name_en}`).join(", ");
  const more = o.lines.length > 6 ? ` +${o.lines.length - 6}` : "";
  const body = lang === "ar"
    ? `أهلاً فيك من جديد 👋\nآخر طلب إلك: ${items}${more} من *${o.vendorName}*.\nبدك نفس الطلب؟`
    : `Welcome back 👋\nYour last order: ${items}${more} from *${o.vendorName}*.\nWant the same again?`;
  return {
    messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive",
    interactive: {
      type: "button", body: { text: body.slice(0, 1024) }, footer: { text: "Alo King · ألو كينغ" },
      action: { buttons: [
        { type: "reply", reply: { id: `REORDER|${o.orderId}`, title: lang === "ar" ? "اطلب نفس الطلب" : "Reorder last order" } },
        { type: "reply", reply: { id: `MENU|${o.vendorId}`, title: lang === "ar" ? "📋 شوف المنيو" : "📋 See Full Menu" } },
      ] },
    },
  };
}

export function parseReorderTap(id: string): string | null {
  const [kind, orderId] = String(id ?? "").split("|");
  return kind === "REORDER" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId ?? "") ? orderId : null;
}

// Safety net for free-text model replies: on any line that shows a "$x.xx" amount but no LBP at all, each USD amount gets its LBP
// equivalent appended (dual-currency rule). The LBP value is computed here at the fixed rate, never taken from the model.
// Lines that already carry LBP in any format ("· 134,250 LBP", "(134,250 LBP)", "= LBP 134,250", ل.ل) are left alone.
export function ensureDualCurrency(text: string, rate: number): string {
  return text.split("\n").map((line) => {
    if (/LBP|L\.L|ل\.ل|ليرة/i.test(line)) return line;
    return line.replace(/\$(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?!\.?\d)/g, (_m, n: string) =>
      `$${n} · ${Math.round(Number(n.replace(/,/g, "")) * rate).toLocaleString("en-US")} LBP`);
  }).join("\n");
}
