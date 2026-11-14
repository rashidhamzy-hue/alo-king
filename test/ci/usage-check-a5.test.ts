// The weekly usage check's rules (scripts/ci/usage-check.mjs): over 70% of any limit fails, and so does a figure that cannot be read.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs, no types
import { evaluate, PLAN_LIMITS, readEgress, table, THRESHOLD } from "../../scripts/ci/usage-check.mjs";

const MB = 1024 ** 2, GB = 1024 ** 3;
describe("usage-check", () => {
  it("passes at or under 70% of every limit, on the free plan's numbers", () => {
    const r = evaluate({ database: 350 * MB, storage: 0.7 * GB, egress: 3.5 * GB }, PLAN_LIMITS.free);
    expect(THRESHOLD).toBe(0.7);
    expect(r.ok).toBe(true);
    expect(r.rows.map((x: any) => x.status)).toEqual(["ok", "ok", "ok"]);
  });
  it("fails above 70% of any one limit, and says which", () => {
    for (const [k, v] of [["database", 351 * MB], ["storage", 0.71 * GB], ["egress", 3.6 * GB]] as const) {
      const used: any = { database: 1, storage: 1, egress: 1, [k]: v };
      const r = evaluate(used, PLAN_LIMITS.free);
      expect(r.ok, k).toBe(false);
      expect(r.rows.filter((x: any) => x.status === "over").map((x: any) => x.metric)).toEqual([k]);
    }
  });
  it("a figure that cannot be read fails the check: silence is not a pass", () => {
    const r = evaluate({ database: 1, storage: 1, egress: null }, PLAN_LIMITS.free);
    expect(r.ok).toBe(false);
    expect(table(r.rows)).toContain("could not be read");
  });
  it("an egress figure the token may not read is left off: said plainly, neither a pass nor a failure; any other unreadable figure still fails", async () => {
    const r = evaluate({ database: 1, storage: 1, egress: "off" }, PLAN_LIMITS.free);
    expect(r.ok).toBe(true);
    expect(table(r.rows)).toContain("left off");
    expect(evaluate({ database: 400 * MB, storage: 1, egress: "off" }, PLAN_LIMITS.free).ok).toBe(false);   // the rest is still checked
    const err = await readEgress("t", "ref", (async () => new Response("no", { status: 401 })) as unknown as typeof fetch).catch((e: any) => e);
    expect(err.denied).toBe(true);
    const other = await readEgress("t", "ref", (async () => new Response("no", { status: 500 })) as unknown as typeof fetch).catch((e: any) => e);
    expect(other.denied).toBe(false);
  });
  it("the pro plan's limits are larger; the same usage that fails free passes pro", () => {
    const used = { database: 2 * GB, storage: 10 * GB, egress: 50 * GB };
    expect(evaluate(used, PLAN_LIMITS.free).ok).toBe(false);
    expect(evaluate(used, PLAN_LIMITS.pro).ok).toBe(true);
  });
  it("reads egress from the usage report (entries named EGRESS, not the cached kind), and says what it saw when it cannot", async () => {
    const answer = (body: unknown) => (async (url: string) => new Response(JSON.stringify(String(url).includes("/v1/projects/") ? { organization_slug: "org-x" } : body), { status: 200 })) as unknown as typeof fetch;
    const ok = await readEgress("t", "ref", answer({ usages: [{ metric: "EGRESS", usage: 2 * GB, pricing_free_units: 5 * GB }, { metric: "CACHED_EGRESS", usage: 9 * GB }, { metric: "DATABASE_SIZE", usage: 1 }] }));
    expect(ok).toEqual({ bytes: 2 * GB, includedBytes: 5 * GB });
    await expect(readEgress("t", "ref", answer({ usages: [{ metric: "DATABASE_SIZE", usage: 1 }] }))).rejects.toThrow(/metrics seen: DATABASE_SIZE/);
    await expect(readEgress("t", "ref", (async () => new Response("no", { status: 401 })) as unknown as typeof fetch)).rejects.toThrow(/HTTP 401/);
  });
});
