// PIX4: the founder's own pictures (release "pictures-1"), matched to products and checked by script. No model, no network, no cost.
// Pictures are untrusted input: sharp decodes them with a pixel cap, and every one is re-encoded (nothing of the original is kept).
//   match   the product code in the file name (AK-0123), else the report's row for that file name; never a guess; a file two products
//           claim, a code the catalogue does not have, and a file the report puts under another code are listed as unmatched
//   checks  opens; the short side is at least 600 px; the background is near-white (the border of the picture); the product fills the square
//           (the dark area's longest side is at least 55 % of the 1000 px square); no near-duplicate of another product's picture;
//           small enough once stored (under 80 KB). A failed check is a reason, and the picture goes to review with it.
//   store   1000 x 1000 WebP, quality about 80 (stepped down only to get under 80 KB), white padding, every bit of metadata stripped
import { createHash } from "node:crypto";
import { dhash, hamming, NEAR } from "./dedupe.mjs";

export const SIDE = 1000;
export const MIN_SIDE = 600;
export const MAX_BYTES = 80 * 1000;          // decimal, so "under 80 KB" holds in either unit
export const QUALITIES = [80, 77, 74, 71, 68, 65, 62, 58];
export const WHITE = 235;                    // a channel at or above this is "near white" (JPEG noise on white stays above it)
export const BORDER_WHITE_MIN = 0.9;         // at least 90 % of the outer ring is near white
export const FILL_MIN = 0.55;                // longest side of the product, as a share of the square
export const AREA_MIN = 0.05;                // and its bounding box covers at least this share of the square
export const SKU_RE = /AK-\d{4}/i;

export const skuFromName = (name) => { const m = SKU_RE.exec(String(name ?? "")); return m ? m[0].toUpperCase() : null; };
export const isPicture = (name) => /\.(jpe?g|png|webp)$/i.test(name) && !name.startsWith(".") && !name.startsWith("._");

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
const key = (h) => String(h).replace(/^﻿/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

/**
 * The fetch report, whatever its version: rows with sku, item, filename, status, image_url, page_url, query. A column the report lacks is
 * empty. Version 2 has SKU, Item, Brand, Barcode, Filename, Status, Image URL, Page URL, Query; a later one may call the first column
 * "product" (a code or a name): a code is taken as the sku.
 */
export function parseReport(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = csvLine(lines[0]).map(key);
  const at = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const ix = { sku: at("sku", "code", "product_code"), product: at("product", "item", "name"), file: at("filename", "file", "file_name"),
    status: at("status"), image: at("image_url", "imageurl", "image"), page: at("page_url", "pageurl", "page"), query: at("query") };
  return lines.slice(1).map((l, n) => {
    const c = csvLine(l).map((x) => x.trim());
    const g = (i) => (i >= 0 ? c[i] ?? "" : "");
    const product = g(ix.product);
    const sku = skuFromName(g(ix.sku)) ?? (ix.sku < 0 ? skuFromName(product) : null);
    return { row: n + 2, sku, product, filename: g(ix.file), status: g(ix.status), imageUrl: g(ix.image), pageUrl: g(ix.page), query: g(ix.query) };
  });
}

/**
 * files: [{ name, folder }] (folder "product_images" or "product_images_review"); report: parseReport rows; skus: Set of the catalogue's codes.
 * Returns { matched: [{ sku, file, folder, by, row }], unmatched: [{ file, folder, reason }] }.
 */
export function matchFiles(files, report, skus) {
  const byFile = new Map(); for (const r of report) if (r.filename) byFile.set(r.filename.toLowerCase(), r);
  const matched = []; const unmatched = [];
  for (const f of files) {
    const code = skuFromName(f.name); const row = byFile.get(f.name.toLowerCase()) ?? null;
    if (code) {
      if (!skus.has(code)) { unmatched.push({ file: f.name, folder: f.folder, reason: `code ${code} is not in the catalogue` }); continue; }
      if (row?.sku && row.sku !== code) { unmatched.push({ file: f.name, folder: f.folder, reason: `the name says ${code} but the report says ${row.sku}` }); continue; }
      matched.push({ sku: code, file: f.name, folder: f.folder, by: "code", row }); continue;
    }
    if (row?.sku) {
      if (!skus.has(row.sku)) { unmatched.push({ file: f.name, folder: f.folder, reason: `the report's code ${row.sku} is not in the catalogue` }); continue; }
      matched.push({ sku: row.sku, file: f.name, folder: f.folder, by: "report", row }); continue;
    }
    unmatched.push({ file: f.name, folder: f.folder, reason: row ? "no product code in the name or in the report's row" : "no product code in the name and no row in the report" });
  }
  // Two files for one product: neither is chosen for it.
  const seen = new Map(); for (const m of matched) seen.set(m.sku, [...(seen.get(m.sku) ?? []), m]);
  const clean = [];
  for (const m of matched) {
    const all = seen.get(m.sku);
    if (all.length > 1) unmatched.push({ file: m.file, folder: m.folder, reason: `${all.length} files for ${m.sku}: ${all.map((x) => x.file).join(", ")}` });
    else clean.push(m);
  }
  return { matched: clean, unmatched };
}

/** The picture as it will be stored: rotated by its EXIF turn, fitted inside 1000 x 1000, white padding. Raw RGB for the measures. */
async function normalised(buf, sharp) {
  return sharp(buf, { limitInputPixels: 100_000_000, failOn: "error" }).rotate().flatten({ background: "#ffffff" })
    .resize(SIDE, SIDE, { fit: "contain", background: "#ffffff", kernel: "lanczos3" }).removeAlpha().toColourspace("srgb");
}

/** What the file is and how it measures. Throws for a file that does not open; never keeps anything of it. */
export async function analyse(buf, sharp) {
  const m = await sharp(buf, { limitInputPixels: 100_000_000, failOn: "error" }).metadata();
  if (!m.width || !m.height) throw new Error("not_an_image");
  if (!["jpeg", "png", "webp"].includes(m.format)) throw new Error(`format_${m.format}`);
  const turned = (m.orientation ?? 1) >= 5;
  const width = turned ? m.height : m.width; const height = turned ? m.width : m.height;
  // Background: the outer ring of the picture itself (before any padding), read at 200 px.
  const N = 200; const ring = 4;
  const small = (await sharp(buf, { limitInputPixels: 100_000_000, failOn: "error" }).rotate().flatten({ background: "#ffffff" }).resize(N, N, { fit: "fill" }).removeAlpha().raw().toBuffer());
  let ringN = 0, ringWhite = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (x >= ring && y >= ring && x < N - ring && y < N - ring) continue;
    const i = (y * N + x) * 3; ringN++;
    if (small[i] >= WHITE && small[i + 1] >= WHITE && small[i + 2] >= WHITE) ringWhite++;
  }
  // Fill: the stored square, at 200 px; the product is whatever is not near white.
  const sq = await (await normalised(buf, sharp)).resize(N, N, { fit: "fill" }).raw().toBuffer();
  let x0 = N, x1 = -1, y0 = N, y1 = -1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 3;
    if (sq[i] < 238 || sq[i + 1] < 238 || sq[i + 2] < 238) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const bw = x1 >= 0 ? x1 - x0 + 1 : 0; const bh = y1 >= 0 ? y1 - y0 + 1 : 0;
  return { width, height, format: m.format, borderWhite: ringWhite / ringN, fill: Math.max(bw, bh) / N, area: (bw * bh) / (N * N) };
}

