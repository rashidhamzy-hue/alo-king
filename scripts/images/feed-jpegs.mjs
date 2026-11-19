// WEB4b (0252): the JPEG copy of each public product picture for the WhatsApp catalogue's feed. Meta documents JPEG and PNG for a
// catalogue picture; the founder's pictures are 1000 px WebP (PIX4). This makes, once per picture, a 1000 x 1000 JPEG on white, under
// 150 KB, in the public `catalog` bucket at the path the database names, and records it (catalog_feed_jpeg_made); the feed then links it.
// It also removes the JPEG of a picture that stopped being public (the gateway does the same every minute).
//
// What is made comes only from the database's work list (catalog_feed_jpeg_work: approved, a licence a customer may see, an active
// item), never from the bucket: a proposed, rejected or withdrawn picture is never made, and nothing else in `media` is read.
// No model, no cost. Run by the catalog-jpegs workflow (hourly, and by hand); locally: SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/images/feed-jpegs.mjs
import { appendFileSync } from "node:fs";
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
  const report = await store.rpc("catalog_public_report");
  console.log(JSON.stringify({ ...r, report }, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`### Feed JPEGs`,
    `- made ${r.made}, removed ${r.removed}, failed ${r.failed}`, ...r.errors.map((e) => `  - ${e}`),
    `- public pictures ${report.expected}; feed JPEGs ${report.feed_jpegs}; still to make ${report.feed_jpegs_to_make}`, ""].join("\n"));
  if (r.failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });
