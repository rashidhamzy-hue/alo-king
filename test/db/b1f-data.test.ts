// B1f: product data before the friends' test (migration 0253). The eggs sold "by weight" (AK-0049), a price basis to confirm on every
// by-weight item, the console's "Weights to record on label day" list, and delivery windows only inside the hours and the rider shifts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let lead: string; let customer: string;
beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500); update stock_levels set on_hand = 20;
    update settings set value = '{"open":"09:00","close":"21:00","tz":"Asia/Beirut"}' where key = 'hours';`);
  // the seeds load after the migrations here, so the checks 0253 opened on staging are opened now, the same way
  await db.rpc("b1f_price_basis_checks", {});
  lead = (await db.one(`insert into parties(role) values ('ops_lead') returning id`)).id;
  customer = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
}, 180_000);
afterAll(async () => { await db?.pg.close(); });

const offerOf = (sku: string) => db.one(`select o.is_available, o.price_usd from offers o join products p on p.id = o.product_id join sources s on s.id = o.source_id and s.kind = 'dark_store' where p.sku = $1`, [sku]);
const idOf = async (sku: string) => (await db.one(`select id from products where sku = $1`, [sku])).id as string;
const quoteLine = async (sku: string) => (await db.rpc("quote_order", { p_lines: [{ product_id: await idOf(sku), qty: 1 }], p_village: null, p_pickup: true })).lines[0];

describe("the eggs AK-0049", () => {
  it("are a fixed pack (the maker's barcode): sold Each, never 'by weight'", async () => {
    expect((await db.one(`select sell_unit from products where sku = 'AK-0049'`)).sell_unit).toBe("Each");
    expect(await db.rpc("catalog_price_for", { p_product: await idOf("AK-0049") })).toBeNull();
  });
  it("wait for their price basis: not sold, whatever path tries to put the offer back", async () => {
    const chk = await db.one(`select k.* from price_basis_checks k join products p on p.id = k.product_id where p.sku = 'AK-0049' and k.resolved_at is null`);
    expect(chk.blocks_sale).toBe(true);
    expect(chk.question).toMatch(/How many eggs/);
    expect((await offerOf("AK-0049")).is_available).toBe(false);
    expect((await quoteLine("AK-0049")).ok).toBe(false);
    await db.pg.query(`update offers set is_available = true where product_id = $1`, [await idOf("AK-0049")]);
    expect((await offerOf("AK-0049")).is_available).toBe(false);
  });
  it("only an ops lead or admin answers; the answer gives the offer back and the price is untouched", async () => {
    const before = await offerOf("AK-0049");
    const id = (await db.one(`select k.id from price_basis_checks k join products p on p.id = k.product_id where p.sku = 'AK-0049' and k.resolved_at is null`)).id;
    await expect(db.rpc("resolve_price_basis", { p_check: id, p_resolution: "per_pack", p_note: "x", p_by: customer })).rejects.toThrow(/NOT_AUTHORISED/);
    const r = await db.rpc("resolve_price_basis", { p_check: id, p_resolution: "per_pack", p_note: "tray of 30, invoice checked", p_by: lead });
    expect(r.ok).toBe(true);
    const after = await offerOf("AK-0049");
    expect(after.is_available).toBe(true);
    expect(after.price_usd).toBe(before.price_usd);
    expect((await quoteLine("AK-0049")).ok).toBe(true);
  });
});

describe("a price basis to confirm on every by-weight item", () => {
  it("each has an open check that does not stop the sale; the pages still say 'per pack, weight not confirmed yet'", async () => {
    const rows = await db.all(`select p.sku, k.blocks_sale from products p join price_basis_checks k on k.product_id = p.id and k.resolved_at is null
                                where p.sell_unit ilike 'by weight%' order by p.sku`);
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows.every((r) => r.blocks_sale === false)).toBe(true);
    expect(await db.rpc("catalog_price_for", { p_product: await idOf("AK-0029") })).toEqual({ per: "pack", about_g: null });
    expect((await offerOf("AK-0029")).is_available).toBe(true);
    expect((await quoteLine("AK-0029")).ok).toBe(true);
  });
  it("opening it again is a no-op (the migration and the test both call it)", async () => {
    const n = (await db.one(`select count(*)::int as n from price_basis_checks where resolved_at is null`)).n;
    expect(await db.rpc("b1f_price_basis_checks", {})).toBe(0);
    expect((await db.one(`select count(*)::int as n from price_basis_checks where resolved_at is null`)).n).toBe(n);
  });
  it("'per kg' makes the item's pages say per kg", async () => {
    const id = (await db.one(`select k.id from price_basis_checks k join products p on p.id = k.product_id where p.sku = 'AK-0044' and k.resolved_at is null`)).id;
    await db.rpc("resolve_price_basis", { p_check: id, p_resolution: "per_kg", p_note: "invoice per kg", p_by: lead });
    expect(await db.rpc("catalog_price_for", { p_product: await idOf("AK-0044") })).toEqual({ per: "kg", about_g: null });
  });
});

describe("weights to record on label day", () => {
  it("lists every hub item whose pack weight is not approved, with its aisle, what the price is for and the open check; never a guessed weight", async () => {
    const rows = await db.rpc<any[]>("weights_to_record", {});
    const by = new Map(rows.map((r) => [r.sku, r]));
    expect(by.get("AK-0029")).toMatchObject({ weight_missing: true, price_for: { per: "pack", about_g: null } });
    expect(by.get("AK-0029").aisle_en).toBeTruthy();
    expect(by.get("AK-0029").check.blocks_sale).toBe(false);
    expect(rows.filter((r) => r.price_for?.about_g != null).map((r) => [r.sku, r.price_for, r.check?.blocks_sale])).toEqual([]);
    // an approved pack weight takes the item off the list
    await db.pg.query(`insert into product_field_values(product_id, field_key, value, source, status, approved_at) values ($1, 'size', '"450 g"', 'label_photo', 'approved', now())`, [await idOf("AK-0042")]);
    const k = (await db.one(`select k.id from price_basis_checks k join products p on p.id = k.product_id where p.sku = 'AK-0042' and k.resolved_at is null`)).id;
    await db.rpc("resolve_price_basis", { p_check: k, p_resolution: "per_pack", p_note: "", p_by: lead });
    expect((await db.rpc<any[]>("weights_to_record", {})).some((r) => r.sku === "AK-0042")).toBe(false);
  });
});

describe("delivery windows only inside the rider shifts", () => {
  it("service_covers reads the shifts from settings", async () => {
    expect(await db.rpc("service_covers", { p_from: "09:00", p_to: "11:00" })).toBe(true);
    expect(await db.rpc("service_covers", { p_from: "19:00", p_to: "21:00" })).toBe(true);
    expect(await db.rpc("service_covers", { p_from: "06:00", p_to: "08:00" })).toBe(false);   // before the first shift (08:00)
    await db.pg.exec(`update settings set value = jsonb_set(value, '{rider,shifts}', '[{"id":"m","from":"10:00","to":"15:30"},{"id":"e","from":"15:30","to":"20:00"}]') where key = 'join'`);
    expect(await db.rpc("service_covers", { p_from: "09:00", p_to: "11:00" })).toBe(false);   // no rider at 09:00
    expect(await db.rpc("service_covers", { p_from: "12:00", p_to: "14:00" })).toBe(true);
    expect(await db.rpc("service_covers", { p_from: "19:00", p_to: "21:00" })).toBe(false);   // no rider after 20:00
  });
  it("the windows offered skip what the shifts cannot meet", async () => {
    await db.pg.exec(`insert into delivery_window_plans(name, weekdays, starts, ends, capacity, order_by_min, fresh_order_by_min, active)
                      values ('m', '{1,2,3,4,5,6,7}', '09:00', '11:00', 4, 60, 240, true), ('n', '{1,2,3,4,5,6,7}', '12:00', '14:00', 4, 60, 240, true)`);
    const w = await db.rpc<any[]>("open_delivery_windows", { p_village: null, p_fresh: false, p_limit: 20 });
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((x) => String(x.starts).slice(0, 5) === "12:00")).toBe(true);
  });
});
