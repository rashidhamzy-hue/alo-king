// Session COST1: every workflow and script that calls a model counts its tokens and dollars and stops at a dollar cap.
// Here: the meter itself (a run stops at its cap; an unpriced model is refused; prices are the model_prices rows), and the wiring
// (every model-calling entry point is metered, every such workflow takes a cap with a safe default). The table is tested in
// test/db/model-cost-cost1.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CostMeter, costOfCall, finishMeter, installFetchMeter, parseCap, priceFor, startMeter, usageOf, type PriceRow } from "../../scripts/lib/model-cost.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (f: string) => readFileSync(root + f, "utf8");

const HAIKU: PriceRow = { model: "claude-haiku-5-5", effective_from: "2026-11-14", input_usd_per_mtok: 0.1, output_usd_per_mtok: 0.5, long_context_above_tokens: 100000,
  long_input_usd_per_mtok: 0.5, long_output_usd_per_mtok: 2.5, cache_read_usd_per_mtok: 0.01, cache_write_usd_per_mtok: 0.125 };
const SONNET: PriceRow = { model: "claude-sonnet-5-5", effective_from: "2026-11-14", input_usd_per_mtok: 2, output_usd_per_mtok: 10, long_context_above_tokens: null,
  long_input_usd_per_mtok: null, long_output_usd_per_mtok: null, cache_read_usd_per_mtok: 0.1, cache_write_usd_per_mtok: 2.5 };
const prices = [HAIKU, SONNET];

/** A fake of the Messages API: answers every call with the usage it is told to, and counts the calls that reach it. */
function fakeApi(usage: Record<string, number>) {
  const seen: { url: string; model: string | null }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push({ url, model: (() => { try { return JSON.parse(String(init?.body)).model; } catch { return null; } })() });
    return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, seen };
}
const quiet = () => {};

describe("pricing: the rule of agent_run_costs (0092, 0102), from the model_prices rows", () => {
  it("prices input, output and cached tokens at their own rates", () => {
    // 1,000 in (0.0001) + 200 out (0.0001) + 5,000 cache read (0.00005) + 2,000 cache write (0.00025)
    expect(costOfCall(HAIKU, { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 2000 })).toBeCloseTo(0.0005, 8);
  });
  it("uses the long-context rate when the whole prompt is above the threshold", () => {
    expect(costOfCall(HAIKU, { input: 50_000, output: 0, cacheRead: 60_000, cacheWrite: 0 })).toBeCloseTo(50_000 * 0.5 / 1e6 + 60_000 * 0.01 / 1e6, 8);
  });
  it("a model without a cache price counts cached tokens as input (an upper bound)", () => {
    expect(costOfCall({ ...SONNET, cache_read_usd_per_mtok: null, cache_write_usd_per_mtok: null }, { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 })).toBeCloseTo(2, 8);
  });
  it("the price in force is the latest row not after the day", () => {
    const later = { ...HAIKU, effective_from: "2026-12-01", input_usd_per_mtok: 9 };
    expect(priceFor([HAIKU, later], "claude-haiku-5-5", "2026-11-20")!.input_usd_per_mtok).toBe(0.1);
    expect(priceFor([HAIKU, later], "claude-haiku-5-5", "2026-12-01")!.input_usd_per_mtok).toBe(9);
    expect(priceFor([HAIKU], "claude-unknown", "2026-11-20")).toBeNull();
  });
  it("reads the API's usage object, web searches included", () => {
    expect(usageOf({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, server_tool_use: { web_search_requests: 5 } }))
      .toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, searches: 5 });
    expect(usageOf(undefined)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0 });
  });
});

