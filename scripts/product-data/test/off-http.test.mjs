// Open Food Facts over HTTP: the address, who we say we are, what a 404 and a 429 mean, and that a failure is never "not found".
import { describe, expect, it } from "vitest";
import { offLookup, OFF_FIELDS } from "../lib/off.mjs";
import { fetchRetry, gate, UA } from "../lib/http.mjs";
import { callTool, Fatal, newUsage } from "../lib/anthropic.mjs";

const res = (status, body, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

describe("offLookup", () => {
  it("asks the v2 product address by digits only, for the fields we file, and identifies the tool", async () => {
    const seen = [];
    const r = await offLookup("8076-8020 85738", { fetchImpl: async (u, o) => { seen.push([u, o.headers["user-agent"]]); return res(200, { status: 1, product: { code: "8076802085738", product_name: "x" } }); } });
    expect(r.found).toBe(true);
    expect(seen[0][0]).toBe(`https://world.openfoodfacts.org/api/v2/product/8076802085738.json?fields=${OFF_FIELDS}`);
    expect(seen[0][1]).toBe(UA);
    expect(UA).toMatch(/AloKing-product-data/);
    expect(UA).not.toMatch(/@|gmail/i);
  });
  it("404 and status 0 are 'not in Open Food Facts'; a barcode that is too short is not asked", async () => {
    expect(await offLookup("8076802085738", { fetchImpl: async () => res(404, { status: 0 }) })).toEqual({ found: false, reason: "not_in_off" });
    expect(await offLookup("8076802085738", { fetchImpl: async () => res(200, { status: 0, status_verbose: "product not found" }) })).toEqual({ found: false, reason: "not_in_off" });
    let asked = 0;
    expect(await offLookup("123", { fetchImpl: async () => { asked++; return res(200, {}); } })).toEqual({ found: false, reason: "no_barcode" });
    expect(asked).toBe(0);
  });
  it("a different product than the one asked for is not used (it drops leading zeros, nothing else)", async () => {
    expect((await offLookup("0012345678905", { fetchImpl: async () => res(200, { status: 1, product: { code: "12345678905" } }) })).found).toBe(true);
    expect(await offLookup("0012345678905", { fetchImpl: async () => res(200, { status: 1, product: { code: "99999999999" } }) })).toEqual({ found: false, reason: "code_mismatch" });
  });
  it("a refusal or a server error is an error, never 'not found'", async () => {
    await expect(offLookup("8076802085738", { fetchImpl: async () => res(403, "no") })).rejects.toThrow("off_http_403");
    await expect(offLookup("8076802085738", { fetchImpl: async () => res(500, "x") })).rejects.toThrow(/500/);
  });
  it("429 is waited out: the retry goes through the same gate, and Retry-After is honoured", async () => {
    let n = 0; const waits = []; const slept = [];
    const wait = async () => { waits.push(n); };
    const fetchImpl = async () => (++n < 3 ? res(429, "slow", { "retry-after": "2" }) : res(200, { status: 1, product: { code: "8076802085738" } }));
    const { fetchRetry: fr } = await import("../lib/http.mjs");
    const out = await fr("https://x.test", {}, { fetchImpl, retries: 3, wait, sleep: async (ms) => { slept.push(ms); } });
    expect(out.status).toBe(200);
    expect(slept).toEqual([2000, 2000]);
    expect(waits).toEqual([1, 2]);              // before the second and third request, not the first (the caller waits for that one)
  });
});

describe("gate", () => {
  it("spaces calls at least the interval apart, whoever asks", async () => {
    const g = gate(60); const t0 = Date.now(); const at = [];
    await Promise.all([1, 2, 3].map(async () => { await g(); at.push(Date.now() - t0); }));
    at.sort((a, b) => a - b);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(50); expect(at[2] - at[1]).toBeGreaterThanOrEqual(50);
  });
});

describe("callTool", () => {
  const tool = { name: "t", description: "d", input_schema: { type: "object" } };
  it("forces the tool, counts tokens, and returns the tool's input", async () => {
    const usage = newUsage(); let body;
    const out = await callTool({ apiKey: "k", model: "m", system: "s", tool, content: "c", usage, fetchImpl: async (u, o) => { body = JSON.parse(o.body); return res(200, { content: [{ type: "tool_use", name: "t", input: { a: 1 } }], usage: { input_tokens: 10, output_tokens: 5 } }); } });
    expect(out).toEqual({ a: 1 });
    expect(body.tool_choice).toEqual({ type: "tool", name: "t" });
    expect(usage).toEqual({ calls: 1, input_tokens: 10, output_tokens: 5 });
  });
  it("a bad key or request is fatal (stop the run); a missing tool call is an ordinary error", async () => {
    await expect(callTool({ apiKey: "k", model: "m", system: "s", tool, content: "c", fetchImpl: async () => res(401, "nope") })).rejects.toBeInstanceOf(Fatal);
    await expect(callTool({ apiKey: "k", model: "m", system: "s", tool, content: "c", fetchImpl: async () => res(200, { content: [{ type: "text", text: "hi" }] }) })).rejects.toThrow("model_no_tool_call");
  });
});
