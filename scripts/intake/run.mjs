#!/usr/bin/env node
// Session I1: one run of the product intake pipeline (.github/workflows/intake.yml, every two hours, staging).
//
//   1. the day's spot-check sample (auto_approval_daily_sample, 0126): a random tenth of each finished day's automatic approvals
//   2. the database's steps and the approval rules over everything waiting (intake_advance, 0127)
//   3. at most --max-jobs jobs from product_intake_jobs (0122), one at a time, oldest step first:
//        identity    the item's research file: an earlier session's file in data/research if there is one, otherwise one
//                    fast-model call with web search under data/research/README.md's rules (lib/research.mjs)
//        picture     P2's loader, picture part, unchanged (load-research.mjs loadPicture: P1's evaluate and decide)
//        food_facts  P2's loader, facts part, unchanged (load-research.mjs loadFacts: propose_web_facts and its checks)
//      the run stops taking jobs once its model spend passes --max-spend USD; a refused key stops it at once
//   4. step 2 again, then the run's minutes and spend in intake_runs and in the step summary
// A failed job is tried again next run; after its third failure it is on the review list with the reason (finish_intake_job).
// Nothing here approves anything: only a person, or a rule of auto_approval_rules that passed its spot check, does.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, MODEL_FAST, RUN_ID.
// Flags: --max-jobs 15  --max-spend 0.75  --research-dir data/research (reuse earlier files; "" to always call the model)  --report-out file
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { plan, loadPicture, loadFacts } from "../product-data/load-research.mjs";
import { readResearch } from "../product-data/lib/research.mjs";
import { researchItem, committedFile, costOf, Fatal } from "./lib/research.mjs";

export const DEFAULTS = { maxJobs: 15, maxSpend: 0.75, researchDir: "data/research" };
const isFatal = (e) => e instanceof Fatal || e?.name === "Fatal" || e?.constructor?.name === "Fatal";

/** One job. d = { store, runId, model, prices, client, pictures, researchDir, readFile? }. Returns { outcome, result, error, cost }. */
export async function runJob(job, d) {
  const item = job.item;
  if (job.step === "identity") {
    const found = d.researchDir ? committedFile(d.researchDir, item, d.readFile) : null;
    if (found) {
      const id = await d.store.rpc("record_intake_research", { p_product: item.product_id, p_run: d.runId, p_file_text: found.text, p_file_sha: found.sha,
        p_model: `file:${d.researchDir}/${item.sku}.json`, p_input_tokens: 0, p_output_tokens: 0, p_web_searches: 0, p_cost_usd: 0, p_dropped: [], p_pages_seen: 0 });
      return { outcome: "done", cost: 0, result: { research_id: id, source: "committed_file", sha: found.sha, confidence: found.file?.matched?.confidence ?? null } };
    }
    const r = await researchItem(item, { client: d.client, model: d.model, prices: d.prices, rules: d.rules });
    if (!r.ok) return { outcome: "failed", cost: r.cost, error: `research: ${r.reason}`, result: { usage: r.usage, dropped: r.dropped ?? [] } };
    const id = await d.store.rpc("record_intake_research", { p_product: item.product_id, p_run: d.runId, p_file_text: r.text, p_file_sha: r.sha, p_model: d.model,
      p_input_tokens: r.usage.input, p_output_tokens: r.usage.output, p_web_searches: r.usage.searches, p_cost_usd: Number(r.cost.toFixed(6)),
      p_dropped: r.dropped, p_pages_seen: r.pagesSeen });
    return { outcome: "done", cost: r.cost, result: { research_id: id, source: "model", sha: r.sha, confidence: r.file.matched?.confidence ?? null,
      searches: r.usage.searches, dropped: r.dropped.length, cost_usd: Number(r.cost.toFixed(6)) } };
  }

  if (job.step !== "picture" && job.step !== "food_facts") return { outcome: "failed", cost: 0, error: `not a workflow step: ${job.step}` };
  const latest = await d.store.rpc("latest_intake_research", { p_product: item.product_id });
  if (!latest?.file_text) return { outcome: "failed", cost: 0, error: "no research file for this item yet (identity step)" };
  const read = readResearch(`${item.sku}.json`, latest.file_text);
  if (!read.ok) return { outcome: "failed", cost: 0, error: `research file not loadable: ${read.reason}` };
  const part = job.step === "picture" ? "picture" : "facts";
  const todo = plan(item, read.sha, { parts: [part] })[part];
  if (todo !== "run") {
    await d.store.rpc("intake_try_auto", { p_product: item.product_id });
    return { outcome: "done", cost: 0, result: { skipped: todo, research_id: latest.research_id } };
  }
  const meter = { usd: 0 };
  const r = part === "picture"
    ? await loadPicture(item, read.file, read.sha, { store: d.store, runId: d.runId, pictures: (it, c, meta) => d.pictures(it, c, meta, meter) })
    : await loadFacts(item, read.file, read.sha, { store: d.store, runId: d.runId });
  const auto = await d.store.rpc("intake_try_auto", { p_product: item.product_id });
  if (r.outcome === "error") return { outcome: "failed", cost: meter.usd, error: `${part}: ${r.error ?? "error"}` };
  return { outcome: "done", cost: meter.usd, result: { outcome: r.outcome, research_id: latest.research_id, proposed: r.proposed, reasons: r.reasons, auto } };
}

