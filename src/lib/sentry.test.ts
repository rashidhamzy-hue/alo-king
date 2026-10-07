import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/react";
import { scrub } from "./sentry";

describe("sentry scrub", () => {
  it("masks phone numbers and drops query strings", () => {
    const e = scrub({
      type: undefined,
      message: "no order for +961 70 123 456",
      exception: { values: [{ value: "customer 96170123456 failed" }] },
      request: { url: "https://alo.example/track/abc?t=secret", query_string: "t=secret" },
    } as ErrorEvent);
    expect(e.message).toBe("no order for [phone]");
    expect(e.exception?.values?.[0]?.value).toBe("customer [phone] failed");
    expect(e.request?.url).toBe("https://alo.example/track/[token]");
    expect(e.request?.query_string).toBeUndefined();
  });

  it("masks local numbers, tracking tokens in paths, breadcrumbs and extra context", () => {
    const e = scrub({
      type: undefined,
      message: "call 03 123 456",
      request: { url: "https://aloking.com/track/eyJhbGciOi.sig?x=1", headers: { Referer: "r" } },
      breadcrumbs: [{ message: "sent to 70123456", data: { url: "/track/abc123?t=1" } }],
      extra: { phone: "+96170123456" },
    } as ErrorEvent);
    expect(e.message).toBe("call [phone]");
    expect(e.request?.url).toBe("https://aloking.com/track/[token]");
    expect(e.request?.headers).toBeUndefined();
    expect(e.breadcrumbs?.[0]?.message).toBe("sent to [phone]");
    expect(e.breadcrumbs?.[0]?.data?.url).toBe("/track/[token]");
    expect(e.extra).toEqual({ phone: "[phone]" });
  });
});
