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
// Session PIX adds: web search hits are filed as `public_page` (founder decision, 14 Nov); a near-duplicate of a picture another item
// already has is rejected before the paid check (lib/dedupe.mjs); the items run fastest sellers first (supabase/seed/catalog.csv);
// every item ends with a candidate or a named reason (report.mjs); the run's file is pictures-run.json.
// Flags: --limit N  --sku AK-0001  --force (also items that already have a picture)  --no-search  --retry-all (also items an earlier run finished with nothing)  --concurrency N
//        --from-list data/pictures/candidates.csv  (PIX2: download exactly the listed pictures, run the same checks, queue the passes; no search, no Open Food Facts lookup)
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gate, fetchRetry, readCapped, pool } from "./lib/http.mjs";
import { customerUsable, hostOf, LICENCE_FOR } from "./lib/licence.mjs";
import { offLookup } from "./lib/off.mjs";
import { brandCandidates, openCandidates } from "./lib/search.mjs";
import { loadSharp, measure, shrink, MIN_WIDTH } from "./lib/image.mjs";
import { dhash, makeRegistry, loadRegistry } from "./lib/dedupe.mjs";
import { checkPicture, decide } from "./lib/vision.mjs";
import { makeStore } from "./lib/store.mjs";
import { parseCandidates } from "./lib/fromlist.mjs";
import { runMetered } from "../lib/model-cost.mjs";

export const MAX_CANDIDATES = 8;     // per item, over all sources
export const MAX_PER_SOURCE = 4;     // per item, from one source
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
    if (d.registry) {
      // Same picture as another item's (any size or format): refused here, before the paid check.
      out.hash = await (d.hash ?? dhash)(raw, d.sharp);
      const dup = d.registry.reserve(item.sku, out.hash);
      if (dup) { out.reasons.push(`duplicate:${dup.sku}`); out.duplicate_of = dup.sku; out.distance = dup.distance; return out; }
    }
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
const licenceOf = (e) => LICENCE_FOR[e.source_kind];

/** One item, start to finish. d = { off, brand, open, download, sharp, check, store, runId, model, searchOn } (all injectable). */
export async function processItem(item, d) {
  const sources = []; const evaluated = []; const errors = []; let seen = 0;
  // From-list mode (PIX2): only the pictures a person listed for this item; no search, same checks.
  const stages = d.listed ? [["listed", async () => d.listed.get(item.sku) ?? []]] : [["open_food_facts", () => (item.barcode ? d.off(item) : [])]];
  if (!d.listed && d.searchOn) stages.push(["brand_site", () => d.brand(item)], ["web_search", () => d.open(item)]);
  let winner = null;
  try {
    for (const [name, gather] of stages) {
      if (seen >= MAX_CANDIDATES) break;
      let cands;
      try { cands = (await gather()).filter((c) => fetchableUrl(c.imageUrl)); } catch (e) { errors.push({ stage: name, error: String(e.message).slice(0, 120) }); continue; }
      sources.push(name);
      const seenUrls = new Set(evaluated.map((e) => e.image_url));
      cands = cands.filter((c) => !seenUrls.has(c.imageUrl)).slice(0, Math.min(MAX_PER_SOURCE, MAX_CANDIDATES - seen));
      for (const c of cands) { seen++; evaluated.push({ ...(await evaluate(item, c, d)), page_url: c.pageUrl, attribution: c.attribution, found_at: c.foundAt ?? null }); }
      const kept = evaluated.filter((e) => e.kept).sort(better);
      winner = kept[0] ?? null;
      if (winner && customerUsable(licenceOf(winner))) break;   // a usable picture: no need to spend on the later stages
    }
    d.registry?.release(item.sku, winner?.hash ?? null);   // a picture that was reserved but not used is free for other items again
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
      p_vision: { run_id: d.runId, model: d.model, report: winner.report, original_width: winner.orig_width, original_height: winner.orig_height, checked_at: new Date().toISOString(),
        retrieved_at: new Date().toISOString(), listed_found_at: winner.found_at ?? null, phash: winner.hash ?? null, rank: item.rank ?? null, candidates: summary },
      p_replace: customerUsable(licenceOf(winner)) });
    const outcome = res?.ok ? "proposed" : res?.skipped === "rejected_before" ? "skipped_rejected" : "none_passed";
    await d.store.rpc("record_product_image_attempt", { p_product: item.product_id, p_run: d.runId, p_sources: sources, p_seen: seen, p_kept: keptCount, p_outcome: outcome, p_detail: { evaluated: summary, errors, propose: res } });
    return { sku: item.sku, outcome, source_kind: winner.source_kind, licence: licenceOf(winner), skipped: res?.skipped };
  } catch (e) {
    d.registry?.release(item.sku, null);
    if (e instanceof Fatal) throw e;
    try { await d.store.rpc("record_product_image_attempt", { p_product: item.product_id, p_run: d.runId, p_sources: sources, p_seen: seen, p_kept: 0, p_outcome: "error", p_detail: { error: String(e.message).slice(0, 200) } }); } catch { /* the run summary still shows it */ }
    return { sku: item.sku, outcome: "error", error: String(e.message).slice(0, 120) };
  }
}

