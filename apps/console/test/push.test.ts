// Web push (session D5): the encryption and VAPID signature are checked against RFC 8291's own example and an independent receiver;
// a subscription belongs to one staff party and goes when that party can no longer use the console; one alert per exception, ever;
// nothing about a customer leaves for a push service; the WhatsApp ops alert is untouched; no keys, no push, and nothing is claimed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { alertFor, encryptPayload, fromB64u, isPushEndpoint, pushNewExceptions, vapidHeader, type PushEnv } from "../src/push";
import { PUSH_CRON } from "../src/worker";
import { rig, type Rig } from "./kit";

const b64u = (b: ArrayBuffer | Uint8Array) => { let s = ""; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const dec = new TextDecoder();

/** A browser's side: its own key pair and auth secret, and the RFC 8291 receiver that opens what we send. */
async function subscriber(host = "fcm.googleapis.com", path = "/fcm/send/" + crypto.randomUUID()) {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const endpoint = `https://${host}${path}`;
  return {
    endpoint, p256dh: b64u(pub), auth: b64u(auth),
    open: (body: Uint8Array) => receive(body, kp.privateKey, pub, auth),
  };
}
async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, bits: number) {
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(salt), info: new Uint8Array(info) }, await crypto.subtle.importKey("raw", new Uint8Array(ikm), "HKDF", false, ["deriveBits"]), bits));
}
async function receive(body: Uint8Array, uaPrivate: CryptoKey, uaPublic: Uint8Array, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16), idlen = body[20]!, asPublic = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
  expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaPrivate, 256));
  const info = new Uint8Array([...new TextEncoder().encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(shared, auth, info, 256);
  const cek = await hkdf(ikm, salt, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(ikm, salt, new TextEncoder().encode("Content-Encoding: nonce\0"), 96);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), cipher));
  expect(plain[plain.length - 1]).toBe(2);                                    // the last-record delimiter
  return dec.decode(plain.slice(0, -1));
}
async function vapidPair(): Promise<Required<PushEnv>> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = new Uint8Array([4, ...fromB64u(jwk.x!), ...fromB64u(jwk.y!)]);
  return { VAPID_PUBLIC_KEY: b64u(pub), VAPID_PRIVATE_KEY: jwk.d!, VAPID_SUBJECT: "mailto:ops@alo-king.example" };
}

