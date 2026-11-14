// Reads one research file (data/research/AK-nnnn.json, written by sessions R1-R3; shape in data/research/README.md) and turns
// what it says into proposals for propose_web_facts() (migration 0071). No model is used here: a value is only ever one the
// file states, with the page it was read on.
// Rules, all in code (CLAUDE.md invariants 14 and 15):
//   - every value keeps its page address (https) and the market the page is for (null when the file does not say);
//   - an allergen is proposed only when the file carries the literal quote, the quote is about that allergen, and its wording
//     agrees with contains / may contain. A page never says "free" here: an allergen it does not list is unknown, not absent;
//   - a diet label is proposed only for halal, vegetarian and vegan, as "yes", with the pack's own words as its basis.
//     "Gluten free" and "lactose free" are "free" statements and are recorded from the pack at intake (as N1 decided for
//     Open Food Facts); "organic" has no attribute. They are reported, not proposed;
//   - nutrition is the stated per-100 numbers only. A per-serving panel is not converted, so it is not proposed;
//   - a file whose match is "unsure" gives no facts.
// The research file is input written elsewhere: every field is checked for type and length, and anything odd is left out.
import { createHash } from "node:crypto";
import { ALLERGEN_CODES, quoteFitsAllergen, fold } from "./vocab.mjs";
import { fingerprint } from "./facts.mjs";

export const MAX_TEXT = 6000;
export const MAX_PICTURES = 5;
const SKU = /^AK-\d{4}$/;
const collapse = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const str = (v, max = 400) => (typeof v === "string" && collapse(v) !== "" ? collapse(v).slice(0, max) : null);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const digits = (s) => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");

/** An https address on a public host, or null. */
export function httpsUrl(v) {
  if (typeof v !== "string" || v.length > 2000 || /\s/.test(v.trim())) return null;
  try {
    const u = new URL(v.trim());
    const h = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || !h.includes(".") || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.endsWith(".local") || h.endsWith(".internal")) return null;
    return u.href;
  } catch { return null; }
}

export const fileSha = (text) => createHash("sha256").update(text).digest("hex");

/** Parses and checks one file. Returns { ok, sku, sha, file } or { ok: false, reason }. `name` is the file's name (AK-0123.json). */
export function readResearch(name, text) {
  const m = /^(AK-\d{4})\.json$/.exec(name);
  if (!m) return { ok: false, reason: "file_name" };
  let file;
  try { file = JSON.parse(text); } catch { return { ok: false, reason: "not_json" }; }
  if (!obj(file)) return { ok: false, reason: "not_an_object" };
  if (!SKU.test(String(file.sku ?? "")) || file.sku !== m[1]) return { ok: false, reason: "sku_does_not_match_file_name" };
  return { ok: true, sku: m[1], sha: fileSha(text), file };
}

/** The picture candidates of a file, best first as the researcher ordered them, at most five, each with its page. */
export function pictureCandidates(file) {
  const out = []; const dropped = [];
  for (const p of Array.isArray(file.pictures) ? file.pictures : []) {
    if (out.length >= MAX_PICTURES) { dropped.push({ reason: "more_than_five" }); continue; }
    const imageUrl = httpsUrl(obj(p)?.image_url); const pageUrl = httpsUrl(obj(p)?.page_url);
    if (!imageUrl) { dropped.push({ reason: "no_https_picture_address" }); continue; }
    if (!pageUrl) { dropped.push({ reason: "no_https_page_address", image_url: imageUrl }); continue; }
    if (out.some((x) => x.imageUrl === imageUrl)) continue;
    const kind = ["brand", "retailer", "open_food_facts", "other"].includes(p.site_kind) ? p.site_kind : "other";
    out.push({ sourceKind: "public_page", imageUrl, pageUrl, site: str(p.site, 120), siteKind: kind, looks: str(p.looks, 300) });
  }
  return { candidates: out, dropped };
}

// "may contain traces of ..." in the languages of the packs, and wording that says an allergen is absent.
const MAY_CONTAIN = /may contain|might contain|may also contain|traces?|facility that|factory that|also (handles|processes)|same (line|equipment)|peut contenir|pourrait contenir|قد يحتوي|قد تحتوي|آثار|اثار/i;
const ABSENT = /\bfree\b|free from|\bwithout\b|does not contain|contains no\b|\bno added\b|\bsans\b|ne contient pas|خال|لا يحتوي|بدون/i;

/** The codes of our vocabulary that a researcher's allergen name stands for ("milk", "wheat", "hazelnuts", or a code itself). */
export function codesForName(name) {
  const n = collapse(name).toLowerCase();
  if (!n || n.length > 60) return [];
  if (ALLERGEN_CODES.includes(n.replace(/[ -]/g, "_"))) return [n.replace(/[ -]/g, "_")];
  return ALLERGEN_CODES.filter((c) => quoteFitsAllergen(c, n));
}

