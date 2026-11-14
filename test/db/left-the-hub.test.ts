// C2's request, done by C3 (migration 0042): only the lines that left the hub count.
// The recall list never names someone whose goods came back to the hub; the rider's card counts the bags that left.
import { beforeAll, describe, expect, it } from "vitest";
import { collect, openHub, placeOrder, type Hub, type Placed } from "./hub-kit";

let h: Hub; let WATER: string; let COFFEE: string;
const recall = (product: string) => h.db.rpc<any[]>("recall_orders", { p_product: product, p_from: "2020-01-01", p_to: new Date(Date.now() + 60_000).toISOString() });

beforeAll(async () => {
  h = await openHub();
  WATER = await h.product("Tannourine Mineral Water 2L X6");
  COFFEE = await h.product("Najjar Cafe Classic Normal 180G");
  await h.db.rpc("start_shift", { p_driver: h.riders[0] });
}, 120_000);

describe("lines that left the hub (0042)", () => {
  let a: Placed; let delivery: string;
  beforeAll(async () => {
    a = await placeOrder(h, [{ product_id: WATER, qty: 3 }, { product_id: COFFEE, qty: 1 }]);
    await h.db.rpc("start_pick", { p_order: a.orderId, p_by: h.picker });
    const coffee = (await h.db.one(`select id from order_items where order_id = $1 and product_id = $2`, [a.orderId, COFFEE])).id;
    expect((await h.db.rpc("pick_item_missing", { p_item: coffee, p_by: h.picker, p_found: 0 })).decision).toBe("removed");
    expect((await h.db.rpc("finish_pick", { p_order: a.orderId, p_by: h.picker })).status).toBe("ready");
    const d = await h.db.rpc("dispatch_order", { p_order: a.orderId });   // the ops line does this at pick start
    expect(d.status).toBe("offered");
    delivery = d.delivery_id;
  });

  it("the rider's card counts only the lines that left the hub, not the one missing at the shelf", async () => {
    expect(await h.db.all(`select status from order_items where order_id = $1 order by status`, [a.orderId])).toEqual([{ status: "ok" }, { status: "removed" }]);
    const job = await h.db.rpc("rider_job", { p_delivery: delivery });
    expect(job.stops.find((s: any) => s.kind === "dropoff").items).toBe(1);
  });

  it("the recall list names a delivered order for what it received, never for the line that stayed on the shelf", async () => {
    await h.db.rpc("rider_respond", { p_delivery: delivery, p_driver: h.riders[0], p_accept: true });
    await h.db.rpc("rider_picked_up", { p_delivery: delivery, p_driver: h.riders[0] });
    await h.db.rpc("rider_delivered", { p_order: a.orderId, p_driver: h.riders[0] });
    await collect(h, a.orderId);
    expect((await recall(WATER)).find((o) => o.order_id === a.orderId)).toMatchObject({ stage: "with_customer", qty: 3 });
    expect((await recall(COFFEE)).map((o) => o.order_id)).not.toContain(a.orderId);
  });

  it("goods that came back from a failed delivery are not with the customer: that order is off the recall list", async () => {
    const b = await placeOrder(h, [{ product_id: WATER, qty: 3 }]);
    await h.db.rpc("start_pick", { p_order: b.orderId, p_by: h.picker });
    await h.db.rpc("finish_pick", { p_order: b.orderId, p_by: h.picker });
    const d = await h.db.rpc("dispatch_order", { p_order: b.orderId });
    const del = d.delivery_id ?? (await h.db.one(`select s.delivery_id from delivery_stops s join deliveries x on x.id = s.delivery_id
                                                   where s.order_id = $1 and x.status = 'offered'`, [b.orderId])).delivery_id;
    await h.db.rpc("rider_respond", { p_delivery: del, p_driver: h.riders[0], p_accept: true });
    await h.db.rpc("rider_picked_up", { p_delivery: del, p_driver: h.riders[0] });
    expect((await recall(WATER)).find((o) => o.order_id === b.orderId)).toMatchObject({ stage: "on_the_way" });   // on the road: phone them
    await h.db.rpc("transition_order", { p_order: b.orderId, p_to: "failed_delivery", p_actor: "ops", p_actor_id: h.ops, p_reason: "nobody home" });
    await h.db.rpc("receive_return", { p_order: b.orderId, p_by: h.ops, p_restock: {} });
    expect((await h.db.one(`select status from orders where id = $1`, [b.orderId])).status).toBe("closed");
    expect((await recall(WATER)).map((o) => o.order_id)).not.toContain(b.orderId);
    expect((await recall(WATER)).map((o) => o.order_id)).toContain(a.orderId);
  });

  it("an order waiting at the hub stays on the list for the hold (C1), marked at the hub", async () => {
    const c = await placeOrder(h, [{ product_id: WATER, qty: 3 }]);
    expect((await recall(WATER)).find((o) => o.order_id === c.orderId)).toMatchObject({ stage: "at_hub" });
  });
});
