// A stand-in for Supabase's PostgREST in front of the test database: POST /rest/v1/rpc/<function> runs the function on the real
// migrations as the database role web_channel (the role the Worker connects as), exactly as PostgREST would after reading the token's
// role claim. It refuses a request without the apikey and the bearer token, so a test that passes proves the Worker sent them.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { asSupabase, type TestDb } from "../db/harness";

export const FAKE_JWT = "test.web_channel.jwt";
export const FAKE_ANON = "test-anon-key";

export interface Fake { url: string; close(): Promise<void>; calls: { fn: string; args: any }[]; failing: { on: boolean } }

export async function startFakePostgrest(db: TestDb): Promise<Fake> {
  const inner = asSupabase(db);
  const calls: Fake["calls"] = [];
  const failing = { on: false };
  let queue: Promise<unknown> = Promise.resolve();      // one connection: calls run one at a time, as the role
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(req.url ?? "");
      const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      if (req.method !== "POST" || !m) return send(404, { message: "not found" });
      if (req.headers.apikey !== FAKE_ANON || req.headers.authorization !== `Bearer ${FAKE_JWT}`) return send(401, { message: "Invalid API key" });
      if (failing.on) return send(500, { message: "database down" });
      const fn = m[1]!; const args = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      calls.push({ fn, args });
      queue = queue.then(async () => {
        await db.pg.exec("set role web_channel");
        try {
          const r = await inner.rpc(fn, args);
          if (r.error) send(r.error.message.includes("permission denied") ? 403 : 400, { message: r.error.message, code: "42501" });
          else send(200, r.data);
        } finally { await db.pg.exec("reset role"); }
      }).catch((e) => send(500, { message: String(e) }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, calls, failing, close: () => new Promise((ok) => server.close(() => ok())) };
}
