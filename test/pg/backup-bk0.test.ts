// BK0: the nightly backup and the weekly restore check, run for real except for the two remote stores.
// A real Postgres is dumped by scripts/backup/dump.mjs, encrypted, stored in a directory by scripts/backup/store.mjs (the same code
// path as R2 and the Supabase bucket apart from the transport), then restored into an empty database and held to the manifest.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { realPostgresAvailable, startRealPostgres, type RealPg } from "./real-postgres";
// @ts-expect-error plain ES module, no types
import { addAndPrune, ageHours, copyKey, isoWeek, passphraseProblem } from "../../scripts/backup/lib.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const PASS = "correct-horse-battery-staple-0123456789";

describe("retention and age (pure)", () => {
  const night = (d: number, h = 1) => ({ key: `k${d}`, created_at: new Date(Date.UTC(2026, 9, d, h, 30)).toISOString(), sha256: "x", bytes: 1 });
  it("names the ISO week and the copy", () => {
    expect(isoWeek(new Date("2026-11-15T01:30:00Z"))).toBe("2026-W46");   // a Sunday
    expect(isoWeek(new Date("2026-11-16T01:30:00Z"))).toBe("2026-W47");   // the Monday after
    expect(isoWeek(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
    expect(copyKey("staging", new Date("2026-11-15T01:30:07.123Z"))).toBe("staging/20261115T013007Z.tar.gpg");
  });
  it("keeps the newest 14 nightly copies and the newest 8 weekly copies, and says what to delete", () => {
    let index: any[] = [];
    const removed: string[] = [];
    // 120 nights, one copy per night, from 1 Jul 2026 on.
    for (let i = 0; i < 120; i++) {
      const created = new Date(Date.UTC(2026, 6, 1 + i, 1, 30)).toISOString();
      const r = addAndPrune(index, { key: `k${i}`, created_at: created, sha256: "x", bytes: 1 });
      index = r.index; removed.push(...r.remove.map((e: any) => e.key));
    }
    const nightly = index.slice(0, 14).map((e: any) => e.key);
    expect(nightly).toEqual(Array.from({ length: 14 }, (_, n) => `k${119 - n}`));
    const weekly = index.filter((e: any) => e.weekly);
    expect(weekly.length).toBeLessThanOrEqual(8 + 2);                        // the 8 week copies; those among the newest 14 are counted once
    // every kept week copy is the first copy of its ISO week; no week appears twice
    const weeks = weekly.map((e: any) => isoWeek(new Date(e.created_at)));
    expect(new Set(weeks).size).toBe(weeks.length);
    // the 8 newest weekly-flagged copies all survive, wherever they are
    const allFlagged = new Set(index.filter((e: any) => e.weekly).map((e: any) => e.key));
    expect(allFlagged.size).toBeGreaterThanOrEqual(8);
    // nothing kept was ever reported as removed, and nothing is both
    expect(index.some((e: any) => removed.includes(e.key))).toBe(false);
    // 14 nightly copies, plus the 8 week copies of which the newest two or three are already among those 14
    expect(index.length).toBeLessThanOrEqual(14 + 8);
    expect(index.length).toBeGreaterThanOrEqual(14 + 5);
  });
  it("a second run in the same ISO week is not a week copy", () => {
    const a = addAndPrune([], night(2)).index;
    const b = addAndPrune(a, night(3)).index;
    expect(b.find((e: any) => e.key === "k2")!.weekly).toBe(true);
    expect(b.find((e: any) => e.key === "k3")!.weekly).toBe(false);
  });
  it("age in hours, and the passphrase rules", () => {
    expect(ageHours({ created_at: "2026-11-15T00:00:00Z" }, new Date("2026-11-16T12:00:00Z"))).toBe(36);
    expect(ageHours(null)).toBe(Infinity);
    expect(passphraseProblem("")).toMatch(/not set/);
    expect(passphraseProblem("short")).toMatch(/shorter than 24/);
    expect(passphraseProblem(PASS)).toBeNull();
  });
});

const run = realPostgresAvailable() ? describe : describe.skip;
let pg: RealPg, sql: postgres.Sql;
let tmp: string;
const url = () => pg.url;
const scratchUrl = (db: string) => pg.url.replace(/\/[^/]*$/, `/${db}`);
const pgBin = () => { const base = "/usr/lib/postgresql"; const v = readdirSync(base).sort((a, b) => Number(b) - Number(a))[0]; return join(base, v!, "bin"); };
const node = (script: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync("node", [join(repo, "scripts/backup", script), ...args], { cwd: repo, encoding: "utf8", env: { ...process.env, ENVIRONMENT: "staging", BACKUP_STORE: "dir", BACKUP_DIR: join(tmp, "store"), PG_BIN: pgBin(), ...env } });

run("backup and restore, end to end", () => {
  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "ak-bk0-"));
    pg = await startRealPostgres();
    sql = pg.connect(2);
    // The migration record Supabase keeps, and a balanced ledger: two transactions of two entries each.
    await sql.unsafe(`create schema if not exists supabase_migrations;
      create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
      insert into supabase_migrations.schema_migrations select lpad(g::text, 4, '0'), 'm' || g, null from generate_series(1, 107) g;`);
    await sql.unsafe(`do $$ declare a uuid := ensure_account('bk0:a', 'driver_cash'); b uuid := ensure_account('bk0:b', 'hub_cash'); t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid();
      begin
        insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values (t1, a, 10.50, 'USD', 10.50, 'bk0'), (t1, b, -10.50, 'USD', -10.50, 'bk0');
        insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values (t2, a, 3.25, 'USD', 3.25, 'bk0'), (t2, b, -3.25, 'USD', -3.25, 'bk0');
      end $$;`);
  }, 240_000);
  afterAll(async () => { await sql?.end(); await pg?.stop(); if (tmp) rmSync(tmp, { recursive: true, force: true }); }, 30_000);

  let bundle = "";
  let manifestRows = 0;

  it("refuses to dump without the passphrase, or with a short one, and writes nothing", () => {
    const dbEnv = { DATABASE_URL: url(), BACKUP_PASSPHRASE: "" };
    const none = node("dump.mjs", ["--out", join(tmp, "none")], dbEnv);
    expect(none.status).toBe(1);
    expect(none.stderr).toMatch(/BACKUP_PASSPHRASE is not set/);
    expect(existsSync(join(tmp, "none", "bundle.tar.gpg"))).toBe(false);
    const short = node("dump.mjs", ["--out", join(tmp, "none")], { ...dbEnv, BACKUP_PASSPHRASE: "short" });
    expect(short.status).toBe(1);
    expect(short.stderr).toMatch(/shorter than 24/);
  });

  it("dumps one consistent snapshot, encrypted, without ever printing the passphrase", () => {
    const r = node("dump.mjs", ["--out", join(tmp, "out")], { DATABASE_URL: url(), BACKUP_PASSPHRASE: PASS });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(PASS);
    const info = JSON.parse(r.stdout.trim().split("\n").pop()!);
    bundle = info.file;
    manifestRows = info.meta.rows;
    expect(info.meta.migrations).toBe(107);
    expect(info.meta.tables).toBeGreaterThan(50);
    expect(info.meta.pg_major).toBeGreaterThanOrEqual(15);
    // It is an OpenPGP symmetric-key message: it starts with a gpg packet header (tag 3, symmetric-key session key packet, old or new
    // format) and gpg itself says AES-256. Then the plaintext manifest, taken out with the passphrase, must not appear in it: a whole
    // JSON document and a long table path cannot occur in random bytes by chance (a 3-byte needle could, which made this test flaky).
    const raw = readFileSync(bundle);
    expect([0x8c, 0xc3]).toContain(raw[0]);
    const packets = spawnSync("gpg", ["--list-packets", bundle], { encoding: "utf8" });
    expect(packets.stdout + packets.stderr).toMatch(/symkey enc packet: version 4, cipher 9/);   // cipher 9 is AES-256
    const opened = node("restore.mjs", ["decrypt", "--in", bundle, "--out", join(tmp, "opened")], { BACKUP_PASSPHRASE: PASS });
    expect(opened.status, opened.stderr).toBe(0);
    const manifest = readFileSync(join(tmp, "opened", "manifest.json"));
    expect(manifest.length).toBeGreaterThan(1000);
    expect(raw.includes(manifest)).toBe(false);
    expect(raw.includes(Buffer.from('"public.ledger_entries"'))).toBe(false);
    expect(readdirSync(join(tmp, "out"))).toEqual(["bundle.tar.gpg"]);                              // no plaintext left behind
  });

  it("stores it, reads it back, and the index says what it holds", () => {
    const info = JSON.parse(node("dump.mjs", ["--out", join(tmp, "out2")], { DATABASE_URL: url(), BACKUP_PASSPHRASE: PASS }).stdout.trim().split("\n").pop()!);
    const r = node("store.mjs", ["publish", "--file", info.file, "--meta", JSON.stringify(info.meta)]);
    expect(r.status, r.stderr).toBe(0);
    const entry = JSON.parse(r.stdout.trim().split("\n").pop()!);
    expect(entry).toMatchObject({ store: "dir", weekly: true, pg_major: info.meta.pg_major, migrations: 107 });
    expect(entry.key).toMatch(/^staging\/\d{8}T\d{6}Z\.tar\.gpg$/);
    const index = JSON.parse(readFileSync(join(tmp, "store", "staging", "index.json"), "utf8"));
    expect(index).toHaveLength(1);
    const fresh = node("store.mjs", ["fresh"]);
    expect(fresh.status).toBe(0);
    expect(JSON.parse(fresh.stdout.trim())).toMatchObject({ fresh: true, store: "dir" });
  });

  it("restores the newest copy into an empty database and every check passes", async () => {
    const fetched = node("store.mjs", ["fetch", "--out", join(tmp, "fetched.tar.gpg")]);
    expect(fetched.status, fetched.stderr).toBe(0);
    await sql.unsafe("drop database if exists restore_check");
    await sql.unsafe("create database restore_check");
    const r = spawnSync("bash", [join(repo, "scripts/backup/restore-run.sh"), join(tmp, "fetched.tar.gpg"), join(tmp, "work")], {
      cwd: repo, encoding: "utf8", env: { ...process.env, BACKUP_PASSPHRASE: PASS, RESTORE_DATABASE_URL: scratchUrl("restore_check"), PG_BIN: pgBin(), GITHUB_STEP_SUMMARY: join(tmp, "summary.md") } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(PASS);
    expect(r.stderr).toMatch(/every check passed/);
    const summary = readFileSync(join(tmp, "summary.md"), "utf8");
    expect(summary).toContain("ledger sums to zero");
    expect(summary).not.toContain("FAIL");
    expect(manifestRows).toBeGreaterThan(100);                       // the seeds are in there, so the row counts mean something
    const restored = (await import("postgres")).default(scratchUrl("restore_check"), { max: 1 });
    const [c] = await restored`select (select count(*) from ledger_entries)::int ledger, (select count(*) from supabase_migrations.schema_migrations)::int migrations`;
    await restored.end();
    expect(c).toEqual({ ledger: 4, migrations: 107 });
  });

  it("fails the check when a row is missing, when the ledger does not balance, and with the wrong passphrase", async () => {
    // 1. a row missing from the restored database
    const scratch = (await import("postgres")).default(scratchUrl("restore_check"), { max: 1 });
    await scratch.unsafe("alter table ledger_entries disable trigger user");
    await scratch.unsafe("delete from ledger_entries where amount = 3.25");
    const missing = node("restore.mjs", ["verify", "--manifest", join(tmp, "work", "manifest.json")], { RESTORE_DATABASE_URL: scratchUrl("restore_check") });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/FAIL row counts match the manifest/);
    // 2. an unbalanced transaction, with the row count put back to the manifest's so only the balance can catch it
    await scratch.unsafe("insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) select txn_id, account_id, amount, currency, usd_equiv, memo from ledger_entries where amount = 10.50");
    await scratch.unsafe("insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) select gen_random_uuid(), account_id, 1, currency, 1, 'x' from ledger_entries limit 1");
    await scratch.unsafe("delete from ledger_entries where memo = 'x'");
    await scratch.end();
    const unbalanced = node("restore.mjs", ["verify", "--manifest", join(tmp, "work", "manifest.json")], { RESTORE_DATABASE_URL: scratchUrl("restore_check") });
    expect(unbalanced.status).toBe(1);
    expect(unbalanced.stderr).toMatch(/FAIL/);
    // 3. the wrong passphrase
    const wrong = node("restore.mjs", ["decrypt", "--in", join(tmp, "fetched.tar.gpg"), "--out", join(tmp, "wrong")], { BACKUP_PASSPHRASE: `${PASS}-not` });
    expect(wrong.status).toBe(1);
    expect(existsSync(join(tmp, "wrong", "dump"))).toBe(false);
  });

  it("will not touch anything but a local scratch database", () => {
    const r = node("restore.mjs", ["prepare", "--manifest", join(tmp, "work", "manifest.json")], { RESTORE_DATABASE_URL: "postgres://postgres:x@db.example.supabase.co:5432/postgres" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing to touch db\.example\.supabase\.co/);
  });

  it("an empty store means the freshness check fails with exit 4 and 'no copy at all'", () => {
    const r = node("store.mjs", ["fresh"], { BACKUP_DIR: join(tmp, "empty-store") });
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout.trim())).toMatchObject({ fresh: false, newest: null });
  });

  it("a copy older than 36 hours is stale", () => {
    mkdirSync(join(tmp, "old", "staging"), { recursive: true });
    const when = new Date(Date.now() - 37 * 3600_000).toISOString();
    writeFileSync(join(tmp, "old", "staging", "index.json"), JSON.stringify([{ key: "staging/x.tar.gpg", created_at: when, sha256: "x", bytes: 1 }]));
    const r = node("store.mjs", ["fresh"], { BACKUP_DIR: join(tmp, "old") });
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout.trim())).toMatchObject({ fresh: false, age_hours: 37 });
  });

  it("the alert script posts a Sentry event and raises one ops exception per kind and environment", async () => {
    const r = spawnSync("bash", [join(repo, "scripts/backup/alert.sh"), "raise", "backup_stale", "staging", "the newest copy is 40 hours old"], {
      cwd: repo, encoding: "utf8", env: { ...process.env, DATABASE_URL: url(), SENTRY_ALERT_DRY_RUN: "1", SENTRY_DSN: "https://k@o1.ingest.sentry.io/1" } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/"level":"error"/);
    expect(r.stdout).toMatch(/backup_stale/);
    spawnSync("bash", [join(repo, "scripts/backup/alert.sh"), "raise", "backup_stale", "staging", "again"], { cwd: repo, env: { ...process.env, DATABASE_URL: url(), SENTRY_ALERT_DRY_RUN: "1", SENTRY_DSN: "https://k@o1.ingest.sentry.io/1" } });
    const rows = await sql`select kind, ref, status from ops_exceptions where kind = 'backup_stale'`;
    expect(rows).toEqual([{ kind: "backup_stale", ref: "staging", status: "open" }]);
    spawnSync("bash", [join(repo, "scripts/backup/alert.sh"), "clear", "backup_stale", "staging"], { cwd: repo, env: { ...process.env, DATABASE_URL: url() } });
    expect((await sql`select status from ops_exceptions where kind = 'backup_stale'`)[0]!.status).toBe("resolved");
  });
});
