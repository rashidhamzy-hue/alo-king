// WEB4b: the food basket. One place's dishes, kept apart from the grocery basket (which lives in the database as cart_lines): a food order and
// a grocery order are two orders (FD2, one shop per order). It holds only ids and counts, in an HttpOnly cookie: the place, and each line's
// dish, count and chosen options. No name, price or fee is kept here: every page reads them again from the database (web_food_menu,
// web_food_quote), which also refuses a dish of another place (invariant 7). A cookie someone edits by hand can only ask the database a
// question it answers for everyone; nothing here decides anything.
import type { FoodDish } from "@ak/commerce/index";

export interface BasketLine { product_id: string; qty: number; options: string[] }
export interface FoodBasket { place: string; lines: BasketLine[] }

export const FOOD_COOKIE = "ak_food";
/** The database's own cap on one food quote (web_food_quote: at most 30 lines; a count of 1 to 50). */
export const MAX_LINES = 30;
export const MAX_QTY = 50;
/** A cookie stays well under the 4 KB browsers keep. */
const MAX_CHARS = 3800;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);

/** An id in 22 characters (base64url of its 16 bytes), so a full basket fits in one cookie. */
function short(id: string): string {
  const hex = id.replace(/-/g, "");
  let bin = "";
  for (let i = 0; i < 32; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function long(s: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(s)) return null;
  let bin: string;
  try { bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=="); } catch { return null; }
  if (bin.length !== 16) return null;
  const hex = [...bin].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID.test(id) ? id : null;
}

/** The cookie's value: "1~place~dish.qty.option.option~dish.qty". */
export function encodeBasket(b: FoodBasket): string {
  return ["1", short(b.place), ...b.lines.map((l) => [short(l.product_id), String(l.qty), ...l.options.map(short)].join("."))].join("~");
}
/** The basket a cookie holds, or null for none or anything that is not one (never an error). */
export function decodeBasket(v: string | null | undefined): FoodBasket | null {
  if (!v || v.length > MAX_CHARS) return null;
  const parts = v.split("~");
  if (parts[0] !== "1" || parts.length < 3) return null;
  const place = long(parts[1]!);
  if (!place) return null;
  const lines: BasketLine[] = [];
  for (const p of parts.slice(2, 2 + MAX_LINES)) {
    const [id, qty, ...opts] = p.split(".");
    const product_id = long(id ?? "");
    const n = Number(qty);
    const options = opts.map(long);
    if (!product_id || !Number.isInteger(n) || n < 1 || n > MAX_QTY || options.some((o) => !o) || options.length > 20) return null;
    lines.push({ product_id, qty: n, options: options as string[] });
  }
  return lines.length ? { place, lines } : null;
}
export const basketOf = (cookie: string | null | undefined): FoodBasket | null =>
  decodeBasket(new RegExp(`(?:^|;\\s*)${FOOD_COOKIE}=([^;]*)`).exec(cookie ?? "")?.[1] ?? null);

/** The Set-Cookie for a basket (two days), or the one that clears it. */
export function basketCookie(b: FoodBasket | null): string {
  if (!b || !b.lines.length) return `${FOOD_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`;
  return `${FOOD_COOKIE}=${encodeBasket(b)}; Path=/; Max-Age=${2 * 86400}; SameSite=Lax; Secure; HttpOnly`;
}
export const fits = (b: FoodBasket): boolean => b.lines.length <= MAX_LINES && encodeBasket(b).length <= MAX_CHARS;

const sameLine = (a: BasketLine, b: Pick<BasketLine, "product_id" | "options">) =>
  a.product_id === b.product_id && [...a.options].sort().join() === [...b.options].sort().join();

/** The basket with one more line (the same dish with the same choices adds to its count). Null when the line would not fit. */
export function addLine(b: FoodBasket | null, place: string, line: BasketLine): FoodBasket | null {
  const base: FoodBasket = b && b.place === place ? { place, lines: b.lines.map((l) => ({ ...l, options: [...l.options] })) } : { place, lines: [] };
  const at = base.lines.find((l) => sameLine(l, line));
  if (at) at.qty = Math.min(MAX_QTY, at.qty + line.qty);
  else base.lines.push({ ...line, qty: Math.min(MAX_QTY, Math.max(1, line.qty)), options: [...line.options] });
  return fits(base) ? base : null;
}
/** A line's count changed (0 takes it out). An index that is not a line changes nothing. */
export function setQty(b: FoodBasket, index: number, qty: number): FoodBasket {
  const lines = b.lines.map((l) => ({ ...l }));
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) return b;
  if (!Number.isFinite(qty) || qty <= 0) lines.splice(index, 1);
  else lines[index]!.qty = Math.min(MAX_QTY, Math.round(qty));
  return { place: b.place, lines };
}
export const dishCount = (b: FoodBasket | null): number => (b ? b.lines.reduce((a, l) => a + l.qty, 0) : 0);

export type ChoiceCheck = { ok: true } | { ok: false; why: "need"; group: string } | { ok: false; why: "bad" };
/**
 * The options chosen for a dish, against its own groups (the same rule as dish_choice, 0249): every option is the dish's own; no group above
 * its maximum; every required group at least its minimum (at least one). The database checks again when it quotes; this only lets the page
 * say which choice is missing before the dish goes into the basket.
 */
export function checkChoices(dish: Pick<FoodDish, "groups">, options: string[]): ChoiceCheck {
  const known = new Map<string, string>();
  for (const g of dish.groups) for (const o of g.options) known.set(o.id, g.group_id);
  if (options.some((o) => !known.has(o)) || new Set(options).size !== options.length) return { ok: false, why: "bad" };
  for (const g of dish.groups) {
    const n = options.filter((o) => known.get(o) === g.group_id).length;
    if (g.max > 0 && n > g.max) return { ok: false, why: "bad" };
    if (g.required && n < Math.max(1, g.min)) return { ok: false, why: "need", group: g.group_id };
  }
  return { ok: true };
}
