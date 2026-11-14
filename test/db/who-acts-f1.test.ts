// G1-06, G1-07, G1-25 (session F1): every function where a person acts checks that person in SQL with require_role() (0045):
// the role, and that the party is not blocked. A removed ops lead's party id no longer confirms payments or pays riders.
// can_send checks the role against the line explicitly: customers only on the customer line, staff only on the ops line.
import { beforeAll, describe, expect, it } from "vitest";
import { collect, deliverToDoor, expectBooksBalanced, openHub, placeOrder, type Hub, type Placed } from "./hub-kit";

let h: Hub; let WATER: string; let gone: string; let goneRider: string; let paid: Placed;
const party = async (role: string, blocked = false) =>
  (await h.db.one(`insert into parties(role, display_name, is_blocked) values ($1, $2, $3) returning id`, [role, `${role}-${blocked}`, blocked])).id as string;

beforeAll(async () => {
  h = await openHub({ pickerOnOps: false });
  WATER = await h.product("Tannourine Mineral Water 2L X6");
  gone = await party("ops_lead", true);
  goneRider = await party("driver", true);
  paid = await placeOrder(h, [{ product_id: WATER, qty: 3 }], "whish");
  await deliverToDoor(h, paid.orderId);                      // delivered and closed, so it is never batched with a later order
}, 120_000);

