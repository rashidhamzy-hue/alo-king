// The slice of PostgREST that supabase-js uses in the gateway, as a local HTTP server over a REAL Postgres (task 4.5).
// The Worker under test runs in workerd and talks HTTP to this exactly as it talks to Supabase:
//   POST  /rest/v1/rpc/<fn>         named arguments in a JSON body; scalar, json and set-returning functions
//   GET   /rest/v1/<table>?select=&<col>=eq.<v>|neq.<v>|is.null&limit=   (Accept: application/vnd.pgrst.object+json for .single())
//   POST  /rest/v1/<table>          insert (Prefer: return=representation | minimal)
//   PATCH /rest/v1/<table>?<filters> update
// Errors carry Postgres' SQLSTATE in `code`, as PostgREST does (the gateway relies on 23505 for duplicates).
import { createServer, type IncomingMessage, type Server } from "node:http";
import type postgres from "postgres";

const ident = (s: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { code: "42602" }); return `"${s}"`; };

type FnInfo = { args: Map<string, string>; setof: boolean; returns: string };

export async function startPostgrest(sql: postgres.Sql): Promise<{ url: string; server: Server; calls: string[]; close(): Promise<void> }> {
  const fns = new Map<string, FnInfo>();
  const rows = await sql`select p.proname, p.proretset, format_type(p.prorettype, null) as ret, coalesce(p.proargnames, '{}') as names,
      array(select format_type(t, null) from unnest(p.proargtypes) t) as types
    from pg_proc p where p.pronamespace = 'public'::regnamespace`;
  for (const r of rows) {
    const names = r.names as string[]; const types = r.types as string[];
    fns.set(r.proname as string, { args: new Map(names.slice(0, types.length).map((n, i) => [n, types[i]!])), setof: r.proretset as boolean, returns: r.ret as string });
  }
  const calls: string[] = [];

  const body = (req: IncomingMessage) => new Promise<string>((ok) => { let d = ""; req.on("data", (c) => (d += c)).on("end", () => ok(d)); });
  const filters = (q: URLSearchParams, params: unknown[]) => {
    const where: string[] = [];
    for (const [k, v] of q) {
      if (["select", "limit", "order", "columns", "on_conflict"].includes(k)) continue;
      const m = /^(eq|neq|is|gt|lt|gte|lte)\.(.*)$/.exec(v);
      if (!m) throw Object.assign(new Error(`unsupported filter ${k}=${v}`), { code: "PGRST100" });
      if (m[1] === "is") { where.push(`${ident(k)} is ${m[2] === "null" ? "null" : m[2] === "true" ? "true" : "false"}`); continue; }
      params.push(m[2]);
      const op = { eq: "=", neq: "<>", gt: ">", lt: "<", gte: ">=", lte: "<=" }[m[1] as "eq"];
      where.push(`${ident(k)}::text ${op} $${params.length}`);
    }
    return where.length ? ` where ${where.join(" and ")}` : "";
  };

  const server = createServer(async (req, res) => {
    const send = (status: number, data: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(data === undefined ? "" : JSON.stringify(data)); };
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const path = url.pathname.replace(/^\/rest\/v1\//, "");
      const raw = await body(req);
      if (path.startsWith("rpc/")) {
        const fn = path.slice(4); calls.push(`rpc:${fn}`);
        const info = fns.get(fn);
        if (!info) return send(404, { code: "PGRST202", message: `function ${fn} not found` });
        const args = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
        const params: unknown[] = []; const named: string[] = [];
        for (const [k, v] of Object.entries(args)) {
          const t = info.args.get(k);
          if (!t) return send(404, { code: "PGRST202", message: `${fn} has no argument ${k}` });
          // json/jsonb: the driver serialises the value itself (stringifying here would store a JSON string, not the object)
          params.push(v === null ? null : t.endsWith("[]") && Array.isArray(v) ? `{${v.map((x) => `"${String(x)}"`).join(",")}}` : t.startsWith("json") ? v : typeof v === "object" ? JSON.stringify(v) : v);
          named.push(`${ident(k)} => $${params.length}::${t}`);
        }
        const call = `${ident(fn)}(${named.join(", ")})`;
        if (info.setof || info.returns.startsWith("TABLE") || info.returns === "record") {
          return send(200, await sql.unsafe(`select * from ${call}`, params as never[]));
        }
        const [r] = await sql.unsafe(`select ${call} as r`, params as never[]);
        if (process.env.E2E_DEBUG && /plan_order|quote_order/.test(fn)) calls.push(`${fn}(${JSON.stringify(args).slice(0, 600)}) => ${JSON.stringify((r?.r as any)?.issues ?? r?.r).slice(0, 600)} village=${(r?.r as any)?.village_id} place=${(r?.r as any)?.place_id}`);
        return send(200, info.returns === "void" ? null : r?.r ?? null);
      }
      const table = ident(path); calls.push(`${req.method}:${path}`);
      const params: unknown[] = [];
      const one = (req.headers.accept ?? "").includes("vnd.pgrst.object");
      const returning = (req.headers.prefer ?? "").includes("return=representation");
      if (req.method === "GET") {
        const sel = url.searchParams.get("select") ?? "*";
        const cols = sel === "*" ? "*" : sel.split(",").map((c) => ident(c.trim())).join(", ");
        const lim = url.searchParams.get("limit");
        const out = await sql.unsafe(`select ${cols} from ${table}${filters(url.searchParams, params)}${lim ? ` limit ${Number(lim)}` : ""}`, params as never[]);
        if (one) return out.length === 1 ? send(200, out[0]) : send(406, { code: "PGRST116", message: `JSON object requested, multiple (or no) rows returned (${out.length})` });
        return send(200, out);
      }
      if (req.method === "POST") {
        const input = JSON.parse(raw) as Record<string, unknown> | Record<string, unknown>[];
        const list = Array.isArray(input) ? input : [input];
        const keys = [...new Set(list.flatMap((r) => Object.keys(r)))];
        const values = list.map((r) => "(" + keys.map((k) => { if (!(k in r)) return "default"; params.push(r[k]); return `$${params.length}`; }).join(", ") + ")").join(", ");
        const out = await sql.unsafe(`insert into ${table} (${keys.map(ident).join(", ")}) values ${values}${returning ? " returning *" : ""}`, params as never[]);
        return returning ? send(201, one ? out[0] : out) : send(201, undefined);
      }
      if (req.method === "PATCH") {
        const patch = JSON.parse(raw) as Record<string, unknown>;
        const set = Object.entries(patch).map(([k, v]) => { params.push(v); return `${ident(k)} = $${params.length}`; }).join(", ");
        const out = await sql.unsafe(`update ${table} set ${set}${filters(url.searchParams, params)}${returning ? " returning *" : ""}`, params as never[]);
        return returning ? send(200, out) : send(204, undefined);
      }
      return send(405, { code: "PGRST000", message: "method not supported by the test shim" });
    } catch (e) {
      const err = e as { code?: string; message?: string; detail?: string };
      return send(err.code === "23505" ? 409 : 400, { code: err.code ?? "XX000", message: err.message ?? String(e), details: err.detail ?? null, hint: null });
    }
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, server, calls, close: () => new Promise((ok) => server.close(() => ok())) };
}
