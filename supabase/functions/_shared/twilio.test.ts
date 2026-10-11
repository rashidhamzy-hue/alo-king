import { describe, expect, it } from "vitest";
import { callScript, gatherTwiml, twilioSignature, verifyTwilio } from "./twilio";
import { parseDsn, reportError } from "./sentry";

describe("twilio", () => {
  it("matches Twilio's documented signature example", async () => {
    // https://www.twilio.com/docs/usage/security#validating-requests
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    const params = {
      Digits: "1234",
      To: "+18005551212",
      From: "+14158675310",
      Caller: "+14158675310",
      CallSid: "CA1234567890ABCDE",
    };
    expect(await twilioSignature("12345", url, params)).toBe("GvWf1cFY/Q7PnoempGyD5oXAezc=");
    expect(await verifyTwilio("12345", url, params, "GvWf1cFY/Q7PnoempGyD5oXAezc=")).toBe(true);
    expect(
      await verifyTwilio("12345", url, { ...params, Digits: "1" }, "GvWf1cFY/Q7PnoempGyD5oXAezc="),
    ).toBe(false);
    expect(await verifyTwilio(undefined, url, params, "x")).toBe(false);
  });
  it("the call reads only the code, item count and total, and escapes the TwiML", () => {
    const s = callScript({
      code: "AB3CD9",
      total_usd: 12.5,
      items: [
        { name: "<x>", quantity: 2 },
        { name: "y", quantity: 1 },
      ],
    });
    expect(s).toContain("A B 3 C D 9");
    expect(s).toContain("3 أصناف");
    expect(s).not.toContain("<x>");
    expect(gatherTwiml("a & b", "https://x/y?a=1&b=2")).toContain(
      'action="https://x/y?a=1&amp;b=2"',
    );
  });
});

describe("sentry", () => {
  it("parses a DSN and masks phone numbers in what it sends", async () => {
    expect(parseDsn("https://abc123@o1.ingest.de.sentry.io/4512209428807760")).toEqual({
      key: "abc123",
      host: "o1.ingest.de.sentry.io",
      project: "4512209428807760",
    });
    expect(parseDsn(undefined)).toBeNull();
    let body = "";
    const ok = await reportError(
      "https://abc123@o1.ingest.de.sentry.io/45",
      new Error("send to +96171000001 failed"),
      {},
      (async (_u: any, init: any) => {
        body = init.body;
        return new Response("{}");
      }) as any,
    );
    expect(ok).toBe(true);
    expect(body).toContain("<phone>");
    expect(body).not.toContain("96171000001");
    expect(await reportError(undefined, new Error("x"))).toBe(false);
  });
});
