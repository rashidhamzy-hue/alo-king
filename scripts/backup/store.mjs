#!/usr/bin/env node
// BK0: where the encrypted copies live. One command per job step; results go to stdout as one JSON line, talk goes to stderr.
//
//   probe                          which store would be used, and why (R2 first, the private Supabase bucket second)
//   publish --file F --meta JSON   upload a copy, read it back and compare its checksum, add it to the index, prune, print the entry
//   newest                         the newest copy across every store this run can read (prints the index entry plus age_hours)
//   fetch --out F                  download the newest copy to F and verify its checksum (prints the entry)
//   fresh                          exit 0 when the newest copy is younger than 36 hours, 4 when it is older or there is none
//
// Environment: ENVIRONMENT (staging|production: the folder), BACKUP_BUCKET (R2 bucket, default ak-backups),
//   CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (R2 through `wrangler r2 object`), SUPABASE_URL (or SUPABASE_PROJECT_REF) + SUPABASE_SERVICE_KEY (the fallback,
//   in the private `media` bucket under backups/), BACKUP_STORE (force r2, supabase or dir), BACKUP_DIR (the dir store, used by tests).
// A copy is encrypted before it gets here; this script never sees the passphrase and never prints a key.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addAndPrune, ageHours, copyKey, humanAge, newest, STALE_HOURS } from "./lib.mjs";

