#!/usr/bin/env node
// LB1: the label reading run, against STAGING (.github/workflows/label-read.yml, by hand only). See scripts/label/batch.mjs for what it does.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, MODEL_FAST; MAX_USD (the cap, at most 5), LIMIT (items, optional),
//      BATCH_IDS (comma-separated batches to pick up instead of sending new ones), RUN_ID, OUT_DIR (default out/label).
// Writes: label-read-report.json (the run's numbers and every item not yet fact-complete), readings.jsonl (what the model read, so the
// first live readings can replace the invented ones in test/fixtures/label-read-lb1.json), and the run's cost to model_costs (COST1).
// Never prints a key, a photo or a reading.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runLabelRead, MAX_CAP_USD } from "./batch.mjs";
import { finishMeter, loadPrices, parseCap } from "../lib/model-cost.mjs";

const env = process.env;
const need = (k) => { if (!env[k]) { console.error(`::error::${k} is not set`); process.exit(1); } return env[k]; };
const conn = { url: need("SUPABASE_URL"), key: need("SUPABASE_SERVICE_KEY") };
const apiKey = need("ANTHROPIC_API_KEY"); const model = need("MODEL_FAST");
const capUsd = Math.min(MAX_CAP_USD, parseCap(env.MAX_USD, MAX_CAP_USD));
const limit = /^\d{1,4}$/.test(env.LIMIT ?? "") ? Number(env.LIMIT) : undefined;
const resumeBatchIds = (env.BATCH_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^msgbatch_[A-Za-z0-9]+$/.test(s));
const runId = env.RUN_ID ?? env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
const outDir = env.OUT_DIR ?? "out/label";
const auth = { apikey: conn.key, authorization: `Bearer ${conn.key}` };

const rpc = async (fn, args = {}) => {
  const r = await fetch(`${conn.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn} ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const download = async (path) => {
  if (!/^[A-Za-z0-9_\-./]+$/.test(path) || path.includes("..")) throw new Error("bad_path");
  const r = await fetch(`${conn.url}/storage/v1/object/media/${path}`, { headers: auth });
  if (!r.ok) throw new Error(`storage_${r.status}`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get("content-type")?.split(";")[0] ?? "image/jpeg" };
};

let out;
try {
  const prices = await loadPrices(conn);
  out = await runLabelRead({ rpc, download, fetch, prices, model, apiKey, capUsd, limit, resumeBatchIds, runId, log: (s) => console.log(s) });
} catch (e) {
  console.error(`::error::the reading run stopped: ${String(e.message).slice(0, 300)}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "label-read-report.json"), JSON.stringify({ run_id: runId, queued: out.queued, read: out.read, failed: out.failed, skipped: out.skipped, batches: out.batches, unfinished: out.unfinished,
  usd: out.usd, cap: out.cap, fields_by_template: out.fieldsByTemplate, settled: out.settled, report: out.report }, null, 1));
writeFileSync(join(outDir, "readings.jsonl"), out.readings.map((r) => JSON.stringify(r)).join("\n") + (out.readings.length ? "\n" : ""));
console.log(out.summary);
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, out.summary + "\n");
out.meter.conn = conn;
await finishMeter(out.meter, { env, conn });
if (out.unfinished.length) console.log(`::warning::${out.unfinished.length} batch(es) were still processing; run again with batch_ids`);
