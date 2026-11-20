// PERF1 (0267): the files of pictures rejected or withdrawn more than 3 days ago leave the private `media` bucket; their rows, reasons
// and sha256 stay (product_images.file_deleted_at says when). The list comes only from the database (media_cleanup_work): never a path
// under labels/ or menus/, never a file another row of any table still names, never the file of a rule's rejection a person can still
// undo in the weekly check. Deleted through the Storage API, never SQL. Reports the three buckets before and after.
// No model, no cost. Run by the storage-clean workflow (daily, and by hand); locally: SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/images/media-clean.mjs
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeStore } from "./lib/store.mjs";

export const BUCKETS = ["catalog", "media", "screens"];

/** One pass. d = { store: { rpc, removeMedia }, days?, dryRun? }. Each file on its own: one failure does not stop the others. */
export async function clean(d) {
  const r = { deleted: 0, failed: 0, errors: [], paths: [] };
  const work = await d.store.rpc("media_cleanup_work", { p_days: d.days ?? 3 });
  for (const j of work ?? []) {
    r.paths.push(j.media_path);
    if (d.dryRun) continue;
    try { await d.store.removeMedia([j.media_path]); await d.store.rpc("media_file_deleted", { p_path: j.media_path }); r.deleted++; }
    catch (e) { r.failed++; r.errors.push(`${j.media_path}: ${String(e?.message ?? e).slice(0, 120)}`); }
  }
  return r;
}

export async function sizes(store) {
  const out = {};
  for (const b of BUCKETS) out[b] = Number(await store.rpc("storage_bucket_bytes", { p_bucket: b })) || 0;
  return out;
}
const mb = (n) => (n / 1048576).toFixed(1);
export const sizeLine = (label, s) => `- ${label}: ${BUCKETS.map((b) => `${b} ${mb(s[b])} MB`).join(", ")}, total ${mb(BUCKETS.reduce((n, b) => n + s[b], 0))} MB`;

async function main() {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY are needed"); process.exit(2); }
  const store = makeStore({ url, key });
  const before = await sizes(store);
  const r = await clean({ store, dryRun: process.env.DRY_RUN === "1" });
  const after = await sizes(store);
  const lines = ["### Storage clean-up", sizeLine("before", before),
    `- rejected or withdrawn pictures' files: ${r.paths.length} due, ${r.deleted} deleted, ${r.failed} failed${process.env.DRY_RUN === "1" ? " (dry run)" : ""}`,
    ...r.errors.map((e) => `  - ${e}`), sizeLine("after", after), ""];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  if (r.failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });
