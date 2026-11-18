#!/usr/bin/env node
// PIX4: the founder's own pictures (a release's zip, already unzipped by the workflow into a NEW folder outside the repository) into
// the approval queue. Free: no model call, no network except the project's own Supabase. See lib/importcheck.mjs for the rules.
//   node scripts/images/import-release.mjs --dir <unzipped folder> [--dry-run] [--out <folder>] [--release pictures-1]
// --dry-run reads the catalogue from supabase/seed/catalog.csv, checks and converts everything, uploads and writes nothing.
// A live run needs SUPABASE_URL and SUPABASE_SERVICE_KEY. It proposes (never approves): a picture that passes every check as `proposed`;
// a picture that fails a check, or that came in the review folder, as `proposed` with needs_review and the reasons. A file that cannot be
// matched to a product is listed, not stored. Stored under the private `media` bucket as product_images/<sku>/<hash>.webp, 1000 x 1000.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./lib/http.mjs";
import { loadSharp } from "./lib/image.mjs";
import { makeRegistry, loadRegistry } from "./lib/dedupe.mjs";
import { makeStore } from "./lib/store.mjs";
import { analyse, checkAnalysis, dhash, dhash64, findDuplicates, isPicture, matchFiles, parseReport, skuFromName, toWebp } from "./lib/importcheck.mjs";

export const BUDGET_BYTES = 40 * 1000 * 1000;      // what this run may add to the bucket, in total
export const ALREADY_APPROVED = new Set(["AK-0016"]);   // the cauliflower: approved, not touched (founder's instruction)
const FOLDERS = ["product_images", "product_images_review"];

/** Finds the two picture folders and the newest report (image_fetch_report*.csv) within three levels of `root`. */
export function discover(root) {
  const found = { folders: {}, reports: [] };
  const walk = (dir, depth) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (FOLDERS.includes(e.name) && !found.folders[e.name]) found.folders[e.name] = p; else if (depth < 3 && !e.name.startsWith("__")) walk(p, depth + 1); }
      else if (/^image_fetch_report.*\.csv$/i.test(e.name)) found.reports.push(p);
    }
  };
  walk(root, 0);
  found.reports.sort((a, b) => basename(a).localeCompare(basename(b), "en", { numeric: true }));
  return { folders: found.folders, report: found.reports.at(-1) ?? null, reports: found.reports };
}

const clean = (s, n = 300) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n);
const https = (u) => (/^https:\/\/[^\s]+$/.test(String(u ?? "")) ? String(u).slice(0, 1000) : null);

export function sourceNote(m, release, reportName) {
  const row = m.row;
  const where = [`${m.folder}/${m.file}`, row ? `report ${reportName} row ${row.row}` : "no row in the report", `matched by ${m.by === "code" ? "the product code in the file name" : "the report's row"}`];
  if (row?.query) where.push(`query "${clean(row.query, 120)}"`);
  const addr = row ? [row.imageUrl && `picture address ${clean(row.imageUrl, 300)}`, row.pageUrl && `page address ${clean(row.pageUrl, 300)}`].filter(Boolean) : [];
  return `founder's upload, release ${release}: ${where.join("; ")}; ${addr.length ? addr.join("; ") : "the report records no picture address and no page address"}`.slice(0, 900);
}

/** The whole plan for the files: matching, checks, conversion, duplicates. No side effect beyond reading. `read(folder, file)` returns the bytes. */
export async function plan({ folders, report, reportName, products, existing, held, sharp, read, release = "pictures-1", concurrency = 4 }) {
  const skus = new Set(products.map((p) => p.sku));
  const files = [];
  for (const [folder, dir] of Object.entries(folders)) for (const name of readdirSync(dir).sort()) if (isPicture(name)) files.push({ name, folder, dir });
  const { matched, unmatched } = matchFiles(files, report, skus);
  const items = await pool(matched, concurrency, async (m) => {
    const out = { ...m, reasons: [], notes: [], outcome: null };
    const ex = existing.get(m.sku);
    if (ALREADY_APPROVED.has(m.sku) || ex?.approved) { out.outcome = "skipped_already_approved"; return out; }
    if (ex?.otherProposal) { out.outcome = "skipped_other_proposal"; return out; }
    let buf;
    try { buf = read(m); } catch (e) { out.outcome = "failed"; out.reasons.push(`unreadable:${clean(e.message, 60)}`); return out; }
    try {
      const a = await analyse(buf, sharp); out.analysis = a;
      out.reasons.push(...checkAnalysis(a));
      if (a.width < 1000 || a.height < 1000) out.notes.push(`enlarged from ${a.width}x${a.height}`);
      const w = await toWebp(buf, sharp); out.webp = w;
      if (w.heavy) out.reasons.push(`heavy:${Math.round(w.bytes / 1000)} KB at quality ${w.quality} (limit 80 KB)`);
      out.hash = await dhash(w.data, sharp); out.bits = await dhash64(w.data, sharp);
    } catch (e) { out.outcome = "failed"; out.reasons.push(`does not open:${clean(e.message, 60)}`); }
    if (m.row?.status && !/^ok$/i.test(m.row.status)) out.reasons.push(`report status:${clean(m.row.status, 40)}`);
    if (m.folder === "product_images_review") out.reasons.push("in the review folder (packaged by the founder's script for a person to judge)");
    return out;
  });
  const dups = findDuplicates(items.filter((i) => i.hash).map((i) => ({ sku: i.sku, hash: i.hash, bits: i.bits })), held);
  for (const i of items) if (dups.has(i.sku)) i.reasons.push(...dups.get(i.sku));
  for (const i of items) {
    if (i.outcome) continue;
    i.outcome = i.reasons.length ? "needs_review" : "proposed";
  }
  return { items, unmatched, files: files.length };
}

