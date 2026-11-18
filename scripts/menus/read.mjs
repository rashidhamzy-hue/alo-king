#!/usr/bin/env node
// FD1: the menu reading run, against STAGING (.github/workflows/menu-read.yml, by hand only). See scripts/menus/batch.mjs for what it does.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, MODEL_FAST; MAX_USD (the cap, at most 2), LIMIT (photos, optional),
//      BATCH_IDS (comma-separated batches to pick up instead of sending new ones), DRY_RUN ("true": read the two invented menus in
//      test/fixtures/menus/ and write nothing to the database but the cost), RUN_ID, OUT_DIR (default out/menus).
// Writes: menu-read-report.json (the run's numbers), readings.jsonl (what the model read), and the run's cost to model_costs (COST1).
// Never prints a key or a photo.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMenuRead, MAX_CAP_USD } from "./batch.mjs";
import { finishMeter, loadPrices, parseCap } from "../lib/model-cost.mjs";

const env = process.env;
const need = (k) => { if (!env[k]) { console.error(`::error::${k} is not set`); process.exit(1); } return env[k]; };
const conn = { url: need("SUPABASE_URL"), key: need("SUPABASE_SERVICE_KEY") };
const apiKey = need("ANTHROPIC_API_KEY"); const model = need("MODEL_FAST");
const capUsd = Math.min(MAX_CAP_USD, parseCap(env.MAX_USD, MAX_CAP_USD));
const limit = /^\d{1,4}$/.test(env.LIMIT ?? "") ? Number(env.LIMIT) : undefined;
const resumeBatchIds = (env.BATCH_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^msgbatch_[A-Za-z0-9]+$/.test(s));
const dry = env.DRY_RUN === "true";
const runId = env.RUN_ID ?? env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
const outDir = env.OUT_DIR ?? "out/menus";
const auth = { apikey: conn.key, authorization: `Bearer ${conn.key}` };

const rpc = async (fn, args = {}) => {
  const r = await fetch(`${conn.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn} ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const download = async (path) => {
  if (!/^menus\/[A-Za-z0-9_\-./]+$/.test(path) || path.includes("..")) throw new Error("bad_path");
  const r = await fetch(`${conn.url}/storage/v1/object/media/${path}`, { headers: auth });
  if (!r.ok) throw new Error(`storage_${r.status}`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get("content-type")?.split(";")[0] ?? "image/jpeg" };
};
// The dry run's photos: two invented menus, committed as small JPEGs (no real place, no number).
const fixtures = () => {
  const dir = fileURLToPath(new URL("../../test/fixtures/menus/", import.meta.url));
  return readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort().map((f) => ({ photo_id: f, place: f.replace(/\.jpe?g$/i, ""), media_path: f, bytes: new Uint8Array(readFileSync(join(dir, f))), mime: "image/jpeg" }));
};

let out;
try {
  const prices = await loadPrices(conn);
  out = await runMenuRead({ rpc, download, fetch, prices, model, apiKey, capUsd, limit, resumeBatchIds, runId, dryRunPhotos: dry ? fixtures() : undefined, log: (s) => console.log(s) });
} catch (e) {
  console.error(`::error::the menu reading run stopped: ${String(e.message).slice(0, 300)}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "menu-read-report.json"), JSON.stringify({ run_id: runId, dry_run: dry, queued: out.queued, read: out.read, dishes: out.dishes, failed: out.failed,
  skipped: out.skipped, batches: out.batches, unfinished: out.unfinished, usd: out.usd, cap: out.cap }, null, 1));
writeFileSync(join(outDir, "readings.jsonl"), out.readings.map((r) => JSON.stringify(r)).join("\n") + (out.readings.length ? "\n" : ""));
console.log(out.summary);
// A dry run's readings are invented menus: they are printed so the run's page shows what the reader made of them.
if (dry) for (const r of out.readings) console.log(`\n#### ${r.place}\n` + JSON.stringify(r.reading, null, 1));
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, out.summary + "\n");
out.meter.conn = conn;
await finishMeter(out.meter, { env, conn });
if (out.unfinished.length) console.log(`::warning::${out.unfinished.length} batch(es) were still processing; run again with batch_ids`);
