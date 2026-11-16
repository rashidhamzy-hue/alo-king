// LB1 (16 November), the test budget in code: sim-test refuses to start when this month's sim-test spend plus its own budget would
// pass the setting sim_monthly_cap_usd (60 for November 2026, 20 a month after); it says why in the run summary; its limit input
// defaults to 50; intake runs by hand only. No key, no network: staging is a fake fetch.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain .mjs
import { capFor, decide, monthOf, readInputs, run } from "../../scripts/ci/sim-ceiling.mjs";

const read = (f: string) => readFileSync(fileURLToPath(new URL(`../../${f}`, import.meta.url)), "utf8");
const code = (f: string) => read(f).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const SETTING = { default_usd: 20, months: { "2026-11": 60 } };

describe("the ceiling decision", () => {
  it("November 2026 is 60, any other month is the default 20", () => {
    expect(capFor(SETTING, "2026-11")).toBe(60);
    expect(capFor(SETTING, "2026-12")).toBe(20);
    expect(capFor(SETTING, "2027-01")).toBe(20);
  });
  it("the month is the Beirut month of the day", () => {
    expect(monthOf(new Date("2026-11-30T22:30:00Z"))).toBe("2026-12");   // 00:30 on 1 December in Beirut
    expect(monthOf(new Date("2026-11-16T10:00:00Z"))).toBe("2026-11");
  });
  it("starts when spend plus the run's budget is at or under the cap", () => {
    const d = decide({ setting: SETTING, month: "2026-11", spentUsd: 43, budgetUsd: 17 });
    expect(d.ok).toBe(true);
    expect(d.cap).toBe(60);
  });
  it("refuses above the cap and says why, with the figures", () => {
    const d = decide({ setting: SETTING, month: "2026-11", spentUsd: 43, budgetUsd: 17.01 });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/sim_monthly_cap_usd/);
    expect(d.reason).toMatch(/2026-11/);
    expect(d.reason).toMatch(/43\.00/);
    expect(d.reason).toMatch(/17\.01/);
    expect(d.reason).toMatch(/60\.00/);
  });
  it("December has the default 20: a USD 4 run after USD 17 is refused", () => {
    expect(decide({ setting: SETTING, month: "2026-12", spentUsd: 17, budgetUsd: 4 }).ok).toBe(false);
    expect(decide({ setting: SETTING, month: "2026-12", spentUsd: 16, budgetUsd: 4 }).ok).toBe(true);
  });
  it("fails closed: no setting, a bad setting, an unreadable spend, a bad budget", () => {
    expect(decide({ setting: null, month: "2026-11", spentUsd: 0, budgetUsd: 4 }).ok).toBe(false);
    expect(decide({ setting: { default_usd: "lots" }, month: "2026-11", spentUsd: 0, budgetUsd: 4 }).ok).toBe(false);
    expect(decide({ setting: SETTING, month: "2026-11", spentUsd: null, budgetUsd: 4 }).ok).toBe(false);
    expect(decide({ setting: SETTING, month: "2026-11", spentUsd: 0, budgetUsd: Number.NaN }).ok).toBe(false);
    expect(decide({ setting: SETTING, month: "2026-11", spentUsd: 0, budgetUsd: 0 }).ok).toBe(false);
  });
});

/** A fake staging: PostgREST GETs for the setting and the month's model_costs rows. */
function fakeStaging(opts: { setting?: unknown; costs?: { usd: string }[]; status?: number }) {
  const seen: { url: string; method: string }[] = [];
  const f = async (url: string, init?: { method?: string }) => {
    seen.push({ url, method: init?.method ?? "GET" });
    if (opts.status) return new Response("nope", { status: opts.status });
    if (url.includes("/settings")) return new Response(JSON.stringify(opts.setting === undefined ? [] : [{ value: opts.setting }]));
    if (url.includes("/model_costs")) return new Response(JSON.stringify(opts.costs ?? []));
    return new Response("[]", { status: 404 });
  };
  return { f, seen };
}

