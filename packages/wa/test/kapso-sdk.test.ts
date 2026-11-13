// Task 4.13: the official Kapso SDK inside packages/wa/src/kapso.ts. It is kept only if nothing we send or read changes.
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyKapsoWebhookSignature } from "@kapso/whatsapp-cloud-api/server";
import { askLocation, buttons, kapsoSend, KapsoSendError, list, verifySignature, type Outbound } from "../src/kapso";
import { OutboxUnavailable, send, SendNotDelivered, type SendRequest } from "../src/gateway";
import { loadFixtures } from "./fixtures";

const env = { KAPSO_BASE_URL: "https://api.kapso.ai/meta/whatsapp/v24.0", KAPSO_API_KEY: "test-key" };
const ok = () => new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ input: "x", wa_id: "x" }], messages: [{ id: "wamid.SDK1" }] }), { status: 200, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

/** What the hand-written client sent before 4.13, byte for byte. */
const before = (to: string, msg: Outbound) => ({ messaging_product: "whatsapp", recipient_type: "individual", to, ...msg });

describe("same sends", () => {
  const cases: [string, Outbound][] = [
    ["text", { type: "text", text: { body: "طلبك #A1B2 صار عالطريق 🛵" } }],
    ["buttons", buttons("تأكيد الطلب؟", [{ id: "o:confirm:123", title: "تأكيد الطلب" }, { id: "o:cancel:123", title: "إلغاء" }])],
    ["list", list("اختار", "خيارات", [{ id: "r1", title: "لبنة", description: "$3.50" }])],
    ["location request", askLocation("ابعتلنا موقعك")],
    ["location", { type: "location", location: { latitude: 33.68, longitude: 35.58, name: "#A1B2" } }],
    ["template", { type: "template", template: { name: "ak_order_cancelled_v1", language: { code: "ar" }, components: [{ type: "body", parameters: [{ type: "text", text: "A1B2" }] }] } }],
  ];
  it.each(cases)("%s: same URL, same API key header, same JSON body as before", async (_n, msg) => {
    const fetchMock = vi.fn(async (_u: string, _i: RequestInit) => ok());
    vi.stubGlobal("fetch", fetchMock);
    expect(await kapsoSend(env, "1378974041965966", "96170000001", msg)).toBe("wamid.SDK1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.kapso.ai/meta/whatsapp/v24.0/1378974041965966/messages");
    expect(init.method).toBe("POST");
    expect(init.redirect).not.toBe("error");                 // Cloudflare's runtime rejects "error" (4.5 found it)
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("test-key");
    expect(JSON.parse(String(init.body))).toEqual(before("96170000001", msg));
  });
});

it("a redirect is refused, not followed", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.invalid/" } })));
  await expect(kapsoSend(env, "1", "2", { type: "text", text: { body: "x" } })).rejects.toThrow(/KAPSO_REDIRECT_302/);
});

it("reads the message id even when the response has no JSON content type", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.PLAIN" }] }), { status: 200 })));
  expect(await kapsoSend(env, "1", "2", { type: "text", text: { body: "x" } })).toBe("wamid.PLAIN");
});

describe("typed errors with a retry hint", () => {
  const fail = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
  it("outside the 24-hour window (131047): permanent", async () => {
    fail(400, { error: { message: "Re-engagement message", type: "OAuthException", code: 131047 } });
    const e = await kapsoSend(env, "1", "2", { type: "text", text: { body: "x" } }).catch((x) => x);
    expect(e).toBeInstanceOf(KapsoSendError);
    expect(e).toMatchObject({ httpStatus: 400, code: "131047", retry: "do_not_retry", permanent: true });
  });
  it("rate limited: retry later", async () => {
    fail(429, { error: { message: "Too many", code: 130429 } });
    const e = await kapsoSend(env, "1", "2", { type: "text", text: { body: "x" } }).catch((x) => x);
    expect(e.permanent).toBe(false);
  });
  it("server error: retry", async () => {
    fail(503, { error: { message: "unavailable" } });
    expect((await kapsoSend(env, "1", "2", { type: "text", text: { body: "x" } }).catch((x) => x)).permanent).toBe(false);
  });
  it("Kapso credits exhausted (402): always retry, never dropped", async () => {
    fail(402, { error: { message: "service_credits_exhausted" } });
    expect((await kapsoSend(env, "1", "2", { type: "text", text: { body: "x" } }).catch((x) => x)).permanent).toBe(false);
  });
});

describe("the gateway uses the hint", () => {
  const req: SendRequest = { line: "customer", partyId: "p1", to: "96170000001", category: "service", dedupeKey: "turn-9:0", msg: { type: "text", text: { body: "x" } } };
  const db = () => {
    const calls: { fn: string; args?: unknown }[] = [];
    return { calls, rpc: async (fn: string, args?: unknown) => { calls.push({ fn, args }); return { data: fn === "can_send" ? "ok" : fn === "outbox_claim" ? true : null, error: null }; },
      from: () => ({ insert: async (row: unknown) => { calls.push({ fn: "insert", args: row }); return { error: null }; } }) } as any;
  };
  it("a permanent refusal is recorded and the turn goes on (no throw, no retry storm)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Re-engagement", code: 131047 } }), { status: 400, headers: { "content-type": "application/json" } })));
    const d = db();
    expect(await send(d, env as any, req)).toEqual({ ok: false, refused: "kapso_131047" });
    expect(d.calls.find((c: any) => c.fn === "outbox_mark").args).toMatchObject({ p_key: "turn-9:0", p_wamid: null });
  });
  it("a passing failure still throws, so the turn retries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } })));
    const e = await send(db(), env as any, req).catch((x) => x);
    expect(e).toBeInstanceOf(SendNotDelivered);              // an OutboxUnavailable: turn.ts rethrows it and the turn retries
    expect(e).toBeInstanceOf(OutboxUnavailable);
    expect(e.cause).toBeInstanceOf(KapsoSendError);
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
