// Clean basket editing without a model: "make it 3", "remove the fries", "no pepsi", "خليها 3", "shil el batata", plus tap ids and rows for the Edit button.
// Pure functions. Quantity changes go through the same server path as every basket change (re-priced from the database, summaries expired).
import { normText, rankItems, type IndexItem } from "./resolve.ts";
import { numOf } from "./orderparse.ts";
import { META } from "../_shared/meta-limits.ts";

export type EditLine = { id: string; name_en: string; name_ar: string; quantity: number };
export type EditResult =
  | { kind: "set"; lineId: string; quantity: number }
  | { kind: "remove"; lineId: string }
  | { kind: "ambiguous"; options: { id: string; name: string }[] }
  | { kind: "none" };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const MAX_QTY = 20;
const NUM = String.raw`(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|wahad|tnein|etneen|tlete|arba3a|khamse|واحد|اتنين|اثنين|تنين|ثلاثه|تلاته|اربعه|خمسه|سته|سبعه|ثمانيه|تمانيه|تسعه|عشره)`;
const PRON = /^(?:it|that|this|them|those|هيدا|هاد|هاي)$/;

// Words that usually describe how a dish is made ("no onion", "without garlic", "no chicken"): a request about a dish, not a request to delete a basket line.
const MODIFIERS = new Set(["onion", "onions", "tomato", "tomatoes", "pickle", "pickles", "garlic", "toum", "sauce", "sauces", "mayo", "mayonnaise", "ketchup", "lettuce", "parsley", "salt", "pepper", "spice", "spices", "spicy", "cheese", "chicken", "beef", "meat", "lamb", "fish", "oil", "sugar", "ice", "cream",
  "بصل", "بندوره", "مخلل", "ثوم", "صوص", "مايونيز", "كاتشب", "خس", "بقدونس", "ملح", "فلفل", "جبنه", "دجاج", "لحمه", "سكر", "basal", "banadoura", "mekhalal", "5ass", "ba2dounes", "jibne"]);
const isModifierOnly = (name: string) => { const ws = normText(name).split(" ").filter((w) => w && !/^(?:the|my|el|al|ال|some|any)$/.test(w)); return ws.length > 0 && ws.every((w) => MODIFIERS.has(w.replace(/^ال(?=\S{3,})/, ""))); };

const toIndex = (l: EditLine): IndexItem => ({ item_id: l.id, vendor_id: "", vendor_name: "", vendor_name_ar: "", name_en: l.name_en, name_ar: l.name_ar, section: "", price_usd: 1, is_popular: false });

/** Which basket line does `name` mean? A pronoun / empty name means the dish added last. */
function pick(name: string, lines: EditLine[], allowEmpty: boolean): { line?: EditLine; ambiguous?: EditLine[] } {
  const n = normText(name).replace(/^(?:the|my|el|al|ال)\s+/, "").split(" ").map((w) => (w.length > 4 ? w.replace(/^ال/, "") : w)).join(" ").trim(); // "the" / "el" / attached Arabic "ال"
  if (!n || PRON.test(n)) return allowEmpty || n ? { line: lines[lines.length - 1] } : {};
  const ranked = rankItems(n, lines.map(toIndex), { floor: 0.8 });
  if (!ranked.length) return {};
  const close = ranked.filter((r) => r.score >= ranked[0].score - 0.12);
  if (close.length > 1) return { ambiguous: close.map((r) => lines.find((l) => l.id === r.item.item_id)!).sort((a, b) => lines.indexOf(a) - lines.indexOf(b)) };
  return { line: lines.find((l) => l.id === ranked[0].item.item_id) };
}
const finish = (r: { line?: EditLine; ambiguous?: EditLine[] }, qty: number | null): EditResult => {
  if (r.ambiguous) return { kind: "ambiguous", options: r.ambiguous.map((l) => ({ id: l.id, name: l.name_en || l.name_ar })) };
  if (!r.line) return { kind: "none" };
  return qty === null || qty <= 0 ? { kind: "remove", lineId: r.line.id } : { kind: "set", lineId: r.line.id, quantity: Math.min(MAX_QTY, qty) };
};
const q = (w: string): number | null => (/^\d+$/.test(w) ? Number(w) : numOf(w));

