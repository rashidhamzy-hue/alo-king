#!/usr/bin/env node
// Session P2 (founder decision of 14 Nov 2026): loads the web research files into STAGING as proposals.
// Runs in GitHub Actions (.github/workflows/research-load.yml); cloud build sessions cannot reach these sites.
//
// For every data/research/AK-nnnn.json (written by sessions R1-R3; rules and shape in data/research/README.md):
//   picture  each candidate picture is downloaded and put through P1's vision rules (scripts/images/research-pictures.mjs);
//            the first that passes is proposed with licence `public_page` (migration 0070), its address and its page stored.
//   facts    ingredients, allergens, nutrition, diet labels, storage and origin are proposed as product facts with source
//            `web_page`, status `partial`, the page address and the market beside every value (lib/research.mjs; migration
//            0071). Allergens only when the file carries the literal quote. No model touches the facts.
// Nothing is approved by this script or by any code: a person approves each picture and confirms each field against the pack.
// Repeatable: a part of a file that was already loaded to the end is skipped (research_loads, keyed by the file's sha-256);
// an item that already has a usable picture, approved or waiting, is not given another; an error is always tried again.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY; for pictures also ANTHROPIC_API_KEY and MODEL_FAST.
// Flags: --dir data/research  --sku AK-0001  --limit N  --parts picture,facts  --force  --concurrency N  --report-out file.json
import { readFileSync, readdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./lib/http.mjs";
import { readResearch, pictureCandidates, buildWebFacts } from "./lib/research.mjs";
import { runMetered } from "../lib/model-cost.mjs";

const PICTURE_DONE = new Set(["none_passed", "no_candidates", "skipped_rejected"]);   // loaded to the end, with nothing standing

/** What to do with one file, given what the database already holds. Pure: no I/O. */
export function plan(item, sha, { parts = ["picture", "facts"], force = false } = {}) {
  const loads = (item.loads ?? []).filter((l) => l.file_sha === sha);
  const did = (part) => loads.find((l) => l.part === part)?.outcome ?? null;
  const out = { picture: "skip:not_asked", facts: "skip:not_asked" };
  if (parts.includes("picture")) {
    out.picture = item.has_usable_picture ? "skip:has_picture"
      : !force && PICTURE_DONE.has(did("picture")) ? `skip:loaded_${did("picture")}` : "run";
  }
  if (parts.includes("facts")) out.facts = !force && did("facts") && did("facts") !== "error" ? `skip:loaded_${did("facts")}` : "run";
  return out;
}

/** The facts of one file. d = { store, runId }. Records what happened; never throws for a bad file. */
export async function loadFacts(item, file, sha, d) {
  let outcome; let detail;
  try {
    const built = buildWebFacts({ file, sha, product: item, runId: d.runId, loadedAt: new Date().toISOString() });
    detail = { match: built.match, not_proposed: built.rejected };
    if (built.match.confidence === "unsure") outcome = "unsure_match";
    else if (!built.facts.length) outcome = built.rejected.length ? "nothing_usable" : "no_facts_in_file";
    else {
      const res = await d.store.rpc("propose_web_facts", { p_product: item.product_id, p_run: d.runId, p_facts: built.facts });
      detail.proposed = Object.keys(res.proposed ?? {}); detail.skipped = res.skipped ?? {};
      outcome = detail.proposed.length ? "proposed" : "nothing_new";
    }
  } catch (e) { outcome = "error"; detail = { error: String(e.message).slice(0, 300) }; }
  try { await d.store.rpc("record_research_load", { p_product: item.product_id, p_part: "facts", p_file_sha: sha, p_run: d.runId, p_outcome: outcome, p_detail: detail }); }
  catch (e) { return { outcome: "error", error: String(e.message).slice(0, 200) }; }
  return { outcome, proposed: detail.proposed ?? [], not_proposed: detail.not_proposed ?? [], error: detail.error };
}

/** The pictures of one file. d = { store, runId, pictures: (item, candidates, meta) => { outcome, detail } }. A Fatal passes through. */
export async function loadPicture(item, file, sha, d) {
  const { candidates, dropped } = pictureCandidates(file);
  let r;
  try { r = await d.pictures(item, candidates, { sourceFile: `data/research/${item.sku}.json`, fileSha: sha, match: file.matched ?? null }); }
  catch (e) { if (e?.name === "Fatal" || e?.constructor?.name === "Fatal") throw e; r = { outcome: "error", detail: { error: String(e.message).slice(0, 300) } }; }
  const detail = { ...r.detail, dropped };
  try { await d.store.rpc("record_research_load", { p_product: item.product_id, p_part: "picture", p_file_sha: sha, p_run: d.runId, p_outcome: r.outcome, p_detail: detail }); }
  catch (e) { return { outcome: "error", error: String(e.message).slice(0, 200) }; }
  const reasons = (detail.tried ?? []).flatMap((t) => t.reasons ?? []);
  return { outcome: r.outcome, reasons, error: detail.error };
}

/** One file, both parts. Returns { sku, picture, facts } with each part's outcome (or the reason it was skipped). */
export async function loadFile(name, text, state, d, opts = {}) {
  const read = readResearch(name, text);
  if (!read.ok) return { file: name, invalid: read.reason };
  const item = state.get(read.sku);
  if (!item) return { sku: read.sku, invalid: "not_an_active_catalog_item" };
  const todo = plan(item, read.sha, opts);
  const out = { sku: read.sku, picture: { outcome: todo.picture }, facts: { outcome: todo.facts } };
  if (todo.facts === "run") out.facts = await loadFacts(item, read.file, read.sha, d);
  if (todo.picture === "run") out.picture = await loadPicture(item, read.file, read.sha, d);
  return out;
}

export function summarise(results) {
  const count = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  const s = { files: results.length, invalid: {}, picture: {}, facts: {}, picture_reasons: {}, facts_not_proposed: {}, errors: {} };
  for (const r of results) {
    if (r.invalid) { count(s.invalid, r.invalid); continue; }
    count(s.picture, r.picture.outcome); count(s.facts, r.facts.outcome);
    for (const x of r.picture.reasons ?? []) count(s.picture_reasons, x.startsWith("error:") ? x.slice(0, 40) : x);
    for (const x of r.facts.not_proposed ?? []) count(s.facts_not_proposed, `${x.kind}:${x.reason}`);
    for (const p of ["picture", "facts"]) if (r[p].outcome === "error" && r[p].error) count(s.errors, `${p}: ${String(r[p].error).slice(0, 80)}`);
  }
  return s;
}

export function reportLines(runId, s, c) {
  const w = c.items_with_proposed;
  return [
    `### Research load, run ${runId}`,
    `- research files read this run: ${s.files}; not loadable: ${JSON.stringify(s.invalid)}`,
    `- pictures this run: ${JSON.stringify(s.picture)}; why candidates were not kept: ${JSON.stringify(s.picture_reasons)}`,
    `- facts this run: ${JSON.stringify(s.facts)}; not proposed (a proposal lost, never a wrong one filed): ${JSON.stringify(s.facts_not_proposed)}`,
    `- errors: ${JSON.stringify(s.errors)}`,
    `- **catalog now: ${c.items} items; research files loaded for ${c.research_files_loaded}**`,
    `- **pictures: ${c.pictures.proposed} items with a proposed picture (${c.pictures.proposed_public_page} from a public page), ${c.pictures.approved} approved, ${c.pictures.none} with none**`,
    `- **items with a proposed fact from a web page: ingredients ${w.ingredients}, allergens ${w.allergen_any} (contains ${w.allergen_contains}, may contain ${w.allergen_may_contain}), nutrition ${w.nutrition}, diet labels ${w.diet_any} (halal ${w.halal}, vegetarian ${w.vegetarian}, vegan ${w.vegan}), storage ${w.storage}, origin ${w.origin}; any fact ${w.any_fact}; ${c.fact_proposals} proposals in all**`,
    `- approved from a web page: ${c.approved_from_web_page} (must be 0). No allergen proposal means unknown, not free.`,
    `- items with no picture (${c.no_picture.length}): ${c.no_picture.map((x) => `${x.sku} ${x.name_en} [${x.reason}]`).join("; ") || "none"}`, ""];
}

function args(argv) {
  const a = { dir: "data/research", sku: null, limit: null, parts: ["picture", "facts"], force: false, concurrency: 3, reportOut: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") a.dir = argv[++i];
    else if (argv[i] === "--sku") a.sku = argv[++i];
    else if (argv[i] === "--limit") a.limit = Number(argv[++i]);
    else if (argv[i] === "--parts") a.parts = String(argv[++i]).split(",").map((s) => s.trim()).filter((s) => ["picture", "facts"].includes(s));
    else if (argv[i] === "--force") a.force = true;
    else if (argv[i] === "--concurrency") a.concurrency = Number(argv[++i]);
    else if (argv[i] === "--report-out") a.reportOut = argv[++i];
  }
  return a;
}

async function main(meter) {
  const a = args(process.argv.slice(2));
  const need = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", ...(a.parts.includes("picture") ? ["ANTHROPIC_API_KEY", "MODEL_FAST"] : [])];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) { console.error(`missing env: ${missing.join(", ")}`); process.exit(2); }
  const runId = process.env.RUN_ID || `local-${Date.now()}`;
  // The picture tools (sharp) live in scripts/images and are loaded only when pictures are asked for.
  const { makeStore } = await import("../images/lib/store.mjs");
  const store = makeStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY });
  const d = { store, runId, pictures: null };
  if (a.parts.includes("picture")) {
    const [{ loadSharp }, { checkPicture }, { download }, { proposeFromResearch }] = await Promise.all([
      import("../images/lib/image.mjs"), import("../images/lib/vision.mjs"), import("../images/fetch-images.mjs"), import("../images/research-pictures.mjs")]);
    const sharp = await loadSharp();
    if (!sharp) { console.error("sharp is not installed (npm ci --prefix scripts/images)"); process.exit(2); }
    const pd = { store, sharp, runId, model: process.env.MODEL_FAST, download,
      check: (item, jpeg) => checkPicture(item, jpeg, { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.MODEL_FAST }) };
    d.pictures = (item, candidates, meta) => proposeFromResearch(item, candidates, pd, meta);
  }
  let names = existsSync(a.dir) ? readdirSync(a.dir).filter((n) => /^AK-\d{4}\.json$/.test(n)).sort() : [];
  if (a.sku) names = names.filter((n) => n === `${a.sku}.json`);
  if (Number.isFinite(a.limit) && a.limit > 0) names = names.slice(0, a.limit);
  const state = new Map((await store.rpc("research_load_state")).map((i) => [i.sku, i]));
  console.log(`run ${runId}: ${names.length} research files in ${a.dir}; ${state.size} active catalog items; parts: ${a.parts.join(", ")}${a.force ? " (force)" : ""}`);
  let fatal = null;
  const results = await pool(names, a.concurrency, async (name) => {
    if (fatal || meter.capReached) return { file: name, invalid: "not_run" };   // at the cost cap no new file is started (COST1)
    try {
      const r = await loadFile(name, readFileSync(join(a.dir, name), "utf8"), state, d, { parts: a.parts, force: a.force });
      console.log(r.invalid ? `${r.sku ?? r.file} not loadable: ${r.invalid}` : `${r.sku} picture ${r.picture.outcome}; facts ${r.facts.outcome}${r.facts.proposed?.length ? ` (${r.facts.proposed.join(",")})` : ""}`);
      return r;
    } catch (e) { fatal = e; console.error(`stopping: ${e.message}`); return { file: name, invalid: "not_run" }; }
  });
  const coverage = await store.rpc("research_load_coverage");
  const s = summarise(results);
  const report = { run_id: runId, model: a.parts.includes("picture") ? process.env.MODEL_FAST : null, this_run: s, coverage };
  console.log(JSON.stringify(report, null, 2));
  if (a.reportOut) writeFileSync(a.reportOut, JSON.stringify(report, null, 2) + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, reportLines(runId, s, coverage).join("\n"));
  const ran = results.filter((r) => !r.invalid);
  const errors = ran.filter((r) => r.picture.outcome === "error" || r.facts.outcome === "error").length;
  if (fatal || coverage.approved_from_web_page !== 0 || (ran.length >= 10 && errors > ran.length / 2)) process.exitCode = 1;   // not process.exit: the cost is recorded first (COST1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runMetered({ workflow: "research-load", capDefault: 2, step: "picture" }, main);
