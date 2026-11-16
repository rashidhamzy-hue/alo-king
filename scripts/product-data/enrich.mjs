#!/usr/bin/env node
// Session PD1 (docs/PRODUCT_DATA_STANDARD.md), pull request 3, part (h): the enrichment run over the catalogue, against STAGING.
// Runs in GitHub Actions (.github/workflows/enrich.yml) after the Open Food Facts lookup and the research files are loaded (both as
// proposals, by their own scripts). This script, in order:
//   1. rules      apply_rule_fields() (0209): what a rule can set from what the catalogue holds (sale unit, fresh or frozen, water's
//                 volume and type, a nappy's size, a pet item's species, packed apart, chilled bag, size, pack count, format tags);
//                 each a proposal approved by the rule_fields row when nothing disagrees
//   2. model      the kind ("iced tea", "lentils") and shopping tags (audience, occasion, taste, format) of each item, proposed by the
//                 fast model in batches and checked by rules in SQL (apply_item_proposal, 0208): a kind is a short lowercase phrase;
//                 tags only from tag_codes; no health or safety word can be a tag. Never a food fact, never a claim.
//   3. groups     substitute groups by rule: items with the same template and the same approved kind (the trigger refuses anything else)
//   4. approve    intake_try_auto(): every approval rule, including two published sources (0207) and rule fields
//   5. search     refresh_search_documents() (0208): one document per item for SR1
//   6. pictures   Open Food Facts front pictures for items with a barcode and no usable picture, written as rows for
//                 data/pictures/candidates.csv (the images workflow's from-list mode checks and queues them)
//   7. report     enrichment_report() (0209): items sellable and fact-complete per template; per item what is missing and the route
//                 that fills it; the shelf-visit list by aisle; the supplier sheet. JSON and Markdown.
// Model calls only through COST1's meter (MODEL_COST_CAP_USD; the run stops making calls at the cap and records its dollars).
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, MODEL_FAST. Flags: --skip-model --skip-pictures --limit N --out-dir dir
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeStore } from "./lib/store.mjs";
import { callTool, Fatal } from "./lib/anthropic.mjs";
import { fetchRetry } from "./lib/http.mjs";
import { runMetered } from "../lib/model-cost.mjs";

/** The kinds the dishes, portions and complements use (0208): the model picks one of these when it fits, so baskets find the items. */
export const PREFERRED_KINDS = ["lentils", "rice", "burghul", "chickpeas", "fava beans", "pasta", "onion", "tomato", "cucumber", "lettuce", "parsley", "mint",
  "lemon", "potato", "vegetable oil", "olive oil", "tahini", "zaatar", "sumac", "arabic bread", "labneh", "eggs", "chicken", "ground meat", "snack",
  "chips", "juice", "water", "soft drink", "iced tea", "coffee", "tea", "sugar", "milk", "yoghurt", "cheese", "chocolate bar", "biscuits", "wafer",
  "nuts", "jam", "hummus", "tuna", "dish soap", "laundry detergent", "toilet cleaner", "trash bags", "tissues", "shampoo", "soap", "toothpaste",
  "nappies", "wet wipes", "cat food", "cat litter"];
const TAGS = ["kids", "toddlers", "family", "lunchbox", "breakfast", "party", "ramadan", "iftar", "back_to_school", "summer", "christmas", "cleaning_day",
  "late_night", "bbq", "sweet", "salty", "spicy", "crunchy", "chocolate", "plain", "single_serve", "family_pack", "multipack"];

export const TOOL = {
  name: "record_items",
  description: "For each item: its kind (what it is, generic, lowercase, a few words) and shopping tags from the list. No health, diet or safety words.",
  input_schema: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: {
    sku: { type: "string" },
    kind: { type: "string", description: "What the item is, generic and lowercase (\"iced tea\", \"potato chips\", \"dish soap\"). Use one of the preferred kinds when it fits." },
    tags: { type: "array", items: { type: "string", enum: TAGS } },
  }, required: ["sku", "kind", "tags"] } } }, required: ["items"] },
};
const SYSTEM = "You sort grocery items for a Lebanese delivery shop's search. For each item give its kind (what it is, generic, lowercase, in English) and the shopping tags that fit "
  + "(who it is for, when it is used, its taste, its pack format). Tags are shopping tags only: never a health, diet, nutrition or safety judgement. "
  + "Tag 'kids' or 'lunchbox' only for items made and sold for children's snacks or lunchboxes. Decide from the name, brand and category only; when unsure, give fewer tags. "
  + `Preferred kinds: ${PREFERRED_KINDS.join(", ")}.`;

