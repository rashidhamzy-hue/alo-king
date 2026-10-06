// What to do when a customer taps Confirm on an order summary that is no longer live: rebuild it (prices come from the database again), say it was already placed, or start over.
export type CartRow = { status?: string | null; items?: unknown; created_at?: string | null; expires_at?: string | null } | null | undefined;
const DAY = 24 * 3600_000;
export function cartRevival(cart: CartRow, nowMs: number): "revive" | "placed" | "gone" {
  if (!cart) return "gone";
  if (cart.status === "confirmed") return "placed";
  if (cart.status !== "pending") return "gone"; // replaced by a newer summary or cancelled: never resurrected
  if (!Array.isArray(cart.items) || !cart.items.length) return "gone";
  const exp = Date.parse(String(cart.expires_at ?? "")), created = Date.parse(String(cart.created_at ?? ""));
  if (!Number.isFinite(exp) || exp > nowMs) return "gone"; // a live summary is handled by the normal confirm path
  if (!Number.isFinite(created) || nowMs - created > DAY) return "gone";
  return "revive";
}

/** A basket nobody has touched for this long is stale (people forget a basket from lunch by dinner): it is hidden, never repriced or resurrected, and cleared by the scheduled job. */
export const BASKET_TTL_MS = 3 * 3600_000;
export const basketCutoffIso = (nowMs: number = Date.now()): string => new Date(nowMs - BASKET_TTL_MS).toISOString();
export const basketIsStale = (updatedAtIso: string | null | undefined, nowMs: number = Date.now()): boolean => { const t = Date.parse(String(updatedAtIso ?? "")); return !Number.isFinite(t) || nowMs - t >= BASKET_TTL_MS; };
