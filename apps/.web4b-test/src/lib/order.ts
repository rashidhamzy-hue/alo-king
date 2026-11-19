// Session WEB2: what the basket, sign-in, checkout, order, history and account pages share. No price, fee, stock or state is decided here
// (invariants 7 and 19): every figure comes from the database through the website's role, and this file only reads, words and links.
import { webCommerce, webOrdering, type StoredCard } from "@ak/commerce/index";
import { orderCardParts } from "@ak/agents/order-card-text";
import { STATUS_LABELS, statusLabel, type OrderStatusId } from "@ak/ui/status";
import { postgrestSource, type WebEnv } from "./db";
import { sessionCookie, tokenOf } from "./session";
import { t, type Lang } from "./i18n";

export const ordering = (env: WebEnv) => webOrdering(postgrestSource(env));
export const commerce = (env: WebEnv) => webCommerce(postgrestSource(env));

/** The visitor's session, as the database sees it: none (no cookie, or one the database no longer knows), anonymous, or signed in. */
export interface Visitor { token: string | null; linked: boolean; valid: boolean; expiresAt: string | null; code: { code: string; expires_at: string } | null }
export async function visitorOf(env: WebEnv, cookie: string | null): Promise<Visitor> {
  const token = tokenOf(cookie);
  if (!token) return { token: null, linked: false, valid: false, expiresAt: null, code: null };
  const s = await commerce(env).sessionState(token);
  return { token: s.valid ? token : null, linked: !!s.linked, valid: !!s.valid, expiresAt: s.expires_at ?? null, code: s.code_waiting ?? null };
}
/** A token for a write: the visitor's own, or a new anonymous session (its cookie is returned to be set). */
export async function tokenForWrite(env: WebEnv, v: Visitor): Promise<{ token: string; setCookie: string | null }> {
  if (v.token) return { token: v.token, setCookie: null };
  const s = await commerce(env).startSession("web");
  return { token: s.token, setCookie: sessionCookie(s.token, s.expires_at) };
}
/** How many items the basket holds, for the header of a cached page (read by site.js). Not personal: a number, readable by the page's script. */
export const basketCookie = (n: number) => `ak_b=${Math.max(0, Math.min(999, Math.round(n)))}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax; Secure`;
export const clearCookie = "ak_session=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly";

/** A path on this site to go back to after a form: never another site, never a protocol-relative address. */
export const safeBack = (p: string | null | undefined, fallback = "/cart"): string =>
  p && /^\/(?![/\\])[\w\-./?=&%~]*$/.test(p) && p.length <= 300 ? p : fallback;

/** A 303 to a path, with a cookie when one was made. */
export function seeOther(path: string, setCookie?: string | null): Response {
  const h = new Headers({ Location: path, "Cache-Control": "no-store" });
  if (setCookie) h.append("Set-Cookie", setCookie);
  return new Response(null, { status: 303, headers: h });
}

/** A chat link with this text typed (the chat's base address comes from settings; with none, nothing). */
export const chatWith = (base: string | null | undefined, text: string): string | null =>
  base ? `${base.replace(/\?.*$/, "")}?text=${encodeURIComponent(text)}` : null;

/** Lira, grouped, in the page's words. */
export const lbp = (l: Lang, n: number | string | null | undefined): string => {
  const v = Math.round(Number(n ?? 0)).toLocaleString("en-US");
  return l === "ar" ? `${v} ل.ل.` : `${v} LBP`;
};

