// WH1a, warehouse basics (docs/strategy/02-journeys.md, section 4): simple purchase orders, receiving against one, lots and
// first-to-expire, bins in the walking order, and the chilled zone's temperature log by photo. Migrations 0236 to 0240.
// Written before the migrations: each block failed on main (no table, no function).
import { beforeAll, describe, expect, it } from "vitest";
import { openHub, placeOrder, type Hub } from "./hub-kit";

let h: Hub; let supplier: string; let labneh: string; let coffee: string; let water: string; let admin: string;
const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const lots = async (p: string) => (await h.db.all(`select lot, expiry_date::text as e, qty_left::float as q from stock_lots
  where source_id = $1 and product_id = $2 order by received_at, lot`, [h.hub, p])) as { lot: string | null; e: string | null; q: number }[];
const onHand = async (p: string) => Number((await h.db.one(`select on_hand from stock_levels where source_id = $1 and product_id = $2`, [h.hub, p])).on_hand);
const po = (lines: unknown[], extra: Record<string, unknown> = {}) =>
  h.db.rpc("create_purchase_order", { p_supplier: supplier, p_source: h.hub, p_expected: day(1), p_lines: lines, p_by: h.ops, ...extra });
const lineIds = async (poId: string) => (await h.db.all(`select l.id, p.name_en from purchase_order_lines l join products p on p.id = l.product_id
  where l.po_id = $1 order by l.position`, [poId])) as { id: string; name_en: string }[];

beforeAll(async () => {
  h = await openHub();
  admin = (await h.db.one(`insert into parties(role, display_name) values ('admin', 'Founder') returning id`)).id;
  supplier = await h.db.rpc("create_supplier", { p_name: "Leen Dairy", p_by: h.ops, p_phone: "+9618000000", p_terms: "30 days" });
  labneh = await h.product("Leen Taanayel Labneh Premium");
  coffee = await h.product("Najjar Cafe Classic Normal 180G");
  water = await h.product("Tannourine Mineral Water 2L X6");
  // The labneh starts empty, so its lots are the whole shelf; the coffee keeps the kit's 50 on the shelf from before lots began.
  await h.db.pg.query(`update stock_levels set on_hand = 0, reserved = 0 where product_id = $1`, [labneh]);
}, 120_000);

