#!/usr/bin/env node
// Build plan 5.17, steps 1-5: one clean, usable picture per catalog item, proposed for a person to approve.
// Runs in GitHub Actions (.github/workflows/images.yml); cloud build sessions cannot reach these sites.
//
//   1. read the items that still need a picture (product_images_to_fetch)
//   2. gather up to five candidates per item: Open Food Facts by barcode, then the brand's own site, then web image search
//   3. vision check (fast model): same brand, product and size; one pack; plain background; >= 800 px; no watermark/price/logo
//   4. licence: the source decides it (licence.mjs; 0050 enforces the pairing). Open Food Facts keeps its CC BY-SA attribution.
//      Search results are licence "unknown": kept as a guide for the intake photo, never shown to customers.
//   5. best usable candidate: longest side 1200 px, under 300 KB, saved in the private `media` bucket, status `proposed`
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, MODEL_FAST; optional BRAVE_SEARCH_API_KEY (else Open Food Facts only).
// Flags: --limit N  --sku AK-0001  --force (also items that already have a picture)  --no-search  --concurrency N
import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gate, fetchRetry, readCapped, pool } from "./lib/http.mjs";
import { customerUsable, hostOf } from "./lib/licence.mjs";
import { offLookup } from "./lib/off.mjs";
import { brandCandidates, openCandidates } from "./lib/search.mjs";
import { loadSharp, measure, shrink, MIN_WIDTH } from "./lib/image.mjs";
import { checkPicture, decide } from "./lib/vision.mjs";
import { makeStore } from "./lib/store.mjs";

export const MAX_CANDIDATES = 5;
export class Fatal extends Error {}

const isIpLiteral = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal");
export function fetchableUrl(u) {
  const h = hostOf(u);
  return !!h && u.startsWith("https://") && !isIpLiteral(h);
}

export async function download(url, { fetchImpl = fetch } = {}) {
  if (!fetchableUrl(url)) throw new Error("bad_url");
  const res = await fetchRetry(url, { headers: { accept: "image/*" } }, { fetchImpl, retries: 1 });
  if (!res.ok) throw new Error(`download_${res.status}`);
  return readCapped(res, 15 * 1024 * 1024);
}

/** Looks at one candidate. Never throws for a bad picture: the reasons say why it was not kept. */
export async function evaluate(item, cand, d) {
  const out = { source_kind: cand.sourceKind, image_url: cand.imageUrl, kept: false, reasons: [] };
  try {
    const raw = await d.download(cand.imageUrl);
    const m = await (d.measure ?? measure)(raw, d.sharp);
    out.width = m.width;
    if (m.width < MIN_WIDTH) { out.reasons.push("narrow"); return out; }
    const small = await (d.shrink ?? shrink)(raw, d.sharp);
    const report = await d.check(item, small.data);
    const verdict = decide(report, m.width, MIN_WIDTH);
    Object.assign(out, { kept: verdict.keep, reasons: verdict.reasons, report, orig_width: m.width, orig_height: m.height, small });
  } catch (e) {
    if (e instanceof Fatal || /^vision_http_(400|401|403)$/.test(e.message)) throw new Fatal(e.message);
    out.reasons.push(`error:${String(e.message).slice(0, 60)}`);
  }
  return out;
}

const better = (a, b) => (customerUsable(licenceOf(b)) - customerUsable(licenceOf(a))) || ((b.width ?? 0) - (a.width ?? 0));
const licenceOf = (e) => ({ open_food_facts: "cc_by_sa", brand_site: "brand_own", web_search: "unknown" })[e.source_kind];