/** The whole run. d = runJob's deps plus { now? }. opts = { maxJobs, maxSpend }. Returns the run report. */
export async function runIntake(d, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const now = d.now ?? (() => Date.now());
  const started = now();
  const sample = await d.store.rpc("auto_approval_daily_sample", {});
  const before = await d.store.rpc("intake_advance", {});
  const jobs = []; let spend = 0; let stopped = null;
  while (jobs.length < o.maxJobs) {
    if (spend > o.maxSpend) { stopped = `spend_cap: ${spend.toFixed(4)} USD passed ${o.maxSpend}`; break; }
    const [job] = (await d.store.rpc("claim_intake_jobs", { p_limit: 1, p_run: d.runId })) ?? [];
    if (!job) break;
    let r;
    try { r = await runJob(job, d); }
    catch (e) {
      if (isFatal(e)) {
        await d.store.rpc("finish_intake_job", { p_job: job.job_id, p_run: d.runId, p_outcome: "released", p_result: {}, p_error: String(e.message).slice(0, 300) });
        jobs.push({ sku: job.item.sku, step: job.step, outcome: "released", error: String(e.message).slice(0, 120) });
        stopped = `fatal: ${String(e.message).slice(0, 160)}`; break;
      }
      r = { outcome: "failed", cost: 0, error: String(e?.message ?? e).slice(0, 300) };
    }
    spend += r.cost ?? 0;
    const fin = await d.store.rpc("finish_intake_job", { p_job: job.job_id, p_run: d.runId, p_outcome: r.outcome, p_result: r.result ?? {}, p_error: r.error ?? null });
    jobs.push({ sku: job.item.sku, step: job.step, outcome: r.outcome, status: fin?.status, error: r.error, cost_usd: Number((r.cost ?? 0).toFixed(6)) });
  }
  if (!stopped && spend > o.maxSpend) stopped = `spend_cap: ${spend.toFixed(4)} USD passed ${o.maxSpend}`;
  const after = await d.store.rpc("intake_advance", {});
  const report = await d.store.rpc("intake_report", {});
  const minutes = Math.round(((now() - started) / 60000) * 100) / 100;
  const run = { run_id: d.runId, minutes, spend_usd: Number(spend.toFixed(6)), max_jobs: o.maxJobs, max_spend_usd: o.maxSpend, stopped,
    jobs, sample, advance: { before, after }, report };
  await d.store.rpc("record_intake_run", { p_run: d.runId, p_started: new Date(started).toISOString(), p_minutes: minutes, p_spend: run.spend_usd,
    p_taken: jobs.length, p_done: jobs.filter((j) => j.outcome === "done").length, p_stopped: stopped, p_detail: { jobs, sample } });
  return run;
}

