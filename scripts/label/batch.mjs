// LB1 (16 November 2026): the label reading run. The photos taken on the label day (front, back, side: migration 0211's label_captures) are read
// by MODEL_FAST through the Anthropic Message Batches API, which costs half the usual price, in one or a few batches. For each item:
//   record_label_scan()      the reading goes in as PROPOSALS (food facts for a food item, the template's own fields, printed claims), with the
//                            photos as evidence; nothing is approved by a model (invariant 3)
//   label_reading_settle()   the approval rules approve what they may (a label and a second source that agree, 0124 and 0207), then LABEL BEATS WEB
//                            (0114): the web or Open Food Facts proposals for the same fields are set aside, a disagreement kept for a person
// Allergens, halal, certificates, hazard warnings and printed warnings are never approved here: they wait in the approval queue for a person.
// Money: the run is capped (at most USD 5; the worst case of every item sent is estimated first, and no more items are sent than that allows),
// every result's tokens are priced at half the list price and recorded in model_costs (COST1). Nothing about a photo or a reading is logged.
// Everything outside the run is injected (rpc, download, fetch, prices), so the dry run in test/db/label-read-lb1.test.ts needs no key and no network.
import { CostMeter, costOfCall, priceFor, usageOf } from "../lib/model-cost.mjs";
// Node 22.18 and later runs TypeScript with erasable types: the reader's schema, prompt and mapping are the console's own (one copy).
import { LabelReading, labelPrompt, labelTool, readingClaims, readingFacts, readingFields, templateHint } from "../../apps/console/src/label.ts";

export const MAX_CAP_USD = 5;
export const API = "https://api.anthropic.com";
const HALF = 0.5;                                  // the Batch API's price against the same call made one at a time
const PER_IMAGE_TOKENS = 1800, FIXED_TOKENS = 3000, MAX_OUT = 2000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The most one item can cost: every photo at its largest, the prompt and tool, and the whole output allowance, at half price. */
export function estimateItemUsd(price, images) {
  return (((images * PER_IMAGE_TOKENS + FIXED_TOKENS) * price.input_usd_per_mtok + MAX_OUT * price.output_usd_per_mtok) / 1e6) * HALF;
}
const mimeOf = (p) => (/\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : "image/jpeg");
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const count = (xs, f) => xs.reduce((n, x) => n + (f(x) ? 1 : 0), 0);

