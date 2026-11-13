// 3.16 Complaint cases: one record per complaint; an allergen complaint goes to the top and holds the product until a person clears it.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deliver, flashOf, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string; let rider: string;
afterAll(() => vi.unstubAllGlobals());
beforeAll(async () => {
  r = await rig(); village = await openShop(r.db);
  rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
  await r.db.rpc("start_shift", { p_driver: rider });
}, 120_000);

async function closedOrder() {
  const o = await placeOrder(r.db, village, "cod", 10);
  await deliver(r.db, o.id, rider);
  await r.db.rpc("rider_collect", { p_order: o.id, p_driver: rider, p_usd: o.total, p_lbp: 0 });
  return o;
}
const onSale = async (p: string) => (await r.db.one(`select p.is_active, o.is_available from products p join offers o on o.product_id = p.id where p.id = $1`, [p]));

describe("Complaint cases", () => {
  it("a late complaint is noted, linked to its refund and closed; an allergen complaint jumps the queue and holds the item until cleared", async () => {
    const late = await closedOrder();
    const allergy = await closedOrder();
    const lead = await r.staff("ops_lead", "Maya");
    const admin = await r.staff("admin", "Rasheed");
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/cases");
    let res = await b.post("/cases", { step: "find", order: late.code });
    expect(res.text).toContain(`<strong>${late.code}</strong>`);
    res = await b.post(`/cases/open/${late.id}`, { kind: "late", detail: "arrived after an hour" });
    expect(flashOf(res.text)).toBe("Case opened.");
    await b.get(`/cases?order=${allergy.code}`);
    expect(flashOf((await b.post(`/cases/open/${allergy.id}`, { kind: "allergen", detail: "reaction to sesame" })).text)).toBe("An allergen complaint needs the item it is about.");
    res = await b.post(`/cases/open/${allergy.id}`, { kind: "allergen", product: allergy.product, detail: "child reacted, label says no sesame" });
    expect(flashOf(res.text)).toMatch(/^Case opened at the top of the queue\. The item is on hold/);
    expect(await onSale(allergy.product)).toEqual({ is_active: false, is_available: false });
    expect(res.text.indexOf("ALLERGEN")).toBeLessThan(res.text.indexOf("LATE"));          // the allergen case is listed first
    expect((await r.db.one(`select count(*) as n from ops_exceptions where kind = 'allergen_complaint' and status = 'open'`)).n).toBe(1);

    const k = (await r.db.one(`select id from complaint_cases where kind = 'late'`)).id;
    const refund = await r.db.rpc("refund_order", { p_order: late.id, p_by: lead.partyId, p_amount_usd: 1, p_charged_to: "goodwill", p_reason: "late" });
    await b.get("/cases");
    res = await b.post(`/cases/${k}/note`, { note: "called the customer, sorry and a dollar off", owner: admin.partyId, refund: refund.refund_id });
    expect(flashOf(res.text)).toBe("Added to the case.");
    expect(res.text).toContain("(refund $1.00)");
    const other = (await r.db.one(`select id from refunds where order_id <> $1 limit 1`, [late.id]))?.id;
    if (other) await expect(r.db.rpc("note_complaint", { p_case: k, p_by: lead.partyId, p_note: "wrong one", p_refund: other })).rejects.toThrow(/REFUND_NOT_ON_ORDER/);
    expect(flashOf((await b.post(`/cases/${k}/close`, { outcome: "customer satisfied" })).text)).toBe("Case closed.");
    expect(await r.db.one(`select status, closed_by, owner_id, refund_ids from complaint_cases where id = $1`, [k]))
      .toEqual({ status: "closed", closed_by: lead.partyId, owner_id: admin.partyId, refund_ids: [refund.refund_id] });

    // Closing the allergen case without clearing leaves the item off sale; clearing is a second, explicit decision.
    const a = (await r.db.one(`select id from complaint_cases where kind = 'allergen'`)).id;
    await b.get("/cases");
    res = await b.post(`/cases/${a}/close`, { outcome: "supplier asked for the spec sheet", release: "1" });
    expect(flashOf(res.text)).toBe("Case closed; the item is back on sale.");
    expect(await onSale(allergy.product)).toEqual({ is_active: true, is_available: true });
    expect((await r.db.one(`select count(*) as n from ops_exceptions where kind = 'allergen_complaint' and status = 'open'`)).n).toBe(0);
    expect((await r.db.one(`select release_note from product_holds where product_id = $1`, [allergy.product])).release_note).toBe("Case closed: supplier asked for the spec sheet");

    const picker = await r.staff("picker");
    const p = r.browser();
    await p.signIn(picker);
    expect((await p.get("/cases")).status).toBe(403);
    await expect(r.db.rpc("open_complaint", { p_order: late.id, p_kind: "late", p_detail: "again", p_by: picker.partyId })).rejects.toThrow(/NOT_AUTHORISED/);
  });

  it("an allergen case closed without clearing keeps the item on hold", async () => {
    const o = await closedOrder();
    const lead = await r.staff("ops_lead");
    const c = await r.db.rpc("open_complaint", { p_order: o.id, p_kind: "allergen", p_detail: "milk reaction", p_by: lead.partyId, p_product: o.product });
    const out = await r.db.rpc("close_complaint", { p_case: c.case_id, p_by: lead.partyId, p_outcome: "waiting for the lab" });
    expect(out).toMatchObject({ hold_released: false, still_held: true });
    expect(await r.db.rpc("product_on_hold", { p_product: o.product })).toBe(true);
    await r.db.rpc("release_hold", { p_product: o.product, p_by: lead.partyId, p_note: "lab clear" });
  });
});
