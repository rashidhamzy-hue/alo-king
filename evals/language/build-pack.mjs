// Build plan 1.22: turn evals/language/pack.json (the generator's raw answer) into the data migration
// supabase/migrations/0054_language_pack.sql, dropping what must not ship:
//   - any term about allergens, diet, halal, health or nutrition, unless the word is printed in the product's English name
//     (invariant 15: food facts come only from approved records, never from a model);
//   - an exact term that points at more than one product, or that is another product's kind term;
//   - a kind term that is only a brand (it would make every product of the brand look like the thing asked for).
// Tokens are folded exactly as catalog_tokens() does in SQL, including fold_text's mapping.
//   node evals/language/build-pack.mjs [--out supabase/migrations/0054_language_pack.sql]
import { readFileSync, writeFileSync } from "node:fs";
import { loadCatalog, root } from "./catalog.mjs";

// catalog_tokens (0053) maps the letters people write interchangeably first (as here), then fold_text (0003) removes harakat
// and tatweel and lowers the case.
const FOLD = { "أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه", "ؤ": "و", "ئ": "ي" };
export const fold = (s) => [...(s ?? "")].map((c) => FOLD[c] ?? c).join("").replace(/[ً-ْـ]/g, "").toLowerCase().trim();
export function tokens(s) {
  return fold(s).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/([0-9])([ء-يٱ-ۓ])/g, "$1 $2").replace(/([ء-يٱ-ۓ])([0-9])/g, "$1 $2")
    .replace(/([0-9])(ml|cl|l|lt|ltr|litre|liter|g|gr|kg|cm|pcs|pc|x)(?![0-9a-zÀ-ɏ])/g, "$1 $2").replace(/(?<![0-9a-zÀ-ɏ])x([0-9])/g, "x $1")
    .replace(/[^0-9a-zÀ-ɏء-يٱ-ۓ]+/g, " ").trim().split(/\s+/).filter(Boolean);
}
export const key = (s) => tokens(s).join(" ");

/** catalog_token_forms (0053), the same rules in the same order: size words, then one leading clitic. */
export function tokenForms(t) {
  const f = [t];
  if (/^(el|l)?(kbir|kbire|kbireh|kbiri|kbar|kebir|kbeer)$/.test(t) || /^(ال)?(كبير|كبيره|كبار)$/.test(t)) f.push("kbir");
  if (/^(el|l)?(zghir|zghire|zghireh|zghar|z8ir|z8ire|z8ar|zgher|zghire)$/.test(t) || /^(ال)?(صغير|صغيره|صغار|زغير|زغيره|زغار)$/.test(t)) f.push("zghir");
  const n = [...t].length;
  if (/^(وال|بال|عال|فال|كال)/.test(t) && n >= 6) f.push([...t].slice(3).join(""));
  if (/^(ال|لل)/.test(t) && n >= 5) f.push([...t].slice(2).join(""));
  if (/^[وبعف]/.test(t) && n >= 4) f.push([...t].slice(1).join(""));
  if (/^[وبعف]ال/.test(t) && n >= 6) f.push([...t].slice(3).join(""));
  return [...new Set(f.filter((x) => x === t || [...x].length >= 3))];
}
/** catalog_term_forms (0053): every form of every token. */
export const termForms = (s) => [...new Set(tokens(s).flatMap(tokenForms))];

// Food-fact words: [the English word that, printed in the name, allows it; the forms that are refused otherwise].
const FOOD = [
  ["halal", ["halal", "حلال", "7alal", "halel"]], ["gluten", ["gluten", "غلوتين", "جلوتين", "غلوتن"]],
  ["vegan", ["vegan", "végan", "فيغان", "فيجان", "نباتي", "نباتية", "vegetarian", "végétarien", "vegetarien"]],
  ["healthy", ["healthy", "صحي", "صحية", "sain", "santé", "sihhi", "se7e", "se7i"]],
  ["diet", ["diet", "دايت", "رجيم", "regime", "régime", "rejim"]], ["light", ["light", "لايت", "allégé", "allege"]],
  ["sugar", ["sugar", "سكر", "sucre", "sukkar", "sokkar", "zero", "زيرو"]], ["fat", ["fat", "دسم", "دسمة", "قليل الدسم", "écrémé", "ecreme", "demi"]],
  ["lactose", ["lactose", "لاكتوز"]], ["allergy", ["allergy", "allergie", "حساسية", "7asesiyye"]],
  ["calorie", ["calorie", "calories", "كالوري", "سعرات", "سعرة"]], ["protein", ["protein", "بروتين", "protéine"]],
  ["organic", ["organic", "bio", "عضوي", "عضوية"]], ["fasting", ["fasting", "صيامي", "صيام", "carême"]], ["keto", ["keto", "كيتو"]],
];

