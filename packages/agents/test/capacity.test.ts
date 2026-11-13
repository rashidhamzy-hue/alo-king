import { describe, expect, it } from "vitest";
import { isCapacityError, ModelUnavailable, withCapacityFallback } from "../src/capacity";
import type { ModelClient } from "../src/concierge";

const err = (status: number | undefined, name = "APIError", message = "") => Object.assign(new Error(message), { status, name });
function flaky(failures: unknown[]) {
  let calls = 0;
  const client: ModelClient = { messages: { create: async () => {
    const f = failures[calls++];
    if (f) throw f;
    return { content: [], usage: { input_tokens: 1, output_tokens: 1 } } as any;
  } } };
  return { client, calls: () => calls };
}

describe("model capacity", () => {
  it("knows a capacity failure from a mistake of ours", () => {
    for (const e of [err(529, "OverloadedError"), err(429, "RateLimitError"), err(500), err(503), err(undefined, "APIConnectionTimeoutError", "Request timed out.")])
      expect(isCapacityError(e)).toBe(true);
    for (const e of [err(400, "BadRequestError"), err(401), err(404), new TypeError("x is undefined")]) expect(isCapacityError(e)).toBe(false);
  });

  it("says 'one moment' once, retries with backoff, and returns the answer when the model comes back", async () => {
    const m = flaky([err(529), err(529)]);
    const waits: number[] = []; let warned = 0;
    const c = withCapacityFallback(m.client, { backoffMs: [10, 20, 30], sleep: async (ms) => void waits.push(ms), onFirstFailure: async () => void warned++ });
    await c.messages.create({} as any);
    expect(m.calls()).toBe(3); expect(waits).toEqual([10, 20]); expect(warned).toBe(1);
  });

  it("gives up after the last retry with ModelUnavailable", async () => {
    const m = flaky(Array(9).fill(err(529)));
    const c = withCapacityFallback(m.client, { backoffMs: [1, 1, 1], sleep: async () => {}, onFirstFailure: async () => {} });
    await expect(c.messages.create({} as any)).rejects.toBeInstanceOf(ModelUnavailable);
    expect(m.calls()).toBe(4);
  });

  it("does not retry or warn on a bad request", async () => {
    const m = flaky([err(400, "BadRequestError")]); let warned = 0;
    const c = withCapacityFallback(m.client, { sleep: async () => {}, onFirstFailure: async () => void warned++ });
    await expect(c.messages.create({} as any)).rejects.toMatchObject({ status: 400 });
    expect(m.calls()).toBe(1); expect(warned).toBe(0);
  });
});
