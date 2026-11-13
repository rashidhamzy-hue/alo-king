// 3.3 Payments to confirm: the ops lead types the amount and reference; only review_payment_proof()/confirm_payment() move money.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, ledgerSum, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { r = await rig(); village = await openShop(r.db); }, 120_000);

async function withProof(method: "whish" | "omt" = "whish") {
  const o = await placeOrder(r.db, village, method);
  const p = await r.db.rpc("submit_payment_proof", { p_party: o.customer, p_wamid: `wamid.proof.${o.id}`, p_media_path: `payment_proofs/${o.id}.jpg`, p_sha256: `sha-${o.id}` });
  return { ...o, proof: p.proof_id as string };
}
const status = async (orderId: string) => (await r.db.one(`select status from payments where order_id = $1 order by created_at desc limit 1`, [orderId]))?.status;

describe("Payments to confirm", () => {
  it("shows the screenshot as a short signed link with the expected amount; confirming with the typed amount and reference books it", async () => {
    const o = await withProof();
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    const page = (await b.get("/payments")).text;
    expect(page).toContain(o.code);
    expect(page).toContain(`https://media.test/payment_proofs/${o.id}.jpg?token=t&amp;expires=300`);
    expect(page).toContain(`expected <strong>$${o.total.toFixed(2)}</strong>`);

    const under = await b.post(`/payments/proof/${o.proof}`, { decision: "confirm", amount_usd: (o.total - 1).toFixed(2), reference: "WH-881100" });
    expect(flashOf(under.text)).toBe("The amount is less than the order total. Not confirmed.");
    expect(await status(o.id)).toBe("proof_submitted");

    const noRef = await b.post(`/payments/proof/${o.proof}`, { decision: "confirm", amount_usd: o.total.toFixed(2), reference: "" });
    expect(flashOf(noRef.text)).toContain("transfer reference");

    const ok = await b.post(`/payments/proof/${o.proof}`, { decision: "confirm", amount_usd: o.total.toFixed(2), reference: "WH-881100" });
    expect(flashOf(ok.text)).toBe("Payment confirmed and booked.");
    expect(ok.text).not.toContain(o.code);
    const pay = await r.db.one(`select status, confirmed_by, external_ref from payments where order_id = $1 and status = 'confirmed'`, [o.id]);
    expect(pay).toMatchObject({ confirmed_by: lead.partyId, external_ref: "WH-881100" });
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
    const log = r.media.audit().filter((a) => a.action === "payment_proof_confirm");
    expect(log.filter((a) => a.phase === "done").map((a) => a.ok).sort()).toEqual([false, false, true]);
    expect(log.filter((a) => a.phase === "intent").every((a) => a.party_id === lead.partyId)).toBe(true);

    const again = await b.post(`/payments/proof/${o.proof}`, { decision: "confirm", amount_usd: o.total.toFixed(2), reference: "WH-881100" });
    expect(flashOf(again.text)).toBe("Already confirmed; nothing changed.");
  });

  it("rejecting a screenshot leaves the order owing and posts nothing", async () => {
    const o = await withProof("omt");
    const lead = await r.staff("admin");
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/payments");
    const before = await r.db.one(`select count(*)::int as n from ledger_entries`);
    const res = await b.post(`/payments/proof/${o.proof}`, { decision: "reject", note: "amount does not match the account" });
    expect(flashOf(res.text)).toContain("Screenshot rejected");
    expect(await status(o.id)).toBe("pending");
    expect((await r.db.one(`select count(*)::int as n from ledger_entries`)).n).toBe(before.n);
    expect(res.text).toContain("Transfers without a screenshot (");
    expect(res.text).toContain(o.code);
  });

  it("a transfer with no screenshot can be confirmed from the account; a reused reference is refused", async () => {
    const a = await placeOrder(r.db, village, "whish");
    const c2 = await placeOrder(r.db, village, "whish");
    const lead = await r.staff("ops_lead");
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/payments");
    expect(flashOf((await b.post(`/payments/order/${a.id}`, { amount_usd: a.total.toFixed(2), reference: "WH-555001" })).text)).toBe("Payment confirmed and booked.");
    expect(flashOf((await b.post(`/payments/order/${c2.id}`, { amount_usd: c2.total.toFixed(2), reference: "WH-555001" })).text)).toContain("already used");
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
  });

  it("is closed to pickers, by the page and by the database", async () => {
    const o = await withProof();
    const picker = await r.staff("picker");
    const b = r.browser();
    await b.signIn(picker);
    expect((await b.get("/payments")).status).toBe(403);
    await b.get("/");
    expect((await b.post(`/payments/proof/${o.proof}`, { decision: "confirm", amount_usd: o.total, reference: "WH-1" }, { follow: false })).status).toBe(403);
    await expect(r.db.rpc("review_payment_proof", { p_proof: o.proof, p_by: picker.partyId, p_accept: true, p_external_ref: "WH-12345", p_amount_usd: o.total })).rejects.toThrow(/NOT_AUTHORISED/);
  });
});