let n = 0;
/** A new customer with a transfer order waiting for payment. */
async function awaitingTransfer() {
  const i = ++n;
  const t = await h.db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-who-${i}`, p_phone: `+9617800${String(i).padStart(4, "0")}`, p_name: `Who ${i}` });
  await h.db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: h.village });
  const place = (await h.db.one(`select id from customer_places where party_id = $1 limit 1`, [t.party_id])).id;
  const q = await h.db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_lines: [{ product_id: WATER, qty: 3 }],
    p_village: h.village, p_place: place, p_pickup: false, p_payment: "whish", p_change_for: null, p_notes: null });
  await h.db.rpc("confirm_order_checked", { p_order: q.order_id, p_party: t.party_id, p_wamid: `w-who-${q.order_id}` });
  return { orderId: q.order_id as string, customer: t.party_id as string, total: Number((await h.db.one(`select total_usd from orders where id = $1`, [q.order_id])).total_usd) };
}

describe("a blocked ops lead acts nowhere (G1-06)", () => {
  it("confirm_payment, review_payment_proof and pay_rider_earnings refuse a blocked party", async () => {
    const o = await awaitingTransfer();
    await expect(h.db.rpc("confirm_payment", { p_order: o.orderId, p_by: gone, p_external_ref: "WH-GONE-1", p_amount_usd: o.total })).rejects.toThrow(/NOT_AUTHORISED/);
    const p = await h.db.rpc("submit_payment_proof", { p_party: o.customer, p_wamid: `wamid.who.${o.orderId}`, p_media_path: `p/${o.orderId}.jpg`, p_sha256: `sha-who-${o.orderId}` });
    await expect(h.db.rpc("review_payment_proof", { p_proof: p.proof_id, p_by: gone, p_accept: true, p_external_ref: "WH-GONE-2", p_amount_usd: o.total })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(h.db.rpc("review_payment_proof", { p_proof: p.proof_id, p_by: gone, p_accept: false })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(h.db.rpc("pay_rider_earnings", { p_driver: h.riders[0], p_by: gone })).rejects.toThrow(/NOT_AUTHORISED/);
    expect((await h.db.one(`select status from payment_proofs where id = $1`, [p.proof_id])).status).toBe("pending");
  });
});

describe("the base functions check who acts (G1-07)", () => {
  it("declare_cash_drop: only a rider declares their own drop, never a negative or empty one", async () => {
    const c = await placeOrder(h, [{ product_id: WATER, qty: 3 }]);
    await deliverToDoor(h, c.orderId, h.riders[0]);
    await collect(h, c.orderId, h.riders[0]);
    await expect(h.db.rpc("declare_cash_drop", { p_driver: h.ops, p_method: "hub", p_usd: 1, p_lbp: 0 })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(h.db.rpc("declare_cash_drop", { p_driver: c.customer, p_method: "hub", p_usd: 1, p_lbp: 0 })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(h.db.rpc("declare_cash_drop", { p_driver: goneRider, p_method: "hub", p_usd: 1, p_lbp: 0 })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(h.db.rpc("declare_cash_drop", { p_driver: h.riders[0], p_method: "hub", p_usd: -5, p_lbp: 0 })).rejects.toThrow(/BAD_AMOUNT/);
    await expect(h.db.rpc("declare_cash_drop", { p_driver: h.riders[0], p_method: "hub", p_usd: 1, p_lbp: -1000 })).rejects.toThrow(/BAD_AMOUNT/);
    await expect(h.db.rpc("declare_cash_drop", { p_driver: h.riders[0], p_method: "hub", p_usd: 0, p_lbp: 0 })).rejects.toThrow(/BAD_AMOUNT/);
    expect(await h.db.rpc("declare_cash_drop", { p_driver: h.riders[0], p_method: "hub", p_usd: 1, p_lbp: 0 })).toBeTruthy();
  });

  it("the ops lead still takes in the cash of a rider who was removed", async () => {
    // A removed rider's cash still has to come back: ops receives it (0035), acting for them.
    const c = await placeOrder(h, [{ product_id: WATER, qty: 3 }]);
    await deliverToDoor(h, c.orderId, h.riders[0]);
    await collect(h, c.orderId, h.riders[0]);
    await h.db.pg.query(`update parties set is_blocked = true where id = $1`, [h.riders[0]]);
    await expect(h.db.rpc("receive_rider_cash", { p_driver: h.riders[0], p_by: gone })).rejects.toThrow(/NOT_AUTHORISED/);
    const r = await h.db.rpc("receive_rider_cash", { p_driver: h.riders[0], p_by: h.ops });
    expect(r).toMatchObject({ ok: true });
    expect(Number(r.cash_left_usd)).toBeCloseTo(0, 2);
    await h.db.pg.query(`update parties set is_blocked = false where id = $1`, [h.riders[0]]);
    await expectBooksBalanced(h);
  });

  it("grant_customer_credit and apply_customer_credit: a named person must be staff and not blocked", async () => {
    const g = (by: string | null, reason = "damaged") => h.db.rpc("grant_customer_credit",
      { p_order: paid.orderId, p_amount: 0.1, p_charged_to: "goodwill", p_reason: reason, p_by: by });
    await expect(g(paid.customer)).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(g(h.riders[0])).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(g(gone)).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(g(null)).rejects.toThrow(/NOT_AUTHORISED/);                   // no person: only the reasons code gives itself
    expect(await g(h.ops)).toBeTruthy();
    expect(await g(h.picker, "missing_at_pick")).toBeTruthy();
    expect(await g(null, "substitute_cheaper")).toBeTruthy();
    const o = await awaitingTransfer();
    await expect(h.db.rpc("apply_customer_credit", { p_order: o.orderId, p_by: o.customer })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(h.db.rpc("apply_customer_credit", { p_order: o.orderId, p_by: gone })).rejects.toThrow(/NOT_AUTHORISED/);
    expect(await h.db.rpc("apply_customer_credit", { p_order: o.orderId, p_by: h.ops })).toMatchObject({ applied_usd: expect.anything() });
    await expectBooksBalanced(h);
  });

  it("open_complaint refuses a blocked ops lead", async () => {
    await expect(h.db.rpc("open_complaint", { p_order: paid.orderId, p_kind: "late", p_detail: "an hour late", p_by: gone })).rejects.toThrow(/NOT_AUTHORISED/);
    expect(await h.db.rpc("open_complaint", { p_order: paid.orderId, p_kind: "late", p_detail: "an hour late", p_by: h.ops })).toMatchObject({ ok: true });
  });

  it("the pick helpers refuse anyone who is not staff, even when called directly", async () => {
    const o = await placeOrder(h, [{ product_id: WATER, qty: 3 }]);
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: h.picker });
    const item = (await h.db.one(`select id from order_items where order_id = $1 and status = 'ok'`, [o.orderId])).id;
    await expect(h.db.rpc("pick_short_line", { p_item: item, p_by: o.customer, p_found: 0, p_cause: "not_on_shelf" })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(h.db.rpc("pick_short_line", { p_item: item, p_by: h.riders[0], p_found: 0, p_cause: "not_on_shelf" })).rejects.toThrow(/NOT_AUTHORISED/);
    const missing = await h.db.rpc("pick_short_line", { p_item: item, p_by: h.picker, p_found: 1, p_cause: "not_on_shelf" });
    await expect(h.db.rpc("pick_remove_line", { p_missing: missing, p_by: o.customer })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(h.db.rpc("pick_decide_missing", { p_missing: missing, p_by: gone })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(h.db.rpc("pick_found_held", { p_item: item, p_by: o.customer })).rejects.toThrow(/NOT_AUTHORISED/);
    expect(await h.db.rpc("pick_remove_line", { p_missing: missing, p_by: h.picker })).toBeTruthy();
    await expectBooksBalanced(h);
  });
});

describe("two numbers never cross, checked in can_send (G1-25)", () => {
  const send = (p: string, line: string) => h.db.rpc("can_send", { p_party: p, p_line: line, p_category: "utility", p_is_template: true });

  it("a customer is never sent anything on the ops line; staff are never sent anything on the customer line", async () => {
    expect(await send(paid.customer, "ops")).toBe("wrong_line");
    for (const staff of [h.ops, h.picker, h.riders[0]!]) expect(await send(staff, "customer")).toBe("wrong_line");
    const merchant = await party("merchant");
    expect(await send(merchant, "customer")).toBe("wrong_line");
    expect(await send(paid.customer, "customer")).not.toBe("wrong_line");
    expect(await send(h.ops, "ops")).not.toBe("wrong_line");
    // Service replies (inside the 24-hour window) are checked the same way.
    expect(await h.db.rpc("can_send", { p_party: paid.customer, p_line: "ops", p_category: "service", p_is_template: false })).toBe("wrong_line");
  });

  it("marketing is still refused first, and an unknown party is still unknown", async () => {
    expect(await h.db.rpc("can_send", { p_party: h.ops, p_line: "customer", p_category: "marketing", p_is_template: true })).toBe("marketing_disabled");
    expect(await send("00000000-0000-0000-0000-000000000000", "customer")).toBe("unknown_party");
  });
});
