#!/usr/bin/env node
// Build plan 5.18, the facts step: ingredients, allergens, nutrition panel and diet labels from Open Food Facts, by barcode,
// filed as PROPOSED rows in product_facts (migration 0073, which calls C1's propose_product_fact). Never approved by code:
// a person confirms each field against the pack at intake (5.15) and records it as source `label`.
// Runs in GitHub Actions (.github/workflows/product-data.yml); cloud build sessions cannot reach Open Food Facts.
//
//   1. read the items still to look up (product_data_to_fetch): a real product number, no answer from an earlier run
//   2. Open Food Facts by barcode, one request every 4 seconds (it answered 429 at 1.5 s from a GitHub runner, see 5.17)
//   3. the fast model maps OFF's free text onto our fourteen allergens (with a quote) and writes the ingredients in Arabic
//   4. facts.mjs refuses anything the source text does not support; what is left goes to propose_off_facts()
//   5. every item leaves a row in product_data_attempts with the reason
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, MODEL_FAST; RUN_ID optional.
// Flags: --limit N  --sku AK-0001  --force (look at items that already have an answer)  --concurrency N  --summary-out file.json
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gate, pool } from "./lib/http.mjs";
import { makeStore } from "./lib/store.mjs";
import { offLookup, offTexts, offIdentity } from "./lib/off.mjs";
import { buildFacts } from "./lib/facts.mjs";
import { mapRequest, mapText } from "./lib/map-model.mjs";
import { Fatal, newUsage } from "./lib/anthropic.mjs";

export { Fatal };

/** One item, start to finish. d = { off(barcode), map(req), store, runId, model, now } (all injectable). */
export async function processItem(item, d) {
  const record = (outcome, detail) => d.store.rpc("record_product_data_attempt", { p_product: item.product_id, p_run: d.runId, p_outcome: outcome, p_detail: detail });
  try {
    const hit = await d.off(item.barcode);
    if (!hit.found) {
      await record("not_in_off", { reason: hit.reason, barcode: item.barcode });
      return { sku: item.sku, outcome: "not_in_off", reason: hit.reason };
    }
    const texts = offTexts(hit.product);
    const req = mapRequest(texts);
    const mapping = req ? await d.map(req) : { allergens: [], ingredients_ar: "" };
    const { facts, rejected, unmapped_tags } = buildFacts({ code: hit.code, product: hit.product, mapping, runId: d.runId, fetchedAt: (d.now ?? (() => new Date()))().toISOString(), model: d.model });
    const off = offIdentity(hit.product);
    if (!facts.length) {
      await record("found_nothing_usable", { off, rejected, unmapped_tags });
      return { sku: item.sku, outcome: "found_nothing_usable", rejected };
    }
    const res = await d.store.rpc("propose_off_facts", { p_product: item.product_id, p_run: d.runId, p_facts: facts });
    await record("proposed", { off, proposed: Object.keys(res?.proposed ?? {}), skipped: res?.skipped ?? {}, rejected, unmapped_tags });
    return { sku: item.sku, outcome: "proposed", attributes: facts.map((f) => f.attribute), proposed: Object.keys(res?.proposed ?? {}).length, skipped: res?.skipped ?? {}, rejected };
  } catch (e) {
    if (e instanceof Fatal) throw e;
    try { await record("error", { error: String(e.message).slice(0, 300) }); } catch { /* the run summary still shows it */ }
    return { sku: item.sku, outcome: "error", error: String(e.message).slice(0, 160) };
  }
}

export function summarise(results) {
  const outcomes = {}; const errors = {}; const rejected = {}; const skipped = {};
  for (const r of results) {
    outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    if (r.outcome === "error" && r.error) errors[r.error] = (errors[r.error] ?? 0) + 1;
    for (const x of Array.isArray(r.rejected) ? r.rejected : []) rejected[`${x.kind}:${x.reason.split(":")[0]}`] = (rejected[`${x.kind}:${x.reason.split(":")[0]}`] ?? 0) + 1;
    for (const v of Object.values(r.skipped ?? {})) skipped[v] = (skipped[v] ?? 0) + 1;
  }
  return { processed: results.length, outcomes, errors_by_message: errors, refused_by_checks: rejected, skipped_by_reason: skipped };
}

