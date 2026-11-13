#!/usr/bin/env node
// Build plan 5.18, the catalog step: cleaned Arabic and English names and sizes, and the 12 to 15 customer categories for 1.21.
// PROPOSALS ONLY. This writes files to data/proposals/ and changes nothing in the database; a person approves, then another
// task applies. The catalog is read through product_data_catalog() (0073).
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, MODEL_FAST.   Flags: --only names|categories  --out dir  --limit N
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { makeStore } from "./lib/store.mjs";
import { newUsage } from "./lib/anthropic.mjs";
import { pool } from "./lib/http.mjs";
import { proposeNames, namesCall } from "./lib/names.mjs";
import { proposeCategories, categoriesCalls } from "./lib/categories.mjs";

const meta = (kind, model, runId, usage) => ({
  kind, status: "proposed", applied: false, generated_at: new Date().toISOString(), run_id: runId, model,
  note: "Proposals for a person to approve. Nothing here has been applied to the catalog. Arabic marked model_written needs an Arabic reader.", model_usage: usage,
});

function args(argv) {
  const a = { only: ["names", "categories"], out: "data/proposals", limit: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") a.only = argv[++i].split(",");
    else if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--limit") a.limit = Number(argv[++i]);
  }
  return a;
}

async function main() {
  const a = args(process.argv.slice(2));
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ANTHROPIC_API_KEY", "MODEL_FAST"].filter((k) => !process.env[k]);
  if (missing.length) { console.error(`missing env: ${missing.join(", ")}`); process.exit(2); }
  const store = makeStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY });
  const model = process.env.MODEL_FAST; const apiKey = process.env.ANTHROPIC_API_KEY;
  const runId = process.env.RUN_ID || `local-${Date.now()}`;
  let items = await store.rpc("product_data_catalog");
  if (a.limit) items = items.slice(0, a.limit);
  mkdirSync(a.out, { recursive: true });
  const lines = [`### Names and categories proposed, run ${runId}`, `- catalog read: ${items.length} items`];
  if (a.only.includes("names")) {
    const usage = newUsage();
    const { proposals, rejected } = await proposeNames(items, { call: namesCall({ apiKey, model, usage }), pool: (list, fn) => pool(list, 3, fn) });
    writeFileSync(join(a.out, "names.json"), JSON.stringify({ ...meta("names_and_sizes", model, runId, usage), items: proposals.length, rejected_count: rejected.length, proposals, rejected }, null, 1) + "\n");
    const changed = proposals.filter((p) => p.changed.name_en || p.changed.name_ar).length; const mw = proposals.filter((p) => p.ar_source === "model_written").length;
    lines.push(`- names: ${proposals.length} proposed (${changed} change a current name; ${mw} Arabic names written by the model), ${rejected.length} refused by the checks and left as they are; ${usage.calls} calls, ${usage.input_tokens} in / ${usage.output_tokens} out tokens`);
    console.log(lines.at(-1));
  }
  if (a.only.includes("categories")) {
    const usage = newUsage();
    const r = await proposeCategories(items, { ...categoriesCalls({ apiKey, model, usage }), pool: (list, fn) => pool(list, 3, fn) });
    writeFileSync(join(a.out, "categories.json"), JSON.stringify({ ...meta("customer_categories", model, runId, usage), approval: "the founder approves the list (1.21 step 1)", categories: r.categories, unplaced: r.unplaced, empty_categories: r.empty, assignments: r.assignments }, null, 1) + "\n");
    lines.push(`- categories: ${r.categories.length} proposed; ${r.assignments.length} of ${items.length} items placed${r.unplaced.length ? `, ${r.unplaced.length} unplaced (${r.unplaced.slice(0, 10).join(", ")})` : ""}; ${usage.calls} calls, ${usage.input_tokens} in / ${usage.output_tokens} out tokens`);
    console.log(lines.at(-1));
    console.log(r.categories.map((c) => `  ${c.sort_order}. ${c.name_en} / ${c.name_ar}: ${c.products}`).join("\n"));
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.message); process.exit(1); });
