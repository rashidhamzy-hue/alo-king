// Build plan 2.11: product recall and supplier credit.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let hub: string; let village: string; let ops: string; let picker: string; let supplier: string;
let item: { id: string; name_en: string; price: number }; let other: string;
const bal = async (code: string) => Number((await db.one(
  `select coalesce(sum(e.usd_equiv), 0) as s from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = $1`, [code])).s);
const level = async (p: string) => db.one(`select on_hand::float as on_hand, avg_cost_usd::float as avg from stock_levels where source_id = $1 and product_id = $2`, [hub, p]);

async function order(n: number, qty: number, confirm: boolean) {
  const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-r${n}`, p_phone: `+9617040000${n}`, p_name: `Recall ${n}` });
  await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: village });
  const place = (await db.one(`select id from customer_places where party_id = $1`, [t.party_id])).id;
  const o = await db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_lines: [{ product_id: item.id, qty }],
    p_village: village, p_place: place, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
  expect(o.created).toBe(true);
  if (confirm) expect((await db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: t.party_id, p_wamid: `w-r${n}` })).status).toBe("confirmed");
  return { id: o.order_id as string, party: t.party_id as string };
}

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500);
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 0, reserved = 0;`);
  hub = (await db.one(`select id from sources where kind = 'dark_store'`)).id;
  village = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker') returning id`)).id;
  const r = await db.one(`select p.id, p.name_en, o.price_usd from products p join offers o on o.product_id = p.id
    where p.storage = 'ambient' and o.price_usd between 1.5 and 4 order by p.name_en limit 1`);
  item = { id: r.id, name_en: r.name_en, price: Number(r.price_usd) };
  other = (await db.one(`select p.id from products p join offers o on o.product_id = p.id where p.storage = 'ambient' and p.id <> $1 order by p.name_en limit 1`, [item.id])).id;
  supplier = await db.rpc("create_supplier", { p_name: "Ambient Foods", p_by: ops });
  await db.rpc("receive_goods", { p_supplier: supplier, p_source: hub, p_by: ops, p_supplier_ref: "R-1",
    p_lines: [{ product_id: item.id, qty: 40, unit_cost_usd: 1 }, { product_id: other, qty: 10, unit_cost_usd: 2 }] });
}, 120_000);