const env = process.env;
const log = (m) => process.stderr.write(`${m}\n`);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const environment = env.ENVIRONMENT || "staging";
const bucket = env.BACKUP_BUCKET || "ak-backups";
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const tmp = mkdtempSync(join(tmpdir(), "ak-backup-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

class NotFound extends Error {}
const wranglerBin = resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/.bin/wrangler");

// ---------- the three stores ----------
function r2() {
  const wrangler = (args) => {
    // Run from an empty directory so wrangler ignores the repository's wrangler.jsonc (it has two environments and no business here).
    const r = spawnSync(wranglerBin, args, { cwd: tmp, encoding: "utf8", env: { ...env, WRANGLER_SEND_METRICS: "false", CI: "1" }, maxBuffer: 64 * 1024 * 1024 });
    return { ok: r.status === 0, text: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };
  const run = (args) => {
    const r = wrangler(args);
    if (r.ok) return r.text;
    if (/10007|does not exist|not found|NoSuchKey/i.test(r.text)) throw new NotFound(r.text.slice(0, 200));
    throw new Error(`wrangler ${args.slice(0, 3).join(" ")} failed: ${r.text.replace(/(token|key|secret)[=: ]+\S+/gi, "$1 (hidden)").slice(-400)}`);
  };
  return {
    name: "r2",
    async available() {
      if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return { ok: false, reason: "no CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID" };
      const r = wrangler(["r2", "bucket", "create", bucket]);                      // creates it private; "already exists" is fine
      if (r.ok || /already exists|10004/i.test(r.text)) return { ok: true, reason: `R2 bucket ${bucket} is there` };
      const why = /10000|authentication|unauthori[sz]ed|not authori[sz]ed|forbidden|permission/i.test(r.text) ? "the Cloudflare token has no R2 rights (needs Account > Workers R2 Storage > Edit)"
        : /10042|enable r2|not enabled|r2 is not/i.test(r.text) ? "R2 is not switched on for this Cloudflare account"
        : `wrangler said: ${r.text.replace(/\s+/g, " ").slice(-200)}`;
      return { ok: false, reason: why };
    },
    async put(key, file) { run(["r2", "object", "put", `${bucket}/${key}`, `--file=${file}`, "--content-type=application/octet-stream", "--remote"]); },
    async get(key, file) { run(["r2", "object", "get", `${bucket}/${key}`, `--file=${file}`, "--remote"]); },
    async del(key) { run(["r2", "object", "delete", `${bucket}/${key}`, "--remote"]); },
  };
}

function supabase() {
  const base = env.SUPABASE_URL || (env.SUPABASE_PROJECT_REF ? `https://${env.SUPABASE_PROJECT_REF}.supabase.co` : undefined), key = env.SUPABASE_SERVICE_KEY;
  const h = { apikey: key ?? "", Authorization: `Bearer ${key ?? ""}` };
  const path = (k) => `${base}/storage/v1/object/media/backups/${k.split("/").map(encodeURIComponent).join("/")}`;
  const check = async (res, what) => {
    if (res.ok) return res;
    const body = (await res.text()).slice(0, 200);
    if (res.status === 404 || /not.?found|does not exist/i.test(body)) throw new NotFound(body);
    throw new Error(`${what}: HTTP ${res.status} ${body}`);
  };
  return {
    name: "supabase",
    async available() {
      if (!base || !key) return { ok: false, reason: "no SUPABASE_URL or SUPABASE_SERVICE_KEY" };
      const res = await fetch(`${base}/storage/v1/bucket/media`, { headers: h }).catch((e) => ({ ok: false, status: 0, json: async () => ({}), _e: e }));
      if (!res.ok) return { ok: false, reason: `private bucket media is not readable (HTTP ${res.status})` };
      const b = await res.json();
      if (b.public !== false) return { ok: false, reason: "bucket media is not private: refusing to put a copy there" };
      return { ok: true, reason: "private bucket media, folder backups/" };
    },
    async put(k, file) {
      const size = readFileSync(file).length;
      if (size > 20 * 1024 * 1024) throw new Error(`the copy is ${(size / 1048576).toFixed(1)} MB; the media bucket takes 20 MB. Give the Cloudflare token R2 rights (docs/HANDOFF.md, Founder actions) and run again`);
      await check(await fetch(path(k), { method: "POST", headers: { ...h, "x-upsert": "true", "content-type": "application/octet-stream" }, body: readFileSync(file) }), `upload ${k}`);
    },
    async get(k, file) {
      const res = await check(await fetch(path(k).replace("/object/media/", "/object/authenticated/media/"), { headers: h }), `download ${k}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    },
    async del(k) { await check(await fetch(path(k), { method: "DELETE", headers: h }), `delete ${k}`); },
  };
}

function dirStore() {
  const root = env.BACKUP_DIR;
  const at = (k) => join(root, k);
  return {
    name: "dir",
    async available() { return root ? { ok: true, reason: `directory ${root}` } : { ok: false, reason: "no BACKUP_DIR" }; },
    async put(k, file) { mkdirSync(dirname(at(k)), { recursive: true }); copyFileSync(file, at(k)); },
    async get(k, file) { if (!existsSync(at(k))) throw new NotFound(k); copyFileSync(at(k), file); },
    async del(k) { rmSync(at(k), { force: true }); },
  };
}

const makers = { r2, supabase, dir: dirStore };
const order = () => (env.BACKUP_STORE ? [env.BACKUP_STORE] : ["r2", "supabase"]);

/** The stores this run can use, in order of preference, each with the reason it was or was not usable. */
async function usable() {
  const found = [];
  for (const n of order()) {
    const s = makers[n]();
    const a = await s.available();
    log(`store ${n}: ${a.ok ? "usable" : "not usable"} (${a.reason})`);
    if (a.ok) found.push(s);
  }
  return found;
}

const indexKey = `${environment}/index.json`;
async function readIndex(store) {
  const f = join(tmp, `index-${store.name}.json`);
  try { await store.get(indexKey, f); } catch (e) { if (e instanceof NotFound) return []; throw e; }
  const j = JSON.parse(readFileSync(f, "utf8"));
  if (!Array.isArray(j)) throw new Error("index.json is not a list");
  return j;
}
async function writeIndex(store, entries) {
  const f = join(tmp, "index-out.json");
  writeFileSync(f, JSON.stringify(entries, null, 1));
  await store.put(indexKey, f);
}

async function findNewest() {
  let best = null;
  for (const s of await usable()) {
    let entries;
    try { entries = await readIndex(s); } catch (e) { log(`store ${s.name}: index unreadable (${e.message})`); continue; }
    const n = newest(entries);
    if (n && (!best || n.created_at > best.entry.created_at)) best = { store: s, entry: n };
  }
  return best;
}

// ---------- commands ----------
const args = process.argv.slice(2);
const cmd = args.shift();
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

async function main() {
  if (cmd === "probe") {
    const s = await usable();
    if (!s.length) { out({ store: null }); process.exit(1); }
    out({ store: s[0].name, fallback: s[0].name !== "r2" });
  } else if (cmd === "publish") {
    const file = opt("file"), meta = JSON.parse(opt("meta") ?? "{}");
    if (!file || !existsSync(file)) throw new Error("publish needs --file");
    const [store] = await usable();
    if (!store) throw new Error("no store is usable: neither R2 nor the private Supabase bucket");
    const created = new Date(meta.created_at ?? Date.now());
    const key = copyKey(environment, created);
    const entry = { key, created_at: created.toISOString(), bytes: readFileSync(file).length, sha256: sha256(file), ...meta, store: store.name };
    const before = await readIndex(store);                                         // an unreadable index stops here: never overwrite what we cannot read
    await store.put(key, file);
    const back = join(tmp, "readback");
    await store.get(key, back);
    if (sha256(back) !== entry.sha256) throw new Error(`the copy read back from ${store.name} does not match what was uploaded; the old copies were left alone`);
    const { index, remove } = addAndPrune(before, entry);
    await writeIndex(store, index);
    for (const r of remove) { try { await store.del(r.key); } catch (e) { log(`could not delete ${r.key}: ${e.message}`); } }
    out({ ...index.find((e) => e.key === key), kept: index.length, weekly_copies: index.filter((e) => e.weekly).length, removed: remove.length });
  } else if (cmd === "newest" || cmd === "fresh") {
    const best = await findNewest();
    const age = ageHours(best?.entry);
    if (cmd === "fresh") {
      out({ newest: best?.entry?.key ?? null, store: best?.store.name ?? null, age_hours: Number.isFinite(age) ? Math.round(age * 10) / 10 : null, limit_hours: STALE_HOURS, fresh: age < STALE_HOURS, age: humanAge(age) });
      process.exit(age < STALE_HOURS ? 0 : 4);
    }
    if (!best) { out({ newest: null }); process.exit(3); }
    out({ ...best.entry, store: best.store.name, age_hours: Math.round(age * 10) / 10 });
  } else if (cmd === "fetch") {
    const to = opt("out");
    if (!to) throw new Error("fetch needs --out");
    const best = await findNewest();
    if (!best) { out({ newest: null }); log("there is no copy in any store"); process.exit(3); }
    await best.store.get(best.entry.key, to);
    if (sha256(to) !== best.entry.sha256) throw new Error(`the downloaded copy does not match its checksum (${best.entry.key})`);
    out({ ...best.entry, store: best.store.name, age_hours: Math.round(ageHours(best.entry) * 10) / 10 });
  } else {
    log("usage: store.mjs probe | publish --file F --meta JSON | newest | fetch --out F | fresh");
    process.exit(2);
  }
}
main().catch((e) => { log(`store.mjs ${cmd}: ${e.message}`); process.exit(1); });
