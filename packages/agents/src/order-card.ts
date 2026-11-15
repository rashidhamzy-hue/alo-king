// The order card: the one message that turns a conversation into a commitment. Built from the quote, never from model text.
// M1: its words come from messages/{ar,en,fr}.ts in the conversation's language; every line, the fee, the total, the address and
// the payment are always on it, each amount on its own line.
import { buttons, list, type Outbound } from "@ak/wa/kapso";
import { messages, productName, usd, villageName, windowLabel, windowRow, type Lang } from "./messages";

export { windowLabel, windowRow };

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
  /** M1: the conversation's language (default Arabic) and the delivery address. */
  lang?: Lang;
  address?: CardAddress | null }

const qty = (q: number) => String(Number(q));
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

const BODY_LIMIT = 1024;   // WhatsApp's limit for an interactive message body
const TEXT_LIMIT = 4000;   // under WhatsApp's 4096 for a text message

/** 2.8: the open windows as a list (at most ten rows; the database never lists a full one). `withNow` adds "now" as a row. */
export function formatWindowChoice(orderId: string | null, windows: DeliveryWindow[], opts: { withNow?: boolean; body?: string; lang?: Lang } = {}): Outbound {
  const m = messages(opts.lang).windows;
  if (windows.length === 0) return { type: "text", text: { body: m.none } };
  const rows = [...(opts.withNow ? [{ id: windowButtonId("now", orderId), title: m.now }] : []),
                ...windows.map((w) => ({ id: windowButtonId(w.slot_id, orderId), ...windowRow(w, opts.lang) }))];
  return list(opts.body ?? m.choose, m.button, rows.slice(0, 10));
}

/** The address line's words: village, building, floor, as the customer gave them (B4); the village alone when that is all we have. */
export function addressText(a: CardAddress | null | undefined, q: Pick<Quote, "village" | "village_ar">, lang: Lang): string {
  const village = villageName(lang, a?.village_ar ?? q.village_ar, a?.village_en ?? q.village);
  return messages(lang).join([village, a?.building, a?.floor].map((x) => (x ?? "").trim()).filter(Boolean));
}

/**
 * The order card, as the messages to send in order (one, or two when the basket is long). The card itself is the last: the lines,
 * the fees, the total, the address, the payment, then the buttons. A basket too long for one interactive message (1,024 characters)
 * goes first as a text with every line, and the card follows with the totals: every line is always shown (rule 8). `before` is a
 * short fixed text sent first; it shares the first message when the lines go separately, so a card never takes more than two sends.
 * `gaps` collects products shown without an approved Arabic name, for name_gaps.
 */
export function formatOrderCard(input: CardInput, opts: { before?: string; gaps?: Set<string> } = {}): Outbound[] {
  const { quote: q } = input;
  const lang = input.lang ?? "ar";
  const m = messages(lang);
  const head = m.card.heading(input.shortCode);
  const items = q.lines.flatMap((l) => {
    const extras = [...(l.modifiers ?? []), ...(l.note ? [l.note] : [])];
    return [m.card.item(qty(l.qty), productName(l, lang, opts.gaps), extras), usd(l.line_total_usd)];
  });

  const sums: string[] = [];
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

  const terms: string[] = [];
  if (q.pickup) terms.push(m.card.pickup);
  else {
    terms.push(m.card.address(addressText(input.address, q, lang)));
    terms.push(input.window ? m.card.window(windowLabel(input.window, lang)) : q.eta_minutes ? m.card.eta(q.eta_minutes) : m.card.deliverNow);
  }
  terms.push(m.card.payment(input.paymentMethod));
  const how = m.card.payName[input.paymentMethod];
  // Policy (0004): someone who owes pays the next order in advance. Say so on the card, before the tap, not after.
  if (input.paymentMethod !== "cod" && input.prepay?.reason === "first_order") terms.push(m.card.prepayFirst(how, input.prepay.maxCodUsd));
  else if (dues > 0 && input.paymentMethod !== "cod") terms.push(m.card.prepay(how));
  if (input.changeForUsd && input.paymentMethod === "cod") terms.push(m.card.changeFor, usd(input.changeForUsd));
  if (input.replaces) terms.push(m.card.replaces(input.replaces));
  terms.push("", m.card.consent);

  const buttonsOf = (body: string) => buttons(body, [
    { id: orderButtonId("confirm", input.orderId), title: m.card.confirm },
    { id: orderButtonId("edit", input.orderId), title: m.card.edit },
    { id: orderButtonId("cancel", input.orderId), title: m.card.cancel },
  ]);
  const whole = [head, "", ...items, "", ...sums, "", ...terms].join("\n");
  const before: Outbound[] = opts.before ? [{ type: "text", text: { body: opts.before } }] : [];
  if (whole.length <= BODY_LIMIT) return [...before, buttonsOf(whole)];

  // Too long for one card: every line first, as text (with `before` on top), then the card with the totals.
  const listed: string[] = [];
  let used = (opts.before ? opts.before.length + 2 : 0) + head.length + 2;
  for (let i = 0; i < items.length; i += 2) {
    const pair = `${items[i]}\n${items[i + 1]}`;
    const more = m.card.more((items.length - i) / 2);
    if (used + pair.length + 1 + more.length > TEXT_LIMIT) { listed.push(more); break; }
    listed.push(pair); used += pair.length + 1;
  }
  const first = [...(opts.before ? [opts.before, ""] : []), head, "", ...listed].join("\n");
  return [{ type: "text", text: { body: first } }, buttonsOf([head, "", ...sums, "", ...terms].join("\n"))];
}

/** Fixed replies to the three buttons. Deterministic text, no model. 2.8 adds the window and the scheduled-order answers. */
export function buttonReplyText(r: { status: string; short_code: string; changed: boolean; payment_method?: string; total_usd?: number;
                                     window?: DeliveryWindow | null; replaces?: string; credit_usd?: number },
                                transferTo: { whish?: string; omt?: string } = {}, lang: Lang = "ar"): string {
  const t = messages(lang).tap;
  const when = r.window ? windowLabel(r.window, lang) : null;
  switch (r.status) {
    case "confirmed":
      if (r.replaces && when) return t.replaced(r.short_code, r.replaces, when);
      return when ? t.confirmedFor(r.short_code, when) : t.confirmed(r.short_code);
    case "awaiting_payment": {
      const ch = r.payment_method === "omt" ? t.channel("omt", transferTo.omt ?? null) : t.channel("whish", transferTo.whish ?? null);
      return t.awaitingPayment(r.short_code, when, Number(r.total_usd ?? 0), ch);
    }
    case "draft": return t.draft(r.short_code);
    case "cancelled": return Number(r.credit_usd ?? 0) > 0 ? t.cancelledCredit(r.short_code, Number(r.credit_usd)) : t.cancelled(r.short_code);
    case "slot_full": return t.slotFull(r.short_code, when);
    case "slot_closed": return t.slotClosed(r.short_code, when);
    case "change_open": return t.changeOpen(r.short_code, when);
    case "too_late":
    case "change_too_late": return t.tooLate(r.short_code, when);
    default: return t.inProgress(r.short_code);
  }
}
