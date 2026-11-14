// Session P2: the picture part of the research loader (scripts/product-data/load-research.mjs).
// A research file names up to five candidate pictures for one catalog item, best first, each with the page it is on.
// Each is downloaded and put through P1's own check (fetch-images.mjs `evaluate`: at least 800 px wide, then the fast model's
// report, decided by lib/vision.mjs: exact brand, product and size, one pack, plain background, no watermark, shop logo,
// price or added text; "cannot tell" is a no). The first that passes is shrunk, saved in the private `media` bucket and
// PROPOSED with source kind and licence `public_page` (migration 0070), with the picture's address and its page.
// Nothing here approves a picture: a person does that on the console's picture page.
import { evaluate, Fatal } from "./fetch-images.mjs";

export { Fatal };

/**
 * One item's candidates. d = { download, sharp, check, store, runId, model, measure?, shrink? } (all injectable).
 * meta = { sourceFile, fileSha, match }. Returns { outcome, detail } where outcome is
 *   proposed | none_passed | no_candidates | skipped_rejected | error
 * `error` means at least one picture could not be fetched or checked and none passed: the item is tried again next run.
 */
export async function proposeFromResearch(item, candidates, d, meta = {}) {
  if (!candidates.length) return { outcome: "no_candidates", detail: {} };
  const tried = []; let rejectedBefore = 0;
  for (const c of candidates) {
    const e = await evaluate(item, c, d);                     // throws Fatal when the model key is refused
    const row = { image_url: c.imageUrl, page_url: c.pageUrl, site: c.site, site_kind: c.siteKind, kept: e.kept, reasons: e.reasons, width: e.width ?? null };
    tried.push(row);
    if (!e.kept) continue;
    const path = `product_images/${item.sku}/${e.small.sha256.slice(0, 16)}.jpg`;
    await d.store.upload(path, e.small.data);
    const res = await d.store.rpc("propose_product_image", {
      p_product: item.product_id, p_source_kind: "public_page", p_source_url: c.imageUrl, p_page_url: c.pageUrl, p_attribution: null,
      p_media_path: path, p_sha256: e.small.sha256, p_width: e.small.width, p_height: e.small.height, p_bytes: e.small.bytes,
      p_vision: { run_id: d.runId, model: d.model, report: e.report, original_width: e.orig_width, original_height: e.orig_height, checked_at: new Date().toISOString(),
        site: c.site, site_kind: c.siteKind, source_file: meta.sourceFile ?? null, file_sha: meta.fileSha ?? null, matched: meta.match ?? null, candidates: tried.map((t) => ({ ...t })) },
      p_replace: true });
    row.propose = res;
    if (res?.ok) return { outcome: "proposed", detail: { image_id: res.image_id, licence: res.licence, image_url: c.imageUrl, page_url: c.pageUrl, tried } };
    if (res?.skipped === "rejected_before") { rejectedBefore++; continue; }   // a person turned this very picture down: try the next
    return { outcome: "error", detail: { error: `propose_${res?.skipped ?? "failed"}`, tried } };
  }
  if (rejectedBefore) return { outcome: "skipped_rejected", detail: { tried } };
  const failed = tried.some((t) => (t.reasons ?? []).some((r) => r.startsWith("error:")));
  return { outcome: failed ? "error" : "none_passed", detail: { tried } };
}