/** The clauses of a quote, so "Contains milk. May contain nuts." is read as two statements. */
export const clausesOf = (quote) => String(quote).split(/[.;\n•|]+|\s-\s/).map(collapse).filter(Boolean);

/** The clause of the quote that states this allergen with this value, or null. Absent-wording clauses never count. */
export function clauseFor(code, value, quote) {
  for (const c of clausesOf(quote)) {
    if (!quoteFitsAllergen(code, c) || ABSENT.test(fold(c))) continue;
    if ((MAY_CONTAIN.test(fold(c)) ? "may_contain" : "contains") === value) return c;
  }
  return null;
}

const DIET_WORDS = { halal: /halal|حلال/, vegetarian: /vegetari|vegetar|نباتي/, vegan: /vegan|vegetal|نباتي صرف/ };
const NOT_PROPOSED_LABELS = { gluten_free: "free_statement_recorded_from_the_pack", lactose_free: "free_statement_recorded_from_the_pack", organic: "no_such_attribute" };

// File key -> the key the nutrition panel uses everywhere else (N1's proposals, the console's intake page), and its unit.
const NUTRIENTS = [
  ["energy_kcal", "energy_kcal", "kcal"], ["fat_g", "fat", "g"], ["saturated_fat_g", "saturated_fat", "g"], ["carbohydrate_g", "carbohydrates", "g"],
  ["sugars_g", "sugars", "g"], ["fibre_g", "fiber", "g"], ["protein_g", "proteins", "g"], ["salt_g", "salt", "g"], ["sodium_mg", "sodium_mg", "mg"],
];

/** "100 g" -> "100g", "100 ml" -> "100ml"; anything else (a serving) is null: the panel is not converted. */
export function per100(per) {
  const m = /^(?:per\s*)?100\s*(g|ml)$/i.exec(collapse(per).replace(/\.$/, ""));
  return m ? `100${m[1].toLowerCase()}` : null;
}

