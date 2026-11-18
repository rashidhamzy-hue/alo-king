// The order card's words (WEB2 split them from order-card.ts): the heading, every line and its amount, the sums and the terms, built from
// the database's quote and the order's choices, never from model text. formatOrderCard (order-card.ts) sends them on WhatsApp with the
// Confirm, Edit and Cancel buttons; the website prints the same words, so the card is the same on both. No WhatsApp client is imported here.
import { messages, productName, usd, villageName, windowLabel, type Lang } from "./messages";
import { latinDigits } from "./output-guard";

export interface QuoteLine { product_id?: string; name: string; name_ar: string | null; qty: number; unit: string; line_total_usd: number; modifiers?: string[]; note?: string | null }
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
/** Where the order goes (order_address, 0120): the place's village, building and floor as the customer gave them. */
export interface CardAddress { village_en: string | null; village_ar: string | null; building: string | null; floor: string | null }
export interface CardInput { orderId: string; shortCode: string; quote: Quote; paymentMethod: "cod" | "whish" | "omt"; changeForUsd?: number | null;
  /** Why cash on delivery was refused and the order is paid in advance (from create_order_from_quote's issues). */
  prepay?: { reason: "dues" } | { reason: "first_order"; maxCodUsd: number } | null;
  /** 2.8: the window the customer chose (request_delivery_window). Absent: deliver now. */
  window?: DeliveryWindow | null;
  /** 2.8: this card changes an order already confirmed (link_replacement_order): its short code. */
  replaces?: string | null;
  /** CFG1: this card opens a lapsed order again (orders.reopened_from, 0223): the old order's short code. */
  reopenedFrom?: string | null;
  /** M1: the conversation's language (default Arabic) and the delivery address. */
  lang?: Lang;
  address?: CardAddress | null;
  /** CX1: what to do if an item is missing (default: ask), change kept as credit, and where a pickup is collected (settings.pickup). */
  missingPref?: "best_match" | "ask" | "remove" | null;
  /** WEB2: items whose own missing-item choice was set on the website's checkout (order_items.missing_pref). */
  missingItems?: { name: string; name_ar: string | null; product_id?: string; pref: "best_match" | "ask" | "remove" }[] | null;
  /** WEB2: cash in lira: the amount in LBP the customer will hand over (orders.change_for_lbp). */
  changeForLbp?: number | null;
  keepChange?: boolean;
  pickupPlace?: string | null }

const qty = (q: number) => String(Number(q));

/** The address line's words: village, building, floor, as the customer gave them (B4); the village alone when that is all we have. */
export function addressText(a: CardAddress | null | undefined, q: Pick<Quote, "village" | "village_ar">, lang: Lang): string {
  const village = villageName(lang, a?.village_ar ?? q.village_ar, a?.village_en ?? q.village);
  return messages(lang).join([village, a?.building, a?.floor].map((x) => latinDigits((x ?? "").trim())).filter(Boolean));
}

/**
 * The card's words without its buttons: the heading, the lines (each followed by its amount: formatOrderCard joins the two with « · »; the
 * website prints them as a table row), the totals block, and the terms as short sections with blank lines between them (CX2).
 */
export function orderCardParts(input: CardInput, gaps?: Set<string>): { head: string; items: string[]; sums: string[]; terms: string[] } {
  const { quote: q } = input;
  const lang = input.lang ?? "ar";
  const m = messages(lang);
  const head = m.card.heading(input.shortCode);
  const items = q.lines.flatMap((l) => {
    // B1b (the second run on main, 43756167947): the customer's own words on a line («٥٠٠ مل، ١٢ قنينة») show with Latin digits (rule 7).
    const extras = [...(l.modifiers ?? []), ...(l.note ? [l.note] : [])].map(latinDigits);
    return [m.card.item(qty(l.qty), productName(l, lang, gaps), extras), usd(l.line_total_usd)];
  });

  // CX2: the totals block: the items, each fee, what is owed or credited, the total in bold, then the lira.
  const sums: string[] = [];
  const itemsSum = Math.round(q.lines.reduce((a, l) => a + Number(l.line_total_usd), 0) * 100) / 100;
  sums.push(m.amount(m.card.items, Number(q.subtotal_usd ?? itemsSum)));
  if (!q.pickup) sums.push(m.amount(m.card.delivery(villageName(lang, q.village_ar, q.village) || null), q.delivery_fee_usd));
  const small = Number(q.small_order_fee_usd ?? 0);
  if (small > 0) sums.push(m.amount(m.card.smallOrder, small));
  // What is owed from a delivery nobody answered is its own line, so the total adds up on the card (1.4).
  const dues = Number(q.dues_usd ?? 0);
  if (dues > 0) sums.push(m.amount(m.card.dues, dues));
  // What we owed them, taken off this order, on its own line so the card still adds up (C2's request).
  const credit = Number(q.credit_usd ?? 0);
  if (credit > 0) sums.push(m.amount(m.card.credit, -credit));
  sums.push(`*${m.amount(m.card.total, q.total_usd)}*`);
  if (q.total_lbp) sums.push(m.card.orLbp(q.total_lbp));

  // CX2: the sections, each a bold heading with its emoji: where and when, the payment, a missing item; a blank line between them.
  const where: string[] = [];
  if (q.pickup) where.push(input.pickupPlace ? m.cx.pickupAt(input.pickupPlace) : m.card.pickup);
  else {
    where.push(m.card.address(addressText(input.address, q, lang)));
    where.push(input.window ? m.card.window(windowLabel(input.window, lang)) : q.eta_minutes ? m.card.eta(q.eta_minutes) : m.card.deliverNow);
  }
  const pay: string[] = [m.card.payment(input.paymentMethod)];
  const how = m.card.payName[input.paymentMethod];
  // Policy (0004): someone who owes pays the next order in advance. Say so on the card, before the tap, not after.
  if (input.paymentMethod !== "cod" && input.prepay?.reason === "first_order") pay.push(m.card.prepayFirst(how, input.prepay.maxCodUsd));
  else if (dues > 0 && input.paymentMethod !== "cod") pay.push(m.card.prepay(how));
  if (input.changeForUsd && input.paymentMethod === "cod") {
    pay.push(m.amount(m.card.changeFor, input.changeForUsd));
    if (input.keepChange) pay.push(m.cx.keepLine);
  }
  if (input.changeForLbp && input.paymentMethod === "cod") pay.push(`${m.card.changeForLbp} · ${m.lbp(input.changeForLbp)}`);
  // CX1: the missing-item choice, always said (the list under the confirmation changes it, until picking starts).
  const missing: string[] = [m.cx.missingLine(input.missingPref ?? "ask")];
  // WEB2: an item with its own choice, under the order's.
  for (const it of input.missingItems ?? []) if (it.pref !== (input.missingPref ?? "ask")) missing.push(m.cx.missingItemLine(productName(it, lang, gaps), it.pref));
  const terms: string[] = [...where, "", ...pay, "", ...missing];
  if (input.replaces) terms.push("", m.card.replaces(input.replaces));
  if (input.reopenedFrom) terms.push("", m.card.reopenedFrom(input.reopenedFrom));
  terms.push("", m.card.consent);
  return { head, items, sums, terms };
}
