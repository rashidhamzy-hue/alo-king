// Build plan 2.7 and the acceptance test "Cost at receiving gives margin; ledger at zero".
// Goods are received from a supplier at a cost, sold through the real order and rider path, and the books are read back:
// moving average cost, cost of goods against the order, gross margin, the supplier's balance, and a ledger at zero.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let hub: string; let village: string; let ops: string; let picker: string; let rider: string; let supplier: string;
let labneh: string; let price: number; let ambient: string;
const FX = 89500;
const bal = async (code: string) => Number((await db.one(
  `select coalesce(sum(e.usd_equiv), 0) as s from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = $1`, [code])).s);
const level = async (p: string) => db.one(`select on_hand::float as on_hand, avg_cost_usd::float as avg from stock_levels where source_id = $1 and product_id = $2`, [hub, p]);
const receive = (lines: unknown[], extra: Record<string, unknown> = {}) =>
  db.rpc("receive_goods", { p_supplier: supplier, p_source: hub, p_lines: lines, p_by: picker, ...extra });
const soon = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);

async function sell(n: number, qty: number) {
  const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-m${n}`, p_phone: `+9617030000${n}`, p_name: `M ${n}` });
  await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: village });
  const place = (await db.one(`select id from customer_places where party_id = $1`, [t.party_id])).id;
  const o = await db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_lines: [{ product_id: labneh, qty }],
    p_village: village, p_place: place, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
  await db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: t.party_id, p_wamid: `w-m${n}` });
  const d = await db.rpc("dispatch_order", { p_order: o.order_id });
  await db.rpc("rider_respond", { p_delivery: d.delivery_id, p_driver: rider, p_accept: true });
  await db.rpc("rider_picked_up", { p_delivery: d.delivery_id, p_driver: rider });      // the goods leave the shelf here
  await db.rpc("rider_delivered", { p_order: o.order_id, p_driver: rider });
  const total = Number((await db.one(`select total_usd from orders where id = $1`, [o.order_id])).total_usd);
  await db.rpc("rider_collect", { p_order: o.order_id, p_driver: rider, p_usd: total, p_lbp: 0 });
  return o.order_id as string;
}

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (${FX});
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';`);
  hub = (await db.one(`select id from sources where kind = 'dark_store'`)).id;
  village = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  await db.pg.query(`update sources set village_id = $1 where id = $2`, [village, hub]);
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker') returning id`)).id;
  rider = (await db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
  await db.rpc("start_shift", { p_driver: rider });
  const l = await db.one(`select p.id, o.price_usd from products p join offers o on o.product_id = p.id where p.name_en = 'Leen Taanayel Labneh Premium'`);
  labneh = l.id; price = Number(l.price_usd);
  ambient = (await db.one(`select p.id from products p join stock_levels s on s.product_id = p.id where p.storage = 'ambient' order by p.name_en limit 1`)).id;
  await db.pg.query(`update stock_levels set on_hand = 0, reserved = 0 where product_id = $1`, [labneh]);
  await db.pg.query(`update stock_levels set on_hand = 5, reserved = 0 where product_id = $1`, [ambient]);
}, 120_000);

