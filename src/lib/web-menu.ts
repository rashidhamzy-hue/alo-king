// The web shop menu (CUSTOMER-EXPERIENCE §4): opened from the chat's "Open menu" button with a signed token (?t=), no
// login. The page shows the server's menu, fee and basket (public.web_menu) and "Continue in WhatsApp" hands the lines to
// the server (public.web_basket_save), which checks and prices them and sends the summary in the chat. The prices here
// only show what the menu says; the total that counts is the server's, in the chat. Pure helpers are unit-tested in
// web-menu.test.ts.
import { SUPABASE_URL } from "./config";
import { rpc } from "./rest";
import type { Names } from "./site-data";

export type WebOption = Names & { id: string; price_usd: number };
export type WebGroup = Names & { id: string; min: number; max: number; options: WebOption[] };
export type WebItem = Names & {
  id: string;
  description: string | null;
  price_usd: number;
  per_kg: boolean;
  est_weight_kg: number | null;
  vegetarian: boolean;
  vegan: boolean;
  spicy: number;
  photo: boolean;
  photo_source: string | null;
  /** Declared by the shop only; null when it declared nothing (never "none", §38.3). */
  allergens: string[] | null;
  nutrition: {
    kcal: number;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    status: "merchant_verified" | "estimated";
  } | null;
  /** One item of the same shop bought together with this one in two or more delivered orders. */
  goes_well: string | null;
  groups: WebGroup[];
};
export type WebSection = Names & { id: string | null; items: WebItem[] };
export type WebLine = {
  item_id: string;
  quantity: number;
  option_ids: string[];
  note: string | null;
};
export type WebShop = Names & {
  vendor_id: string;
  slug: string;
  branch_label: string | null;
  cuisine_ar: string | null;
  cuisine_en: string | null;
  cuisine_fr: string | null;
  village_ar: string | null;
  village_en: string | null;
  village_fr: string | null;
  open_now: boolean;
  hours_today: string | null;
  paused: boolean;
  cover: boolean;
  demo: boolean;
  delivery: boolean;
  pickup: boolean;
  min_order_usd: number | null;
};
export type WebDelivery = {
  status: string;
  fee_usd: number | null;
  road_km: number | null;
  eta_min: number;
  eta_max: number;
  place_ar: string | null;
  place_en: string | null;
  place_fr: string | null;
  demo_address: boolean;
};
export type WebMenu =
  | { status: "expired" }
  | { status: "unavailable"; lang?: string }
  | {
      status: "ok";
      lang: "ar" | "en" | "fr";
      shop: WebShop;
      delivery: WebDelivery;
      sections: WebSection[];
      basket:
        | null
        | { other_vendor: true; vendor_ar: string | null; vendor_en: string | null }
        | { other_vendor: false; lines: WebLine[] };
      note_max: number;
      rate: number | null;
      expires_at: string;
    };

export type SaveResult =
  | { status: "saved"; items: number; subtotal_usd: number }
  | { status: "other_vendor"; vendor_ar: string | null; vendor_en: string | null }
  | { status: "expired" | "too_many" | "invalid" | "unavailable" | "choices"; item_id?: string }
  | { status: "network" };

/** A token as the server makes them: 24 URL-safe characters. Anything else is never sent to the database. */
export const isWebToken = (t: unknown): t is string =>
  typeof t === "string" && /^[A-Za-z0-9_-]{24}$/.test(t);

export async function getWebMenu(token: string, slug: string): Promise<WebMenu | null> {
  if (!isWebToken(token)) return { status: "expired" };
  return rpc<WebMenu>("web_menu", { p_token: token, p_slug: slug });
}

export async function saveWebBasket(
  token: string,
  slug: string,
  lines: WebLine[],
  replace = false,
): Promise<SaveResult> {
  const r = await rpc<SaveResult>("web_basket_save", {
    p_token: token,
    p_slug: slug,
    p_lines: lines.map((l) => ({
      item_id: l.item_id,
      quantity: l.quantity,
      option_ids: l.option_ids,
      note: l.note,
    })),
    p_replace: replace,
  });
  return r ?? { status: "network" };
}

/** The site's photo route (dispatch ?route=site-photo): an item's photo, or a shop's cover. */
export const sitePhotoUrl = (p: { item?: string; shop?: string }) =>
  `${SUPABASE_URL}/functions/v1/dispatch?route=site-photo&${
    p.item ? `i=${encodeURIComponent(p.item)}` : `c=${encodeURIComponent(p.shop ?? "")}`
  }`;

