// Web push (session D5): VAPID (RFC 8292) and message encryption (RFC 8291, aes128gcm) on the Worker's WebCrypto, and the job
// the console cron runs every two minutes: claim the new high-priority exceptions, send each one to every live subscription.
//
// Rules this file keeps:
//   * Push is an extra. Nothing here changes how the WhatsApp ops alert is sent or when (ops_exceptions_due is untouched).
//   * Once per exception: claim_exception_pushes() records the claim before anything is sent (0158). A crash after the claim loses
//     a push; it never repeats one.
//   * No customer detail leaves for a push service: the text is the kind of exception and, when it is an order, the order code.
//   * The VAPID keys are Worker secrets (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT); with any missing, push is simply off.
//   * An endpoint is only ever a known browser push service (a subscription is staff-supplied text; this is the SSRF guard).
import type { Db } from "./db";
import { kindHref, kindName, type ExceptionRow } from "./kinds";

export interface PushEnv { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string }
export interface Target { endpoint: string; p256dh: string; auth: string; party_id: string }

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => { let s = ""; for (const x of b instanceof Uint8Array ? b : new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
export const fromB64u = (s: string): Uint8Array<ArrayBuffer> => {
  const p = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length)); for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out;
};
const cat = (...parts: Uint8Array[]) => { const o = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0))); let at = 0; for (const p of parts) { o.set(p, at); at += p.length; } return o; };
const view = (u: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(u);

/** Only the browsers' own push services. */
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];
export function isPushEndpoint(raw: string): boolean {
  try { const u = new URL(raw); return u.protocol === "https:" && !u.port && !u.username && PUSH_HOSTS.some((r) => r.test(u.hostname)); } catch { return false; }
}

export const pushConfigured = (env: PushEnv) => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT && /^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT));

// ---------- VAPID ----------
async function vapidKey(env: Required<PushEnv>): Promise<CryptoKey> {
  const pub = fromB64u(env.VAPID_PUBLIC_KEY);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY is not an uncompressed P-256 point");
  return crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: env.VAPID_PRIVATE_KEY, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}
export async function vapidHeader(env: Required<PushEnv>, endpoint: string, now: Date): Promise<string> {
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT };
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" }))) + "." + b64u(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await vapidKey(env), enc.encode(head));   // IEEE P1363 r||s, as JWT ES256 wants
  return `vapid t=${head}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// ---------- message encryption (RFC 8291) ----------
const hkdf = async (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, bits: number) =>
  new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: view(salt), info: view(info) }, await crypto.subtle.importKey("raw", view(ikm), "HKDF", false, ["deriveBits"]), bits));

/** `fixed` is for the test against RFC 8291's own example: the application server's key pair and salt, which are random otherwise. */
export async function encryptPayload(plain: Uint8Array, p256dh: string, auth: string, fixed?: { privateJwk: JsonWebKey; publicKey: Uint8Array; salt: Uint8Array }): Promise<Uint8Array> {
  const ua = fromB64u(p256dh), authSecret = fromB64u(auth);
  if (ua.length !== 65 || authSecret.length !== 16) throw new Error("bad subscription keys");
  let asPrivate: CryptoKey; let asPublic: Uint8Array;
  if (fixed) { asPrivate = await crypto.subtle.importKey("jwk", fixed.privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]); asPublic = fixed.publicKey; }
  else { const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair; asPrivate = kp.privateKey; asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)); }
  const uaKey = await crypto.subtle.importKey("raw", view(ua), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(shared, authSecret, cat(enc.encode("WebPush: info\0"), ua, asPublic), 256);
  const cek = await hkdf(ikm, salt, enc.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(ikm, salt, enc.encode("Content-Encoding: nonce\0"), 96);
  const record = cat(plain, new Uint8Array([2]));        // one record, padding delimiter 0x02 (the last record)
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: view(nonce) }, await crypto.subtle.importKey("raw", view(cek), "AES-GCM", false, ["encrypt"]), view(record)));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return cat(salt, rs, new Uint8Array([asPublic.length]), asPublic, body);
}

// ---------- sending ----------
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export async function sendPush(env: Required<PushEnv>, t: Target, payload: object, now: Date, f: Fetch = fetch): Promise<{ ok: boolean; gone: boolean; status: number }> {
  if (!isPushEndpoint(t.endpoint)) return { ok: false, gone: true, status: 0 };        // never call anything else; the row is dropped
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), t.p256dh, t.auth);
  const res = await f(t.endpoint, {
    method: "POST", signal: AbortSignal.timeout(8000),
    headers: { authorization: await vapidHeader(env, t.endpoint, now), "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "3600", urgency: "high" },
    body: view(body),
  });
  return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
}

export function alertFor(e: ExceptionRow): { title: string; body: string; url: string; tag: string } {
  const code = [e.ref, e.detail?.short_code, e.detail?.order].find((v) => typeof v === "string" && /^AK-\d+$/i.test(v)) as string | undefined;
  return { title: "Alo King · needs you · يحتاج إليك", body: `${kindName(e.kind, "en")}${code ? ` · ${code}` : ""}`, url: kindHref(e), tag: `exception-${e.id}` };
}

export interface PushRun { claimed: number; sent: number; failed: number; dropped: number; skipped?: string }
export async function pushNewExceptions(db: Db, env: PushEnv, now: Date, f: Fetch = fetch): Promise<PushRun> {
  const run: PushRun = { claimed: 0, sent: 0, failed: 0, dropped: 0 };
  if (!pushConfigured(env)) return { ...run, skipped: "not_configured" };
  const keys = env as Required<PushEnv>;
  const targets = (await db.rpc<Target[] | null>("push_targets", {})) ?? [];
  if (targets.length === 0) return { ...run, skipped: "no_subscribers" };     // nothing is claimed, so nothing is lost for a later subscriber
  const found = (await db.rpc<ExceptionRow[] | null>("claim_exception_pushes", { p_limit: 20 })) ?? [];
  run.claimed = found.length;
  if (found.length === 0) return run;
  const outcome = new Map<string, { ok: boolean; gone: boolean; error: string | null }>();
  for (const e of found) {
    const alert = alertFor(e);
    await Promise.all(targets.map(async (t) => {
      let r: { ok: boolean; gone: boolean; status: number };
      try { r = await sendPush(keys, t, alert, now, f); } catch (err) { r = { ok: false, gone: false, status: -1 }; outcome.set(t.endpoint, { ok: false, gone: false, error: String(err).slice(0, 120) }); }
      if (r.ok) { run.sent++; if (!outcome.get(t.endpoint)?.error) outcome.set(t.endpoint, { ok: true, gone: false, error: null }); }
      else { run.failed++; if (r.status !== -1) outcome.set(t.endpoint, { ok: false, gone: r.gone, error: `push service answered ${r.status}` }); }
    }));
  }
  for (const [endpoint, o] of outcome) {
    try { await db.rpc("push_endpoint_result", { p_endpoint: endpoint, p_gone: o.gone, p_error: o.ok ? null : o.error }); if (o.gone) run.dropped++; }
    catch { /* the next run records it */ }
  }
  return run;
}