describe("the cap: a run stops making model calls when it passes its dollar cap", () => {
  it("counts every call, then refuses before the next one is made", async () => {
    const api = fakeApi({ input_tokens: 100_000, output_tokens: 0 });            // 100,000 input on Haiku = USD 0.01 a call
    const meter = new CostMeter({ workflow: "test", runId: "t1", capUsd: 0.025, prices, log: quiet });
    const g = { fetch: api.f };
    const undo = installFetchMeter(meter, g);
    const body = JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 10, messages: [] });
    const call = () => g.fetch("https://api.anthropic.com/v1/messages", { method: "POST", body });
    for (let i = 0; i < 3; i++) expect((await call()).status).toBe(200);        // 0.01, 0.02, 0.03: the cap (0.025) is passed by the third
    expect(meter.spent).toBeCloseTo(0.03, 8);
    expect(meter.capReached).toBe(true);
    const refused = await call();
    expect(refused.status).toBe(400);
    expect((await refused.json()).error.message).toMatch(/COST_CAP/);
    expect(api.seen).toHaveLength(3);                                            // the fourth never left the process
    expect(meter.stoppedAtCap).toBe(true);
    expect(meter.refused).toBe(1);
    undo();
  });

  it("stops the real SDK the same way, and does not retry the refusal", async () => {
    const api = fakeApi({ input_tokens: 1_000_000, output_tokens: 0 });          // USD 0.10 a call
    const meter = new CostMeter({ workflow: "test", runId: "t2", capUsd: 0.05, prices, log: quiet });
    const g = { fetch: api.f };
    installFetchMeter(meter, g);
    const client = new Anthropic({ apiKey: "k", fetch: g.fetch, maxRetries: 5 });
    const ask = () => client.messages.create({ model: "claude-haiku-5-5", max_tokens: 5, messages: [{ role: "user", content: "x" }] });
    await ask();                                                                 // spends 0.10, past the 0.05 cap
    await expect(ask()).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    await expect(ask()).rejects.toThrow(/COST_CAP/);
    expect(api.seen).toHaveLength(1);                                            // one call reached the API; the refusals were not retried into it
  });

  it("refuses a model with no price row instead of counting it as free", async () => {
    const api = fakeApi({ input_tokens: 10, output_tokens: 10 });
    const meter = new CostMeter({ workflow: "test", runId: "t3", capUsd: 100, prices, log: quiet });
    const g = { fetch: api.f };
    installFetchMeter(meter, g);
    const res = await g.fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ model: "claude-not-priced-1" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/NO_PRICE/);
    expect(api.seen).toHaveLength(0);
  });

  it("counts only Anthropic message calls; other requests pass through untouched", async () => {
    const api = fakeApi({ input_tokens: 5, output_tokens: 5 });
    const meter = new CostMeter({ workflow: "test", runId: "t4", capUsd: 0.0000001, prices, log: quiet });
    const g = { fetch: api.f };
    installFetchMeter(meter, g);
    expect((await g.fetch("https://world.openfoodfacts.org/api/v2/product/1")).status).toBe(200);
    expect((await g.fetch("https://example.supabase.co/rest/v1/rpc/x", { method: "POST", body: "{}" })).status).toBe(200);
    expect(meter.calls).toBe(0);
    expect(api.seen).toHaveLength(2);
  });

  it("a failed call has no usage and costs nothing", async () => {
    const meter = new CostMeter({ workflow: "test", runId: "t5", capUsd: 1, prices, log: quiet });
    const g = { fetch: (async () => new Response("{}", { status: 529 })) as unknown as typeof fetch };
    installFetchMeter(meter, g);
    await g.fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ model: "claude-haiku-5-5" }) });
    expect(meter.spent).toBe(0);
  });

  it("the cap is for the whole run: what its earlier steps spent counts", async () => {
    const api = fakeApi({ input_tokens: 10, output_tokens: 10 });
    const meter = new CostMeter({ workflow: "test", runId: "t6", capUsd: 1, prior: 1.5, prices, log: quiet });
    const g = { fetch: api.f };
    installFetchMeter(meter, g);
    const res = await g.fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ model: "claude-haiku-5-5" }) });
    expect(res.status).toBe(400);
    expect(api.seen).toHaveLength(0);
  });

  it("a meter that only records (intake, which stops between jobs itself) never refuses a call", async () => {
    const api = fakeApi({ input_tokens: 100_000, output_tokens: 0 });                // USD 0.01 a call
    const meter = new CostMeter({ workflow: "intake", runId: "t7", capUsd: 0.01, enforce: false, prices, log: quiet });
    const g = { fetch: api.f };
    installFetchMeter(meter, g);
    for (let i = 0; i < 3; i++) expect((await g.fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ model: "claude-haiku-5-5" }) })).status).toBe(200);
    expect(meter.spent).toBeCloseTo(0.03, 8);
    expect(meter.capReached).toBe(false);
  });

  it("a loop that stops starting work at the cap marks the run as stopped at its cap (live finding: language-pack, 15 Nov)", () => {
    const meter = new CostMeter({ workflow: "test", runId: "t8", capUsd: 0.005, prices, log: quiet });
    expect(meter.capStop()).toBe(false);
    expect(meter.stoppedAtCap).toBe(false);
    meter.add("claude-haiku-5-5", { input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0 });     // USD 0.01, past the cap
    expect(meter.capStop()).toBe(true);
    expect(meter.stoppedAtCap).toBe(true);
    expect(meter.toRecord().stopped_at_cap).toBe(true);
    // a run that reached the cap with its last call and had nothing left to start is not marked: no work was refused
    const done = new CostMeter({ workflow: "test", runId: "t9", capUsd: 0.005, prices, log: quiet });
    done.add("claude-haiku-5-5", { input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(done.toRecord().stopped_at_cap).toBe(false);
  });

  it("every item loop asks capStop(), so the record says so", () => {
    for (const f of ["scripts/images/fetch-images.mjs", "scripts/product-data/fetch-product-data.mjs", "scripts/product-data/load-research.mjs", "evals/language/live.lang.test.ts"]) {
      const s = read(f);
      expect(s, f).toMatch(/meter\.capStop\(\)/);
      expect(s, f).not.toMatch(/meter\.capReached/);
    }
  });

  it("a cap from a workflow input is a positive number; anything else is the safe default", () => {
    expect(parseCap("2.5", 3)).toBe(2.5);
    for (const bad of ["", "  ", "abc", "0", "-1", "NaN", undefined, null]) expect(parseCap(bad as any, 3)).toBe(3);
  });

  it("startMeter reads the prices and the earlier spend from the database, and refuses to start without prices", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(new URL(url).pathname);
      return new Response(JSON.stringify(url.includes("model_prices_in_force") ? [{ model: "claude-haiku-5-5", effective_from: "2026-11-14", input_usd_per_mtok: "0.1", output_usd_per_mtok: "0.5" }] : [{ usd: "0.4" }, { usd: "0.1" }]), { status: 200 });
    }) as unknown as typeof fetch;
    const meter = await startMeter({ workflow: "w", capDefault: 2, install: false, env: { MODEL_COST_CAP_USD: "junk", RUN_ID: "r9" }, conn: { url: "http://x", key: "k", fetchImpl }, log: quiet });
    expect(meter.capUsd).toBe(2);
    expect(meter.runId).toBe("r9");
    expect(meter.prior).toBeCloseTo(0.5, 8);
    expect(calls).toEqual(["/rest/v1/rpc/model_prices_in_force", "/rest/v1/model_costs"]);
    const broken = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(startMeter({ workflow: "w", capDefault: 2, install: false, env: {}, conn: { url: "http://x", key: "k", fetchImpl: broken }, log: quiet })).rejects.toThrow(/model_prices_in_force/);
  });
});

