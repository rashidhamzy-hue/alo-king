// Build plan 1.23 (session B4): the language-pack rules of 1.22, for one product at a time in the Worker. The same rules as
// evals/language/build-pack.mjs, which built the shipped pack; evals/language/pack-rules.test.ts proves the two agree on every
// term of the 1.22 pack. Folding is catalog_tokens() (0053) exactly. Pure: no database, no model.
// The cross-product rules (an exact term two products claim names neither; an exact term that is another product's kind word is
// kind; a kind term that is a brand is dropped) need the whole pack, so save_search_words() (0076) applies them in SQL.

const FOLD: Record<string, string> = { "أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه", "ؤ": "و", "ئ": "ي" };
export const fold = (s: string | null | undefined) => [...(s ?? "")].map((c) => FOLD[c] ?? c).join("").replace(/[ً-ْـ]/g, "").toLowerCase().trim();
export function tokens(s: string | null | undefined): string[] {
  return fold(s).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/([0-9])([ء-يٱ-ۓ])/g, "$1 $2").replace(/([ء-يٱ-ۓ])([0-9])/g, "$1 $2")
    .replace(/([0-9])(ml|cl|l|lt|ltr|litre|liter|g|gr|kg|cm|pcs|pc|x)(?![0-9a-zÀ-ɏ])/g, "$1 $2").replace(/(?<![0-9a-zÀ-ɏ])x([0-9])/g, "x $1")
    .replace(/[^0-9a-zÀ-ɏء-يٱ-ۓ]+/g, " ").trim().split(/\s+/).filter(Boolean);
}
export const termKey = (s: string) => tokens(s).join(" ");

// Food-fact words: [the English word that, printed in the name, allows it; the forms refused otherwise]. Invariant 15.
const FOOD: [string, string[]][] = [
  ["halal", ["halal", "حلال", "7alal", "halel"]], ["gluten", ["gluten", "غلوتين", "جلوتين", "غلوتن"]],
  ["vegan", ["vegan", "végan", "فيغان", "فيجان", "نباتي", "نباتية", "vegetarian", "végétarien", "vegetarien"]],
  ["healthy", ["healthy", "صحي", "صحية", "sain", "santé", "sihhi", "se7e", "se7i"]],
  ["diet", ["diet", "دايت", "رجيم", "regime", "régime", "rejim"]], ["light", ["light", "لايت", "allégé", "allege"]],
  ["sugar", ["sugar", "سكر", "sucre", "sukkar", "sokkar", "zero", "زيرو"]], ["fat", ["fat", "دسم", "دسمة", "قليل الدسم", "écrémé", "ecreme", "demi"]],
  ["lactose", ["lactose", "لاكتوز"]], ["allergy", ["allergy", "allergie", "حساسية", "7asesiyye"]],
  ["calorie", ["calorie", "calories", "كالوري", "سعرات", "سعرة"]], ["protein", ["protein", "بروتين", "protéine"]],
  ["organic", ["organic", "bio", "عضوي", "عضوية"]], ["fasting", ["fasting", "صيامي", "صيام", "carême"]], ["keto", ["keto", "كيتو"]],
];
const KIND_NAMES = ["زيت نباتي", "زيت نباتية", "سمنة نباتية", "سمنة نباتي", "vegetable oil", "huile vegetale"].map((t) => tokens(t).join(" "));
const NON_FOOD = new Set(["Cleaning & Household", "Beauty & Personal Care", "Baby & Child", "Pet Zone"]);
const ALSO: Record<string, string[]> = { fat: ["entier", "écrémé", "ecreme", "demi", "low fat", "full fat"] };

/** The food-fact word a term states, unless it is printed in the product's name; null when the term may ship. */
export function foodWord(term: string, nameEn: string | null | undefined, category: string | null | undefined): string | null {
  if (category && NON_FOOD.has(category)) return null;
  const k = tokens(term).join(" ");
  if (KIND_NAMES.some((n) => k === n || k.startsWith(n + " ") || k.endsWith(" " + n))) return null;
  const ks = new Set(tokens(term)); const name = (nameEn ?? "").toLowerCase();
  for (const [allowedBy, forms] of FOOD) {
    const hit = forms.find((f) => { const ft = tokens(f); return ft.length > 0 && ft.every((t) => ks.has(t)); });
    if (hit && !name.includes(allowedBy) && !name.includes(hit) && !(ALSO[allowedBy] ?? []).some((w) => name.includes(w))) return allowedBy;
  }
  return null;
}

export type Level = "kind" | "brand" | "exact";
export type Lang = "ar" | "arabizi" | "en" | "fr";
export interface ProposedTerm { t: string; lang?: string }
export interface Proposed { kind?: ProposedTerm[]; brand?: ProposedTerm[]; exact?: ProposedTerm[] }
export interface PackRow { sku: string; term: string; level: Level; lang: Lang }
export interface Dropped { food: { term: string; food: string }[]; empty: number; brand_as_kind: string[] }

/**
 * One product's proposed terms -> the rows that may be written, before the cross-product rules. Same per-term rules as
 * buildPack(): at most five words, no food-fact word not printed in the name, and a kind term that is one of the product's own
 * brand terms is dropped (the SQL drops a kind term that is any product's brand).
 */
export function productRows(sku: string, product: { name: string; category: string | null }, proposed: Proposed): { rows: PackRow[]; dropped: Dropped } {
  const dropped: Dropped = { food: [], empty: 0, brand_as_kind: [] };
  const rows: PackRow[] = [];
  for (const level of ["kind", "brand", "exact"] as const) for (const t of proposed[level] ?? []) {
    const term = String(t?.t ?? "").trim().replace(/\s+/g, " ");
    if (!termKey(term) || tokens(term).length > 5) { dropped.empty++; continue; }
    const food = foodWord(term, product.name, product.category);
    if (food) { dropped.food.push({ term, food }); continue; }
    rows.push({ sku, term, level, lang: (["ar", "arabizi", "en", "fr"] as const).includes(t.lang as Lang) ? (t.lang as Lang) : "ar" });
  }
  const brandKeys = new Set(rows.filter((r) => r.level === "brand").map((r) => termKey(r.term)));
  const seen = new Set<string>();
  const out = rows.filter((r) => {
    if (r.level === "kind" && brandKeys.has(termKey(r.term))) { dropped.brand_as_kind.push(r.term); return false; }
    const id = `${r.level}|${r.term}`;
    if (seen.has(id)) return false;
    seen.add(id); return true;
  });
  return { rows: out, dropped };
}
