// AST1: the console assistant's tools. Every one reads; none writes (invariant 21). The database ones call the SQL functions of migrations
// 0261 and 0262, which belong to the read-only role assistant_reader (a write inside one is refused by Postgres). The two outside reads
// are Sentry (errors in the last 24 hours, with a read-only token) and GitHub Actions (failed runs in the last 24 hours, with a read-only
// token); without its token a tool says it is not connected (Sentry) or is not offered at all (GitHub).
// Roles: the admin gets every tool; an ops lead gets the operations without money totals (no `money`, no `model_spend`); a picker has no
// assistant at all (the route and the panel are for leads).
import type { Db } from "../db";
import type { Role } from "../roles";

export interface SentryRead { count: number; link: string; issues: { title: string; events: number; last_seen: string }[] }
export interface GithubRead { failed: { workflow: string; branch: string; started: string; url: string }[]; link: string }

export interface ToolEnv {
  db: Db;
  now: Date;
  role: Role;
  /** Absent: Sentry is not connected (no read-only token). Null from the call: Sentry did not answer. */
  sentry?: () => Promise<SentryRead | null>;
  /** Absent: no read-only GitHub token; the tool is not offered. */
  github?: () => Promise<GithubRead | null>;
}

type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
export interface Tool {
  name: string;
  description: string;
  input_schema: Schema;
  roles: readonly Role[];
  /** Is this tool offered in this environment (the GitHub one needs its token)? */
  offered?: (env: ToolEnv) => boolean;
  run(env: ToolEnv, input: Record<string, unknown>): Promise<unknown>;
}

