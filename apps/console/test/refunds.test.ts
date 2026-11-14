// Refunds and credit (C2's 2.3, console side): refund_order, pay_out_credit and apply_customer_credit through the pages.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deliver, drawerUsd, dropAtHub, flashOf, ledgerSum, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string; let rider: string;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => {
  r = await rig(); village = await openShop(r.db);
  rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
  await r.db.rpc("start_shift", { p_driver: rider });
}, 120_000);

async function paidAndClosed() {
  const o = await placeOrder(r.db, village, "cod", 10);
  await deliver(r.db, o.id, rider);
  await r.db.rpc("rider_collect", { p_order: o.id, p_driver: rider, p_usd: o.total, p_lbp: 0 });
  expect((await r.db.one(`select status from orders where id = $1`, [o.id])).status).toBe("closed");
  return o;
}

/** A second, unpaid order for the same customer. */
async function nextOrder(o: Awaited<ReturnType<typeof placeOrder>>) {
  const place = (await r.db.one(`select id from customer_places where party_id = $1`, [o.customer])).id;
  const n = await r.db.rpc("create_order_from_quote", { p_customer: o.customer, p_conversation: o.conversation, p_lines: [{ product_id: o.product, qty: 9 }],
    p_village: village, p_place: place, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
  await r.db.rpc("confirm_order_checked", { p_order: n.order_id, p_party: o.customer, p_wamid: `w-next-${n.order_id}` });
  return (await r.db.one(`select id, short_code, total_usd from orders where id = $1`, [n.order_id])) as { id: string; short_code: string; total_usd: string };
}

describe("Refunds and credit", () => {
  it("refunds a closed order as credit once, keeps the rider's fee, pays out by Whish with a reference, then takes credit off the next order", async () => {
    const o = await paidAndClosed();
    await r.db.pg.query(`update parties set display_name = 'Customer Nour' where id = $1`, [o.customer]);
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    let page = (await b.get(`/refunds?order=${o.code}`)).text;
    expect(page).toContain(`${o.code} · closed`);
    expect(page).toContain("Leen Taanayel Labneh Premium");
    expect(page).toContain(`paid $${o.total.toFixed(2)}`);

    const key = "refund-form-key-1";
    let res = await b.post(`/refunds/${o.id}`, { amount_usd: "2.00", charged_to: "goods", reason: "damaged", settle: "credit", _key: key });
    expect(flashOf(res.text)).toBe("Refunded $2.00 as credit. The customer has $2.00 free to use.");
    res = await b.post(`/refunds/${o.id}`, { amount_usd: "2.00", charged_to: "goods", reason: "damaged", settle: "credit", _key: key });
    expect(flashOf(res.text)).toBe("That refund was already recorded; nothing changed.");
    expect(Number((await r.db.one(`select count(*) as n from refunds where order_id = $1`, [o.id])).n)).toBe(1);

    // The delivery fee is the rider's once the order closed (invariant 10): the database refuses, the page says what to do.
    res = await b.post(`/refunds/${o.id}`, { amount_usd: "1.00", charged_to: "delivery_fee", reason: "late", settle: "credit" });
    expect(flashOf(res.text)).toBe("The delivery fee belongs to the rider now. Charge compensation to goodwill instead.");
    res = await b.post(`/refunds/${o.id}`, { amount_usd: "500", charged_to: "goodwill", reason: "late", settle: "credit" });
    expect(flashOf(res.text)).toBe("That is more than was paid on this order, counting earlier refunds.");
    res = await b.post(`/refunds/${o.id}`, { amount_usd: "1.00", charged_to: "goodwill", reason: "other", settle: "credit" });
    expect(flashOf(res.text)).toBe("Write a note for reason 'other'.");
    // Whish without a reference: refused, and nothing at all is recorded (the refund and the payout are one call).
    res = await b.post(`/refunds/${o.id}`, { amount_usd: "1.00", charged_to: "goodwill", reason: "late", settle: "whish" });
    expect(flashOf(res.text)).toBe("Type the transfer reference (at least 4 characters).");
    expect(Number((await r.db.one(`select count(*) as n from refunds where order_id = $1`, [o.id])).n)).toBe(1);
    res = await b.post(`/refunds/${o.id}`, { amount_usd: "1.00", charged_to: "goodwill", reason: "late", settle: "whish", ref: "WH-77812" });
    expect(flashOf(res.text)).toBe("Refunded $1.00 and paid out by whish.");
    expect(await r.db.one(`select method, external_ref, by_party from credit_payouts where external_ref = 'WH-77812'`))
      .toEqual({ method: "whish", external_ref: "WH-77812", by_party: lead.partyId });

    // The customer is listed as owed $2.00; half is paid out in cash from the till.
    page = (await b.get("/refunds")).text;
    expect(page).toMatch(/Customer Nour<\/td><td>\$2\.00<\/td><td>\$2\.00/);
    // The till pays only what it holds (0081): empty, a cash payout and a cash refund are refused and nothing is recorded.
    const SHORT = "The drawer does not hold that much by the books. Count it, and check what came in today.";
    expect(await drawerUsd(r.db)).toBe(0);
    expect(flashOf((await b.post(`/credit/${o.customer}/pay`, { amount_usd: "0.50", method: "cash" })).text)).toBe(SHORT);
    expect(flashOf((await b.post(`/refunds/${o.id}`, { amount_usd: "0.50", charged_to: "goodwill", reason: "late", settle: "cash" })).text)).toBe(SHORT);
    expect(Number((await r.db.one(`select count(*) as n from refunds where order_id = $1`, [o.id])).n)).toBe(2);
    expect(Number((await r.db.one(`select count(*) as n from credit_payouts where method = 'cash'`)).n)).toBe(0);
    await dropAtHub(r.db, rider, lead.partyId);                  // the rider's cash from the order, at the hub
    const till = await drawerUsd(r.db);
    res = await b.post(`/credit/${o.customer}/pay`, { amount_usd: "0.50", method: "cash" });
    expect(flashOf(res.text)).toBe("Paid out $0.50 by cash. $1.50 of credit left.");
    res = await b.post(`/credit/${o.customer}/pay`, { amount_usd: "5", method: "cash" });
    expect(flashOf(res.text)).toBe("That is more than the customer's free credit.");
    expect(await drawerUsd(r.db)).toBeCloseTo(till - 0.5, 2);

    // The rest is taken off the customer's next order; the total drops, and the credit is used when that order is paid.
    const next = await nextOrder(o);
    page = (await b.get(`/refunds?order=${next.short_code}`)).text;
    expect(page).toContain("Take $1.50 off this order");
    res = await b.post(`/refunds/${next.id}/apply`);
    expect(flashOf(res.text)).toBe(`$1.50 taken off. The order now comes to $${(Number(next.total_usd) - 1.5).toFixed(2)}.`);
    expect(flashOf((await b.post(`/refunds/${next.id}/apply`)).text)).toBe("Credit was already taken off this order ($1.50).");
    expect(Number(await r.db.rpc("customer_credit_usd", { p_party: o.customer }))).toBe(0);
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
    expect(r.media.audit().filter((a) => a.action === "refund" && a.phase === "intent").every((a) => a.party_id === lead.partyId)).toBe(true);
  });

  it("an unpaid order cannot be refunded, and pickers cannot open the page", async () => {
    const o = await placeOrder(r.db, village, "cod", 8);
    const lead = await r.staff("admin");
    const b = r.browser();
    await b.signIn(lead);
    expect((await b.get(`/refunds?order=${o.code}`)).text).toContain("nothing yet");
    expect(flashOf((await b.post(`/refunds/${o.id}`, { amount_usd: "1", charged_to: "goods", reason: "damaged", settle: "credit" })).text))
      .toBe("Nothing was paid on this order: correct it, do not refund it.");
    expect(flashOf((await b.post(`/refunds/${o.id}`, { amount_usd: "1", charged_to: "rider", reason: "damaged", settle: "credit" })).text))
      .toBe("Pick what it is charged to from the list.");
    const picker = await r.staff("picker");
    const p = r.browser();
    await p.signIn(picker);
    expect((await p.get("/refunds")).status).toBe(403);
    await expect(r.db.rpc("refund_order", { p_order: o.id, p_by: picker.partyId, p_amount_usd: 1, p_charged_to: "goods", p_reason: "damaged" })).rejects.toThrow(/NOT_AUTHORISED/);
  });
});