/** One item, start to finish. d = { off, brand, open, download, sharp, check, store, runId, model, searchOn } (all injectable). */
export async function processItem(item, d) {
  const sources = []; const evaluated = []; const errors = []; let seen = 0;
  const stages = [["open_food_facts", () => (item.barcode ? d.off(item) : [])]];
  if (d.searchOn) stages.push(["brand_site", () => d.brand(item)], ["web_search", () => d.open(item)]);
  let winner = null;
  try {
    for (const [name, gather] of stages) {
      if (seen >= MAX_CANDIDATES) break;
      let cands;
      try { cands = (await gather()).filter((c) => fetchableUrl(c.imageUrl)); } catch (e) { errors.push({ stage: name, error: String(e.message).slice(0, 120) }); continue; }
      sources.push(name);
      const seenUrls = new Set(evaluated.map((e) => e.image_url));
      cands = cands.filter((c) => !seenUrls.has(c.imageUrl)).slice(0, MAX_CANDIDATES - seen);
      for (const c of cands) { seen++; evaluated.push({ ...(await evaluate(item, c, d)), page_url: c.pageUrl, attribution: c.attribution }); }
      const kept = evaluated.filter((e) => e.kept).sort(better);
      winner = kept[0] ?? null;
      if (winner && customerUsable(licenceOf(winner))) break;   // a usable picture: no need to spend on the later stages
    }
    const summary = evaluated.map(({ small, report, ...rest }) => rest);
    if (!seen) {
      // A lookup that failed is an error, not "nothing found": the two must never be confused.
      const outcome = errors.length && !sources.length ? "error" : "none_found";
      await d.store.rpc("record_product_image_attempt", { p_product: item.product_id, p_run: d.runId, p_sources: sources, p_seen: 0, p_kept: 0, p_outcome: outcome, p_detail: { errors } });
      return { sku: item.sku, outcome, error: errors[0]?.error };
    }
    const keptCount = evaluated.filter((e) => e.kept).length;
    if (!winner) {
      await d.store.rpc("record_product_image_attempt", { p_product: item.product_id, p_run: d.runId, p_sources: sources, p_seen: seen, p_kept: 0, p_outcome: "none_passed", p_detail: { evaluated: summary, errors } });
      return { sku: item.sku, outcome: "none_passed", reasons: summary.flatMap((s) => s.reasons ?? []) };
    }
    const path = `product_images/${item.sku}/${winner.small.sha256.slice(0, 16)}.jpg`;
    await d.store.upload(path, winner.small.data);
    const res = await d.store.rpc("propose_product_image", {
      p_product: item.product_id, p_source_kind: winner.source_kind, p_source_url: winner.image_url, p_page_url: winner.page_url ?? null,
      p_attribution: winner.attribution ?? null, p_media_path: path, p_sha256: winner.small.sha256,
      p_width: winner.small.width, p_height: winner.small.height, p_bytes: winner.small.bytes,
      p_vision: { run_id: d.runId, model: d.model, report: winner.report, original_width: winner.orig_width, original_height: winner.orig_height, checked_at: new Date().toISOString(), candidates: summary },
      p_replace: customerUsable(licenceOf(winner)) });
    const outcome = res?.ok ? "proposed" : res?.skipped === "rejected_before" ? "skipped_rejected" : "none_passed";
    await d.store.rpc("record_product_image_attempt", { p_product: item.product_id, p_run: d.runId, p_sources: sources, p_seen: seen, p_kept: keptCount, p_outcome: outcome, p_detail: { evaluated: summary, errors, propose: res } });
    return { sku: item.sku, outcome, source_kind: winner.source_kind, licence: licenceOf(winner), skipped: res?.skipped };
  } catch (e) {
    if (e instanceof Fatal) throw e;
    try { await d.store.rpc("record_product_image_attempt", { p_product: item.product_id, p_run: d.runId, p_sources: sources, p_seen: seen, p_kept: 0, p_outcome: "error", p_detail: { error: String(e.message).slice(0, 200) } }); } catch { /* the run summary still shows it */ }
    return { sku: item.sku, outcome: "error", error: String(e.message).slice(0, 120) };
  }
}

export function summarise(results, coverage) {
  const by = {}; const lic = {};
  for (const r of results) { by[r.outcome] = (by[r.outcome] ?? 0) + 1; if (r.outcome === "proposed") lic[r.licence] = (lic[r.licence] ?? 0) + 1; }
  const errs = {};
  for (const r of results) if (r.outcome === "error" && r.error) errs[r.error] = (errs[r.error] ?? 0) + 1;
  return { processed: results.length, outcomes: by, proposed_by_licence: lic, errors_by_message: errs, coverage };
}