export function nutritionFrom(block) {
  const per = per100(block.per);
  if (!per) return { ok: false, reason: str(block.per, 40) ? "per_serving_not_converted" : "no_per" };
  const values = {}; const units = {}; const raw = { per: collapse(block.per) };
  for (const [key, name, unit] of NUTRIENTS) {
    const v = block[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    values[name] = Math.round(v * 1000) / 1000; units[name] = unit; raw[key] = v;
  }
  const macros = ["fat", "carbohydrates", "proteins"].filter((k) => k in values);
  if (!("energy_kcal" in values) && macros.length < 3) return { ok: false, reason: "too_few_values" };
  for (const [k, v] of Object.entries(values)) if (units[k] === "g" && v > 100) return { ok: false, reason: `implausible:${k}` };
  if ((values.energy_kcal ?? 0) > 900) return { ok: false, reason: "implausible:energy" };
  if ((values.fat ?? 0) + (values.carbohydrates ?? 0) + (values.proteins ?? 0) > 101) return { ok: false, reason: "implausible:sum" };
  return { ok: true, per, values, units, sourceText: JSON.stringify(raw) };
}

/**
 * One file's proposals. `product` is the catalog item ({ sku, barcode }). Returns { facts, rejected, match }.
 * Each fact is { attribute, value, detail } with page_url, market, source_text and fingerprint in detail.
 */
export function buildWebFacts({ file, sha, product, runId, loadedAt }) {
  const facts = []; const rejected = [];
  const matched = obj(file.matched) ?? {};
  const confidence = ["exact", "likely", "unsure"].includes(matched.confidence) ? matched.confidence : "unsure";
  const match = {
    brand: str(matched.brand, 120), product: str(matched.product, 200), size: str(matched.size, 60), barcode: str(matched.barcode, 40),
    confidence, note: str(matched.note, 300),
    barcode_matches_catalog: digits(matched.barcode) && digits(product?.barcode) ? digits(matched.barcode) === digits(product.barcode) : null,
  };
  if (confidence === "unsure") return { facts, rejected: [{ kind: "all", reason: "unsure_match" }], match };

  // The market is written on the ingredients block; a block read on the same page is for the same market.
  const blocks = ["ingredients", "allergens", "nutrition", "storage", "origin"].map((k) => obj(file[k])).filter(Boolean);
  const marketOf = (block) => str(block?.market, 80) ?? str(blocks.find((b) => str(b.market, 80) && b.page_url === block?.page_url)?.market, 80) ?? null;
  const base = { source_file: `data/research/${file.sku}.json`, file_sha: sha, matched: match, loaded_at: loadedAt, run_id: runId,
    note: "Read on a public web page by a research session, not checked against the pack." };
  const push = (attribute, value, pageUrl, market, detail) => facts.push({ attribute, value,
    detail: { ...base, page_url: pageUrl, market, ...detail, fingerprint: fingerprint(attribute, value, detail.source_text, pageUrl) } });
  const pageOf = (kind, block) => { const u = httpsUrl(block.page_url); if (!u) rejected.push({ kind, reason: "no_https_page_address" }); return u; };

  // 1. Ingredients, as the page prints them.
  const ing = obj(file.ingredients);
  if (ing && str(ing.text, MAX_TEXT + 1)) {
    const text = collapse(ing.text); const page = pageOf("ingredients", ing);
    if (text.length > MAX_TEXT) rejected.push({ kind: "ingredients", reason: "too_long" });
    else if (page) push("ingredients", null, page, marketOf(ing), { source_text: text, text, lang: ["en", "ar", "fr"].includes(ing.language) ? ing.language : null });
  }

  // 2. Allergens: only with the literal quote, and only what the quote itself says.
  const al = obj(file.allergens);
  if (al) {
    const quote = str(al.quote, 1500); const page = quote ? pageOf("allergen", al) : null;
    const named = [["contains", al.contains], ["may_contain", al.may_contain]].flatMap(([value, list]) => (Array.isArray(list) ? list : []).filter((n) => typeof n === "string").map((name) => ({ value, name })));
    if (!quote && named.length) rejected.push({ kind: "allergen", reason: "no_literal_quote", names: named.map((n) => n.name).slice(0, 20) });
    const found = new Map();
    if (quote && page) {
      for (const { value, name } of named) {
        const codes = codesForName(name);
        if (!codes.length) { rejected.push({ kind: "allergen", name: name.slice(0, 60), reason: "not_in_our_vocabulary" }); continue; }
        for (const code of codes) {
          const clause = clauseFor(code, value, quote);
          if (!clause) { rejected.push({ kind: "allergen", code, name: name.slice(0, 60), reason: `quote_does_not_say_${value}` }); continue; }
          if (found.get(code)?.value === "contains") continue;           // contains already says as much or more
          found.set(code, { value, quote: clause, named_as: name.slice(0, 60) });
        }
      }
      for (const code of ALLERGEN_CODES) if (found.has(code)) {
        const f = found.get(code);
        push(code, f.value, page, marketOf(al), { source_text: quote, quote: f.quote, named_as: f.named_as, basis: "literal_quote_from_the_page" });
      }
    }
  }

  // 3. Nutrition panel: the stated per-100 numbers.
  const nu = obj(file.nutrition);
  if (nu) {
    const n = nutritionFrom(nu);
    if (!n.ok) rejected.push({ kind: "nutrition", reason: n.reason });
    else { const page = pageOf("nutrition", nu); if (page) push("nutrition", null, page, marketOf(nu), { source_text: n.sourceText, per: n.per, values: n.values, units: n.units }); }
  }

  // 4. Diet labels: the pack's own claim or certificate, as the file quotes it.
  const seen = new Set();
  for (const d of Array.isArray(file.diet_labels) ? file.diet_labels : []) {
    const label = String(obj(d)?.label ?? "").toLowerCase().replace(/[ -]/g, "_");
    if (NOT_PROPOSED_LABELS[label]) { rejected.push({ kind: "diet", label, reason: NOT_PROPOSED_LABELS[label] }); continue; }
    if (!DIET_WORDS[label]) { rejected.push({ kind: "diet", label: label.slice(0, 40), reason: "unknown_label" }); continue; }
    if (seen.has(label)) continue;
    const basis = str(d.basis, 600);
    if (!basis) { rejected.push({ kind: "diet", label, reason: "no_basis" }); continue; }
    if (!DIET_WORDS[label].test(fold(basis))) { rejected.push({ kind: "diet", label, reason: "basis_does_not_name_the_label" }); continue; }
    const page = pageOf("diet", d); if (!page) continue;
    seen.add(label);
    push(label, "yes", page, marketOf(d), { source_text: basis, quote: basis, basis: "pack_claim_or_certificate_as_the_page_shows_it" });
  }

  // 5. Storage and origin, as printed.
  const st = obj(file.storage);
  if (st && str(st.text, 1000)) { const page = pageOf("storage", st); if (page) { const text = str(st.text, 1000); push("storage", null, page, marketOf(st), { source_text: text, text }); } }
  const or = obj(file.origin);
  if (or && str(or.country, 120)) { const page = pageOf("origin", or); if (page) { const text = str(or.country, 120); push("origin", null, page, marketOf(or), { source_text: text, text, country: text }); } }

  return { facts, rejected, match };
}