/** Items an earlier run already looked at to the end with the sources that are on now, and found nothing: not asked again.
 *  An error is not a result: those items are always tried again. --retry-all ignores this. */
export function conclusiveSkips(attempts, searchOn) {
  const need = ["open_food_facts", ...(searchOn ? ["web_search"] : [])];
  const skip = new Set();
  for (const a of attempts ?? []) {
    if (["none_found", "none_passed"].includes(a.outcome) && need.every((n) => (a.sources_tried ?? []).includes(n))) skip.add(a.product_id);
  }
  return skip;
}

/** Splits one CSV line (quotes allowed, "" inside quotes). */
function csvLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out;
}

/** SKU -> units sold, from supabase/seed/catalog.csv ("Tawfeer units sold": the reference the catalog's velocity tiers come from). */
export function salesBySku(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  const head = csvLine(lines[0]); const iSku = head.indexOf("SKU"); const iUnits = head.indexOf("Tawfeer units sold");
  if (iSku < 0 || iUnits < 0) throw new Error("catalog.csv: SKU or 'Tawfeer units sold' column missing");
  const m = new Map();
  for (const l of lines.slice(1)) { const c = csvLine(l); const n = Number(c[iUnits]); if (c[iSku]) m.set(c[iSku], Number.isFinite(n) ? n : 0); }
  return m;
}

/** Fastest sellers first (ties and unknowns by SKU). `rank` is 1 for the fastest of the whole catalog, not of this run. */
export function rankItems(items, sales) {
  const order = [...sales.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([sku]) => sku);
  const pos = new Map(order.map((sku, i) => [sku, i + 1]));
  return items.map((i) => ({ ...i, rank: pos.get(i.sku) ?? null, units: sales.get(i.sku) ?? null }))
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || String(a.sku).localeCompare(String(b.sku)));
}

export function summarise(results, coverage) {
  const by = {}; const lic = {};
  for (const r of results) { by[r.outcome] = (by[r.outcome] ?? 0) + 1; if (r.outcome === "proposed") lic[r.licence] = (lic[r.licence] ?? 0) + 1; }
  const dup = results.filter((r) => (r.reasons ?? []).some((x) => String(x).startsWith("duplicate:"))).length;
  const errs = {};
  for (const r of results) if (r.outcome === "error" && r.error) errs[r.error] = (errs[r.error] ?? 0) + 1;
  return { processed: results.length, outcomes: by, proposed_by_licence: lic, errors_by_message: errs, items_with_a_duplicate_rejected: dup, coverage };
}

function args(argv) {
  const a = { limit: null, sku: null, force: false, search: true, retryAll: false, concurrency: 4, fromList: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") a.limit = Number(argv[++i]);
    else if (argv[i] === "--sku") a.sku = argv[++i];
    else if (argv[i] === "--force") a.force = true;
    else if (argv[i] === "--no-search") a.search = false;
    else if (argv[i] === "--retry-all") a.retryAll = true;
    else if (argv[i] === "--from-list") a.fromList = argv[++i];
    else if (argv[i] === "--concurrency") a.concurrency = Number(argv[++i]);
  }
  return a;
}

