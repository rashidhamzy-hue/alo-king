// Session B4: the lane B requests other sessions recorded in docs/HANDOFF.md, each on the real schema.
//   D1: quote_order refuses while the exchange-rate pause is on.
//   C2: customer credit is taken off the next card, on its own line; learn_from_order ignores removed or replaced lines.
//   B3: the staging probe releases its own handoff; the probe answers the address question.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, type Ids, type Sent } from "./flow-kit";
import { ar } from "@ak/agents/messages";
import { probeReply, PROBE_ADDRESS } from "@ak/wa/probe";

let db: TestDb; let ids: Ids; let outbound: Sent[];
beforeAll(async () => { ({ db, ids } = await openFlowDb()); }, 60_000);
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await db?.pg.close(); });

const ORDER = { intent: "order", fulfilment: "delivery", lines: [{ raw: "علبتين لبنة ليبان ليه", query: "لبنة ليبان ليه", qty: 2, confidence: 0.9 }],
                address: { village: "بعقلين", building: "بناية النسيم" } };
const bodyOf = (s: Sent) => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";

describe("lane B requests (B4)", () => {
  it("C2: credit we owe is taken off the next card, on its own line, and the total adds up", async () => {
    outbound = recordKapso();
    const t = flow(db, [read(ORDER)]);
    const c = await pinned(db, t, ids.BAAKLINE);
    // we owe them 1.25 (a refund booked as credit after an earlier order: 2.3), one balanced transaction
    await db.pg.query(`with t as (select gen_random_uuid() id) insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo)
      select t.id, customer_credit_account($1), -1.25, 'USD'::currency_code, -1.25, 'b4 test credit' from t union all
      select t.id, ensure_account('refund_expense', 'refund_expense'::account_kind, null), 1.25, 'USD'::currency_code, 1.25, 'b4 test credit' from t`, [c.party_id]);
    expect(Number(await db.rpc("customer_credit_usd", { p_party: c.party_id }))).toBeCloseTo(1.25, 2);

    await t.text("بدي علبتين لبنة ليبان ليه عبعقلين بناية النسيم");
    const card = bodyOf(outbound.at(-1)!);
    expect(card).toContain("رصيد إلك من قبل: -$1.25");
    const o = await db.one(`select id, total_usd, subtotal_usd, delivery_fee_usd from orders where customer_id = $1 and status = 'awaiting_confirmation'`, [c.party_id]);
    expect(Number(o.total_usd)).toBeCloseTo(Number(o.subtotal_usd) + Number(o.delivery_fee_usd) - 1.25, 2);
    expect(card).toContain(`*المجموع: $${Number(o.total_usd).toFixed(2)}*`);
    expect(Number(await db.rpc("customer_credit_usd", { p_party: c.party_id }))).toBeCloseTo(0, 2);    // promised to this order
  }, 60_000);

  it("C2: learn_from_order learns each asked-for product once, from what left the hub as asked", async () => {
    const c = await flow(db, []).customer();
    const o = await db.rpc("create_order_from_quote", { p_customer: c.party_id, p_conversation: null, p_lines: [{ product_id: ids.LABNEH, qty: 2, raw: "لبنة" }, { product_id: ids.BREAD, qty: 1, raw: "خبز" }],
      p_village: ids.BAAKLINE, p_place: null, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
    // at the shelf: one labneh was missing (its own removed line), the bread was replaced by a kept substitute
    const items = await db.all(`select id, product_id from order_items where order_id = $1`, [o.order_id]);
    const labneh = items.find((i: any) => i.product_id === ids.LABNEH)!, bread = items.find((i: any) => i.product_id === ids.BREAD)!;
    const other = (await db.one(`select id from products where sku = 'AK-0081'`)).id;
    await db.pg.query(`update order_items set qty = 1 where id = $1`, [labneh.id]);
    await db.pg.query(`insert into order_items(order_id, fulfilment_id, product_id, name_snapshot, qty, unit_price_usd, status)
                       select order_id, fulfilment_id, product_id, name_snapshot, 1, unit_price_usd, 'removed' from order_items where id = $1`, [labneh.id]);
    await db.pg.query(`update order_items set status = 'substituted' where id = $1`, [bread.id]);
    await db.pg.query(`insert into order_items(order_id, fulfilment_id, product_id, name_snapshot, qty, unit_price_usd, substitution_of, status, raw_phrase)
                       select order_id, fulfilment_id, $2, 'sub', 1, 1, id, 'ok', raw_phrase from order_items where id = $1`, [bread.id, other]);
    await db.pg.query(`update orders set status = 'delivered', delivered_at = now() where id = $1`, [o.order_id]);
    expect(await db.rpc("learn_from_order", { p_order: o.order_id })).toMatchObject({ learned: true });
    const usual = await db.all(`select key, weight, value from customer_memory where party_id = $1 and kind = 'usual_item'`, [c.party_id]);
    expect(usual.map((u: any) => u.key)).toEqual([ids.LABNEH]);                       // not the bread it never got, not the substitute
    expect(Number(usual[0].weight)).toBe(1);                                         // the split line counted once
    expect(usual[0].value.last_qty).toBe(1);
    expect(await db.all(`select alias from alias_candidates where product_id = $1`, [other])).toEqual([]);   // «خبز» is not the substitute's name
  }, 60_000);

  it("D1: while today's rate waits for a person, nothing is priced; the customer is told once and the basket is kept", async () => {
    expect(await db.rpc("fx_quoting_paused")).toBe(false);
    const ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
    await db.rpc("set_fx_rate", { p_lbp_per_usd: 89500, p_by: ops });
    expect(await db.rpc("set_fx_rate", { p_lbp_per_usd: 95000, p_by: ops })).toMatchObject({ status: "paused" });
    expect(await db.rpc("fx_quoting_paused")).toBe(true);
    const q = await db.rpc("quote_order", { p_lines: [{ product_id: ids.LABNEH, qty: 1 }], p_village: ids.BAAKLINE, p_pickup: false });
    expect(q.ok).toBe(false);
    expect(q.issues.map((i: any) => i.code)).toContain("fx_paused");

    outbound = recordKapso();
    const t = flow(db, [read(ORDER)]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي علبتين لبنة ليبان ليه عبعقلين");
    expect(outbound.map(bodyOf)).toEqual([ar.fixed.fxPaused]);
    expect(t.seen).toHaveLength(1);                                                   // the reading only; no model writes about prices
    expect(await db.one(`select count(*)::int n from orders where customer_id = $1`, [c.party_id])).toEqual({ n: 0 });

    const pending = (await db.one(`select id from fx_pending where status = 'pending'`)).id;
    await db.rpc("confirm_fx_rate", { p_pending: pending, p_by: ops });
    expect(await db.rpc("fx_quoting_paused")).toBe(false);
  }, 60_000);

  it("B3: a probe stuck with a person gets its conversation back, and ops see why; fresh_place makes it a first order", async () => {
    await db.pg.exec(`update settings set value = '{"enabled": true, "every_minutes": 60, "stuck_after_minutes": 30, "order_text": "بدي مي", "fresh_place": true}' where key = 'probe'`);
    const p = (await db.one(`insert into parties(role, display_name, is_probe) values ('customer', 'Probe', true) returning id`)).id;
    await db.pg.query(`insert into party_identities(party_id, line, wa_user_id) values ($1, 'customer', 'PR.B4')`, [p]);
    const conv = (await db.one(`insert into conversations(line, party_id, human_handoff) values ('customer', $1, true) returning id`, [p])).id;
    await db.pg.query(`insert into handoffs(conversation_id, reason) values ($1, 'agent_error: reading lost')`, [conv]);
    await db.rpc("save_customer_pin", { p_party: p, p_lat: 33.67739, p_lng: 35.56355 });

    const due = await db.rpc("probe_due");
    expect(due).toMatchObject({ party_id: p, wa_user_id: "PR.B4", text: "بدي مي" });
    expect((await db.one(`select human_handoff from conversations where id = $1`, [conv])).human_handoff).toBe(false);
    expect(await db.one(`select status from handoffs where conversation_id = $1`, [conv])).toEqual({ status: "resolved" });
    const x = await db.one(`select kind, detail from ops_exceptions where kind = 'probe_handoff_released'`);
    expect(x.detail.reason).toBe("agent_error: reading lost");
    expect(await db.one(`select village_id, lat from customer_places where party_id = $1`, [p])).toEqual({ village_id: null, lat: null });
    await db.pg.exec(`update settings set value = '{"enabled": false}' where key = 'probe'`);
  }, 60_000);

  it("B4: the probe answers the address question in words, as a person would", () => {
    expect(probeReply({ type: "text", text: { body: `${ar.fixed.pinReceived("بعقلين")}\n\n${ar.fixed.askAddress}` } }))
      .toEqual({ kind: "tap", id: "probe:address", title: PROBE_ADDRESS });
    expect(probeReply({ type: "text", text: { body: "تم تأكيد طلبك" } })).toBeNull();
  });
});
