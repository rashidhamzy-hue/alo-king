// Pure helpers for menu browsing (flow spec item 2): category list, paged item lists, quantity picker, customization steps, one drink add-on.
// No I/O: index.ts fetches menu rows (server prices) and sends the payloads. Ids never carry prices.

export type MenuItemLite = { item_id: string; item_name_en?: string | null; item_name_ar?: string | null; price_usd: number | string; section?: string | null; is_popular?: boolean | null; sort_order?: number | null; contains_alcohol?: boolean | null };
export type Row = { id: string; title: string; description?: string };
export type Category = { key: string; slug: string; title: string; count: number; popular: number };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const sectionKey = (s: string | null | undefined) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim() || "menu";
export const categorySlug = (key: string) => encodeURIComponent(sectionKey(key)).slice(0, 60);
const isAllCaps = (s: string) => /[A-Z]/.test(s) && s === s.toUpperCase();

/** Group items by section (case/spacing variants merged), most popular / largest first, max 10 (a WhatsApp list limit). */
export function buildCategories(items: MenuItemLite[]): Category[] {
  const m = new Map<string, Category>();
  for (const it of items) {
    const key = sectionKey(it.section);
    const title = String(it.section ?? "").replace(/\s+/g, " ").trim() || "Menu";
    const c = m.get(key) ?? { key, slug: categorySlug(key), title, count: 0, popular: 0 };
    if (isAllCaps(c.title) && !isAllCaps(title)) c.title = title; // prefer "Salads" over "SALADS"
    c.count++; if (it.is_popular) c.popular++;
    m.set(key, c);
  }
  const all = [...m.values()].sort((a, b) => b.popular - a.popular || b.count - a.count);
  if (all.length <= 10) return all;
  const tail = all.slice(9); // 9 categories + one "Other" row so no dish becomes unreachable
  return [...all.slice(0, 9), { key: "other", slug: "other", title: "Other", count: tail.reduce((n, c) => n + c.count, 0), popular: 0 }];
}

/** Dishes shown under a category row ("other" collects every section not listed as its own row). */
export function itemsInCategory(items: MenuItemLite[], cats: Category[], slug: string): MenuItemLite[] {
  const named = new Set(cats.filter((c) => c.slug !== "other").map((c) => c.slug));
  return items.filter((it) => { const sl = categorySlug(sectionKey(it.section)); return slug === "other" ? !named.has(sl) : sl === slug; });
}

/** True when every option group can be answered with one tap per group (<=10 options, at most one pick required). Otherwise the customer orders that dish in chat. */
export function czSupported(groups: CzGroup[]): boolean {
  return groups.every((g) => {
    const needs = g.required || Number(g.min ?? 0) > 0;
    const n = (g.options ?? []).length;
    return n <= 10 && (!needs || (n > 0 && Number(g.min ?? 1) <= 1));
  });
}

const nameOf = (it: MenuItemLite, ar: boolean) => (ar && it.item_name_ar ? it.item_name_ar : it.item_name_en || it.item_name_ar || it.item_id);

/** One page of a category as list rows: at most 9 dishes + a "More…" row (10 rows max). */
export function itemPageRows(items: MenuItemLite[], page: number, vendorId: string, slug: string, ar: boolean, both: (n: number) => string): Row[] {
  const PER = 9;
  const ordered = [...items].sort((a, b) => Number(!!b.is_popular) - Number(!!a.is_popular) || (a.sort_order ?? 9999) - (b.sort_order ?? 9999));
  const start = page * PER;
  const slice = ordered.slice(start, start + PER);
  const rows: Row[] = slice.map((it) => ({ id: `ITEM|${vendorId}|${it.item_id}`, title: clip(nameOf(it, ar), 24), description: clip(both(Number(it.price_usd)), 72) }));
  if (ordered.length > start + PER) rows.push({ id: `CAT|${vendorId}|${slug}|${page + 1}`, title: ar ? "المزيد ➡️" : "More ➡️", description: ar ? `${ordered.length - start - PER} أصناف كمان` : `${ordered.length - start - PER} more` });
  return rows;
}

export function qtyRows(vendorId: string, itemId: string, name: string, ar: boolean): Row[] {
  return [1, 2, 3, 4, 5, 6, 8, 10].map((n) => ({ id: `ADD|${vendorId}|${itemId}|${n}`, title: clip(`${n} × ${name}`, 24), description: ar ? "أضف للسلة" : "Add to basket" }));
}

export type BrowseTap =
  | { kind: "CATS"; vendorId: string }
  | { kind: "CAT"; vendorId: string; slug: string; page: number }
  | { kind: "ITEM" | "QTY"; vendorId: string; itemId: string }
  | { kind: "ADD"; vendorId: string; itemId: string; qty: number }
  | { kind: "CZ"; vendorId: string; itemId: string; qty: number; picks: string[] };

export function parseBrowseTap(id: string): BrowseTap | null {
  const p = id.split("|");
  const [k, v, a, b, c] = p;
  if (k === "CATS" && p.length === 2 && v) return { kind: "CATS", vendorId: v };
  if (k === "CAT" && (p.length === 3 || p.length === 4) && v && a) { const page = p.length === 4 ? Number(b) : 0; return Number.isInteger(page) && page >= 0 ? { kind: "CAT", vendorId: v, slug: a, page } : null; }
  if ((k === "ITEM" || k === "QTY") && p.length === 3 && v && a) return { kind: k, vendorId: v, itemId: a };
  if (k === "ADD" && p.length === 4 && v && a) { const q = Number(b); return Number.isInteger(q) && q >= 1 ? { kind: "ADD", vendorId: v, itemId: a, qty: Math.min(20, q) } : null; }
  if (k === "CZ" && p.length === 5 && v && a) { const q = Number(b); return Number.isInteger(q) && q >= 1 ? { kind: "CZ", vendorId: v, itemId: a, qty: Math.min(20, q), picks: c ? c.split(",") : [] } : null; }
  return null;
}

export type CzGroup = { name: string; required?: boolean; min?: number; max?: number; options: { name: string; price_delta_usd?: number }[] };
export type CzStep =
  | { kind: "ask"; group: string; optional: boolean; rows: Row[] }
  | { kind: "done"; choices: { group: string; option: string }[] }
  | { kind: "invalid" };

/** Walk the customization groups one list at a time. A pick is "<group>.<option>" ("<group>.-" skips an optional group); the full path rides in the next row ids. */
export function czNext(groups: CzGroup[], picks: string[], idPrefix: string, both: (n: number) => string, ar: boolean): CzStep {
  const choices: { group: string; option: string }[] = [];
  for (let i = 0; i < picks.length; i++) {
    const m = picks[i].match(/^(\d+)\.(\d+|-)$/);
    if (!m || Number(m[1]) !== i || !groups[i]) return { kind: "invalid" };
    if (m[2] === "-") { if (groups[i].required || Number(groups[i].min ?? 0) > 0) return { kind: "invalid" }; continue; }
    const o = groups[i].options?.[Number(m[2])];
    if (!o) return { kind: "invalid" };
    choices.push({ group: groups[i].name, option: o.name });
  }
  if (picks.length >= groups.length) return { kind: "done", choices };
  const gi = picks.length, g = groups[gi];
  const optional = !(g.required || Number(g.min ?? 0) > 0);
  const path = (pick: string) => `${idPrefix}${[...picks, pick].join(",")}`;
  const rows: Row[] = (g.options ?? []).slice(0, optional ? 9 : 10).map((o, oi) => ({
    id: path(`${gi}.${oi}`), title: clip(o.name, 24),
    description: Number(o.price_delta_usd ?? 0) > 0 ? clip(`+${both(Number(o.price_delta_usd))}`, 72) : undefined,
  }));
  if (optional) rows.push({ id: path(`${gi}.-`), title: ar ? "بدون" : "Skip", description: ar ? "ما بدي إضافة" : "No extra" });
  return { kind: "ask", group: g.name, optional, rows };
}

// ---- one relevant add-on: a (non-alcoholic) drink ----
const DRINK = /\b(drinks?|beverages?|juices?|soft|soda|water|cola|lemonade|smoothies?)\b|مشروب|عصير|مياه|ماء|مرطبات|غازي/i;
const ALCOHOL = /\b(alcohol(ic)?|beers?|wines?|arak|whisk(e)?y|vodka|liquors?|cocktails?|spirits?)\b|عرق|بيرة|نبيذ|كحول/i;
export function isDrinkItem(it: MenuItemLite): boolean {
  if (it.contains_alcohol) return false;
  const sec = String(it.section ?? "");
  return DRINK.test(sec) && !ALCOHOL.test(sec) && !ALCOHOL.test(`${it.item_name_en ?? ""} ${it.item_name_ar ?? ""}`);
}
/** The one drink to suggest, or null when the basket already has a drink or the menu has none. Most popular first, then cheapest. */
export function pickAddon(menu: MenuItemLite[], basketItemIds: string[]): MenuItemLite | null {
  const byId = new Map(menu.map((m) => [m.item_id, m]));
  if (basketItemIds.some((id) => { const m = byId.get(id); return m && isDrinkItem(m); })) return null;
  const drinks = menu.filter((m) => isDrinkItem(m) && Number(m.price_usd) > 0 && !basketItemIds.includes(m.item_id));
  drinks.sort((a, b) => Number(!!b.is_popular) - Number(!!a.is_popular) || Number(a.price_usd) - Number(b.price_usd));
  return drinks[0] ?? null;
}