// ---- The cart on the page ------------------------------------------------------------------------------------------------
/** One line per item, choices and note: the same item with other choices is another line (as in the server's basket). */
export const lineKey = (l: Pick<WebLine, "item_id" | "option_ids" | "note">) =>
  `${l.item_id}|${[...l.option_ids].sort().join(",")}|${(l.note ?? "").trim()}`;

/** Adds a line, or raises the quantity of the same line; at most 50 of one line and 50 lines (the server's limits). */
export function addLine(lines: WebLine[], l: WebLine): WebLine[] {
  const k = lineKey(l);
  const i = lines.findIndex((x) => lineKey(x) === k);
  if (i >= 0)
    return lines.map((x, j) =>
      j === i ? { ...x, quantity: Math.min(50, x.quantity + l.quantity) } : x,
    );
  if (lines.length >= 50) return lines;
  return [...lines, { ...l, quantity: Math.max(1, Math.min(50, l.quantity)) }];
}

/** Sets a line's quantity; zero removes it. */
export function setQuantity(lines: WebLine[], key: string, quantity: number): WebLine[] {
  if (quantity <= 0) return lines.filter((x) => lineKey(x) !== key);
  return lines.map((x) => (lineKey(x) === key ? { ...x, quantity: Math.min(50, quantity) } : x));
}

/** What one unit costs on the menu: the item, kilo items at their usual weight, plus the chosen options. */
export function unitPrice(item: WebItem, optionIds: string[]): number {
  const base =
    item.per_kg && item.est_weight_kg ? item.price_usd * item.est_weight_kg : item.price_usd;
  const opts = item.groups
    .flatMap((g) => g.options)
    .filter((o) => optionIds.includes(o.id))
    .reduce((a, o) => a + Number(o.price_usd || 0), 0);
  return Math.round((Number(base) + opts) * 100) / 100;
}

/** The groups whose rule the choices do not meet yet (a required size missing, too many add-ons). */
export function unmetGroups(item: WebItem, optionIds: string[]): WebGroup[] {
  return item.groups.filter((g) => {
    const n = g.options.filter((o) => optionIds.includes(o.id)).length;
    const min = Math.min(g.min, g.options.length);
    return n < min || n > g.max;
  });
}

/** Toggles an option inside its group: a one-choice group swaps, a multi-choice group adds up to its max. */
export function toggleOption(
  item: WebItem,
  optionIds: string[],
  group: WebGroup,
  optionId: string,
): string[] {
  const inGroup = new Set(group.options.map((o) => o.id));
  const chosen = optionIds.filter((id) => inGroup.has(id));
  if (chosen.includes(optionId)) {
    // A required one-choice group keeps its choice (tap another to swap); anything else can be unticked.
    if (group.max === 1 && group.min >= 1) return optionIds;
    return optionIds.filter((id) => id !== optionId);
  }
  if (group.max === 1) return [...optionIds.filter((id) => !inGroup.has(id)), optionId];
  if (chosen.length >= group.max) return optionIds;
  return [...optionIds, optionId];
}

/** The page's lines from the server's basket, kept only for items the menu still shows. */
export function linesFromBasket(menu: Extract<WebMenu, { status: "ok" }>): WebLine[] {
  const b = menu.basket;
  if (!b || b.other_vendor) return [];
  const shown = new Set(menu.sections.flatMap((s) => s.items.map((i) => i.id)));
  return b.lines
    .filter((l) => shown.has(l.item_id))
    .map((l) => ({
      item_id: l.item_id,
      quantity: l.quantity,
      option_ids: l.option_ids ?? [],
      note: l.note ?? null,
    }));
}

/** Items in the cart and their menu subtotal (shown as such; the chat's summary has the server's total). */
export function cartTotals(lines: WebLine[], items: Map<string, WebItem>) {
  let count = 0;
  let subtotal = 0;
  for (const l of lines) {
    const it = items.get(l.item_id);
    if (!it) continue;
    count += l.quantity;
    subtotal += unitPrice(it, l.option_ids) * l.quantity;
  }
  return { count, subtotal: Math.round(subtotal * 100) / 100 };
}

/** A section's anchor id on the page. */
export const sectionAnchor = (k: number) => `sec-${k}`;
