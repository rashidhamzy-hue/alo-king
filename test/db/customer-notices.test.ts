// Task 4.3 on the real schema: each utility template is wired to its event, through the real gateway and gate (0062).
import { ar } from "@ak/agents/messages";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendNotice } from "../../apps/gateway/src/index";
import type { TurnDeps } from "../../apps/gateway/src/turn";
import { send as gatewaySend } from "@ak/wa/gateway";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

let db: TestDb;
const env = { KAPSO_BASE_URL: "https://api.kapso.ai/meta/whatsapp/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "1378974041965966", PHONE_NUMBER_ID_OPS: "597907523413541" };
let sent: any[];
beforeEach(() => { sent = []; vi.stubGlobal("fetch", vi.fn(async (_u: string, i: RequestInit) => { sent.push(JSON.parse(String(i.body))); return new Response(JSON.stringify({ messages: [{ id: `wamid.n${Math.random()}` }] }), { status: 200, headers: { "content-type": "application/json" } }); })); });
afterEach(() => vi.unstubAllGlobals());

function deps(): TurnDeps {
  const { client } = supabaseOver(db);
  return { db: client, model: {} as never, modelName: "x", send: (r) => gatewaySend(client, env, r) } as TurnDeps;
}
const due = async () => (await db.rpc("customer_notices_due")) as any[];
const tick = async () => { for (const n of await due()) await sendNotice(deps(), n); };

let n = 0;
async function customerWithOrder(opts: { windowOpen: boolean }) {
  n++;
  const party = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
  await db.pg.query(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ($1,'customer',$2,$3)`, [party, `XX.${String(n).padStart(16, "0")}`, `+9617000${String(n).padStart(4, "0")}`]);
  const conv = (await db.one(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, $2) returning id`,
    [party, opts.windowOpen ? new Date().toISOString() : new Date(Date.now() - 30 * 3600_000).toISOString()])).id;
  await db.pg.query(`insert into consent_events(party_id, line, kind, action, source) values ($1, 'customer', 'transactional', 'opt_in', 'first_order_button')`, [party]);
  const order = (await db.one(`insert into orders(short_code, customer_id, conversation_id, status, subtotal_usd) values ($1, $2, $3, 'awaiting_confirmation', 12.5) returning id`, [`N${n}X`, party, conv])).id;
  return { party, order, code: `N${n}X` };
}

beforeAll(async () => { db = await openTestDb({ seeds: false }); }, 60_000);

describe("customer notices", () => {
  it("a system cancellation reaches the customer once; their own cancel tap does not get a second message", async () => {
    const a = await customerWithOrder({ windowOpen: true });
    await db.pg.query(`insert into order_events(order_id, from_status, to_status, actor, reason) values ($1, 'awaiting_confirmation', 'cancelled', 'system', 'timeout:awaiting_confirmation')`, [a.order]);
    const b = await customerWithOrder({ windowOpen: true });
    await db.pg.query(`insert into order_events(order_id, from_status, to_status, actor) values ($1, 'awaiting_confirmation', 'cancelled', 'customer')`, [b.order]);
    await tick(); await tick();
    expect(sent).toHaveLength(1);
    // CFG1: a card the timer cancelled carries the "reopen" button (0222, 0223); the words are the same
    expect(sent[0]).toMatchObject({ type: "interactive", interactive: { body: { text: ar.notice.orderCancelled(a.code, "ما تأكّد الطلب بالوقت المحدد", true) },
      action: { buttons: [{ reply: { id: `order:reopen:${a.order}`, title: ar.cx.reopenButton } }] } } });
    expect(await due()).toEqual([]);
  });

  it("before Meta approves: free text inside the window; outside it the gate refuses, it is recorded, and it is not retried", async () => {
    const c = await customerWithOrder({ windowOpen: false });
    const rider = (await db.one(`insert into parties(role) values ('driver') returning id`)).id;
    const d = (await db.one(`insert into deliveries(driver_id, status) values ($1, 'in_progress') returning id`, [rider])).id;
    await db.pg.query(`insert into delivery_stops(delivery_id, seq, kind, order_id, arrived_at) values ($1, 1, 'dropoff', $2, now())`, [d, c.order]);
    await db.pg.query(`update orders set status = 'arrived' where id = $1`, [c.order]);
    await tick(); await tick();
    expect(sent).toHaveLength(0);
    expect((await db.one(`select outcome from customer_notices where key = $1`, [`notice:rider_at_door:${c.order}`])).outcome).toBe("refused:window_closed_use_template");
    // M1 (coordinator): outside the window with no template that may be sent, the skip is recorded, never silent
    expect(await db.one(`select trace->>'template' as t, trace->>'event' as e from agent_runs where trace->>'reason' = 'template_not_utility' and order_id = $1`, [c.order]))
      .toEqual({ t: "ak_rider_at_door_v1", e: "rider_at_door" });
  });

  it("once approved, the template goes out, outside the window too, with the right name and parameters", async () => {
    expect(await db.rpc("set_template_status", { p_name: "ak_payment_received_v1", p_status: "APPROVED" })).toBe(true);
    const c = await customerWithOrder({ windowOpen: false });
    await db.pg.query(`insert into payments(order_id, method, status, amount_usd, received_usd, change_usd, confirmed_at) values ($1, 'cod', 'confirmed', 12.5, 20, 7.5, now())`, [c.order]);
    await tick(); await tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "template", to: expect.stringMatching(/^\+9617/),
      template: { name: "ak_payment_received_v1", language: { code: "ar" }, components: [{ type: "body", parameters: [{ type: "text", text: c.code }, { type: "text", text: "12.50$ نقداً" }] }] } });
    expect((await db.one(`select category, template_name from wa_messages where order_id = $1`, [c.order]))).toEqual({ category: "utility", template_name: "ak_payment_received_v1" });
  });

  it("templates are seeded as submitted, transactional only, with the wording Meta was sent", async () => {
    const t = await db.all(`select name, category, status, body from wa_templates where name ~ '^ak_(order_cancelled|rider_at_door|payment_received)_v1$' and language = 'ar' order by name`);
    expect(t.map((x: any) => [x.name, x.category])).toEqual([["ak_order_cancelled_v1", "utility"], ["ak_payment_received_v1", "utility"], ["ak_rider_at_door_v1", "utility"]]);
    for (const x of t) expect(x.body).not.toMatch(/عرض|خصم|جديد|أفضل|مجان/);       // nothing promotional
  });
});