const reasonCode = (r) => String(r).split(/[:( ]/)[0];
export function summarise({ items, unmatched, files }, extra = {}) {
  const by = {}; for (const i of items) by[i.outcome] = (by[i.outcome] ?? 0) + 1;
  const failed = {}; for (const i of items) for (const r of i.reasons) { const k = reasonCode(r); failed[k] = (failed[k] ?? 0) + 1; }
  const checkFails = items.filter((i) => i.reasons.some((r) => !r.startsWith("in the review folder"))).length;
  return { files, matched: items.length, unmatched: unmatched.length, outcomes: by, items_with_a_failed_check: checkFails, reasons: failed, ...extra };
}

export const toRows = ({ items, unmatched }) => [
  ...items.map((i) => ({ sku: i.sku, file: `${i.folder}/${i.file}`, outcome: i.outcome, reasons: i.reasons.join(" | "), bytes: i.webp?.bytes ?? "", quality: i.webp?.quality ?? "", stored: i.stored ?? "" })),
  ...unmatched.map((u) => ({ sku: "", file: `${u.folder}/${u.file}`, outcome: "unmatched", reasons: u.reason, bytes: "", quality: "", stored: "" })),
];
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows) => ["sku,file,outcome,reasons,bytes,quality,stored", ...rows.map((r) => ["sku", "file", "outcome", "reasons", "bytes", "quality", "stored"].map((k) => csvCell(r[k])).join(","))].join("\n") + "\n";

/** Markdown of the items still without a picture, by aisle: [{ aisle_en, sku, name_en, ... }] in shop order. */
export function missingMarkdown(missing) {
  const by = new Map(); for (const m of missing) { const k = m.aisle_en; by.set(k, [...(by.get(k) ?? []), m]); }
  if (!by.size) return "No item is without a picture.\n";
  return [...by.entries()].map(([aisle, list]) => `**${aisle}** (${list.length})\n${list.map((m) => `- ${m.sku} ${m.name_en}${m.rejected_before ? " (a picture was rejected before)" : ""}`).join("\n")}\n`).join("\n");
}

function args(argv) {
  const a = { dir: null, dryRun: false, out: "pictures-import", release: "pictures-1", catalog: fileURLToPath(new URL("../../supabase/seed/catalog.csv", import.meta.url)) };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") a.dir = argv[++i]; else if (argv[i] === "--dry-run") a.dryRun = true; else if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--release") a.release = argv[++i]; else if (argv[i] === "--catalog") a.catalog = argv[++i];
  }
  return a;
}

