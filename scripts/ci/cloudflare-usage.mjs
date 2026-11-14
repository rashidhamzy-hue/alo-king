// Cloudflare usage for the whole account, month to date (AUDIT-G1 point 11, extended 14 Nov 2026): Workers requests and Durable Object
// duration, from the GraphQL Analytics API with the deploy token (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID). Read only.
// Fails above THRESHOLD (70%) of the Workers Paid plan's included monthly amount (the founder moves the account to Workers Paid on
// 14 Nov 2026; limits from developers.cloudflare.com/workers/platform/pricing and /durable-objects/platform/pricing, read 14 Nov):
//   Workers requests            10,000,000 a month
//   Durable Object duration        400,000 GB-s a month (wall-clock seconds the object is active x 128 MB / 1 GB)
// The token needs "Account Analytics: Read". If it cannot read analytics, this says so and EXITS 0 (the part is left off, not failed):
// a missing permission is a setup step (docs/HANDOFF.md, A5), not a usage alarm. Any other failure, and any figure over the threshold, exits 1.
// GraphQL figures are overall consumption, not Cloudflare's invoice (their docs say so); the invoice can differ a little.
import { pathToFileURL } from "node:url";

export const THRESHOLD = 0.7;
export const PAID_LIMITS = { workers_requests: 10_000_000, do_duration_gb_s: 400_000 };
const GQL = "https://api.cloudflare.com/client/v4/graphql";

export class NoAccess extends Error {}

export function monthWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = (now - start) / 86_400_000;
  return { startIso: start.toISOString(), endIso: now.toISOString(), startDate: start.toISOString().slice(0, 10), endDate: now.toISOString().slice(0, 10), elapsedDays: elapsed, monthDays: days };
}

async function gql(token, query, variables, fetchImpl) {
  const r = await fetchImpl(GQL, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  if (r.status === 401 || r.status === 403) throw new NoAccess(`HTTP ${r.status}`);
  if (!r.ok) throw new Error(`HTTP ${r.status} from the analytics API`);
  const body = await r.json();
  const errs = body.errors ?? [];
  const denied = errs.find((e) => /not authorized|does not have access|authentication|permission|forbidden|10000/i.test(`${e.message ?? ""} ${e.extensions?.code ?? ""}`));
  if (denied) throw new NoAccess(String(denied.message).slice(0, 200));
  if (errs.length) throw new Error(`analytics API: ${errs.map((e) => e.message).join("; ").slice(0, 300)}`);
  return body.data;
}

/** Reads the two figures. `durationField` is the sum field of durableObjectsPeriodicGroups that holds GB-s; if the schema has no such field the error lists what it has. */
export async function readCloudflare(token, account, now = new Date(), fetchImpl = fetch) {
  const w = monthWindow(now);
  const q = `query($a: String!, $s: Time!, $e: Time!, $sd: Date!, $ed: Date!) { viewer { accounts(filter: {accountTag: $a}) {
    workers: workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: $s, datetime_leq: $e}) { sum { requests } dimensions { scriptName } }
    objects: durableObjectsPeriodicGroups(limit: 10000, filter: {date_geq: $sd, date_leq: $ed}) { sum { duration } }
  } } }`;
  let data;
  try { data = await gql(token, q, { a: account, s: w.startIso, e: w.endIso, sd: w.startDate, ed: w.endDate }, fetchImpl); }
  catch (e) {
    if (e instanceof NoAccess || !/duration/i.test(String(e.message))) throw e;
    // the field name is not what we expected: say what the schema offers
    const intro = await gql(token, `{ __type(name: "AccountDurableObjectsPeriodicGroupsSum") { fields { name } } }`, {}, fetchImpl).catch(() => null);
    throw new Error(`${e.message} (durableObjectsPeriodicGroups sum fields: ${(intro?.__type?.fields ?? []).map((f) => f.name).join(", ") || "unknown"})`);
  }
  const acct = data?.viewer?.accounts?.[0];
  if (!acct) throw new Error("the analytics API returned no account (wrong CLOUDFLARE_ACCOUNT_ID, or the token's account differs)");
  const perScript = (acct.workers ?? []).map((g) => ({ script: g.dimensions?.scriptName ?? "?", requests: Number(g.sum?.requests ?? 0) })).sort((a, b) => b.requests - a.requests);
  const requests = perScript.reduce((n, g) => n + g.requests, 0);
  const gbs = (acct.objects ?? []).reduce((n, g) => n + Number(g.sum?.duration ?? 0), 0);
  return { window: w, requests, doDurationGbS: gbs, perScript };
}

/** Pure. Rows with usage, limit, share of the limit, the straight-line projection to the end of the month, and a status. */
export function evaluate(read, limits = PAID_LIMITS, threshold = THRESHOLD) {
  const scale = read.window.monthDays / Math.max(read.window.elapsedDays, 1 / 24);
  const mk = (metric, used, limit) => { const pct = used / limit; return { metric, used, limit, pct, projected: used * scale / limit, status: pct > threshold ? "over" : "ok" }; };
  const rows = [mk("workers requests", read.requests, limits.workers_requests), mk("Durable Object duration (GB-s)", read.doDurationGbS, limits.do_duration_gb_s)];
  return { rows, ok: rows.every((r) => r.status === "ok") };
}
export function table(rows, threshold = THRESHOLD) {
  const n = (v) => Math.round(v).toLocaleString("en-US");
  return ["| metric (month to date) | used | included a month | of limit | projected for the month | |", "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.metric} | ${n(r.used)} | ${n(r.limit)} | ${(r.pct * 100).toFixed(2)}% | ${(r.projected * 100).toFixed(1)}% | ${r.status === "ok" ? "ok" : `**over ${threshold * 100}%**`} |`)].join("\n");
}

async function main() {
  const summary = async (text) => { console.log(text); if (process.env.GITHUB_STEP_SUMMARY) (await import("node:fs")).appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n"); };
  const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) { await summary("Cloudflare usage: no CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in this run, so this part is off."); return; }
  try {
    const read = await readCloudflare(token, account);
    const { rows, ok } = evaluate(read);
    await summary(["Cloudflare usage, Workers Paid limits, month to date " + read.window.startDate + " to " + read.window.endDate, "", table(rows), "",
      ...read.perScript.slice(0, 8).map((s) => `- ${s.script}: ${s.requests.toLocaleString("en-US")} requests`)].join("\n"));
    if (!ok) { console.error("Cloudflare usage check FAILED: a figure is over the threshold"); process.exit(1); }
  } catch (e) {
    if (e instanceof NoAccess) {
      await summary(`Cloudflare usage: LEFT OFF. The deploy token cannot read analytics (${e.message}). Add the permission "Account > Account Analytics > Read" to the token, then run this again.`);
      return;
    }
    console.error(`Cloudflare usage could not be read: ${String(e.message ?? e)}`);
    await summary(`Cloudflare usage: **could not be read**: ${String(e.message ?? e).slice(0, 400)}`);
    process.exit(1);
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
