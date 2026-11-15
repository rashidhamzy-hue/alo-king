// OPS1, item 7. On 15 November 2026 the model provider answered every call with
//   400 invalid_request_error "You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC."
// and the code handled it like any bug of ours: a hand-off row, no alert. An account refusal gets its own exception kind.
import { describe, expect, it } from "vitest";
import { ModelAccountRefused, modelAccountReason, withAccountAlarm } from "../src/model-account";
import { isCapacityError } from "../src/capacity";
import type { ModelClient } from "../src/concierge";

const err = (status: number | undefined, message = "", name = "APIError") => Object.assign(new Error(message), { status, name });
const TODAY = err(400, `400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC."},"request_id":"req_x"}`, "BadRequestError");

describe("which refusals are about the account", () => {
  it("the 15 November refusal is a usage limit", () => expect(modelAccountReason(TODAY)).toBe("usage_limit"));

  it("a spent balance is billing, a bad or revoked key is invalid_key", () => {
    expect(modelAccountReason(err(400, `{"error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}`, "BadRequestError"))).toBe("billing");
    expect(modelAccountReason(err(402, "Payment required"))).toBe("billing");
    expect(modelAccountReason(err(401, `{"error":{"type":"authentication_error","message":"invalid x-api-key"}}`, "AuthenticationError"))).toBe("invalid_key");
    expect(modelAccountReason(err(403, `{"error":{"type":"permission_error","message":"Your API key does not have permission to use the specified resource."}}`, "PermissionDeniedError"))).toBe("invalid_key");
    expect(modelAccountReason(err(401, "This organization has been disabled."))).toBe("invalid_key");
  });

  it("a spend limit that comes back as 429 is a usage limit, but an ordinary rate limit is not", () => {
    expect(modelAccountReason(err(429, "You have exceeded your workspace's monthly spend limit."))).toBe("usage_limit");
    expect(modelAccountReason(err(429, "Number of request tokens has exceeded your per-minute rate limit", "RateLimitError"))).toBeNull();
  });

  it("our own mistakes and capacity trouble are not account trouble", () => {
    for (const e of [err(400, "messages.0.content: Input should be a valid list", "BadRequestError"), err(404, "model: claude-x not found"), err(413, "too large"),
                     err(500), err(529, "Overloaded", "OverloadedError"), err(undefined, "Request timed out.", "APIConnectionTimeoutError"), new TypeError("x is undefined"), null, "usage"])
      expect(modelAccountReason(e)).toBeNull();
  });

  it("is not caught by the capacity retry: a limit does not clear in twenty seconds", () => {
    expect(isCapacityError(TODAY)).toBe(false);
  });
});

describe("the wrapper around the model client", () => {
  const failing = (e: unknown): ModelClient => ({ messages: { create: async () => { throw e; } } });
  const ok: ModelClient = { messages: { create: async () => ({ content: [], usage: { input_tokens: 1, output_tokens: 1 } }) as never } };

  it("reports an account refusal once per refused call, with the reason and the provider's words, and throws ModelAccountRefused", async () => {
    const seen: { reason: string; message: string }[] = [];
    const c = withAccountAlarm(failing(TODAY), async (reason, message) => void seen.push({ reason, message }));
    const caught = await c.messages.create({} as never).catch((e) => e);
    expect(caught).toBeInstanceOf(ModelAccountRefused);
    expect((caught as ModelAccountRefused).reason).toBe("usage_limit");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.message).toContain("regain access on 2026-12-01");
  });

  it("passes other errors through untouched and reports nothing", async () => {
    const seen: string[] = [];
    const bug = err(400, "messages: bad shape", "BadRequestError");
    const c = withAccountAlarm(failing(bug), async (r) => void seen.push(r));
    await expect(c.messages.create({} as never)).rejects.toBe(bug);
    expect(seen).toEqual([]);
  });

  it("a good call passes through", async () => {
    const seen: string[] = [];
    const c = withAccountAlarm(ok, async (r) => void seen.push(r));
    expect((await c.messages.create({} as never)).usage).toEqual({ input_tokens: 1, output_tokens: 1 });
    expect(seen).toEqual([]);
  });

  it("a failing report never hides the refusal, and a key never travels in the report", async () => {
    const seen: string[] = [];
    const withKey = err(401, "invalid x-api-key: sk-ant-api03-AbCdEfGh_ijkl-1234567890 was refused");
    const c = withAccountAlarm(failing(withKey), async (_r, m) => { seen.push(m); throw new Error("database down"); });
    await expect(c.messages.create({} as never)).rejects.toBeInstanceOf(ModelAccountRefused);
    expect(seen[0]).not.toContain("sk-ant-api03");
    expect(seen[0]).toContain("[key]");
  });
});
