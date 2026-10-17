#!/usr/bin/env node
// A tiny Supabase stand-in for the website checks (scripts/web): answers POST /rest/v1/rpc/<fn> and the public table
// business_type_labels from fixtures.mjs, the `site-claim` edge function (claim, registration, driver forms), and the
// catalogue image route of `dispatch` (item photos).
//   node scripts/web/mock-supabase.mjs <port> [live|prelaunch]
import { createServer } from "node:http";
import {
  BUSINESS_TYPES,
  PERSONAS,
  itemPhotoSvg,
  respond,
  restRpc,
  restTable,
  siteClaim,
} from "./fixtures.mjs";

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
  // The catalogue image route (item pages, §39.15.7): like `dispatch`, a redirect to a signed URL, here a drawn plate.
  if (req.method === "GET" && url.startsWith("/functions/v1/dispatch?")) {
    const q = new URL(url, "http://mock").searchParams;
    // site-photo (session 5g) answers an item (i) or a shop's cover (c) the same way.
    const id = q.get("i") ?? (q.get("route") === "site-photo" ? (q.get("c") ?? "") : "");
    if (
      !["catalog-image", "site-photo"].includes(q.get("route") ?? "") ||
      !/^[0-9a-f-]{36}$/.test(id)
    )
      return res.writeHead(404, cors).end();
    return res
      .writeHead(302, {
        ...cors,
        location: `/storage/v1/object/sign/menu-item-photos/${id}.svg?token=fixture`,
      })
      .end();
  }
  const photo = /^\/storage\/v1\/object\/sign\/menu-item-photos\/([0-9a-f-]{36})\.svg/.exec(url);
  if (req.method === "GET" && photo)
    return res
      .writeHead(200, {
        ...cors,
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=3600",
      })
      .end(itemPhotoSvg(photo[1]));
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
    // "Forgot password" on the staff sign-in (§39.15.5): Supabase answers 200 whether or not the address has an account.
    if (req.method === "POST" && url.startsWith("/auth/v1/recover")) return json(res, {});
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
