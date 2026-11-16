// SR1: scores search results on the request set (evals/search/requests.json) against the seeded test facts (facts.json).
// The fact check here is written apart from the search's own SQL on purpose: a returned item is judged by the test facts as written,
// so a bug in find_products' filters shows up as a fact failure instead of agreeing with itself. The thresholds are the regulation's
// (EU 1924/2006 nutrition claims), the same numbers settings.search holds (0213).
import facts from "./facts.json";
import requests from "./requests.json";
import baskets from "./baskets.json";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Lang = "ar" | "arabizi" | "en" | "fr";
export interface Filters {
  sugar?: "none" | "low"; protein?: "high"; fat?: "low" | "none"; salt?: "low" | "none";
  nutrients?: { key: string; max?: number; min?: number }[]; claims?: string[]; free_of?: string[]; diet?: string[];
  species?: string; life_stage?: string[]; age_months?: number; audience?: "kids" | "baby" | "adult";
  tags?: string[]; max_price_usd?: number;
}
export interface Request {
  id: string; lang: Lang; kind: string; text: string; filters?: Filters; count?: number; prefer_tags?: string[]; note?: string;
  expect: { type: "products" | "kind" | "nothing"; skus?: string[]; kind?: string };
}
export const REQUESTS = (requests as unknown as { requests: Request[] }).requests;
export interface Basket {
  id: string; lang: Lang; text: string; filters?: Filters;
  basket: { type: "dish" | "lunchbox" | "budget"; dish?: string; people?: number; children?: number; days?: number; theme?: string; max_usd?: number };
  expect: { kinds?: string[]; max_usd?: number; min_items?: number; tag?: string; missing_kinds?: string[]; refused?: string };
}
export const BASKETS = (baskets as unknown as { baskets: Basket[] }).baskets;

interface Item { sku: string; kind?: string; tags?: string[]; nutrition?: Record<string, number>; allergens?: Record<string, string>;
  diet?: Record<string, string>; claims?: [string, string][]; fields?: Record<string, unknown> }
const ITEMS = new Map((facts as unknown as { items: Item[] }).items.map((i) => [i.sku, i]));

// The template of a SKU, by category, as 0203 maps it (seed catalogue and the invented test items).
const CATEGORY_TEMPLATE: Record<string, string> = {
  "Fruits & Vegetables": "fresh_produce", "Meat & Poultry": "meat_poultry", "Bakery": "bakery", "Water": "water",
  "Cleaning & Household": "cleaning_household", "Beauty & Personal Care": "beauty_personal_care", "Baby & Child": "baby_child", "Pet Zone": "pet",
};
const categoryOf = new Map<string, string>();
{
  const csv = readFileSync(fileURLToPath(new URL("../../supabase/seed/catalog.csv", import.meta.url)), "utf8");
  for (const line of csv.split("\n").slice(1)) {
    const m = line.match(/^(AK-\d{4}),/); if (!m) continue;
    // the category is the fourth column; names may hold quoted commas, so read the row properly
    const cells: string[] = []; let cell = "", q = false;
    for (const c of line) { if (q) { if (c === '"') q = false; else cell += c; } else if (c === '"') q = true; else if (c === ",") { cells.push(cell); cell = ""; } else cell += c; }
    cells.push(cell);
    categoryOf.set(m[1]!, cells[3]!);
  }
  for (const p of (facts as unknown as { products: { sku: string; category: string }[] }).products) categoryOf.set(p.sku, p.category);
}
export const templateOf = (sku: string): string => CATEGORY_TEMPLATE[categoryOf.get(sku) ?? ""] ?? "packaged_food";
const FOOD = new Set(["packaged_food", "fresh_produce", "meat_poultry", "bakery", "water", "baby_food"]);
const NONFOOD_REQUIRED: Record<string, string[]> = {
  baby_child: ["age_range"], beauty_personal_care: ["inci_ingredients", "age_group"], pet: ["species", "life_stage"], cleaning_household: ["hazard_warnings"],
};

