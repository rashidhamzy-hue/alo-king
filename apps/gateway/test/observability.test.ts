import { describe, expect, it } from "vitest";
import { scrubEvent, scrubString } from "../src/observability";

describe("error tracking scrubbing", () => {
  it("removes phone numbers in any spelling", () => {
    for (const n of ["96171234567", "+961 71 234 567", "+961-71-234-567", "(961) 71 234567"]) expect(scrubString(`failed for ${n} today`)).toBe("failed for [number] today");
  });
  it("keeps short numbers such as order codes and quantities", () => {
    expect(scrubString("order 4821 qty 3 total 12.50")).toBe("order 4821 qty 3 total 12.50");
  });
  it("removes business-scoped user ids, bearer tokens and keys", () => {
    expect(scrubString("user LB.13491208655302741918")).toBe("user [user-id]");
    expect(scrubString("Authorization: Bearer abcdefgh12345678")).toBe("Authorization: Bearer [token]");
    expect(scrubString("key sk-ant-api03-abcdefghijkl")).toBe("key [key]");
  });
  it("drops the request body, headers, cookies, query and user, and keeps the route", () => {
    const out = scrubEvent({
      request: { url: "https://w.example/webhooks/kapso/customer?x=96171234567", method: "POST", data: '{"text":"hello"}', headers: { "x-webhook-signature": "abc" }, cookies: { a: "b" } },
      user: { ip_address: "1.2.3.4", id: "LB.13491208655302741918" },
      exception: { values: [{ type: "Error", value: "supabase said no for +96171234567" }] },
      breadcrumbs: [{ message: "sent to 96171234567", data: { to: "96171234567" } }],
    });
    expect(out.request).toEqual({ url: "https://w.example/webhooks/kapso/customer", method: "POST" });
    expect(out.user).toBeUndefined();
    expect(out.exception?.values?.[0]?.value).toBe("supabase said no for [number]");
    expect(JSON.stringify(out.breadcrumbs)).not.toContain("96171234567");
  });
});
