// Session A4, audit 14 Nov item 2: every staging deploy opened two Sentry error issues ("sentry smoke test from the staging
// deploy" and "deploy-staging ingest check", 24 events each by 14 Nov), so a real error had to be found among them.
// Both proofs now send a cron check-in to their own monitor: it proves the DSN, the transport and the flush, and it is never
// an issue. These tests fail if either goes back to sending an error event.
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const calls = vi.hoisted(() => ({ exception: 0, message: 0, checkIns: [] as { checkIn: any; config: any }[] }));
vi.mock("@sentry/cloudflare", () => ({
  withSentry: (_o: unknown, h: unknown) => h,
  instrumentDurableObjectWithSentry: (_o: unknown, c: unknown) => c,
  withMonitor: (_s: string, fn: () => unknown) => fn(),
  captureException: () => { calls.exception++; return "e"; },
  captureMessage: () => { calls.message++; return "m"; },
  captureCheckIn: (checkIn: unknown, config: unknown) => { calls.checkIns.push({ checkIn, config }); return "c1"; },
  flush: async () => true,
}));

describe("the staging deploy's Sentry proof (audit item 2)", () => {
  it("/__sentry-test sends a check-in to the deploy monitor, not an error", async () => {
    const worker = (await import("../../apps/gateway/src/worker")).default as unknown as { fetch: (r: Request, env: unknown, ctx: unknown) => Promise<Response> };
    const res = await worker.fetch(new Request("https://w.test/__sentry-test"), { ENVIRONMENT: "staging", SENTRY_DSN: "https://k@o1.ingest.sentry.io/1" }, {});
    expect(await res.text()).toMatch(/^sent \S+ flushed=true$/);          // the deploy workflow checks exactly this shape
    expect(calls.exception).toBe(0);
    expect(calls.message).toBe(0);
    expect(calls.checkIns).toHaveLength(1);
    expect(calls.checkIns[0]!.checkIn).toMatchObject({ monitorSlug: "deploy-smoke-staging", status: "ok" });
    expect(calls.checkIns[0]!.config.schedule).toBeTruthy();             // the monitor is created on first use, no setup by hand
  });

  it("production has no such route", async () => {
    const worker = (await import("../../apps/gateway/src/worker")).default as unknown as { fetch: (r: Request, env: unknown, ctx: unknown) => Promise<Response> };
    const res = await worker.fetch(new Request("https://w.test/__sentry-test"), { ENVIRONMENT: "production" }, {});
    expect(res.status).toBe(404);
  });

  it("the CI ingest check posts a check-in envelope, with no event item in it", () => {
    const script = fileURLToPath(new URL("../../scripts/ci/sentry-ingest-check.sh", import.meta.url));
    const out = execFileSync("bash", [script], { env: { ...process.env, SENTRY_CHECK_DRY_RUN: "1" }, cwd: fileURLToPath(new URL("../..", import.meta.url)) }).toString();
    const lines: any[] = out.trim().split("\n").map((l) => JSON.parse(l));
    const types = lines.filter((l) => "type" in l && Object.keys(l).length <= 2).map((l) => l.type);
    expect(types).toEqual(["check_in"]);
    const item = lines.find((l) => l.monitor_slug);
    expect(item).toMatchObject({ monitor_slug: "deploy-ingest-check-staging", status: "ok", environment: "staging" });
    expect(item.monitor_config.schedule).toBeTruthy();
  });
});
