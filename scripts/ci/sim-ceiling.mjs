// LB1 (16 November 2026): the monthly ceiling on simulated customers. The sim-test workflow runs this before it installs or spends
// anything. It refuses (exit 1) when this month's sim-test spend in model_costs (migration 0139) plus the budget this run asks for
// would pass the setting sim_monthly_cap_usd, and it says why in the run summary.
//
// The setting (settings row `sim_monthly_cap_usd`, seeded by migration 0211): {"default_usd": 20, "months": {"2026-11": 60}}.
// A month in "months" has its own ceiling (60 for November 2026); any other month has default_usd (20).
// The run's budget is the workflow's budget_usd input; empty means the hard limit the run would have (33), as sim-test.yml says.
// Fail closed: a setting that is missing or not a number, a spend that cannot be read, a budget that is not a positive number: refused.
// Reads staging with GET only (PostgREST, the service key of product-data.yml); writes nothing; prints no key.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_BUDGET_USD = 33;   // sim-test.yml: "empty = 27 and 33, as before"; the hard limit is what the run may spend

/** The Beirut month (YYYY-MM) of a moment: model_costs.day is a Beirut date (0139). */
export const monthOf = (d = new Date()) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p.slice(0, 7);
};
const nextMonth = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };

/** The ceiling for a month, or null when the setting cannot give one. */
export function capFor(setting, month) {
  if (!setting || typeof setting !== "object") return null;
  const own = setting.months && typeof setting.months === "object" ? setting.months[month] : undefined;
  const v = own !== undefined ? own : setting.default_usd;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Pure. { ok, cap, spent, budget, month, reason }. */
export function decide({ setting, month, spentUsd, budgetUsd }) {
  const usd = (n) => Number(n).toFixed(2);
  const cap = capFor(setting, month);
  if (cap === null) return { ok: false, cap, month, reason: `the setting sim_monthly_cap_usd is missing or not a number of dollars for ${month}; sim-test does not start without its ceiling` };
  if (typeof spentUsd !== "number" || !Number.isFinite(spentUsd)) return { ok: false, cap, month, reason: `this month's sim-test spend in model_costs could not be read; sim-test does not start without it` };
  if (typeof budgetUsd !== "number" || !Number.isFinite(budgetUsd) || budgetUsd <= 0) return { ok: false, cap, month, reason: `budget_usd must be a positive number of dollars` };
  const total = spentUsd + budgetUsd;
  if (total > cap + 1e-9) {
    return { ok: false, cap, spent: spentUsd, budget: budgetUsd, month, reason:
      `refused: ${month} has already spent USD ${usd(spentUsd)} on sim-test and this run asks for USD ${usd(budgetUsd)}; together USD ${usd(total)} pass the ceiling sim_monthly_cap_usd of USD ${usd(cap)} for ${month}. ` +
      `Lower budget_usd, wait for next month, or have the coordinator change the setting (settings key sim_monthly_cap_usd).` };
  }
  return { ok: true, cap, spent: spentUsd, budget: budgetUsd, month, reason: `${month}: USD ${usd(spentUsd)} spent on sim-test, this run up to USD ${usd(budgetUsd)}, ceiling USD ${usd(cap)}` };
}

/** Reads the setting and this month's sim-test rows. A failure to read throws with a plain message (never the key). */
export async function readInputs({ url, key, fetch: f = globalThis.fetch, now = new Date() }) {
  const month = monthOf(now);
  const get = async (path) => {
    const res = await f(`${url}/rest/v1/${path}`, { method: "GET", headers: { apikey: key, authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`staging answered ${res.status} for ${path.split("?")[0]}`);
    return res.json();
  };
  const settings = await get("settings?key=eq.sim_monthly_cap_usd&select=value");
  const setting = Array.isArray(settings) && settings.length ? settings[0].value : null;
  const rows = await get(`model_costs?workflow=eq.sim-test&day=gte.${month}-01&day=lt.${nextMonth(month)}-01&select=usd`);
  if (!Array.isArray(rows)) throw new Error("model_costs did not answer with a list");
  return { month, setting, spentUsd: rows.reduce((a, r) => a + Number(r.usd), 0) };
}

/** The whole check. Returns the exit code; writes the decision to the log and the run summary. */
export async function run({ env = process.env, fetch: f = globalThis.fetch, now = new Date(), log = console.log, summary = () => {} } = {}) {
  const b = (env.SIM_BUDGET_USD ?? "").trim();
  const budgetUsd = b === "" ? DEFAULT_BUDGET_USD : Number(b);
  let d;
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are needed to read the ceiling");
    const input = await readInputs({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_KEY, fetch: f, now });
    d = decide({ ...input, budgetUsd });
  } catch (e) {
    d = { ok: false, reason: `could not read the ceiling or this month's spend from staging (${e instanceof Error ? e.message : "error"}); sim-test does not start without them` };
  }
  const line = d.ok ? `- ceiling ok: ${d.reason}` : `- **sim-test refused to start.** ${d.reason}`;
  log(line.replace(/^- /, "")); summary(line);
  return d.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const out = process.env.GITHUB_STEP_SUMMARY;
  run({ summary: (s) => { if (out) appendFileSync(out, s + "\n"); } }).then((rc) => process.exit(rc));
}
