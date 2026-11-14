// Session F1: the console pages F1 owns. Payments: a late payment (G1-04) is shown as one and booked as the customer's credit;
// an overpaid transfer (G1-05) waits for a second person above 5%, and a smaller surplus is the customer's credit.
// Cash and riders: the hub pays a rider's earnings only from what the drawer holds (G1-02), a damaged note is recorded once
// per form (G1-03), and each rider's cash over/short at the door today is shown (G1-01).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deliver, drawerUsd, dropAtHub, flashOf, ledgerSum, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { r = await rig(); village = await openShop(r.db); }, 120_000);

const credit = async (party: string) => Number(await r.db.rpc("customer_credit_usd", { p_party: party }));
async function proofFor(o: { id: string; customer: string }) {
  return (await r.db.rpc("submit_payment_proof", { p_party: o.customer, p_wamid: `wamid.f1.${o.id}`, p_media_path: `payment_proofs/${o.id}.jpg`, p_sha256: `sha-f1-${o.id}` })).proof_id as string;
}
async function timerCancels(orderId: string) {
  await r.db.pg.query(`update orders set confirmed_at = now() - interval '31 minutes' where id = $1`, [orderId]);
  await r.db.rpc("run_timers");
}

describe("Payments: late and overpaid transfers", () => {
  it("a screenshot after the timer is shown as a late payment and booked as the customer's credit", async () => {
    const o = await placeOrder(r.db, village, "whish");
    await timerCancels(o.id);
    const proof = await proofFor(o);
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    const page = (await b.get("/payments")).text;
    expect(page).toContain("Late payment.");
    expect(page).toContain("Book as the customer&#39;s credit");
    const res = await b.post(`/payments/proof/${proof}`, { decision: "confirm", amount_usd: o.total.toFixed(2), reference: "WH-F1-LATE" });
    expect(flashOf(res.text)).toMatch(/^Late payment booked as the customer's credit \(\$[\d.]+\)\. The order stays cancelled/);
    expect(await credit(o.customer)).toBeCloseTo(o.total, 2);
    expect(res.text).not.toContain(o.code);
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
  });

  it("more than 5% over waits for a second person; a small surplus is the customer's credit", async () => {
    const lead = await r.staff("ops_lead", "Nour");
    const b = r.browser();
    await b.signIn(lead);
    const big = await placeOrder(r.db, village, "whish");
    const proof = await proofFor(big);
    await b.get("/payments");
    let res = await b.post(`/payments/proof/${proof}`, { decision: "confirm", amount_usd: (big.total * 1.2).toFixed(2), reference: "WH-F1-BIG" });
    expect(flashOf(res.text)).toMatch(/% over the order total: it waits for a second person on Approvals\. Nothing is booked yet\.$/);
    expect(res.text).toContain("Waiting for a second person");
    expect(await credit(big.customer)).toBe(0);

    const small = await placeOrder(r.db, village, "omt");
    res = await b.post(`/payments/order/${small.id}`, { amount_usd: (small.total + 0.3).toFixed(2), reference: "OMT-F1-SMALL" });
    expect(flashOf(res.text)).toBe("Payment confirmed and booked. $0.30 over the total is the customer's credit.");
    expect(await credit(small.customer)).toBeCloseTo(0.3, 2);
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
  });
});

describe("Cash and riders", () => {
  // A database of its own: the paid orders above would otherwise be batched onto this rider.
  beforeAll(async () => { r = await rig(); village = await openShop(r.db); }, 120_000);

  it("refuses to pay a rider from an empty drawer, shows over/short today, and records a damaged note once", async () => {
    const rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Samir') returning id`)).id;
    await r.db.rpc("start_shift", { p_driver: rider });
    const lead = await r.staff("ops_lead", "Hala");
    const b = r.browser();
    await b.signIn(lead);

    // A prepaid order: the rider holds no cash, so the hub would pay the fee, and the drawer is empty.
    const pre = await placeOrder(r.db, village, "whish");
    await r.db.rpc("confirm_payment", { p_order: pre.id, p_by: lead.partyId, p_external_ref: "WH-F1-PRE", p_amount_usd: pre.total });
    await deliver(r.db, pre.id, rider);
    expect(await drawerUsd(r.db)).toBe(0);
    await b.get("/riders");
    let res = await b.post(`/riders/${rider}/pay`);
    expect(flashOf(res.text)).toBe("Not paid: the rider's cash does not cover their earnings and the drawer does not hold the rest by the books. Confirm a cash drop first, then pay.");

    // A cash order, 60 cents short at the door: owed by the rider, and shown on the page.
    const cod = await placeOrder(r.db, village, "cod");
    await deliver(r.db, cod.id, rider);
    await r.db.rpc("rider_collect", { p_order: cod.id, p_driver: rider, p_usd: Number((cod.total - 0.6).toFixed(2)), p_lbp: 0 });
    let page = (await b.get("/riders")).text;
    expect(page).toContain("short $0.60 · <strong>owes $0.60</strong>");

    // The cash comes in; now the earnings are paid, and a damaged note in the drop is recorded once.
    await dropAtHub(r.db, rider, lead.partyId);
    res = await b.post(`/riders/${rider}/pay`);
    expect(flashOf(res.text)).toMatch(/^Paid\./);
    page = (await b.get("/riders")).text;
    expect(page).toContain("Record damaged note");
    const drop = (await r.db.one(`select id from cash_drops where driver_id = $1 and status = 'confirmed'`, [rider])).id;
    const key = "damaged-note-form-1";                      // the form's key: the same form sent twice is one note
    const before = await drawerUsd(r.db);
    res = await b.post(`/riders/drop/${drop}/damaged`, { amount_usd: "1", _key: key! });
    expect(flashOf(res.text)).toBe("Damaged note of $1.00 taken out of the drawer, absorbed by the company (the first this month).");
    res = await b.post(`/riders/drop/${drop}/damaged`, { amount_usd: "1", _key: key! });
    expect(flashOf(res.text)).toBe("That damaged note was already recorded; nothing changed.");
    expect(await drawerUsd(r.db)).toBeCloseTo(before - 1, 2);
    res = await b.post(`/riders/drop/${drop}/damaged`, { amount_usd: "999" });
    expect(flashOf(res.text)).toBe("That is more than this drop (with the damaged notes already recorded on it).");
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
  });
});