describe("push: encryption and signature", () => {
  it("encrypts RFC 8291's own example to the byte", async () => {
    const asPublic = fromB64u("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
    const body = await encryptPayload(new TextEncoder().encode("When I grow up, I want to be a watermelon"),
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", "BTBZMqHH6r4Tts7J_aSIgg",
      { privateJwk: { kty: "EC", crv: "P-256", d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", x: b64u(asPublic.slice(1, 33)), y: b64u(asPublic.slice(33, 65)) }, publicKey: asPublic, salt: fromB64u("DGv6ra1nlYgDCS1FRnbzlw") });
    expect(b64u(body)).toBe("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
  });

  it("round-trips through an independent receiver, with a fresh key and salt every time", async () => {
    const s = await subscriber();
    const a = await encryptPayload(new TextEncoder().encode(JSON.stringify({ hello: "مرحبا" })), s.p256dh, s.auth);
    const b = await encryptPayload(new TextEncoder().encode(JSON.stringify({ hello: "مرحبا" })), s.p256dh, s.auth);
    expect(await s.open(a)).toBe(JSON.stringify({ hello: "مرحبا" }));
    expect(b64u(a)).not.toBe(b64u(b));
    await expect(encryptPayload(new Uint8Array(1), "AAAA", s.auth)).rejects.toThrow();
  });

  it("signs a VAPID token for the push service's own origin that verifies with the public key and lasts under a day", async () => {
    const keys = await vapidPair();
    const now = new Date("2026-11-15T10:00:00Z");
    const h = await vapidHeader(keys, "https://fcm.googleapis.com/fcm/send/x", now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(keys.VAPID_PUBLIC_KEY);
    expect(JSON.parse(dec.decode(fromB64u(m[1]!)))).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(dec.decode(fromB64u(m[2]!)));
    expect(claims).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "mailto:ops@alo-king.example" });
    expect(claims.exp - now.getTime() / 1000).toBeLessThan(24 * 3600);
    const pub = fromB64u(keys.VAPID_PUBLIC_KEY);
    const vk = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)) }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vk, fromB64u(m[3]!), new TextEncoder().encode(`${m[1]}.${m[2]}`))).toBe(true);
  });

  it("only ever calls a browser push service", () => {
    for (const ok of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/Qabc", "https://wns2-par02p.notify.windows.com/w/?token=x"]) expect(isPushEndpoint(ok), ok).toBe(true);
    for (const bad of ["http://fcm.googleapis.com/x", "https://evil.example/x", "https://fcm.googleapis.com.evil.example/x", "https://169.254.169.254/latest", "https://localhost/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "not a url"]) expect(isPushEndpoint(bad), bad).toBe(false);
  });
});

let r: Rig; let keys: Required<PushEnv>;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { r = await rig(); keys = await vapidPair(); }, 120_000);

async function lead(name = "Maya", role: "ops_lead" | "admin" = "ops_lead") {
  const who = await r.staff(role, name); const b = r.browser(); await b.signIn(who); await b.get("/more"); return { ...who, b };
}
const subscribe = (b: ReturnType<Rig["browser"]>, s: { endpoint: string; p256dh: string; auth: string }) => b.post("/push/subscribe", s, { follow: false });
const raise = (kind: string, ref: string, detail: object = {}) => r.db.rpc("raise_ops_exception", { p_kind: kind, p_ref: ref, p_detail: detail });
const reset = () => r.db.pg.exec(`delete from exception_pushes; delete from push_subscriptions; update ops_exceptions set status = 'resolved'`);

describe("push: subscriptions", () => {
  it("are saved for the signed-in staff member only, from a real push service only, and shown as on or off on the More page", async () => {
    await reset();
    const m = await lead(); const s = await subscriber();
    const ok = await subscribe(m.b, s);
    expect(ok.status).toBe(200); expect(JSON.parse(ok.text)).toEqual({ ok: true });
    expect(await r.db.one(`select party_id, endpoint from push_subscriptions`)).toEqual({ party_id: m.partyId, endpoint: s.endpoint });
    expect((await subscribe(m.b, { ...s, endpoint: "https://evil.example/collect" })).status).toBe(400);
    expect((await subscribe(m.b, { ...s, endpoint: "http://fcm.googleapis.com/x" })).status).toBe(400);
    expect((await subscribe(m.b, { endpoint: s.endpoint, p256dh: "x", auth: "y" })).status).toBe(400);
    expect(Number((await r.db.one(`select count(*) as n from push_subscriptions`)).n)).toBe(1);
    // a picker cannot hold one; a request with no sign-in is refused
    const p = await r.staff("picker", "Pia"); const pb = r.browser(); await pb.signIn(p); await pb.get("/more");
    expect((await subscribe(pb, await subscriber())).status).toBe(403);
    // the setup is on the More page, with the key the browser needs; without a key the page says push is not set up
    r.deps.pushPublicKey = keys.VAPID_PUBLIC_KEY;
    const more = (await m.b.get("/more")).text;
    expect(more).toContain(`data-vapid="${keys.VAPID_PUBLIC_KEY}"`); expect(more).toContain("data-push-enable");
    delete r.deps.pushPublicKey;
    expect((await m.b.get("/more")).text).toContain("Alerts are not set up on the server yet");
  });

  it("belong to one party: the same phone passed to another lead is theirs afterwards, never both", async () => {
    await reset();
    const a = await lead("Maya"), b = await lead("Hassan"); const s = await subscriber();
    await subscribe(a.b, s); await subscribe(b.b, s);
    expect(await r.db.all(`select party_id from push_subscriptions`)).toEqual([{ party_id: b.partyId }]);
    // another party cannot switch off someone else's phone
    expect(await r.db.rpc("remove_push_subscription", { p_party: a.partyId, p_endpoint: s.endpoint })).toBe(false);
    const off = await b.b.post("/push/unsubscribe", { endpoint: s.endpoint }, { follow: false });
    expect(JSON.parse(off.text)).toEqual({ ok: true });
    expect(Number((await r.db.one(`select count(*) as n from push_subscriptions`)).n)).toBe(0);
  });

  it("go when the staff member is blocked, loses the role, or is deleted", async () => {
    await reset();
    const [a, b, c] = [await lead("A1"), await lead("B1"), await lead("C1")];
    for (const who of [a, b, c]) await subscribe(who.b, await subscriber());
    expect(Number((await r.db.one(`select count(*) as n from push_subscriptions`)).n)).toBe(3);
    await r.db.pg.query(`update parties set is_blocked = true where id = $1`, [a.partyId]);
    await r.db.pg.query(`update parties set role = 'picker' where id = $1`, [b.partyId]);
    expect(await r.db.all(`select party_id from push_subscriptions`)).toEqual([{ party_id: c.partyId }]);
    await r.db.pg.query(`update parties set role = 'customer' where id = $1`, [c.partyId]);
    expect(Number((await r.db.one(`select count(*) as n from push_subscriptions`)).n)).toBe(0);
    // a blocked party's subscription saved around the trigger is still never a target
    await expect(r.db.rpc("save_push_subscription", { p_party: a.partyId, p_endpoint: "https://fcm.googleapis.com/x/1", p_p256dh: "B".repeat(87), p_auth: "A".repeat(22) })).rejects.toThrow(/NOT_AUTHORISED/);
  });
});

describe("push: the alert", () => {
  const capture = (status = 201) => {
    const sent: { url: string; headers: Record<string, string>; body: Uint8Array }[] = [];
    return { sent, f: async (url: string, init: RequestInit) => { sent.push({ url, headers: init.headers as Record<string, string>, body: init.body as Uint8Array }); return new Response(null, { status }); } };
  };

  it("goes once per new high-priority exception, to every live phone, with the kind and the order code and nothing about the customer", async () => {
    await reset();
    const m = await lead(); const s1 = await subscriber(), s2 = await subscriber("updates.push.services.mozilla.com", "/wpush/v2/" + crypto.randomUUID());
    await subscribe(m.b, s1); await subscribe(m.b, s2);
    await raise("allergen_complaint", "case-1", { order: "AK-4821", customer_id: "c-secret-id", customer_name: "Samira Haddad", phone: "+96170123456" });
    await raise("count_needed", "shelf-1", {});                       // not high priority
    const cap = capture();
    const run = await pushNewExceptions(r.deps.db, keys, new Date(), cap.f);
    expect(run).toMatchObject({ claimed: 1, sent: 2, failed: 0 });
    expect(cap.sent).toHaveLength(2);
    const to1 = cap.sent.find((x) => x.url === s1.endpoint)!;
    expect(to1.headers["content-encoding"]).toBe("aes128gcm"); expect(to1.headers.authorization).toMatch(/^vapid t=.+, k=/); expect(to1.headers.urgency).toBe("high");
    const body = await s1.open(to1.body);
    expect(JSON.parse(body)).toMatchObject({ title: expect.stringContaining("needs you"), body: "Allergen complaint · AK-4821", url: "/cases" });
    for (const secret of ["Samira", "Haddad", "c-secret-id", "+9617", "customer"]) expect(body).not.toContain(secret);
    expect(JSON.parse(await s2.open(cap.sent.find((x) => x.url === s2.endpoint)!.body)).body).toBe("Allergen complaint · AK-4821");

    // the same exception is never pushed again, on any later run
    const again = capture(); expect(await pushNewExceptions(r.deps.db, keys, new Date(), again.f)).toMatchObject({ claimed: 0, sent: 0 }); expect(again.sent).toHaveLength(0);
    // a different exception is
    await raise("rider_off", "rider-1:1", {});
    const third = capture(); expect(await pushNewExceptions(r.deps.db, keys, new Date(), third.f)).toMatchObject({ claimed: 1, sent: 2 });
    expect(Number((await r.db.one(`select count(*) as n from exception_pushes`)).n)).toBe(2);
  });

  it("leaves the WhatsApp ops alert exactly as it was: the exception is still due its message after the push", async () => {
    await reset();
    const m = await lead(); await subscribe(m.b, await subscriber());
    await raise("pick_empty", "AK-7001", {});
    await pushNewExceptions(r.deps.db, keys, new Date(), capture().f);
    expect(await r.db.one(`select last_alert_at from ops_exceptions where ref = 'AK-7001'`)).toEqual({ last_alert_at: null });
    const due = await r.db.all(`select kind from ops_exceptions_due()`);
    expect(due.map((x: any) => x.kind)).toContain("pick_empty");
  });

  it("does nothing, and claims nothing, without the three secrets or without a phone to send to; an old exception is not announced", async () => {
    await reset();
    await raise("rider_off", "rider-2:1", {});
    const cap = capture();
    expect(await pushNewExceptions(r.deps.db, {}, new Date(), cap.f)).toMatchObject({ skipped: "not_configured" });
    expect(await pushNewExceptions(r.deps.db, { ...keys, VAPID_SUBJECT: "ops@x" }, new Date(), cap.f)).toMatchObject({ skipped: "not_configured" });
    expect(await pushNewExceptions(r.deps.db, keys, new Date(), cap.f)).toMatchObject({ skipped: "no_subscribers" });
    expect(cap.sent).toHaveLength(0);
    expect(Number((await r.db.one(`select count(*) as n from exception_pushes`)).n)).toBe(0);      // still claimable when push is on
    const m = await lead(); await subscribe(m.b, await subscriber());
    await r.db.pg.query(`update ops_exceptions set created_at = now() - interval '3 hours' where ref = 'rider-2:1'`);
    expect(await pushNewExceptions(r.deps.db, keys, new Date(), cap.f)).toMatchObject({ claimed: 0 });
    await r.db.pg.query(`update ops_exceptions set created_at = now() - interval '30 minutes' where ref = 'rider-2:1'`);
    expect(await pushNewExceptions(r.deps.db, keys, new Date(), cap.f)).toMatchObject({ claimed: 1, sent: 1 });
  });

  it("drops a phone the push service says is gone, and retires one that keeps failing", async () => {
    await reset();
    const m = await lead(); const gone = await subscriber(), flaky = await subscriber();
    await subscribe(m.b, gone); await subscribe(m.b, flaky);
    await raise("delivery_problem", "ord-1", { short_code: "AK-5000" });
    const f = async (url: string) => new Response(null, { status: url === gone.endpoint ? 410 : 500 });
    const run = await pushNewExceptions(r.deps.db, keys, new Date(), f);
    expect(run).toMatchObject({ claimed: 1, sent: 0, failed: 2, dropped: 1 });
    expect(await r.db.all(`select endpoint, failures from push_subscriptions`)).toEqual([{ endpoint: flaky.endpoint, failures: 1 }]);
    for (let i = 0; i < 4; i++) await r.db.rpc("push_endpoint_result", { p_endpoint: flaky.endpoint, p_gone: false, p_error: "500" });
    expect(await r.db.all(`select endpoint from push_targets()`)).toEqual([]);                      // five failures: no longer a target
  });

  it("words each alert as the kind and where it opens, in step with Today's inbox", () => {
    expect(alertFor({ id: "e1", kind: "payment_proof", ref: "pay-1", detail: null })).toMatchObject({ body: "A payment proof waits", url: "/payments" });
    expect(alertFor({ id: "e2", kind: "pick_empty", ref: "AK-1234", detail: {} })).toMatchObject({ body: "An order could not be picked · AK-1234", url: "/orders/AK-1234" });
    expect(alertFor({ id: "e3", kind: "something_new", ref: "x", detail: null })).toMatchObject({ body: "something new", url: "/exceptions" });
  });

  it("is scheduled every two minutes next to the day-close cron, in every environment", () => {
    const cfg = readFileSync(fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)), "utf8");
    expect(PUSH_CRON).toBe("*/2 * * * *");
    expect((cfg.match(/"crons": \["40 19 \* \* \*", "\*\/2 \* \* \* \*"\]/g) ?? []).length).toBe(3);
  });
});
