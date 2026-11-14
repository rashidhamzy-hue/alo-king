// G1-04 and G1-05 (session F1).
// A transfer that arrives after the 30-minute payment timer cancelled the order is no longer lost to the books: a screenshot for an
// order the timer cancelled in the last 24 hours is queued as a late payment, and accept_late_payment() books the money to the
// clearing account and to the customer's credit, once. An overpaid transfer books the surplus to customer credit, not to
// cash_over_short; more than 5% over the total waits for a second person.
import { beforeAll, describe, expect, it } from "vitest";
import { balance, expectBooksBalanced, openHub, type Hub } from "./hub-kit";

let h: Hub; let WATER: string; let second: string; let n = 0;
const credit = async (party: string) => Number(await h.db.rpc("customer_credit_usd", { p_party: party }));

/** A transfer order waiting for payment (the card was tapped, no money yet). */
async function awaiting(qty = 3) {
  const i = ++n;
  const t = await h.db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-late-${i}`, p_phone: `+9617600${String(i).padStart(4, "0")}`, p_name: `Late ${i}` });
  await h.db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: h.village });
  const place = (await h.db.one(`select id from customer_places where party_id = $1 limit 1`, [t.party_id])).id;
  const o = await h.db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_lines: [{ product_id: WATER, qty }],
    p_village: h.village, p_place: place, p_pickup: false, p_payment: "whish", p_change_for: null, p_notes: null });
  await h.db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: t.party_id, p_wamid: `w-late-${o.order_id}` });
  const total = Number((await h.db.one(`select total_usd from orders where id = $1`, [o.order_id])).total_usd);
  expect((await h.db.one(`select status from orders where id = $1`, [o.order_id])).status).toBe("awaiting_payment");
  return { orderId: o.order_id as string, customer: t.party_id as string, code: o.short_code as string, total };
}
/** The payment timer runs as if `minutes` had passed since the card was tapped. */
async function timerCancels(orderId: string, minutes = 31) {
  await h.db.pg.query(`update orders set confirmed_at = now() - make_interval(mins => $2) where id = $1`, [orderId, minutes]);
  await h.db.rpc("run_timers");
  expect((await h.db.one(`select status from orders where id = $1`, [orderId])).status).toBe("cancelled");
}
const proof = (o: { customer: string; orderId: string }, tag = "") => h.db.rpc("submit_payment_proof",
  { p_party: o.customer, p_wamid: `wamid.late.${o.orderId}${tag}`, p_media_path: `payment_proofs/${o.orderId}${tag}.jpg`, p_sha256: `sha-${o.orderId}${tag}` });

beforeAll(async () => {
  h = await openHub({ pickerOnOps: false });
  WATER = await h.product("Tannourine Mineral Water 2L X6");
  second = (await h.db.one(`insert into parties(role, display_name) values ('ops_lead', 'Maya') returning id`)).id;
}, 120_000);

describe("a transfer after the payment timer (G1-04)", () => {
  let o: Awaited<ReturnType<typeof awaiting>>; let proofId: string;

  it("a screenshot for an order the timer cancelled is queued as a late payment, not dropped", async () => {
    o = await awaiting();
    await timerCancels(o.orderId);
    const exp = await h.db.rpc("payment_expected", { p_party: o.customer });
    expect(exp).toMatchObject({ order_id: o.orderId, late: true });
    const p = await proof(o);
    expect(p).toMatchObject({ order_id: o.orderId, late: true, already: false });
    proofId = p.proof_id;
    const ex = await h.db.one(`select kind, detail from ops_exceptions where ref = $1`, [proofId]);
    expect(ex.kind).toBe("late_payment");
    const open = await h.db.rpc("payment_proofs_open", {});
    expect(open.find((x: { proof_id: string }) => x.proof_id === proofId)).toMatchObject({ late: true, order_status: "cancelled" });
  });

  it("accepting it as an ordinary payment is refused; accept_late_payment needs the ops lead, a reference and an amount", async () => {
    await expect(h.db.rpc("confirm_payment", { p_order: o.orderId, p_by: h.ops, p_external_ref: "WH-LATE-1", p_amount_usd: o.total }))
      .rejects.toThrow(/ORDER_CANCELLED_REFUND_NEEDED/);
    const late = (args: Record<string, unknown>) => h.db.rpc("accept_late_payment", { p_proof: proofId, p_by: h.ops, p_reference: "WH-LATE-1", p_amount_usd: o.total, ...args });
    await expect(late({ p_by: h.picker })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(late({ p_reference: "x" })).rejects.toThrow(/REFERENCE_REQUIRED/);
    await expect(late({ p_amount_usd: 0 })).rejects.toThrow(/BAD_AMOUNT/);
  });

  it("books the money to the clearing account and the customer's credit, once", async () => {
    const whish = await balance(h, "whish_clearing");
    const r = await h.db.rpc("accept_late_payment", { p_proof: proofId, p_by: h.ops, p_reference: "WH-LATE-1", p_amount_usd: o.total });
    expect(r).toMatchObject({ ok: true, duplicate: false });
    expect(await balance(h, "whish_clearing")).toBeCloseTo(whish + o.total, 2);
    expect(await credit(o.customer)).toBeCloseTo(o.total, 2);
    expect((await h.db.one(`select status from payment_proofs where id = $1`, [proofId])).status).toBe("confirmed");
    expect((await h.db.one(`select status from ops_exceptions where ref = $1`, [proofId])).status).toBe("resolved");
    // Again, by the same or another person: nothing more.
    expect(await h.db.rpc("accept_late_payment", { p_proof: proofId, p_by: second, p_reference: "WH-LATE-1", p_amount_usd: o.total }))
      .toMatchObject({ duplicate: true });
    expect(await credit(o.customer)).toBeCloseTo(o.total, 2);
    expect((await h.db.one(`select status from orders where id = $1`, [o.orderId])).status).toBe("cancelled");
    await expectBooksBalanced(h);
  });

  it("the same reference cannot then confirm another order", async () => {
    const other = await awaiting();
    await expect(h.db.rpc("confirm_payment", { p_order: other.orderId, p_by: h.ops, p_external_ref: "WH-LATE-1", p_amount_usd: other.total }))
      .rejects.toThrow(/REFERENCE_ALREADY_USED/);
    await h.db.rpc("confirm_payment", { p_order: other.orderId, p_by: h.ops, p_external_ref: "WH-ON-TIME-1", p_amount_usd: other.total });
  });

  it("accepting a late screenshot through review_payment_proof books it the same way", async () => {
    const x = await awaiting();
    await timerCancels(x.orderId);
    const p = await proof(x);
    const r = await h.db.rpc("review_payment_proof", { p_proof: p.proof_id, p_by: h.ops, p_accept: true, p_external_ref: "WH-LATE-2", p_amount_usd: x.total });
    expect(r).toMatchObject({ ok: true, late: true });
    expect(await credit(x.customer)).toBeCloseTo(x.total, 2);
    await expectBooksBalanced(h);
  });

  it("a screenshot sent in time but reviewed after the timer cancelled the order is booked as a late payment too", async () => {
    const x = await awaiting();
    const p = await proof(x);
    expect(p.late).toBe(false);
    await timerCancels(x.orderId);
    const open = (await h.db.rpc("payment_proofs_open", {})).find((q: { proof_id: string }) => q.proof_id === p.proof_id);
    expect(open).toMatchObject({ late: true, order_status: "cancelled" });
    const r = await h.db.rpc("review_payment_proof", { p_proof: p.proof_id, p_by: h.ops, p_accept: true, p_external_ref: "WH-LATE-3", p_amount_usd: x.total });
    expect(r).toMatchObject({ ok: true, late: true, duplicate: false });
    expect(await credit(x.customer)).toBeCloseTo(x.total, 2);
    expect((await h.db.one(`select status from ops_exceptions where ref = $1`, [p.proof_id])).status).toBe("resolved");
    await expectBooksBalanced(h);
  });

  it("not late: a cancellation older than 24 hours, or one the customer asked for", async () => {
    const old = await awaiting();
    await timerCancels(old.orderId);
    await h.db.pg.query(`update order_events set created_at = now() - interval '25 hours' where order_id = $1 and to_status = 'cancelled'`, [old.orderId]);
    expect(await h.db.rpc("payment_expected", { p_party: old.customer })).toBeNull();
    expect(await proof(old)).toMatchObject({ proof_id: null, reason: "no_order_awaiting_payment" });

    const asked = await awaiting();
    await h.db.rpc("transition_order", { p_order: asked.orderId, p_to: "cancelled", p_actor: "customer", p_actor_id: asked.customer, p_reason: "customer_cancelled" });
    expect(await h.db.rpc("payment_expected", { p_party: asked.customer })).toBeNull();
  });

  it("a rejected late screenshot moves nothing", async () => {
    const x = await awaiting();
    await timerCancels(x.orderId);
    const p = await proof(x);
    const before = Number((await h.db.one(`select count(*) as n from ledger_entries`)).n);
    await h.db.rpc("review_payment_proof", { p_proof: p.proof_id, p_by: h.ops, p_accept: false, p_note: "not in the account" });
    expect(Number((await h.db.one(`select count(*) as n from ledger_entries`)).n)).toBe(before);
    expect(await credit(x.customer)).toBeCloseTo(0, 2);
  });
});

describe("an overpaid transfer (G1-05)", () => {
  it("a small surplus becomes the customer's credit, not company income", async () => {
    const o = await awaiting(4);
    const over = Number((o.total * 0.03).toFixed(2));
    const cos = await balance(h, "cash_over_short");
    const r = await h.db.rpc("confirm_payment", { p_order: o.orderId, p_by: h.ops, p_external_ref: "WH-OVER-1", p_amount_usd: o.total + over });
    expect(r).toMatchObject({ ok: true, status: "confirmed" });
    expect(await balance(h, "cash_over_short")).toBeCloseTo(cos, 2);
    expect(await credit(o.customer)).toBeCloseTo(over, 2);
    await expectBooksBalanced(h);
  });

  it("more than 5% over waits for a second person; nothing is booked until then", async () => {
    const o = await awaiting(4);
    const amount = Number((o.total * 1.1).toFixed(2));
    const p = await proof(o);
    const before = Number((await h.db.one(`select count(*) as n from ledger_entries`)).n);
    const r = await h.db.rpc("review_payment_proof", { p_proof: p.proof_id, p_by: h.ops, p_accept: true, p_external_ref: "WH-OVER-2", p_amount_usd: amount });
    expect(r).toMatchObject({ ok: true, status: "awaiting_approval" });
    expect(Number((await h.db.one(`select count(*) as n from ledger_entries`)).n)).toBe(before);
    expect((await h.db.one(`select status from payment_proofs where id = $1`, [p.proof_id])).status).toBe("pending");
    expect((await h.db.rpc("payment_proofs_open", {})).find((x: { proof_id: string }) => x.proof_id === p.proof_id).approval_id).toBe(r.approval_id);
    // The same request again is the same approval.
    expect(await h.db.rpc("confirm_payment", { p_order: o.orderId, p_by: h.ops, p_external_ref: "WH-OVER-2", p_amount_usd: amount }))
      .toMatchObject({ status: "awaiting_approval", approval_id: r.approval_id });
    await expect(h.db.rpc("decide_approval", { p_id: r.approval_id, p_by: h.ops, p_approve: true })).rejects.toThrow(/SAME_PERSON/);
    const d = await h.db.rpc("decide_approval", { p_id: r.approval_id, p_by: second, p_approve: true });
    expect(d).toMatchObject({ ok: true, status: "approved" });
    expect(await credit(o.customer)).toBeCloseTo(amount - o.total, 2);
    expect((await h.db.one(`select status from orders where id = $1`, [o.orderId])).status).toBe("confirmed");
    expect((await h.db.one(`select status from payment_proofs where id = $1`, [p.proof_id])).status).toBe("confirmed");
    const pay = await h.db.one(`select confirmed_by, received_usd from payments where order_id = $1 and status = 'confirmed'`, [o.orderId]);
    expect(pay.confirmed_by).toBe(h.ops);
    await expectBooksBalanced(h);
  });

  it("a rejected overpayment moves nothing and the order still waits", async () => {
    const o = await awaiting(4);
    const r = await h.db.rpc("confirm_payment", { p_order: o.orderId, p_by: h.ops, p_external_ref: "WH-OVER-3", p_amount_usd: o.total * 2 });
    expect(r.status).toBe("awaiting_approval");
    await h.db.rpc("decide_approval", { p_id: r.approval_id, p_by: second, p_approve: false, p_note: "typo" });
    expect((await h.db.one(`select status from orders where id = $1`, [o.orderId])).status).toBe("awaiting_payment");
    expect(await credit(o.customer)).toBeCloseTo(0, 2);
  });
});
