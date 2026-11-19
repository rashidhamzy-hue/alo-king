// FD1 (18 November 2026), MENU2 (19 November 2026): the menu reading run. Everything waiting to be read for a place's menu is read by
// MODEL_FAST through the Anthropic Message Batches API, at half the usual price, one request per item:
//   a photo            (0246's menu_photos, taken on the Menus page): the image
//   a source page      (0259's menu_source_pages): a web page's text (its screenshot only when the page has no text), a PDF (the document
//                      itself), pasted text, a Word file's text, a sheet's rows
// Each reading goes in through record_menu_reading (photos) or record_menu_page_reading (pages) as PROPOSALS: section, names in Arabic and
// English, the description as printed, the price as printed with its currency, sizes, options, add-ons, and the reader's flags. A person
// approves every dish on the Menus page. A model approves nothing (invariant 3) and no food fact is read from a menu (invariant 15).
// Money: one cap for the run (at most USD 2): every item's worst case is estimated first, and no more are sent than the cap allows (the
// rest are read by the next run); every result's tokens are priced at half the list price and recorded in model_costs (COST1). Nothing
// about a photo, a page or a reading is logged. A dry run reads the photos it is given and writes nothing to the database but the cost.
// Everything outside the run is injected (rpc, download, fetch, prices), so the tests need no key and no network.
import { CostMeter, costOfCall, priceFor, usageOf } from "../lib/model-cost.mjs";
// Node 22.18 and later runs TypeScript with erasable types: the reader's form and prompt are the console's own (one copy).
import { MenuReading, menuPrompt, menuTool } from "../../apps/console/src/menu-read.ts";
import { pdfPages } from "./extract.mjs";

export const MAX_CAP_USD = 2;
export const API = "https://api.anthropic.com";
const HALF = 0.5;                                  // the Batch API's price against the same call made one at a time
const PER_IMAGE_TOKENS = 2600, FIXED_TOKENS = 2500, MAX_OUT = 8000;
const PDF_PAGE_TOKENS = 3200, PDF_MAX_OUT = 16000, MAX_PDF_PAGES = 30;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024, MAX_PDF_BYTES = 20 * 1024 * 1024;

/** The most one photo can cost: the photo at its largest, the prompt and tool, and the whole output allowance, at half price. */
export function estimatePhotoUsd(price) {
  return (((PER_IMAGE_TOKENS + FIXED_TOKENS) * price.input_usd_per_mtok + MAX_OUT * price.output_usd_per_mtok) / 1e6) * HALF;
}
/** The most a text page can cost: about one token for every two characters (Arabic is dearer than English), the prompt, the output. */
export function estimateTextUsd(price, chars) {
  return (((Math.ceil(chars / 2) + 400 + FIXED_TOKENS) * price.input_usd_per_mtok + MAX_OUT * price.output_usd_per_mtok) / 1e6) * HALF;
}
/** The most a PDF can cost: each page read as text and image, the prompt, the larger output allowance. */
export function estimatePdfUsd(price, pages) {
  return (((pages * PDF_PAGE_TOKENS + FIXED_TOKENS) * price.input_usd_per_mtok + PDF_MAX_OUT * price.output_usd_per_mtok) / 1e6) * HALF;
}
const mimeOf = (p) => (/\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : /\.pdf$/i.test(p) ? "application/pdf" : "image/jpeg");
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const count = (xs, f) => xs.reduce((n, x) => n + (f(x) ? 1 : 0), 0);
const KIND_WORDS = { link: "a section of the place's menu web page (its visible text)", text: "menu text pasted by staff", docx: "the text of a Word file of the menu",
  sheet: "the rows of a spreadsheet of the menu (cells separated by |)", pdf: "a PDF of the menu" };