describe("the run summary and the record", () => {
  const prev = process.exitCode;
  afterEach(() => { process.exitCode = prev; });
  it("prints the total, by model and step, and says so when the run stopped at its cap", () => {
    const meter = new CostMeter({ workflow: "language-pack", runId: "9-1", capUsd: 0.005, prices, log: quiet });
    meter.add("claude-haiku-5-5", { input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0 }, "after");
    meter.refusal("claude-haiku-5-5");
    const text = meter.summaryLines().join("\n");
    expect(text).toMatch(/Model cost, language-pack, run 9-1/);
    expect(text).toMatch(/total: USD 0\.0100/);
    expect(text).toMatch(/cap USD 0\.005/);
    expect(text).toMatch(/STOPPED AT THE CAP/);
    expect(text).toMatch(/\| claude-haiku-5-5 \| after \| 1 \| 100000 \|/);
  });
  it("a record that cannot be written fails the run, and the lines are printed so the spend is not lost", async () => {
    const meter = new CostMeter({ workflow: "w", runId: "r", capUsd: 1, prices, log: quiet });
    meter.add("claude-haiku-5-5", { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 });
    const out: string[] = []; const orig = console.log; console.log = (s: string) => { out.push(String(s)); };
    try { await finishMeter(meter, { env: {}, conn: { url: "http://x", key: "k", fetchImpl: (async () => new Response("down", { status: 500 })) as unknown as typeof fetch } }); }
    finally { console.log = orig; }
    expect(process.exitCode).toBe(1);
    expect(out.join("\n")).toMatch(/could not be recorded/);
    expect(out.join("\n")).toMatch(/"workflow":"w"/);
  });
  it("a run that made no model call records nothing", async () => {
    const meter = new CostMeter({ workflow: "w", runId: "r", capUsd: 1, prices, log: quiet });
    let wrote = false;
    const orig = console.log; console.log = () => {};
    try { await finishMeter(meter, { env: {}, conn: { url: "http://x", key: "k", fetchImpl: (async () => { wrote = true; return new Response("1"); }) as unknown as typeof fetch } }); }
    finally { console.log = orig; }
    expect(wrote).toBe(false);
  });
});