function catalogProducts(csvPath) {
  const lines = readFileSync(csvPath, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const rows = parseReport(lines.join("\n"));     // the catalogue's own header has SKU and Item: the same reader
  return rows.filter((r) => r.sku).map((r) => ({ id: null, sku: r.sku, name_en: r.product, is_active: true }));
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.dir) { console.error("usage: import-release.mjs --dir <unzipped folder> [--dry-run] [--out <folder>]"); process.exit(2); }
  const sharp = await loadSharp();
  if (!sharp) { console.error("sharp is not installed (npm ci in scripts/images)"); process.exit(2); }
  const found = discover(a.dir);
  if (!Object.keys(found.folders).length) { console.error(`no product_images or product_images_review folder under ${a.dir}`); process.exit(2); }
  const reportName = found.report ? basename(found.report) : "(no report)";
  const report = found.report ? parseReport(readFileSync(found.report, "utf8")) : [];
  console.log(`folders: ${Object.keys(found.folders).join(", ")}; report ${reportName} (${report.length} rows; all reports: ${found.reports.map((r) => basename(r)).join(", ") || "none"})`);

  let store = null; let products; const existing = new Map(); const held = makeRegistry();
  if (!a.dryRun) {
    const need = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]; const missing = need.filter((k) => !process.env[k]);
    if (missing.length) { console.error(`missing env: ${missing.join(", ")}`); process.exit(2); }
    store = makeStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY });
    products = (await store.select("products", "select=id,sku,name_en,is_active&is_active=eq.true&limit=5000")).filter((p) => p.sku);
    const imgs = await store.select("product_images", "select=product_id,status,source_kind&status=in.(approved,proposed)&limit=10000");
    const bySku = new Map(products.map((p) => [p.id, p.sku]));
    for (const i of imgs) { const sku = bySku.get(i.product_id); if (!sku) continue; const e = existing.get(sku) ?? {}; if (i.status === "approved") e.approved = true; else if (i.source_kind !== "founder_upload") e.otherProposal = true; existing.set(sku, e); }
    const reg = await loadRegistry(held, store, sharp);
    console.log(`duplicate check: ${reg.loaded} pictures already in the queue or approved (${reg.backfilled} hashed from the bucket, ${reg.failed} unreadable)`);
  } else products = catalogProducts(a.catalog);

  const read = (m) => readFileSync(join(found.folders[m.folder], m.file));
  const p = await plan({ folders: found.folders, report, reportName, products, existing, held, sharp, read, release: a.release });
  const sum = summarise(p);
  console.log(JSON.stringify(sum, null, 1));

  const byProduct = new Map(products.map((x) => [x.sku, x]));
  let before = null, after = null, uploaded = 0, spent = 0;
  if (store) {
    before = await store.rpc("storage_bucket_bytes", { p_bucket: "media" });
    const runId = `pix4-${process.env.RUN_ID || Date.now()}`;
    await pool(p.items.filter((i) => ["proposed", "needs_review"].includes(i.outcome)), 4, async (i) => {
      if (spent + i.webp.bytes > BUDGET_BYTES) { i.outcome = "not_stored_budget"; i.reasons.push("the run's 40 MB ceiling"); return; }
      spent += i.webp.bytes;
      try {
        const path = `product_images/${i.sku}/${i.webp.sha256.slice(0, 16)}.webp`;
        await store.upload(path, i.webp.data, "image/webp");
        const row = i.row; const reasons = i.reasons.concat(i.notes.map((n) => `note:${n}`));
        const res = await store.rpc("propose_picture_import", {
          p_product: byProduct.get(i.sku).id, p_media_path: path, p_sha256: i.webp.sha256, p_width: i.webp.width, p_height: i.webp.height, p_bytes: i.webp.bytes,
          p_source_note: sourceNote(i, a.release, reportName), p_source_url: https(row?.imageUrl), p_page_url: https(row?.pageUrl),
          p_needs_review: i.outcome === "needs_review", p_check_notes: reasons,
          p_vision: { run_id: runId, release: a.release, file: `${i.folder}/${i.file}`, phash: i.hash, dhash64: i.bits, quality: i.webp.quality, original: i.analysis ? { width: i.analysis.width, height: i.analysis.height, format: i.analysis.format } : null, checked_at: new Date().toISOString() } });
        i.stored = path; uploaded++;
        if (!res?.ok) { i.outcome = `skipped_${res?.skipped ?? "not_proposed"}`; }
        else await store.rpc("record_product_image_attempt", { p_product: byProduct.get(i.sku).id, p_run: runId, p_sources: ["founder_upload"], p_seen: 1, p_kept: i.outcome === "proposed" ? 1 : 0, p_outcome: "proposed", p_detail: { release: a.release, file: i.file, reasons } });
      } catch (e) { i.outcome = "failed"; i.reasons.push(`upload or propose failed:${clean(e.message, 100)}`); }
    });
    after = await store.rpc("storage_bucket_bytes", { p_bucket: "media" });
  }
  const final = summarise(p, { uploaded_files: uploaded, uploaded_bytes: spent, bucket_bytes_before: before, bucket_bytes_after: after });
  const missing = store ? await store.rpc("pictures_missing") : products.filter((x) => !p.items.some((i) => i.sku === x.sku && ["proposed", "needs_review"].includes(i.outcome))).map((x) => ({ sku: x.sku, name_en: x.name_en, aisle_en: "(aisle needs the database)" }));
  const coverage = store ? await store.rpc("product_image_coverage") : null;
  mkdirSync(a.out, { recursive: true });
  const rows = toRows(p);
  writeFileSync(join(a.out, "pictures-import.csv"), toCsv(rows));
  writeFileSync(join(a.out, "pictures-import.json"), JSON.stringify({ release: a.release, report: reportName, dry_run: a.dryRun, summary: final, coverage, unmatched: p.unmatched, still_no_photo: missing }, null, 1));
  writeFileSync(join(a.out, "pictures-missing.md"), missingMarkdown(missing));
  console.log(JSON.stringify(final, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`### Founder pictures (${a.release})${a.dryRun ? " (dry run)" : ""}`,
    `- files ${final.files}; matched ${final.matched}; unmatched ${final.unmatched}; outcomes ${JSON.stringify(final.outcomes)}`,
    `- items with a failed check: ${final.items_with_a_failed_check}; reasons ${JSON.stringify(final.reasons)}`,
    `- uploaded ${uploaded} files, ${(spent / 1e6).toFixed(2)} MB (ceiling 40 MB); bucket \`media\` before ${before === null ? "n/a" : (before / 1e6).toFixed(2) + " MB"}, after ${after === null ? "n/a" : (after / 1e6).toFixed(2) + " MB"}`,
    `- still without a picture: ${missing.length}${coverage ? `; queue: ${JSON.stringify(coverage)}` : ""}`, ""].join("\n"));
  if ((final.outcomes.failed ?? 0) > 0 && !a.dryRun) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });
