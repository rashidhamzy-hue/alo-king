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
    expect(e.request?.url).toBe("https://alo.example/track/abc");
    expect(e.request?.query_string).toBeUndefined();
  });
});