/** The model's answer, kept to what SQL will accept anyway (it checks again): known SKUs, a short kind, tags from the list. */
export function cleanAnswer(answer, skus) {
  const known = new Set(skus);
  const out = [];
  for (const it of Array.isArray(answer?.items) ? answer.items : []) {
    const sku = String(it?.sku ?? "");
    if (!known.has(sku)) continue;
    const kind = String(it?.kind ?? "").toLowerCase().replace(/[^a-z &'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    const tags = [...new Set((Array.isArray(it?.tags) ? it.tags : []).map(String).filter((t) => TAGS.includes(t)))];
    out.push({ sku, kind: kind || null, tags });
  }
  return out;
}
/** A substitute group's code from a template and a kind: "packaged_food__iced_tea". */
export const groupCode = (template, kind) => `${template}__${kind.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`.slice(0, 60);

/** Rows for data/pictures/candidates.csv from Open Food Facts' front picture of each barcode. */
export async function offPictureRows(items, { fetchImpl = fetch, wait = async () => {}, now = new Date() } = {}) {
  const rows = [];
  for (const it of items) {
    const code = String(it.barcode ?? "").replace(/\D/g, "");
    if (code.length < 8) continue;
    await wait();
    const res = await fetchRetry(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,image_front_url`, {}, { fetchImpl, retries: 2, wait });
    if (!res.ok) continue;
    const body = await res.json().catch(() => null);
    const url = body?.product?.image_front_url;
    if (typeof url !== "string" || !/^https:\/\/images\.openfoodfacts\.org\//.test(url)) continue;
    rows.push([it.sku, url, `https://world.openfoodfacts.org/product/${code}`, now.toISOString().slice(0, 16) + "Z"].join(","));
  }
  return rows;
}

/** The report as Markdown: the summary, the routes, and the shelf-visit list by aisle (printable). */
export function reportMarkdown(rep, spend) {
  const s = rep.summary ?? {};
  const lines = ["# PD1 enrichment run", "", `Active items: ${s.active}. Sellable: ${s.sellable}. Fact-complete: ${s.fact_complete}.${spend != null ? ` Model spend: USD ${Number(spend).toFixed(4)}.` : ""}`, "",
    "| Template | Active | Sellable | Fact-complete |", "|---|---|---|---|"];
  for (const [t, v] of Object.entries(s.by_template ?? {}).sort()) lines.push(`| ${t} | ${v.active} | ${v.sellable} | ${v.fact_complete} |`);
  lines.push("", "Missing fields by the route that fills them:", "");
  for (const [r, n] of Object.entries(rep.routes ?? {}).sort((a, b) => b[1] - a[1])) lines.push(`- ${r.replace(/_/g, " ")}: ${n}`);
  lines.push("", "## Shelf visit: photograph front and back of each pack (before stock arrives)", "");
  let aisle = null;
  for (const it of rep.shelf_list ?? []) {
    if (it.aisle !== aisle) { aisle = it.aisle; lines.push("", `### ${aisle ?? "No aisle"}`, "", "| SKU | Item | Barcode | Done |", "|---|---|---|---|"); }
    lines.push(`| ${it.sku} | ${it.name_en} | ${it.barcode ?? ""} | [ ] |`);
  }
  lines.push("", "## Supplier sheet: fields per item", "");
  for (const it of rep.supplier_sheet ?? []) lines.push(`- ${it.sku} ${it.name_en} (${String(it.template).replace(/_/g, " ")}): ${(it.fields ?? []).join(", ").replace(/_/g, " ")}`);
  return lines.join("\n") + "\n";
}

/** The whole run. d = { store, model: (batch) => answer | null, pictures: (items) => rows, log }. Returns what it did. */
export async function run(d, { skipModel = false, skipPictures = false, limit = null, batch = 25 } = {}) {
  const out = { rules: null, model: { batches: 0, items: 0, kinds: 0, tags: 0, dropped: 0, stopped: null }, groups: 0, approve: null, search: 0, pictures: [], report: null };
  out.rules = await d.store.rpc("apply_rule_fields", {});
  const items = (await d.store.rpc("enrichment_items", {})).slice(0, limit ?? undefined);
  if (!skipModel) {
    for (let i = 0; i < items.length; i += batch) {
      const chunk = items.slice(i, i + batch);
      let answer;
      try { answer = await d.model(chunk); }
      catch (e) { out.model.stopped = String(e.message ?? e).slice(0, 200); if (e instanceof Fatal || /COST_CAP|NO_PRICE/.test(String(e.message))) break; continue; }
      out.model.batches++;
      for (const a of cleanAnswer(answer, chunk.map((x) => x.sku))) {
        const it = chunk.find((x) => x.sku === a.sku);
        const r = await d.store.rpc("apply_item_proposal", { p_product: it.product_id, p_proposal: { kind: a.kind, tags: a.tags }, p_source: "model" });
        out.model.items++; if (r?.kind) out.model.kinds++; out.model.tags += r?.tags ?? 0; out.model.dropped += (r?.dropped ?? []).length;
      }
    }
  }
  // Substitute groups by rule: the same template and the same approved kind.
  for (const it of await d.store.rpc("enrichment_items", {})) {
    if (!it.kind || !it.template) continue;
    const r = await d.store.rpc("apply_item_proposal", { p_product: it.product_id, p_proposal: { substitute_group: { code: groupCode(it.template, it.kind), name_en: it.kind } }, p_source: "rules" });
    if (!(r?.dropped ?? []).length) out.groups++;
  }
  out.approve = await d.store.rpc("intake_try_auto", {});
  out.search = await d.store.rpc("refresh_search_documents", {});
  if (!skipPictures) out.pictures = await d.pictures((await d.store.rpc("enrichment_items", {})).filter((x) => !x.has_usable_picture));
  out.report = await d.store.rpc("enrichment_report", {});
  return out;
}

function args(argv) {
  const a = { skipModel: false, skipPictures: false, limit: null, outDir: "out/enrich" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--skip-model") a.skipModel = true;
    else if (argv[i] === "--skip-pictures") a.skipPictures = true;
    else if (argv[i] === "--limit") a.limit = Number(argv[++i]);
    else if (argv[i] === "--out-dir") a.outDir = argv[++i];
  }
  return a;
}

async function main(meter) {
  const a = args(process.argv.slice(2));
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", ...(a.skipModel ? [] : ["ANTHROPIC_API_KEY", "MODEL_FAST"])].filter((k) => !process.env[k]);
  if (missing.length) { console.error(`missing env: ${missing.join(", ")}`); process.exit(2); }
  const store = makeStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY });
  const model = (chunk) => callTool({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.MODEL_FAST, system: SYSTEM, tool: TOOL, maxTokens: 4000,
    content: [{ type: "text", text: JSON.stringify(chunk.map((x) => ({ sku: x.sku, name: x.name_en, brand: x.brand, category: x.category, sub_type: x.sub_type, template: x.template }))) }] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = await run({ store, model, pictures: (items) => offPictureRows(items, { wait: () => sleep(1500) }) }, a);
  mkdirSync(a.outDir, { recursive: true });
  writeFileSync(join(a.outDir, "enrich-result.json"), JSON.stringify({ ...out, report: undefined }, null, 2));
  writeFileSync(join(a.outDir, "enrichment-report.json"), JSON.stringify(out.report, null, 2));
  writeFileSync(join(a.outDir, "candidates-off.csv"), out.pictures.join("\n") + (out.pictures.length ? "\n" : ""));
  const md = reportMarkdown(out.report, meter?.spent ?? null);
  writeFileSync(join(a.outDir, "enrichment-report.md"), md);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`## Enrichment (PD1)`, "", `- rules: ${JSON.stringify(out.rules?.auto ?? {})}, ${out.rules?.proposed ?? 0} proposed, ${out.rules?.tags ?? 0} tags`,
      `- model: ${out.model.batches} batches, ${out.model.items} items, ${out.model.kinds} kinds, ${out.model.tags} tags, ${out.model.dropped} dropped${out.model.stopped ? `; stopped: ${out.model.stopped}` : ""}`,
      `- substitute groups: ${out.groups} items placed; approvals: ${JSON.stringify(out.approve)}; search documents written: ${out.search}`,
      `- Open Food Facts front pictures found: ${out.pictures.length}`, "", md].join("\n") + "\n");
  }
  console.log(JSON.stringify({ rules: out.rules, model: out.model, groups: out.groups, approve: out.approve, search: out.search, pictures: out.pictures.length, summary: out.report?.summary }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runMetered({ workflow: "enrich", capDefault: 10, step: "kinds_and_tags" }, main);
