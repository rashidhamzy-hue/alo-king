// G1-02, G1-03, G1-08 (session F1): no function takes the hub drawer below zero, whoever calls it.
// The base pay_supplier and cash pay_out_credit, pay_rider_earnings' "the hub pays the rest", and a damaged note on a hub drop
// all check drawer_can_pay() (0081) themselves now, not only through the console's _checked wrappers.
// record_damaged_note takes a request key, is for the ops lead or an admin, and refuses an amount that is not positive or exceeds
// the drop. pay_supplier takes a request key and refuses more than is owed unless the payment is marked as an advance.
import { beforeAll, describe, expect, it } from "vitest";
import { balance, collect, deliverToDoor, dropAtHub, expectBooksBalanced, openHub, placeOrder, type Hub, type Placed } from "./hub-kit";

let h: Hub; let WATER: string; let supplier: string; let prepaid: Placed; let cod: Placed; let blockedLead: string;
const drawer = () => balance(h, "hub_cash");
const soon = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  h = await openHub({ riders: 2, pickerOnOps: false });
  WATER = await h.product("Tannourine Mineral Water 2L X6");
  blockedLead = (await h.db.one(`insert into parties(role, display_name, is_blocked) values ('ops_lead', 'Gone', true) returning id`)).id;
  supplier = await h.db.rpc("create_supplier", { p_name: "Water Co", p_by: h.ops });
  // 12 USD owed to the supplier, received on credit.
  await h.db.rpc("receive_goods", { p_supplier: supplier, p_source: h.hub, p_by: h.ops, p_supplier_ref: "INV-W1",
    p_lines: [{ product_id: WATER, qty: 4, unit_cost_usd: 3, expiry_date: soon }] });
  // Rider 2 delivers a prepaid order: their fee is owed by the hub, and they hold no cash to keep it from.
  prepaid = await placeOrder(h, [{ product_id: WATER, qty: 3 }], "whish");
  await deliverToDoor(h, prepaid.orderId, h.riders[1]);
  await h.db.rpc("close_shift", { p_driver: h.riders[1] });          // off shift, so the next offers go to rider 1
  // Rider 1 delivers a cash order and keeps the cash for now.
  cod = await placeOrder(h, [{ product_id: WATER, qty: 3 }]);
  await deliverToDoor(h, cod.orderId, h.riders[0]);
  await collect(h, cod.orderId, h.riders[0]);
  // The customer of the paid order is owed a little credit.
  await h.db.rpc("refund_order", { p_order: prepaid.orderId, p_by: h.ops, p_amount_usd: 1, p_charged_to: "goodwill", p_reason: "late" });
}, 120_000);

describe("the drawer never goes below zero (G1-02)", () => {
  it("the drawer starts empty", async () => {
    expect(await drawer()).toBeCloseTo(0, 2);
  });

  it("the base pay_supplier refuses to pay from an empty drawer", async () => {
    await expect(h.db.rpc("pay_supplier", { p_supplier: supplier, p_amount_usd: 5, p_by: h.ops, p_ref: "PAY-W1" })).rejects.toThrow(/NOT_ENOUGH_CASH hub_cash/);
    expect(await drawer()).toBeCloseTo(0, 2);
  });

  it("the base pay_out_credit refuses a cash payout from an empty drawer; Whish still works with a reference", async () => {
    await expect(h.db.rpc("pay_out_credit", { p_party: prepaid.customer, p_amount: 0.5, p_method: "cash", p_by: h.ops })).rejects.toThrow(/NOT_ENOUGH_CASH hub_cash/);
    await h.db.rpc("pay_out_credit", { p_party: prepaid.customer, p_amount: 0.25, p_method: "whish", p_by: h.ops, p_ref: "WH-PO-1" });
    expect(await drawer()).toBeCloseTo(0, 2);
  });

  it("pay_rider_earnings refuses when the hub would pay the rest from an empty drawer, and moves nothing", async () => {
    const owed = Number((await h.db.rpc("rider_statement", { p_driver: h.riders[1] })).earnings_usd);
    expect(owed).toBeGreaterThan(0);
    await expect(h.db.rpc("pay_rider_earnings", { p_driver: h.riders[1], p_by: h.ops })).rejects.toThrow(/NOT_ENOUGH_CASH hub_cash/);
    expect(Number((await h.db.rpc("rider_statement", { p_driver: h.riders[1] })).earnings_usd)).toBeCloseTo(owed, 2);
    expect(await drawer()).toBeCloseTo(0, 2);
  });

  it("once a rider's cash is dropped at the hub, each of them pays, and never past zero", async () => {
    const filled = await dropAtHub(h, h.riders[0]);
    expect(filled).toBeGreaterThan(5);
    const owed = Number((await h.db.rpc("rider_statement", { p_driver: h.riders[1] })).earnings_usd);
    const paid = await h.db.rpc("pay_rider_earnings", { p_driver: h.riders[1], p_by: h.ops });
    expect(Number(paid.paid_from_hub_usd)).toBeCloseTo(owed, 2);
    await h.db.rpc("pay_out_credit", { p_party: prepaid.customer, p_amount: 0.5, p_method: "cash", p_by: h.ops, p_key: "po-f1" });
    const left = await drawer();
    await expect(h.db.rpc("pay_supplier", { p_supplier: supplier, p_amount_usd: Number((left + 0.01).toFixed(2)), p_by: h.ops, p_ref: "PAY-W2" }))
      .rejects.toThrow(/NOT_ENOUGH_CASH/);
    await h.db.rpc("pay_supplier", { p_supplier: supplier, p_amount_usd: Number(left.toFixed(2)), p_by: h.ops, p_ref: "PAY-W3" });
    expect(await drawer()).toBeCloseTo(0, 2);
    await expectBooksBalanced(h);
  });
});