describe("purchase orders (0236)", () => {
  it("an ops lead or admin writes one: supplier, items, quantities, an expected date; a picker cannot", async () => {
    await expect(po([{ product_id: labneh, qty: 24 }], { p_by: h.picker })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(po([])).rejects.toThrow(/NO_LINES/);
    await expect(po([{ product_id: labneh, qty: 0 }])).rejects.toThrow(/BAD_QTY/);
    await expect(po([{ product_id: labneh, qty: 2 }, { product_id: labneh, qty: 3 }])).rejects.toThrow(/DUPLICATE_ITEM/);
    await expect(po([{ product_id: labneh, qty: 2 }], { p_expected: null })).rejects.toThrow(/EXPECTED_DATE_REQUIRED/);
    await expect(po([{ product_id: labneh, qty: 2 }], { p_expected: day(-2) })).rejects.toThrow(/EXPECTED_DATE_PAST/);
    const a = await po([{ product_id: labneh, qty: 24, unit_cost_usd: 0.5 }, { product_id: coffee, qty: 12 }], { p_key: "po-key-1", p_note: "morning van" });
    expect(a).toMatchObject({ ok: true, duplicate: false, number: "PO-0001" });
    // the same form sent twice is one purchase order
    expect(await po([{ product_id: labneh, qty: 24 }], { p_key: "po-key-1" })).toMatchObject({ duplicate: true, po_id: a.po_id });
    const b = await po([{ product_id: water, qty: 10 }], { p_by: admin });
    expect(b.number).toBe("PO-0002");
    expect(await h.db.one(`select status, expected_date::text as e from purchase_orders where id = $1`, [a.po_id])).toEqual({ status: "open", e: day(1) });
  });

  it("prints in Arabic and English from one document: names in both, quantities, units, the supplier and the dates", async () => {
    const id = (await h.db.one(`select id from purchase_orders where number = 'PO-0001'`)).id;
    const doc = await h.db.rpc("purchase_order_doc", { p_po: id });
    expect(doc).toMatchObject({ number: "PO-0001", status: "open", expected_date: day(1), note: "morning van", supplier: { name: "Leen Dairy", phone: "+9618000000", terms: "30 days" } });
    expect(doc.lines.map((l: { n: number; name_en: string; qty: number }) => [l.n, l.name_en, Number(l.qty)])).toEqual([[1, "Leen Taanayel Labneh Premium", 24], [2, "Najjar Cafe Classic Normal 180G", 12]]);
    expect(doc.lines[0].name_ar).toBeTruthy();
    expect(doc.lines[0].unit).toBeTruthy();
    expect(doc.created_by).toBe("Hussein");
  });

  it("an open one can be cancelled with a reason; a cancelled one cannot be received", async () => {
    const c = await po([{ product_id: water, qty: 5 }]);
    await expect(h.db.rpc("cancel_purchase_order", { p_po: c.po_id, p_by: h.ops, p_reason: "" })).rejects.toThrow(/REASON_REQUIRED/);
    await expect(h.db.rpc("cancel_purchase_order", { p_po: c.po_id, p_by: h.picker, p_reason: "not needed" })).rejects.toThrow(/NOT_AUTHORISED/);
    await h.db.rpc("cancel_purchase_order", { p_po: c.po_id, p_by: h.ops, p_reason: "not needed" });
    const [l] = await lineIds(c.po_id);
    await expect(h.db.rpc("receive_purchase_order", { p_po: c.po_id, p_lines: [{ line_id: l!.id, counted: 5, unit_cost_usd: 1 }], p_by: h.picker })).rejects.toThrow(/PO_CANCELLED/);
  });
});

describe("receiving against a purchase order (0237)", () => {
  it("counts each line, with lot and expiry; short and damaged are noted; only the good units enter stock, as lots", async () => {
    const id = (await h.db.one(`select id from purchase_orders where number = 'PO-0001'`)).id;
    const [lab, cof] = await lineIds(id);
    const before = await onHand(coffee);
    // every line must be counted; a chilled item needs its expiry; goods already expired are not received
    await expect(h.db.rpc("receive_purchase_order", { p_po: id, p_lines: [{ line_id: lab!.id, counted: 20, lot: "L1", expiry_date: day(10) }], p_by: h.picker })).rejects.toThrow(/LINE_NOT_COUNTED/);
    await expect(h.db.rpc("receive_purchase_order", { p_po: id, p_by: h.picker, p_lines: [{ line_id: lab!.id, counted: 20, lot: "L1" }, { line_id: cof!.id, counted: 12, unit_cost_usd: 1.2 }] })).rejects.toThrow(/EXPIRY_REQUIRED/);
    await expect(h.db.rpc("receive_purchase_order", { p_po: id, p_by: h.picker, p_lines: [{ line_id: lab!.id, counted: 20, lot: "L1", expiry_date: day(-1) }, { line_id: cof!.id, counted: 12, unit_cost_usd: 1.2 }] })).rejects.toThrow(/EXPIRED_ON_ARRIVAL/);
    await expect(h.db.rpc("receive_purchase_order", { p_po: id, p_by: h.picker, p_lines: [{ line_id: lab!.id, counted: 20, damaged: 21, lot: "L1", expiry_date: day(10) }, { line_id: cof!.id, counted: 12, unit_cost_usd: 1.2 }] })).rejects.toThrow(/BAD_DAMAGED/);
    // the coffee had no cost on the order: one is needed when it is received
    await expect(h.db.rpc("receive_purchase_order", { p_po: id, p_by: h.picker, p_lines: [{ line_id: lab!.id, counted: 20, lot: "L1", expiry_date: day(10) }, { line_id: cof!.id, counted: 12 }] })).rejects.toThrow(/COST_REQUIRED/);

    const r = await h.db.rpc("receive_purchase_order", { p_po: id, p_by: h.picker, p_supplier_ref: "INV-77", p_lines: [
      { line_id: lab!.id, counted: 20, damaged: 2, lot: "L1", expiry_date: day(10), note: "two lids split" },
      { line_id: cof!.id, counted: 12, unit_cost_usd: 1.2 }] });
    expect(r).toMatchObject({ ok: true, duplicate: false });
    // 24 ordered, 20 came, 2 damaged: 18 on the shelf, 4 short, 2 damaged
    expect(r.short).toEqual([expect.objectContaining({ product_id: labneh, ordered: 24, counted: 20, short: 4 })]);
    expect(r.damaged).toEqual([expect.objectContaining({ product_id: labneh, damaged: 2, note: "two lids split" })]);
    expect(Number(r.total_usd)).toBeCloseTo(18 * 0.5 + 12 * 1.2, 2);
    expect(await onHand(labneh)).toBe(18);
    expect(await onHand(coffee)).toBe(before + 12);
    expect(await lots(labneh)).toEqual([{ lot: "L1", e: day(10), q: 18 }]);
    expect(await lots(coffee)).toEqual([{ lot: null, e: null, q: 12 }]);
    expect(await h.db.one(`select status, received_by, receipt_id is not null as has from purchase_orders where id = $1`, [id])).toEqual({ status: "received", received_by: h.picker, has: true });
    expect(await h.db.one(`select ordered::float, counted::float, damaged::float, received::float, short::float from receiving_lines where po_line_id = $1`, [lab!.id]))
      .toEqual({ ordered: 24, counted: 20, damaged: 2, received: 18, short: 4 });
    // received twice (a double tap) is the first receipt, nothing more on the shelf
    const again = await h.db.rpc("receive_purchase_order", { p_po: id, p_by: h.picker, p_lines: [{ line_id: lab!.id, counted: 20, lot: "L1", expiry_date: day(10) }, { line_id: cof!.id, counted: 12, unit_cost_usd: 1.2 }] });
    expect(again).toMatchObject({ duplicate: true, receipt_id: r.receipt_id });
    expect(await onHand(labneh)).toBe(18);
  });

  it("names the received items that are not label-ready, and puts them first on LB1's capture list", async () => {
    const id = (await h.db.one(`select id from purchase_orders where number = 'PO-0001'`)).id;
    const doc = await h.db.rpc("purchase_order_doc", { p_po: id });
    const capture = doc.label_capture as { product_id: string; photographed: boolean }[];
    expect(capture.map((c) => c.product_id).sort()).toEqual([labneh, coffee].sort());
    expect(capture.every((c) => c.photographed === false)).toBe(true);
    // the next item on the label day is one of this delivery's, whatever the shelf order says
    const next = await h.db.rpc("label_capture_next", { p_after: null });
    expect([labneh, coffee]).toContain(next.product_id);
    const list = (await h.db.rpc("label_capture_items", { p_only_missing: true })) as { product_id: string }[];
    expect(list.slice(0, 2).map((x) => x.product_id).sort()).toEqual([labneh, coffee].sort());
  });

  it("a picker cannot pay from the drawer (receive_goods's rule holds); a supplier's invoice number used before is refused", async () => {
    const p = await po([{ product_id: water, qty: 6, unit_cost_usd: 2 }]);
    const [l] = await lineIds(p.po_id);
    await expect(h.db.rpc("receive_purchase_order", { p_po: p.po_id, p_by: h.picker, p_paid_from: "hub_cash", p_lines: [{ line_id: l!.id, counted: 6 }] })).rejects.toThrow(/NEEDS_OPS_LEAD/);
    await expect(h.db.rpc("receive_purchase_order", { p_po: p.po_id, p_by: h.picker, p_supplier_ref: "INV-77", p_lines: [{ line_id: l!.id, counted: 6 }] })).rejects.toThrow(/SUPPLIER_REF_USED/);
    // nothing came at all: the order is closed as received, all short, nothing on the shelf
    const before = await onHand(water);
    const r = await h.db.rpc("receive_purchase_order", { p_po: p.po_id, p_by: h.picker, p_lines: [{ line_id: l!.id, counted: 0 }] });
    expect(r).toMatchObject({ ok: true, receipt_id: null, total_usd: 0 });
    expect(r.short).toEqual([expect.objectContaining({ short: 6 })]);
    expect(await onHand(water)).toBe(before);
  });
});

describe("lots and first-to-expire (0239)", () => {
  const receive = async (product: string, qty: number, lot: string, expiry: string) => {
    const p = await po([{ product_id: product, qty, unit_cost_usd: 0.5 }]);
    const [l] = await lineIds(p.po_id);
    return h.db.rpc("receive_purchase_order", { p_po: p.po_id, p_by: h.picker, p_lines: [{ line_id: l!.id, counted: qty, lot, expiry_date: expiry }] });
  };

  it("the use-soon list works from the lots still on the shelf, an expired lot flagged", async () => {
    await receive(labneh, 6, "L0", day(2));      // nearer than L1
    const soon = (await h.db.rpc("expiring_stock", { p_source: h.hub, p_days: 3 })) as { product_id: string; lot: string; qty_left: number; expired: boolean }[];
    expect(soon.filter((s) => s.product_id === labneh).map((s) => [s.lot, Number(s.qty_left), s.expired])).toEqual([["L0", 6, false]]);
    expect(await lots(labneh)).toEqual([{ lot: "L1", e: day(10), q: 18 }, { lot: "L0", e: day(2), q: 6 }]);
  });

  it("the pick list names the earliest lot first and its bin; picking takes that lot", async () => {
    const o = await placeOrder(h, [{ product_id: labneh, qty: 8 }]);
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: h.picker });
    const list = await h.db.rpc("pick_list", { p_order: o.orderId });
    const line = list.lines[0];
    expect(line.take).toEqual([{ lot: "L0", expiry_date: day(2), qty: 6, no_lot: false }, { lot: "L1", expiry_date: day(10), qty: 2, no_lot: false }]);
    expect(line.expired_only).toBe(false);
    await h.db.rpc("pick_mark_line", { p_item: line.item_id, p_by: h.picker, p_picked: true });
    await h.db.rpc("finish_pick_packed", { p_order: o.orderId, p_by: h.picker, p_packing: { checked: ["cold_bag", "on_top", "bag_label"] } });
    expect(await lots(labneh)).toEqual([{ lot: "L1", e: day(10), q: 16 }, { lot: "L0", e: day(2), q: 0 }]);
  });

  it("stock from before lots (no lot) is taken first and the picker is told to check the date on the pack", async () => {
    await receive(coffee, 4, "C9", day(200));
    const o = await placeOrder(h, [{ product_id: coffee, qty: 2 }]);
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: h.picker });
    const line = (await h.db.rpc("pick_list", { p_order: o.orderId })).lines[0];
    expect(line.take).toEqual([{ lot: null, expiry_date: null, qty: 2, no_lot: true }]);
    expect(line.check_date).toBe(true);
    await h.db.rpc("pick_mark_line", { p_item: line.item_id, p_by: h.picker, p_picked: true });
    await h.db.rpc("finish_pick_packed", { p_order: o.orderId, p_by: h.picker, p_packing: { checked: ["bag_label"] } });
    expect((await lots(coffee)).find((l) => l.lot === "C9")!.q).toBe(4);
  });

  it("an expired lot is never named and cannot be picked: the line says so, and Picked is refused", async () => {
    // L1's date passes: only an expired lot is left for the labneh
    await h.db.pg.query(`update stock_lots set expiry_date = current_date - 1 where lot = 'L1'`);
    const o = await placeOrder(h, [{ product_id: labneh, qty: 1 }, { product_id: coffee, qty: 2 }]);
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: h.ops });            // the lead picks this one: the picker stays free
    const line = (await h.db.rpc("pick_list", { p_order: o.orderId })).lines.find((l: { product_id: string }) => l.product_id === labneh);
    expect(line.expired_only).toBe(true);
    expect(line.take).toEqual([]);
    await expect(h.db.rpc("pick_mark_line", { p_item: line.item_id, p_by: h.ops, p_picked: true })).rejects.toThrow(/LOT_EXPIRED/);
    // the way out: mark it missing, and write the lot off from the use-soon list
    await h.db.rpc("pick_item_missing", { p_item: line.item_id, p_by: h.ops, p_found: 0 });
    // (marking it missing wrote 1 off as not on the shelf: 15 are left in the lot)
    const soon = (await h.db.rpc("expiring_stock", { p_source: h.hub, p_days: 0 })) as { lot_id: string; lot: string; expired: boolean; qty_left: number }[];
    const l1 = soon.find((s) => s.lot === "L1")!;
    expect(l1.expired).toBe(true);
    expect(Number(l1.qty_left)).toBe(15);
    await expect(h.db.rpc("write_off_lot", { p_lot: l1.lot_id, p_qty: 16, p_reason: "expired", p_by: h.ops, p_note: null, p_key: "wo-0" })).rejects.toThrow(/BAD_QTY/);
    await expect(h.db.rpc("write_off_lot", { p_lot: l1.lot_id, p_qty: 15, p_reason: "expired", p_by: h.picker, p_note: null, p_key: "wo-1" })).rejects.toThrow(/NEEDS_OPS_LEAD/);
    const w = await h.db.rpc("write_off_lot", { p_lot: l1.lot_id, p_qty: 15, p_reason: "expired", p_by: h.ops, p_note: null, p_key: "wo-1" });
    expect(w.ok).toBe(true);
    expect((await lots(labneh)).find((l) => l.lot === "L1")!.q).toBe(0);
    expect(await h.db.one(`select reason::text, adjust_reason from stock_movements where request_key = 'wo-1'`)).toEqual({ reason: "waste", adjust_reason: "expired" });
  });

  it("a failed delivery that comes back goes back into the lot it was taken from", async () => {
    await receive(water, 10, "W1", day(300));
    await h.db.pg.query(`update stock_levels set on_hand = 10 where product_id = $1 and source_id = $2`, [water, h.hub]);   // only the lot: no stock from before
    const o = await placeOrder(h, [{ product_id: water, qty: 3 }]);
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: h.picker });
    const line = (await h.db.rpc("pick_list", { p_order: o.orderId })).lines[0];
    await h.db.rpc("pick_mark_line", { p_item: line.item_id, p_by: h.picker, p_picked: true });
    await h.db.rpc("finish_pick_packed", { p_order: o.orderId, p_by: h.picker, p_packing: { checked: ["bag_label"] } });
    expect((await lots(water)).find((l) => l.lot === "W1")!.q).toBe(7);
    // the returns path itself (0034): back on the shelf, ambient, all three
    await h.db.pg.query(`update orders set status = 'failed_delivery' where id = $1`, [o.orderId]);
    await h.db.rpc("receive_return", { p_order: o.orderId, p_by: h.ops, p_restock: { [water]: 3 } });
    expect((await lots(water)).find((l) => l.lot === "W1")!.q).toBe(10);
  });

  it("a count that finds less takes an expired lot first, then stock with no lot, then the earliest; a lot never goes below zero", async () => {
    const before = await lots(coffee);
    expect(before.find((l) => l.lot === "C9")!.q).toBe(4);
    const hand = await onHand(coffee);
    await h.db.rpc("count_stock", { p_source: h.hub, p_product: coffee, p_counted: hand - 1, p_by: h.ops, p_note: "one missing", p_key: "cnt-1" });
    // the 1 comes out of the stock with no lot (there is plenty): C9 is untouched
    expect((await lots(coffee)).find((l) => l.lot === "C9")!.q).toBe(4);
    expect((await h.db.all(`select qty_left from stock_lots where qty_left < 0`)).length).toBe(0);
  });
});

