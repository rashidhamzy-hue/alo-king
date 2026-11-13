// The slice of supabase-js the worker uses (rpc, and from(table) with insert / update / select, eq, limit, single),
// backed by the real migrations in PGlite. Lets the gateway, the turn code and the tools run unchanged against the real schema.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TestDb } from "./harness";

type Res = { data: any; error: { message: string; code?: string } | null };
const ident = (s: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`); return `"${s}"`; };
const val = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
const fail = (e: unknown): Res => ({ data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } });

class Query implements PromiseLike<Res> {
  private op: "select" | "insert" | "update" = "select";
  private cols = "*";
  private rows: Record<string, unknown>[] = [];
  private patch: Record<string, unknown> = {};
  private filters: [string, unknown][] = [];
  private max: number | null = null;
  private one = false;
  private returning = false;
  constructor(private db: TestDb, private table: string) {}

  insert(rows: Record<string, unknown> | Record<string, unknown>[]) { this.op = "insert"; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch: Record<string, unknown>) { this.op = "update"; this.patch = patch; return this; }
  select(cols = "*") { if (this.op === "select") this.cols = cols; else this.returning = true; return this; }
  eq(col: string, v: unknown) { this.filters.push([col, v]); return this; }
  limit(n: number) { this.max = n; return this; }
  single() { this.one = true; return this; }

  private async run(): Promise<Res> {
    try {
      const params: unknown[] = [];
      const p = (v: unknown) => { params.push(val(v)); return `$${params.length}`; };
      const where = this.filters.length ? " where " + this.filters.map(([c, v]) => `${ident(c)} = ${p(v)}`).join(" and ") : "";
      let sql: string;
      if (this.op === "insert") {
        if (this.rows.length === 0) return { data: null, error: null };
        const keys = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
        const values = this.rows.map((r) => "(" + keys.map((k) => (k in r ? p(r[k]) : "default")).join(", ") + ")").join(", ");
        sql = `insert into ${ident(this.table)} (${keys.map(ident).join(", ")}) values ${values}${this.returning ? " returning *" : ""}`;
      } else if (this.op === "update") {
        const set = Object.entries(this.patch).map(([k, v]) => `${ident(k)} = ${p(v)}`).join(", ");
        sql = `update ${ident(this.table)} set ${set}${where}${this.returning ? " returning *" : ""}`;
      } else {
        const cols = this.cols.trim() === "*" ? "*" : this.cols.split(",").map((c) => ident(c.trim())).join(", ");
        sql = `select ${cols} from ${ident(this.table)}${where}${this.max !== null ? ` limit ${Math.floor(this.max)}` : ""}`;
      }
      const rows = (await this.db.pg.query<any>(sql, params)).rows;
      if (this.op !== "select" && !this.returning) return { data: null, error: null };
      if (this.one) return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `expected one row, got ${rows.length}`, code: "PGRST116" } };
      return { data: rows, error: null };
    } catch (e) { return fail(e); }
  }
  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run().then(ok, ko);
  }
}

export interface ShimLog { rpc: { fn: string; args: Record<string, unknown> }[] }

/** A supabase-js stand-in over the test database. `log.rpc` records every function called, in order. */
export function supabaseOver(db: TestDb): { client: SupabaseClient; log: ShimLog } {
  const log: ShimLog = { rpc: [] };
  const client = {
    rpc: async (fn: string, args: Record<string, unknown> = {}): Promise<Res> => {
      log.rpc.push({ fn, args });
      try { return { data: await db.rpc(fn, args), error: null }; } catch (e) { return fail(e); }
    },
    from: (table: string) => new Query(db, table),
  };
  return { client: client as unknown as SupabaseClient, log };
}
