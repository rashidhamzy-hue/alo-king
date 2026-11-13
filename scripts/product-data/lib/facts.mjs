// Turns what Open Food Facts says (and what the model mapped from its text) into proposals for propose_off_facts().
// Rules, all in code, none left to the model (CLAUDE.md invariant 15):
//   - a value is only ever one the source states; every proposal keeps the source text it came from;
//   - an allergen or diet value carries a quote that is a literal part of that text, and the quote has to be about that allergen;
//   - Open Food Facts never says "free", and an allergen it does not list is unknown (no proposal), not absent;
//   - the model's Arabic rendering is checked for script and for every number in the source, or dropped.
// Everything built here is a proposal. Nothing in this file can approve anything.
import { createHash } from "node:crypto";
import { ALLERGEN_CODES, OFF_ALLERGEN_TAGS, OFF_LABEL_DIET, OFF_ANALYSIS_DIET, quoteFitsAllergen } from "./vocab.mjs";
import { offPageUrl, offTexts, offIdentity } from "./off.mjs";

export const MAX_INGREDIENT_CHARS = 6000;
const ATTRIBUTION = "Open Food Facts contributors, Open Database Licence (ODbL) 1.0";

export const fingerprint = (...parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
const collapse = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// "may contain traces of ..." in the languages of the packs. A quote inside such a clause is may_contain, whatever field it came from.
const MAY_CONTAIN = /may contain|might contain|traces?|peut contenir|pourrait contenir|قد يحتوي|يحتوي على آثار|آثار/i;

/** Where the quote sits decides contains / may_contain: a "may contain" marker within the 80 characters before it. */
export function valueForQuote(field, source, quote) {
  if (field === "traces") return "may_contain";
  const low = source.toLowerCase(); const i = low.indexOf(quote.toLowerCase());
  if (i < 0) return null;
  return MAY_CONTAIN.test(low.slice(Math.max(0, i - 80), i + quote.length)) ? "may_contain" : "contains";
}

const ARABIC_INDIC = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "٫": ".", "٬": "" };
const numbersIn = (s) => (String(s).replace(/[٠-٩٫٬]/g, (c) => ARABIC_INDIC[c]).replace(/(\d),(\d)/g, "$1.$2").match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));

/** The model's Arabic rendering of an ingredient list: Arabic script, a plausible length, and every number of the source kept. */
export function checkArabicRendering(source, ar) {
  const t = collapse(String(ar ?? "").replace(/_/g, ""));
  if (t.length < 3) return { ok: false, reason: "empty" };
  if (t.length > MAX_INGREDIENT_CHARS * 2) return { ok: false, reason: "too_long" };
  const letters = t.match(/\p{L}/gu) ?? []; const arabic = t.match(/\p{Script=Arabic}/gu) ?? [];
  if (!letters.length || arabic.length / letters.length < 0.5) return { ok: false, reason: "not_arabic" };
  const have = new Set(numbersIn(t));
  const lost = [...new Set(numbersIn(source))].filter((n) => !have.has(n));
  if (lost.length) return { ok: false, reason: `numbers_lost:${lost.slice(0, 5).join(",")}` };
  const ratio = t.length / Math.max(1, collapse(source).length);
  if (ratio < 0.25 || ratio > 3.5) return { ok: false, reason: "length_implausible" };
  return { ok: true, text: t };
}

export function isMostlyArabic(s) {
  const letters = String(s).match(/\p{L}/gu) ?? []; const arabic = String(s).match(/\p{Script=Arabic}/gu) ?? [];
  return letters.length > 0 && arabic.length / letters.length >= 0.5;
}

/** A word that mixes Arabic and Latin letters (a model glitch such as "كellogg's"). A whole Latin word (UHT, 35.1%) is fine. */
export function hasMixedScriptWord(s) {
  return String(s ?? "").split(/[\s\-/،,()]+/).some((w) => /\p{Script=Arabic}/u.test(w) && /[A-Za-z]/.test(w));
}

