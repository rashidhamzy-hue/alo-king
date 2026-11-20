#!/usr/bin/env node
// Screenshots out of the repository (DOC2). Run by .github/workflows/screens.yml with the existing service secrets; never prints a key.
//   node scripts/screens/run.mjs upload <dir> <session>    uploads the images in <dir> as <session>/<file>, deleting older screenshots of the same pages
//   node scripts/screens/run.mjs migrate <git-ref>         moves every image under docs/screens/ at that commit (the one move; oldest session first)
//   node scripts/screens/run.mjs retain                    FIX2: keeps the newest upload of each screen name per session and the last 7 days, deletes the rest
//   node scripts/screens/run.mjs verify                    opens every object through a signed link and prints the count
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY. Writes a markdown summary to $GITHUB_STEP_SUMMARY when it is set.
import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { SESSION_ORDER, contentType, isImage, planPrune, planRetention, safeScreenPath } from "../../packages/core/src/screens.mjs";
import { screensStore } from "./storage.mjs";

/** Uploads `files` ({ path, bytes }) and deletes what they replace. Pure over the store, so a test can run it on a fake. */
export async function uploadFiles(store, files) {
  const incoming = files.map((f) => f.path);
  for (const p of incoming) if (!safeScreenPath(p)) throw new Error(`bad path: ${p}`);
  const existing = await store.list();
  const remove = planPrune(existing, incoming);
  for (const f of files) await store.put(f.path, f.bytes, contentType(f.path));
  await store.remove(remove);
  return { uploaded: incoming.length, removed: remove };
}

const mb = (bytes) => (bytes / 1048576).toFixed(1);
/** FIX2: the retention step, through the Storage API (never SQL). Returns what it measured and deleted. Pure over the store. */
export async function retain(store, now = new Date(), days = 7) {
  const before = await store.listDetailed();
  const remove = planRetention(before, now, days);
  await store.remove(remove);
  const after = await store.listDetailed();
  const chips = (l) => new Set(l.map((o) => o.path.split("/")[0])).size;
  const sum = (l) => l.reduce((n, o) => n + o.size, 0);
  return { removed: remove, before: { files: before.length, bytes: sum(before), chips: chips(before) }, after: { files: after.length, bytes: sum(after), chips: chips(after) } };
}
export const retainLine = (r) => `- retention (newest of each screen per session, and the last 7 days): before ${r.before.files} files, ${mb(r.before.bytes)} MB, ${r.before.chips} sessions; deleted ${r.removed.length}; after ${r.after.files} files, ${mb(r.after.bytes)} MB, ${r.after.chips} sessions`;

export const filesOfDir = (dir, session) => readdirSync(dir).filter(isImage).sort().map((f) => ({ path: `${session}/${f}`, bytes: readFileSync(join(dir, f)) }));

/** Every image under docs/screens/ at `ref`, grouped by session folder, oldest session first. */
export function sessionsAtRef(ref, git = (...a) => execFileSync("git", a, { maxBuffer: 1 << 28 })) {
  const names = git("ls-tree", "-r", "--name-only", ref, "docs/screens").toString().split("\n").filter((n) => n && isImage(n));
  const by = new Map();
  for (const n of names) { const [, , session, ...rest] = n.split("/"); if (rest.length === 1) by.set(session, [...(by.get(session) ?? []), n]); }
  const rank = (s) => { const i = SESSION_ORDER.indexOf(s); return i < 0 ? 1000 : i; };
  return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([session, list]) => ({ session, files: list.map((n) => ({ path: `${session}/${n.split("/").pop()}`, read: () => git("show", `${ref}:${n}`) })) }));
}

export async function main(argv, env = process.env) {
  const [cmd, a, b] = argv;
  const need = (k) => { if (!env[k]) { console.error(`::error::${k} is not set`); process.exit(1); } return env[k]; };
  const store = screensStore({ url: need("SUPABASE_URL"), key: need("SUPABASE_SERVICE_KEY") });
  const lines = [];
  const say = (s) => { console.log(s); lines.push(s); };
  if (cmd === "upload") {
    if (!a || !b) throw new Error("usage: upload <dir> <session>");
    const r = await uploadFiles(store, filesOfDir(a, b));
    say(`- uploaded ${r.uploaded} screenshot(s) as ${b}/, deleted ${r.removed.length} older one(s) of the same pages`);
  } else if (cmd === "migrate") {
    if (!a) throw new Error("usage: migrate <git-ref>");
    let up = 0, gone = 0;
    for (const s of sessionsAtRef(a)) {
      const r = await uploadFiles(store, s.files.map((f) => ({ path: f.path, bytes: f.read() })));
      up += r.uploaded; gone += r.removed.length;
      say(`- ${s.session}: ${r.uploaded} uploaded, ${r.removed.length} older of the same pages deleted`);
    }
    say(`- moved ${up} screenshot(s); ${gone} replaced by a newer set of the same page`);
  } else if (cmd === "retain") {
    const r = await retain(store);
    say(retainLine(r));
    if (r.after.chips < r.before.chips) { console.error("::error::a session lost every screenshot"); process.exit(1); }
  } else if (cmd !== "verify") throw new Error("usage: upload <dir> <session> | migrate <ref> | retain | verify");
  const all = await store.list();
  let bad = 0, bytes = 0;
  for (const p of all) { try { bytes += await store.open(p); } catch (e) { bad++; console.error(`::error::${e.message}`); } }
  say(`- verified: ${all.length - bad} of ${all.length} screenshot(s) open through a signed link (${Math.round(bytes / 1024)} KB), by session: ${
    [...new Set(all.map((p) => p.split("/")[0]))].map((s) => `${s} ${all.filter((p) => p.startsWith(s + "/")).length}`).join(", ")}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  if (bad) process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main(process.argv.slice(2));
