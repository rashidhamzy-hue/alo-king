// WEB4b (0252): the JPEG copy of each public product picture for the WhatsApp catalogue's feed. Meta documents JPEG and PNG for a
// catalogue picture; the founder's pictures are 1000 px WebP (PIX4). This makes, once per picture, a 1000 x 1000 JPEG on white, under
// 150 KB, in the public `catalog` bucket at the path the database names, and records it (catalog_feed_jpeg_made); the feed then links it.
// It also removes the JPEG of a picture that stopped being public (the gateway does the same every minute).
//
// What is made comes only from the database's work list (catalog_feed_jpeg_work: approved, a licence a customer may see, an active
// item), never from the bucket: a proposed, rejected or withdrawn picture is never made, and nothing else in `media` is read.
// No model, no cost. Run by the catalog-jpegs workflow (hourly, and by hand); locally: SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/images/feed-jpegs.mjs
//
// PERF1 (0267): the same pass also makes the website's two small copies of each public picture (catalog_variant_work): a 400 px WebP
// (target 15 KB, never over 25 KB) and an 800 px WebP (target 50 KB, never over 80 KB), metadata stripped, named by their content
// (<sku>-<image id>-w<width>-<12 hex of sha256>.webp), and removes the copies of a picture that stopped being public. Every object this
// job puts in the public bucket is uploaded "public, max-age=31536000, immutable" (lib/store.mjs). REHEADER=1 re-uploads, once, every
// original copy and feed JPEG already in the bucket with that header (same bytes, same name).
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadSharp } from "./lib/image.mjs";
import { makeStore } from "./lib/store.mjs";

export const SIDE = 1000;
export const MAX_BYTES = 150_000;   // decimal, so "under 150 KB" holds in either unit

/** The feed's JPEG: 1000 x 1000, the picture whole inside it on white (never cropped), quality stepping down until it is under 150 KB.
 *  A product photo on white is far under it at the first step; a picture full of fine grain (the worst case) is softened a little last. */
export async function toFeedJpeg(buf, sharp) {
  const steps = [...[86, 80, 74, 68, 62, 56, 50, 44, 38, 32, 26].map((q) => [q, 0]), ...[60, 45, 30].map((q) => [q, 1.2])];
  for (const [quality, blur] of steps) {
    let img = sharp(buf, { limitInputPixels: 100_000_000, failOn: "error" })
      .rotate().resize({ width: SIDE, height: SIDE, fit: "contain", background: "#ffffff", kernel: "lanczos3" }).flatten({ background: "#ffffff" });
    if (blur) img = img.blur(blur);
    const out = await img.jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" }).toBuffer({ resolveWithObject: true });
    if (out.data.length <= MAX_BYTES) return { data: out.data, width: out.info.width, height: out.info.height, bytes: out.data.length, quality };
  }
  throw new Error("cannot_get_under_150kb");
}

/** PERF1: a variant's size targets (bytes, decimal). Quality steps down until the target; a picture that cannot reach it is kept at the
 *  first step under the cap; one over the cap even at the last step is refused (the page then keeps the original). */
export const VARIANTS = { 400: { target: 15_000, cap: 25_000 }, 800: { target: 50_000, cap: 80_000 } };
const VARIANT_QUALITY = [80, 74, 68, 62, 56, 50, 44];

/** One small copy: width x width on white, the picture whole inside it, WebP with no metadata. */
export async function toVariant(buf, sharp, width) {
  const t = VARIANTS[width];
  if (!t) throw new Error(`variant_width_${width}`);
  let fallback = null;
  for (const quality of VARIANT_QUALITY) {
    const out = await sharp(buf, { limitInputPixels: 100_000_000, failOn: "error" })
      .rotate().resize({ width, height: width, fit: "contain", background: "#ffffff", kernel: "lanczos3" }).flatten({ background: "#ffffff" })
      .webp({ quality, effort: 6, smartSubsample: true }).toBuffer({ resolveWithObject: true });
    const r = { data: out.data, width: out.info.width, height: out.info.height, bytes: out.data.length, quality };
    if (r.bytes <= t.target) return r;
    if (!fallback && r.bytes <= t.cap) fallback = r;
  }
  if (fallback) return fallback;
  throw new Error(`cannot_get_${width}_under_${t.cap}`);
}

/** The variant's public name: its picture's prefix (<sku>-<image id>), its width and the first 12 hex of its sha256. */
export const variantPath = (prefix, width, data) => `${prefix}-w${width}-${createHash("sha256").update(data).digest("hex").slice(0, 12)}.webp`;

/**
 * PERF1: the variants' pass. d = { store, variant: (buf, width) => { data, bytes }, limit? }. Removes first, then makes.
 */
