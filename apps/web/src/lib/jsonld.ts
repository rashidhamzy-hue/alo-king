// Structured data for the website (schema.org), built from the same view the page prints (lib/product.ts), which is built from the one
// read (web_catalog_product, 0218). So a price, a stock state, a barcode, a size, a number or a claim in the data is always the one on the page.
//   - name in the page's language; image only when the item has an approved picture the Worker holds; brand only when there is one
//   - gtin only when the database says it is a real GTIN (never the store's own or weighed-goods code)
//   - one Offer in USD with availability from stock (the price and stock are the page's: invariant 7); none while no price is entered
//   - nutrition (NutritionInformation) and printed claims only when the database sent them: approved, and the item fact-complete
//   - no person's name, no evidence, no picture credit: none of it is in the view
import type { CatalogProduct } from "@ak/commerce/index";
import { NUTRIENTS } from "./fields";
import { productName, productView, type ProductView } from "./product";
import { t, type Lang } from "./i18n";

type Ok = Extract<CatalogProduct, { ok: true }>;
type Json = Record<string, unknown>;

/** schema.org properties for the nutrients it has. Salt has none (it has sodium, which is not the same number), so salt stays on the page only. */
const SCHEMA_NUTRIENT: Record<string, string> = {
  energy_kcal: "calories", fat_g: "fatContent", saturated_fat_g: "saturatedFatContent", carbohydrate_g: "carbohydrateContent",
  sugars_g: "sugarContent", protein_g: "proteinContent", fibre_g: "fiberContent",
};

export function productJsonLd(lang: Lang, ok: Ok, o: { origin: string; imageUrl: string | null }, view: ProductView = productView(lang, ok)): Json {
  const ld: Json = { "@context": "https://schema.org", "@type": "Product", name: view.name, sku: view.sku };
  if (o.imageUrl && view.hasPicture) ld.image = o.imageUrl;
  if (view.brand) ld.brand = { "@type": "Brand", name: view.brand };
  if (view.gtin) ld.gtin = view.gtin;
  if (view.size) ld.size = view.size;
  if (view.nutrition) {
    const nut: Json = { "@type": "NutritionInformation", servingSize: view.nutrition.per };
    for (const x of NUTRIENTS) {
      const row = view.nutrition.rows.find((r) => r.key === x.key); const prop = SCHEMA_NUTRIENT[x.key];
      if (row && prop) nut[prop] = row.value;
    }
    ld.nutrition = nut;
  }
  if (view.claims.length) ld.additionalProperty = view.claims.map((c) => ({ "@type": "PropertyValue", name: t(lang, "claims_title"), value: c.quote }));
  // An item with no price entered yet (the database holds 0) states no Offer: a price of 0 would tell a search engine it is free.
  if (view.priced) ld.offers = {
    "@type": "Offer", url: `${o.origin}/p/${encodeURIComponent(view.sku)}`, price: view.price.toFixed(2), priceCurrency: "USD",
    availability: `https://schema.org/${view.inStock ? "InStock" : "OutOfStock"}`,
  };
  return ld;
}

/** A category page's ItemList: what the page lists, in its order, each with its address and its name in the page's language. */
export function categoryJsonLd(lang: Lang, c: { name: string; path: string; cards: { sku: string; name_en: string; name_ar: string | null; name_fr?: string | null }[] }, origin: string): Json {
  return {
    "@context": "https://schema.org", "@type": "ItemList", name: c.name, url: `${origin}${c.path}`, numberOfItems: c.cards.length,
    itemListElement: c.cards.map((x, i) => ({ "@type": "ListItem", position: i + 1, url: `${origin}/p/${encodeURIComponent(x.sku)}`, name: productName(lang, x) })),
  };
}

/** The text of a `<script type="application/ld+json">`: JSON in which nothing can close the tag or end the line early. */
export const jsonLdScript = (v: unknown): string =>
  JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