const LEADS: readonly Role[] = ["admin", "ops_lead"];
const ADMIN: readonly Role[] = ["admin"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayArg = (v: unknown): string | null => (typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const intArg = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
};
const dayProp = { type: "string", description: "A day as YYYY-MM-DD (Beirut). Leave out for today." };
const obj = (properties: Record<string, unknown> = {}): Schema => ({ type: "object", properties, additionalProperties: false });

export const TOOLS: Tool[] = [
  {
    name: "orders",
    description: "Orders of one day: counts by status, groceries and food, how many were delivered on time or late, the average delivery time, and every late order with its promised and actual times and the slowest stage (picking, restaurant, waiting_for_rider, ride). Test orders are left out. No money.",
    input_schema: obj({ day: dayProp }), roles: LEADS,
    run: (e, i) => e.db.rpc("assistant_orders", { p_day: dayArg(i.day), p_now: e.now.toISOString(), p_limit: 15 }),
  },
  {
    name: "food_places",
    description: "Food places on one day: call-ahead calls, how many the place accepted, refused (closed) or were cancelled, the average and slowest minutes to answer the call, places closed today, and dishes whose price is to be confirmed. Includes the slowest place.",
    input_schema: obj({ day: dayProp }), roles: LEADS,
    run: (e, i) => e.db.rpc("assistant_places", { p_day: dayArg(i.day), p_now: e.now.toISOString(), p_call_min: 10 }),
  },
  {
    name: "riders",
    description: "Riders: who is on shift and since when, cash held against the soft and hard caps, deliveries on the day, and late pickups (minutes from an order being ready to the rider leaving with it, over 15).",
    input_schema: obj({ day: dayProp }), roles: LEADS,
    run: (e, i) => e.db.rpc("assistant_riders", { p_day: dayArg(i.day), p_now: e.now.toISOString(), p_late_pickup_min: 15 }),
  },
  {
    name: "stock",
    description: "Stock at the hub now: items out of stock and low, lots expired or expiring soon, lines short or damaged on receiving in the last 7 days, and fridge temperature readings missed or out of range in the last 7 days.",
    input_schema: obj({ expiring_within_days: { type: "integer", minimum: 0, maximum: 30, description: "Default 3." } }), roles: LEADS,
    run: (e, i) => e.db.rpc("assistant_stock", { p_now: e.now.toISOString(), p_days: intArg(i.expiring_within_days, 0, 30, 3), p_limit: 20 }),
  },
  {
    name: "products",
    description: "Products: how many active items are sellable, the ones that are not and why (no Arabic name, no photo, no price...), items without an approved photo, price bases to confirm, and what customers searched for that found nothing in the last N days.",
    input_schema: obj({ days: { type: "integer", minimum: 1, maximum: 31, description: "For the searches. Default 7." } }), roles: LEADS,
    run: (e, i) => e.db.rpc("assistant_products", { p_now: e.now.toISOString(), p_days: intArg(i.days, 1, 31, 7), p_limit: 10 }),
  },
  {
    name: "customers",
    description: "Customers over a period ending on a day: hand-offs to a person (by reason, open now, late), complaints (by kind, open), the honest-answer cases (things asked for that we do not sell, facts we cannot confirm, places not on Alo King), and feedback (fine or problem). Phone numbers are masked.",
    input_schema: obj({ day: dayProp, days: { type: "integer", minimum: 1, maximum: 31, description: "How many days, ending on `day`. Default 1." } }), roles: LEADS,
    run: (e, i) => e.db.rpc("assistant_customers", { p_day: dayArg(i.day), p_days: intArg(i.days, 1, 31, 1), p_now: e.now.toISOString(), p_limit: 15 }),
  },
  {
    name: "approvals",
    description: "Approvals waiting for a person, by kind (names, photos, label readings, dishes, places, second approvals, refunds, auto-approval spot checks), and what was approved automatically today.",
    input_schema: obj(), roles: LEADS,
    run: (e) => e.db.rpc("assistant_approvals", { p_now: e.now.toISOString() }),
  },
  {
    name: "money",
    description: "Money on one day (admin only): sales of goods (delivery fees and tips are the riders', never company revenue), cash still to collect, cash held by riders, cash drops and transfers to confirm, over/short, the day close difference, unbalanced ledger transactions.",
    input_schema: obj({ day: dayProp }), roles: ADMIN,
    run: (e, i) => e.db.rpc("assistant_money", { p_day: dayArg(i.day), p_now: e.now.toISOString() }),
  },
  {
    name: "model_spend",
    description: "Model spend this month (admin only): by workflow, customer chat turns, this assistant today and this month against its daily and monthly caps, the simulation against its monthly cap.",
    input_schema: obj(), roles: ADMIN,
    run: (e) => e.db.rpc("assistant_model_spend", { p_now: e.now.toISOString() }),
  },
  {
    name: "digests",
    description: "The nightly digests (what went well, what went wrong with numbers, slow places, failed searches, things asked for that we don't sell, top things to fix) for days between from and to. Use it for 'yesterday' or 'this week'. Default: the last 7 days.",
    input_schema: obj({ from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } }), roles: LEADS,
    run: (e, i) => e.db.rpc("assistant_digests", { p_from: dayArg(i.from), p_to: dayArg(i.to), p_now: e.now.toISOString() }),
  },
  {
    name: "errors",
    description: "Errors recorded by Sentry in the last 24 hours (this environment): the count and the most frequent issues.",
    input_schema: obj(), roles: LEADS,
    run: async (e) => {
      if (!e.sentry) return { connected: false, note: "Sentry is not connected: the console has no read-only Sentry token (SENTRY_READ_TOKEN)." };
      const r = await e.sentry();
      return r ? { connected: true, window_hours: 24, errors: r.count, issues: r.issues, link: r.link } : { connected: true, note: "Sentry did not answer; the count is unknown." };
    },
  },
  {
    name: "failed_runs",
    description: "GitHub Actions runs that failed in the last 24 hours: workflow, branch, start time.",
    input_schema: obj(), roles: LEADS,
    offered: (e) => !!e.github,
    run: async (e) => {
      const r = e.github ? await e.github() : null;
      return r ? { window_hours: 24, failed: r.failed.length, runs: r.failed, link: r.link } : { note: "GitHub did not answer; failed runs are unknown." };
    },
  },
];

/** The tools this person may use here. A picker gets none. */
export function toolsFor(env: ToolEnv): Tool[] {
  return TOOLS.filter((t) => t.roles.includes(env.role) && (t.offered ? t.offered(env) : true));
}