async function main(meter) {
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
  const braveCalls = { n: 0 };
  const offGate = gate(4000);           // Open Food Facts answered 429 at 1.5 s between reads from a GitHub runner: 15 a minute
  const searchGate = gate(1100);        // one request a second, the provider's lowest limit
  const runId = process.env.RUN_ID || `local-${Date.now()}`;
  const d = {
    store, sharp, runId, model: process.env.MODEL_FAST, searchOn, download,
    off: async (item) => (await offLookup(item.barcode, { wait: offGate })).candidates,
    brand: (item) => brandCandidates(item, searchKey, sites, { wait: searchGate, onRequest: () => braveCalls.n++ }),
    open: (item) => openCandidates(item, searchKey, sites, { wait: searchGate, onRequest: () => braveCalls.n++ }),
    registry: makeRegistry(),
    check: (item, jpeg) => checkPicture(item, jpeg, { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.MODEL_FAST }),
  };
  let items = await store.rpc("product_images_to_fetch", { p_limit: a.limit, p_force: a.force });
  if (a.sku) items = items.filter((i) => i.sku === a.sku);
  if (a.fromList) {
    const { bySku, dropped } = parseCandidates(readFileSync(a.fromList, "utf8"));
    d.listed = bySku; d.searchOn = false;
    const before = items.length;
    items = items.filter((i) => bySku.has(i.sku));
    console.log(`from list ${a.fromList}: ${bySku.size} items listed (${dropped} rows without an https picture and page dropped); ${items.length} of them still need a picture (${before - items.length} not offered by the database or not listed)`);
  }
  // The fastest sellers go first, so their candidates are the first in the approval queue.
  const sales = salesBySku(readFileSync(fileURLToPath(new URL("../../supabase/seed/catalog.csv", import.meta.url)), "utf8"));
  const ranked = rankItems(items, sales);
  const reg = await loadRegistry(d.registry, store, sharp);
  console.log(`duplicate check: ${reg.loaded} pictures already held (${reg.backfilled} hashed from the bucket, ${reg.failed} unreadable)`);
  let skipped = 0;
  items = ranked;
  if (!a.retryAll && !a.force && !a.fromList) {
    const skip = conclusiveSkips(await store.select("product_image_attempts", "select=product_id,outcome,sources_tried&outcome=in.(none_found,none_passed)"), searchOn);
    const before = items.length;
    items = items.filter((i) => !skip.has(i.product_id));
    skipped = before - items.length;
  }
  console.log(`first in the queue: ${items.slice(0, 20).map((i) => `${i.sku}(${i.units})`).join(" ")}`);
  console.log(`run ${runId}: ${items.length} items (${skipped} skipped: already looked at to the end); sources: ${a.fromList ? `the list ${a.fromList}` : `Open Food Facts${searchOn ? ", brand sites, web image search" : " only (no BRAVE_SEARCH_API_KEY, or --no-search)"}`}`);
  let fatal = null;
  const results = await pool(items, a.concurrency, async (item) => {
    if (fatal || meter.capStop()) return { sku: item.sku, outcome: "not_run" };   // at the cost cap no new item is started (COST1)
    try {
      const r = { ...(await processItem(item, d)), rank: item.rank, units: item.units };
      console.log(`${item.sku} ${r.outcome}${r.source_kind ? ` (${r.source_kind})` : ""}${r.error ? ` ${r.error}` : ""}`);
      return r;
    } catch (e) { fatal = e; console.error(`stopping: ${e.message}`); return { sku: item.sku, outcome: "not_run" }; }
  });
  const coverage = await store.rpc("product_image_coverage");
  const s = summarise(results, coverage);
  s.search_requests = braveCalls.n;
  writeFileSync("pictures-run.json", JSON.stringify({ run_id: runId, finished_at: new Date().toISOString(), summary: s, results }, null, 1));
  console.log(JSON.stringify(s, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `### Product pictures, run ${runId}`,
      `- sources: ${a.fromList ? `the list ${a.fromList} (no search)` : `Open Food Facts${searchOn ? ", brand sites, web image search (Brave)" : " only"}`}`,
      `- processed this run: ${s.processed}; outcomes: ${JSON.stringify(s.outcomes)}`,
      `- proposed this run by licence: ${JSON.stringify(s.proposed_by_licence)}`,
      `- errors by message: ${JSON.stringify(s.errors_by_message)}`,
      `- web search requests this run: ${braveCalls.n} (about USD ${(braveCalls.n * 0.005).toFixed(2)} at the price in docs/DECISIONS.md; not counted by the model meter); near-duplicates rejected on ${s.items_with_a_duplicate_rejected} items`,
      `- **catalog now: ${coverage.items} items; usable proposed ${coverage.proposed_usable} (Open Food Facts ${coverage.open_food_facts}, brand site ${coverage.brand_site}); approved ${coverage.approved}; licence-unknown only ${coverage.unknown_licence_only}; photograph at intake ${coverage.photograph_at_intake}**`, ""].join("\n"));
  }
  const errors = s.outcomes.error ?? 0;
  if (fatal || (items.length >= 10 && errors > items.length / 2)) process.exitCode = 1;   // not process.exit: the cost is recorded first (COST1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runMetered({ workflow: "images", capDefault: 2, step: "picture check" }, main);
