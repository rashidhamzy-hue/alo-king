// Build plan 2.3: refunds and complaints after delivery, on the real schema. Credit on the next order, or a cash or Whish
// refund, each with its own ledger entries; the rider's fee is never taken back; every transaction balances.
import { beforeAll, describe, expect, it } from "vitest";
import { balance, collect, deliverToDoor, dropAtHub, expectBooksBalanced, openHub, placeOrder, status, total, type Hub, type Placed } from "./hub-kit";

let h: Hub; let WATER: string; let COFFEE: string; let first: Placed;
const credit = async (party: string) => Number(await h.db.rpc("customer_credit_usd", { p_party: party }));
const refund = (args: Record<string, unknown>) => h.db.rpc("refund_order", { p_order: first.orderId, p_by: h.ops, ...args });

beforeAll(async () => {
  h = await openHub({ pickerOnOps: false });
  WATER = await h.product("Tannourine Mineral Water 2L X6");
  COFFEE = await h.product("Najjar Cafe Classic Normal 180G");
  first = await placeOrder(h, [{ product_id: WATER, qty: 2 }, { product_id: COFFEE, qty: 1 }]);
  await deliverToDoor(h, first.orderId);
  await collect(h, first.orderId);
  expect(await status(h, first.orderId)).toBe("closed");
}, 120_000);

