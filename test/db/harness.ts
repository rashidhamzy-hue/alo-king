// A real Postgres (PGlite, in-process) loaded with the real migrations and seeds.
// Tests that use this exercise the SQL that ships, not a stand-in.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../supabase/", import.meta.url));

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Runs a psql seed file. The one psql-only line (\copy <table> from '<csv>') is replaced by inserts. */
async function runSeed(db: PGlite, file: string) {
  const sql = readFileSync(root + "seed/" + file, "utf8");
  const m = sql.match(/^\\copy (\w+) from '([^']+)'.*$/m);
  if (!m) { await db.exec(sql); return; }
  const [before, after] = sql.split(m[0]) as [string, string];
  await db.exec(before);
  const rows = parseCsv(readFileSync(fileURLToPath(new URL("../../" + m[2], import.meta.url)), "utf8")).slice(1);
  const width = rows[0]!.length;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values = chunk.map((_, r) => "(" + Array.from({ length: width }, (_, c) => `$${r * width + c + 1}`).join(",") + ")").join(",");
    await db.query(`insert into ${m[1]} values ${values}`, chunk.flatMap((r) => r.map((v) => (v === "" ? null : v))));
  }
  await db.exec(after);
}

export interface TestDb {
  pg: PGlite;
  /** select fn(a => $1, ...) and return the single value. Objects are sent as JSON, arrays as Postgres arrays. */
  rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T>;
  all<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
}

const enc = (v: unknown): unknown =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? `{${v.join(",")}}`
  : v !== null && typeof v === "object" ? JSON.stringify(v) : v;

/** `welcome`: CX1's first-ever welcome (0143) stays on. Off by default, so a test's fresh customer is answered as before CX1; the CX1
 *  tests and the simulated customers (evals/sim/world.ts) turn it on. */
export async function openTestDb(opts: { seeds?: boolean; welcome?: boolean } = {}): Promise<TestDb> {
  const pg = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  for (const f of readdirSync(root + "migrations").sort()) {
    try { await pg.exec(readFileSync(root + "migrations/" + f, "utf8")); }
    catch (e) { throw new Error(`${f}: ${(e as Error).message}`); }
  }
  if (!opts.welcome) await pg.exec(`update settings set value = '{"enabled": false}' where key = 'welcome'`);
  if (opts.seeds !== false) {
    for (const f of ["load_catalog.sql", "load_aliases.sql", "villages.sql", "travel_times_estimate.sql"]) await runSeed(pg, f);
  }
  const all = async <T,>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params.map(enc))).rows;
  return {
    pg, all,
    one: async (sql, params) => (await all<any>(sql, params))[0],
    rpc: async (fn, args = {}) => {
      const keys = Object.keys(args);
      const rows = await all<any>(`select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]));
      return rows[0]?.r;
    },
  };
}

/** The slice of supabase-js that the app uses (rpc only), backed by the test database. */
export function asSupabase(db: TestDb) {
  // A set-returning function comes back from supabase-js as an array of rows, not as one composite value (F1: the rig sent
  // driver_cash_native's composite on as undefined amounts, which declare_cash_drop now refuses).
  const sets = new Map<string, boolean>();
  const returnsSet = async (fn: string) => {
    if (!sets.has(fn)) sets.set(fn, !!(await db.one(`select bool_or(proretset) as s from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [fn]))?.s);
    return sets.get(fn)!;
  };
  return {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      try {
        if (await returnsSet(fn)) {
          const keys = Object.keys(args ?? {});
          return { data: await db.all(`select * from ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, keys.map((k) => args![k])), error: null };
        }
        return { data: await db.rpc(fn, args), error: null };
      }
      catch (e) { return { data: null, error: { message: (e as Error).message } }; }
    },
  };
}