const NUTRIMENTS = [
  ["energy-kcal_100g", "energy_kcal", "kcal"], ["energy-kj_100g", "energy_kj", "kJ"], ["fat_100g", "fat", "g"], ["saturated-fat_100g", "saturated_fat", "g"],
  ["carbohydrates_100g", "carbohydrates", "g"], ["sugars_100g", "sugars", "g"], ["fiber_100g", "fiber", "g"], ["proteins_100g", "proteins", "g"],
  ["salt_100g", "salt", "g"], ["sodium_100g", "sodium", "g"],
];

/** The nutrition panel as Open Food Facts states it per 100 g. Numbers only; nothing is computed or filled in. */
export function nutritionFrom(nutriments) {
  const n = nutriments && typeof nutriments === "object" ? nutriments : {};
  const values = {}; const units = {}; const raw = {};
  for (const [key, name, unit] of NUTRIMENTS) {
    const v = n[key];
    const num = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (!Number.isFinite(num) || num < 0) continue;
    values[name] = Math.round(num * 1000) / 1000; units[name] = unit; raw[key] = v;
  }
  const macros = ["fat", "carbohydrates", "proteins"].filter((k) => k in values);
  if (!("energy_kcal" in values) && !("energy_kj" in values) && macros.length < 3) return { ok: false, reason: "too_few_values" };
  for (const [k, v] of Object.entries(values)) {
    if (units[k] === "g" && v > 100) return { ok: false, reason: `implausible:${k}` };
  }
  if ((values.energy_kcal ?? 0) > 900 || (values.energy_kj ?? 0) > 3800) return { ok: false, reason: "implausible:energy" };
  if ((values.fat ?? 0) + (values.carbohydrates ?? 0) + (values.proteins ?? 0) > 101) return { ok: false, reason: "implausible:sum" };
  return { ok: true, values, units, sourceText: JSON.stringify(raw) };
}

/**
 * One product's proposals. `product` is Open Food Facts' record, `mapping` is what the model read out of its text
 * ({ allergens: [{ code, value, field, quote }], ingredients_ar }). Returns { facts, rejected }.
 */