// Names of kinds of product, not claims about them: vegetable oil and ghee are called «نباتي» in Arabic.
const KIND_NAMES = ["زيت نباتي", "زيت نباتية", "سمنة نباتية", "سمنة نباتي", "vegetable oil", "huile vegetale"].map((t) => tokens(t).join(" "));
// Invariant 15 is about food. Toiletries, cleaning, baby care and pet supplies carry no food fact («فوط صحية» are sanitary pads).
const NON_FOOD = new Set(["Cleaning & Household", "Beauty & Personal Care", "Baby & Child", "Pet Zone"]);

// The fat level of milk, laban and cream is the product as printed ("Lait Entier", "Demi-Écrémé", "Low Fat"), not a claim.
const ALSO = { fat: ["entier", "écrémé", "ecreme", "demi", "low fat", "full fat"] };

export function foodWord(term, nameEn, category) {
  if (category && NON_FOOD.has(category)) return null;
  const k = tokens(term).join(" ");
  if (KIND_NAMES.some((n) => k === n || k.startsWith(n + " ") || k.endsWith(" " + n))) return null;
  const ks = new Set(tokens(term)); const name = (nameEn ?? "").toLowerCase();
  for (const [allowedBy, forms] of FOOD) {
    const hit = forms.find((f) => { const ft = tokens(f); return ft.length && ft.every((t) => ks.has(t)); });
    if (hit && !name.includes(allowedBy) && !name.includes(hit) && !(ALSO[allowedBy] ?? []).some((w) => name.includes(w))) return allowedBy;
  }
  return null;
}

