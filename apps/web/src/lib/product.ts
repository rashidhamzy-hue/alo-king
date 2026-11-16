// What a product page prints, built from the ONE read (web_catalog_product, 0218) and nothing else. The JSON-LD (lib/jsonld.ts) is built
// from this same view, so the page and the structured data can never disagree (docs/HANDOFF.md, LD1).
//   - only the fields of the item's own template: the database sends the food groups a template has (none for produce, water, cleaning,
//     beauty, baby care or pet) and the template's own fields; nothing of food's is ever added here
//   - a field that is not approved has no value: it reads "not confirmed yet" (value null). An approved one shows where it came from.
//   - nothing is judged: no rating, no praise, no health claim (invariant 14); unknown is never shown as safe or free (invariant 15)
import type { CatalogProduct } from "@ak/commerce/index";
import { certificateWord, fieldText, FIELD_LABELS, NUTRIENTS } from "./fields";
import { groupFacts, howText, sourceWord, type FactGroup } from "./facts";
import { nameIn, t, type Lang } from "./i18n";

type Ok = Extract<CatalogProduct, { ok: true }>;
export interface DetailRow { label: string; /** null: not confirmed yet */ value: string | null; /** where it came from; null with no value */ how: string | null }
export interface NutrientRow { key: string; label: string; value: string; num: number }
export interface ProductView {
  sku: string; name: string; altName: { text: string; lang: "ar" | "en" } | null;
  brand: string | null; size: string | null; gtin: string | null;
  price: number; /** false: the database holds no price yet (0), so no price is stated, on the page or in the data */ priced: boolean; inStock: boolean; hasPicture: boolean;
  /** The food groups the item's template has (ingredients, allergens, diet): empty for a template without food facts. */
  food: { show: boolean; groups: FactGroup[] };
  /** The typed panel, per 100 g or 100 ml, only for a fact-complete item; a number not printed is not a row. */
  nutrition: { per: string; rows: NutrientRow[]; how: string } | null;
  /** The template has a nutrition panel but none is confirmed yet. */
  nutritionNotConfirmed: boolean;
  claims: { claim: string; label: string; quote: string; how: string }[];
  details: DetailRow[];
}

/** "100g" is "100 g"; a value this does not know is shown as it came. */
const perText = (per: string): string => { const m = /^\s*(\d+(?:\.\d+)?)\s*(g|ml)\s*$/i.exec(per); return m ? `${m[1]} ${m[2]!.toLowerCase()}` : per; };

/** The name in the page's language: Arabic, the approved French name, or English. */
export const productName = (lang: Lang, p: { name_en: string; name_ar: string | null; name_fr?: string | null }): string =>
  lang === "fr" && p.name_fr ? p.name_fr : nameIn(lang, p.name_en, p.name_ar);

export function productView(lang: Lang, ok: Ok): ProductView {
  const p = ok.product; const tpl = ok.template;
  const groups = tpl.groups.length ? groupFacts(lang, ok.facts).filter((g) => (g.kind === "text" ? tpl.groups.includes("ingredients") : tpl.groups.includes(g.kind === "allergen" ? "allergens" : "diet"))) : [];

  const details: DetailRow[] = ok.fields.map((f) => {
    const label = FIELD_LABELS[f.key]?.[lang] ?? f.key.replace(/_/g, " ");
    const value = f.verified ? fieldText(lang, f) : null;
    return { label, value, how: value ? sourceWord(lang, f.source) || null : null };
  });
  for (const c of ok.certificates) {
    details.push({ label: t(lang, "certificate"), value: certificateWord(lang, c.kind) + (c.valid_until ? `, ${t(lang, "valid_until", { date: c.valid_until.slice(0, 10) })}` : ""), how: sourceWord(lang, "certificate") });
  }

  const n = ok.nutrition;
  const rows: NutrientRow[] = n ? NUTRIENTS.flatMap((x) => {
    const num = (n as unknown as Record<string, number | null>)[x.key];
    return typeof num === "number" ? [{ key: x.key, label: x.label[lang], value: `${num} ${x.unit}`, num }] : [];
  }) : [];
  const nutrition = n && rows.length ? { per: perText(n.per), rows, how: howText(lang, n.source, n.status, n.reviewed_at) } : null;

  return {
    sku: ok.product.sku,
    name: productName(lang, p),
    altName: p.name_ar && p.name_en ? (lang === "ar" ? { text: p.name_en, lang: "en" } : { text: p.name_ar, lang: "ar" }) : null,
    brand: p.brand, size: p.size, gtin: p.gtin,
    price: Number(p.price_usd), priced: Number(p.price_usd) > 0, inStock: p.in_stock, hasPicture: ok.picture !== null,
    food: { show: groups.length > 0 || tpl.groups.includes("nutrition"), groups },
    nutrition,
    nutritionNotConfirmed: tpl.groups.includes("nutrition") && nutrition === null,
    claims: ok.claims.map((c) => ({ claim: c.claim, label: nameIn(lang, c.name_en, c.name_ar), quote: c.quote, how: sourceWord(lang, c.source) })),
    details,
  };
}
