#!/usr/bin/env node
// FD1, MENU2: the menu reading run, against STAGING (.github/workflows/menu-read.yml, by hand only). See batch.mjs and fetch.mjs.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, MODEL_FAST; MAX_USD (the cap for the whole run, at most 2), LIMIT (items,
//      optional), BATCH_IDS (comma-separated batches to pick up instead of sending new ones), DRY_RUN ("true": read the two invented menus in
//      test/fixtures/menus/ and write nothing to the database but the cost), RUN_ID, OUT_DIR (default out/menus).
//      MENU2: PLACE (a place's id) and LINK (its menu's web address): add that link as a menu source first, as the menu reading party (adding
//      something to read approves nothing); FULL_MENU ("true", the default: the link is the whole menu, so a later import can say what is gone).
//      FETCH_ONLY ("true"): fetch links and files, read nothing.
// Order: add the link (if given), fetch every waiting link and file (a headless browser for links, only when one waits), read everything
// waiting in one batch, then print what was proposed per place (sections, sizes, flagged rows) from the database.
// Writes: menu-read-report.json, readings.jsonl, menu-report-<place>.json, and the run's cost to model_costs (COST1). Never prints a key or a photo.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMenuRead, MAX_CAP_USD } from "./batch.mjs";
import { runMenuFetch } from "./fetch.mjs";
import { crawlMenu, fetchRobots, playwrightDriver } from "./crawl.mjs";
import { finishMeter, loadPrices, parseCap } from "../lib/model-cost.mjs";

const env = process.env;
const need = (k) => { if (!env[k]) { console.error(`::error::${k} is not set`); process.exit(1); } return env[k]; };
const conn = { url: need("SUPABASE_URL"), key: need("SUPABASE_SERVICE_KEY") };
const dry = env.DRY_RUN === "true";
const fetchOnly = env.FETCH_ONLY === "true";
const apiKey = fetchOnly ? "" : need("ANTHROPIC_API_KEY"); const model = fetchOnly ? "" : need("MODEL_FAST");
const capUsd = Math.min(MAX_CAP_USD, parseCap(env.MAX_USD, MAX_CAP_USD));
const limit = /^\d{1,4}$/.test(env.LIMIT ?? "") ? Number(env.LIMIT) : undefined;
const resumeBatchIds = (env.BATCH_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^msgbatch_[A-Za-z0-9]+$/.test(s));
const runId = env.RUN_ID ?? env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
const outDir = env.OUT_DIR ?? "out/menus";
const auth = { apikey: conn.key, authorization: `Bearer ${conn.key}` };
const summary = (s) => { console.log(s); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, s + "\n"); };

const rpc = async (fn, args = {}) => {
  const r = await fetch(`${conn.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn} ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const safePath = (path) => { if (!/^menus\/[A-Za-z0-9_\-./]+$/.test(path) || path.includes("..")) throw new Error("bad_path"); return path; };
const download = async (path) => {
  const r = await fetch(`${conn.url}/storage/v1/object/media/${safePath(path)}`, { headers: auth });
  if (!r.ok) throw new Error(`storage_${r.status}`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get("content-type")?.split(";")[0] ?? "image/jpeg" };
};
const upload = async (path, bytes, contentType) => {
  const r = await fetch(`${conn.url}/storage/v1/object/media/${safePath(path)}`, { method: "POST", headers: { ...auth, "content-type": contentType, "x-upsert": "true" }, body: bytes });
  if (!r.ok) throw new Error(`storage_${r.status}`);
};
// The dry run's photos: two invented menus, committed as small JPEGs (no real place, no number).
const fixtures = () => {
  const dir = fileURLToPath(new URL("../../test/fixtures/menus/", import.meta.url));
  return readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort().map((f) => ({ photo_id: f.replace(/\.jpe?g$/i, "").replace(/[^A-Za-z0-9_-]/g, "_"), place: f.replace(/\.jpe?g$/i, ""), media_path: f, bytes: new Uint8Array(readFileSync(join(dir, f))), mime: "image/jpeg" }));
};

mkdirSync(outDir, { recursive: true });
const places = new Set();
try {
  if (!dry) {
    // ---------- 1 a link given to the run ----------
    if (env.LINK) {
      if (!/^[0-9a-f-]{36}$/.test(env.PLACE ?? "")) throw new Error("PLACE must be the place's id (from its page's address on the console) when LINK is given");
      const r = await rpc("add_menu_source", { p_place: env.PLACE, p_kind: "link", p_by: await rpc("menu_reader_party", {}), p_detail: { url: env.LINK, full_menu: env.FULL_MENU !== "false" } });
      summary(`Link ${r.already ? "already waiting" : "added"} for the place (menu source ${r.menu_source_id}).`);
    }
    // ---------- 2 fetch links and files ----------
    let driver = null;
    const crawl = async (url) => {
      if (!driver) { const { chromium } = await import("playwright"); driver = await playwrightDriver(chromium); }
      return crawlMenu({ startUrl: url, driver, robotsTxt: await fetchRobots(url), log: (s) => console.log(s) });
    };
    try {
      const f = await runMenuFetch({ rpc, download, upload, crawl, log: (s) => console.log(s) });
      if (f.summary) summary(`### Menu sources fetched\n\n${f.summary}\n`);
      for (const x of f.done) places.add(x.place);
    } finally { if (driver) await driver.close(); }
  }
} catch (e) {
  console.error(`::error::the menu fetch stopped: ${String(e.message).slice(0, 300)}`);
  process.exit(1);
}
if (fetchOnly) process.exit(0);