describe("reading staging and the whole run", () => {
  it("sums only this month's sim-test rows, with GET only", async () => {
    const st = fakeStaging({ setting: SETTING, costs: [{ usd: "3.470000" }, { usd: "3.47" }, { usd: "20.1" }] });
    const input = await readInputs({ url: "https://x.supabase.co", key: "k", fetch: st.f, now: new Date("2026-11-16T10:00:00Z") });
    expect(input.spentUsd).toBeCloseTo(27.04, 6);
    expect(input.setting).toEqual(SETTING);
    expect(st.seen.every((r) => r.method === "GET")).toBe(true);
    const costsUrl = st.seen.find((r) => r.url.includes("/model_costs"))!.url;
    expect(costsUrl).toMatch(/workflow=eq\.sim-test/);
    expect(costsUrl).toMatch(/day=gte\.2026-11-01/);
    expect(costsUrl).toMatch(/day=lt\.2026-12-01/);
  });
  it("run() writes the reason to the summary and returns 1 when over; 0 when under; never prints the key", async () => {
    const over = fakeStaging({ setting: SETTING, costs: [{ usd: "58" }] });
    const out: string[] = []; const summary: string[] = [];
    const rc = await run({ env: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "secret-key", SIM_BUDGET_USD: "4" }, fetch: over.f,
      now: new Date("2026-11-16T10:00:00Z"), log: (s: string) => out.push(s), summary: (s: string) => summary.push(s) });
    expect(rc).toBe(1);
    expect(summary.join("\n")).toMatch(/refused/i);
    expect(summary.join("\n")).toMatch(/sim_monthly_cap_usd/);
    expect([...out, ...summary].join("\n")).not.toContain("secret-key");
    const under = fakeStaging({ setting: SETTING, costs: [{ usd: "10" }] });
    const rc2 = await run({ env: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k", SIM_BUDGET_USD: "4" }, fetch: under.f,
      now: new Date("2026-11-16T10:00:00Z"), log: () => {}, summary: (s: string) => summary.push(s) });
    expect(rc2).toBe(0);
  });
  it("no budget_usd means the hard limit the run would have (33)", async () => {
    const st = fakeStaging({ setting: SETTING, costs: [{ usd: "28" }] });
    const summary: string[] = [];
    const rc = await run({ env: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k", SIM_BUDGET_USD: "" }, fetch: st.f,
      now: new Date("2026-11-16T10:00:00Z"), log: () => {}, summary: (s: string) => summary.push(s) });
    expect(rc).toBe(1);                       // 28 + 33 > 60
    expect(summary.join("\n")).toMatch(/33\.00/);
  });
  it("fails closed when staging cannot be read", async () => {
    const st = fakeStaging({ status: 401 });
    const summary: string[] = [];
    const rc = await run({ env: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k", SIM_BUDGET_USD: "4" }, fetch: st.f,
      now: new Date("2026-11-16T10:00:00Z"), log: () => {}, summary: (s: string) => summary.push(s) });
    expect(rc).toBe(1);
    expect(summary.join("\n")).toMatch(/could not read/i);
  });
  it("fails closed when the setting row is missing", async () => {
    const st = fakeStaging({ costs: [] });
    const rc = await run({ env: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k", SIM_BUDGET_USD: "4" }, fetch: st.f,
      now: new Date("2026-11-16T10:00:00Z"), log: () => {}, summary: () => {} });
    expect(rc).toBe(1);
  });
});

describe("the workflows", () => {
  const sim = code(".github/workflows/sim-test.yml");
  it("sim-test checks the ceiling before it simulates, with the staging secrets, and its limit defaults to 50", () => {
    expect(sim).toMatch(/node scripts\/ci\/sim-ceiling\.mjs/);
    expect(sim.indexOf("sim-ceiling.mjs")).toBeLessThan(sim.indexOf("npx vitest run evals/sim/sim.live.test.ts"));
    expect(sim.indexOf("sim-ceiling.mjs")).toBeLessThan(sim.indexOf("npm ci"));      // refused before anything is installed
    expect(sim).toMatch(/limit:\n\s+description:[^\n]*\n\s+type: string\n\s+default: "50"/);
    const step = sim.slice(sim.indexOf("sim-ceiling.mjs") - 400, sim.indexOf("sim-ceiling.mjs") + 200);
    expect(step).toContain("SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}");
    expect(step).toContain("SIM_BUDGET_USD: ${{ inputs.budget_usd }}");
  });
  it("intake has no schedule: workflow_dispatch only", () => {
    const intake = code(".github/workflows/intake.yml");
    expect(intake).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(intake).not.toMatch(/schedule:|cron:/);
    expect(intake).toContain("REUSE: ${{ inputs.reuse_research_files }}");
  });
  it("the comment at the top of intake.yml no longer promises a schedule", () => {
    expect(read(".github/workflows/intake.yml")).not.toMatch(/Every two hours/);
  });
});