function args(argv) {
  const a = { limit: null, sku: null, force: false, concurrency: 3, summaryOut: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") a.limit = Number(argv[++i]);
    else if (argv[i] === "--sku") a.sku = argv[++i];
    else if (argv[i] === "--force") a.force = true;
    else if (argv[i] === "--concurrency") a.concurrency = Number(argv[++i]);
    else if (argv[i] === "--summary-out") a.summaryOut = argv[++i];
  }
  return a;
}

async function main() {
  const a = args(process.argv.slice(2));
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ANTHROPIC_API_KEY", "MODEL_FAST"].filter((k) => !process.env[k]);
  if (missing.length) { console.error(`missing env: ${missing.join(", ")}`); process.exit(2); }
  const store = makeStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY });
  const offGate = gate(4000);            // one request every 4 seconds (5.17: 1.5 s was refused with 429)
  const usage = newUsage();
  const runId = process.env.RUN_ID || `local-${Date.now()}`;
  const model = process.env.MODEL_FAST;
  const d = {
    store, runId, model,
    off: (barcode) => offLookup(barcode, { wait: offGate }),
    map: (req) => mapText(req, { apiKey: process.env.ANTHROPIC_API_KEY, model, usage }),
  };
  let items = await store.rpc("product_data_to_fetch", { p_limit: a.sku ? null : a.limit, p_force: a.force });
  if (a.sku) items = items.filter((i) => i.sku === a.sku);
  console.log(`run ${runId}: ${items.length} items to look up in Open Food Facts (one request every 4 s, about ${Math.ceil(items.length * 4 / 60)} min)`);
  let fatal = null;
  const results = await pool(items, a.concurrency, async (item) => {
    if (fatal) return { sku: item.sku, outcome: "not_run" };
    try {
      const r = await processItem(item, d);
      console.log(`${item.sku} ${r.outcome}${r.proposed !== undefined ? ` (${(r.attributes ?? []).join(",")})` : ""}${r.error ? ` ${r.error}` : ""}`);
      return r;
    } catch (e) { fatal = e; console.error(`stopping: ${e.message}`); return { sku: item.sku, outcome: "not_run" }; }
  });
  const coverage = await store.rpc("product_data_coverage");
  const s = { run_id: runId, model, ...summarise(results), model_usage: usage, coverage };
  console.log(JSON.stringify(s, null, 2));
  if (a.summaryOut) writeFileSync(a.summaryOut, JSON.stringify(s, null, 2) + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) {
    const w = coverage.products_with;
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `### Product data from Open Food Facts, run ${runId}`,
      `- processed this run: ${s.processed}; outcomes: ${JSON.stringify(s.outcomes)}`,
      `- refused by the checks (a proposal lost, never a wrong one filed): ${JSON.stringify(s.refused_by_checks)}`,
      `- errors by message: ${JSON.stringify(s.errors_by_message)}`,
      `- model: ${model}; ${usage.calls} calls, ${usage.input_tokens} input and ${usage.output_tokens} output tokens`,
      `- **catalog now: ${coverage.products} items; ${coverage.lookup_candidates} with a real barcode, ${coverage.internal_codes} with a store's own code (not looked up), ${coverage.without_barcode} with no barcode**`,
      `- **found in Open Food Facts ${coverage.found_in_open_food_facts}; not there ${coverage.not_in_open_food_facts}; errors ${coverage.errors}; not yet tried ${coverage.not_yet_tried}**`,
      `- **items with a proposed fact: ingredients ${w.ingredients} (in Arabic ${w.ingredients_in_arabic}), nutrition ${w.nutrition}, allergens ${w.allergen_any} (contains ${w.allergen_contains}, may contain ${w.allergen_may_contain}), diet labels ${w.diet_any} (halal ${w.halal}, vegetarian ${w.vegetarian}, vegan ${w.vegan}); any ${coverage.products_with_any_proposal}**`,
      `- approved from Open Food Facts: ${coverage.approved_from_open_food_facts} (must be 0). No allergen proposal means unknown, not free.`, ""].join("\n"));
  }
  const errors = s.outcomes.error ?? 0;
  if (fatal || (items.length >= 10 && errors > items.length / 2) || coverage.approved_from_open_food_facts !== 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.message); process.exit(1); });