export function summaryLines(run) {
  const by = {}; for (const j of run.jobs) { const k = `${j.step}:${j.outcome}`; by[k] = (by[k] ?? 0) + 1; }
  const r = run.report ?? {};
  return [
    `### Product intake, run ${run.run_id}`,
    `- **minutes (this script): ${run.minutes}; model spend: ${run.spend_usd.toFixed(4)} USD** (cap ${run.max_spend_usd}, at most ${run.max_jobs} jobs)${run.stopped ? `; stopped early: ${run.stopped}` : ""}`,
    `- jobs this run: ${run.jobs.length} ${JSON.stringify(by)}`,
    ...run.jobs.filter((j) => j.error).map((j) => `  - ${j.sku} ${j.step}: ${String(j.error).slice(0, 160)}${j.status === "listed" ? " (third failure: on the review list)" : ""}`),
    `- spot-check sample: ${JSON.stringify(run.sample ?? [])}`,
    `- rules (on/off): ${JSON.stringify(r.rules ?? {})}; approved by a rule: ${r.auto_approved ?? 0}; logged while off: ${r.auto_logged_rule_off ?? 0}; spot checks waiting: ${r.spot_checks_waiting ?? 0}`,
    `- rules this run: ${JSON.stringify(run.advance?.after?.auto ?? {})}`,
    `- **items ${r.items ?? 0}: researched ${r.researched ?? 0} (research spend so far ${Number(r.research_spend_usd ?? 0).toFixed(4)} USD), live ${r.live ?? 0}, on the review list ${r.listed ?? 0}**`,
    `- steps: ${JSON.stringify(r.steps ?? {})}`, ""];
}

function args(argv) {
  const a = { ...DEFAULTS, reportOut: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--max-jobs") a.maxJobs = Math.max(0, Math.min(50, Number(argv[++i]) || 0));
    else if (argv[i] === "--max-spend") a.maxSpend = Math.max(0, Math.min(5, Number(argv[++i]) || 0));
    else if (argv[i] === "--research-dir") a.researchDir = argv[++i] || null;
    else if (argv[i] === "--report-out") a.reportOut = argv[++i];
  }
  return a;
}

async function main() {
  const a = args(process.argv.slice(2));
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ANTHROPIC_API_KEY", "MODEL_FAST"].filter((k) => !process.env[k]);
  if (missing.length) { console.error(`missing env: ${missing.join(", ")}`); process.exit(2); }
  const runId = process.env.RUN_ID || `local-${Date.now()}`;
  const model = process.env.MODEL_FAST;
  const { makeStore } = await import("../images/lib/store.mjs");
  const store = makeStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY });
  const prices = await store.rpc("intake_prices", { p_model: model });
  if (!prices) { console.error(`no price for ${model} in model_prices (or no web-search price in settings.intake): an unknown price is never counted as free`); process.exit(1); }
  const [{ default: Anthropic }, { loadSharp }, { checkPicture }, { download }, { proposeFromResearch }] = await Promise.all([
    import("@anthropic-ai/sdk"), import("../images/lib/image.mjs"), import("../images/lib/vision.mjs"), import("../images/fetch-images.mjs"), import("../images/research-pictures.mjs")]);
  const sharp = await loadSharp();
  if (!sharp) { console.error("sharp is not installed (npm ci --prefix scripts/images)"); process.exit(2); }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
  // The picture check is P1's, unchanged; its request goes through this fetch so its tokens count against the run's spend.
  const pictures = (item, candidates, meta, meter) => proposeFromResearch(item, candidates, {
    store, sharp, runId, model, download,
    check: (it, jpeg) => checkPicture(it, jpeg, { apiKey: process.env.ANTHROPIC_API_KEY, model, fetchImpl: async (url, init) => {
      const res = await fetch(url, init);
      try { meter.usd += costOf((await res.clone().json()).usage, { ...prices, web_search_usd_per_search: 0 }).usd; } catch { /* no usage: not priced */ }
      return res;
    } }) }, meta);
  const run = await runIntake({ store, runId, model, prices, client, pictures, researchDir: a.researchDir }, a);
  console.log(JSON.stringify({ ...run, advance: undefined }, null, 2));
  if (a.reportOut) writeFileSync(a.reportOut, JSON.stringify(run, null, 2) + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryLines(run).join("\n"));
  if (run.stopped?.startsWith("fatal")) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.message); process.exit(1); });
