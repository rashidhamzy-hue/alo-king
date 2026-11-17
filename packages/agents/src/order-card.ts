// The order card: the one message that turns a conversation into a commitment. Built from the quote, never from model text.
// M1: its words come from messages/{ar,en,fr}.ts in the conversation's language; every line, the fee, the total, the address and
// the payment are always on it, each amount on its own line.
import { buttons, list, type Outbound } from "@ak/wa/kapso";
import { messages, windowLabel, windowRow, type Lang } from "./messages";
import { orderCardParts, type CardInput, type DeliveryWindow } from "./order-card-text";
export { addressText, orderCardParts, type CardAddress, type CardInput, type DeliveryWindow, type Quote, type QuoteLine } from "./order-card-text";

export { windowLabel, windowRow };

/** CFG1: "reopen" is the button under the lapsed-order notice; a tap on a lapsed card's confirm or edit means the same. */
export type OrderAction = "confirm" | "edit" | "cancel" | "reopen";
export const orderButtonId = (action: OrderAction, orderId: string) => `order:${action}:${orderId}`;
export function parseOrderButton(id: string): { action: OrderAction; orderId: string } | null {
  const m = /^order:(confirm|edit|cancel|reopen):([0-9a-f-]{36})$/.exec(id);
  return m ? { action: m[1] as OrderAction, orderId: m[2]! } : null;
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


/**
 * The order card, as the messages to send in order (one, or two when the basket is long). The card itself is the last: the lines,
 * the fees, the total, the address, the payment, then the buttons. A basket too long for one interactive message (1,024 characters)
 * goes first as a text with every line, and the card follows with the totals: every line is always shown (rule 8). `before` is a
 * short fixed text sent first; it shares the first message when the lines go separately, so a card never takes more than two sends.
 * `gaps` collects products shown without an approved Arabic name, for name_gaps.
 */
export function formatOrderCard(input: CardInput, opts: { before?: string; gaps?: Set<string> } = {}): Outbound[] {
  const m = messages(input.lang ?? "ar");
  const { head, items, sums, terms } = orderCardParts(input, opts.gaps);
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
                                     window?: DeliveryWindow | null; replaces?: string; credit_usd?: number | string },
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
