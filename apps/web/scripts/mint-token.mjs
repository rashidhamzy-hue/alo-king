#!/usr/bin/env node
// Makes the Worker's database token: an HS256 JWT whose role claim is web_channel, signed with the project's JWT secret.
// PostgREST reads the role claim and switches to that role (granted to `authenticator` by migration 0132). The token can do exactly what
// web_channel can do: execute the website's functions (0132, 0155). It is not the service key and cannot become it.
//   node mint-token.mjs            reads SUPABASE_JWT_SECRET and SUPABASE_PROJECT_REF from the environment, prints the token only
import { createHmac } from "node:crypto";

const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

/** @param {{ secret: string, ref: string, role?: string, now?: number, days?: number }} o */
export function mintToken({ secret, ref, role = "web_channel", now = Math.floor(Date.now() / 1000), days = 730 }) {
  if (!secret || !ref) throw new Error("secret and ref are required");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ iss: "supabase", ref, role, iat: now, exp: now + days * 86400 });
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!secret || !ref) { console.error("SUPABASE_JWT_SECRET and SUPABASE_PROJECT_REF are required"); process.exit(2); }
  process.stdout.write(mintToken({ secret, ref }));
}