function args(argv) {
  const a = { limit: null, sku: null, force: false, search: true, concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") a.limit = Number(argv[++i]);
    else if (argv[i] === "--sku") a.sku = argv[++i];
    else if (argv[i] === "--force") a.force = true;
    else if (argv[i] === "--no-search") a.search = false;
    else if (argv[i] === "--concurrency") a.concurrency = Number(argv[++i]);
  }
  return a;
}

async function main() {
  const a = args(process.argv.slice(2));
  const need = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ANTHROPIC_API_KEY", "MODEL_FAST"];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) { console.error(`missing env: ${missing.join(", ")}`); process.exit(2); }
  const sharp = await loadSharp();
  if (!sharp) { console.error("sharp is not installed (npm ci in scripts/images)"); process.exit(2); }
  const searchKey = process.env.BRAVE_SEARCH_API_KEY || "";
  const searchOn = a.search && !!searchKey;
  const sites = JSON.parse(readFileSync(fileURLToPath(new URL("./brand-sites.json", import.meta.url)), "utf8"));
  const store = makeStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY });
  const offGate = gate(1500);           // Open Food Facts allows about 100 product reads a minute; stay well under it
  const searchGate = gate(1100);        // one request a second, the provider's lowest limit
  const runId = process.env.RUN_ID || `local-${Date.now()}`;
  const d = {
    store, sharp, runId, model: process.env.MODEL_FAST, searchOn, download,
    off: async (item) => (await offLookup(item.barcode, { wait: offGate })).candidates,
    brand: (item) => brandCandidates(item, searchKey, sites, { wait: searchGate }),
    open: (item) => openCandidates(item, searchKey, sites, { wait: searchGate }),
    check: (item, jpeg) => checkPicture(item, jpeg, { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.MODEL_FAST }),
  };
  let items = await store.rpc("product_images_to_fetch", { p_limit: a.limit, p_force: a.force });
  if (a.sku) items = items.filter((i) => i.sku === a.sku);
  console.log(`run ${runId}: ${items.length} items; sources: Open Food Facts${searchOn ? ", brand sites, web image search" : " only (no BRAVE_SEARCH_API_KEY, or --no-search)"}`);
  let fatal = null;
  const results = await pool(items, a.concurrency, async (item) => {
    if (fatal) return { sku: item.sku, outcome: "not_run" };
    try {
      const r = await processItem(item, d);
      console.log(`${item.sku} ${r.outcome}${r.source_kind ? ` (${r.source_kind})` : ""}${r.error ? ` ${r.error}` : ""}`);
      return r;
    } catch (e) { fatal = e; console.error(`stopping: ${e.message}`); return { sku: item.sku, outcome: "not_run" }; }
  });
  const coverage = await store.rpc("product_image_coverage");
  const s = summarise(results, coverage);
  console.log(JSON.stringify(s, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `### Product pictures, run ${runId}`,
      `- sources: Open Food Facts${searchOn ? ", brand sites, web image search (Brave)" : " only"}`,
      `- processed this run: ${s.processed}; outcomes: ${JSON.stringify(s.outcomes)}`,
      `- proposed this run by licence: ${JSON.stringify(s.proposed_by_licence)}`,
      `- errors by message: ${JSON.stringify(s.errors_by_message)}`,
      `- **catalog now: ${coverage.items} items; usable proposed ${coverage.proposed_usable} (Open Food Facts ${coverage.open_food_facts}, brand site ${coverage.brand_site}); approved ${coverage.approved}; licence-unknown only ${coverage.unknown_licence_only}; photograph at intake ${coverage.photograph_at_intake}**`, ""].join("\n"));
  }
  const errors = s.outcomes.error ?? 0;
  if (fatal || (items.length >= 10 && errors > items.length / 2)) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.message); process.exit(1); });
