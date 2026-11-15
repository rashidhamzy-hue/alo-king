#!/usr/bin/env node
// BK0: the restore side of the backup.
//
//   decrypt --in F --out DIR      gpg-decrypt a copy and unpack dump + manifest.json into DIR
//   prepare --manifest M          in the scratch database: Supabase's three roles and the extensions the dump needs
//   verify  --manifest M          after pg_restore: migration count, every table's row count, and that the ledger balances
//
// Environment: BACKUP_PASSPHRASE (decrypt), RESTORE_DATABASE_URL (the scratch Postgres; never a real project), GITHUB_STEP_SUMMARY.
// The scratch database is a throwaway container on the runner. verify reads counts and sums only: it never prints a row.
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { passphraseProblem } from "./lib.mjs";

const env = process.env;
const log = (m) => process.stderr.write(`${m}\n`);
const args = process.argv.slice(2);
const cmd = args.shift();
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const summary = (line) => { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`); };

function scratch() {
  const url = env.RESTORE_DATABASE_URL;
  if (!url) throw new Error("RESTORE_DATABASE_URL is not set");
  // Never point this at a real project: only a local or service-container database is accepted.
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error(`refusing to touch ${host}: the restore check only runs against a local scratch Postgres`);
  return postgres(url, { max: 1, onnotice: () => {} });
}

async function decrypt() {
  const problem = passphraseProblem(env.BACKUP_PASSPHRASE);
  if (problem) throw new Error(problem);
  const from = opt("in"), to = opt("out");
  if (!from || !to) throw new Error("decrypt needs --in and --out");
  mkdirSync(to, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "ak-restore-")); chmodSync(work, 0o700);
  try {
    const gnupg = join(work, "gnupg"); mkdirSync(gnupg, { mode: 0o700 });
    const tarFile = join(work, "bundle.tar");
    execFileSync("gpg", ["--batch", "--yes", "--quiet", "--no-tty", "--pinentry-mode", "loopback", "--passphrase-fd", "0", "--decrypt", "--output", tarFile, from],
      { input: env.BACKUP_PASSPHRASE, env: { ...env, GNUPGHOME: gnupg }, stdio: ["pipe", "inherit", "inherit"] });
    execFileSync("tar", ["-C", to, "-xf", tarFile]);
  } finally { rmSync(work, { recursive: true, force: true }); }
  if (!existsSync(join(to, "dump")) || !existsSync(join(to, "manifest.json"))) throw new Error("the copy decrypted but holds no dump and manifest");
  log("decrypted and unpacked");
}

async function prepare() {
  const m = JSON.parse(readFileSync(opt("manifest"), "utf8"));
  const sql = scratch();
  await sql.unsafe(`do $$ declare r text; begin
    foreach r in array array['anon','authenticated','service_role'] loop
      if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
    end loop; end $$;`);
  // Every extension the source database had that this image can offer, in the same schema. One it cannot offer (a Supabase-only
  // extension) is named here; if the dump needs it, pg_restore stops with a clear error, which is the right result.
  const have = new Set((await sql`select name from pg_available_extensions`).map((r) => r.name));
  for (const e of m.extensions ?? []) {
    if (e.name === "plpgsql") continue;
    if (!have.has(e.name)) { log(`extension ${e.name} is not in this image (skipped)`); continue; }
    const q = (x) => `"${String(x).replace(/"/g, '""')}"`;
    if (e.schema !== "public") await sql.unsafe(`create schema if not exists ${q(e.schema)}`);
    await sql.unsafe(`create extension if not exists ${q(e.name)} schema ${q(e.schema)}`);
  }
  await sql.end();
  log("scratch database prepared");
}

async function verify() {
  const m = JSON.parse(readFileSync(opt("manifest"), "utf8"));
  const sql = scratch();
  const rows = [];
  let failed = 0;
  const check = (name, expected, got, note = "") => {
    const ok = String(expected) === String(got);
    if (!ok) failed++;
    rows.push({ name, expected, got, ok, note });
  };

  const tables = await sql.unsafe(`select n.nspname as schema, c.relname as name,
      (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as rows
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relispartition and n.nspname = any($1) order by 1, 2`, [m.schemas]);
  const got = Object.fromEntries(tables.map((t) => [`${t.schema}.${t.name}`, Number(t.rows)]));

  const [{ migrations }] = await sql`select count(*)::int as migrations from supabase_migrations.schema_migrations`;
  check("migrations recorded", m.migrations, migrations);
  if (existsSync("supabase/migrations")) {
    const files = execFileSync("sh", ["-c", "ls supabase/migrations/*.sql | wc -l"], { encoding: "utf8" }).trim();
    const note = Number(files) >= migrations ? `the repository has ${files} migration files` : `the repository has only ${files} files but the copy records ${migrations}`;
    if (Number(files) < migrations) failed++;
    rows.push({ name: "repository migration files", expected: `at least ${migrations}`, got: files, ok: Number(files) >= migrations, note });
  }

  check("tables", Object.keys(m.counts).length, Object.keys(got).length);
  const names = new Set([...Object.keys(m.counts), ...Object.keys(got)]);
  const bad = [];
  for (const t of [...names].sort()) {
    const exp = m.counts[t], have = got[t];
    if (exp === undefined) bad.push(`${t}: not in the manifest, ${have} rows restored`);
    else if (have === undefined) bad.push(`${t}: missing after restore (manifest ${exp})`);
    else if (exp !== have) bad.push(`${t}: manifest ${exp}, restored ${have}`);
  }
  check("row counts match the manifest", `${Object.keys(m.counts).length} tables`, bad.length ? `${bad.length} differ` : `${Object.keys(got).length} tables`, bad.slice(0, 20).join("; "));

  const [lg] = await sql`select coalesce(sum(usd_equiv), 0)::text as total, count(*)::int as entries,
      (select count(*)::int from (select txn_id from ledger_entries group by txn_id having sum(usd_equiv) <> 0) x) as unbalanced from ledger_entries`;
  check("ledger entries", m.ledger.entries, lg.entries);
  check("ledger sums to zero", "0.00", Number(lg.total).toFixed(2), "usd_equiv over the whole ledger");
  check("every ledger transaction balances", 0, lg.unbalanced, "transactions whose entries do not sum to zero");
  check("ledger total equals the manifest", Number(m.ledger.total_usd).toFixed(2), Number(lg.total).toFixed(2));
  await sql.end();

  const line = (r) => `| ${r.ok ? "ok" : "**FAIL**"} | ${r.name} | ${r.expected} | ${r.got} | ${r.note} |`;
  summary(`### Restore check: copy of ${m.created_at} (${m.environment}, Postgres ${m.pg_major})`);
  summary("| | Check | Expected | Restored | Note |\n| --- | --- | --- | --- | --- |");
  for (const r of rows) summary(line(r));
  for (const r of rows) log(`${r.ok ? "ok  " : "FAIL"} ${r.name}: expected ${r.expected}, got ${r.got}${r.note ? ` (${r.note})` : ""}`);
  if (failed) { log(`${failed} check(s) failed`); process.exit(1); }
  log("every check passed");
}

const run = { decrypt, prepare, verify }[cmd];
if (!run) { log("usage: restore.mjs decrypt --in F --out DIR | prepare --manifest M | verify --manifest M"); process.exit(2); }
run().catch((e) => { log(`restore.mjs ${cmd}: ${e.message}`); process.exit(1); });