/** A position from what a visitor pasted: "33.68, 35.56", a Google Maps link (@lat,lng or q=lat,lng or ll=), or an OpenStreetMap one. */
export function parsePin(text: string | null | undefined): { lat: number; lng: number } | null {
  const s = (text ?? "").slice(0, 500).trim().replace(/\s+/g, " ");
  const pats = [/@(-?\d{1,2}\.\d+), ?(-?\d{1,3}\.\d+)/, /[?&](?:q|ll|query|destination)=(-?\d{1,2}\.\d+)(?:,|%2C) ?(-?\d{1,3}\.\d+)/i,
                /mlat=(-?\d{1,2}\.\d+)&mlon=(-?\d{1,3}\.\d+)/, /^(-?\d{1,2}\.\d+)(?:, ?| )(-?\d{1,3}\.\d+)$/];
  for (const p of pats) {
    const m = p.exec(s);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

/** The order card's words in the page's language: the same function the WhatsApp card is made of (orderCardParts), from the stored card.
 *  `address` is the order's own (the checkout's signed-in page); the order page passes none, so it shows the village and no address. */
export function cardWords(card: StoredCard, l: Lang, address: StoredCard["address"] = null) {
  return orderCardParts({ orderId: card.order_id, shortCode: card.short_code, quote: card.quote as any, paymentMethod: card.payment_method,
    changeForUsd: card.change_for_usd, changeForLbp: card.change_for_lbp, missingPref: card.missing_pref, missingItems: card.missing_items,
    keepChange: card.keep_change, window: card.window as any, replaces: card.replaces, prepay: card.prepay, lang: l, address: address ?? null });
}
/** CX2: a chat line without WhatsApp's marks, for a page: no *bold* asterisks, no _italic_ underscores around a whole line. */
export const plainWords = (line: string): string => {
  const t = line.replace(/\*/g, "");
  return t.startsWith("_") && t.endsWith("_") && t.length > 2 ? t.slice(1, -1) : t;
};
/** Splits "Label: $1.00" (one amount on its own at the end, the chat's rule) into the label, as written, and the amount, for a table row. */
export const splitAmount = (line: string): [string, string | null] => {
  const clean = line.replace(/\*/g, "").trim();
  const words = clean.split(" ");
  const last = words[words.length - 1] ?? "";
  // "…: 1,472,000 LBP" (or ل.ل.): the last two words; "…: $1.00": the last word. Read word by word, with no pattern that can backtrack.
  const n = (last === "LBP" || last.startsWith("ل.ل")) && /^[\d,]+$/.test(words[words.length - 2] ?? "") ? 2 : /^-?\$\d[\d,]*\.\d\d$/.test(last) ? 1 : 0;
  if (n === 0 || words.length <= n) return [clean, null];
  // CX2: the chat writes "Label · $1.00": the « · » before the amount is the chat's, not the label's.
  const label = words.slice(0, -n).filter((w, i, all) => !(i === all.length - 1 && w === "·")).join(" ");
  return [label, words.slice(-n).join(" ")];
};

/** The customer's words for a status, from the one label table (packages/ui/src/status.ts); French reads its own words for the same ids. */
const FR: Record<OrderStatusId, string> = {
  draft: "Pas encore envoyée", awaiting_confirmation: "En attente de votre confirmation", awaiting_payment: "En attente du paiement",
  confirmed: "Confirmée", preparing: "En préparation au dépôt", ready: "Prête", out_for_delivery: "En route", arrived: "À votre porte",
  delivered: "Livrée", failed_delivery: "Non livrée", returned: "Retournée", closed: "Livrée", cancelled: "Annulée",
};
const FR_PICKUP: Partial<Record<OrderStatusId, string>> = { ready: "Prête à retirer", delivered: "Retirée", closed: "Retirée" };
export const FR_STATUS = FR;
export function statusWords(id: string, l: Lang, pickup = false): string {
  if (l === "fr") return (pickup ? FR_PICKUP[id as OrderStatusId] : undefined) ?? FR[id as OrderStatusId] ?? id;
  return statusLabel(id, { audience: "customer", lang: l, pickup });
}
export const statusIcon = (id: string) => STATUS_LABELS[id as OrderStatusId]?.icon ?? "list";

/** The steps a customer follows, in order. A transfer adds "waiting for payment"; a pickup ends at the hub. */
export function journey(payment: string, pickup: boolean): OrderStatusId[] {
  return ["awaiting_confirmation", ...(payment !== "cod" ? ["awaiting_payment" as const] : []), "confirmed", "preparing", "ready",
          ...(pickup ? [] : ["out_for_delivery" as const]), "delivered"];
}

/** A window or a time in the page's language: "today 10:00–12:00", from the database's own date and times (window_json). */
export function windowWords(w: { day_offset: number; date: string; starts: string; ends: string } | null | undefined, l: Lang): string | null {
  if (!w) return null;
  const day = w.day_offset === 0 ? t(l, "w2_today") : w.day_offset === 1 ? t(l, "w2_tomorrow") : w.date;
  return `${day} ${w.starts}–${w.ends}`;
}
/** A date and time in the page's language, in the shop's own time zone (settings.hours.tz, read by the page). */
export const dateWords = (iso: string | null | undefined, l: Lang, tz?: string | null): string =>
  iso ? new Date(iso).toLocaleString(l === "ar" ? "ar-LB-u-nu-latn" : l === "fr" ? "fr-FR" : "en-GB", { ...(tz ? { timeZone: tz } : {}), day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
