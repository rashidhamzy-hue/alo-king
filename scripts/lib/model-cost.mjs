// Session COST1: what a workflow that calls a model spends, recorded in one table and stopped at a dollar cap.
//
// A script (or a test run by a workflow) starts a meter before its first model call:
//
//   const meter = await startMeter({ workflow: "product-data", capDefault: 3 });   // reads MODEL_COST_CAP_USD, MODEL_COST_STEP
//   ... the script runs as before: every request to api.anthropic.com/v1/messages is counted ...
//   await finishMeter(meter);                                                       // prints the total, records the rows
//
// How it works, and why it is built this way:
//   * It wraps globalThis.fetch for api.anthropic.com/v1/messages only. The Anthropic SDK, the scripts' own fetch calls and the
//     live evals all go through it, so no call can be missed, and no script's own logic changes.
//   * Each response's usage (input, output, cache read, cache write, web searches) is priced from model_prices (the rows in force
//     today, from the database: prices are data, never code), call by call, by the rule agent_run_costs uses (0092, 0102):
//     the long-context rate when the whole prompt is above the threshold, cached tokens at their own price.
//   * Before a call: a model with no price row is refused (an unknown price is never counted as free), and so is every call once
//     the total has reached the cap. The refusal is a 400 response whose message says COST_CAP, so the SDK does not retry it and
//     the scripts' own "fatal" handling stops the run. Calls already in flight finish and are counted, so the total can pass the
//     cap by those calls.
//   * finishMeter prints the total in the run summary and writes the rows with record_model_cost (migration 0139). If the rows
//     cannot be written the process exits 1, and the lines are printed so the spend is not lost.
// No key or secret is printed. This changes no Anthropic workspace or key.
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ANTHROPIC_HOST = "api.anthropic.com";
const rawFetch = globalThis.fetch;

export class CostCapReached extends Error {
  constructor(spent, cap) { super(`COST_CAP: this run has spent USD ${spent.toFixed(4)} and its cap is USD ${cap}; no further model call is made`); this.name = "CostCapReached"; this.code = "COST_CAP"; }
}
export class NoPrice extends Error {
  constructor(model, day) { super(`NO_PRICE: model_prices has no row for ${model} on ${day}; a run does not spend without a price`); this.name = "NoPrice"; this.code = "NO_PRICE"; }
}

const num = (v) => (v === null || v === undefined ? null : Number(v));
const day = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** model_prices rows as the database returns them, with numbers as numbers. */
export function normalisePrices(rows) {
  return (rows ?? []).map((r) => ({
    model: String(r.model), effective_from: String(r.effective_from).slice(0, 10),
    input_usd_per_mtok: Number(r.input_usd_per_mtok), output_usd_per_mtok: Number(r.output_usd_per_mtok),
    long_context_above_tokens: num(r.long_context_above_tokens), long_input_usd_per_mtok: num(r.long_input_usd_per_mtok),
    long_output_usd_per_mtok: num(r.long_output_usd_per_mtok), cache_read_usd_per_mtok: num(r.cache_read_usd_per_mtok),
    cache_write_usd_per_mtok: num(r.cache_write_usd_per_mtok),
  }));
}

/** The price row in force for a model on a day: the latest effective_from not after it. Null: no price. */
export function priceFor(rows, model, onDay) {
  return rows.filter((r) => r.model === model && r.effective_from <= onDay).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
}

/** The counts of one API response's usage object. */
export function usageOf(u) {
  return { input: u?.input_tokens ?? 0, output: u?.output_tokens ?? 0, cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0, searches: u?.server_tool_use?.web_search_requests ?? 0 };
}

/** USD of one call, as agent_run_costs (0102) prices a turn. Web searches are priced separately (webSearchUsd each). */
export function costOfCall(p, u, webSearchUsd = 0) {
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  const long = p.long_context_above_tokens !== null && prompt > p.long_context_above_tokens;
  const inRate = long ? p.long_input_usd_per_mtok ?? p.input_usd_per_mtok : p.input_usd_per_mtok;
  const outRate = long ? p.long_output_usd_per_mtok ?? p.output_usd_per_mtok : p.output_usd_per_mtok;
  const readRate = p.cache_read_usd_per_mtok ?? (long ? p.long_input_usd_per_mtok : null) ?? p.input_usd_per_mtok;
  const writeRate = p.cache_write_usd_per_mtok ?? (long ? p.long_input_usd_per_mtok : null) ?? p.input_usd_per_mtok;
  return (u.input * inRate + u.output * outRate + u.cacheRead * readRate + u.cacheWrite * writeRate) / 1e6 + (u.searches ?? 0) * webSearchUsd;
}