let out;
try {
  const prices = await loadPrices(conn);
  out = await runMenuRead({ rpc, download, fetch, prices, model, apiKey, capUsd, limit, resumeBatchIds, runId, dryRunPhotos: dry ? fixtures() : undefined, log: (s) => console.log(s) });
} catch (e) {
  console.error(`::error::the menu reading run stopped: ${String(e.message).slice(0, 300)}`);
  process.exit(1);
}
writeFileSync(join(outDir, "menu-read-report.json"), JSON.stringify({ run_id: runId, dry_run: dry, queued: out.queued, read: out.read, pages_read: out.pagesRead, dishes: out.dishes,
  failed: out.failed, skipped: out.skipped, batches: out.batches, unfinished: out.unfinished, usd: out.usd, cap: out.cap }, null, 1));
writeFileSync(join(outDir, "readings.jsonl"), out.readings.map((r) => JSON.stringify(r)).join("\n") + (out.readings.length ? "\n" : ""));
summary(out.summary);
// A dry run's readings are invented menus: they are printed so the run's page shows what the reader made of them.
if (dry) for (const r of out.readings) console.log(`\n#### ${r.place}\n` + JSON.stringify(r.reading, null, 1));
out.meter.conn = conn;
await finishMeter(out.meter, { env, conn });
if (out.unfinished.length) console.log(`::warning::${out.unfinished.length} batch(es) were still processing; run again with batch_ids`);

// ---------- 3 what waits for a person, per place (a menu is a place's public offer: dish names and prices, never a person's data) ----------
if (!dry) {
  const ids = new Map();
  for (const p of (await rpc("places_console", {})) ?? []) if (p.dishes_waiting > 0) ids.set(p.source_id, p.name);
  for (const [id, name] of ids) {
    const r = await rpc("menu_place_report", { p_place: id });
    writeFileSync(join(outDir, `menu-report-${id}.json`), JSON.stringify(r, null, 1));
    const rows = [`### ${name}: waiting on the Menus page`, "", `${r.waiting} dish(es) wait (${r.clean} clean: one press per section; the rest one by one); ${r.unchanged} read again unchanged.`, "",
      "| section | dishes | clean | price to confirm | flagged |", "|---|---|---|---|---|",
      ...r.sections.map((x) => `| ${x.section} | ${x.dishes} | ${x.clean} | ${x.price_to_confirm} | ${x.flagged} |`), ""];
    if (r.sizes.length) rows.push("Sizes found:", ...r.sizes.map((x) => `- ${x.dish}: ${x.sizes.map((z) => `${z.name_en ?? z.name_ar} ${z.price ?? "?"}`).join(", ")}`), "");
    if (r.flagged.length) rows.push("Flagged (approved one by one):", ...r.flagged.map((x) => `- ${x.section} · ${x.dish}: ${[...x.flags, x.price_status === "to_confirm" ? "price to confirm" : null].filter(Boolean).join(", ")}${x.note ? ` (${x.note})` : ""}`), "");
    summary(rows.join("\n"));
  }
}
