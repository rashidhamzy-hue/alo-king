// FD1 (18 November 2026): the menu reading run. The menu photos staff took on the console's Menus page (0246's menu_photos) are read by
// MODEL_FAST through the Anthropic Message Batches API, at half the usual price, one request per photo. For each photo:
//   record_menu_reading()   the sections and dishes go in as PROPOSALS (names in Arabic and English, the price as printed with its currency,
//                           sizes, options, add-ons); a person approves each dish on the Menus page. A model approves nothing (invariant 3)
//                           and no food fact is read from a menu (invariant 15).
// Money: the run is capped (at most USD 2; the worst case of every photo sent is estimated first, and no more photos are sent than that
// allows), every result's tokens are priced at half the list price and recorded in model_costs (COST1). Nothing about a photo or a reading
// is logged. A dry run reads the photos it is given (two invented menus, test/fixtures/menus/) and writes nothing to the database but the cost.
// Everything outside the run is injected (rpc, download, fetch, prices), so test/db/menu-read-fd1.test.ts needs no key and no network.
import { CostMeter, costOfCall, priceFor, usageOf } from "../lib/model-cost.mjs";
// Node 22.18 and later runs TypeScript with erasable types: the reader's form and prompt are the console's own (one copy).
import { MenuReading, menuPrompt, menuTool } from "../../apps/console/src/menu-read.ts";

export const MAX_CAP_USD = 2;
export const API = "https://api.anthropic.com";
const HALF = 0.5;                                  // the Batch API's price against the same call made one at a time
const PER_IMAGE_TOKENS = 2600, FIXED_TOKENS = 2500, MAX_OUT = 8000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The most one photo can cost: the photo at its largest, the prompt and tool, and the whole output allowance, at half price. */
export function estimatePhotoUsd(price) {
  return (((PER_IMAGE_TOKENS + FIXED_TOKENS) * price.input_usd_per_mtok + MAX_OUT * price.output_usd_per_mtok) / 1e6) * HALF;
}
const mimeOf = (p) => (/\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : "image/jpeg");
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const count = (xs, f) => xs.reduce((n, x) => n + (f(x) ? 1 : 0), 0);

