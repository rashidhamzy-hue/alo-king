// Inbound webhook authentication for kapso-brain. Three ways in, all checked in constant time, none of them ever logged:
//  1. `X-Webhook-Signature`: HMAC-SHA256 (hex) of the raw request body keyed with the webhook's `secret_key` (Kapso signs every delivery). The secret never travels. Preferred.
//  2. `x-webhook-secret` header carrying the shared secret (a Kapso webhook custom header).
//  3. legacy `?key=` in the URL: kept until the owner confirms the new method, then removed. It leaks into delivery logs, hence the move.
// If neither secret is configured the endpoint stays open, as it always was.

const enc = new TextEncoder();

export async function hmacHex(secret: string, data: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (length differences leak only the length, never content). */
export function safeEq(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

export type AuthMethod = "signature" | "header" | "query" | "none";
export type AuthResult = { ok: true; method: AuthMethod } | { ok: false; method: "rejected"; reason: string };

export async function verifyWebhook(o: { rawBody: Uint8Array; signatureHeader: string | null; secretHeader: string | null; queryKey: string | null; sharedSecret: string; signingSecret: string }): Promise<AuthResult> {
  if (!o.sharedSecret && !o.signingSecret) return { ok: true, method: "none" };
  if (o.signingSecret && o.signatureHeader) {
    const given = o.signatureHeader.trim().toLowerCase().replace(/^sha256=/, "");
    if (given && safeEq(given, await hmacHex(o.signingSecret, o.rawBody))) return { ok: true, method: "signature" };
  }
  if (o.sharedSecret) {
    if (o.secretHeader && safeEq(o.secretHeader, o.sharedSecret)) return { ok: true, method: "header" };
    if (o.queryKey && safeEq(o.queryKey, o.sharedSecret)) return { ok: true, method: "query" };
  }
  return { ok: false, method: "rejected", reason: o.signatureHeader ? "signature did not match and no valid shared secret was presented" : "no valid credential was presented" };
}