/** pack.json -> { rows, dropped }. Pure, so CI tests it. */
export function buildPack(pack, catalog) {
  const bySku = new Map(catalog.map((p) => [p.sku, p]));
  const dropped = { food: [], collision: [], demoted: [], brand_as_kind: [], unknown_sku: [], empty: 0 };
  const rows = [];
  for (const p of pack.products ?? []) {
    const prod = bySku.get(p.sku);
    if (!prod) { dropped.unknown_sku.push(p.sku); continue; }
    for (const level of ["kind", "brand", "exact"]) for (const t of p[level] ?? []) {
      const term = String(t.t ?? "").trim().replace(/\s+/g, " ");
      if (!key(term) || tokens(term).length > 5) { dropped.empty++; continue; }
      const food = foodWord(term, prod.name, prod.category);
      if (food) { dropped.food.push({ sku: p.sku, term, food }); continue; }
      rows.push({ sku: p.sku, term, level, lang: ["ar", "arabizi", "en", "fr"].includes(t.lang) ? t.lang : "ar" });
    }
  }
  // brand keys per product, and kind keys per product
  const brandKeys = new Set(rows.filter((r) => r.level === "brand").map((r) => key(r.term)));
  const kindOwners = new Map(), exactOwners = new Map();
  for (const r of rows) {
    const m = r.level === "kind" ? kindOwners : r.level === "exact" ? exactOwners : null;
    if (!m) continue;
    if (!m.has(key(r.term))) m.set(key(r.term), new Set());
    m.get(key(r.term)).add(r.sku);
  }
  const out = []; const seen = new Set();
  for (let r of rows) {
    const k = key(r.term);
    if (r.level === "kind" && brandKeys.has(k)) { dropped.brand_as_kind.push({ sku: r.sku, term: r.term }); continue; }
    if (r.level === "exact") {
      // An exact term two products claim names neither: dropped. One that is another product's kind word is a kind word for
      // this one too (fresh garlic «ثوم» beside garlic paste): it stays, as kind, so it can never pick one of them alone.
      if ((exactOwners.get(k)?.size ?? 0) > 1) { dropped.collision.push({ sku: r.sku, term: r.term, also: [...exactOwners.get(k)].filter((s) => s !== r.sku) }); continue; }
      const kindOthers = [...(kindOwners.get(k) ?? [])].filter((s) => s !== r.sku);
      if (kindOthers.length) { dropped.demoted.push({ sku: r.sku, term: r.term, also: kindOthers }); r = { ...r, level: "kind" }; }
    }
    const id = `${r.sku}|${r.level}|${r.term}`;
    if (seen.has(id)) continue;
    seen.add(id); out.push(r);
  }
  const filler = [...new Set((pack.filler ?? []).flatMap((w) => tokens(w)))]
    .filter((w) => !out.some((r) => r.level !== "kind" ? false : key(r.term) === w))     // never a word that alone names a kind
    .filter((w) => !brandKeys.has(w) && !exactOwners.has(w));
  return { rows: out, filler, dropped };
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
export function toSql(built, meta) {
  const head = `-- Alo King Chouf: build plan 1.22 (session B3). The catalog language pack, version ${meta.version}.
-- GENERATED by evals/language/build-pack.mjs from evals/language/pack.json (model ${meta.model}, ${meta.generated_at}). Do not edit by hand:
-- regenerate, review, and add the next migration. Terms are keyed by SKU, so the pack loads before or after the catalog seeds.
-- ${built.rows.length} terms (${["kind", "brand", "exact"].map((l) => `${built.rows.filter((r) => r.level === l).length} ${l}`).join(", ")}), ${built.filler.length} filler words.
-- Dropped by the build: ${built.dropped.food.length} food-fact terms, ${built.dropped.collision.length} exact terms that pointed at more than one product, ${built.dropped.brand_as_kind.length} brand-only kind terms.
-- ${built.dropped.demoted.length} exact terms that are another product's kind word were kept as kind terms.
`;
  const arr = (xs) => `array[${xs.map(q).join(",")}]::text[]`;
  // tokens and forms are written precomputed (the same as catalog_tokens / catalog_term_forms; a test checks every row)
  const rows = built.rows.map((r) => `(${q(r.sku)},${q(r.term)},${q(r.level)},${q(r.lang)},${arr(tokens(r.term))},${arr(termForms(r.term))})`);
  const chunks = []; for (let i = 0; i < rows.length; i += 500) chunks.push(rows.slice(i, i + 500));
  return head + chunks.map((c) => `insert into language_pack(sku, term, level, lang, version, tokens, forms) select v.sku, v.term, v.level, v.lang, ${q(meta.version)}, v.tokens, v.forms from (values\n${c.join(",\n")}\n) v(sku, term, level, lang, tokens, forms) on conflict do nothing;\n`).join("")
    + (built.filler.length ? `insert into catalog_filler(word) values ${built.filler.map((w) => `(${q(w)})`).join(",")} on conflict do nothing;\n` : "");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : root + "supabase/migrations/0054_language_pack.sql";
  const pack = JSON.parse(readFileSync(root + "evals/language/pack.json", "utf8"));
  const built = buildPack(pack, loadCatalog());
  const version = `lp-${pack.generated_at.slice(0, 10)}`;
  writeFileSync(outPath, toSql(built, { version, model: pack.model, generated_at: pack.generated_at }));
  writeFileSync(root + "evals/language/pack-dropped.json", JSON.stringify(built.dropped, null, 1) + "\n");
  const thin = loadCatalog().filter((p) => !built.rows.some((r) => r.sku === p.sku && r.level !== "brand")).map((p) => p.sku);
  console.log(JSON.stringify({ terms: built.rows.length, filler: built.filler.length, food: built.dropped.food.length,
    collision: built.dropped.collision.length, demoted: built.dropped.demoted.length, brand_as_kind: built.dropped.brand_as_kind.length, products_without_terms: thin }));
}