describe("paying a supplier (G1-08)", () => {
  it("refuses more than is owed unless it is marked as an advance; a request key makes a double tap one payment", async () => {
    const o = await placeOrder(h, [{ product_id: WATER, qty: 5 }]);
    await deliverToDoor(h, o.orderId, h.riders[0]);
    await collect(h, o.orderId, h.riders[0]);
    await dropAtHub(h, h.riders[0]);
    const owed = Number(await h.db.rpc("supplier_balance", { p_supplier: supplier }));
    expect(owed).toBeGreaterThan(0);
    const over = Number((owed + 1).toFixed(2));
    await expect(h.db.rpc("pay_supplier", { p_supplier: supplier, p_amount_usd: over, p_by: h.ops, p_ref: "PAY-W4", p_key: "k-1" }))
      .rejects.toThrow(/EXCEEDS_OWED/);
    const adv = await h.db.rpc("pay_supplier", { p_supplier: supplier, p_amount_usd: over, p_by: h.ops, p_ref: "PAY-W4", p_key: "k-1", p_advance: true });
    expect(adv).toMatchObject({ ok: true, duplicate: false, advance: true });
    expect(Number(adv.owed_usd)).toBeCloseTo(-1, 2);
    const drawerAfter = await drawer();
    // The same key with another reference (a double tap that retyped it) is the same payment.
    expect(await h.db.rpc("pay_supplier", { p_supplier: supplier, p_amount_usd: over, p_by: h.ops, p_ref: "PAY-W4b", p_key: "k-1", p_advance: true }))
      .toMatchObject({ duplicate: true });
    // The same reference without a key is still recognised, as before.
    expect(await h.db.rpc("pay_supplier", { p_supplier: supplier, p_amount_usd: over, p_by: h.ops, p_ref: "PAY-W4" })).toMatchObject({ duplicate: true });
    expect(await drawer()).toBeCloseTo(drawerAfter, 2);
    const row = await h.db.one(`select amount_usd, advance, request_key, by_party from supplier_payments where request_key = 'k-1'`);
    expect(row).toMatchObject({ advance: true, by_party: h.ops });
    await expect(h.db.rpc("pay_supplier", { p_supplier: supplier, p_amount_usd: 1, p_by: blockedLead, p_ref: "PAY-W9" })).rejects.toThrow(/NOT_AUTHORISED/);
    await expectBooksBalanced(h);
  });
});

describe("a damaged note (G1-03)", () => {
  let drop: string;
  beforeAll(async () => {
    const o = await placeOrder(h, [{ product_id: WATER, qty: 3 }]);
    await deliverToDoor(h, o.orderId, h.riders[0]);
    await collect(h, o.orderId, h.riders[0]);
    const n = await h.db.one(`select * from driver_cash_native($1)`, [h.riders[0]]);
    drop = await h.db.rpc("declare_cash_drop", { p_driver: h.riders[0], p_method: "hub", p_usd: Number(n.usd), p_lbp: Number(n.lbp) });
    // Empty the drawer: the rest goes to the supplier as an advance.
    const left = Number((await drawer()).toFixed(2));
    if (left > 0) await h.db.rpc("pay_supplier", { p_supplier: supplier, p_amount_usd: left, p_by: h.ops, p_ref: "PAY-EMPTY", p_advance: true });
  });
  const note = (args: Record<string, unknown>) => h.db.rpc("record_damaged_note", { p_drop: drop, p_amount_usd: 1, p_by: h.ops, p_key: "dn-1", ...args });

  it("needs a request key, the ops lead or an admin, and an amount above zero within the drop", async () => {
    await expect(note({ p_key: null })).rejects.toThrow(/REQUEST_KEY_REQUIRED/);
    await expect(note({ p_by: h.picker })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(note({ p_by: blockedLead })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(note({ p_amount_usd: 0 })).rejects.toThrow(/BAD_AMOUNT/);
    await expect(note({ p_amount_usd: -5 })).rejects.toThrow(/BAD_AMOUNT/);
    const d = await h.db.one(`select declared_usd from cash_drops where id = $1`, [drop]);
    await expect(note({ p_amount_usd: Number(d.declared_usd) + 1 })).rejects.toThrow(/EXCEEDS_DROP/);
  });

  it("on a hub drop not yet in the drawer, an empty drawer refuses it", async () => {
    expect(await drawer()).toBeCloseTo(0, 2);
    await expect(note({})).rejects.toThrow(/NOT_ENOUGH_CASH hub_cash/);
    expect(Number((await h.db.one(`select count(*) as n from damaged_notes`)).n)).toBe(0);
  });

  it("once the drop is in the drawer, it is taken out once per key and the drawer stays at or above zero", async () => {
    await h.db.rpc("confirm_cash_drop", { p_drop: drop, p_by: h.ops });
    const before = await drawer();
    const r = await note({});
    expect(r).toMatchObject({ absorbed_by: "company", duplicate: false });
    expect(await note({})).toMatchObject({ duplicate: true });
    expect(await drawer()).toBeCloseTo(before - 1, 2);
    expect(Number((await h.db.one(`select count(*) as n from damaged_notes where drop_id = $1`, [drop])).n)).toBe(1);
    // A second note on the same drop cannot take more than is left of it.
    const d = await h.db.one(`select declared_usd from cash_drops where id = $1`, [drop]);
    await expect(note({ p_key: "dn-2", p_amount_usd: Number(d.declared_usd) })).rejects.toThrow(/EXCEEDS_DROP/);
    expect(await drawer()).toBeGreaterThanOrEqual(0);
    await expectBooksBalanced(h);
  });
});
