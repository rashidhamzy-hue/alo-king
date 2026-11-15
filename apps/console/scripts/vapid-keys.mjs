// Makes a VAPID key pair for the console's web push (session D5). Prints the three Worker secrets; nothing is written anywhere:
//   node apps/console/scripts/vapid-keys.mjs
// With --env (OPS1) it prints only the two keys, as `export NAME=value` lines for the console workflow's deploy to evaluate once,
// when the Worker has no keys yet (.github/workflows/console.yml). The contact (VAPID_SUBJECT) is then the console's own https address.
// then, per environment:  npx wrangler secret put VAPID_PUBLIC_KEY --config apps/console/wrangler.jsonc --env staging   (and the other two)
// VAPID_SUBJECT is a contact the push services can use: `mailto:` an address you read, or an `https:` page. Never commit the private key.
import { webcrypto as c } from "node:crypto";
const b64u = (b) => Buffer.from(b).toString("base64url");
const kp = await c.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await c.subtle.exportKey("jwk", kp.privateKey);
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
if (process.argv.includes("--env")) { console.log(`export VAPID_PUBLIC_KEY=${b64u(pub)}\nexport VAPID_PRIVATE_KEY=${jwk.d}`); process.exit(0); }
console.log(`VAPID_PUBLIC_KEY=${b64u(pub)}\nVAPID_PRIVATE_KEY=${jwk.d}\nVAPID_SUBJECT=mailto:you@example.com   # replace with a real contact`);
