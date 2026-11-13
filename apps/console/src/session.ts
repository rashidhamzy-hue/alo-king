// Signed cookies. The cookie says who signed in; it never says what they may do. The role is read from the database
// on every request (roles.ts), so a staff member removed or blocked loses access at once.
const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const keys = new Map<string, Promise<CryptoKey>>();
function key(secret: string) {
  let k = keys.get(secret);
  if (!k) { k = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); keys.set(secret, k); }
  return k;
}
export async function hmac(secret: string, data: string): Promise<string> {
  return b64url(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(data)));
}
/** Constant-time comparison of two strings of base64url. */
export function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export const randomToken = (bytes = 18) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** purpose separates cookie kinds, so a short-lived set-password cookie can never be replayed as a session. */
export async function seal(secret: string, purpose: string, body: Record<string, unknown>, ttlSeconds: number, now: Date): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ ...body, _p: purpose, _exp: Math.floor(now.getTime() / 1000) + ttlSeconds })));
  return `${payload}.${await hmac(secret, payload)}`;
}
export async function unseal<T extends Record<string, unknown>>(secret: string, purpose: string, value: string | undefined, now: Date): Promise<T | null> {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig || !same(sig, await hmac(secret, payload))) return null;
  let body: Record<string, unknown>;
  try { body = JSON.parse(new TextDecoder().decode(fromB64url(payload))); } catch { return null; }
  if (body._p !== purpose || typeof body._exp !== "number" || body._exp < Math.floor(now.getTime() / 1000)) return null;
  return body as T;
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}
export const setCookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
export const clearCookie = (name: string) => `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export const SESSION_COOKIE = "ak_console";
export const SESSION_SECONDS = 12 * 3600;     // one working day; then sign in again
export const FLASH_COOKIE = "ak_flash";
export const SETPW_COOKIE = "ak_setpw";
