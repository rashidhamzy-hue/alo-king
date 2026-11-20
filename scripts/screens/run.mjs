#!/usr/bin/env node
// Screenshots out of the repository (DOC2). Run by .github/workflows/screens.yml with the existing service secrets; never prints a key.
//   node scripts/screens/run.mjs upload <dir> <session>    uploads the images in <dir> as <session>/<file>, deleting older screenshots of the same pages
//   node scripts/screens/run.mjs migrate <git-ref>         moves every image under docs/screens/ at that commit (the one move; oldest session first)
//   node scripts/screens/run.mjs retain                    PERF1: keeps the newest shot of each page per session (and the last 24 hours), deletes the rest
//   node scripts/screens/run.mjs webp                      PERF1: every kept PNG or JPEG becomes a WebP (quality 80, one pixel per CSS pixel); the old file goes
// PERF1: an upload stores WebP too (a PNG the test wrote is converted first). sharp comes from scripts/images (npm ci --prefix scripts/images).
//   node scripts/screens/run.mjs verify                    opens every object through a signed link and prints the count
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY. Writes a markdown summary to $GITHUB_STEP_SUMMARY when it is set.
import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createRequire } from "node:module";
import { SESSION_ORDER, contentType, isImage, parseShot, planPrune, planRetention, safeScreenPath, webpName } from "../../packages/core/src/screens.mjs";
import { screensStore } from "./storage.mjs";

/** PERF1: sharp from scripts/images (its own package, so the root install never carries it). Null when it is not installed. */
export function loadSharp() {
  try { return createRequire(new URL("../images/package.json", import.meta.url))("sharp"); } catch { return null; }
}

/**
 * PERF1: a screenshot as stored: WebP, quality 80, at one pixel per CSS pixel (a shot taken at device scale 2 is brought to the width its
 * name says: `-390-` is 390 px wide; a name with no width keeps its size). Returns { path, bytes } (the path ends in .webp).
 */
export async function toStoredWebp(sharp, path, bytes) {
  const s = parseShot(path);
  const meta = await sharp(bytes, { limitInputPixels: 300_000_000 }).metadata();
  const css = s?.width ? Number(s.width) : null;
  let img = sharp(bytes, { limitInputPixels: 300_000_000 });
  if (css && meta.width && meta.width >= css * 1.5) img = img.resize({ width: css });
  const out = await img.webp({ quality: 80, effort: 5 }).toBuffer();
  return { path: webpName(path), bytes: out };
}

/** Uploads `files` ({ path, bytes }) and deletes what they replace. Pure over the store, so a test can run it on a fake.
 *  PERF1: with `sharp`, a PNG or JPEG is stored as WebP (toStoredWebp). */
export async function uploadFiles(store, files, sharp = null) {
  if (sharp) files = await Promise.all(files.map((f) => (/\.webp$/i.test(f.path) ? f : toStoredWebp(sharp, f.path, f.bytes))));
  const incoming = files.map((f) => f.path);
  for (const p of incoming) if (!safeScreenPath(p)) throw new Error(`bad path: ${p}`);
  const existing = await store.list();
  const remove = planPrune(existing, incoming);
  for (const f of files) await store.put(f.path, f.bytes, contentType(f.path));
  await store.remove(remove);
  return { uploaded: incoming.length, removed: remove };
}

const mb = (bytes) => (bytes / 1048576).toFixed(1);
/** The retention step, through the Storage API (never SQL). Returns what it measured and deleted. Pure over the store. */
export async function retain(store, now = new Date(), hours = 24) {
  const before = await store.listDetailed();
  const remove = planRetention(before, now, hours);
  await store.remove(remove);
  const after = await store.listDetailed();
  const chips = (l) => new Set(l.map((o) => o.path.split("/")[0])).size;
  const sum = (l) => l.reduce((n, o) => n + o.size, 0);
  return { removed: remove, before: { files: before.length, bytes: sum(before), chips: chips(before) }, after: { files: after.length, bytes: sum(after), chips: chips(after) } };
}
export const retainLine = (r) => `- retention (newest shot of each page per session, and the last 24 hours): before ${r.before.files} files, ${mb(r.before.bytes)} MB, ${r.before.chips} sessions; deleted ${r.removed.length}; after ${r.after.files} files, ${mb(r.after.bytes)} MB, ${r.after.chips} sessions`;

/** PERF1: every PNG or JPEG in the bucket becomes WebP (the WebP is written first, then the old file deleted). Pure over the store. */
export async function toWebp(store, sharp) {
  const before = await store.listDetailed();
  const todo = before.filter((o) => /\.(png|jpe?g)$/i.test(o.path));
  let done = 0; const errors = [];
  for (const o of todo) {
    try {
      const w = await toStoredWebp(sharp, o.path, await store.get(o.path));
      await store.put(w.path, w.bytes, "image/webp");
      await store.remove([o.path]);
      done++;
    } catch (e) { errors.push(`${o.path}: ${String(e?.message ?? e).slice(0, 120)}`); }
  }
  const after = await store.listDetailed();
  const sum = (l) => l.reduce((n, x) => n + x.size, 0);
  return { done, todo: todo.length, errors, before: { files: before.length, bytes: sum(before) }, after: { files: after.length, bytes: sum(after) } };
}

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
    const r = await uploadFiles(store, filesOfDir(a, b), loadSharp());
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
  } else if (cmd === "webp") {
    const sharp = loadSharp();
    if (!sharp) { console.error("::error::sharp is not installed (npm ci --prefix scripts/images)"); process.exit(1); }
    const r = await toWebp(store, sharp);
    say(`- WebP: ${r.done} of ${r.todo} PNG or JPEG screenshot(s) converted; before ${r.before.files} files, ${mb(r.before.bytes)} MB; after ${r.after.files} files, ${mb(r.after.bytes)} MB`);
    for (const e of r.errors) console.error(`::error::${e}`);
    if (r.errors.length) process.exitCode = 1;
  } else if (cmd !== "verify") throw new Error("usage: upload <dir> <session> | migrate <ref> | retain | webp | verify");
  const all = await store.list();
  let bad = 0, bytes = 0;
  for (const p of all) { try { bytes += await store.open(p); } catch (e) { bad++; console.error(`::error::${e.message}`); } }
  say(`- verified: ${all.length - bad} of ${all.length} screenshot(s) open through a signed link (${Math.round(bytes / 1024)} KB), by session: ${
    [...new Set(all.map((p) => p.split("/")[0]))].map((s) => `${s} ${all.filter((p) => p.startsWith(s + "/")).length}`).join(", ")}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  if (bad) process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main(process.argv.slice(2));