/** A cap from a workflow input: a positive number, else the safe default. */
export function parseCap(value, fallback) {
  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  return value !== undefined && value !== null && String(value).trim() !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}

export class CostMeter {
  /** opts: { workflow, runId, capUsd, prices (normalised rows), prior? (USD this run spent in earlier processes), webSearchUsd?, enforce? (default true), step?, day?, log? } */
  constructor(opts) {
    this.workflow = opts.workflow; this.runId = opts.runId; this.capUsd = opts.capUsd; this.prices = opts.prices;
    this.webSearchUsd = opts.webSearchUsd ?? 0; this.enforce = opts.enforce !== false; this.step = opts.step ?? "";
    this.day = opts.day ?? day(); this.log = opts.log ?? ((s) => console.log(s));
    this.prior = opts.prior ?? 0; this.byKey = new Map(); this.spent = 0; this.calls = 0; this.refused = 0; this.stoppedAtCap = false; this.finished = false;
  }
  /** True once the total has reached the cap: a loop over items stops starting new ones. */
  get capReached() { return this.enforce && Number.isFinite(this.capUsd) && this.prior + this.spent >= this.capUsd; }
  /** Null when a call to `model` may go ahead; otherwise the error that refuses it. */
  refusal(model) {
    if (this.capReached) { this.stoppedAtCap = true; this.refused++; return new CostCapReached(this.prior + this.spent, this.capUsd); }
    if (model && !priceFor(this.prices, model, this.day)) { this.refused++; return new NoPrice(model, this.day); }
    return null;
  }
  /** Counts one call. Returns its USD. A model with no price is counted at 0 and the line is marked unpriced. */
  add(model, usage, step = this.step) {
    const p = priceFor(this.prices, model, this.day);
    const usd = p ? costOfCall(p, usage, this.webSearchUsd) : 0;
    const key = `${model}\u0000${step}`;
    const l = this.byKey.get(key) ?? { model, step, calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, web_searches: 0, usd: 0, priced: !!p };
    l.calls++; l.input_tokens += usage.input; l.output_tokens += usage.output; l.cache_read_tokens += usage.cacheRead;
    l.cache_write_tokens += usage.cacheWrite; l.web_searches += usage.searches ?? 0; l.usd += usd; l.priced &&= !!p;
    this.byKey.set(key, l); this.spent += usd; this.calls++;
    return usd;
  }
  /** Adds a line whole, for a run whose calls were counted elsewhere (sim-test's budget): { model, step, calls, ...tokens, usd }. */
  addLine(line) {
    const key = `${line.model}\u0000${line.step ?? ""}`;
    const l = this.byKey.get(key) ?? { model: line.model, step: line.step ?? "", calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, web_searches: 0, usd: 0, priced: true };
    for (const k of ["calls", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "web_searches", "usd"]) l[k] += Number(line[k] ?? 0);
    this.byKey.set(key, l); this.spent += Number(line.usd ?? 0); this.calls += Number(line.calls ?? 0);
  }
  lines() { return [...this.byKey.values()].map((l) => ({ ...l, usd: Number(l.usd.toFixed(6)) })); }
  summaryLines() {
    const cap = Number.isFinite(this.capUsd) ? `USD ${this.capUsd}` : "none";
    const out = [`### Model cost, ${this.workflow}, run ${this.runId}`,
      `- **total: USD ${this.spent.toFixed(4)}** over ${this.calls} model calls (cap ${cap}${this.prior ? `, for the whole run; USD ${this.prior.toFixed(4)} was spent by its earlier steps` : ""})${this.stoppedAtCap ? `; **STOPPED AT THE CAP: ${this.refused} further calls refused, the results are incomplete**` : ""}`];
    if (this.lines().some((l) => !l.priced)) out.push("- **a model had no price row: its calls are counted at 0 and the figure is too low**");
    if (this.byKey.size) {
      out.push("", "| model | step | calls | input | output | cache read | cache write | USD |", "|---|---|---|---|---|---|---|---|");
      for (const l of this.lines()) out.push(`| ${l.model} | ${l.step || "-"} | ${l.calls} | ${l.input_tokens} | ${l.output_tokens} | ${l.cache_read_tokens} | ${l.cache_write_tokens} | ${l.usd.toFixed(4)} |`);
    }
    return [...out, ""];
  }
  /** The record of the run, as record-model-cost.mjs reads it. */
  toRecord() { return { workflow: this.workflow, run_id: this.runId, cap_usd: Number.isFinite(this.capUsd) ? this.capUsd : null, stopped_at_cap: this.stoppedAtCap, lines: this.lines() }; }
}

