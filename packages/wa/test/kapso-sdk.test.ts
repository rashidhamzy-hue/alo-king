// Task 4.13: the official Kapso SDK inside packages/wa/src/kapso.ts. It is kept only if nothing we send or read changes.
// Every send here goes through the gateway's send(), the one door out (invariant 1; CI greps for any other caller).
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyKapsoWebhookSignature } from "@kapso/whatsapp-cloud-api/server";
import { askLocation, buttons, KapsoSendError, list, verifySignature, type Outbound } from "../src/kapso";
import { OutboxUnavailable, send, SendNotDelivered, type SendRequest } from "../src/gateway";
import { loadFixtures } from "./fixtures";

const env = { KAPSO_BASE_URL: "https://api.kapso.ai/meta/whatsapp/v24.0", KAPSO_API_KEY: "test-key", PHONE_NUMBER_ID_CUSTOMER: "1378974041965966", PHONE_NUMBER_ID_OPS: "597907523413541" };
const ok = (id = "wamid.SDK1") => new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ input: "x", wa_id: "x" }], messages: [{ id }] }), { status: 200, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

/** A database that allows the send and records what the gateway asked of it. */
function fakeDb() {
  const calls: { fn: string; args?: any }[] = [];
  return { calls, rpc: async (fn: string, args?: unknown) => { calls.push({ fn, args }); return { data: fn === "can_send" ? "ok" : fn === "outbox_claim" ? true : null, error: null }; },
    from: () => ({ insert: async (row: unknown) => { calls.push({ fn: "insert", args: row }); return { error: null }; } }) } as any;
}
const req = (msg: Outbound, line: "customer" | "ops" = "customer"): SendRequest => ({ line, partyId: "p1", to: "96170000001", category: "service", dedupeKey: "turn-9:0", msg });
const text: Outbound = { type: "text", text: { body: "x" } };

/** What the hand-written client sent before 4.13, byte for byte. */
const before = (to: string, msg: Outbound) => ({ messaging_product: "whatsapp", recipient_type: "individual", to, ...msg });

describe("same sends", () => {
  const cases: [string, Outbound, "customer" | "ops"][] = [
    ["text", { type: "text", text: { body: "طلبك #A1B2 صار عالطريق 🛵" } }, "customer"],
    ["buttons", buttons("تأكيد الطلب؟", [{ id: "o:confirm:123", title: "تأكيد الطلب" }, { id: "o:cancel:123", title: "إلغاء" }]), "customer"],
    ["list", list("اختار", "خيارات", [{ id: "r1", title: "لبنة", description: "$3.50" }]), "customer"],
    ["location request", askLocation("ابعتلنا موقعك"), "customer"],
    ["location", { type: "location", location: { latitude: 33.68, longitude: 35.58, name: "#A1B2" } }, "ops"],
    ["template", { type: "template", template: { name: "ak_order_cancelled_v1", language: { code: "ar" }, components: [{ type: "body", parameters: [{ type: "text", text: "A1B2" }] }] } }, "customer"],
  ];
  it.each(cases)("%s: same URL, same API key header, same JSON body as before", async (_n, msg, line) => {
    const fetchMock = vi.fn(async (_u: string, _i: RequestInit) => ok());
    vi.stubGlobal("fetch", fetchMock);
    expect(await send(fakeDb(), env, req(msg, line))).toEqual({ ok: true, wamid: "wamid.SDK1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`https://api.kapso.ai/meta/whatsapp/v24.0/${line === "customer" ? env.PHONE_NUMBER_ID_CUSTOMER : env.PHONE_NUMBER_ID_OPS}/messages`);
    expect(init.method).toBe("POST");
    expect(init.redirect).not.toBe("error");                 // Cloudflare's runtime rejects "error" (4.5 found it)
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("test-key");
    expect(JSON.parse(String(init.body))).toEqual(before("96170000001", msg));
  });
});

it("a redirect is refused, not followed: the message did not go out, so the turn retries", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.invalid/" } })));
  const e = await send(fakeDb(), env, req(text)).catch((x) => x);
  expect(e).toBeInstanceOf(SendNotDelivered);
  expect(String(e.cause)).toMatch(/KAPSO_REDIRECT_302/);
});

it("reads the message id even when the response has no JSON content type", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.PLAIN" }] }), { status: 200 })));
  expect(await send(fakeDb(), env, req(text))).toEqual({ ok: true, wamid: "wamid.PLAIN" });
});

describe("typed errors with a retry hint", () => {
  const fail = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
  const cause = async () => { const e = await send(fakeDb(), env, req(text)).catch((x) => x); expect(e).toBeInstanceOf(SendNotDelivered); return e.cause as KapsoSendError; };

  it("outside the 24-hour window (131047): permanent, recorded, and the turn goes on (no throw, no retry storm)", async () => {
    fail(400, { error: { message: "Re-engagement message", type: "OAuthException", code: 131047 } });
    const d = fakeDb();
    expect(await send(d, env, req(text))).toEqual({ ok: false, refused: "kapso_131047" });
    expect(d.calls.find((c: any) => c.fn === "outbox_mark").args).toMatchObject({ p_key: "turn-9:0", p_wamid: null });
  });
  it("rate limited: retry later", async () => {
    fail(429, { error: { message: "Too many", code: 130429 } });
    const c = await cause();
    expect(c).toBeInstanceOf(KapsoSendError);
    expect(c.permanent).toBe(false);
  });
  it("server error: the turn retries (an OutboxUnavailable, which turn.ts rethrows)", async () => {
    fail(503, { error: { message: "unavailable" } });
    const e = await send(fakeDb(), env, req(text)).catch((x) => x);
    expect(e).toBeInstanceOf(OutboxUnavailable);
    expect(e.cause).toMatchObject({ httpStatus: 503, permanent: false });
  });
  it("Kapso credits exhausted (402): always retry, never dropped", async () => {
    fail(402, { error: { message: "service_credits_exhausted" } });
    expect((await cause()).permanent).toBe(false);
  });
});

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("webhook signature: our check and the SDK's agree on every fixture", () => {
  const secret = "f".repeat(64);
  const bodies = loadFixtures().map((f) => JSON.stringify(f.body));
  it("valid, tampered and malformed signatures", async () => {
    for (const raw of bodies) {
      const sig = await hmacHex(secret, raw);
      for (const [s, body] of [[sig, raw], [sig, raw + " "], ["0".repeat(64), raw], ["sha256=" + sig, raw]] as const) {
        const sdk = verifyKapsoWebhookSignature({ secret, rawBody: body, signatureHeader: s.replace(/^sha256=/, "") });
        expect(await verifySignature(body, s, secret)).toBe(sdk);
      }
    }
    expect(bodies.length).toBeGreaterThan(70);
  });
});
