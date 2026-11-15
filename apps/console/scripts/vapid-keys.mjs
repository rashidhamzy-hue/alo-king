// Makes a VAPID key pair for the console's web push (session D5). Prints the three Worker secrets; nothing is written anywhere:
//   node apps/console/scripts/vapid-keys.mjs
// then, per environment:  npx wrangler secret put VAPID_PUBLIC_KEY --config apps/console/wrangler.jsonc --env staging   (and the other two)
// VAPID_SUBJECT is a contact the push services can use: `mailto:` an address you read, or an `https:` page. Never commit the private key.
import { webcrypto as c } from "node:crypto";
const b64u = (b) => Buffer.from(b).toString("base64url");
const kp = await c.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await c.subtle.exportKey("jwk", kp.privateKey);
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
console.log(`VAPID_PUBLIC_KEY=${b64u(pub)}\nVAPID_PRIVATE_KEY=${jwk.d}\nVAPID_SUBJECT=mailto:you@example.com   # replace with a real contact`);
