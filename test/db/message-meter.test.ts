// Task 4.12: the message meter on the real schema (0061). Status webhooks come from the saved Kapso payloads.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { route, type Env } from "../../apps/gateway/src/index";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

const fx = (p: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/kapso/${p}`, import.meta.url)), "utf8")).body;
let db: TestDb, party: string, order: string;
const MONTH = "2026-11-01";

async function out(n: number, opts: { type?: string; category?: string; order?: string | null; at?: string; status?: string } = {}) {
  for (let i = 0; i < n; i++) {
    await db.pg.query(`insert into wa_messages(line, direction, party_id, wa_message_id, type, category, status, order_id, created_at)
      values ('customer','outbound',$1,$2,$3,$4::msg_category,$5,$6,$7)`,
      [party, `wamid.m${Math.random()}`, opts.type ?? "text", opts.category ?? "service", opts.status ?? "sent", opts.order ?? null, opts.at ?? "2026-11-10T10:00:00Z"]);
  }
}

beforeAll(async () => {
  db = await openTestDb({ seeds: false });
  party = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
  const conv = (await db.one(`insert into conversations(line, party_id) values ('customer', $1) returning id`, [party])).id;
  order = (await db.one(`insert into orders(short_code, customer_id, conversation_id, status, delivered_at) values ('MTR1', $1, $2, 'delivered', '2026-11-10T11:00:00Z') returning id`, [party, conv])).id;
}, 60_000);

describe("message meter", () => {
  it("counts free-form replies against the 1,000 free, and bills only what is past them", async () => {
    await out(799);
    let m = await db.rpc("message_meter", { p_month: MONTH });
    let c = m.lines.find((l: any) => l.line === "customer");
    expect(c).toMatchObject({ free_form: 799, free_form_left: 201, billable: 0, cost_usd_estimate: 0 });
    expect(await db.rpc("meter_alerts")).toEqual([]);                         // not yet at 800 (this month in real time is not November in the test data)

    await out(202, { order });                                                  // 1,001 replies: one past the allowance
    m = await db.rpc("message_meter", { p_month: MONTH });
    c = m.lines.find((l: any) => l.line === "customer");
    expect(c).toMatchObject({ free_form: 1001, free_form_left: 0, billable: 1 });
    expect(c.cost_usd_estimate).toBeCloseTo(0.0091, 4);
  });

  it("utility templates are billed from the first one; probe messages and failed sends are not counted", async () => {
    await out(2, { type: "template", category: "utility" });
    await out(5, { status: "sink" });
    await out(3, { status: "failed" });
    const c = (await db.rpc("message_meter", { p_month: MONTH })).lines.find((l: any) => l.line === "customer");
    expect(c).toMatchObject({ outbound: 1003, templates: 2, billable: 3 });
  });

  it("Meta's own pricing, from a real status payload, overrides the estimate", async () => {
    const body = fx("whatsapp.message.delivered/api-text-01.json");
    await db.pg.query(`insert into wa_messages(line, direction, party_id, wa_message_id, type, category, status, created_at)
      values ('customer','outbound',$1,$2,'text','service','sent','2026-11-10T12:00:00Z')`, [party, body.message.id]);
    const { client } = supabaseOver(db);
    await route(client, {} as Env, "customer", "whatsapp.message.delivered", body);
    expect(await db.one(`select status, billable, pricing_category, pricing_type from wa_messages where wa_message_id = $1`, [body.message.id]))
      .toEqual({ status: "delivered", billable: false, pricing_category: "service", pricing_type: "free_customer_service" });
    const c = (await db.rpc("message_meter", { p_month: MONTH })).lines.find((l: any) => l.line === "customer");
    expect(c.billable_known_from_meta).toBe(1);
  });

  it("statuses out of order never go backwards; a failure is kept with Meta's code", async () => {
    await db.pg.query(`insert into wa_messages(line, direction, party_id, wa_message_id, type, status) values ('customer','outbound',$1,'wamid.order','text','sent')`, [party]);
    await db.rpc("record_message_status", { p_wamid: "wamid.order", p_status: "read" });
    await db.rpc("record_message_status", { p_wamid: "wamid.order", p_status: "delivered" });
    expect((await db.one(`select status from wa_messages where wa_message_id = 'wamid.order'`)).status).toBe("read");
    const { client } = supabaseOver(db);
    const failed = fx("whatsapp.message.failed/doc-reengagement-01.json");
    await db.pg.query(`insert into wa_messages(line, direction, party_id, wa_message_id, type, status) values ('customer','outbound',$1,$2,'text','sent')`, [party, failed.message.id]);
    await route(client, {} as Env, "customer", "whatsapp.message.failed", failed);
    expect(await db.one(`select status, error_code from wa_messages where wa_message_id = $1`, [failed.message.id])).toEqual({ status: "failed", error_code: "131047" });
  });

  it("day close: messages and estimated cost per order", async () => {
    const r = await db.rpc("order_message_costs", { p_day: "2026-11-10" });
    const o = r.orders.find((x: any) => x.order_id === order);
    expect(o.messages).toBe(202);
    expect(o.billable).toBe(1);                                               // the 1,001st reply belonged to this order
    expect(o.cost_usd_estimate).toBeCloseTo(0.0091, 4);
    expect(r.note).toMatch(/4\.4/);
  });

  it("alerts once the warning mark is passed in the current month", async () => {
    await db.pg.query(`update wa_messages set created_at = now() where direction = 'outbound'`);
    const a = await db.rpc("meter_alerts");
    expect(a).toEqual([expect.objectContaining({ line: "customer", warn_at: 800, allowance: 1000 })]);
  });
});
