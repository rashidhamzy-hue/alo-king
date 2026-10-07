// HMAC-SHA256 webhook signatures (Kapso signs the raw body with the webhook's secret and sends the hex
// digest in `X-Webhook-Signature`). Verified over the raw bytes before any parsing, in constant time.
// Fails closed: no secret, no header, or a malformed header is a rejection. Never logs the secret.

const enc = new TextEncoder();

export async function hmacSha256Hex(secret: string, data: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, data as BufferSource));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two equal-length lowercase hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SignatureCheck =
  { ok: true } | { ok: false; reason: "no_secret" | "missing" | "malformed" | "mismatch" };

export async function verifySignature(
  secret: string | undefined,
  rawBody: Uint8Array,
  header: string | null,
): Promise<SignatureCheck> {
  if (!secret) return { ok: false, reason: "no_secret" };
  if (!header) return { ok: false, reason: "missing" };
  const given = header
    .trim()
    .toLowerCase()
    .replace(/^sha256=/, "");
  if (!/^[0-9a-f]{64}$/.test(given)) return { ok: false, reason: "malformed" };
  const expected = await hmacSha256Hex(secret, rawBody);
  return timingSafeEqualHex(given, expected) ? { ok: true } : { ok: false, reason: "mismatch" };
}