const refusalResponse = (err) => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: err.message } }),
  { status: 400, headers: { "content-type": "application/json", "x-cost-guard": err.code } });

const isMessages = (input) => {
  try { const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input?.url); return u.hostname === ANTHROPIC_HOST && u.pathname.startsWith("/v1/messages"); }
  catch { return false; }
};
const modelOfBody = (body) => { try { return typeof body === "string" ? JSON.parse(body).model ?? null : null; } catch { return null; } };

/** Wraps globalThis.fetch so every Anthropic messages call is checked before it and counted after it. Returns the undo. */
export function installFetchMeter(meter, g = globalThis) {
  const upstream = g.fetch;
  g.fetch = async (input, init) => {
    if (!isMessages(input)) return upstream(input, init);
    const model = modelOfBody(init?.body);
    const refused = meter.refusal(model);
    if (refused) { meter.log(`[cost] ${refused.message}`); return refusalResponse(refused); }
    const res = await upstream(input, init);
    if (res.ok) {
      try { const out = await res.clone().json(); if (out?.usage) meter.add(model ?? out.model, usageOf(out.usage)); } catch { /* an unreadable body has no usage to count */ }
    }
    return res;
  };
  return () => { g.fetch = upstream; };
}

// ---- the database side (service key, PostgREST; the original fetch, so these calls are never counted or refused) ----
async function rest(conn, path, init = {}) {
  const res = await (conn.fetchImpl ?? rawFetch)(`${conn.url}/rest/v1/${path}`, { ...init, headers: { apikey: conn.key, authorization: `Bearer ${conn.key}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path.split("?")[0]} ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** The price rows in force today (model_prices_in_force, 0139). */
export async function loadPrices(conn) { return normalisePrices(await rest(conn, "rpc/model_prices_in_force", { method: "POST", body: "{}" })); }

/** What the run has already recorded from its earlier steps (a run's cap is for the whole run, across its processes). */
export async function priorSpend(conn, workflow, runId) {
  const rows = await rest(conn, `model_costs?workflow=eq.${encodeURIComponent(workflow)}&run_id=eq.${encodeURIComponent(runId)}&select=usd`);
  return (rows ?? []).reduce((t, r) => t + Number(r.usd), 0);
}

/** Writes the run's rows (record_model_cost, 0139). */
export async function recordRun(conn, record) {
  return rest(conn, "rpc/record_model_cost", { method: "POST", body: JSON.stringify({ p_workflow: record.workflow, p_run_id: record.run_id, p_cap_usd: record.cap_usd, p_stopped: record.stopped_at_cap, p_lines: record.lines }) });
}

/**
 * Starts a meter for a script. Needs SUPABASE_URL and SUPABASE_SERVICE_KEY (the prices are read from model_prices).
 * opts: { workflow, capDefault, env?, step?, enforce?, install? (default true), runId?, capUsd? (overrides the input), prices?, conn? }
 * The cap is MODEL_COST_CAP_USD when it is a positive number, else capDefault. The step is MODEL_COST_STEP when set.
 */
export async function startMeter(opts) {
  const env = opts.env ?? process.env;
  const conn = opts.conn ?? { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_KEY };
  if (!opts.prices && (!conn.url || !conn.key)) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are needed to read model_prices");
  const prices = opts.prices ?? await loadPrices(conn);
  const capUsd = opts.capUsd ?? parseCap(env.MODEL_COST_CAP_USD, opts.capDefault);
  if (!(capUsd >= 0)) throw new Error("a model-calling run needs a dollar cap (capDefault)");
  const runId = opts.runId ?? env.MODEL_COST_RUN_ID ?? env.RUN_ID ?? env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
  const prior = opts.prior ?? (opts.prices ? 0 : await priorSpend(conn, opts.workflow, runId));
  const meter = new CostMeter({ workflow: opts.workflow, runId, capUsd, prices, prior,
    webSearchUsd: opts.webSearchUsd, enforce: opts.enforce, step: opts.step ?? env.MODEL_COST_STEP ?? "", log: opts.log });
  meter.conn = conn;
  meter.log(`[cost] ${meter.workflow}: cap USD ${capUsd}${env.MODEL_COST_CAP_USD && capUsd !== Number(env.MODEL_COST_CAP_USD) ? ` (the input "${env.MODEL_COST_CAP_USD}" is not a positive number: the default was used)` : ""}`);
  if (opts.install !== false) meter.uninstall = installFetchMeter(meter);
  return meter;
}

/**
 * Ends a run: prints the total, adds it to the job summary, and records the rows. Safe to call twice. Sets process.exitCode = 1
 * when the rows could not be written. Never throws.
 */
export async function finishMeter(meter, opts = {}) {
  if (meter.finished) return meter;
  meter.finished = true;
  const env = opts.env ?? process.env;
  meter.uninstall?.();
  const text = meter.summaryLines().join("\n");
  console.log(text);
  if (env.GITHUB_STEP_SUMMARY) { try { appendFileSync(env.GITHUB_STEP_SUMMARY, text + "\n"); } catch { /* the console has it */ } }
  if (meter.stoppedAtCap && env.GITHUB_ACTIONS) console.log(`::warning::${meter.workflow} stopped at its cost cap (USD ${meter.capUsd}); its results are incomplete`);
  const record = { ...meter.toRecord(), ...(opts.override ?? {}) };
  const out = opts.out ?? env.MODEL_COST_OUT;
  if (out) { try { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(record, null, 1) + "\n"); } catch { /* best effort */ } }
  if (!record.lines.length) return meter;
  try { await recordRun(opts.conn ?? meter.conn, record); console.log(`[cost] recorded ${record.lines.length} line(s) for ${record.workflow} run ${record.run_id}`); }
  catch (e) {
    console.log(`::error::the cost of ${record.workflow} run ${record.run_id} (USD ${meter.spent.toFixed(4)}) could not be recorded: ${String(e.message).slice(0, 200)}`);
    console.log(JSON.stringify(record));
    process.exitCode = 1;
  }
  return meter;
}

/** For a script that is top-level code: records the run when the process ends, normally or by an uncaught error. */
export function autoFinish(meter) {
  const done = async (code) => { await finishMeter(meter); if (code) process.exit(code); };
  process.once("beforeExit", () => { void finishMeter(meter); });
  process.once("uncaughtException", (e) => { console.error(e?.stack ?? e); void done(1); });
  process.once("unhandledRejection", (e) => { console.error(e?.stack ?? e); void done(1); });
  return meter;
}

/**
 * Runs `fn(meter)` between startMeter and finishMeter. A run that cannot read its prices does not start (exit 1): an unknown
 * price is never counted as free. Scripts end with process.exitCode = 1, not process.exit(1), so the rows are written first.
 */
export async function runMetered(opts, fn) {
  let meter;
  try { meter = await startMeter(opts); }
  catch (e) { console.error(`::error::no model call is made: ${e.message}`); process.exit(1); }
  try { return await fn(meter); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await finishMeter(meter); }
}

/** Records a run whose cost another program already counted: a JSON file { workflow, run_id, cap_usd, stopped_at_cap, lines }. */
export async function recordFile(path, env = process.env) {
  const r = JSON.parse(readFileSync(path, "utf8"));
  const conn = { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_KEY };
  if (!conn.url || !conn.key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are needed");
  const meter = new CostMeter({ workflow: r.workflow, runId: env.RUN_ID ?? r.run_id, capUsd: r.cap_usd ?? Infinity, prices: [], enforce: false });
  for (const l of r.lines ?? []) meter.addLine(l);
  meter.stoppedAtCap = !!r.stopped_at_cap; meter.conn = conn;
  return finishMeter(meter, { env, conn });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv[2]) {
  recordFile(process.argv[2]).catch((e) => { console.error(e.message); process.exit(1); });
}