/** The reasons a picture goes to review; empty = it passed. Duplicates and weight are added by their own steps. */
export function checkAnalysis(a) {
  const why = [];
  if (Math.min(a.width, a.height) < MIN_SIDE) why.push(`small:${a.width}x${a.height} (at least ${MIN_SIDE} px)`);
  if (a.borderWhite < BORDER_WHITE_MIN) why.push(`background:not near-white (${Math.round(a.borderWhite * 100)}% of the edge)`);
  if (a.fill < FILL_MIN || a.area < AREA_MIN) why.push(`fill:the product does not fill the square (${Math.round(a.fill * 100)}% across, ${Math.round(a.area * 100)}% of the area)`);
  return why;
}

/** 1000 x 1000 WebP under 80 KB at the highest of QUALITIES that fits; metadata stripped. `heavy` is true when even the lowest is over. */
export async function toWebp(buf, sharp) {
  let out = null; let quality = QUALITIES[0];
  for (const q of QUALITIES) {
    const r = await (await normalised(buf, sharp)).webp({ quality: q, effort: 5, smartSubsample: true }).toBuffer({ resolveWithObject: true });
    out = r; quality = q;
    if (r.data.length <= MAX_BYTES) break;
  }
  return { data: out.data, width: out.info.width, height: out.info.height, bytes: out.data.length, quality, heavy: out.data.length > MAX_BYTES,
           sha256: createHash("sha256").update(out.data).digest("hex") };
}

/** A 64-bit difference hash (9 x 8 grey): the second, structural look at the same question as the colour thumbnail. */
export async function dhash64(buf, sharp) {
  const { data } = await sharp(buf, { limitInputPixels: 100_000_000, failOn: "error" }).rotate().flatten({ background: "#ffffff" })
    .resize(9, 8, { fit: "fill", kernel: "lanczos3" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? "1" : "0";
  return bits;
}
export const bitsApart = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };

/**
 * Near-duplicates: two pictures are the same when their 16 x 16 colour thumbnails differ by at most NEAR (the project's rule, lib/dedupe.mjs), or
 * their structure hashes differ in at most 3 of 64 bits while the thumbnails are within 8. Compared across every product in the batch and
 * against `held` (pictures already proposed or approved for other items: a registry from lib/dedupe.mjs). Both of a pair are named.
 * items: [{ sku, hash, bits }] -> Map(sku -> ["duplicate:AK-0002 (distance 1.2)"]).
 */
export function findDuplicates(items, held = null) {
  const out = new Map(); const add = (sku, msg) => out.set(sku, [...(out.get(sku) ?? []), msg]);
  const same = (a, b) => { const d = hamming(a.hash, b.hash); return d <= NEAR || (a.bits && b.bits && bitsApart(a.bits, b.bits) <= 3 && d <= 8) ? d : null; };
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const d = same(items[i], items[j]);
    if (d !== null) { const r = Math.round(d * 100) / 100; add(items[i].sku, `duplicate:${items[j].sku} (distance ${r})`); add(items[j].sku, `duplicate:${items[i].sku} (distance ${r})`); }
  }
  if (held) for (const it of items) {
    const near = held.near(it.hash, it.sku);
    if (near) add(it.sku, `duplicate:${near.sku} (already in the queue, distance ${near.distance})`);
  }
  return out;
}

export { dhash };
