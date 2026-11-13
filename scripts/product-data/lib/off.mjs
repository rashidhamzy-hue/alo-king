// Open Food Facts by barcode (5.18). One request at a time, four seconds apart, as P1 found necessary from a GitHub runner.
// The fields asked for are the ones this task files; nothing else is read.
import { fetchRetry } from "./http.mjs";

export const OFF_API = "https://world.openfoodfacts.org/api/v2/product";
export const OFF_FIELDS = [
  "code", "product_name", "brands", "quantity", "lang", "last_modified_t",
  "ingredients_text", "ingredients_text_en", "ingredients_text_fr", "ingredients_text_ar",
  "allergens", "allergens_tags", "traces", "traces_tags", "labels_tags", "ingredients_analysis_tags",
  "nutriments", "nutrition_data_per",
].join(",");

const digits = (c) => String(c ?? "").replace(/\D/g, "");
const noZeros = (c) => digits(c).replace(/^0+/, "");

/** A product, or { found: false }. A failed request throws: it is an error, never "not found". */
export async function offLookup(barcode, { fetchImpl = fetch, wait = async () => {} } = {}) {
  const c = digits(barcode);
  if (c.length < 6) return { found: false, reason: "no_barcode" };
  await wait();
  const res = await fetchRetry(`${OFF_API}/${c}.json?fields=${OFF_FIELDS}`, {}, { fetchImpl, retries: 3, wait });
  if (res.status === 404) return { found: false, reason: "not_in_off" };
  if (!res.ok) throw new Error(`off_http_${res.status}`);
  const body = await res.json();
  if (body?.status === 0 || !body?.product) return { found: false, reason: "not_in_off" };
  // The product Open Food Facts returned must be the one asked for (it drops leading zeros).
  if (body.product.code && noZeros(body.product.code) !== noZeros(c)) return { found: false, reason: "code_mismatch" };
  return { found: true, code: c, product: body.product };
}

export const offPageUrl = (code) => `https://world.openfoodfacts.org/product/${digits(code)}`;

const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** The ingredient text to file: the pack's main language first, then English, French, Arabic. Returns { text, lang, field } or null. */
export function pickIngredients(p) {
  const main = tidy(p.ingredients_text);
  if (main) return { text: main, lang: tidy(p.lang) || null, field: "ingredients_text" };
  for (const l of ["en", "fr", "ar"]) {
    const t = tidy(p[`ingredients_text_${l}`]);
    if (t) return { text: t, lang: l, field: `ingredients_text_${l}` };
  }
  return null;
}

/** What Open Food Facts calls the item, kept beside the proposals so a person can see it is the right pack. */
export function offIdentity(p) {
  return { name: tidy(p.product_name) || null, brands: tidy(p.brands) || null, quantity: tidy(p.quantity) || null, last_modified: Number.isFinite(p.last_modified_t) ? new Date(p.last_modified_t * 1000).toISOString() : null };
}

export function offTexts(p) {
  return {
    ingredients: pickIngredients(p),
    ingredientsAr: tidy(p.ingredients_text_ar) || null,
    allergens: tidy(p.allergens),
    traces: tidy(p.traces),
    allergenTags: list(p.allergens_tags),
    traceTags: list(p.traces_tags),
    labelTags: list(p.labels_tags),
    analysisTags: list(p.ingredients_analysis_tags),
  };
}
