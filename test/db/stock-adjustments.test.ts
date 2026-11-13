// Build plan 2.6: stock adjustments with a reason and a name.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let hub: string; let product: string; let picker: string; let ops: string; let rider: string;
const onHand = async () => Number((await db.one(`select on_hand from stock_levels where source_id = $1 and product_id = $2`, [hub, product])).on_hand);
const adjust = (delta: number, reason: string, by: string, extra: Record<string, unknown> = {}) =>
  db.rpc("adjust_stock", { p_source: hub, p_product: product, p_delta: delta, p_reason: reason, p_by: by, ...extra });

beforeAll(async () => {
  db = await openTestDb();
  hub = (await db.one(`select id from sources where kind = 'dark_store' limit 1`)).id;
  product = (await db.one(`select id from products where name_en = 'Leen Taanayel Labneh Premium'`)).id;
  await db.pg.query(`update stock_levels set on_hand = 40, reserved = 5 where source_id = $1 and product_id = $2`, [hub, product]);
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Rana') returning id`)).id;
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ziad') returning id`)).id;
  rider = (await db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
});

describe("stock adjustments (2.6)", () => {
  it("records who, why and the note, and moves the count", async () => {
    const r = await adjust(-2, "damaged", picker, { p_note: "two tubs crushed in the fridge" });
    expect(r).toMatchObject({ ok: true, on_hand: 38, reason: "waste" });
    expect(await onHand()).toBe(38);
    const m = await db.one(`select qty_delta, reason, adjust_reason, note, actor_id from stock_movements where id = $1`, [r.movement_id]);
    expect(m).toMatchObject({ reason: "waste", adjust_reason: "damaged", note: "two tubs crushed in the fridge", actor_id: picker });
    expect(Number(m.qty_delta)).toBe(-2);
    const list = await db.rpc<any[]>("stock_adjustments", {});
    expect(list.at(-1)).toMatchObject({ by: "Rana", reason: "damaged", product: "Leen Taanayel Labneh Premium" });
  });

  it("only staff, a known reason that fits the direction, and a note for 'other'", async () => {
    await expect(adjust(1, "found", rider)).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(adjust(1, "because", picker)).rejects.toThrow(/UNKNOWN_REASON/);
    await expect(adjust(3, "expired", picker)).rejects.toThrow(/REASON_DOES_NOT_FIT/);
    await expect(adjust(-1, "found", picker)).rejects.toThrow(/REASON_DOES_NOT_FIT/);
    await expect(adjust(1, "other", picker)).rejects.toThrow(/NOTE_REQUIRED/);
    await expect(adjust(0, "count", picker)).rejects.toThrow(/NO_CHANGE/);
    expect((await adjust(1, "other", picker, { p_note: "supplier extra unit" })).on_hand).toBe(39);
  });

  it("a picker is limited; above the limit it takes an ops lead", async () => {
    await expect(adjust(-13, "expired", picker)).rejects.toThrow(/NEEDS_OPS_LEAD/);
    expect((await adjust(-13, "expired", ops)).on_hand).toBe(26);
  });

  it("stock reserved for confirmed orders cannot be adjusted away", async () => {
    await expect(adjust(-22, "theft", ops)).rejects.toThrow(/BELOW_RESERVED/);
    expect(await onHand()).toBe(26);
  });

  it("a retried request with the same key changes nothing twice", async () => {
    const a = await adjust(-1, "sample", picker, { p_key: "console-req-1" });
    const b = await adjust(-1, "sample", picker, { p_key: "console-req-1" });
    expect(b).toMatchObject({ duplicate: true, movement_id: a.movement_id });
    expect(await onHand()).toBe(25);
  });

  it("a shelf count records the difference as one 'count' adjustment, and an exact count is kept too", async () => {
    const c = await db.rpc("count_stock", { p_source: hub, p_product: product, p_counted: 23, p_by: picker, p_key: "count-1" });
    expect(c).toMatchObject({ expected: 25, counted: 23, difference: -2 });
    expect(await onHand()).toBe(23);
    expect((await db.rpc("count_stock", { p_source: hub, p_product: product, p_counted: 23, p_by: picker, p_key: "count-1" })).duplicate).toBe(true);
    const exact = await db.rpc("count_stock", { p_source: hub, p_product: product, p_counted: 23, p_by: picker });
    expect(exact).toMatchObject({ difference: 0, movement_id: null });
    expect(await db.one(`select count(*)::int as n from stock_counts where product_id = $1`, [product])).toEqual({ n: 2 });
    expect(await db.one(`select adjust_reason, actor_id from stock_movements where id = $1`, [c.movement_id])).toEqual({ adjust_reason: "count", actor_id: picker });
  });
});
