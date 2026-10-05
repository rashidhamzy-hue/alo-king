// Numbered quick-order: "See Full Menu" shows popular dishes as a numbered text list; replies like "1x2, 3, 5" or "1 1 3" become basket lines with no model call.
// Pure functions. The list is a deterministic function of the vendor's menu and the page; the server remembers which dishes the numbers on screen refer to (see quick_menus).
import { META } from "../_shared/meta-limits.ts";

export const NUMBERED_MAX_PER_PAGE = 10;
const MAX_TOKENS = 40, MAX_QTY = 20;
type Row = { item_id: string; item_name_en?: string | null; item_name_ar?: string | null; price_usd: number | string; is_popular?: boolean | null; sort_order?: number | null; customizations?: unknown };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const needsChoice = (r: Row) => (Array.isArray(r.customizations) ? r.customizations : []).some((g: any) => g?.name && (g.required || Number(g.min ?? 0) > 0));

/** Popular dishes first, then the vendor's own order, then name. Unpriced dishes are never listed. */
export function orderForList<T extends Row>(items: T[]): T[] {
  return items.filter((r) => Number(r.price_usd) > 0).sort((a, b) =>
    Number(!!b.is_popular) - Number(!!a.is_popular) || (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || String(a.item_name_en ?? "").localeCompare(String(b.item_name_en ?? "")));
}

const legend = (ar: boolean, more: boolean, anyOptions: boolean) => ar
  ? `\n\nابعت الأرقام، مثلاً *1x2, 3* (الرقم x الكمية)${more ? "\nاكتب *كمان* للصفحة التالية" : ""}${anyOptions ? "\n⚙ = إلو خيارات" : ""}`
  : `\n\nReply with numbers, e.g. *1x2, 3* (number x quantity)${more ? "\nType *more* for the next page" : ""}${anyOptions ? "\n⚙ = has options" : ""}`;

export function buildNumberedPage(o: { vendorName: string; items: Row[]; page: number; ar: boolean; both: (n: number) => string }): { body: string; shown: { n: number; item_id: string }[]; hasMore: boolean } {
  const head = `*${clip(o.vendorName, 60)}* 👑\n${o.ar ? "الأكثر طلباً" : "Popular right now"}\n\n`;
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
      return { body: k ? clip(body + legend(o.ar, hasMore, pageItems.some(needsChoice)), META.body) : "", shown: pageItems.map((r, i) => ({ n: i + 1, item_id: r.item_id })), hasMore };
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
/** Strict grammar only: every token is `N` or `NxQ` (x, ×, *, :), separated by spaces, commas, +, "and" or "و". Anything else is NOT a numbered reply and goes to the normal flow. */
export function parseNumberedReply(text: string, listSize: number): NumberedReply {
  let t = String(text ?? "").trim().toLowerCase().replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
  if (!t) return { kind: "none" };
  if (isMoreWord(t)) return { kind: "more" };
  t = t.replace(/\s*[x×*:]\s*/g, "x").replace(/(^|\s)(?:and|و)(?=\s|$)/g, " ");
  const toks = t.split(/[\s,،;+]+/).filter(Boolean);
  if (!toks.length || !toks.every((k) => /^\d{1,2}(?:x\d{1,2})?$/.test(k))) return { kind: "none" };
  if (toks.length > MAX_TOKENS) return { kind: "invalid", bad: [] };
  const lines: { n: number; qty: number }[] = []; const bad: number[] = [];
  for (const k of toks) {
    const [a, b] = k.split("x"); const n = Number(a), qty = b === undefined ? 1 : Number(b);
    if (n < 1 || n > listSize || qty < 1) { bad.push(n); continue; }
    const ex = lines.find((l) => l.n === n);
    if (ex) ex.qty = Math.min(MAX_QTY, ex.qty + qty); else lines.push({ n, qty: Math.min(MAX_QTY, qty) });
  }
  return bad.length ? { kind: "invalid", bad: [...new Set(bad)] } : { kind: "order", lines };
}

export const numberedTapId = (vendorId: string, page: number) => `NUM|${vendorId}|${page}`.slice(0, META.buttonId);
export function parseNumberedTap(id: string): { vendorId: string; page: number } | null {
  const p = String(id ?? "").split("|");
  if (p.length !== 3 || p[0] !== "NUM" || !p[1] || !/^\d{1,2}$/.test(p[2])) return null;
  return { vendorId: p[1], page: Number(p[2]) };
}
