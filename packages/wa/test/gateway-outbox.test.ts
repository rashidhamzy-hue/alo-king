// The gateway must never send when it cannot prove the message is its to send.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { send, preflight, OutboxUnavailable, type SendRequest } from "../src/gateway";

const env = { KAPSO_BASE_URL: "https://kapso.test", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "1", PHONE_NUMBER_ID_OPS: "2" };
const req: SendRequest = { line: "customer", partyId: "p1", to: "96170000001", category: "service", dedupeKey: "turn-1:0", msg: { type: "text", text: { body: "أهلا" } } as any };

type Claim = () => Promise<{ data: unknown; error: unknown }>;
function fakeDb(claim: Claim, opts: { markFails?: boolean } = {}) {
  const calls: string[] = [];
  const db = {
    calls,
    rpc(fn: string) {
      calls.push(fn);
      if (fn === "can_send") return Promise.resolve({ data: "ok", error: null });
      if (fn === "outbox_claim") return claim();
      if (fn === "outbox_mark") return opts.markFails ? Promise.reject(new Error("db down")) : Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from() { return { insert: () => Promise.resolve({ error: null }) }; },
  };
  return db as any;
}
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("outbound idempotency fails closed", () => {
  it("sends once on a successful claim", async () => {
    const db = fakeDb(async () => ({ data: true, error: null }));
    expect(await send(db, env, req)).toEqual({ ok: true, wamid: "wamid.1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.calls.filter((c: string) => c === "outbox_mark").length).toBe(1);
  });
  it("does not send a duplicate claim", async () => {
    const db = fakeDb(async () => ({ data: false, error: null }));
    expect(await send(db, env, req)).toEqual({ ok: true, wamid: "already_sent" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not send when the claim returns a database error", async () => {
    const db = fakeDb(async () => ({ data: null, error: { message: "connection refused" } }));
    await expect(send(db, env, req)).rejects.toBeInstanceOf(OutboxUnavailable);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not send when the claim throws", async () => {
    const db = fakeDb(async () => { throw new Error("network"); });
    await expect(send(db, env, req)).rejects.toBeInstanceOf(OutboxUnavailable);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not send when the claim answers with anything but true or false", async () => {
    const db = fakeDb(async () => ({ data: null, error: null }));
    await expect(send(db, env, req)).rejects.toBeInstanceOf(OutboxUnavailable);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not send when the claim times out", async () => {
    vi.useFakeTimers();
    const db = fakeDb(() => new Promise(() => {}));
    const p = send(db, env, req); const caught = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await caught).toBeInstanceOf(OutboxUnavailable);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("marks the outbox failed and rethrows when the provider fails, so the retry may send", async () => {
    fetchMock.mockImplementation(async () => new Response("boom", { status: 500 }));
    const db = fakeDb(async () => ({ data: true, error: null }));
    await expect(send(db, env, req)).rejects.toThrow();
    expect(db.calls).toContain("outbox_mark");
  });
  it("does not throw after the message is out, even if the bookkeeping fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb(async () => ({ data: true, error: null }), { markFails: true });
    expect(await send(db, env, req)).toEqual({ ok: true, wamid: "wamid.1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled(); err.mockRestore();
  });
});

describe("no key, no send", () => {
  it("refuses a send that carries no dedupe key, before the database or the provider is touched", async () => {
    const { dedupeKey: _drop, ...noKey } = req;
    const db = fakeDb(async () => ({ data: true, error: null }));
    expect(await send(db, env, noKey as SendRequest)).toEqual({ ok: false, refused: "missing_dedupe_key" });
    expect(fetchMock).not.toHaveBeenCalled(); expect(db.calls).not.toContain("outbox_claim");
  });
});

describe("pilot marketing lock in code", () => {
  it("refuses every marketing send before the database is asked", async () => {
    const m = { ...req, category: "marketing" as const, campaignId: "c1", msg: { type: "template", template: { name: "promo", language: { code: "ar" } } } as any };
    expect(preflight(m)).toBe("marketing_locked_pilot");
    const db = fakeDb(async () => ({ data: true, error: null }));
    expect(await send(db, env, m)).toEqual({ ok: false, refused: "marketing_locked_pilot" });
    expect(fetchMock).not.toHaveBeenCalled(); expect(db.calls).not.toContain("can_send");
  });
  it("still lets replies and order updates through preflight", () => {
    expect(preflight(req)).toBeNull();
    expect(preflight({ ...req, category: "utility", msg: { type: "template", template: { name: "order_update", language: { code: "ar" } } } as any })).toBeNull();
  });
});