describe("refunds after delivery (2.3)", () => {
  it("a crushed coffee is refunded as credit: goods revenue reversed, the customer owed it", async () => {
    const goodsBefore = Number(await h.db.rpc("order_revenue_usd", { p_order: first.orderId, p_code: "revenue_goods" }));
    const r = await refund({ p_amount_usd: 3.25, p_charged_to: "goods", p_reason: "damaged", p_key: "complaint-1" });
    expect(r).toMatchObject({ ok: true, settle: "credit" });
    expect(await credit(first.customer)).toBeCloseTo(3.25, 2);
    expect(Number(await h.db.rpc("order_revenue_usd", { p_order: first.orderId, p_code: "revenue_goods" }))).toBeCloseTo(goodsBefore - 3.25, 2);
    // the same request again (a double click in the console) changes nothing
    expect(await refund({ p_amount_usd: 3.25, p_charged_to: "goods", p_reason: "damaged", p_key: "complaint-1" })).toMatchObject({ duplicate: true });
    expect(await credit(first.customer)).toBeCloseTo(3.25, 2);
    await expectBooksBalanced(h);
  });

  it("never takes the delivery fee back from the rider; compensation is a company cost", async () => {
    const riderBefore = await balance(h, `rider_payable:${h.riders[0]}`);
    await expect(refund({ p_amount_usd: 1, p_charged_to: "delivery_fee", p_reason: "late" })).rejects.toThrow(/REFUND_EXCEEDS_REVENUE.*belongs to the rider/);
    await refund({ p_amount_usd: 1, p_charged_to: "goodwill", p_reason: "late" });
    expect(await balance(h, "refund_expense")).toBeCloseTo(1, 2);
    expect(await balance(h, `rider_payable:${h.riders[0]}`)).toBeCloseTo(riderBefore, 2);
    expect(await credit(first.customer)).toBeCloseTo(4.25, 2);
  });

  it("refuses more than the goods revenue still booked, more than was paid, and anyone but the ops lead", async () => {
    await expect(refund({ p_amount_usd: 50, p_charged_to: "goods", p_reason: "missing_item" })).rejects.toThrow(/REFUND_EXCEEDS/);
    await expect(refund({ p_amount_usd: 50, p_charged_to: "goodwill", p_reason: "other", p_note: "angry" })).rejects.toThrow(/REFUND_EXCEEDS_PAID/);
    await expect(h.db.rpc("refund_order", { p_order: first.orderId, p_by: h.riders[0], p_amount_usd: 1, p_charged_to: "goods", p_reason: "damaged" }))
      .rejects.toThrow(/NOT_AUTHORISED/);
    await expect(refund({ p_amount_usd: 1, p_charged_to: "goodwill", p_reason: "other" })).rejects.toThrow(/NOTE_REQUIRED/);
  });

  it("pays out by Whish only with a reference, and in cash from the hub till", async () => {
    await expect(h.db.rpc("pay_out_credit", { p_party: first.customer, p_amount: 1, p_method: "whish", p_by: h.ops })).rejects.toThrow(/REFERENCE_REQUIRED/);
    await expect(h.db.rpc("pay_out_credit", { p_party: first.customer, p_amount: 99, p_method: "cash", p_by: h.ops })).rejects.toThrow(/EXCEEDS_CREDIT/);
    await dropAtHub(h);                     // F1 (G1-02): the drawer pays only what it holds, so the rider's cash comes in first
    const tillBefore = await balance(h, "hub_cash");
    await h.db.rpc("pay_out_credit", { p_party: first.customer, p_amount: 1, p_method: "cash", p_by: h.ops, p_key: "po-1" });
    expect(await balance(h, "hub_cash")).toBeCloseTo(tillBefore - 1, 2);
    const whishBefore = await balance(h, "whish_clearing");
    const r = await refund({ p_amount_usd: 2, p_charged_to: "goods", p_reason: "wrong_item", p_settle: "whish", p_ref: "WH-778899" });
    expect(r.settle).toBe("whish");
    expect(await balance(h, "whish_clearing")).toBeCloseTo(whishBefore - 2, 2);
    expect(await credit(first.customer)).toBeCloseTo(3.25, 2);           // 4.25 - 1 cash; the Whish refund was paid out at once
    await expectBooksBalanced(h);
  });

  it("credit comes off the next order: the rider collects the lower total and the credit is used up", async () => {
    const next = await placeOrder(h, [{ product_id: WATER, qty: 3 }], "cod", { party: first.customer, conversation: first.conversation });
    const full = await total(h, next.orderId);
    const a = await h.db.rpc("apply_customer_credit", { p_order: next.orderId });
    expect(Number(a.applied_usd)).toBeCloseTo(3.25, 2);
    expect(await total(h, next.orderId)).toBeCloseTo(full - 3.25, 2);
    expect(await credit(first.customer)).toBeCloseTo(0, 2);             // already promised to this order: not usable twice
    expect(Number((await h.db.rpc("apply_customer_credit", { p_order: next.orderId })).applied_usd)).toBeCloseTo(3.25, 2);   // idempotent
    await deliverToDoor(h, next.orderId);
    await collect(h, next.orderId);
    expect(await status(h, next.orderId)).toBe("closed");
    expect(await balance(h, `customer_credit:${first.customer}`)).toBeCloseTo(0, 2);
    expect(await balance(h, `customer_receivable:${first.customer}`)).toBeCloseTo(0, 2);
    expect(Number(await h.db.rpc("customer_dues_usd", { p_customer: first.customer }))).toBeCloseTo(0, 2);
    await expectBooksBalanced(h);
  });

  it("a cancelled order gives the credit back untouched", async () => {
    await refund({ p_amount_usd: 1.5, p_charged_to: "goods", p_reason: "missing_item" });
    const next = await placeOrder(h, [{ product_id: WATER, qty: 3 }], "cod", { party: first.customer, conversation: first.conversation });
    await h.db.rpc("apply_customer_credit", { p_order: next.orderId });
    expect(await credit(first.customer)).toBeCloseTo(0, 2);
    await h.db.rpc("transition_order", { p_order: next.orderId, p_to: "cancelled", p_actor: "customer" });
    expect(await credit(first.customer)).toBeCloseTo(1.5, 2);
    const view = await h.db.rpc("customer_credit_view", { p_party: first.customer });
    expect(view.refunds.length).toBeGreaterThanOrEqual(4);
  });

  it("a prepaid order is refunded the same way, and an unpaid order is corrected, never refunded", async () => {
    const pre = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }], "whish");
    await h.db.rpc("grant_customer_credit", { p_order: pre.orderId, p_amount: 3.25, p_charged_to: "goods", p_reason: "missing_at_pick", p_by: null, p_key: "pick-x" });
    expect(await credit(pre.customer)).toBeCloseTo(3.25, 2);
    const unpaid = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }]);
    await expect(h.db.rpc("refund_order", { p_order: unpaid.orderId, p_by: h.ops, p_amount_usd: 1, p_charged_to: "goods", p_reason: "damaged" }))
      .rejects.toThrow(/ORDER_NOT_PAID/);
    await expectBooksBalanced(h);
  });
});
