#!/usr/bin/env node
// AUTO1: the picture check of rule photo-vision-1, against STAGING (.github/workflows/photo-check.yml). See lib/photo-check.mjs.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, MODEL_FAST; MAX_USD (the cap for the run, at most 1), MODE (decide | recheck | both),
//      FRONTS ("false": do not queue the label day's front photos), LIMIT (pictures, optional), BATCH_IDS (pick up batches already sent),
//      RUN_ID, OUT_DIR (default out/photo-check).
// Writes: photo-check-report.json and, after a re-check, photo-recheck.json (the disagreements: sku, name, the check's reason); the run's cost
// to model_costs (COST1). Never prints a key or a picture.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPhotoCheck, MAX_CAP_USD } from "./lib/photo-check.mjs";
import { finishMeter, loadPrices, parseCap } from "../lib/model-cost.mjs";

const env = process.env;
const need = (k) => { if (!env[k]) { console.error(`::error::${k} is not set`); process.exit(1); } return env[k]; };
const conn = { url: need("SUPABASE_URL"), key: need("SUPABASE_SERVICE_KEY") };
const apiKey = need("ANTHROPIC_API_KEY"); const model = need("MODEL_FAST");
const capUsd = Math.min(MAX_CAP_USD, parseCap(env.MAX_USD, MAX_CAP_USD));
const mode = ["decide", "recheck", "both"].includes(env.MODE) ? env.MODE : "decide";
const limit = /^\d{1,4}$/.test(env.LIMIT ?? "") ? Number(env.LIMIT) : undefined;
const resumeBatchIds = (env.BATCH_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^msgbatch_[A-Za-z0-9]+$/.test(s));
const runId = env.RUN_ID ?? env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
const outDir = env.OUT_DIR ?? "out/photo-check";
const auth = { apikey: conn.key, authorization: `Bearer ${conn.key}` };
const summary = (s) => { console.log(s); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, s + "\n"); };

const rpc = async (fn, args = {}) => {
  const r = await fetch(`${conn.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn} ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const safePath = (p) => { if (!/^[A-Za-z0-9_\-./]+$/.test(p) || p.includes("..") || p.startsWith("/")) throw new Error("bad_path"); return p; };
const download = async (path) => {
  const r = await fetch(`${conn.url}/storage/v1/object/media/${safePath(path)}`, { headers: auth });
  if (!r.ok) throw new Error(`storage_${r.status}`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get("content-type")?.split(";")[0] ?? "image/jpeg" };
};

mkdirSync(outDir, { recursive: true });
let out;
try {
  const prices = await loadPrices(conn);
  out = await runPhotoCheck({ rpc, download, fetch, prices, model, apiKey, capUsd, mode, fronts: env.FRONTS !== "false", limit, resumeBatchIds, runId, log: (s) => console.log(s) });
} catch (e) {
  console.error(`::error::the picture check stopped: ${String(e.message).slice(0, 300)}`);
  process.exit(1);
}
writeFileSync(join(outDir, "photo-check-report.json"), JSON.stringify({ run_id: runId, mode, queued: out.queued, selected: out.selected, fronts: out.fronts, outcomes: out.outcomes,
  failed: out.failed, skipped: out.skipped, batches: out.batches, unfinished: out.unfinished, usd: out.usd, cap: out.cap }, null, 1));
if (out.recheck) writeFileSync(join(outDir, "photo-recheck.json"), JSON.stringify(out.recheck, null, 1));
summary(out.summary);
out.meter.conn = conn;
await finishMeter(out.meter, { env, conn });
if (out.unfinished.length) console.log(`::warning::${out.unfinished.length} batch(es) were still processing; run again with batch_ids`);
