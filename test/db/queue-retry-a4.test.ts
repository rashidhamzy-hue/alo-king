// Session A4, audit 14 Nov item 11: queue() in apps/gateway/src/index.ts is the retry path for an inbound event whose fast
// hand-off failed. No test drove it. These do, on the real schema: delivered once, never twice, retried (and recorded) when the
// conversation object refuses, loud in Sentry from the third attempt, and never dropped because the database blinked.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { probeInbound } from "@ak/wa/probe";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

const sentry = vi.hoisted(() => ({ exceptions: [] as { tags?: Record<string, string> }[] }));
vi.mock("@sentry/cloudflare", async (orig) => ({
  ...(await orig<typeof import("@sentry/cloudflare")>()),
  captureException: (_e: unknown, ctx?: { tags?: Record<string, string> }) => { sentry.exceptions.push({ tags: ctx?.tags }); return "e"; },
}));
const { default: gateway } = await import("../../apps/gateway/src/index");

let db: TestDb;
const CUSTOMER_LINE = "1378974041965966";
type Msg = { body: { line: "customer" | "ops"; event: string; key: string }; attempts: number; ack: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
const msg = (key: string, attempts = 1): Msg => ({ body: { line: "customer", event: "whatsapp.message.received", key }, attempts, ack: vi.fn(), retry: vi.fn() });
const batch = (...messages: Msg[]) => ({ queue: "inbound", messages }) as unknown as MessageBatch<Msg["body"]>;

/** The conversation object: records what it was handed; answers with `status` (200 accepts, anything else refuses). */
function conversations() {
  const handed: string[] = []; let status = 200;
  const ns = { idFromName: (n: string) => n, get: () => ({ fetch: async (_u: string, i: RequestInit) => {
    handed.push(JSON.parse(String(i.body)).event.message.id); return new Response(status === 200 ? "queued" : "no", { status });
  } }) };
  return { ns, handed, refuse: (s: number) => { status = s; } };
}
const envWith = (client: SupabaseClient, ns: unknown) => ({ CONVERSATION: ns, PHONE_NUMBER_ID_CUSTOMER: CUSTOMER_LINE, PHONE_NUMBER_ID_OPS: "597907523413541",
  TEST_DEPS: { db: client, model: {} } }) as never;

let seq = 0;
/** One inbound event stored by the webhook whose fast hand-off failed (so it was put on the queue). */
async function stored(): Promise<{ key: string; wamid: string }> {
  const key = `a4-queue-${++seq}`;
  const payload = probeInbound({ phoneNumberId: CUSTOMER_LINE, waUserId: `LB.A4Q${seq}`, name: "Queue", msg: { type: "text", body: "بدي مي" } }) as { message: { id: string } };
  await db.pg.query(`insert into wa_inbound_events(idempotency_key, line, event, payload) values ($1, 'customer', 'whatsapp.message.received', $2)`, [key, JSON.stringify(payload)]);
  return { key, wamid: payload.message.id };
}
const row = (key: string) => db.one<{ processed_at: string | null; error: string | null }>(`select processed_at, error from wa_inbound_events where idempotency_key = $1`, [key]);

beforeAll(async () => { db = await openTestDb({ seeds: false }); }, 60_000);
beforeEach(() => { sentry.exceptions.length = 0; });

describe("the queue: the retry road for inbound events (audit item 11)", () => {
  it("a stored event that never reached its conversation is handed over once, marked processed, and acked", async () => {
    const c = conversations(); const e = await stored(); const m = msg(e.key);
    await gateway.queue(batch(m), envWith(supabaseOver(db).client, c.ns));
    expect(c.handed).toEqual([e.wamid]);
    expect((await row(e.key)).processed_at).not.toBeNull();
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
  });

  it("an event the fast path already handed over is acked and not handed over again", async () => {
    const c = conversations(); const e = await stored();
    await db.pg.query(`update wa_inbound_events set processed_at = now() where idempotency_key = $1`, [e.key]);
    const m = msg(e.key);
    await gateway.queue(batch(m), envWith(supabaseOver(db).client, c.ns));
    expect(c.handed).toEqual([]);
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("the conversation object refuses: the error is kept on the event, the message is retried, and Sentry hears from the third attempt", async () => {
    const c = conversations(); c.refuse(503); const e = await stored();
    const first = msg(e.key, 1);
    await gateway.queue(batch(first), envWith(supabaseOver(db).client, c.ns));
    expect(first.retry).toHaveBeenCalledTimes(1);
    expect(first.ack).not.toHaveBeenCalled();
    expect(await row(e.key)).toMatchObject({ processed_at: null, error: expect.stringContaining("503") });
    expect(sentry.exceptions).toHaveLength(0);                         // one blip is not news

    const third = msg(e.key, 3);
    await gateway.queue(batch(third), envWith(supabaseOver(db).client, c.ns));
    expect(third.retry).toHaveBeenCalledTimes(1);
    expect(sentry.exceptions).toEqual([{ tags: { where: "queue", line: "customer" } }]);

    c.refuse(200);                                                      // it recovers: the next attempt goes through
    const fourth = msg(e.key, 4);
    await gateway.queue(batch(fourth), envWith(supabaseOver(db).client, c.ns));
    expect(fourth.ack).toHaveBeenCalledTimes(1);
    expect((await row(e.key)).processed_at).not.toBeNull();
    expect(c.handed.filter((id) => id === e.wamid).length).toBe(3);    // two refusals, one acceptance; the object drops repeats by id
  });

  it("one bad event in a batch does not hold up the others", async () => {
    const c = conversations(); const good = await stored(); const bad = await stored();
    const client = supabaseOver(db).client;
    await db.pg.query(`update wa_inbound_events set payload = '{"message": "not a message"}' where idempotency_key = $1`, [bad.key]);
    const mBad = msg(bad.key), mGood = msg(good.key);
    await gateway.queue(batch(mBad, mGood), envWith(client, c.ns));
    expect(mBad.retry).toHaveBeenCalledTimes(1);
    expect(mGood.ack).toHaveBeenCalledTimes(1);
    expect(c.handed).toEqual([good.wamid]);
  });

  it("the database read fails: the message is retried, never acked as if there were nothing to do (no inbound is dropped)", async () => {
    const c = conversations(); const e = await stored();
    const real = supabaseOver(db).client;
    let blinks = 1;
    const flaky = { ...real, rpc: real.rpc.bind(real), from: (t: string) => {
      if (t === "wa_inbound_events" && blinks > 0) {
        blinks--;
        return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: "TypeError: fetch failed" } }) }) }),
                 update: () => ({ eq: async () => ({ data: null, error: { message: "TypeError: fetch failed" } }) }) };
      }
      return real.from(t);
    } } as unknown as SupabaseClient;
    const m = msg(e.key);
    await gateway.queue(batch(m), envWith(flaky, c.ns));
    expect(m.ack).not.toHaveBeenCalled();
    expect(m.retry).toHaveBeenCalledTimes(1);
    expect(c.handed).toEqual([]);

    const again = msg(e.key, 2);                                         // the retry finds the database back
    await gateway.queue(batch(again), envWith(flaky, c.ns));
    expect(again.ack).toHaveBeenCalledTimes(1);
    expect(c.handed).toEqual([e.wamid]);
  });

  it("a key that was never stored is acked (the webhook stores before it queues, so there is nothing to deliver)", async () => {
    const c = conversations(); const m = msg("a4-queue-never-stored");
    await gateway.queue(batch(m), envWith(supabaseOver(db).client, c.ns));
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
  });
});
