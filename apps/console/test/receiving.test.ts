// 3.12 Receiving: goods in through receive_goods(), with cost and expiry; suppliers added and paid by the ops lead.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, ledgerSum, openShop, rig, type Rig } from "./kit";

let r: Rig;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { r = await rig(); await openShop(r.db); }, 120_000);

describe("Receiving", () => {
  it("a picker receives on credit by SKU, once per invoice; expiry is required for chilled goods; only the lead pays from the drawer", async () => {
    const p = await r.db.one(`select p.id, p.sku, p.storage, o.price_usd from products p join offers o on o.product_id = p.id where p.name_en = 'Leen Taanayel Labneh Premium'`);
    expect(p.storage).toBe("chilled");
    const lead = await r.staff("ops_lead", "Maya");
    const picker = await r.staff("picker", "Pia");
    const bl = r.browser();
    await bl.signIn(lead);
    expect((await bl.get("/receiving")).text).toContain("No supplier yet");
    expect(flashOf((await bl.post("/suppliers", { name: "Leen Dairy", phone: "+9618000000", terms: "30 days" })).text)).toBe("Supplier Leen Dairy saved.");
    const supplier = (await r.db.one(`select id from suppliers where name = 'Leen Dairy'`)).id;

    const b = r.browser();
    await b.signIn(picker);
    expect((await b.get("/receiving")).text).not.toContain("Add a supplier");
    const line = { supplier, supplier_ref: "INV-901", paid_from: "credit", code_0: p.sku, qty_0: 24, cost_0: "0.50" };
    expect(flashOf((await b.post("/receiving", line)).text)).toBe("Chilled, frozen and fresh goods need their expiry date.");
    expect(flashOf((await b.post("/receiving", { ...line, paid_from: "hub_cash", expiry_0: "2026-12-01" })).text)).toBe("Only the ops lead pays from the drawer. Receive it on credit.");
    expect(flashOf((await b.post("/receiving", { ...line, code_0: "NO-SUCH-SKU", expiry_0: "2026-12-01" })).text)).toBe("No item with SKU or barcode NO-SUCH-SKU.");
    const margin = Math.round((Number(p.price_usd) - 0.5) / Number(p.price_usd) * 1000) / 10;
    let res = await b.post("/receiving", { ...line, expiry_0: "2026-12-01", lot_0: "L77" });
    expect(flashOf(res.text)).toBe(`Received 1 line, $12.00 at cost. Margin at today's price: Leen Taanayel Labneh Premium ${margin}%.`);
    res = await b.post("/receiving", { ...line, expiry_0: "2026-12-01", lot_0: "L77" });
    expect(flashOf(res.text)).toBe("Already received under that number ($12.00); nothing changed.");
    expect(await r.db.one(`select qty, expiry_date::text as e, lot from goods_receipt_lines`)).toEqual({ qty: "24.000", e: "2026-12-01", lot: "L77" });
    expect((await r.db.one(`select received_by from goods_receipts`)).received_by).toBe(picker.partyId);

    // Without an invoice number, the form's key stands in: a double tap is still one receipt.
    const key = "receive-form-key-1";
    await b.post("/receiving", { supplier, paid_from: "credit", code_0: p.sku, qty_0: 6, cost_0: "0.50", expiry_0: "2026-12-02", _key: key });
    res = await b.post("/receiving", { supplier, paid_from: "credit", code_0: p.sku, qty_0: 6, cost_0: "0.50", expiry_0: "2026-12-02", _key: key });
    expect(flashOf(res.text)).toMatch(/^Already received/);
    expect(Number((await r.db.one(`select count(*) as n from goods_receipts`)).n)).toBe(2);
    expect(res.text).toContain("Leen Dairy");

    await bl.get("/receiving");
    expect(flashOf((await bl.post(`/suppliers/${supplier}/pay`, { amount_usd: "10", ref: "R" })).text)).toBe("Type the receipt number.");
    expect(flashOf((await bl.post(`/suppliers/${supplier}/pay`, { amount_usd: "10", ref: "R-100" })).text)).toBe("Paid $10.00 from the drawer. We now owe $5.00.");
    expect((await b.post(`/suppliers/${supplier}/pay`, { amount_usd: "1", ref: "R-101" }, { follow: false })).status).toBe(403);
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
  });
});
