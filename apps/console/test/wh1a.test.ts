// WH1a, warehouse basics on the console's Stock pages: purchase orders (and their print in Arabic and English), receiving against one
// (with the label day's list after it), bins and the pick walk, lots on the Stock page (use soon, write a lot off), the temperature log by
// photo, and the packing checklist kept. Written before the pages: every block failed on main (no route).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, openShop, rig, type Rig } from "./kit";

let r: Rig; let village: string;
afterEach(() => vi.unstubAllGlobals());
const day = (n: number) => new Date(Date.now() + n * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Beirut" });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const who = async (role: "ops_lead" | "picker" | "admin", name: string, lang = "en") => { const w = await r.staff(role, name); const b = r.browser(); await b.signIn(w); b.cookies.set("ak_lang", lang); return { ...w, b }; };
let labneh: { id: string; sku: string; name_ar: string }; let coffee: { id: string; sku: string }; let supplier: string; let poId = "";

beforeAll(async () => {
  r = await rig(); village = await openShop(r.db);
  labneh = await r.db.one(`select id, sku, coalesce(name_ar, name_en) as name_ar from products where name_en = 'Leen Taanayel Labneh Premium'`);
  coffee = await r.db.one(`select id, sku from products where name_en = 'Najjar Cafe Classic Normal 180G'`);
  await r.db.pg.query(`update stock_levels set on_hand = 0 where product_id = $1`, [labneh.id]);
}, 120_000);

describe("purchase orders", () => {
  it("an ops lead writes one by item code, quantity and an optional cost; a picker sees the list but cannot write one", async () => {
    const lead = await who("ops_lead", "Maya");
    expect(flashOf((await lead.b.post("/suppliers", { name: "Leen Dairy", phone: "+9618000000", terms: "30 days" })).text)).toBe("Supplier Leen Dairy saved.");
    supplier = (await r.db.one(`select id from suppliers where name = 'Leen Dairy'`)).id;
    let page = (await lead.b.get("/purchase-orders")).text;
    expect(page).toContain("New purchase order");
    expect(page).toContain(`<datalist id="po-items">`);                                 // a name typed finds the item's code
    expect(flashOf((await lead.b.post("/purchase-orders", { supplier, expected_date: day(1), code_0: "NO-SUCH", qty_0: 2 })).text)).toBe("No item with SKU or barcode NO-SUCH.");
    expect(flashOf((await lead.b.post("/purchase-orders", { supplier, expected_date: day(1) })).text)).toBe("Add at least one item.");
    page = (await lead.b.post("/purchase-orders", { supplier, expected_date: day(1), note: "morning van", code_0: labneh.sku, qty_0: 24, cost_0: "0.50", code_1: coffee.sku, qty_1: 12 })).text;
    expect(flashOf(page)).toBe("Purchase order PO-0001 written for Leen Dairy.");
    poId = (await r.db.one(`select id from purchase_orders where number = 'PO-0001'`)).id;
    expect(page).toContain("PO-0001");
    expect(page).toContain("Print in English");
    expect(page).toContain("Print in Arabic");

    const picker = await who("picker", "Pia");
    page = (await picker.b.get("/purchase-orders")).text;
    expect(page).toContain("PO-0001");
    expect(page).not.toContain("New purchase order");
    expect((await picker.b.post("/purchase-orders", { supplier, expected_date: day(1), code_0: labneh.sku, qty_0: 1 }, { follow: false })).status).toBe(403);
  });

  it("prints in English and in Arabic: the supplier, the dates, every line with its quantity; no menu; Arabic right to left", async () => {
    const lead = await who("ops_lead", "Maya2");
    const en = (await lead.b.get(`/purchase-orders/${poId}/print?lang=en`)).text;
    expect(en).toMatch(/<html lang="en" dir="ltr"/);
    expect(en).toContain("Purchase order PO-0001");
    expect(en).toContain("Leen Dairy"); expect(en).toContain("+9618000000"); expect(en).toContain(day(1));
    expect(en).toContain("Leen Taanayel Labneh Premium"); expect(en).toContain("Najjar Cafe Classic Normal 180G");
    expect(en).toContain("morning van");
    expect(en).not.toContain('class="sidebar"');
    const ar = (await lead.b.get(`/purchase-orders/${poId}/print?lang=ar`)).text;
    expect(ar).toMatch(/<html lang="ar" dir="rtl"/);
    expect(ar).toContain("طلب شراء PO-0001");
    expect(ar).toContain(labneh.name_ar);
    expect(ar).toContain("المورّد");
  });

  it("an open order can be cancelled by a lead with a reason", async () => {
    const lead = await who("ops_lead", "Maya3");
    await lead.b.post("/purchase-orders", { supplier, expected_date: day(2), code_0: coffee.sku, qty_0: 3 });
    const id = (await r.db.one(`select id from purchase_orders where number = 'PO-0002'`)).id;
    await lead.b.get(`/purchase-orders/${id}`);
    expect(flashOf((await lead.b.post(`/purchase-orders/${id}/cancel`, { reason: "" })).text)).toBe("Write the reason (at least 3 characters).");
    expect(flashOf((await lead.b.post(`/purchase-orders/${id}/cancel`, { reason: "ordered twice" })).text)).toBe("PO-0002 cancelled.");
    expect((await r.db.one(`select status from purchase_orders where id = $1`, [id])).status).toBe("cancelled");
  });
});

describe("receiving against a purchase order", () => {
  it("the old receiving form without an order is gone: the page sends you to the purchase orders", async () => {
    const picker = await who("picker", "Pia2");
    const page = (await picker.b.get("/receiving")).text;
    expect(page).not.toContain('name="code_0"');
    expect(page).toContain('href="/purchase-orders"');
  });

  it("a picker counts each line (lot, expiry, damaged), short and damaged are said, and the label day's list follows", async () => {
    const picker = await who("picker", "Rana", "ar");
    const page = (await picker.b.get(`/purchase-orders/${poId}`)).text;
    expect(page).toContain("استلام");
    const [lab, cof] = await r.db.all(`select id from purchase_order_lines where po_id = $1 order by position`, [poId]) as { id: string }[];
    const base = { [`counted_${lab!.id}`]: 20, [`damaged_${lab!.id}`]: 2, [`lot_${lab!.id}`]: "L1", [`note_${lab!.id}`]: "two lids split", [`counted_${cof!.id}`]: 12, [`cost_${cof!.id}`]: "1.20", supplier_ref: "INV-77" };
    // Arabic words for the database's refusal: the chilled labneh has no expiry
    expect(flashOf((await picker.b.post(`/purchase-orders/${poId}/receive`, base)).text)).toContain("يحتاج تاريخ انتهاء الصلاحية");
    const done = (await picker.b.post(`/purchase-orders/${poId}/receive`, { ...base, [`expiry_${lab!.id}`]: day(10) })).text;
    expect(flashOf(done)).toContain("استُلم PO-0001");
    expect(Number((await r.db.one(`select on_hand from stock_levels where product_id = $1`, [labneh.id])).on_hand)).toBe(18);
    expect(await r.db.one(`select lot, expiry_date::text as e, qty_left::float as q from stock_lots where product_id = $1`, [labneh.id])).toEqual({ lot: "L1", e: day(10), q: 18 });
    // the page now shows what came, what is short, what was damaged, and the label day's list with its door
    expect(done).toContain("ناقص");
    expect(done).toContain("two lids split");
    expect(done).toContain('href="/capture"');
    const next = await r.db.rpc("label_capture_next", { p_after: null });
    expect([labneh.id, coffee.id]).toContain(next.product_id);
    // a second tap is the first receiving
    expect(Number((await r.db.one(`select count(*) as n from goods_receipts`)).n)).toBe(1);
  });
});

describe("the Receiving page in Arabic (coordinator, 18 November)", () => {
  it("says suppliers, what we owe, receipts and its forms in Arabic, and answers in Arabic", async () => {
    const lead = await who("ops_lead", "Maya4", "ar");
    const page = (await lead.b.get("/receiving")).text;
    for (const w of ["البضاعة الداخلة", "آخر الاستلامات", "المورّدون", "أضف مورّداً", "طلبات الشراء", "المخزون بالكلفة"]) expect(page).toContain(w);
    expect(page).not.toMatch(/<h2>(Goods in|Suppliers|Last receipts)<\/h2>/);
    expect(page).not.toContain('lang="en" dir="ltr"><h1>');                                // a translated page: no English island in the Arabic shell
    expect(flashOf((await lead.b.post("/suppliers", { name: "Example Bakery" })).text)).toBe("حُفظ المورّد Example Bakery.");
    expect(flashOf((await lead.b.post("/suppliers", { name: "x" })).text)).toBe("اكتب اسم المورّد.");
  });
});

describe("lots on the Stock page", () => {
  it("use soon lists each lot with its code, date and units left; a lead writes a lot off", async () => {
    const lead = await who("ops_lead", "Hussein");
    const lot = (await r.db.one(`select id from stock_lots where lot = 'L1'`)).id;
    await r.db.pg.query(`update stock_lots set expiry_date = current_date + 1 where id = $1`, [lot]);
    const page = (await lead.b.get("/stock")).text;
    expect(page).toMatch(/Use within 2 days \(1\)/);
    expect(page).toContain("Lot L1");
    expect(page).toContain("18 left");
    expect(page).toContain(`/stock/lots/${lot}/write-off`);
    expect(flashOf((await lead.b.post(`/stock/lots/${lot}/write-off`, { qty: 3, reason: "" })).text)).toBe("Choose a reason from the list.");
    expect(flashOf((await lead.b.post(`/stock/lots/${lot}/write-off`, { qty: 3, reason: "damaged" })).text)).toBe("Written off: 3 from lot L1. 15 left in it.");
    expect(Number((await r.db.one(`select qty_left from stock_lots where id = $1`, [lot])).qty_left)).toBe(15);
  });
});

describe("bins and the pick walk", () => {
  it("a lead makes bins; an item goes in a bin of its own zone; the runner names the bin and the lot to take", async () => {
    const lead = await who("ops_lead", "Hussein2");
    let page = (await lead.b.get("/bins")).text;
    expect(page).toContain("New bin");
    expect(flashOf((await lead.b.post("/bins", { code: "C1", zone: "chilled" })).text)).toBe("Bin C1 made (chilled).");
    expect(flashOf((await lead.b.post("/bins", { code: "A1", zone: "ambient" })).text)).toBe("Bin A1 made (ambient).");
    const a1 = (await r.db.one(`select id from bins where code = 'A1'`)).id; const c1 = (await r.db.one(`select id from bins where code = 'C1'`)).id;
    expect(flashOf((await lead.b.post("/bins/place", { code: labneh.sku, bin: a1 })).text)).toBe("The item is chilled and the bin is ambient: choose a bin in the item's own zone.");
    expect(flashOf((await lead.b.post("/bins/place", { code: labneh.sku, bin: c1 })).text)).toBe("Leen Taanayel Labneh Premium is now in bin C1.");
    page = (await lead.b.get("/bins")).text;
    expect(page).toContain("Leen Taanayel Labneh Premium");
    const picker = await who("picker", "Pia3");
    expect((await picker.b.get("/bins")).text).not.toContain("New bin");
    expect(flashOf((await picker.b.post("/bins/place", { code: coffee.sku, bin: a1 })).text)).toBe("Najjar Cafe Classic Normal 180G is now in bin A1.");
    expect((await picker.b.post("/bins", { code: "A9", zone: "ambient" }, { follow: false })).status).toBe(403);

    // an order with the labneh: the runner says the bin and the lot
    const t = await r.db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "bsuid-wh1a", p_phone: "+96170999001", p_name: "C" });
    await r.db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: village });
    const place = (await r.db.one(`select id from customer_places where party_id = $1`, [t.party_id])).id;
    const o = await r.db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_lines: [{ product_id: labneh.id, qty: 8 }],
      p_village: village, p_place: place, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
    await r.db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: t.party_id, p_wamid: "w-wh1a" });
    await picker.b.get("/pick");
    const run = (await picker.b.post(`/pick/${o.order_id}/start`, {})).text;
    expect(run).toContain("Bin C1");
    expect(run).toContain("Lot L1");
    expect(run).toContain(`use by ${day(1)}`);
  });
});

