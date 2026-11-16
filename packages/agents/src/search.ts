// SR1: the one way the chat searches the hub's catalogue: find_products (0214), with meaning when it is allowed, and words alone otherwise.
//   1. find_products with the query alone: words, plus the query's cached embedding when there is one (one database call).
//   2. No cached embedding, an embedder, embeddings switched on and today's spend under the cap: embed the query (counted in model_costs)
//      and search again with it; the database caches it for next time.
//   3. Any failure of the embedding (timeout, error, cap): the words-only result of step 1 stands. The turn still answers.
// The website calls the same SQL function (web_catalog_search, 0216). Facts come back with each match as evidence with its source.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Embedder } from "./embeddings";
import { toVector } from "./embeddings";
import type { SearchFilters } from "./search-reading";

export interface Evidence { kind: "claim" | "nutrition" | "allergen" | "diet" | "field"; code?: string; quote?: string; key?: string; value?: unknown; per?: string; source?: string }
export interface Found {
  product_id: string; sku: string; name_en: string; name_ar: string | null; brand: string | null; sell_unit: string | null;
  source_id: string; source_name: string; source_kind: string; price_usd: number; available: number; unit_price: unknown;
  word_rank: number | null; meaning_rank: number | null; score: number; evidence: Evidence[];
}
export interface FindResult {
  matches: Found[]; reason: "no_match" | "none_pass" | null; failed: Record<string, number>; meaning: "given" | "cache" | "none";
  embedding?: { allowed: boolean; model: string | null } | null;
  /** How the meaning list was had, for the logs: cached, embedded now, or why not. */
  how?: "cache" | "embedded" | "off" | "cap" | "error" | "no_embedder" | "empty";
}

async function find(db: SupabaseClient, query: string, filters: SearchFilters, limit: number, embedding: string | null, model: string | null): Promise<FindResult> {
  const { data, error } = await db.rpc("find_products", { p_query: query, p_filters: filters, p_limit: limit, p_embedding: embedding, p_model: model, p_cache_key: null });
  if (error) throw new Error(`find_products: ${error.message}`);
  return data as FindResult;
}

export async function searchProducts(db: SupabaseClient, embedder: Embedder | undefined, query: string, filters: SearchFilters, limit = 6): Promise<FindResult> {
  const q = query.trim();
  const first = await find(db, q, filters, limit, null, null);
  if (first.meaning !== "none") return { ...first, how: "cache" };
  if (!q) return { ...first, how: "empty" };
  if (!embedder) return { ...first, how: "no_embedder" };
  const allowed = first.embedding;
  if (!allowed?.allowed || !allowed.model) return { ...first, how: allowed && (allowed as { enabled?: boolean }).enabled ? "cap" : "off" };
  try {
    const { vectors, tokens } = await embedder.embed(allowed.model, [q], "query");
    await db.rpc("record_embedding_cost", { p_model: allowed.model, p_step: "query", p_calls: 1, p_tokens: tokens }).then(() => undefined, () => undefined);
    const second = await find(db, q, filters, limit, toVector(vectors[0]!), allowed.model);
    return { ...second, how: "embedded" };
  } catch {
    return { ...first, how: "error" };
  }
}

/** One fact of a match, said with its source, in the customer's language (code writes it; the model never words a fact). */
export function factLine(e: Evidence, lang: string): string | null {
  const src = (s?: string) => (s === "brand_site" ? { en: "the brand's page says", fr: "la page de la marque indique", ar: "صفحة الماركة بتقول" }
                                                  : { en: "the pack says", fr: "l'emballage indique", ar: "مكتوب على العلبة" });
  const l = lang === "fr" ? "fr" : lang === "en" ? "en" : "ar";
  if (e.kind === "claim" && e.quote) return `${src(e.source)[l]} “${e.quote}”`;
  if (e.kind === "nutrition" && typeof e.value === "number") {
    const what = { sugars_g: { en: "sugar", fr: "sucres", ar: "سكر" }, protein_g: { en: "protein", fr: "protéines", ar: "بروتين" },
                   fat_g: { en: "fat", fr: "matières grasses", ar: "دهون" }, salt_g: { en: "salt", fr: "sel", ar: "ملح" } }[e.key ?? ""];
    if (!what) return null;
    const per = String(e.per ?? "100g").replace("100ml", "100 ml").replace("100g", "100 g");
    return l === "en" ? `the nutrition panel on the pack: ${e.value} g ${what.en} per ${per}`
         : l === "fr" ? `le tableau nutritionnel de l'emballage : ${e.value} g de ${what.fr} pour ${per}`
         : `جدول القيم الغذائية على العلبة: ${e.value} غ ${what.ar} بكل ${per.replace("g", "غ").replace("ml", "مل")}`;
  }
  if (e.kind === "allergen" && e.code) {
    const n = ALLERGEN_NAMES[e.code]?.[l] ?? e.code;
    return l === "en" ? `the pack's allergen list: no ${n}` : l === "fr" ? `liste des allergènes de l'emballage : sans ${n}` : `لائحة مسبّبات الحساسية على العلبة: بلا ${n}`;
  }
  return null;
}

const ALLERGEN_NAMES: Record<string, Record<"en" | "fr" | "ar", string>> = {
  gluten: { en: "gluten", fr: "gluten", ar: "غلوتين" }, crustaceans: { en: "crustaceans", fr: "crustacés", ar: "قشريات" }, eggs: { en: "eggs", fr: "œufs", ar: "بيض" },
  fish: { en: "fish", fr: "poisson", ar: "سمك" }, peanuts: { en: "peanuts", fr: "arachides", ar: "فول سوداني" }, soy: { en: "soy", fr: "soja", ar: "صويا" },
  milk: { en: "milk", fr: "lait", ar: "حليب" }, tree_nuts: { en: "tree nuts", fr: "fruits à coque", ar: "مكسرات" }, celery: { en: "celery", fr: "céleri", ar: "كرفس" },
  mustard: { en: "mustard", fr: "moutarde", ar: "خردل" }, sesame: { en: "sesame", fr: "sésame", ar: "سمسم" }, sulphites: { en: "sulphites", fr: "sulfites", ar: "كبريتيت" },
  lupin: { en: "lupin", fr: "lupin", ar: "ترمس" }, molluscs: { en: "molluscs", fr: "mollusques", ar: "رخويات" },
};
