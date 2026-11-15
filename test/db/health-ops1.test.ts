// OPS1 item 6: the gateway's /health is what a free uptime check watches. 200 only while the Worker answers AND the minute cron has beaten
// in the last five minutes (the cron is what sends alerts, retries events and runs the probe: a silent cron is an outage). It says nothing
// about customers, numbers or settings: only ok and the age.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";
const { default: gateway } = await import("../../apps/gateway/src/index");

let db: TestDb;
const call = (path = "/health", method = "GET") =>
  gateway.fetch(new Request(`https://gw.test${path}`, { method }), { PHONE_NUMBER_ID_CUSTOMER: "1", PHONE_NUMBER_ID_OPS: "2", TEST_DEPS: { db: supabaseOver(db).client, model: {} } } as never, {} as ExecutionContext);

beforeAll(async () => { db = await openTestDb({ seeds: false }); }, 60_000);

describe("GET /health", () => {
  it("is 503 before the cron has ever run, and says so", async () => {
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, cron_age_s: null });
  });
  it("is 200 with the age while the cron is beating", async () => {
    await db.rpc("cron_beat");
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; cron_age_s: number };
    expect(body.ok).toBe(true);
    expect(body.cron_age_s).toBeLessThan(30);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("is 503 once the cron has been silent for more than five minutes", async () => {
    await db.pg.exec(`update heartbeats set at = now() - interval '6 minutes' where name = 'cron'`);
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json() as { cron_age_s: number }).cron_age_s).toBeGreaterThan(5 * 60);
  });
  it("is 503, not a crash, when the database does not answer", async () => {
    const broken = { rpc: () => ({ then: (r: (v: unknown) => unknown) => r({ data: null, error: { message: "down" } }) }) } as never;
    const res = await gateway.fetch(new Request("https://gw.test/health"), { TEST_DEPS: { db: broken, model: {} } } as never, {} as ExecutionContext);
    expect(res.status).toBe(503);
  });
  it("only GET, and nothing else about the Worker changed: unknown paths are still 404 and webhooks still need their signature", async () => {
    expect((await call("/health", "POST")).status).toBe(404);
    expect((await call("/nope")).status).toBe(404);
    const hook = await gateway.fetch(new Request("https://gw.test/webhooks/kapso/customer", { method: "POST", body: "{}" }), { TEST_DEPS: { db: supabaseOver(db).client, model: {} } } as never, {} as ExecutionContext);
    expect(hook.status).toBe(401);
  });
});
