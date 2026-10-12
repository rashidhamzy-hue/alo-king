#!/usr/bin/env node
// A tiny PostgREST stand-in for the website checks: answers POST /rest/v1/rpc/<fn> from fixtures.mjs.
//   node scripts/web/mock-supabase.mjs <port> [live|prelaunch]
import { createServer } from "node:http";
import { respond } from "./fixtures.mjs";

const port = Number(process.argv[2] ?? 4020);
const mode = process.argv[3] ?? "live";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "POST, OPTIONS",
};

createServer((req, res) => {
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  const m = /^\/rest\/v1\/rpc\/([a-z_]+)/.exec(req.url ?? "");
  if (!m || req.method !== "POST") return res.writeHead(404, cors).end();
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let args = {};
    try {
      args = body ? JSON.parse(body) : {};
    } catch {
      /* empty */
    }
    const out = respond(m[1], args, mode);
    res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify(out));
  });
}).listen(port, "127.0.0.1", () => console.log(`mock supabase on ${port} (${mode})`));