describe("bins and the walking order (0238)", () => {
  it("an ops lead makes bins by zone; an item's bin must be in its own zone; anyone who picks can move an item", async () => {
    await expect(h.db.rpc("create_bin", { p_source: h.hub, p_code: "A1", p_zone: "ambient", p_by: h.picker })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(h.db.rpc("create_bin", { p_source: h.hub, p_code: "a b!", p_zone: "ambient", p_by: h.ops })).rejects.toThrow(/BIN_CODE/);
    const a2 = await h.db.rpc("create_bin", { p_source: h.hub, p_code: "A2", p_zone: "ambient", p_by: h.ops });
    const a1 = await h.db.rpc("create_bin", { p_source: h.hub, p_code: "A1", p_zone: "ambient", p_by: h.ops, p_walk_order: 1 });
    const c1 = await h.db.rpc("create_bin", { p_source: h.hub, p_code: "C1", p_zone: "chilled", p_by: h.ops });
    await expect(h.db.rpc("create_bin", { p_source: h.hub, p_code: "a1", p_zone: "ambient", p_by: h.ops })).rejects.toThrow(/BIN_EXISTS/);
    await expect(h.db.rpc("set_product_bin", { p_source: h.hub, p_product: labneh, p_bin: a1.bin_id, p_by: h.picker })).rejects.toThrow(/BIN_ZONE/);
    await h.db.rpc("set_product_bin", { p_source: h.hub, p_product: labneh, p_bin: c1.bin_id, p_by: h.picker });
    await h.db.rpc("set_product_bin", { p_source: h.hub, p_product: coffee, p_bin: a2.bin_id, p_by: h.picker });
    await h.db.rpc("set_product_bin", { p_source: h.hub, p_product: water, p_bin: a1.bin_id, p_by: h.ops });
    const ov = await h.db.rpc("bins_overview", { p_source: h.hub });
    expect(ov.bins.map((b: { code: string }) => b.code)).toEqual(["A1", "A2", "C1"]);
    expect(ov.bins.find((b: { code: string }) => b.code === "C1").items.map((i: { product_id: string }) => i.product_id)).toEqual([labneh]);
    expect(Number((await h.db.one(`select count(*) as n from product_bin_log`)).n)).toBe(3);
  });

  it("the pick list walks ambient, fresh, chilled, frozen, and inside a zone by bin; each line names its bin", async () => {
    const bread = await h.product("Al Forno Pita White Bread Big 800G");
    await h.db.pg.query(`update products set storage = 'fresh' where id = $1`, [bread]);
    await h.db.pg.query(`update stock_lots set expiry_date = current_date + 5 where lot = 'L1'`);
    await h.db.pg.query(`update stock_lots set qty_left = 5 where lot = 'L1'`);
    await h.db.pg.query(`update stock_levels set on_hand = 5 where product_id = $1 and source_id = $2`, [labneh, h.hub]);
    const o = await placeOrder(h, [{ product_id: labneh, qty: 1 }, { product_id: coffee, qty: 1 }, { product_id: bread, qty: 1 }, { product_id: water, qty: 1 }]);
    const list = await h.db.rpc("pick_list", { p_order: o.orderId });
    const walked = list.lines as { product_id: string; bin: string | null; n: number }[];
    // ambient by bin (A1 water, A2 coffee), then fresh (no bin yet), then chilled
    expect(walked.map((l) => l.product_id)).toEqual([water, coffee, bread, labneh]);
    expect(walked.map((l) => l.bin)).toEqual(["A1", "A2", null, "C1"]);
    expect(walked.map((l) => l.n)).toEqual([1, 2, 3, 4]);
  });
});

describe("temperature log by photo (0240)", () => {
  it("a reading needs the photo and a number; out of range is an alert at once", async () => {
    const photo = `temperature/${h.hub}/2026-11-18/abc.jpg`;
    await expect(h.db.rpc("record_temperature", { p_source: h.hub, p_zone: "chilled", p_reading_c: 3, p_photo: null, p_by: h.picker })).rejects.toThrow(/PHOTO_REQUIRED/);
    await expect(h.db.rpc("record_temperature", { p_source: h.hub, p_zone: "chilled", p_reading_c: 3, p_photo: "labels/x.jpg", p_by: h.picker })).rejects.toThrow(/PHOTO_PATH/);
    await expect(h.db.rpc("record_temperature", { p_source: h.hub, p_zone: "frozen", p_reading_c: -18, p_photo: photo, p_by: h.picker })).rejects.toThrow(/UNKNOWN_ZONE/);
    await expect(h.db.rpc("record_temperature", { p_source: h.hub, p_zone: "chilled", p_reading_c: 300, p_photo: photo, p_by: h.picker })).rejects.toThrow(/BAD_READING/);
    const rider = h.riders[0]!;
    await expect(h.db.rpc("record_temperature", { p_source: h.hub, p_zone: "chilled", p_reading_c: 3, p_photo: photo, p_by: rider })).rejects.toThrow(/NOT_AUTHORISED/);
    const ok = await h.db.rpc("record_temperature", { p_source: h.hub, p_zone: "chilled", p_reading_c: 3.5, p_photo: photo, p_by: h.picker, p_key: "t-1" });
    expect(ok).toMatchObject({ ok: true, in_range: true });
    expect(await h.db.rpc("record_temperature", { p_source: h.hub, p_zone: "chilled", p_reading_c: 3.5, p_photo: photo, p_by: h.picker, p_key: "t-1" })).toMatchObject({ duplicate: true, reading_id: ok.reading_id });
    const hot = await h.db.rpc("record_temperature", { p_source: h.hub, p_zone: "chilled", p_reading_c: 9, p_photo: `temperature/${h.hub}/2026-11-18/def.jpg`, p_by: h.picker, p_note: "door left open" });
    expect(hot.in_range).toBe(false);
    expect(await h.db.one(`select kind, status, detail->>'reading_c' as c from ops_exceptions where ref = $1`, [hot.reading_id])).toEqual({ kind: "temperature_out_of_range", status: "open", c: "9.0" });
    const kinds = (await h.db.one(`select value->'high_priority_kinds' as k from settings where key = 'push_alerts'`)).k as string[];
    expect(kinds).toEqual(expect.arrayContaining(["temperature_out_of_range", "temperature_missed"]));
  });

  it("twice a day: a slot past its time with no reading raises one staff alert; a late reading closes it", async () => {
    const tz = "Asia/Beirut";
    await h.db.pg.exec(`delete from temperature_readings`);
    // a day where the morning reading was taken at 10:00 and the evening one was not
    const d = "2026-11-10";
    await h.db.pg.query(`insert into temperature_readings(source_id, zone, reading_c, in_range, photo_path, taken_by, taken_at, slot_day, slot)
      values ($1, 'chilled', 4, true, $2, $3, (timestamp '${d} 10:00' at time zone '${tz}'), '${d}', 'morning')`, [h.hub, `temperature/${h.hub}/${d}/a.jpg`, h.picker]);
    const early = await h.db.rpc("temperature_log_check", { p_now: new Date(`${d}T13:00:00+02:00`).toISOString() });
    expect(early.missed).toEqual([]);
    const late = await h.db.rpc("temperature_log_check", { p_now: new Date(`${d}T20:30:00+02:00`).toISOString() });
    expect(late.missed).toEqual([expect.objectContaining({ zone: "chilled", slot: "evening", day: d })]);
    expect(await h.db.rpc("temperature_log_check", { p_now: new Date(`${d}T20:45:00+02:00`).toISOString() })).toMatchObject({ missed: [expect.objectContaining({ slot: "evening" })] });
    expect(Number((await h.db.one(`select count(*) as n from ops_exceptions where kind = 'temperature_missed' and status = 'open'`)).n)).toBe(1);
    const day1 = await h.db.rpc("temperature_log_day", { p_source: h.hub, p_day: d });
    expect(day1.slots.map((s: { zone: string; slot: string; state: string }) => [s.zone, s.slot, s.state])).toEqual([["chilled", "morning", "done"], ["chilled", "evening", "missed"]]);
    // the reading is taken late, at 20:50: the next check closes the alert, and the day shows it as late
    await h.db.pg.query(`insert into temperature_readings(source_id, zone, reading_c, in_range, photo_path, taken_by, taken_at, slot_day, slot)
      values ($1, 'chilled', 4, true, $2, $3, (timestamp '${d} 20:50' at time zone '${tz}'), '${d}', 'evening')`, [h.hub, `temperature/${h.hub}/${d}/b.jpg`, h.picker]);
    expect((await h.db.rpc("temperature_log_check", { p_now: new Date(`${d}T20:52:00+02:00`).toISOString() })).missed).toEqual([]);
    expect(Number((await h.db.one(`select count(*) as n from ops_exceptions where kind = 'temperature_missed' and status = 'open'`)).n)).toBe(0);
    const day2 = await h.db.rpc("temperature_log_day", { p_source: h.hub, p_day: d });
    expect(day2.slots.map((s: { state: string }) => s.state)).toEqual(["done", "late"]);
  });

  it("before the first reading ever, nothing is alerted (the log has not started)", async () => {
    const h2 = await openHub();
    const r = await h2.db.rpc("temperature_log_check", { p_now: new Date("2026-11-10T20:30:00+02:00").toISOString() });
    expect(r.missed).toEqual([]);
    expect(Number((await h2.db.one(`select count(*) as n from ops_exceptions where kind like 'temperature%'`)).n)).toBe(0);
    const d = await h2.db.rpc("temperature_log_day", { p_source: h2.hub, p_day: "2026-11-10", p_now: new Date("2026-11-10T20:30:00+02:00").toISOString() });
    expect(d.slots.map((x: { state: string }) => x.state)).toEqual(["not_started", "not_started"]);
  }, 120_000);
});

describe("the packing checklist (UX2a, kept)", () => {
  it("is still data, and finish_pick_packed still refuses before every line is checked", async () => {
    const steps = (await h.db.one(`select value->'items' as i from settings where key = 'packing_checklist'`)).i as { key: string }[];
    expect(steps.map((s) => s.key)).toEqual(expect.arrayContaining(["cold_bag", "bag_label"]));
    const o = await placeOrder(h, [{ product_id: coffee, qty: 2 }]);
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: h.picker });
    await expect(h.db.rpc("finish_pick_packed", { p_order: o.orderId, p_by: h.picker, p_packing: { checked: [] } })).rejects.toThrow(/LINES_NOT_CHECKED/);
  });
});