export async function runVariants(d) {
  const r = { made: 0, removed: 0, failed: 0, errors: [] };
  const fail = (what, e) => { r.failed++; r.errors.push(`${what}: ${String(e?.message ?? e).slice(0, 120)}`); };
  const work = await d.store.rpc("catalog_variant_work");
  for (const j of work.remove ?? []) {
    try { await d.store.removePublic([j.public_path]); await d.store.rpc("catalog_variant_removed", { p_path: j.public_path }); r.removed++; } catch (e) { fail(`remove ${j.public_path}`, e); }
  }
  for (const j of (work.make ?? []).slice(0, d.limit ?? Infinity)) {
    let src;
    try { src = await d.store.download(j.media_path); } catch (e) { fail(`download ${j.prefix}`, e); continue; }
    for (const width of j.widths ?? []) {
      try {
        const v = await d.variant(src, width);
        if (!(v.bytes > 0 && v.bytes <= VARIANTS[width].cap)) throw new Error(`too big: ${v.bytes}`);
        const path = variantPath(j.prefix, width, v.data);
        await d.store.uploadPublic(path, v.data, "image/webp");
        await d.store.rpc("catalog_variant_made", { p_image: j.image_id, p_width: width, p_path: path, p_bytes: v.bytes });
        r.made++;
      } catch (e) { fail(`make ${j.prefix} ${width}`, e); }
    }
  }
  return r;
}

/** PERF1: every original copy and feed JPEG the books know, uploaded again with the long-lived header (same name, same bytes). */
export async function reheader(d) {
  const r = { done: 0, failed: 0, errors: [] };
  const known = await d.store.rpc("catalog_known_objects");
  for (const o of known ?? []) {
    try {
      const data = o.media_path ? await d.store.download(o.media_path) : await d.store.downloadPublic(o.public_path);
      await d.store.uploadPublic(o.public_path, data, o.public_path.endsWith(".jpg") ? "image/jpeg" : "image/webp");
      r.done++;
    } catch (e) { r.failed++; r.errors.push(`${o.public_path}: ${String(e?.message ?? e).slice(0, 120)}`); }
  }
  return r;
}

/**
 * One pass. d = { store: { rpc, download, uploadPublic, removePublic }, convert: (buf) => { data, bytes }, limit? }.
 * Removes first (privacy before convenience), then makes. Each job on its own: one failure does not stop the others.
 */
export async function run(d) {
  const r = { made: 0, removed: 0, failed: 0, errors: [] };
  const fail = (what, e) => { r.failed++; r.errors.push(`${what}: ${String(e?.message ?? e).slice(0, 120)}`); };
  const work = await d.store.rpc("catalog_feed_jpeg_work");
  for (const j of work.remove ?? []) {
    try { await d.store.removePublic([j.public_path]); await d.store.rpc("catalog_feed_jpeg_removed", { p_image: j.image_id }); r.removed++; } catch (e) { fail(`remove ${j.public_path}`, e); }
  }
  for (const j of (work.make ?? []).slice(0, d.limit ?? Infinity)) {
    try {
      const jpeg = await d.convert(await d.store.download(j.media_path));
      if (!(jpeg.bytes > 0 && jpeg.bytes <= MAX_BYTES)) throw new Error(`too big: ${jpeg.bytes}`);
      await d.store.uploadPublic(j.public_path, jpeg.data, "image/jpeg");
      await d.store.rpc("catalog_feed_jpeg_made", { p_image: j.image_id, p_bytes: jpeg.bytes });
      r.made++;
    } catch (e) { fail(`make ${j.public_path}`, e); }
  }
  return r;
}

async function main() {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY are needed"); process.exit(2); }
  const sharp = await loadSharp();
  if (!sharp) { console.error("sharp is not installed (npm ci in scripts/images)"); process.exit(2); }
  const store = makeStore({ url, key });
  const limit = Number(process.env.LIMIT) > 0 ? Number(process.env.LIMIT) : undefined;
  const r = await run({ store, convert: (buf) => toFeedJpeg(buf, sharp), limit });
  const v = await runVariants({ store, variant: (buf, w) => toVariant(buf, sharp, w), limit });
  const h = process.env.REHEADER === "1" ? await reheader({ store }) : null;
  const report = await store.rpc("catalog_public_report");
  console.log(JSON.stringify({ ...r, variants: v, reheader: h, report }, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`### Feed JPEGs`,
    `- made ${r.made}, removed ${r.removed}, failed ${r.failed}`, ...r.errors.map((e) => `  - ${e}`),
    `- public pictures ${report.expected}; feed JPEGs ${report.feed_jpegs}; still to make ${report.feed_jpegs_to_make}`,
    `### Website copies (400 and 800 px WebP)`,
    `- made ${v.made}, removed ${v.removed}, failed ${v.failed}`, ...v.errors.map((e) => `  - ${e}`),
    `- variants ${report.variants}; still to make ${report.variants_to_make}`,
    ...(h ? [`### Long-lived cache header`, `- re-uploaded ${h.done}, failed ${h.failed}`, ...h.errors.map((e) => `  - ${e}`)] : []), ""].join("\n"));
  if (r.failed || v.failed || h?.failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });
