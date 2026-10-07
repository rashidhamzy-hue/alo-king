// Numbered quick-order: "See Full Menu" shows popular dishes as a numbered text list; replies like "1x2, 3, 5" or "1 1 3" become basket lines with no model call.
// Pure functions. The list is a deterministic function of the vendor's menu and the page; the server remembers which dishes the numbers on screen refer to (see quick_menus).
import { META } from "../_shared/meta-limits.ts";
import { isAlcohol } from "../_shared/alcohol.ts";
import { daypartAt, daypartLabel, daypartScore, isExtraItem, type Daypart } from "./daypart.ts";

export const NUMBERED_MAX_PER_PAGE = 10;
const MAX_TOKENS = 40, MAX_QTY = 20;
type Row = { contains_alcohol?: boolean | null; section?: string | null; item_id: string; item_name_en?: string | null; item_name_ar?: string | null; price_usd: number | string; is_popular?: boolean | null; sort_order?: number | null; customizations?: unknown };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const needsChoice = (r: Row) => (Array.isArray(r.customizations) ? r.customizations : []).some((g: any) => g?.name && (g.required || Number(g.min ?? 0) > 0));

/** Popular dishes first, then the vendor's own order, then name. Unpriced dishes are never listed. */
// Add-ons and extras ("Add Cheese", "Additional Bread", "Extra Sauce", an Extras / Add-ons section) are modifiers, not dishes: they are orderable by name but never listed as a numbered dish.
const ADDON_EN = /^(?:add|additional|extras?|add-ons?)\s+\S+$/i, ADDON_AR = /^(?:إضافة|اضافة|إضافي|اضافي|زيادة)\s+\S+$/, ADDON_SECTION = /^\s*(?:add[\s-]?ons?|extras?|إضافات|اضافات|زيادات)\s*$/i; // a prefix plus ONE more word ("Add Cheese"); longer names ("Extra Large Pizza") are dishes
export const isAddOn = (r: Row & { section?: string | null }) => ADDON_EN.test(String(r.item_name_en ?? "").trim()) || ADDON_AR.test(String(r.item_name_ar ?? "").trim()) || ADDON_SECTION.test(String(r.section ?? ""));
/** Order: dishes made for this daypart first, then the vendor's own order / the popular flag, then main dishes before extras (drinks, sides, sauces). Add-ons and alcohol are never listed. */
export function orderForList<T extends Row & { section?: string | null }>(items: T[], now: Daypart = daypartAt()): T[] {
  const priced = items.filter((r) => Number(r.price_usd) > 0 && !isAlcohol(r)), dishes = priced.filter((r) => !isAddOn(r)); // alcohol is never listed
  return (dishes.length ? dishes : priced).sort((a, b) =>
    daypartScore(b, now) - daypartScore(a, now) || Number(!!b.is_popular) - Number(!!a.is_popular) || (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || Number(isExtraItem(a)) - Number(isExtraItem(b)) || String(a.item_name_en ?? "").localeCompare(String(b.item_name_en ?? "")) || (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0));
}

const legend = (ar: boolean, more: boolean, anyOptions: boolean) => ar
  ? `\n\nابعت مثلاً *1x2, 4x1* (رقم الصنف x الكمية)${more ? "\nاكتب *كمان* للصفحة التالية" : ""}${anyOptions ? "\n⚙ = إلو خيارات" : ""}`
  : `\n\nReply like *1x2, 4x1* (dish number x how many)${more ? "\nType *more* for the next page" : ""}${anyOptions ? "\n⚙ = has options" : ""}`;

export function buildNumberedPage(o: { vendorName: string; items: Row[]; page: number; ar: boolean; daypart?: Daypart; both: (n: number) => string }): { body: string; shown: { n: number; item_id: string }[]; hasMore: boolean } {
  const headWith = (popular: boolean) => `*${clip(o.vendorName, 60)}* 👑\n${popular ? (o.ar ? "الأكثر طلباً" : "Popular right now") : o.daypart ? daypartLabel(o.daypart, o.ar) : (o.ar ? "القائمة" : "Menu")}\n\n`;
  const head = headWith(true).length >= headWith(false).length ? headWith(true) : headWith(false); // the longer title is used while sizing the page, so the real one can never overflow
  const line = (r: Row, n: number) => `${n}. ${clip(String((o.ar && r.item_name_ar) || r.item_name_en || r.item_name_ar || r.item_id), 42)}${needsChoice(r) ? " ⚙" : ""} — ${o.both(Number(r.price_usd))}`;
  const reserve = legend(o.ar, true, true).length;
  let start = 0;
  for (let p = 0; ; p++) {
    let body = head, k = 0;
    while (start + k < o.items.length && k < NUMBERED_MAX_PER_PAGE) {
      const next = `${k ? "\n" : ""}${line(o.items[start + k], k + 1)}`;
      if (k > 0 && (body + next).length + reserve > META.body) break;
      body += next; k++;
    }
    if (p === o.page) {
      const pageItems = o.items.slice(start, start + k);
      const hasMore = start + k < o.items.length;
      const real = headWith(pageItems.some((r) => !!r.is_popular)); // "Popular right now" only when popular dishes are really on this page
      return { body: k ? clip(real + body.slice(head.length) + legend(o.ar, hasMore, pageItems.some(needsChoice)), META.body) : "", shown: pageItems.map((r, i) => ({ n: i + 1, item_id: r.item_id })), hasMore };
    }
    if (!k) return { body: "", shown: [], hasMore: false };
    start += k;
  }
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const MORE = new Set(["more", "next", "next page", "show more", "المزيد", "مزيد", "كمان", "كمان شوي", "اكتر", "أكثر", "اكثر", "mazeed", "mazid", "kaman", "aktar"]);
const stripPolite = (s: string) => s.replace(/\s*(please|pls|plz|من فضلك|لو سمحت)\s*$/i, "").trim();
export const isMoreWord = (t: string) => MORE.has(stripPolite(String(t ?? "").trim().toLowerCase()));

export type NumberedReply = { kind: "order"; lines: { n: number; qty: number }[] } | { kind: "more" } | { kind: "invalid"; bad: number[] } | { kind: "none" };
/** Strict grammar only: every token is `N` or `NxQ` (x, ×, *), separated by spaces, commas, +, "and" or "و". Anything else is NOT a numbered reply and goes to the normal flow. */
export function parseNumberedReply(text: string, listSize: number): NumberedReply {
  let t = String(text ?? "").trim().toLowerCase().replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
  if (!t) return { kind: "none" };
  if (isMoreWord(t)) return { kind: "more" };
  // "1: 3 pieces 5: 2 pieces" / "1: 2, 3: 1" (number: quantity). A single "a:b" with no unit ("12:30", "3:1") is not an order.
  const colon = [...t.matchAll(/(\d{1,2})\s*:\s*(\d{1,2})(?:\s*(pieces?|pcs?|pc|قطعة|قطع|حبات|حبة|حباية)(?=\s|$|[,،;+]))?/g)];
  if ((colon.length >= 2 || colon.some((m) => m[3])) && colon.every((m) => Number(m[2]) <= MAX_QTY)) t = t.replace(/(\d{1,2})\s*:\s*(\d{1,2})(?:\s*(?:pieces?|pcs?|pc|قطعة|قطع|حبات|حبة|حباية)(?=\s|$|[,،;+]))?/g, "$1x$2");
  t = t.replace(/\s*[x×*]\s*/g, "x").replace(/(^|\s)(?:and|و)(?=\s|$)/g, " ");
  const toks = t.split(/[\s,،;+]+/).filter(Boolean);
  if (!toks.length || !toks.every((k) => /^\d{1,2}(?:x\d{1,2})?$/.test(k))) return { kind: "none" };
  if (toks.length > MAX_TOKENS) return { kind: "invalid", bad: [] };
  const lines: { n: number; qty: number }[] = []; const bad: number[] = [];
  const hasPair = toks.some((k) => k.includes("x")); // an explicit "NxQ" is clearly meant as a list reply; bare numbers alone are ambiguous (floor, house number, phone digits)
  for (const k of toks) {
    const [a, b] = k.split("x"); const n = Number(a), qty = b === undefined ? 1 : Number(b);
    if (n < 1 || n > listSize || qty < 1) { bad.push(n); continue; }
    const ex = lines.find((l) => l.n === n);
    if (ex) ex.qty = Math.min(MAX_QTY, ex.qty + qty); else lines.push({ n, qty: Math.min(MAX_QTY, qty) });
  }
  if (bad.length) return hasPair ? { kind: "invalid", bad: [...new Set(bad)] } : { kind: "none" }; // out-of-range bare numbers are not ours: the normal flow answers
  return { kind: "order", lines };
}

export const numberedTapId = (vendorId: string, page: number) => `NUM|${vendorId}|${page}`.slice(0, META.buttonId);
export function parseNumberedTap(id: string): { vendorId: string; page: number } | null {
  const p = String(id ?? "").split("|");
  if (p.length !== 3 || p[0] !== "NUM" || !p[1] || !/^\d{1,2}$/.test(p[2])) return null;
  return { vendorId: p[1], page: Number(p[2]) };
}