describe("product recall (2.11)", () => {
  let delivered: { id: string }, atHub: { id: string }, pending: { id: string; party: string };

  it("one hold makes the product unsellable and lists the orders still at the hub", async () => {
    delivered = await order(1, 4, true);
    await db.pg.query(`update orders set status = 'closed', delivered_at = now() - interval '2 days' where id = $1`, [delivered.id]);
    atHub = await order(2, 4, true);
    pending = await order(3, 4, false);
    await expect(db.rpc("hold_product", { p_product: item.id, p_by: picker, p_reason: "" })).rejects.toThrow(/REASON_REQUIRED/);
    const h = await db.rpc("hold_product", { p_product: item.id, p_by: picker, p_reason: "supplier recall notice 14/11" });
    expect(h).toMatchObject({ ok: true, already: false });
    expect(h.open_orders.map((o: any) => [o.order_id, o.stage])).toEqual([[atHub.id, "at_hub"]]);
    expect((await db.rpc("hold_product", { p_product: item.id, p_by: ops, p_reason: "again" })).already).toBe(true);

    const search = await db.rpc("search_catalog", { p_query: item.name_en });
    expect(search.matches.map((m: any) => m.product_id)).not.toContain(item.id);
    const q = await db.rpc("quote_order", { p_lines: [{ product_id: item.id, qty: 1 }], p_village: village });
    expect(q.issues.map((i: any) => i.code)).toContain("unknown_product");
  });

  it("a card sent before the hold cannot be confirmed: the tap gets a stale quote", async () => {
    const r = await db.rpc("confirm_order_checked", { p_order: pending.id, p_party: pending.party, p_wamid: "w-r3b" });
    expect(r.status).toBe("stale_quote");
    expect(r.issues[0]).toMatchObject({ issue: "unavailable" });
  });

  it("a confirmed order cannot be picked with the held product in it, by any path", async () => {
    await db.rpc("transition_order", { p_order: atHub.id, p_to: "preparing", p_actor: "picker", p_actor_id: picker });
    await expect(db.rpc("transition_order", { p_order: atHub.id, p_to: "ready", p_actor: "picker", p_actor_id: picker })).rejects.toThrow(/PRODUCT_ON_HOLD/);
    expect((await db.one(`select status from orders where id = $1`, [atHub.id])).status).toBe("preparing");
    expect(await level(item.id)).toEqual({ on_hand: 40, avg: 1 });   // nothing left the shelf (the delivered fixture was closed directly)
  });

  it("the recall list has every order that contained it in the range, with the number to phone", async () => {
    const all = await db.rpc<any[]>("recall_orders", { p_product: item.id, p_from: new Date(Date.now() - 7 * 86400_000).toISOString(), p_to: new Date(Date.now() + 60_000).toISOString() });
    expect(all.map((o) => o.order_id).sort()).toEqual([delivered.id, atHub.id].sort());
    expect(all.find((o) => o.order_id === delivered.id)).toMatchObject({ stage: "with_customer", phone: "+96170400001", customer: "Recall 1" });
    const older = await db.rpc<any[]>("recall_orders", { p_product: item.id, p_from: "2020-01-01", p_to: new Date(Date.now() - 86400_000).toISOString() });
    expect(older.map((o) => o.order_id)).toEqual([delivered.id]);
  });

  it("only an ops lead or admin releases, with a note; the catalog comes back as it was", async () => {
    await expect(db.rpc("release_hold", { p_product: item.id, p_by: picker, p_note: "cleared" })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(db.rpc("release_hold", { p_product: item.id, p_by: ops, p_note: "" })).rejects.toThrow(/NOTE_REQUIRED/);
    expect(await db.rpc("release_hold", { p_product: item.id, p_by: ops, p_note: "batch cleared by supplier" })).toMatchObject({ was_held: true });
    expect(await db.one(`select p.is_active, o.is_available from products p join offers o on o.product_id = p.id where p.id = $1`, [item.id]))
      .toEqual({ is_active: true, is_available: true });
    await db.rpc("transition_order", { p_order: atHub.id, p_to: "ready", p_actor: "picker", p_actor_id: picker });
    expect(await level(item.id)).toEqual({ on_hand: 36, avg: 1 });
  });
});

describe("supplier credit (2.11)", () => {
  it("a price credit reduces what we owe and the average cost of what is left", async () => {
    const owed = await db.rpc<number>("supplier_balance", { p_supplier: supplier });
    expect(owed).toBeCloseTo(40 + 20, 2);
    await expect(db.rpc("record_supplier_credit", { p_supplier: supplier, p_source: hub, p_by: picker, p_reference: "CN-1", p_reason: "price",
      p_lines: [{ product_id: other, amount_usd: 4 }] })).rejects.toThrow(/NOT_AUTHORISED/);
    const c = await db.rpc("record_supplier_credit", { p_supplier: supplier, p_source: hub, p_by: ops, p_reference: "CN-1", p_reason: "price",
      p_lines: [{ product_id: other, amount_usd: 4 }] });
    expect(Number(c.owed_usd)).toBeCloseTo(56, 2);
    expect(await level(other)).toEqual({ on_hand: 10, avg: 1.6 });     // (20 - 4) / 10
    expect((await db.rpc("record_supplier_credit", { p_supplier: supplier, p_source: hub, p_by: ops, p_reference: "CN-1", p_reason: "price",
      p_lines: [{ product_id: other, amount_usd: 4 }] })).duplicate).toBe(true);
  });

  it("recalled goods sent back leave the shelf; a credit above their cost lowers the average of the rest", async () => {
    const c = await db.rpc("record_supplier_credit", { p_supplier: supplier, p_source: hub, p_by: ops, p_reference: "CN-2", p_reason: "recall",
      p_lines: [{ product_id: other, qty_returned: 4, amount_usd: 8 }] });
    expect(c.lines[0]).toMatchObject({ qty_returned: 4 });
    expect(await level(other)).toEqual({ on_hand: 6, avg: 1.3333 });   // value 16 - 8 = 8 over 6 units
    const m = await db.one(`select qty_delta::float as q, reason from stock_movements where product_id = $1 and reason = 'supplier_return'`, [other]);
    expect(m).toEqual({ q: -4, reason: "supplier_return" });
  });

  it("credit beyond the value left on the shelf reduces cost of goods", async () => {
    const cogsBefore = await bal("cogs");
    await db.rpc("record_supplier_credit", { p_supplier: supplier, p_source: hub, p_by: ops, p_reference: "CN-3", p_reason: "rebate",
      p_lines: [{ product_id: other, amount_usd: 10 }] });
    expect(await level(other)).toEqual({ on_hand: 6, avg: 0 });
    expect(await bal("cogs") - cogsBefore).toBeCloseTo(-2, 2);          // 10 credited, 8 was on the shelf
  });

  it("the books still balance and inventory still equals units times average cost", async () => {
    expect(await db.all(`select txn_id from ledger_entries group by txn_id having abs(sum(usd_equiv)) > 0.005`)).toEqual([]);
    expect(Number((await db.one(`select coalesce(sum(usd_equiv), 0) as s from ledger_entries`)).s)).toBeCloseTo(0, 2);
    const v = await db.rpc("inventory_valuation", { p_source: hub });
    expect(Number(v.ledger_usd)).toBeCloseTo(Number(v.stock_value_usd), 2);
    expect(await db.rpc<number>("supplier_balance", { p_supplier: supplier })).toBeCloseTo(60 - 4 - 8 - 10, 2);
  });
});