/** Runs one tool call for this person; a tool they may not use, or a failure, is a result that says so (never an exception to the model). */
export async function runTool(env: ToolEnv, name: string, input: unknown): Promise<{ ok: boolean; result: unknown }> {
  const tool = toolsFor(env).find((t) => t.name === name);
  if (!tool) return { ok: false, result: { error: `no tool named ${name} for this role` } };
  try {
    return { ok: true, result: await tool.run(env, input && typeof input === "object" ? (input as Record<string, unknown>) : {}) };
  } catch (e) {
    return { ok: false, result: { error: "this read failed; the data is unknown", detail: String((e as Error)?.message ?? e).slice(0, 160) } };
  }
}

/** Sentry's reader for the assistant: the count of error events and the five most frequent issues of the last 24 hours. Null if Sentry did not answer. */
export function sentryReader(env: { SENTRY_READ_TOKEN?: string; SENTRY_ORG?: string; SENTRY_API?: string; ENVIRONMENT?: string }, fetcher: typeof fetch = fetch) {
  const org = env.SENTRY_ORG ?? "";
  if (!env.SENTRY_READ_TOKEN || !/^[a-z0-9-]{1,60}$/.test(org)) return undefined;
  const api = /^https:\/\/[a-z0-9.-]+\.sentry\.io$/.test(env.SENTRY_API ?? "") ? env.SENTRY_API! : "https://de.sentry.io";
  const envq = env.ENVIRONMENT ? ` environment:${env.ENVIRONMENT}` : "";
  const link = `https://${org}.sentry.io/issues/?statsPeriod=24h&query=${encodeURIComponent(envq.trim())}`;
  const h = { headers: { authorization: `Bearer ${env.SENTRY_READ_TOKEN}` }, signal: AbortSignal.timeout(5000) };
  return async (): Promise<SentryRead | null> => {
    try {
      const [cr, ir] = await Promise.all([
        fetcher(`${api}/api/0/organizations/${org}/events/?field=count()&dataset=errors&statsPeriod=24h&query=${encodeURIComponent("event.type:error" + envq)}`, h),
        fetcher(`${api}/api/0/organizations/${org}/issues/?statsPeriod=24h&sort=freq&limit=5&query=${encodeURIComponent(("is:unresolved" + envq).trim())}`, h),
      ]);
      if (!cr.ok) return null;
      const count = Number(((await cr.json()) as { data?: Record<string, unknown>[] }).data?.[0]?.["count()"]);
      if (!Number.isFinite(count)) return null;
      const issues = ir.ok ? ((await ir.json()) as { title?: string; count?: string | number; lastSeen?: string }[]) : [];
      return { count, link, issues: (Array.isArray(issues) ? issues : []).slice(0, 5).map((x) => ({ title: String(x.title ?? "").slice(0, 120), events: Number(x.count ?? 0), last_seen: String(x.lastSeen ?? "").slice(0, 16) })) };
    } catch { return null; }
  };
}

/** GitHub's reader: the repository's workflow runs that failed in the last 24 hours. Needs a read-only token (GITHUB_READ_TOKEN). */
export function githubReader(env: { GITHUB_READ_TOKEN?: string; GITHUB_REPO?: string }, now: () => Date, fetcher: typeof fetch = fetch) {
  const repo = env.GITHUB_REPO ?? "";
  if (!env.GITHUB_READ_TOKEN || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)) return undefined;
  return async (): Promise<GithubRead | null> => {
    try {
      const since = new Date(now().getTime() - 86_400_000).toISOString().slice(0, 19) + "Z";
      const r = await fetcher(`https://api.github.com/repos/${repo}/actions/runs?status=failure&per_page=30&created=${encodeURIComponent(">=" + since)}`, {
        headers: { authorization: `Bearer ${env.GITHUB_READ_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "alo-king-console" }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const body = (await r.json()) as { workflow_runs?: { name?: string; head_branch?: string; run_started_at?: string; html_url?: string }[] };
      return { link: `https://github.com/${repo}/actions?query=is%3Afailure`, failed: (body.workflow_runs ?? []).slice(0, 30).map((w) => ({
        workflow: String(w.name ?? "").slice(0, 60), branch: String(w.head_branch ?? "").slice(0, 80), started: String(w.run_started_at ?? "").slice(0, 16), url: String(w.html_url ?? "") })) };
    } catch { return null; }
  };
}