// ---- the wiring: nothing that calls a model is left out ----
const walk = (dir: string): string[] => readdirSync(root + dir).flatMap((n) => {
  if (n === "node_modules" || n === "results") return [];
  const p = join(dir, n);
  return statSync(root + p).isDirectory() ? walk(p) : [p];
});

describe("every model-calling entry point is metered", () => {
  const metered: [string, RegExp][] = [
    ["scripts/product-data/fetch-product-data.mjs", /runMetered\(\{ workflow: "product-data"/],
    ["scripts/product-data/propose-catalog.mjs", /runMetered\(\{ workflow: "product-data"/],
    ["scripts/product-data/load-research.mjs", /runMetered\(\{ workflow: "research-load"/],
    ["scripts/images/fetch-images.mjs", /runMetered\(\{ workflow: "images"/],
    ["scripts/intake/run.mjs", /startMeter\(\{ workflow: "intake"/],
    ["evals/language/gen-pack.mjs", /startMeter\(\{ workflow: "language-pack"/],
    ["evals/language/gen-cases.mjs", /startMeter\(\{ workflow: "language-pack"/],
    ["evals/language/live.lang.test.ts", /startMeter\(\{ workflow: "language-pack"/],
    ["evals/live/concierge.live.test.ts", /startMeter\(\{ workflow: "language-pack"/],
  ];
  for (const [file, re] of metered) it(`${file} starts a meter and records the run`, () => {
    const s = read(file);
    expect(s).toMatch(re);
    expect(s).toMatch(/model-cost\.mjs/);
    expect(s).toMatch(/finishMeter|runMetered|autoFinish/);
  });

  it("the meter starts before the first client is built (the SDK takes fetch when it is constructed)", () => {
    for (const f of ["evals/language/gen-pack.mjs", "evals/language/gen-cases.mjs"]) { const s = read(f); expect(s.indexOf("startMeter(")).toBeGreaterThan(0); expect(s.indexOf("startMeter(")).toBeLessThan(s.indexOf("new Anthropic(")); }
    const s = read("evals/live/concierge.live.test.ts"); expect(s.indexOf("startMeter(")).toBeLessThan(s.indexOf("new Anthropic("));
    const i = read("scripts/intake/run.mjs"); expect(i.indexOf("startMeter(")).toBeLessThan(i.indexOf("new Anthropic("));
  });

  it("sim-test's own budget is written as model_costs rows, and the workflow records them", () => {
    expect(read("evals/sim/run.ts")).toMatch(/model-cost\.json/);
    expect(read("evals/sim/budget.ts")).toMatch(/costLines\(\)/);
    const w = read(".github/workflows/sim-test.yml");
    expect(w).toMatch(/node scripts\/lib\/model-cost\.mjs out\/sim\/model-cost\.json/);
    expect(w).toMatch(/budget_usd:/);                       // one dollar limit: SIM1's input is the cap, there is no second one
    expect(w).not.toMatch(/max_usd/);
    expect(w).toMatch(/SIM_BUDGET_USD: \$\{\{ inputs\.budget_usd \}\}/);
  });

  it("no other script or eval calls the Messages API without being on this list or being a library of a metered entry point", () => {
    const libraries = new Set([
      "scripts/images/lib/vision.mjs", "scripts/intake/lib/research.mjs", "scripts/product-data/lib/anthropic.mjs",   // called only from the entry points above
      "scripts/lib/model-cost.mjs",
      "scripts/ci/check-anthropic.sh",                                                                                  // the deploy self-test: see the next test
      "evals/run.ts", "evals/test/extract-contract.test.ts", "evals/test/neutral-cases.test.ts",                         // helpers and fakes used by the metered live evals
      "evals/sim/budget.ts", "evals/sim/call.ts", "evals/sim/customer.ts", "evals/sim/metered.ts", "evals/sim/mock.ts",  // the sim's own metering (budget.ts), which the next lines record
      "evals/sim/sim.live.test.ts", "evals/sim/test/guard.test.ts",
    ]);
    const entries = new Set(metered.map(([f]) => f));
    const callers = [...walk("scripts"), ...walk("evals")].filter((f) => /\.(mjs|ts|sh|js)$/.test(f)).filter((f) => /api\.anthropic\.com|@anthropic-ai\/sdk|messages\.create/.test(read(f)));
    const unlisted = callers.filter((f) => !entries.has(f) && !libraries.has(f));
    expect(unlisted, `these call a model but are not metered (COST1): ${unlisted.join(", ")}`).toEqual([]);
  });

  it("the deploy self-test makes exactly two 5-token calls, so its cost is bounded without a meter", () => {
    const s = read("scripts/ci/check-anthropic.sh");
    expect(s.match(/max_tokens: 5/g)).toHaveLength(1);
    expect(s).toMatch(/for model in "\$MODEL_FAST" "\$MODEL_SMART"; do/);
  });
});

describe("every workflow that spends on a model has a dollar cap with a safe default", () => {
  const caps: [string, RegExp][] = [
    [".github/workflows/product-data.yml", /MODEL_COST_CAP_USD: \$\{\{ inputs\.max_usd \|\| '3' \}\}/],
    [".github/workflows/research-load.yml", /MODEL_COST_CAP_USD: \$\{\{ inputs\.max_usd \|\| '2' \}\}/],
    [".github/workflows/images.yml", /MODEL_COST_CAP_USD: \$\{\{ inputs\.max_usd \|\| '2' \}\}/],
    [".github/workflows/language-pack.yml", /MODEL_COST_CAP_USD: \$\{\{ inputs\.max_usd \|\| '5' \}\}/],
  ];
  for (const [file, re] of caps) it(`${file}: cap input, default, and a run id per attempt`, () => {
    const w = read(file);
    expect(w).toMatch(/max_usd:\s*\n\s+description:[^\n]*\n\s+type: string\n\s+default: "\d+"|max_usd: \{ description: "[^"]*", type: string, default: "\d+" \}/);
    expect(w).toMatch(re);
    expect(w).toMatch(/MODEL_COST_RUN_ID: \$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  });
  it("intake keeps its own cap input (at most 0.75) and records the run", () => {
    const w = read(".github/workflows/intake.yml");
    expect(w).toMatch(/max_spend_usd:/);
    expect(w).toMatch(/MAX_SPEND: \$\{\{ inputs\.max_spend_usd \|\| '0\.75' \}\}/);
  });
  it("language-pack runs one 'after' pass by default; 'before', other models, 'cases', 'pack' and 'live' only when asked", () => {
    const w = read(".github/workflows/language-pack.yml");
    expect(w).toMatch(/steps: \{ description: "[^"]*", type: string, default: "after" \}/);
    expect(w).not.toMatch(/default: "before,after"/);
    expect(w).toMatch(/if: contains\(steps\.what\.outputs\.steps, ',before,'\)/);
    expect(w).toMatch(/steps\.what\.outputs\.also != ''/);
    expect(w).toMatch(/scripts\/lib\/model-cost\.mjs scripts\/lib\/model-cost\.d\.mts \.\.\/main\/scripts\/lib\//);   // the "before" pass runs main's code with this meter
  });
});