async function pool(items, size, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/**
 * deps: { rpc(fn, args), download(path) -> {bytes, mime}, fetch, prices, model, apiKey, capUsd, runId, sleep(ms), log(s),
 *         limit?, resumeBatchIds?, maxBatchBytes?, pollMs?, maxWaitMs?, concurrency? }
 */
export async function runLabelRead(d) {
  const log = d.log ?? (() => {});
  if (!(d.capUsd > 0)) throw new Error("a run needs a dollar cap above zero (capUsd)");
  if (d.capUsd > MAX_CAP_USD) throw new Error(`the cap is at most USD ${MAX_CAP_USD} for this run; got ${d.capUsd}`);
  const day = new Date().toISOString().slice(0, 10);
  const price = priceFor(d.prices, d.model, day);
  if (!price) throw new Error(`NO_PRICE: model_prices has no row for ${d.model}; the run does not spend without a price`);
  const meter = new CostMeter({ workflow: "label-read", runId: d.runId, capUsd: d.capUsd, prices: d.prices, enforce: false, step: "batch_read", log });
  const sleep = d.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const headers = { "x-api-key": d.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  const reader = await d.rpc("label_reader_party", {});

  const queue = (await d.rpc("label_reading_queue", { p_limit: d.limit ?? 500 })) ?? [];
  const items = new Map(queue.map((x) => [x.product_id, x]));
  const skipped = []; const failed = []; const readings = []; const batchIds = [...(d.resumeBatchIds ?? [])];
  let selected = [];

  // ---------- 1 choose the items, and fetch their photos ----------
  if (!batchIds.length) {
    let worst = 0;
    for (const it of queue) {
      const n = (it.photos ?? []).length;
      if (n < 2) { skipped.push({ product_id: it.product_id, reason: "photos_missing" }); continue; }
      const e = estimateItemUsd(price, n);
      if (worst + e > d.capUsd) { skipped.push({ product_id: it.product_id, reason: "cap" }); meter.stoppedAtCap = true; continue; }
      worst += e; selected.push(it);
    }
    const fetched = await pool(selected, d.concurrency ?? 6, async (it) => {
      try {
        const imgs = await Promise.all(it.photos.map(async (p) => { const f = await d.download(p); if (f.bytes.byteLength > MAX_IMAGE_BYTES) throw Object.assign(new Error("big"), { big: true }); return { bytes: f.bytes, mime: f.mime || mimeOf(p) }; }));
        return { it, imgs };
      } catch (e) { return { it, error: e?.big ? "photo_too_large" : "photo_unavailable" }; }
    });
    const ready = [];
    for (const f of fetched) { if (f.error) skipped.push({ product_id: f.it.product_id, reason: f.error }); else ready.push(f); }
    selected = ready.map((f) => f.it);
    // ---------- 2 the requests, in batches that fit the API's size limit ----------
    const tool = labelTool(); const system = labelPrompt();
    const requests = ready.map(({ it, imgs }) => ({ custom_id: it.product_id, params: { model: d.model, max_tokens: MAX_OUT, system, tools: [tool], tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: [...imgs.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: b64(i.bytes) } })),
        { type: "text", text: `Read these label photos. ${templateHint(it.template, it.is_food)}` }] }] } }));
    const max = d.maxBatchBytes ?? 150_000_000;
    const chunks = []; let cur = [], size = 0;
    for (const rq of requests) { const n = JSON.stringify(rq).length; if (cur.length && size + n > max) { chunks.push(cur); cur = []; size = 0; } cur.push(rq); size += n; }
    if (cur.length) chunks.push(cur);
    for (const c of chunks) {
      const res = await d.fetch(`${API}/v1/messages/batches`, { method: "POST", headers, body: JSON.stringify({ requests: c }) });
      if (!res.ok) throw new Error(`the Batch API refused a batch: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const b = await res.json(); batchIds.push(b.id); log(`[label-read] batch ${b.id}: ${c.length} item(s)`);
    }
  }

  // ---------- 3 wait for the batches, read the results ----------
  const unfinished = [];
  const settled = { facts_set_aside: 0, fields_set_aside: 0, claims_set_aside: 0, disagreements: 0 };
  const fieldsByTemplate = {};
  let read = 0, usd = 0;
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
      const it = items.get(row.custom_id);
      if (!it) continue;                                                   // read already, or no longer waiting
      const result = row.result ?? {};
      if (result.type === "succeeded") {
        const u = usageOf(result.message?.usage);
        const line = costOfCall(price, u) * HALF;
        meter.addLine({ model: d.model, step: "batch_read", calls: 1, input_tokens: u.input, output_tokens: u.output, cache_read_tokens: u.cacheRead, cache_write_tokens: u.cacheWrite, web_searches: 0, usd: line });
        usd += line;
      }
      let parsed = null; let why = null;
      if (result.type !== "succeeded") why = `the batch ${result.type}`;
      else {
        const call = (result.message?.content ?? []).find((b) => b.type === "tool_use");
        const p = LabelReading.safeParse(call?.input);
        if (p.success) parsed = p.data; else why = "unreadable: the model's answer did not fit the label form";
      }
      if (!parsed) {
        // The photos stay on record as a scan with no reading: the item stays in the queue and the report says "reading_failed".
        await d.rpc("record_label_scan", { p_product: it.product_id, p_photos: it.photos, p_reading: null, p_model: null, p_by: reader }).catch(() => undefined);
        failed.push({ product_id: it.product_id, sku: it.sku, reason: why });
        continue;
      }
      const r = await d.rpc("record_label_scan", { p_product: it.product_id, p_photos: it.photos, p_model: d.model, p_by: reader,
        p_reading: { ...parsed, facts: readingFacts(parsed), fields: readingFields(parsed), claims: readingClaims(parsed) } });
      const s = await d.rpc("label_reading_settle", { p_product: it.product_id });
      for (const k of Object.keys(settled)) settled[k] += Number(s?.[k] ?? 0);
      const n = Object.keys(r.proposed ?? {}).length + Object.keys(r.fields ?? {}).length + (r.claims ?? []).length;
      fieldsByTemplate[r.template ?? "unknown"] = (fieldsByTemplate[r.template ?? "unknown"] ?? 0) + n;
      readings.push({ custom_id: it.product_id, sku: it.sku, template: r.template, reading: parsed });
      read++;
    }
  }
  if (usd > d.capUsd) meter.stoppedAtCap = true;

  // ---------- 4 the report ----------
  const report = (await d.rpc("label_day_report", {})) ?? { not_fact_complete: [] };
  const byReason = {};
  for (const x of report.not_fact_complete ?? []) (byReason[x.reason_code] ??= []).push(x);
  const lines = [`### Label reading run ${d.runId}`, "",
    `Items read: ${read} of ${queue.length} waiting. Batches: ${batchIds.length ? batchIds.join(", ") : "none"}. Model ${d.model}, half price. Spent USD ${usd.toFixed(4)} of a cap of USD ${d.capUsd}.`];
  if (skipped.length) lines.push(`Left for another run: ${count(skipped, (x) => x.reason === "cap")} for the cap, ${count(skipped, (x) => x.reason === "photo_unavailable")} photo(s) could not be fetched, ${count(skipped, (x) => x.reason === "photo_too_large")} photo(s) over 5 MB, ${count(skipped, (x) => x.reason === "photos_missing")} with fewer than two photos.`);
  if (meter.stoppedAtCap && skipped.some((x) => x.reason === "cap")) lines.push("**The cap was reached: the items left are read by the next run.**");
  if (failed.length) lines.push(`**${failed.length} item(s) failed and stay in the queue:** ${failed.slice(0, 20).map((x) => `${x.sku ?? x.product_id} (${x.reason})`).join("; ")}`);
  if (unfinished.length) lines.push(`**Batch(es) still processing: ${unfinished.join(", ")}.** Run again with batch_ids set to read them; nothing is paid twice.`);
  lines.push(`Label beats web: ${settled.facts_set_aside} web fact proposal(s), ${settled.fields_set_aside} field proposal(s) and ${settled.claims_set_aside} claim(s) set aside; ${settled.disagreements} disagreement(s) kept for a person.`, "",
    "| template | fields filled (proposed) |", "|---|---|", ...Object.entries(fieldsByTemplate).sort().map(([t, n]) => `| ${t} | ${n} |`), "",
    `Fact-complete now: ${report.fact_complete ?? 0} of ${report.items ?? 0}. Photographed: ${report.photographed ?? 0}. Read: ${report.read ?? 0}.`, "", "#### Not yet fact-complete, by reason", "",
    ...Object.entries(byReason).map(([k, xs]) => `- ${k}: ${xs.length}`), "");
  const summary = lines.join("\n");
  return { queued: queue.length, selected: selected.length, read, failed, skipped, batches: batchIds, unfinished, usd, cap: d.capUsd, fieldsByTemplate, settled,
    cost: meter.toRecord(), meter, summary, report, readings };
}
