#!/usr/bin/env node
// A tiny Supabase stand-in for the website checks (scripts/web): answers POST /rest/v1/rpc/<fn> and the public table
// business_type_labels from fixtures.mjs, and the `site-claim` edge function (claim, registration, driver forms).
//   node scripts/web/mock-supabase.mjs <port> [live|prelaunch]
import { createServer } from "node:http";
import { BUSINESS_TYPES, PERSONAS, respond, restRpc, restTable, siteClaim } from "./fixtures.mjs";

const port = Number(process.argv[2] ?? 4020);
const mode = process.argv[3] ?? "live";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const json = (res, body, status = 200) =>
  res.writeHead(status, { ...cors, "content-type": "application/json" }).end(JSON.stringify(body));

createServer((req, res) => {
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  const url = req.url ?? "";
  if (req.method === "GET" && url.startsWith("/rest/v1/business_type_labels"))
    return json(res, BUSINESS_TYPES);
  // The staff pages (session 6b): a signed-in person is told apart by the `sub` of the planted token.
  const table = /^\/rest\/v1\/([a-z_]+)(\?|$)/.exec(url)?.[1];
  if (table && req.method === "GET") {
    const sub = (() => {
      try {
        return JSON.parse(
          Buffer.from(
            (req.headers.authorization ?? "").split(".")[1] ?? "",
            "base64url",
          ).toString(),
        ).sub;
      } catch {
        return null;
      }
    })();
    let rows = restTable(table);
    // Who is who: the operator row belongs to the admin, the membership to the merchant.
    if (table === "operators") rows = sub === PERSONAS.admin.sub ? rows : [];
    if (table === "vendor_members") rows = sub === PERSONAS.merchant.sub ? rows : [];
    if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) return json(res, rows[0] ?? null);
    return json(res, rows);
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    if (req.method === "POST" && url.startsWith("/functions/v1/site-claim")) {
      if ((req.headers["content-type"] ?? "").startsWith("multipart/form-data")) {
        const text = raw.toString("latin1");
        const claim_id = /name="claim_id"\r\n\r\n([^\r]+)/.exec(text)?.[1] ?? "";
        const kind = /name="kind"\r\n\r\n([^\r]+)/.exec(text)?.[1] ?? "";
        return json(res, siteClaim({}, { claim_id, kind }));
      }
      let body = {};
      try {
        body = JSON.parse(raw.toString("utf8") || "{}");
      } catch {
        /* empty */
      }
      return json(res, siteClaim(body));
    }
    const m = /^\/rest\/v1\/rpc\/([a-z_]+)/.exec(url);
    if (!m || req.method !== "POST") return res.writeHead(404, cors).end();
    let args = {};
    try {
      args = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    } catch {
      /* empty */
    }
    const staff = restRpc(m[1]);
    json(res, staff !== null ? staff : respond(m[1], args, mode));
  });
}).listen(port, "127.0.0.1", () => console.log(`mock supabase on ${port} (${mode})`));
