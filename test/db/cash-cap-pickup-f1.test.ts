// G1-09 (session F1): the rider's cash cap is checked again at pickup, against the total after picking. The offer (0002) checked
// the total before picking; a dearer substitute the customer kept can take the rider past the hard cap. Nothing leaves the hub then.
import { beforeAll, describe, expect, it } from "vitest";
import { openHub, placeOrder, status, total, type Hub, type Placed } from "./hub-kit";

let h: Hub; let o: Placed; let delivery: string; let COFFEE: string; let CARDAMOM: string; let before: number;
const rider = () => h.riders[0]!;

beforeAll(async () => {
  h = await openHub();
  await h.db.pg.exec(`update settings set value = value || '{"offer_substitutes": true}' where key = 'picking'`);
  COFFEE = await h.product("Najjar Cafe Classic Normal 180G");
  CARDAMOM = await h.product("Najjar Cafe Cardamom 180G");
  o = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }]);
  before = await total(h, o.orderId);
  // The hard cap sits just above this order's total: the offer passes.
  await h.db.pg.query(`update settings set value = jsonb_build_object('soft_usd', $1::numeric, 'hard_usd', $1::numeric + 0.05) where key = 'cash_cap'`, [before]);
  await h.db.rpc("start_shift", { p_driver: rider() });
  await h.db.rpc("start_pick", { p_order: o.orderId, p_by: h.picker });
  const d = await h.db.rpc("dispatch_order", { p_order: o.orderId });
  delivery = d.delivery_id;
  expect(delivery).toBeTruthy();
  await h.db.rpc("rider_respond", { p_delivery: delivery, p_driver: rider(), p_accept: true });
  // Coffee is missing; the customer keeps the dearer cardamom coffee (+0.24).
  const item = (await h.db.one(`select id from order_items where order_id = $1 and product_id = $2 and status = 'ok'`, [o.orderId, COFFEE])).id;
  const m = await h.db.rpc("pick_item_missing", { p_item: item, p_by: h.picker });
  const missing = m.missing_item ?? (await h.db.one(`select id from order_items where order_id = $1 and status = 'missing'`, [o.orderId])).id;
  const offer = await h.db.rpc("pick_offer_substitute", { p_missing: missing, p_product: CARDAMOM, p_by: h.picker });
  await h.db.rpc("answer_substitution", { p_offer: offer.offer_id, p_party: o.customer, p_keep: true, p_wamid: "wamid.keep.f1" });
  await h.db.rpc("finish_pick", { p_order: o.orderId, p_by: h.picker });
  expect(await status(h, o.orderId)).toBe("ready");
}, 120_000);

describe("cash cap at pickup (G1-09)", () => {
  it("the total after picking is above what was offered", async () => {
    expect(await total(h, o.orderId)).toBeGreaterThan(before + 0.05);
  });

  it("pickup is refused while the rider would be past the hard cap, and the order stays at the hub", async () => {
    await expect(h.db.rpc("rider_picked_up", { p_delivery: delivery, p_driver: rider() })).rejects.toThrow(/CASH_CAP hard_cap/);
    expect(await status(h, o.orderId)).toBe("ready");
    expect((await h.db.one(`select status from deliveries where id = $1`, [delivery])).status).toBe("accepted");
  });

  it("with room under the cap, the same pickup goes ahead", async () => {
    await h.db.pg.exec(`update settings set value = '{"soft_usd": 150, "hard_usd": 200}' where key = 'cash_cap'`);
    expect(await h.db.rpc("rider_picked_up", { p_delivery: delivery, p_driver: rider() })).toMatchObject({ ok: true });
    expect(await status(h, o.orderId)).toBe("out_for_delivery");
  });
});