describe("suppliers and receiving (2.7)", () => {
  it("only an ops lead or admin creates a supplier; the same name is the same supplier", async () => {
    await expect(db.rpc("create_supplier", { p_name: "Dairy Co", p_by: picker })).rejects.toThrow(/NOT_AUTHORISED/);
    supplier = await db.rpc("create_supplier", { p_name: "Dairy Co", p_by: ops, p_phone: "+9611000000", p_terms: "30 days" });
    expect(await db.rpc("create_supplier", { p_name: "dairy co ", p_by: ops })).toBe(supplier);
  });

  it("a receipt on credit adds stock at cost, sets the average and what we owe the supplier", async () => {
    await expect(receive([{ product_id: labneh, qty: 20, unit_cost_usd: 0.4 }])).rejects.toThrow(/EXPIRY_REQUIRED/);
    const r = await receive([{ product_id: labneh, qty: 20, unit_cost_usd: 0.4, expiry_date: soon, lot: "L1" }], { p_supplier_ref: "INV-001" });
    expect(r).toMatchObject({ ok: true, total_usd: 8 });
    expect(r.lines[0]).toMatchObject({ avg_cost_usd: 0.4, price_usd: price });
    expect(r.lines[0].margin_pct).toBeCloseTo(((price - 0.4) / price) * 100, 1);
    expect(await level(labneh)).toEqual({ on_hand: 20, avg: 0.4 });
    expect(await db.rpc("supplier_balance", { p_supplier: supplier })).toBeCloseTo(8, 2);
    expect(await bal(`inventory:${hub}`)).toBeCloseTo(8, 2);
  });

  it("the same supplier reference twice is one receipt", async () => {
    const again = await receive([{ product_id: labneh, qty: 20, unit_cost_usd: 0.4, expiry_date: soon }], { p_supplier_ref: "INV-001" });
    expect(again.duplicate).toBe(true);
    expect((await level(labneh)).on_hand).toBe(20);
  });

  it("a second receipt at another cost moves the average", async () => {
    await expect(receive([{ product_id: labneh, qty: 10, unit_cost_usd: 0.55, expiry_date: soon }], { p_paid_from: "hub_cash" })).rejects.toThrow(/NEEDS_OPS_LEAD/);
    await receive([{ product_id: labneh, qty: 10, unit_cost_usd: 0.55, expiry_date: soon }], { p_supplier_ref: "INV-002" });
    expect(await level(labneh)).toEqual({ on_hand: 30, avg: 0.45 });     // (20 x 0.40 + 10 x 0.55) / 30
    expect(await bal(`inventory:${hub}`)).toBeCloseTo(13.5, 2);
  });

  it("selling posts cost of goods against the order at the average; the order and the day show their margin", async () => {
    const order = await sell(1, 12);
    expect(await level(labneh)).toEqual({ on_hand: 18, avg: 0.45 });
    const m = await db.rpc("order_margin", { p_order: order });
    expect(m).toMatchObject({ costed: true });
    expect(Number(m.goods_usd)).toBeCloseTo(12 * price, 2);
    expect(Number(m.cogs_usd)).toBeCloseTo(5.4, 2);
    expect(Number(m.margin_usd)).toBeCloseTo(12 * price - 5.4, 2);
    const day = await db.rpc("gross_margin", {});
    expect(Number(day.revenue_goods_usd)).toBeCloseTo(12 * price, 2);
    expect(Number(day.cogs_usd)).toBeCloseTo(5.4, 2);
    expect(Number(day.gross_margin_usd)).toBeCloseTo(12 * price - 5.4, 2);
    expect(Number(day.uncosted_units_sold)).toBe(0);
  });

  it("a waste adjustment is valued at the average and posted as a stock loss", async () => {
    await db.rpc("adjust_stock", { p_source: hub, p_product: labneh, p_delta: -1, p_reason: "spoiled", p_by: picker });
    expect(await bal("stock_loss")).toBeCloseTo(0.45, 2);
    expect(Number((await db.rpc("gross_margin", {})).stock_loss_usd)).toBeCloseTo(0.45, 2);
  });

  it("stock with no cost is valued openly at its first receipt cost", async () => {
    const r = await receive([{ product_id: ambient, qty: 5, unit_cost_usd: 1.2 }], { p_supplier_ref: "INV-003" });
    expect(Number(r.opening_value_usd)).toBeCloseTo(6, 2);
    expect(await level(ambient)).toEqual({ on_hand: 10, avg: 1.2 });
    expect(await bal("opening_balance")).toBeCloseTo(-6, 2);
  });

  it("paying the supplier from the till reduces what we owe, once per reference", async () => {
    await expect(db.rpc("pay_supplier", { p_supplier: supplier, p_amount_usd: 10, p_by: picker, p_ref: "PAY-1" })).rejects.toThrow(/NOT_AUTHORISED/);
    const p = await db.rpc("pay_supplier", { p_supplier: supplier, p_amount_usd: 10, p_by: ops, p_ref: "PAY-1" });
    expect(Number(p.owed_usd)).toBeCloseTo(8 + 5.5 + 6 - 10, 2);
    expect((await db.rpc("pay_supplier", { p_supplier: supplier, p_amount_usd: 10, p_by: ops, p_ref: "PAY-1" })).duplicate).toBe(true);
  });

  it("a failed delivery that comes back undoes its cost of goods; what is not fit to sell is a stock loss", async () => {
    const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "bsuid-m9", p_phone: "+96170300009", p_name: "M 9" });
    await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: village });
    const place = (await db.one(`select id from customer_places where party_id = $1`, [t.party_id])).id;
    const o = await db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_lines: [{ product_id: labneh, qty: 8 }],
      p_village: village, p_place: place, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
    await db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: t.party_id, p_wamid: "w-m9" });
    const d = await db.rpc("dispatch_order", { p_order: o.order_id });
    await db.rpc("rider_respond", { p_delivery: d.delivery_id, p_driver: rider, p_accept: true });
    await db.rpc("rider_picked_up", { p_delivery: d.delivery_id, p_driver: rider });
    expect(Number((await db.rpc("order_margin", { p_order: o.order_id })).cogs_usd)).toBeCloseTo(8 * 0.45, 2);
    await db.rpc("rider_arrived", { p_order: o.order_id, p_driver: rider });
    await db.pg.query(`update delivery_stops set arrived_at = now() - interval '20 minutes' where order_id = $1`, [o.order_id]);
    expect((await db.rpc("rider_no_answer", { p_order: o.order_id, p_driver: rider })).status).toBe("failed_delivery");
    const lossBefore = await bal("stock_loss");
    await db.rpc("receive_return", { p_order: o.order_id, p_by: ops, p_restock: { [labneh]: 5 } });   // 5 back on the shelf, 3 written off
    expect(Number((await db.rpc("order_margin", { p_order: o.order_id })).cogs_usd)).toBeCloseTo(0, 2);
    expect(await bal("stock_loss") - lossBefore).toBeCloseTo(3 * 0.45, 2);
    expect(await level(labneh)).toEqual({ on_hand: 14, avg: 0.45 });   // 17, less 8 picked, plus 5 back
  });

  it("the books: every transaction balances, the ledger sums to zero, inventory equals units times average cost", async () => {
    expect(await db.all(`select txn_id from ledger_entries group by txn_id having abs(sum(usd_equiv)) > 0.005`)).toEqual([]);
    expect(Number((await db.one(`select coalesce(sum(usd_equiv), 0) as s from ledger_entries`)).s)).toBeCloseTo(0, 2);
    const v = await db.rpc("inventory_valuation", { p_source: hub });
    expect(Number(v.ledger_usd)).toBeCloseTo(Number(v.stock_value_usd), 2);
    expect(Number(v.stock_value_usd)).toBeCloseTo(14 * 0.45 + 10 * 1.2, 2);
    expect(await bal("cogs")).toBeCloseTo(5.4, 2);
  });

  it("expiring lots still on the shelf are listed", async () => {
    const rows = await db.rpc<any[]>("expiring_stock", { p_source: hub, p_days: 14 });
    expect(rows.map((r) => r.lot)).toContain("L1");
  });
});