describe("the temperature log", () => {
  it("a picker sends the thermometer's photo and the number; out of range says the alert was raised", async () => {
    const picker = await who("picker", "Pia4");
    let page = (await picker.b.get("/temperature")).text;
    expect(page).toContain("Chilled");
    expect(page).toContain("08:30");                                                      // the slots are the setting's
    expect(page).toMatch(/0 to 5 °C/);
    expect(flashOf((await picker.b.postFiles("/temperature", { zone: "chilled", reading_c: "3.5" }, {})).text)).toBe("Take the photo of the thermometer first.");
    page = (await picker.b.postFiles("/temperature", { zone: "chilled", reading_c: "3.5" }, { photo: { name: "t.jpg", type: "image/jpeg", bytes: JPEG } })).text;
    expect(flashOf(page)).toBe("Saved: 3.5 °C, in range.");
    const row = await r.db.one(`select reading_c::float as c, photo_path from temperature_readings`);
    expect(row.c).toBe(3.5);
    expect(row.photo_path).toMatch(new RegExp(`^temperature/${r.source}/`));
    page = (await picker.b.postFiles("/temperature", { zone: "chilled", reading_c: "8", note: "door left open" }, { photo: { name: "u.jpg", type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 9, 9, 0xff, 0xd9]) } })).text;
    expect(flashOf(page)).toBe("Saved: 8 °C, OUT OF RANGE (0 to 5 °C). The staff alert was raised: move the chilled goods to a working fridge, or hold them.");
    expect(Number((await r.db.one(`select count(*) as n from ops_exceptions where kind = 'temperature_out_of_range'`)).n)).toBe(1);
    expect(page).toContain("door left open");
  });
});

describe("the menu", () => {
  it("the Stock group has purchase orders, bins and the temperature log", async () => {
    const lead = await who("ops_lead", "Hussein3");
    const page = (await lead.b.get("/stock")).text;
    for (const href of ["/purchase-orders", "/bins", "/temperature"]) expect(page).toContain(`href="${href}"`);
  });
});