async function pool(items, size, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/** The dishes of a reading, counted. */
export const dishCount = (r) => (r?.sections ?? []).reduce((n, s) => n + (s.dishes ?? []).length, 0);

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

  const queue = dry ? d.dryRunPhotos : ((await d.rpc("menu_reading_queue", { p_limit: d.limit ?? 200 })) ?? []);
  const photos = new Map(queue.map((x) => [x.photo_id, x]));
  const skipped = []; const failed = []; const readings = []; const batchIds = [...(d.resumeBatchIds ?? [])];
  let selected = [];

  // ---------- 1 choose the photos, and fetch them ----------
  if (!batchIds.length) {
    let worst = 0;
    for (const p of queue) {
      const e = estimatePhotoUsd(price);
      if (worst + e > d.capUsd) { skipped.push({ photo_id: p.photo_id, reason: "cap" }); meter.stoppedAtCap = true; continue; }
      worst += e; selected.push(p);
    }
    const fetched = await pool(selected, d.concurrency ?? 6, async (p) => {
      try {
        const f = p.bytes ? { bytes: p.bytes, mime: p.mime } : await d.download(p.media_path);
        if (f.bytes.byteLength > MAX_IMAGE_BYTES) return { p, error: "photo_too_large" };
        return { p, img: { bytes: f.bytes, mime: f.mime || mimeOf(p.media_path ?? "") } };
      } catch { return { p, error: "photo_unavailable" }; }
    });
    const ready = [];
    for (const f of fetched) { if (f.error) skipped.push({ photo_id: f.p.photo_id, reason: f.error }); else ready.push(f); }
    selected = ready.map((f) => f.p);
    // ---------- 2 one batch (a menu photo is well under the API's size limit; 150 MB is checked anyway) ----------
    const tool = menuTool(); const system = menuPrompt();
    // The Batch API takes ids of letters, digits, _ and - only (64 at most): a photo id is a uuid; a dry run's is the file's name.
    for (const { p } of ready) if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(p.photo_id))) throw new Error(`a photo id the Batch API refuses: ${String(p.photo_id).slice(0, 40)}`);
    const requests = ready.map(({ p, img }) => ({ custom_id: p.photo_id, params: { model: d.model, max_tokens: MAX_OUT, system, tools: [tool], tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: img.mime, data: b64(img.bytes) } },
        { type: "text", text: "Read this menu photo." }] }] } }));
    const max = d.maxBatchBytes ?? 150_000_000;
    const chunks = []; let cur = [], size = 0;
    for (const rq of requests) { const n = JSON.stringify(rq).length; if (cur.length && size + n > max) { chunks.push(cur); cur = []; size = 0; } cur.push(rq); size += n; }
    if (cur.length) chunks.push(cur);
    for (const c of chunks) {
      const res = await d.fetch(`${API}/v1/messages/batches`, { method: "POST", headers, body: JSON.stringify({ requests: c }) });
      if (!res.ok) throw new Error(`the Batch API refused a batch: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const b = await res.json(); batchIds.push(b.id); log(`[menu-read] batch ${b.id}: ${c.length} photo(s)`);
    }
  }

  // ---------- 3 wait for the batches, read the results ----------
  const unfinished = [];
  let read = 0, dishes = 0, usd = 0;
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
      const p = photos.get(row.custom_id);
      if (!p) continue;                                                    // read already, or no longer waiting
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
      }
      if (!parsed) {
        // The photo stays waiting: the next run reads it again; the Menus page shows the failure.
        if (!dry) await d.rpc("record_menu_reading", { p_photo: p.photo_id, p_reading: null, p_model: d.model, p_by: reader, p_reason: why }).catch(() => undefined);
        failed.push({ photo_id: p.photo_id, place: p.place, reason: why });
        continue;
      }
      if (!dry) await d.rpc("record_menu_reading", { p_photo: p.photo_id, p_reading: parsed, p_model: d.model, p_by: reader });
      readings.push({ photo_id: p.photo_id, place: p.place, reading: parsed });
      read++; dishes += dishCount(parsed);
    }
  }
  if (usd > d.capUsd) meter.stoppedAtCap = true;

  // ---------- 4 the report ----------
  const lines = [`### Menu reading run ${d.runId}${dry ? " (dry run: nothing written but the cost)" : ""}`, "",
    `Photos read: ${read} of ${queue.length} waiting; ${dishes} dish(es) proposed${dry ? "" : ", each waiting for a person on the Menus page"}. Batches: ${batchIds.length ? batchIds.join(", ") : "none"}. Model ${d.model}, half price. Spent USD ${usd.toFixed(4)} of a cap of USD ${d.capUsd}.`];
  if (skipped.length) lines.push(`Left for another run: ${count(skipped, (x) => x.reason === "cap")} for the cap, ${count(skipped, (x) => x.reason === "photo_unavailable")} photo(s) could not be fetched, ${count(skipped, (x) => x.reason === "photo_too_large")} photo(s) over 5 MB.`);
  if (meter.stoppedAtCap && skipped.some((x) => x.reason === "cap")) lines.push("**The cap was reached: the photos left are read by the next run.**");
  if (failed.length) lines.push(`**${failed.length} photo(s) failed and stay waiting:** ${failed.slice(0, 20).map((x) => `${x.place ?? x.photo_id} (${x.reason})`).join("; ")}`);
  if (unfinished.length) lines.push(`**Batch(es) still processing: ${unfinished.join(", ")}.** Run again with batch_ids set to read them; nothing is paid twice.`);
  const byPlace = {};
  for (const r of readings) byPlace[r.place ?? "?"] = (byPlace[r.place ?? "?"] ?? 0) + dishCount(r.reading);
  lines.push("", "| place | dishes proposed |", "|---|---|", ...Object.entries(byPlace).sort().map(([k, n]) => `| ${k} | ${n} |`), "");
  const summary = lines.join("\n");
  return { queued: queue.length, selected: selected.length, read, dishes, failed, skipped, batches: batchIds, unfinished, usd, cap: d.capUsd,
    cost: meter.toRecord(), meter, summary, readings };
}
