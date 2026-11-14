// The weekly Supabase usage check (AUDIT-G1 point 11). Reads the staging project's database size, storage size and egress and
// exits 1 when any of them is above THRESHOLD (70%) of the plan's included limit, or cannot be read at all (an unreadable figure
// is not a passing one). Prints a table for the run summary. Reads only; changes nothing; prints no key.
//
//   DB_BYTES, STORAGE_BYTES   from SQL (the workflow runs psql: pg_database_size and the sum of storage.objects)
//   SUPABASE_ACCESS_TOKEN     for egress, which SQL cannot see: the dashboard's organisation usage report
//   SUPABASE_PROJECT_REF      the project
//   PLAN                      free | pro (default free): which limits to compare with
//
// Limits are Supabase's published included quotas for each plan (supabase.com/pricing, read 14 Nov 2026). They are data in this
// file, in one table, so a plan change is one edit. If the usage report itself states the included amount, that is used instead.
import { pathToFileURL } from "node:url";

export const THRESHOLD = 0.7;
const GB = 1024 ** 3, MB = 1024 ** 2;
export const PLAN_LIMITS = {
  free: { database: 500 * MB, storage: 1 * GB, egress: 5 * GB },
  pro: { database: 8 * GB, storage: 100 * GB, egress: 250 * GB },
};

/** Pure: rows of { metric, used, limit, pct, status } and whether the check passes. `used` null means unreadable. */
export function evaluate(used, limits, threshold = THRESHOLD) {
  const rows = ["database", "storage", "egress"].map((metric) => {
    const u = used[metric], l = limits[metric];
    if (u === null || u === undefined || !Number.isFinite(u)) return { metric, used: null, limit: l, pct: null, status: "unreadable" };
    const pct = u / l;
    return { metric, used: u, limit: l, pct, status: pct > threshold ? "over" : "ok" };
  });
  return { rows, ok: rows.every((r) => r.status === "ok") };
}

const fmt = (b) => (b === null ? "n/a" : b >= GB ? `${(b / GB).toFixed(2)} GB` : `${(b / MB).toFixed(1)} MB`);
export function table(rows, threshold = THRESHOLD) {
  return ["| metric | used | included | of limit | |", "| --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.metric} | ${fmt(r.used)} | ${fmt(r.limit)} | ${r.pct === null ? "n/a" : (r.pct * 100).toFixed(1) + "%"} | ${r.status === "ok" ? "ok" : r.status === "over" ? `**over ${threshold * 100}%**` : "**could not be read**"} |`)].join("\n");
}

/**
 * Egress for the current billing period, in bytes, from the dashboard's usage report. Returns { bytes, includedBytes } or throws
 * with what was seen. The report is the dashboard's own API, not the documented one (which has no usage figure), so its shape is
 * read defensively: any entry whose metric name contains EGRESS and not CACHED, in bytes.
 */
export async function readEgress(token, ref, fetchImpl = fetch) {
  const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const get = async (url) => { const r = await fetchImpl(url, { headers: h }); if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).pathname}`); return r.json(); };
  const project = await get(`https://api.supabase.com/v1/projects/${ref}`);
  const slug = project.organization_slug ?? project.organization_id;
  if (!slug) throw new Error("the project answer names no organisation");
  const report = await get(`https://api.supabase.com/platform/organizations/${slug}/usage?project_ref=${ref}`);
  const list = Array.isArray(report?.usages) ? report.usages : [];
  const hit = list.filter((u) => /egress/i.test(String(u.metric)) && !/cache/i.test(String(u.metric)));
  if (!hit.length) throw new Error(`no egress entry in the usage report (metrics seen: ${list.map((u) => u.metric).join(", ") || "none"}; keys: ${Object.keys(report ?? {}).join(", ")})`);
  const bytes = hit.reduce((n, u) => n + Number(u.usage ?? 0), 0);
  const included = hit.reduce((n, u) => n + Number(u.pricing_free_units ?? 0), 0);
  if (!Number.isFinite(bytes)) throw new Error("the egress entry has no usable number");
  return { bytes, includedBytes: included > 0 ? included : null };
}

async function main() {
  const plan = (process.env.PLAN || "free").toLowerCase();
  const limits = { ...(PLAN_LIMITS[plan] ?? (() => { throw new Error(`unknown plan "${plan}" (free or pro)`); })()) };
  const num = (k) => (process.env[k] && /^\d+$/.test(process.env[k]) ? Number(process.env[k]) : null);
  const used = { database: num("DB_BYTES"), storage: num("STORAGE_BYTES"), egress: null };
  const notes = [];
  try {
    const e = await readEgress(process.env.SUPABASE_ACCESS_TOKEN ?? "", process.env.SUPABASE_PROJECT_REF ?? "");
    used.egress = e.bytes;
    if (e.includedBytes) limits.egress = e.includedBytes;
  } catch (err) { notes.push(`egress could not be read: ${String(err.message ?? err).slice(0, 300)}`); }
  const { rows, ok } = evaluate(used, limits);
  const out = [`Supabase usage, plan "${plan}", threshold ${THRESHOLD * 100}% of the included amount`, "", table(rows), "", ...notes.map((n) => `- ${n}`)].join("\n");
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY) { const { appendFileSync } = await import("node:fs"); appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + "\n"); }
  if (!ok) { console.error("usage check FAILED: a figure is over the threshold or could not be read"); process.exit(1); }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
