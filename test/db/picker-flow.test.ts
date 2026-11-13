// Build plan 2.1: the picker flow on the ops line, end to end on the real schema. Pick list, start, item missing, picked;
// picked moves the order to ready. Stock, the order total, the rider's cash due and the ledger stay consistent.
import { beforeAll, describe, expect, it } from "vitest";
import { OutboxUnavailable } from "@ak/wa/gateway";
import { balance, collect, deliverToDoor, expectBooksBalanced, openHub, placeOrder, status, stock, total, type Hub, type Placed } from "./hub-kit";
import { opsLine, PHONES } from "./ops-kit";

let h: Hub; let line: ReturnType<typeof opsLine>; let WATER: string; let COFFEE: string; let BREAD: string;

beforeAll(async () => {
  h = await openHub();
  line = opsLine(h);
  WATER = await h.product("Tannourine Mineral Water 2L X6");
  COFFEE = await h.product("Najjar Cafe Classic Normal 180G");
  BREAD = await h.product("Al Forno Pita White Bread Big 800G");
}, 120_000);

const itemOf = async (orderId: string, product: string) => (await h.db.one(`select id from order_items where order_id = $1 and product_id = $2 and status = 'ok'`, [orderId, product])).id;

describe("picking a cash order with one line short (2.1)", () => {
  let o: Placed; let fullTotal: number;
  beforeAll(async () => {
    o = await placeOrder(h, [{ product_id: WATER, qty: 2 }, { product_id: COFFEE, qty: 1 }, { product_id: BREAD, qty: 3 }]);
    fullTotal = await total(h, o.orderId);
  });

  it("lists the waiting order and starts it: confirmed -> preparing, the list numbered in shelf order", async () => {
    await line.text(PHONES.picker, "طلبات");
    const start = line.lastButtons(h.picker).find((b) => b === `pick:start:${o.orderId}`);
    expect(start).toBeTruthy();
    await line.tap(PHONES.picker, start!);
    expect(await status(h, o.orderId)).toBe("preparing");
    const card = line.to(h.picker).at(-2)!;
    expect(card.body).toContain(`#${o.code}`);
    expect(card.body).toMatch(/1\. .*\n2\. .*\n3\. /);
    expect(line.lastButtons(h.picker)).toEqual([`pick:done:${o.orderId}`, `pick:missing:${o.orderId}`]);
  });

  it("only staff can start or change a pick", async () => {
    await expect(h.db.rpc("start_pick", { p_order: o.orderId, p_by: h.riders[0] })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(h.db.rpc("pick_item_missing", { p_item: await itemOf(o.orderId, WATER), p_by: h.riders[0] })).rejects.toThrow(/NOT_AUTHORISED/);
  });

  it("typed 'ناقص N K': found one bottle pack of two; the shortfall is its own line, released and written off, ops asked to count", async () => {
    const before = await stock(h, WATER);
    const list = await h.db.rpc("pick_list", { p_order: o.orderId });
    const n = list.lines.find((l: any) => l.product_id === WATER).n;
    await line.text(PHONES.picker, `ناقص ${n} 1`);
    const rows = await h.db.all(`select qty, status, missing_reason from order_items where order_id = $1 and product_id = $2 order by status`, [o.orderId, WATER]);
    expect(rows.map((r) => [Number(r.qty), r.status])).toEqual([[1, "ok"], [1, "removed"]]);
    const after = await stock(h, WATER);
    expect(after.reserved).toBe(before.reserved - 1);
    expect(after.onHand).toBe(before.onHand - 1);                     // the phantom unit is off the shelf figure
    expect(await h.db.one(`select adjust_reason, qty_delta from stock_movements where order_id = $1 and reason = 'adjust'`, [o.orderId]))
      .toMatchObject({ adjust_reason: "missing_at_pick" });
    expect((await h.db.one(`select count(*) n from ops_exceptions where kind = 'count_needed'`)).n).toBe(1);
    expect(await total(h, o.orderId)).toBeCloseTo(fullTotal - 2.01, 2);
    expect(line.to(h.picker).some((m) => m.body.includes("شلنا"))).toBe(true);
  });

  it("the missing button lists the lines; a tapped line is taken off whole", async () => {
    await line.tap(PHONES.picker, `pick:missing:${o.orderId}`);
    const rows = line.to(h.picker).at(-1)!.rows;
    const coffee = await itemOf(o.orderId, COFFEE);
    expect(rows).toContain(`pick:line:${coffee}`);
    await line.pickRow(PHONES.picker, `pick:line:${coffee}`);
    expect((await h.db.one(`select status from order_items where id = $1`, [coffee])).status).toBe("removed");
    expect(await total(h, o.orderId)).toBeCloseTo(fullTotal - 2.01 - 3.25, 2);
  });

  it("picked: preparing -> ready, the remaining units leave the shelf, the customer hears what changed on the customer line", async () => {
    await line.tap(PHONES.picker, `pick:done:${o.orderId}`);
    expect(await status(h, o.orderId)).toBe("ready");
    const picked = await h.db.all(`select product_id, qty_delta from stock_movements where order_id = $1 and reason = 'pick' order by qty_delta`, [o.orderId]);
    expect(picked.map((r) => Number(r.qty_delta)).sort()).toEqual([1, 3]);
    expect((await stock(h, WATER)).reserved).toBe(0);
    const told = line.to(o.customer).at(-1)!;
    expect(told.line).toBe("customer");
    expect(told.body).toContain("ما لقينا");
    expect(told.body).toContain(`$${(await total(h, o.orderId)).toFixed(2)}`);
    expect(line.to(h.picker).at(-1)!.body).toContain("جاهز");
  });

  it("the rider collects the recalculated total and the books balance", async () => {
    await deliverToDoor(h, o.orderId);
    await collect(h, o.orderId);
    expect(await status(h, o.orderId)).toBe("closed");
    expect(Number((await h.db.one(`select amount_usd from payments where order_id = $1`, [o.orderId])).amount_usd)).toBeCloseTo(fullTotal - 5.26, 2);
    await expectBooksBalanced(h);
  });
});

describe("a prepaid order short at the shelf, held products, an empty order (2.1)", () => {
  it("a paid transfer order that comes up short is owed the difference as credit, and told so", async () => {
    const o = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }, { product_id: BREAD, qty: 2 }], "whish");
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: h.picker });
    await h.db.rpc("pick_item_missing", { p_item: await itemOf(o.orderId, COFFEE), p_by: h.picker, p_found: 1 });
    await line.text(PHONES.picker, "خلصت");
    expect(await status(h, o.orderId)).toBe("ready");
    expect(Number(await h.db.rpc("customer_credit_usd", { p_party: o.customer }))).toBeCloseTo(3.25, 2);
    expect(line.to(o.customer).at(-1)!.body).toContain("$3.25");
    await expectBooksBalanced(h);
  });

  it("a held product comes up missing at the start and cannot block the pick; a hold placed mid-pick is caught at the end", async () => {
    const o = await placeOrder(h, [{ product_id: WATER, qty: 1 }, { product_id: COFFEE, qty: 1 }, { product_id: BREAD, qty: 1 }]);
    await h.db.rpc("hold_product", { p_product: BREAD, p_by: h.ops, p_reason: "supplier recall" });
    const r = await h.db.rpc("start_pick", { p_order: o.orderId, p_by: h.picker });
    expect(r.held).toHaveLength(1);
    expect(r.list.lines.map((l: any) => l.product_id)).not.toContain(BREAD);
    await h.db.rpc("hold_product", { p_product: WATER, p_by: h.ops, p_reason: "leaking packs" });
    const f = await h.db.rpc("finish_pick", { p_order: o.orderId, p_by: h.picker });
    expect(f.status).toBe("ready");
    expect(f.changes.removed).toHaveLength(2);
    expect(await h.db.all(`select product_id from stock_movements where order_id = $1 and reason = 'pick'`, [o.orderId])).toEqual([{ product_id: COFFEE }]);
    await h.db.rpc("release_hold", { p_product: BREAD, p_by: h.ops, p_note: "cleared" });
    await h.db.rpc("release_hold", { p_product: WATER, p_by: h.ops, p_note: "cleared" });
  });

  it("an order with nothing left is not sent out: ops is asked to call the customer", async () => {
    const o = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }]);
    await line.tap(PHONES.picker, `pick:start:${o.orderId}`);
    await line.text(PHONES.picker, "ناقص 1");
    await line.tap(PHONES.picker, `pick:done:${o.orderId}`);
    expect(await status(h, o.orderId)).toBe("preparing");
    expect(line.to(h.ops).at(-1)!.body).toContain(o.code);
    expect((await h.db.one(`select count(*) n from ops_exceptions where kind = 'pick_empty' and ref = $1`, [o.code])).n).toBe(1);
    await h.db.rpc("transition_order", { p_order: o.orderId, p_to: "cancelled", p_actor: "ops", p_actor_id: h.ops, p_reason: "nothing_in_stock" });
    expect((await stock(h, COFFEE)).reserved).toBe(0);
  });

  it("one open pick per picker; a redelivered tap does nothing twice", async () => {
    const a = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }]);
    const b = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }]);
    await h.db.rpc("start_pick", { p_order: a.orderId, p_by: h.picker });
    expect((await h.db.rpc("start_pick", { p_order: b.orderId, p_by: h.picker })).status).toBe("busy");
    const tap = line.msg(PHONES.picker, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: `pick:done:${a.orderId}`, title: "x" } } });
    await line.raw(tap);
    const n = line.outbox.length;
    expect((await line.raw(tap)).outcome).toBe("duplicate");
    expect(line.outbox.length).toBe(n);
    expect(await status(h, a.orderId)).toBe("ready");
    await expectBooksBalanced(h);
  });
});

describe("the ops line retries when the outbox cannot answer (A2's request)", () => {
  it("a staff turn and a rider turn rethrow OutboxUnavailable instead of sending an apology", async () => {
    line.failNextSend(new OutboxUnavailable("timeout"));
    await expect(line.text(PHONES.picker, "طلبات")).rejects.toThrow(/OUTBOX_UNAVAILABLE/);
    line.failNextSend(new OutboxUnavailable("timeout"));
    await expect(line.text(PHONES.rider(0), "حاضر")).rejects.toThrow(/OUTBOX_UNAVAILABLE/);
  });
});

void balance;