async function pool(items, size, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/** The dishes of a reading, counted. */
export const dishCount = (r) => (r?.sections ?? []).reduce((n, s) => n + (s.dishes ?? []).length, 0);
/** The Batch API's id for a page (letters, digits, _ and -, at most 64). A photo keeps its own id (FD1). */
export const pageCustomId = (pageId) => `pg_${pageId}`;

/** The user turn of one request: the image, the PDF, or the text. */
export function requestContent(item) {
  if (item.kind === "photo") return [{ type: "image", source: { type: "base64", media_type: item.mime, data: b64(item.bytes) } }, { type: "text", text: "Read this menu photo." }];
  if (item.doc) return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(item.doc) } },
    { type: "text", text: "Read this menu PDF. Give each dish's page number in 'page'." }];
  if (item.shot && !item.body) return [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64(item.shot) } },
    { type: "text", text: `Read this screenshot of ${KIND_WORDS[item.sourceKind] ?? "a menu"}${item.title ? ` (${item.title})` : ""}.` }];
  return [{ type: "text", text: `Read this menu source: ${KIND_WORDS[item.sourceKind] ?? "menu text"}${item.title ? `, titled "${item.title}"` : ""}. ` +
    "Copy each dish's line(s) into source_text.\n\n<source>\n" + item.body + "\n</source>" }];
}

/**
 * deps: { rpc(fn, args), download(path) -> {bytes, mime}, fetch, prices, model, apiKey, capUsd, runId, sleep(ms), log(s),
 *         limit?, resumeBatchIds?, dryRunPhotos?: [{photo_id, place, media_path, bytes, mime}], pollMs?, maxWaitMs?, concurrency? }
 */
