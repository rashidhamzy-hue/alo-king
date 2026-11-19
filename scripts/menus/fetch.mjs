// MENU2 (19 November 2026): the fetch step of the menu-read workflow, before the reading. For each menu source waiting (0259's menu_fetch_queue):
//   link          the page and its sections, with a headless browser (crawl.mjs: robots.txt, same site, tabs, one fetch per page, no sign-in);
//                 each page's text is kept and its screenshot stored privately (media bucket, menus/<place>/pages/<day>/<hash>.jpg)
//   docx, sheet   the stored file is downloaded from the private bucket and its text taken out (extract.mjs)
// Pasted text and PDFs need no fetch (0259 makes their page at once). What was fetched goes to record_menu_source_pages; a failure is
// recorded with its reason (the third failure marks the source failed, and the Menus page says so). Nothing is printed of a page's text.
// Everything outside is injected (rpc, download, upload, crawl), so test/db/menu2-sources.test.ts runs it with no network.
import { createHash } from "node:crypto";
import { filePages } from "./extract.mjs";

/**
 * deps: { rpc(fn, args), download(path) -> {bytes}, upload(path, bytes, contentType), crawl(url) -> {pages: [{position, url, title, body, shot, skip_reason}], opened, refused},
 *         log(s), day? }
 */
export async function runMenuFetch(d) {
  const log = d.log ?? (() => {});
  const reader = await d.rpc("menu_reader_party", {});
  const queue = (await d.rpc("menu_fetch_queue", { p_limit: 50 })) ?? [];
  const day = d.day ?? new Date().toISOString().slice(0, 10);
  const done = []; const failed = [];
  for (const s of queue) {
    let pages; let note = null;
    try {
      if (s.kind === "link") {
        const r = await d.crawl(s.url);
        pages = [];
        for (const p of r.pages) {
          let shot_path = null;
          if (p.shot && p.shot.byteLength) {
            shot_path = `menus/${s.source_id}/pages/${day}/${createHash("sha256").update(p.shot).digest("hex").slice(0, 32)}.jpg`;
            await d.upload(shot_path, p.shot, "image/jpeg");
          }
          pages.push({ position: p.position, url: p.url, title: p.title, body: p.body, shot_path, skip_reason: p.skip_reason });
        }
        note = { opened: r.opened.length, refused: r.refused };
      } else {
        const f = await d.download(s.media_path);
        pages = filePages(s.kind, s.file_name ?? s.media_path, f.bytes);
        if (!pages.length || pages.every((p) => !p.body.trim())) throw new Error("empty: no text in the file");
      }
    } catch (e) {
      const reason = String(e?.message ?? e).slice(0, 200);
      await d.rpc("record_menu_source_pages", { p_menu_source: s.menu_source_id, p_pages: null, p_by: reader, p_reason: reason });
      failed.push({ menu_source_id: s.menu_source_id, place: s.place, kind: s.kind, reason });
      log(`[menu-fetch] ${s.place}: ${s.kind} failed (${reason})`);
      continue;
    }
    const r = await d.rpc("record_menu_source_pages", { p_menu_source: s.menu_source_id, p_pages: pages, p_by: reader });
    done.push({ menu_source_id: s.menu_source_id, place: s.place, kind: s.kind, pages: r.pages ?? pages.length, skipped: r.skipped ?? 0, ...(note ?? {}) });
    log(`[menu-fetch] ${s.place}: ${s.kind}, ${pages.length} page(s)`);
  }
  const lines = [];
  if (queue.length) {
    lines.push(`Menu sources fetched: ${done.length} of ${queue.length}.`);
    for (const x of done) lines.push(`- ${x.place}: ${x.kind}, ${x.pages} page(s) kept${x.skipped ? `, ${x.skipped} with nothing to read` : ""}${x.opened ? `; ${x.opened} page(s) opened once each` : ""}${x.refused?.length ? `; not opened: ${x.refused.map((r) => r.reason).join(", ")}` : ""}`);
    for (const x of failed) lines.push(`- **${x.place}: ${x.kind} failed** (${x.reason}); it is tried again by the next run (three tries).`);
  }
  return { queued: queue.length, done, failed, summary: lines.join("\n") };
}
