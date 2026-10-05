import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { hmacHex, safeEq, verifyWebhook } from "./webhookauth.ts";

// the shared vitest setup runs in jsdom, whose `crypto` has no `subtle`: use Node's WebCrypto (the Deno runtime has it natively)
beforeAll(() => { if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true }); });
const enc = (s: string) => new TextEncoder().encode(s);
const BODY = JSON.stringify({ message: { from: "96170000001", text: { body: "hi" } } });
// Fake secrets for tests only.
const SHARED = "shared-secret-for-tests", SIGNING = "signing-secret-for-tests";
const base = { rawBody: enc(BODY), signatureHeader: null as string | null, secretHeader: null as string | null, queryKey: null as string | null, sharedSecret: SHARED, signingSecret: SIGNING };

describe("hmacHex (HMAC-SHA256, lowercase hex: what Kapso sends in X-Webhook-Signature)", () => {
  it("matches the RFC-style known vector", async () => {
    expect(await hmacHex("key", enc("The quick brown fox jumps over the lazy dog"))).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });
  it("signs the exact bytes, including non-ASCII (Arabic text)", async () => {
    const a = await hmacHex(SIGNING, enc('{"t":"شاورما"}')), b = await hmacHex(SIGNING, enc('{"t":"شاورما "}'));
    expect(a).toMatch(/^[0-9a-f]{64}$/); expect(a).not.toBe(b);
  });
});

describe("safeEq (constant-time string compare)", () => {
  it("equal, different, different length, empty, non-ASCII", () => {
    expect(safeEq("abc", "abc")).toBe(true); expect(safeEq("abc", "abd")).toBe(false); expect(safeEq("abc", "abcd")).toBe(false);
    expect(safeEq("", "")).toBe(true); expect(safeEq("", "a")).toBe(false); expect(safeEq("é", "é")).toBe(true); expect(safeEq("é", "e")).toBe(false);
  });
});

describe("verifyWebhook", () => {
  it("a valid signature over the raw body is accepted (method: signature)", async () => {
    const sig = await hmacHex(SIGNING, enc(BODY));
    expect(await verifyWebhook({ ...base, signatureHeader: sig })).toEqual({ ok: true, method: "signature" });
  });
  it("uppercase hex and a 'sha256=' prefix are tolerated", async () => {
    const sig = await hmacHex(SIGNING, enc(BODY));
    expect((await verifyWebhook({ ...base, signatureHeader: sig.toUpperCase() })).ok).toBe(true);
    expect((await verifyWebhook({ ...base, signatureHeader: `sha256=${sig}` })).ok).toBe(true);
  });
  it("a signature over a different body (tampering) is rejected", async () => {
    const sig = await hmacHex(SIGNING, enc(BODY));
    expect((await verifyWebhook({ ...base, rawBody: enc(BODY.replace("hi", "hello")), signatureHeader: sig })).ok).toBe(false);
  });
  it("a signature made with the wrong secret is rejected", async () => {
    expect((await verifyWebhook({ ...base, signatureHeader: await hmacHex("someone-else", enc(BODY)) })).ok).toBe(false);
  });
  it("garbage, empty and wrong-length signatures never throw", async () => {
    for (const s of ["", "zz", "x".repeat(10), "x".repeat(64), "é".repeat(64)]) expect((await verifyWebhook({ ...base, signatureHeader: s })).ok).toBe(false);
  });
  it("the header secret works (x-webhook-secret)", async () => {
    expect(await verifyWebhook({ ...base, secretHeader: SHARED })).toEqual({ ok: true, method: "header" });
    expect((await verifyWebhook({ ...base, secretHeader: "wrong" })).ok).toBe(false);
  });
  it("the legacy ?key= still works until the owner confirms the new method", async () => {
    expect(await verifyWebhook({ ...base, queryKey: SHARED })).toEqual({ ok: true, method: "query" });
    expect((await verifyWebhook({ ...base, queryKey: "wrong" })).ok).toBe(false);
  });
  it("during the transition an invalid or missing signature does not block a valid ?key=", async () => {
    expect((await verifyWebhook({ ...base, signatureHeader: "deadbeef", queryKey: SHARED })).method).toBe("query");
    expect((await verifyWebhook({ ...base, signatureHeader: null, queryKey: SHARED })).ok).toBe(true);
  });
  it("with a valid signature AND a valid ?key= the signature is the method reported (so the owner can see the switch worked)", async () => {
    const sig = await hmacHex(SIGNING, enc(BODY));
    expect((await verifyWebhook({ ...base, signatureHeader: sig, queryKey: SHARED })).method).toBe("signature");
  });
  it("nothing valid: rejected, with a reason that names no secret", async () => {
    const r = await verifyWebhook({ ...base, signatureHeader: "deadbeef", queryKey: "nope", secretHeader: "nope" });
    expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toContain(SHARED); expect(JSON.stringify(r)).not.toContain(SIGNING);
  });
  it("a signature header is ignored when no signing secret is configured (it cannot be checked)", async () => {
    const sig = await hmacHex(SIGNING, enc(BODY));
    expect((await verifyWebhook({ ...base, signingSecret: "", signatureHeader: sig })).ok).toBe(false);
    expect((await verifyWebhook({ ...base, signingSecret: "", signatureHeader: sig, queryKey: SHARED })).method).toBe("query");
  });
  it("no secrets configured at all keeps the old behaviour: open", async () => {
    expect(await verifyWebhook({ ...base, sharedSecret: "", signingSecret: "" })).toEqual({ ok: true, method: "none" });
  });
  it("only a signing secret configured: the signature (or nothing else) decides", async () => {
    const sig = await hmacHex(SIGNING, enc(BODY));
    expect((await verifyWebhook({ ...base, sharedSecret: "", signatureHeader: sig })).ok).toBe(true);
    expect((await verifyWebhook({ ...base, sharedSecret: "", queryKey: "x" })).ok).toBe(false);
  });
  it("an empty configured secret never matches an empty presented value", async () => {
    expect((await verifyWebhook({ ...base, sharedSecret: SHARED, queryKey: "", secretHeader: "" })).ok).toBe(false);
  });
});

describe("index.ts wiring (source checks)", () => {
  const src = require("node:fs").readFileSync(require("node:path").resolve(process.cwd(), "supabase/functions/kapso-brain/index.ts"), "utf8");
  it("verifies through verifyWebhook on the raw bytes, not a plain !== on the query key", () => {
    expect(src).toContain("verifyWebhook(");
    expect(src).not.toMatch(/given !== WEBHOOK_SECRET/);
    expect(src).toMatch(/arrayBuffer\(\)/);
  });
  it("logs only the method that matched, never a secret or the key", () => {
    const lines = src.split("\n").filter((l: string) => /console\.(log|error)/.test(l) && /webhook_auth|WEBHOOK_SECRET|SIGNING_SECRET|searchParams\.get\("key"\)/.test(l));
    for (const l of lines) { expect(l).toContain("webhook_auth"); expect(l).not.toMatch(/WEBHOOK_SECRET|SIGNING_SECRET|"key"/); }
  });
});