export function parseBasketEdit(text: string, lines: EditLine[]): EditResult {
  if (!lines.length) return { kind: "none" };
  const t = normText(String(text ?? "")).replace(/\s+(?:please|pls|plz|من فضلك|لو سمحت)$/, "").trim();
  if (!t || t.length > 80) return { kind: "none" };
  let m: RegExpMatchArray | null;
  // --- set a quantity ---
  if ((m = t.match(new RegExp(String.raw`^(?:make|change|set|update)\s+(?:(?:it|that|this|them)\s*(?:to\s*)?|(?:the\s+)?(.+?)\s*(?:to\s*)?)${NUM}$`)))) return finish(pick(m[1] ?? "", lines, true), q(m[2]));
  if ((m = t.match(new RegExp(String.raw`^(?:only|just)\s+${NUM}(?:\s+(.+))?$`)))) return finish(pick(m[2] ?? "", lines, true), q(m[1]));
  if ((m = t.match(new RegExp(String.raw`^(.+?)\s*x\s*${NUM}$`)))) return finish(pick(m[1], lines, false), q(m[2]));
  if ((m = t.match(new RegExp(String.raw`^${NUM}\s*x?\s*(.+?)\s+instead$`)))) return finish(pick(m[2], lines, false), q(m[1]));
  if ((m = t.match(new RegExp(String.raw`^(?:خليهم|خليها|خليه|خلي|khalli|khali|khalle|5alli|5ali)\s*(?:(?:ال|el\s+|al\s+)?(.*?)\s+)?${NUM}$`)))) return finish(pick(m[1] ?? "", lines, true), q(m[2]));
  // --- remove ---
  if ((m = t.match(/^(?:remove|delete|take out|take off|get rid of)\s+(?:the\s+|my\s+)?(it|that|this)$/)) || (m = t.match(/^(شيلو|شيلها|احذفو|احذفها|shilo|sheelo)$/))) return finish({ line: lines[lines.length - 1] }, null);
  if ((m = t.match(/^(?:remove|delete|drop|cancel|take out|take off|get rid of|no|without|(?:i\s+)?don\s?t\s+want|(?:i\s+)?do\s+not\s+want)\s+(?:the\s+|my\s+)?(.+)$/)) ||
      (m = t.match(/^(?:شيل|شيلي|احذف|بلا|بدون|ما بدي|مابدي|لا تحط|shil|sheel|shayl|bala|bdun|ma badde|ma bade|mabade|ma bdi|ma baddi)\s+(.+)$/))) return isModifierOnly(m[1]) || PRON.test(normText(m[1]).trim()) ? { kind: "none" } : finish(pick(m[1], lines, false), null); // a bare pronoun here ("cancel it", "no that") is not a clear basket edit
  return { kind: "none" };
}

// ---- taps: BEDIT|<basket> (open the edit list), BLINE|<line> (one dish), BSET|<line>|<qty> (set; 0 removes) ----
export const editLineId = (lineId: string) => `BLINE|${lineId}`;
export const setTapId = (lineId: string, quantity: number) => `BSET|${lineId}|${quantity}`;
export type EditTap = { kind: "EDIT" | "LINE"; id: string } | { kind: "SET"; id: string; quantity: number };
export function parseEditTap(id: string): EditTap | null {
  const p = String(id ?? "").split("|");
  if ((p[0] === "BEDIT" || p[0] === "BLINE") && p.length === 2 && p[1]) return { kind: p[0] === "BEDIT" ? "EDIT" : "LINE", id: p[1] };
  if (p[0] === "BSET" && p.length === 3 && p[1] && /^\d{1,2}$/.test(p[2]) && Number(p[2]) <= MAX_QTY) return { kind: "SET", id: p[1], quantity: Number(p[2]) };
  return null;
}

export function editListRows(basketId: string, lines: EditLine[], ar: boolean): { id: string; title: string; description?: string }[] {
  const rows = lines.slice(0, META.listRows - 2).map((l) => ({ id: clip(editLineId(l.id), META.rowId), title: clip(`${l.quantity}× ${(ar && l.name_ar) || l.name_en || l.name_ar}`, META.rowTitle), description: ar ? "اضغط للتعديل" : "Tap to change" }));
  return [...rows,
    { id: clip(`BCLR|${basketId}`, META.rowId), title: ar ? "🗑 فضي السلة" : "🗑 Clear basket" },
    { id: "BASKET", title: ar ? "↩ رجوع للسلة" : "↩ Back to basket" }];
}

export function lineButtons(line: { id: string; quantity: number }, ar: boolean): { id: string; title: string }[] {
  const less = { id: setTapId(line.id, line.quantity - 1), title: ar ? "➖ أنقص واحد" : "➖ One less" };
  const more = { id: setTapId(line.id, line.quantity + 1), title: ar ? "➕ زيد واحد" : "➕ One more" };
  const remove = { id: setTapId(line.id, 0), title: ar ? "🗑 شيله" : "🗑 Remove" };
  const back = { id: "BASKET", title: ar ? "🧺 السلة" : "🧺 Basket" };
  if (line.quantity <= 1) return [more, remove, back];
  if (line.quantity >= MAX_QTY) return [less, remove, back];
  return [less, more, remove];
}

/** Cheap pure pre-check so ordinary messages never cost a database read: does this text even start like a basket edit? */
export function maybeEditText(text: string): boolean {
  const t = normText(String(text ?? ""));
  if (!t || t.length > 80) return false;
  if (/^no(?:\s+(?:thanks|thank you|please|pls|plz|شكرا))?$/.test(t)) return false;
  return /^(?:please\s+)?(?:make|change|set|update|only|just|remove|delete|drop|cancel|take|get rid|no|without|i dont|i don t|dont|don t|i do not|do not|خلي|خليه|خليها|خليهم|شيل|شيلي|شيلو|شيلها|احذف|احذفو|احذفها|بلا|بدون|ما بدي|مابدي|khalli|khali|khalle|5alli|5ali|shil|shilo|sheel|sheelo|shayl|bala|bdun|ma badde|ma bade|mabade|ma bdi|ma baddi)(?=\s|$)/.test(t) || /\sx\s*\d{1,3}$/.test(t) || /\binstead$/.test(t);
}