/** Fact-complete by the test facts: a packaged food with its panel (and so its allergens and ingredients), a non-food item with its template's fields. */
export function factComplete(sku: string): boolean {
  const it = ITEMS.get(sku); if (!it) return false;
  const t = templateOf(sku);
  if (t === "packaged_food") return !!it.nutrition;
  const req = NONFOOD_REQUIRED[t];
  return !!req && req.every((k) => it.fields?.[k] !== undefined);
}
const hasClaim = (it: Item, ...codes: string[]) => (it.claims ?? []).some(([c]) => codes.includes(c));
const num = (it: Item, k: string): number | null => (it.nutrition && typeof it.nutrition[k] === "number" ? it.nutrition[k]! : null);
const NUTRIENT_KEY: Record<string, string> = { sugars_g: "sugars", protein_g: "proteins", fat_g: "fat", salt_g: "salt", energy_kcal: "energy_kcal", saturated_fat_g: "saturated_fat", fibre_g: "fibre" };
const range = (v: unknown): [number, number] | null => {
  const m = String(v ?? "").match(/^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

/** Is this a fact filter (anything an approved record must answer)? Tags and a price ceiling are not facts. */
export function asksFacts(f: Filters | undefined): boolean {
  if (!f) return false;
  return !!(f.sugar || f.protein || f.fat || f.salt || f.nutrients?.length || f.claims?.length || f.free_of?.length || f.diet?.length
            || f.species || f.life_stage?.length || f.age_months !== undefined || f.audience);
}

/** Does the SKU pass every filter, by the test facts? Unknown never passes. The reason when it does not. */
export function passes(sku: string, f: Filters | undefined): { ok: boolean; why?: string } {
  if (!f || !asksFacts(f)) return { ok: true };
  const it = ITEMS.get(sku);
  const t = templateOf(sku);
  // an audience on a food item is a shopping preference (tags), never a fact; alone, it asks nothing of a food item
  const onlyAudience = f.audience && !asksFacts({ ...f, audience: undefined });
  if (onlyAudience && FOOD.has(t)) return { ok: true };
  if (!it || !factComplete(sku)) return { ok: false, why: "not_fact_complete" };
  const food = FOOD.has(t);
  const foodAsked = f.sugar || f.protein || f.fat || f.salt || f.nutrients?.length || f.free_of?.length || f.diet?.length;
  if (foodAsked && !food) return { ok: false, why: "not_food" };
  if (f.sugar === "none" && !(hasClaim(it, "sugar_free", "no_added_sugar") || (num(it, "sugars") ?? 99) <= 0.5)) return { ok: false, why: "sugar" };
  if (f.sugar === "low" && !(hasClaim(it, "sugar_free", "no_added_sugar", "low_sugar") || (num(it, "sugars") ?? 99) <= 5)) return { ok: false, why: "sugar" };
  if (f.protein === "high") {
    const p = num(it, "proteins"), e = num(it, "energy_kcal");
    if (!(hasClaim(it, "high_protein") || (p !== null && e !== null && e > 0 && (p * 4) / e >= 0.2))) return { ok: false, why: "protein" };
  }
  if (f.fat === "low" && !(hasClaim(it, "low_fat", "fat_free") || (num(it, "fat") ?? 99) <= 3)) return { ok: false, why: "fat" };
  if (f.fat === "none" && !(hasClaim(it, "fat_free") || (num(it, "fat") ?? 99) <= 0.5)) return { ok: false, why: "fat" };
  if (f.salt === "low" && !(hasClaim(it, "low_salt", "unsalted") || (num(it, "salt") ?? 99) <= 0.3)) return { ok: false, why: "salt" };
  if (f.salt === "none" && !(hasClaim(it, "unsalted") || (num(it, "salt") ?? 99) <= 0.0125)) return { ok: false, why: "salt" };
  for (const n of f.nutrients ?? []) {
    const v = num(it, NUTRIENT_KEY[n.key] ?? n.key);
    if (v === null || (n.max !== undefined && v > n.max) || (n.min !== undefined && v < n.min)) return { ok: false, why: n.key };
  }
  for (const c of f.claims ?? []) if (!hasClaim(it, c)) return { ok: false, why: `claim:${c}` };
  for (const a of f.free_of ?? []) if ((it.allergens?.[a] ?? "free") !== "free") return { ok: false, why: `allergen:${a}` };
  for (const d of f.diet ?? []) if (it.diet?.[d] !== "yes") return { ok: false, why: `diet:${d}` };
  if (f.species && it.fields?.species !== f.species) return { ok: false, why: "species" };
  if (f.life_stage?.length && !f.life_stage.includes(String(it.fields?.life_stage))) return { ok: false, why: "life_stage" };
  if (f.age_months !== undefined) {
    const r = range(it.fields?.age_range);
    if (!r || f.age_months < r[0] || f.age_months > r[1]) return { ok: false, why: "age" };
  }
  if (f.audience === "kids" && !food) {
    const r = range(it.fields?.age_range), g = it.fields?.age_group;
    const ok = r ? r[0] <= 144 && r[1] >= 12 : ["kids", "baby", "all"].includes(String(g));
    if (!ok) return { ok: false, why: "audience" };
  }
  return { ok: true };
}

export interface Scored { id: string; lang: Lang; kind: string; right: boolean; returned: string[]; factFails: { sku: string; why: string }[] }
/** One request: right when a wanted SKU is in the first five (or nothing came back for "nothing fits"); every returned item checked. */
export function scoreRequest(r: Request, returned: string[]): Scored {
  const top5 = returned.slice(0, 5);
  const right = r.expect.type === "nothing" ? returned.length === 0 : top5.some((s) => (r.expect.skus ?? []).includes(s));
  const factFails = returned.map((sku) => ({ sku, ...passes(sku, r.filters) })).filter((x) => !x.ok).map((x) => ({ sku: x.sku, why: x.why ?? "?" }));
  return { id: r.id, lang: r.lang, kind: r.kind, right, returned, factFails };
}
export interface Summary { n: number; right: number; share: number; fact_fails: number; nothing_right: string }
export function summarise(xs: Scored[], reqs: Request[] = REQUESTS): Summary & { by_lang: Record<string, Summary>; by_kind: Record<string, Summary> } {
  const one = (ys: Scored[]): Summary => {
    const nothing = ys.filter((y) => reqs.find((r) => r.id === y.id)?.expect.type === "nothing");
    return { n: ys.length, right: ys.filter((y) => y.right).length, share: ys.length ? Math.round((ys.filter((y) => y.right).length / ys.length) * 1000) / 1000 : 0,
             fact_fails: ys.reduce((a, y) => a + y.factFails.length, 0), nothing_right: `${nothing.filter((y) => y.right).length}/${nothing.length}` };
  };
  const group = (key: (s: Scored) => string) => Object.fromEntries([...new Set(xs.map(key))].sort().map((k) => [k, one(xs.filter((x) => key(x) === k))]));
  return { ...one(xs), by_lang: group((x) => x.lang), by_kind: group((x) => x.kind) };
}
export function table(title: string, s: ReturnType<typeof summarise>): string {
  const row = (k: string, v: Summary) => `| ${k} | ${v.n} | ${v.right} | ${v.share.toFixed(3)} | ${v.fact_fails} | ${v.nothing_right} |`;
  return [`### ${title}`, "", "| | requests | right in first five | share | returned items failing a fact filter | nothing fits answered |", "| --- | --- | --- | --- | --- | --- |",
    row("all", s), ...Object.entries(s.by_lang).map(([k, v]) => row(k, v)), ...Object.entries(s.by_kind).map(([k, v]) => row(`kind: ${k}`, v)), ""].join("\n");
}
