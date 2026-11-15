#!/usr/bin/env node
// BK0: one consistent dump of the public schema and the migration record, with a manifest, encrypted.
//
//   node scripts/backup/dump.mjs --out DIR
//
// Environment: DATABASE_URL (user and host, no password) + PGPASSWORD, BACKUP_PASSPHRASE, ENVIRONMENT, PG_BIN (directory of the
// pg_dump that matches the server; default: the one on PATH), BACKUP_SOURCE (a label for the manifest, e.g. the commit).
//
// Consistency: the row counts, the ledger total and the dump are all read from ONE exported snapshot (pg_export_snapshot, then
// pg_dump --snapshot), so a restore can be held to the manifest exactly even while the live database keeps taking orders.
// Output: DIR/bundle.tar.gpg (a tar of dump + manifest.json, gpg symmetric AES-256) and one JSON line on stdout. The plaintext is
// deleted as soon as it is encrypted. The passphrase is read from the environment, handed to gpg on stdin, and never printed.
// What is NOT in it: the files in Supabase Storage (voice notes, receipts) and Supabase's own auth schema (unused: staff and
// customers are rows in `parties`). Voice notes and receipts are personal data and stay where they are.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { passphraseProblem } from "./lib.mjs";

const env = process.env;
const log = (m) => process.stderr.write(`${m}\n`);
const outDir = process.argv[process.argv.indexOf("--out") + 1];
if (!outDir || outDir.startsWith("--")) { log("usage: dump.mjs --out DIR"); process.exit(2); }

const problem = passphraseProblem(env.BACKUP_PASSPHRASE);
if (problem) { log(`::error::${problem}`); process.exit(1); }
if (!env.DATABASE_URL) { log("DATABASE_URL is not set"); process.exit(1); }

const withPassword = (() => { const u = new URL(env.DATABASE_URL); if (env.PGPASSWORD && !u.password) u.password = env.PGPASSWORD; return u.toString(); })();
const sql = postgres(withPassword, { max: 1, onnotice: () => {}, connection: { application_name: "ak-backup" } });
const bin = (n) => (env.PG_BIN ? join(env.PG_BIN, n) : n);
const SCHEMAS = ["public", "supabase_migrations"];

mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "ak-dump-"));
chmodSync(work, 0o700);
const cleanup = () => rmSync(work, { recursive: true, force: true });
process.on("exit", cleanup);

try {
  const manifest = await sql.begin("isolation level repeatable read read only", async (tx) => {
    const [{ snap }] = await tx`select pg_export_snapshot() as snap`;
    const [{ now, ver }] = await tx`select now() as now, current_setting('server_version_num')::int as ver`;
    const tables = await tx.unsafe(`select n.nspname as schema, c.relname as name,
        (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as rows
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and not c.relispartition and n.nspname = any($1) order by 1, 2`, [SCHEMAS]);
    const counts = Object.fromEntries(tables.map((t) => [`${t.schema}.${t.name}`, Number(t.rows)]));
    const [{ migrations }] = await tx`select count(*)::int as migrations from supabase_migrations.schema_migrations`;
    const [ledger] = await tx`select coalesce(sum(usd_equiv), 0)::text as total, count(*)::int as entries,
        (select count(*)::int from (select txn_id from ledger_entries group by txn_id having sum(usd_equiv) <> 0) x) as unbalanced from ledger_entries`;
    const extensions = await tx`select e.extname as name, n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace order by 1`;

    log(`snapshot taken; dumping ${tables.length} tables from server ${ver}`);
    const dump = join(work, "dump");
    const r = spawnSync(bin("pg_dump"), ["--format=custom", "--compress=6", "--no-owner", "--no-privileges", ...SCHEMAS.map((s) => `--schema=${s}`), `--snapshot=${snap}`, `--file=${dump}`, env.DATABASE_URL],
      { stdio: ["ignore", "inherit", "inherit"], env: { ...env, PGPASSWORD: env.PGPASSWORD ?? "" } });
    if (r.status !== 0) throw new Error(`pg_dump exited with ${r.status}${r.error ? `: ${r.error.message}` : ""}`);
    return {
      version: 1, environment: env.ENVIRONMENT || "staging", created_at: new Date(now).toISOString(), source: env.BACKUP_SOURCE || null,
      pg_major: Math.floor(ver / 10000), server_version_num: ver, schemas: SCHEMAS, counts, migrations,
      ledger: { total_usd: ledger.total, entries: ledger.entries, unbalanced_transactions: ledger.unbalanced }, extensions,
    };
  });
  await sql.end();

  writeFileSync(join(work, "manifest.json"), JSON.stringify(manifest, null, 1));
  execFileSync("tar", ["-C", work, "-cf", join(work, "bundle.tar"), "dump", "manifest.json"]);
  const gnupg = join(work, "gnupg"); mkdirSync(gnupg, { mode: 0o700 });
  const target = join(outDir, "bundle.tar.gpg");
  rmSync(target, { force: true });
  execFileSync("gpg", ["--batch", "--yes", "--quiet", "--no-tty", "--pinentry-mode", "loopback", "--passphrase-fd", "0", "--symmetric", "--cipher-algo", "AES256",
    "--s2k-mode", "3", "--s2k-digest-algo", "SHA512", "--s2k-count", "65011712", "--compress-algo", "none", "--output", target, join(work, "bundle.tar")],
    { input: env.BACKUP_PASSPHRASE, env: { ...env, GNUPGHOME: gnupg }, stdio: ["pipe", "inherit", "inherit"] });
  const total = Object.values(manifest.counts).reduce((a, b) => a + b, 0);
  process.stdout.write(`${JSON.stringify({ file: target, meta: { created_at: manifest.created_at, pg_major: manifest.pg_major, tables: Object.keys(manifest.counts).length, rows: total, migrations: manifest.migrations, ledger_total_usd: manifest.ledger.total_usd } })}\n`);
} catch (e) {
  log(`dump failed: ${String(e.message ?? e).replace(/postgres(ql)?:\/\/\S+/gi, "postgres://(hidden)")}`);
  try { await sql.end({ timeout: 1 }); } catch { /* the connection is already gone */ }
  process.exit(1);
}
