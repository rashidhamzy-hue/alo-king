import { describe, expect, it } from "vitest";
import { restRpc, retrySafe, RpcStalled } from "./rest-rpc";

// A fetch that answers on some calls and on the others never answers (until the request is aborted), like the
// 20-100 s stalls between the edge functions and the API gateway on staging (#139).
function fakeFetch(plan: ("ok" | "stall" | "stall-body" | "http500")[]) {
  const calls: string[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const step = plan[calls.length] ?? "ok";
    calls.push(String(url));
    const aborted = () =>
      new Promise<never>((_, reject) =>
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      );
    if (step === "stall") return aborted();
    if (step === "http500") return new Response('{"message":"boom"}', { status: 500 });
    if (step === "stall-body")
      // Headers arrive, the body never does.
      return { ok: true, status: 200, text: () => aborted() } as unknown as Response;
    return new Response(JSON.stringify({ fn: String(url).split("/").pop() }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const client = (f: typeof fetch, logs: string[] = []) =>
  restRpc({
    url: "https://x.supabase.co",
    key: "k",
    timeoutMs: 40,
    fetch: f,
    log: (m) => logs.push(m),
  });

describe("rest-rpc deadlines (#139)", () => {
  it("a stalled read is retried once on a new request and answers", async () => {
    const { f, calls } = fakeFetch(["stall", "ok"]);
    const logs: string[] = [];
    const started = Date.now();
    await expect(client(f, logs)("config_value", { p_key: "x" })).resolves.toEqual({
      fn: "config_value",
    });
    expect(calls).toHaveLength(2);
    expect(logs).toEqual(["rpc stalled"]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("a stalled write that is not idempotent is never sent twice: the caller gets RpcStalled", async () => {
    const { f, calls } = fakeFetch(["stall", "ok"]);
    const err = await client(f)("basket_add_item", {}).catch((e) => e);
    expect(err).toBeInstanceOf(RpcStalled);
    expect(err.fn).toBe("basket_add_item");
    expect(calls).toHaveLength(1);
  });

  it("the deadline also covers a body that never arrives", async () => {
    const { f } = fakeFetch(["stall-body", "stall-body"]);
    await expect(client(f)("whatsapp_sender", {})).rejects.toBeInstanceOf(RpcStalled);
  });

  it("an HTTP error from PostgREST is an answer: thrown as before, not retried", async () => {
    const { f, calls } = fakeFetch(["http500", "ok"]);
    await expect(client(f)("config_value", {})).rejects.toThrow(/config_value: 500/);
    expect(calls).toHaveLength(1);
  });

  it("only reads and idempotent writes are retry-safe", () => {
    expect(retrySafe("config_value")).toBe(true);
    expect(retrySafe("whatsapp_seen")).toBe(true);
    expect(retrySafe("order_place")).toBe(false);
    expect(retrySafe("order_accept")).toBe(false);
    expect(retrySafe("customer_turn_begin")).toBe(false);
  });
});