export function buildFacts({ code, product, mapping = {}, runId, fetchedAt, model }) {
  const t = offTexts(product); const identity = offIdentity(product);
  const facts = []; const rejected = [];
  const base = { off_code: code, off_url: offPageUrl(code), off: identity, attribution: `${ATTRIBUTION}, ${offPageUrl(code)}`, fetched_at: fetchedAt, run_id: runId };
  const push = (attribute, value, detail) => facts.push({ attribute, value, detail: { ...base, ...detail, fingerprint: fingerprint(attribute, value, detail.source_text, detail.ar ?? "") } });

  // 1. Allergens from Open Food Facts' own tags. A fixed table, no model.
  const found = new Map();                       // our code -> { value, ...detail }
  const unmapped = [];
  for (const [tags, value, field] of [[t.allergenTags, "contains", "allergens_tags"], [t.traceTags, "may_contain", "traces_tags"]]) {
    const source = `${field}: ${tags.join(", ")}`;
    for (const tag of tags) {
      const c = OFF_ALLERGEN_TAGS[tag.toLowerCase()];
      if (!c) { unmapped.push(tag); continue; }
      if (found.get(c)?.value === "contains") continue;
      found.set(c, { value, detail: { source_field: field, source_text: source, quote: tag, basis: "off_tag" } });
    }
  }
  // 2. Allergens the model read out of the free text. Each must quote the text, and the quote must be about that allergen.
  const sources = { allergens: collapse(t.allergens), traces: collapse(t.traces), ingredients: collapse(t.ingredients?.text) };
  for (const m of Array.isArray(mapping.allergens) ? mapping.allergens : []) {
    const c = String(m?.code ?? ""); const field = String(m?.field ?? "");
    const fail = (reason) => rejected.push({ kind: "allergen", code: c, field, quote: String(m?.quote ?? "").slice(0, 80), reason });
    if (!ALLERGEN_CODES.includes(c)) { fail("unknown_code"); continue; }
    if (!(field in sources) || !sources[field]) { fail("no_such_text"); continue; }
    const quote = collapse(String(m?.quote ?? "")).replace(/^[\s"'“”_*]+|[\s"'“”_*]+$/g, "");
    if (quote.length < 2 || quote.length > 120) { fail("quote_length"); continue; }
    if (!sources[field].toLowerCase().includes(quote.toLowerCase())) { fail("quote_not_in_source"); continue; }
    if (!quoteFitsAllergen(c, quote)) { fail("quote_not_about_allergen"); continue; }
    const value = valueForQuote(field, sources[field], quote);
    if (value !== m?.value) { fail(`value_disagrees_with_text:${m?.value}->${value}`); continue; }
    const have = found.get(c);
    if (have && (have.value === "contains" || value === "may_contain")) continue;     // the tag already says as much or more
    found.set(c, { value, detail: { source_field: field, source_text: sources[field], quote, basis: "text_mapped_by_model", mapped_by: model ?? null } });
  }
  for (const c of ALLERGEN_CODES) if (found.has(c)) { const f = found.get(c); push(c, f.value, f.detail); }

  // 3. Ingredients, with the source text beside the Arabic rendering.
  if (t.ingredients) {
    const text = collapse(t.ingredients.text);
    if (text.length > MAX_INGREDIENT_CHARS) rejected.push({ kind: "ingredients", reason: "too_long" });
    else {
      let ar = null; let arBy = null;
      if (t.ingredientsAr) { ar = t.ingredientsAr; arBy = "open_food_facts"; }
      else if (isMostlyArabic(text)) { ar = text; arBy = "open_food_facts"; }       // already Arabic: nothing to render
      else if (mapping.ingredients_ar) {
        const chk = checkArabicRendering(text, mapping.ingredients_ar);
        if (chk.ok) { ar = chk.text; arBy = "model"; } else rejected.push({ kind: "ingredients_ar", reason: chk.reason });
      }
      push("ingredients", null, { source_field: t.ingredients.field, source_text: text, lang: t.ingredients.lang, text, ar, ar_by: arBy, ar_model: arBy === "model" ? (model ?? null) : null,
        note: "Source text is Open Food Facts' own, not checked against the pack. A model wrote the Arabic rendering when ar_by is model." });
    }
  }

  // 4. Nutrition panel, numbers as stated.
  const nut = nutritionFrom(product.nutriments);
  if (nut.ok) push("nutrition", null, { source_field: "nutriments", source_text: nut.sourceText, per: "100g", values: nut.values, units: nut.units, nutrition_data_per: product.nutrition_data_per ?? null,
    note: "Open Food Facts gives per-100 g values; for a drink read them as per 100 ml. Check against the pack." });
  else if (product.nutriments && Object.keys(product.nutriments).length) rejected.push({ kind: "nutrition", reason: nut.reason });

  // 5. Diet labels: a label claim, or Open Food Facts' own reading of the ingredient list. A conflict is unknown.
  const diet = new Map();
  const claim = (tags, table, basis, field) => {
    const source = `${field}: ${tags.join(", ")}`;
    for (const tag of tags) {
      const hit = table[tag.toLowerCase()]; if (!hit) continue;
      const [attr, value] = hit; const list = diet.get(attr) ?? []; list.push({ value, basis, quote: tag, source_field: field, source_text: source }); diet.set(attr, list);
    }
  };
  claim(t.labelTags, OFF_LABEL_DIET, "off_label_claim", "labels_tags");
  claim(t.analysisTags, OFF_ANALYSIS_DIET, "off_ingredient_analysis", "ingredients_analysis_tags");
  for (const [attr, list] of diet) {
    if (new Set(list.map((x) => x.value)).size > 1) { rejected.push({ kind: "diet", code: attr, reason: "sources_disagree" }); continue; }
    const pick = list.find((x) => x.basis === "off_label_claim") ?? list[0];
    push(attr, pick.value, { source_field: pick.source_field, source_text: pick.source_text, quote: pick.quote, basis: pick.basis });
  }
  return { facts, rejected, unmapped_tags: unmapped };
}
