// The console's only door to the database. It has two verbs and no others:
//   rpc  - call a SQL function. Every write the console makes is one of these (invariant 3; the functions check the role).
//   rows - read a table or view.
// There is deliberately no insert, update, upsert or delete here, so the console cannot write to orders, payments,
// stock or the ledger directly even by mistake. test/no-direct-writes.test.ts keeps it that way.
import type { SupabaseClient } from "@supabase/supabase-js";

export type Cond = string | number | boolean | null | { in: readonly unknown[] } | { not: unknown } | { gte: unknown } | { lte: unknown } | { lt: unknown } | { isNull: boolean };
export interface Query { select?: string; where?: Record<string, Cond>; order?: { col: string; desc?: boolean }[]; limit?: number }

export interface Db {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
  rows<T = Record<string, unknown>>(table: string, q?: Query): Promise<T[]>;
  /** Whether a SQL function exists. Pages use it to say plainly that a step waits for a migration. */
  hasFunction(fn: string): Promise<boolean>;
}

export class DbError extends Error {
  constructor(message: string, readonly code?: string) { super(message); this.name = "DbError"; }
}
/** PostgREST's code for "no such function" and Postgres' own. */
export const isMissingFunction = (e: unknown) => e instanceof DbError && (e.code === "PGRST202" || e.code === "42883");

const IDENT = /^[a-z_][a-z0-9_]*$/;
export function checkIdent(s: string) { if (!IDENT.test(s)) throw new Error(`bad identifier ${s}`); return s; }

export function supabaseDb(client: SupabaseClient, rest: { url: string; key: string; fetchImpl?: typeof fetch }): Db {
  let fnCache: { at: number; names: Set<string> | null } | null = null;
  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const r = await client.rpc(checkIdent(fn), args);
      if (r.error) throw new DbError(r.error.message, r.error.code);
      return r.data as T;
    },
    async rows<T>(table: string, q: Query = {}) {
      let b: any = client.from(checkIdent(table)).select(q.select ?? "*");
      for (const [col, c] of Object.entries(q.where ?? {})) {
        checkIdent(col);
        if (c !== null && typeof c === "object") {
          if ("in" in c) b = b.in(col, c.in as unknown[]);
          else if ("not" in c) b = b.neq(col, c.not);
          else if ("gte" in c) b = b.gte(col, c.gte);
          else if ("lte" in c) b = b.lte(col, c.lte);
          else if ("lt" in c) b = b.lt(col, c.lt);
          else if ("isNull" in c) b = c.isNull ? b.is(col, null) : b.not(col, "is", null);
        } else if (c === null) b = b.is(col, null);
        else b = b.eq(col, c);
      }
      for (const o of q.order ?? []) b = b.order(checkIdent(o.col), { ascending: !o.desc });
      if (q.limit) b = b.limit(q.limit);
      const r = await b;
      if (r.error) throw new DbError(r.error.message, r.error.code);
      return (r.data ?? []) as T[];
    },
    async hasFunction(fn: string) {
      // PostgREST lists every callable function in its OpenAPI description (service key only). Cached for five minutes.
      // If it cannot be read, say yes: the call itself then reports what is missing.
      if (!fnCache || Date.now() - fnCache.at > 300_000) {
        let names: Set<string> | null = null;
        try {
          const res = await (rest.fetchImpl ?? fetch)(`${rest.url}/rest/v1/`, { headers: { apikey: rest.key, authorization: `Bearer ${rest.key}`, accept: "application/openapi+json" } });
          if (res.ok) {
            const spec = (await res.json()) as { paths?: Record<string, unknown> };
            names = new Set(Object.keys(spec.paths ?? {}).filter((p) => p.startsWith("/rpc/")).map((p) => p.slice(5)));
          }
        } catch { /* unknown */ }
        fnCache = { at: Date.now(), names };
      }
      return fnCache.names ? fnCache.names.has(fn) : true;
    },
  };
}
