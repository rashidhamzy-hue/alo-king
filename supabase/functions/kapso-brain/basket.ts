// Pure helpers for the persistent per-vendor basket (flow spec item 1). No I/O here: the DB layer lives in index.ts.
// A basket line stores item id, quantity and chosen options only. Money is always recomputed from menu_items by the server.

export type Choice = { group: string; option: string };
export type CardLine = { quantity: number; name: string; choices: string[]; lineTotal: number };

const norm = (s: string) => String(s ?? "").trim().toLowerCase();

/** Same dish + same options → same key, so adding it again bumps the quantity instead of making a duplicate line. */
export function lineKey(itemId: string, choices: Choice[] | undefined): string {
  const picks = (choices ?? []).map((c) => `${norm(c.group)}=${norm(c.option)}`).sort();
  return picks.length ? `${itemId}#${picks.join("&")}` : itemId;
}

/** Quantities are whole numbers 1..20; anything invalid or non-positive is 0 (meaning "remove"). */
export function clampQty(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(20, v);
}

// Tap ids: BASKET (show), CHECKOUT|<basket>, BCLR|<basket>. Basket ids are uuids, so no "|" inside.
export type BasketTap = { kind: "BASKET" | "CHECKOUT" | "BCLR"; basketId: string | null };
export const basketTapId = (kind: "CHECKOUT" | "BCLR", basketId: string) => `${kind}|${basketId}`;
export function parseBasketTap(id: string): BasketTap | null {
  if (id === "BASKET") return { kind: "BASKET", basketId: null };
  const parts = id.split("|");
  if (parts.length === 2 && (parts[0] === "CHECKOUT" || parts[0] === "BCLR") && parts[1]) return { kind: parts[0], basketId: parts[1] };
  return null;
}

export function basketCardText(o: { vendorName: string; lines: CardLine[]; subtotal: number; deliveryFee: number; both: (n: number) => string; ar: boolean; unavailable?: string[] }): string {
  const rows = fitRows(o.lines.map((l) => `${l.quantity} × ${l.name}${l.choices.length ? ` (${l.choices.join(", ")})` : ""} — ${o.both(l.lineTotal)}`), 620, o.ar);
  const gone = o.unavailable?.length ? `\n\n${o.ar ? "⚠️ ما عاد متوفر (انشال):" : "⚠️ No longer available (removed):"} ${o.unavailable.join(", ")}` : "";
  return o.ar
    ? `*🧺 سلتك — ${o.vendorName}*\n\n${rows}\n\n━━━━━━━━━━━━\nالمجموع الفرعي   ${o.both(o.subtotal)}\nالتوصيل   ${o.both(o.deliveryFee)} (بينضاف عند الدفع)${gone}`
    : `*🧺 YOUR BASKET — ${o.vendorName}*\n\n${rows}\n\n━━━━━━━━━━━━\nSubtotal   ${o.both(o.subtotal)}\nDelivery   ${o.both(o.deliveryFee)} (added at checkout)${gone}`;
}

/** A short, unambiguous "cancel" message (not "cancel the soft drinks", which the model handles). */
export function isCancelText(t: string): boolean {
  const s = String(t ?? "").trim().toLowerCase().replace(/[.!؟?,،]+$/g, "");
  return /^(cancel( it| (my )?(order|everything|that))?|never ?mind|forget it|cancel,? (i )?changed my mind|الغي( الطلب)?|إلغاء|الغاء|كنسل|لا ?بدي|خلص ?لا)$/i.test(s);
}

/** Join card rows so the whole message stays inside `budget` chars: overflow rows collapse into "+k more items". */
export function fitRows(rows: string[], budget: number, ar: boolean): string {
  if (rows.join("\n").length <= budget) return rows.join("\n");
  const more = (k: number) => (ar ? `… +${k} أصناف كمان` : `… +${k} more items`);
  const kept: string[] = [];
  let len = 0;
  for (let i = 0; i < rows.length; i++) {
    const tail = more(rows.length - i - 1).length + 1;
    if (len + rows[i].length + 1 + tail > budget && i < rows.length) break;
    kept.push(rows[i]); len += rows[i].length + 1;
  }
  return [...kept, more(rows.length - kept.length)].join("\n");
}

/** Model-supplied free text (name, village, landmark, notes): one line, trimmed, length-clamped. */
export function cleanField(v: unknown, max: number): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
