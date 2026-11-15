// Build plan 2.5: returns by button. Goods back from a failed delivery are counted on the ops line with three buttons;
// only what actually left the hub comes back; chilled goods are written off unless someone says they are fit.
import { beforeAll, describe, expect, it } from "vitest";
import { expectBooksBalanced, openHub, placeOrder, status, stock, type Hub, type Placed } from "./hub-kit";
import { opsLine, PHONES } from "./ops-kit";

let h: Hub; let line: ReturnType<typeof opsLine>; let WATER: string; let LABNEH: string; let COFFEE: string;

/** Picked (coffee short), offered, accepted, picked up, at the door, nobody answers. */
async function failedDelivery(lines: { product_id: string; qty: number }[], shortProduct?: string): Promise<Placed> {
  const o = await placeOrder(h, lines);
  await h.db.rpc("start_pick", { p_order: o.orderId, p_by: h.picker });
  if (shortProduct) {
    const item = (await h.db.one(`select id from order_items where order_id = $1 and product_id = $2`, [o.orderId, shortProduct])).id;
    await h.db.rpc("pick_item_missing", { p_item: item, p_by: h.picker });
  }
  await h.db.rpc("finish_pick", { p_order: o.orderId, p_by: h.picker });
  const d = await h.db.rpc("dispatch_order", { p_order: o.orderId });
  await line.tap(PHONES.rider(0), `job:accept:${d.delivery_id}`);
  await line.tap(PHONES.rider(0), `job:picked:${d.delivery_id}`);
  await line.tap(PHONES.rider(0), `stop:arrived:${o.orderId}`);
  await h.db.pg.query(`update delivery_stops set arrived_at = now() - interval '30 minutes' where order_id = $1`, [o.orderId]);
  await line.tap(PHONES.rider(0), `stop:noanswer:${o.orderId}`);
  expect(await status(h, o.orderId)).toBe("failed_delivery");
  return o;
}

beforeAll(async () => {
  h = await openHub();
  line = opsLine(h);
  WATER = await h.product("Tannourine Mineral Water 2L X6");
  LABNEH = await h.product("Leen Taanayel Labneh Premium");
  COFFEE = await h.product("Najjar Cafe Classic Normal 180G");
  await line.text(PHONES.rider(0), "حاضر");
}, 120_000);

describe("returns by button (2.5)", () => {
  let o: Placed; let water: { onHand: number }; let labneh: { onHand: number }; let coffee: { onHand: number };

  it("a failed delivery sends the pickers and the ops lead a button to count the return", async () => {
    o = await failedDelivery([{ product_id: WATER, qty: 2 }, { product_id: LABNEH, qty: 2 }, { product_id: COFFEE, qty: 1 }], COFFEE);
    for (const who of [h.picker, h.ops]) expect(line.lastButtons(who)).toEqual([`ret:open:${o.orderId}`]);
    water = await stock(h, WATER); labneh = await stock(h, LABNEH); coffee = await stock(h, COFFEE);
  });

  it("the card shows each line that left the hub with its default; the missing coffee is not on it", async () => {
    await line.tap(PHONES.picker, `ret:open:${o.orderId}`);
    const card = line.to(h.picker).at(-1)!;
    expect(card.body).toMatch(/✅ بيرجع عالرف:\n2 × Tannourine/);      // M1: grouped under one heading each
    expect(card.body).toMatch(/⚠️ تلف[^\n]*\n2 × Leen/);
    expect(card.body).not.toContain("Najjar");
    expect(card.buttons).toEqual([`ret:default:${o.orderId}`, `ret:all_fit:${o.orderId}`, `ret:all_waste:${o.orderId}`]);
  });

  it("'as shown': water back on the shelf, labneh written off, coffee untouched, the order closed; a second tap changes nothing", async () => {
    await line.tap(PHONES.picker, `ret:default:${o.orderId}`);
    expect(line.to(h.picker).at(-1)!.body).toContain("2 رجعوا عالرف، 2 تلف");
    expect(await status(h, o.orderId)).toBe("closed");
    expect((await stock(h, WATER)).onHand).toBe(water.onHand + 2);
    expect((await stock(h, LABNEH)).onHand).toBe(labneh.onHand);
    expect((await stock(h, COFFEE)).onHand).toBe(coffee.onHand);
    await line.tap(PHONES.ops, `ret:all_fit:${o.orderId}`);
    expect(line.to(h.ops).at(-1)!.body).toContain("مسجّل من قبل");
    expect((await stock(h, WATER)).onHand).toBe(water.onHand + 2);
    await expectBooksBalanced(h);
  });

  it("'all fit' puts chilled goods back too; 'all waste' writes everything off; the list by text", async () => {
    const a = await failedDelivery([{ product_id: WATER, qty: 2 }, { product_id: LABNEH, qty: 2 }]);
    const b = await failedDelivery([{ product_id: WATER, qty: 3 }]);
    await line.text(PHONES.picker, "مرتجع");
    expect(line.lastButtons(h.picker)).toEqual([`ret:open:${a.orderId}`, `ret:open:${b.orderId}`]);
    const l0 = await stock(h, LABNEH); const w0 = await stock(h, WATER);
    await line.tap(PHONES.picker, `ret:all_fit:${a.orderId}`);
    expect((await stock(h, LABNEH)).onHand).toBe(l0.onHand + 2);
    await line.tap(PHONES.picker, `ret:all_waste:${b.orderId}`);
    expect((await stock(h, WATER)).onHand).toBe(w0.onHand + 2);            // a's two back, b's three written off
    expect(await h.db.all(`select 1 from stock_movements where order_id = $1 and reason = 'waste'`, [b.orderId])).toHaveLength(1);
    await line.text(PHONES.picker, "مرتجعات");
    expect(line.to(h.picker).at(-1)!.body).toContain("ما في مرتجعات");
    await expectBooksBalanced(h);
  });

  it("only staff may receive a return", async () => {
    const c = await failedDelivery([{ product_id: WATER, qty: 3 }]);
    await expect(h.db.rpc("receive_return_by_button", { p_order: c.orderId, p_by: h.riders[0], p_choice: "default" })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(h.db.rpc("receive_return_by_button", { p_order: c.orderId, p_by: h.picker, p_choice: "some" })).rejects.toThrow(/UNKNOWN_CHOICE/);
  });
});
