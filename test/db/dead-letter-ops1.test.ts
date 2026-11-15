// OPS1 item 5: the dead-letter queue is where an inbound event lands after every retry failed. A message in it is a customer who
// was not answered, so it must not sit there unseen. The Worker consumes the dead-letter queue: each message becomes one open
// "dead_letter" exception (high priority: it is pushed and the ops line is told), the stored event stays for the minute cron to
// hand over again, and the message is acked so the queue is empty again.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

const sentry = vi.hoisted(() => ({ messages: [] as { msg: string; tags?: Record<string, string> }[] }));
vi.mock("@sentry/cloudflare", async (orig) => ({
  ...(await orig<typeof import("@sentry/cloudflare")>()),
  captureMessage: (msg: string, ctx?: { tags?: Record<string, string> }) => { sentry.messages.push({ msg, tags: ctx?.tags }); return "m"; },
}));
const { default: gateway } = await import("../../apps/gateway/src/index");

let db: TestDb;
type Msg = { body: { line: "customer" | "ops"; event: string; key: string }; attempts: number; ack: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
const msg = (key: string): Msg => ({ body: { line: "customer", event: "whatsapp.message.received", key }, attempts: 6, ack: vi.fn(), retry: vi.fn() });
const batch = (queue: string, ...messages: Msg[]) => ({ queue, messages }) as unknown as MessageBatch<Msg["body"]>;
const env = () => ({ PHONE_NUMBER_ID_CUSTOMER: "1378974041965966", PHONE_NUMBER_ID_OPS: "597907523413541", TEST_DEPS: { db: supabaseOver(db).client, model: {} } }) as never;

beforeAll(async () => { db = await openTestDb({ seeds: false }); }, 60_000);
beforeEach(() => { sentry.messages.length = 0; });

describe("the dead-letter queue", () => {
  it("a message that arrives there opens one high-priority exception, is acked, and the stored event is kept and marked", async () => {
    await db.pg.exec(`insert into wa_inbound_events(idempotency_key, line, event, payload) values ('dl-1', 'customer', 'whatsapp.message.received', '{}')`);
    const m = msg("dl-1");
    await gateway.queue(batch("ak-inbound-staging-dlq", m), env());
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
    const e = await db.one(`select kind, status, detail from ops_exceptions where kind = 'dead_letter'`);
    expect(e).toMatchObject({ kind: "dead_letter", status: "open" });
    expect(e.detail).toMatchObject({ line: "customer", event: "whatsapp.message.received", count: 1 });
    expect(JSON.stringify(e.detail)).not.toContain("dl-1");                       // the idempotency key is not for a person to read
    expect((await db.one(`select processed_at, error from wa_inbound_events where idempotency_key = 'dl-1'`))).toMatchObject({ processed_at: null });
    expect((await db.one(`select error from wa_inbound_events where idempotency_key = 'dl-1'`)).error).toMatch(/dead.letter/i);
    expect(sentry.messages.map((s) => s.tags?.where)).toContain("dead_letter");
    expect((await db.all(`select kind from claim_alert_pushes()`)).map((x) => x.kind)).toContain("dead_letter");      // high priority: pushed
  });

  it("many dead messages in an hour are one exception with a count, not a flood of pushes", async () => {
    for (const k of ["dl-2", "dl-3", "dl-4"]) await db.pg.exec(`insert into wa_inbound_events(idempotency_key, line, event, payload) values ('${k}', 'customer', 'whatsapp.message.received', '{}')`);
    await gateway.queue(batch("ak-inbound-staging-dlq", msg("dl-2"), msg("dl-3"), msg("dl-4")), env());
    const rows = await db.all(`select detail from ops_exceptions where kind = 'dead_letter' and status = 'open'`);
    expect(rows.length).toBe(1);
    expect(rows[0]!.detail.count).toBe(4);
  });

  it("a message whose stored event is gone is still alarmed and acked (the alarm is about the queue, not the row)", async () => {
    const m = msg("dl-nowhere");
    await gateway.queue(batch("ak-inbound-staging-dlq", m), env());
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("if the alarm cannot be raised the message is retried, never dropped", async () => {
    const m = msg("dl-5");
    const client = supabaseOver(db).client;
    const broken = { ...client, rpc: () => ({ then: (r: (v: unknown) => unknown) => r({ data: null, error: { message: "database down" } }) }), from: client.from.bind(client) } as never;
    await gateway.queue(batch("ak-inbound-staging-dlq", m), { PHONE_NUMBER_ID_CUSTOMER: "1", PHONE_NUMBER_ID_OPS: "2", TEST_DEPS: { db: broken, model: {} } } as never);
    expect(m.ack).not.toHaveBeenCalled();
    expect(m.retry).toHaveBeenCalledTimes(1);
  });

  it("the ordinary queue is untouched: its messages still go to the conversation, not to the alarm", async () => {
    const before = (await db.all(`select 1 from ops_exceptions where kind = 'dead_letter'`)).length;
    await gateway.queue(batch("ak-inbound-staging", msg("never-stored")), env());
    expect((await db.all(`select 1 from ops_exceptions where kind = 'dead_letter'`)).length).toBe(before);
  });
});
