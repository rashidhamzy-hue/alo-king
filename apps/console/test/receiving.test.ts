// 3.12 Receiving: goods in through receive_goods(), with cost and expiry; suppliers added and paid by the ops lead.
// WH1a changed this on purpose: goods come in only by receiving a purchase order (/purchase-orders/:po/receive, receive_purchase_order),
// so each receipt below is a purchase order written by the lead and received; the money and drawer checks are the same as before.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deliver, drawerUsd, dropAtHub, flashOf, ledgerSum, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { r = await rig(); village = await openShop(r.db); }, 120_000);

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
    // the lead writes the orders; an unknown code is refused when the order is written
    const day = (n: number) => new Date(Date.now() + n * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Beirut" });
    await bl.get("/purchase-orders");
    expect(flashOf((await bl.post("/purchase-orders", { supplier, expected_date: day(1), code_0: "NO-SUCH-SKU", qty_0: 24 })).text)).toBe("No item with SKU or barcode NO-SUCH-SKU.");
    const writePo = async (q: number) => {
      await bl.post("/purchase-orders", { supplier, expected_date: day(1), code_0: p.sku, qty_0: q, cost_0: "0.50" });
      const po = (await r.db.one(`select id from purchase_orders order by created_at desc limit 1`)).id as string;
      const line = (await r.db.one(`select id from purchase_order_lines where po_id = $1`, [po])).id as string;
      return { po, line };
    };
    const a = await writePo(24);
    await b.get(`/purchase-orders/${a.po}`);
    const line = { supplier_ref: "INV-901", paid_from: "credit", [`counted_${a.line}`]: 24, [`lot_${a.line}`]: "L77" };
    expect(flashOf((await b.post(`/purchase-orders/${a.po}/receive`, line)).text)).toBe("Chilled, frozen and fresh goods need their expiry date: Leen Taanayel Labneh Premium.");
    expect(flashOf((await b.post(`/purchase-orders/${a.po}/receive`, { ...line, paid_from: "hub_cash", [`expiry_${a.line}`]: "2026-12-01" })).text)).toBe("Only the ops lead pays from the drawer. Receive it on credit.");
    let res = await b.post(`/purchase-orders/${a.po}/receive`, { ...line, [`expiry_${a.line}`]: day(14) });
    const margin = Math.round((Number(p.price_usd) - 0.5) / Number(p.price_usd) * 1000) / 10;
    expect(flashOf(res.text)).toMatch(/^Received PO-0001: 24 unit\(s\) on the shelf, \$12\.00 at cost\./);
    expect(flashOf(res.text)).toContain(`Margin at today's price: Leen Taanayel Labneh Premium ${margin}%.`);
    res = await b.post(`/purchase-orders/${a.po}/receive`, { ...line, [`expiry_${a.line}`]: day(14) });
    expect(flashOf(res.text)).toBe("PO-0001 was already received; nothing changed.");
    expect(await r.db.one(`select qty, expiry_date::text as e, lot from goods_receipt_lines`)).toEqual({ qty: "24.000", e: day(14), lot: "L77" });
    expect((await r.db.one(`select received_by from goods_receipts`)).received_by).toBe(picker.partyId);

    // Without an invoice number, the order's number is the receipt's: a second order is a second receipt.
    const a2 = await writePo(6);
    await b.get(`/purchase-orders/${a2.po}`);
    res = await b.post(`/purchase-orders/${a2.po}/receive`, { paid_from: "credit", [`counted_${a2.line}`]: 6, [`expiry_${a2.line}`]: day(15) });
    expect(flashOf(res.text)).toMatch(/^Received PO-0002/);
    expect(Number((await r.db.one(`select count(*) as n from goods_receipts`)).n)).toBe(2);
    expect((await b.get("/receiving")).text).toContain("Leen Dairy");

    await bl.get("/receiving");
    expect(flashOf((await bl.post(`/suppliers/${supplier}/pay`, { amount_usd: "10", ref: "R" })).text)).toBe("Type the receipt number.");
    // Nothing leaves the drawer beyond what it holds by the books (0081): it is empty, so the payment and a receipt paid from the
    // till are refused and nothing is recorded.
    const SHORT = "The drawer does not hold that much by the books. Count it, and check what came in today.";
    expect(await drawerUsd(r.db)).toBe(0);
    expect(flashOf((await bl.post(`/suppliers/${supplier}/pay`, { amount_usd: "10", ref: "R-100" })).text)).toBe(SHORT);
    const t = await writePo(2);
    await bl.get(`/purchase-orders/${t.po}`);
    const tillLine = { supplier_ref: "INV-902", paid_from: "hub_cash", [`counted_${t.line}`]: 2, [`expiry_${t.line}`]: day(14) };
    expect(flashOf((await bl.post(`/purchase-orders/${t.po}/receive`, tillLine)).text)).toBe(SHORT);
    expect(Number((await r.db.one(`select count(*) as n from goods_receipts`)).n)).toBe(2);
    expect(await drawerUsd(r.db)).toBe(0);
    // A rider's cash, dropped at the hub, fills it.
    const rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
    await r.db.rpc("start_shift", { p_driver: rider });
    const o = await placeOrder(r.db, village, "cod", 15);
    await deliver(r.db, o.id, rider);
    await r.db.rpc("rider_collect", { p_order: o.id, p_driver: rider, p_usd: o.total, p_lbp: 0 });
    const filled = await dropAtHub(r.db, rider, lead.partyId);
    expect(filled).toBeGreaterThan(11);
    expect(flashOf((await bl.post(`/suppliers/${supplier}/pay`, { amount_usd: "10", ref: "R-100" })).text)).toBe("Paid $10.00 from the drawer. We now owe $5.00.");
    expect(flashOf((await bl.post(`/purchase-orders/${t.po}/receive`, tillLine)).text)).toMatch(/^Received PO-0003: 2 unit\(s\) on the shelf, \$1\.00 at cost\./);
    expect(await drawerUsd(r.db)).toBeCloseTo(filled - 11, 2);
    // More than is left is refused; exactly what is left empties it; the same receipt number again is still answered as a repeat.
    expect(flashOf((await bl.post(`/suppliers/${supplier}/pay`, { amount_usd: (filled - 10).toFixed(2), ref: "R-101" })).text)).toBe(SHORT);
    expect(flashOf((await bl.post(`/suppliers/${supplier}/pay`, { amount_usd: (filled - 11).toFixed(2), ref: "R-102" })).text)).toMatch(/^Paid \$/);
    expect(await drawerUsd(r.db)).toBeCloseTo(0, 2);
    expect(flashOf((await bl.post(`/suppliers/${supplier}/pay`, { amount_usd: "10", ref: "R-100" })).text)).toBe("That payment was already recorded.");
    expect((await b.post(`/suppliers/${supplier}/pay`, { amount_usd: "1", ref: "R-101" }, { follow: false })).status).toBe(403);
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
  });
});
