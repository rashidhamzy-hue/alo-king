// A real Postgres server for the tests that PGlite cannot run: more than one connection at a time (4.6),
// and the Worker talking to the database over HTTP (4.5). It is a throwaway cluster in a temp directory,
// built the way scripts/check_permissions.sh builds one (Supabase's three roles, every migration, the approved seeds).
//
// Where it comes from:
//   - TEST_DATABASE_URL set: that database is used as is (it must be empty; it is filled here).
//   - otherwise the Postgres binaries under /usr/lib/postgresql/<n>/bin (installed on GitHub's ubuntu runners and here).
//   - neither: `realPostgresAvailable()` is false and the suites that need it are skipped, by name, never silently passed.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const repo = fileURLToPath(new URL("../../", import.meta.url));

function pgBin(): string | null {
  const base = "/usr/lib/postgresql";
  if (!existsSync(base)) return null;
  const v = readdirSync(base).filter((d) => existsSync(join(base, d, "bin", "initdb"))).sort((a, b) => Number(b) - Number(a))[0];
  return v ? join(base, v, "bin") : null;
}

export function realPostgresAvailable(): boolean {
  const ok = !!process.env.TEST_DATABASE_URL || !!pgBin();
  // On CI these suites must run: a runner without Postgres is a broken runner, not a reason to skip.
  if (!ok && process.env.CI) throw new Error("CI has no Postgres binaries and no TEST_DATABASE_URL: the real-Postgres tests cannot be skipped there");
  return ok;
}

export interface RealPg {
  url: string;
  /** A fresh connection pool. Each call is a separate set of server connections. */
  connect(max?: number): postgres.Sql;
  psql(file: string): void;
  stop(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startRealPostgres(opts: { seeds?: boolean } = {}): Promise<RealPg> {
  let url = process.env.TEST_DATABASE_URL ?? "";
  let proc: ChildProcess | null = null;
  let dir = "";
  if (!url) {
    const bin = pgBin();
    if (!bin) throw new Error("no Postgres binaries and no TEST_DATABASE_URL");
    dir = mkdtempSync(join(tmpdir(), "ak-pg-"));
    const asUser = process.getuid?.() === 0 ? ["-u", "postgres"] : [];       // initdb refuses to run as root
    if (asUser.length) execFileSync("chown", ["-R", "postgres", dir]);
    const run = (cmd: string, args: string[]) => (asUser.length ? execFileSync("runuser", [...asUser, "--", join(bin, cmd), ...args], { stdio: "pipe" }) : execFileSync(join(bin, cmd), args, { stdio: "pipe" }));
    run("initdb", ["-D", join(dir, "data"), "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C.UTF-8"]);
    const port = 20000 + Math.floor(Math.random() * 20000);
    const args = ["-D", join(dir, "data"), "-p", String(port), "-k", dir, "-c", "listen_addresses=127.0.0.1", "-c", "fsync=off", "-c", "max_connections=60"];
    proc = asUser.length ? spawn("runuser", [...asUser, "--", join(bin, "postgres"), ...args], { stdio: "ignore" }) : spawn(join(bin, "postgres"), args, { stdio: "ignore" });
    url = `postgres://postgres@127.0.0.1:${port}/postgres`;
    for (let i = 0; i < 100; i++) {
      try { const s = postgres(url, { max: 1, onnotice: () => {} }); await s`select 1`; await s.end(); break; }
      catch { if (i === 99) throw new Error("Postgres did not start"); await sleep(100); }
    }
  }
  const psql = (file: string) => execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { cwd: repo, stdio: "pipe" });
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  await admin.unsafe(`do $$ declare r text; begin
    foreach r in array array['anon','authenticated','service_role'] loop
      if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
      execute format('grant usage on schema public to %I', r);
      execute format('alter default privileges in schema public grant all on tables to %I', r);
      execute format('alter default privileges in schema public grant execute on functions to %I', r);
    end loop; end $$;`);
  await admin.end();
  for (const f of readdirSync(join(repo, "supabase/migrations")).sort()) {
    try { psql(join("supabase/migrations", f)); } catch (e) { throw new Error(`${f}: ${String((e as { stderr?: Buffer }).stderr ?? e)}`); }
  }
  if (opts.seeds !== false) for (const f of ["load_catalog.sql", "load_aliases.sql", "villages.sql", "travel_times_estimate.sql"]) psql(join("supabase/seed", f));
  return {
    url, psql,
    connect: (max = 1) => postgres(url, { max, onnotice: () => {} }),
    stop: async () => {
      if (proc && dir) {
        const bin = pgBin()!;
        const args = ["-D", join(dir, "data"), "-m", "immediate", "-w", "stop"];
        try { process.getuid?.() === 0 ? execFileSync("runuser", ["-u", "postgres", "--", join(bin, "pg_ctl"), ...args], { stdio: "pipe" }) : execFileSync(join(bin, "pg_ctl"), args, { stdio: "pipe" }); }
        catch { proc.kill("SIGKILL"); }
      }
      if (dir) rmSync(dir, { recursive: true, force: true });
    },
  };
}