export async function runMenuRead(d) {
  const log = d.log ?? (() => {});
  if (!(d.capUsd > 0)) throw new Error("a run needs a dollar cap above zero (capUsd)");
  if (d.capUsd > MAX_CAP_USD) throw new Error(`the cap is at most USD ${MAX_CAP_USD} for this run; got ${d.capUsd}`);
  const day = new Date().toISOString().slice(0, 10);
  const price = priceFor(d.prices, d.model, day);
  if (!price) throw new Error(`NO_PRICE: model_prices has no row for ${d.model}; the run does not spend without a price`);
  const dry = Array.isArray(d.dryRunPhotos);
  const meter = new CostMeter({ workflow: "menu-read", runId: d.runId, capUsd: d.capUsd, prices: d.prices, enforce: false, step: dry ? "dry_run" : "batch_read", log });
  const sleep = d.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const headers = { "x-api-key": d.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  const reader = dry ? null : await d.rpc("menu_reader_party", {});

  const photoQueue = dry ? d.dryRunPhotos : ((await d.rpc("menu_reading_queue", { p_limit: d.limit ?? 200 })) ?? []);
  const pageQueue = dry ? [] : ((await d.rpc("menu_page_queue", { p_limit: d.limit ?? 200 })) ?? []);
  const items = [
    ...photoQueue.map((x) => ({ kind: "photo", custom: String(x.photo_id), photo_id: x.photo_id, place: x.place, media_path: x.media_path, bytes: x.bytes, mime: x.mime })),
    ...pageQueue.map((x) => ({ kind: "page", custom: pageCustomId(x.page_id), page_id: x.page_id, place: x.place, sourceKind: x.kind, title: x.title,
                               body: x.body, shot_path: x.shot_path, doc_path: x.doc_path })),
  ];
  const byCustom = new Map(items.map((x) => [x.custom, x]));
  const skipped = []; const failed = []; const readings = []; const batchIds = [...(d.resumeBatchIds ?? [])];
  const skip = (x, reason) => skipped.push(x.kind === "photo" ? { photo_id: x.photo_id, reason } : { page_id: x.page_id, reason });
  let selected = [];

  // ---------- 1 fetch what each item needs, estimate its worst case, choose within the cap ----------
  if (!batchIds.length) {
    const fetched = await pool(items, d.concurrency ?? 6, async (x) => {
      try {
        if (x.kind === "photo") {
          const f = x.bytes ? { bytes: x.bytes, mime: x.mime } : await d.download(x.media_path);
          if (f.bytes.byteLength > MAX_IMAGE_BYTES) return { x, error: "photo_too_large" };
          return { x: { ...x, bytes: f.bytes, mime: f.mime || mimeOf(x.media_path ?? "") } };
        }
        if (x.doc_path) {
          const f = await d.download(x.doc_path);
          if (f.bytes.byteLength > MAX_PDF_BYTES) return { x, error: "pdf_too_large" };
          const n = pdfPages(f.bytes);
          if (n > MAX_PDF_PAGES) return { x, error: "pdf_too_many_pages" };
          return { x: { ...x, doc: f.bytes, pdfPages: Math.max(n, 1) } };
        }
        if (!x.body && x.shot_path) {
          const f = await d.download(x.shot_path);
          if (f.bytes.byteLength > MAX_IMAGE_BYTES) return { x, error: "photo_too_large" };
          return { x: { ...x, shot: f.bytes } };
        }
        return { x };
      } catch { return { x, error: x.kind === "photo" ? "photo_unavailable" : "file_unavailable" }; }
    });
    let worst = 0;
    for (const f of fetched) {
      if (f.error) { skip(f.x, f.error); continue; }
      const x = f.x;
      const e = x.kind === "photo" || x.shot ? estimatePhotoUsd(price) : x.doc ? estimatePdfUsd(price, x.pdfPages) : estimateTextUsd(price, (x.body ?? "").length);
      if (worst + e > d.capUsd) { skip(x, "cap"); meter.stoppedAtCap = true; continue; }
      worst += e; selected.push(x);
    }
    // ---------- 2 one batch (well under the API's size limit; 150 MB is checked anyway) ----------
    const tool = menuTool(); const system = menuPrompt();
    // The Batch API takes ids of letters, digits, _ and - only (64 at most): a photo id is a uuid; a dry run's is the file's name.
    for (const x of selected) if (!/^[A-Za-z0-9_-]{1,64}$/.test(x.custom)) throw new Error(`a photo id the Batch API refuses: ${x.custom.slice(0, 40)}`);
    const requests = selected.map((x) => ({ custom_id: x.custom, params: { model: d.model, max_tokens: x.doc ? PDF_MAX_OUT : MAX_OUT, system, tools: [tool],
      tool_choice: { type: "tool", name: tool.name }, messages: [{ role: "user", content: requestContent(x) }] } }));
    const max = d.maxBatchBytes ?? 150_000_000;
    const chunks = []; let cur = [], size = 0;
    for (const rq of requests) { const n = JSON.stringify(rq).length; if (cur.length && size + n > max) { chunks.push(cur); cur = []; size = 0; } cur.push(rq); size += n; }
    if (cur.length) chunks.push(cur);
    for (const c of chunks) {
      const res = await d.fetch(`${API}/v1/messages/batches`, { method: "POST", headers, body: JSON.stringify({ requests: c }) });
      if (!res.ok) throw new Error(`the Batch API refused a batch: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const b = await res.json(); batchIds.push(b.id); log(`[menu-read] batch ${b.id}: ${c.length} item(s)`);
    }
  }

  // ---------- 3 wait for the batches, read the results ----------
  const unfinished = [];
  let read = 0, pagesRead = 0, dishes = 0, usd = 0;
  for (const id of batchIds) {
    let info = null;
    for (let i = 0, max = Math.ceil((d.maxWaitMs ?? 6 * 3600_000) / (d.pollMs ?? 30_000)); i <= max; i++) {
      const r = await d.fetch(`${API}/v1/messages/batches/${id}`, { headers });
      if (!r.ok) throw new Error(`the Batch API could not report batch ${id}: ${r.status}`);
      info = await r.json();
      if (info.processing_status === "ended") break;
      await sleep(d.pollMs ?? 30_000);
    }
    if (info?.processing_status !== "ended") { unfinished.push(id); continue; }
    const res = await d.fetch(info.results_url ?? `${API}/v1/messages/batches/${id}/results`, { headers });
    if (!res.ok) throw new Error(`the results of batch ${id} could not be fetched: ${res.status}`);
    for (const line of (await res.text()).split("\n").filter(Boolean)) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      const x = byCustom.get(row.custom_id);
      if (!x) continue;                                                    // read already, or no longer waiting
      const result = row.result ?? {};
      if (result.type === "succeeded") {
        const u = usageOf(result.message?.usage);
        const cost = costOfCall(price, u) * HALF;
        meter.addLine({ model: d.model, step: dry ? "dry_run" : "batch_read", calls: 1, input_tokens: u.input, output_tokens: u.output, cache_read_tokens: u.cacheRead, cache_write_tokens: u.cacheWrite, web_searches: 0, usd: cost });
        usd += cost;
      }
      let parsed = null; let why = null;
      if (result.type !== "succeeded") why = `the batch ${result.type}`;
      else {
        const call = (result.message?.content ?? []).find((b) => b.type === "tool_use");
        const ok = MenuReading.safeParse(call?.input);
        if (ok.success) parsed = ok.data; else why = "unreadable: the model's answer did not fit the menu form";
        if (parsed && result.message?.stop_reason === "max_tokens") { parsed = null; why = "cut off: the answer was longer than the allowance; split the source"; }
      }
      const record = (reading, reason) => x.kind === "photo"
        ? d.rpc("record_menu_reading", { p_photo: x.photo_id, p_reading: reading, p_model: d.model, p_by: reader, ...(reason ? { p_reason: reason } : {}) })
        : d.rpc("record_menu_page_reading", { p_page: x.page_id, p_reading: reading, p_model: d.model, p_by: reader, ...(reason ? { p_reason: reason } : {}) });
      if (!parsed) {
        // The item stays waiting: the next run reads it again (a page is set aside after three failures); the Menus page shows the failure.
        if (!dry) await record(null, why).catch(() => undefined);
        failed.push(x.kind === "photo" ? { photo_id: x.photo_id, place: x.place, reason: why } : { page_id: x.page_id, place: x.place, title: x.title, reason: why });
        continue;
      }
      if (!dry) await record(parsed);
      readings.push(x.kind === "photo" ? { photo_id: x.photo_id, place: x.place, reading: parsed } : { page_id: x.page_id, place: x.place, title: x.title, reading: parsed });
      if (x.kind === "photo") read++; else pagesRead++;
      dishes += dishCount(parsed);
    }
  }
  if (usd > d.capUsd) meter.stoppedAtCap = true;

  // ---------- 4 the report ----------
  const lines = [`### Menu reading run ${d.runId}${dry ? " (dry run: nothing written but the cost)" : ""}`, "",
    `Photos read: ${read} of ${photoQueue.length} waiting; ${dishes} dish(es) proposed${dry ? "" : ", each waiting for a person on the Menus page"}. Batches: ${batchIds.length ? batchIds.join(", ") : "none"}. Model ${d.model}, half price. Spent USD ${usd.toFixed(4)} of a cap of USD ${d.capUsd}.`];
  if (pageQueue.length) lines.push(`Source pages read (links, PDFs, pasted text, Word and Excel files): ${pagesRead} of ${pageQueue.length} waiting.`);
  if (skipped.length) lines.push(`Left for another run: ${count(skipped, (x) => x.reason === "cap")} for the cap, ${count(skipped, (x) => /unavailable/.test(x.reason))} could not be fetched, ${count(skipped, (x) => /too_large|too_many/.test(x.reason))} too large (a photo over 5 MB, a PDF over 20 MB or ${MAX_PDF_PAGES} pages).`);
  if (meter.stoppedAtCap && skipped.some((x) => x.reason === "cap")) lines.push("**The cap was reached: what is left is read by the next run.**");
  if (failed.length) lines.push(`**${failed.length} item(s) failed and stay waiting:** ${failed.slice(0, 20).map((x) => `${x.title ?? x.place ?? x.photo_id ?? x.page_id} (${x.reason})`).join("; ")}`);
  if (unfinished.length) lines.push(`**Batch(es) still processing: ${unfinished.join(", ")}.** Run again with batch_ids set to read them; nothing is paid twice.`);
  const byPlace = {};
  for (const r of readings) byPlace[r.place ?? "?"] = (byPlace[r.place ?? "?"] ?? 0) + dishCount(r.reading);
  lines.push("", "| place | dishes proposed |", "|---|---|", ...Object.entries(byPlace).sort().map(([k, n]) => `| ${k} | ${n} |`), "");
  const summary = lines.join("\n");
  return { queued: items.length, selected: selected.length, read, pagesRead, dishes, failed, skipped, batches: batchIds, unfinished, usd, cap: d.capUsd,
    cost: meter.toRecord(), meter, summary, readings };
}
