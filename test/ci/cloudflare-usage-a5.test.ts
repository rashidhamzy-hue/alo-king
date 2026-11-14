// scripts/ci/cloudflare-usage.mjs: Workers Paid limits, 70% threshold, and a token that cannot read analytics leaves the part off.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs, no types
import { evaluate, monthWindow, NoAccess, PAID_LIMITS, readCloudflare, table } from "../../scripts/ci/cloudflare-usage.mjs";

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const ok = (workers: number, gbs: number) => reply({ data: { viewer: { accounts: [{ workers: [{ sum: { requests: workers }, dimensions: { scriptName: "alo-king-gateway-staging" } }], objects: [{ sum: { duration: gbs } }] }] } } });
const NOW = new Date("2026-11-15T12:00:00Z");

describe("cloudflare-usage", () => {
  it("uses the Workers Paid limits: 10 million requests and 400,000 GB-s a month", () => {
    expect(PAID_LIMITS).toEqual({ workers_requests: 10_000_000, do_duration_gb_s: 400_000 });
  });
  it("reads month-to-date requests and Durable Object duration, and passes at or under 70%", async () => {
    const r = await readCloudflare("t", "acct", NOW, ok(6_999_999, 279_999));
    expect(r).toMatchObject({ requests: 6_999_999, doDurationGbS: 279_999 });
    expect(r.window).toMatchObject({ startDate: "2026-11-01", endDate: "2026-11-15", monthDays: 30 });
    expect(evaluate(r).ok).toBe(true);
  });
  it("fails above 70% of either, and projects the month", async () => {
    for (const [w, d, which] of [[7_000_001, 1, "workers requests"], [1, 280_001, "Durable Object duration (GB-s)"]] as const) {
      const r = evaluate(await readCloudflare("t", "acct", NOW, ok(w, d)));
      expect(r.ok).toBe(false);
      expect(r.rows.filter((x: any) => x.status === "over").map((x: any) => x.metric)).toEqual([which]);
    }
    const [req] = evaluate(await readCloudflare("t", "acct", NOW, ok(3_500_000, 1))).rows;
    expect(req.projected).toBeGreaterThan(0.7);                                  // 3.5M in 14.5 days of 30 is 7.2M for the month
    expect(table([req])).toContain("projected");
  });
  it("a token without analytics access is NoAccess (the part is left off), by status or by the API's own error", async () => {
    await expect(readCloudflare("t", "a", NOW, reply({}, 403))).rejects.toBeInstanceOf(NoAccess);
    await expect(readCloudflare("t", "a", NOW, reply({ data: null, errors: [{ message: "The given account is not authorized to access this resource.", extensions: { code: "authz" } }] }))).rejects.toBeInstanceOf(NoAccess);
  });
  it("any other failure is a real error with its reason, and a missing duration field says what the schema has", async () => {
    await expect(readCloudflare("t", "a", NOW, reply({}, 500))).rejects.toThrow(/HTTP 500/);
    await expect(readCloudflare("t", "a", NOW, reply({ data: { viewer: { accounts: [] } } }))).rejects.toThrow(/no account/);
    let n = 0;
    const f = (async () => new Response(JSON.stringify(n++ === 0 ? { data: null, errors: [{ message: 'unknown field "duration"' }] } : { data: { __type: { fields: [{ name: "cpuTime" }, { name: "activeTime" }] } } }), { status: 200 })) as unknown as typeof fetch;
    await expect(readCloudflare("t", "a", NOW, f)).rejects.toThrow(/sum fields: cpuTime, activeTime/);
  });
  it("month window", () => { expect(monthWindow(new Date("2026-02-10T00:00:00Z"))).toMatchObject({ startDate: "2026-02-01", monthDays: 28 }); });
});
