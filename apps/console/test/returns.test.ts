// 3.6 Returns: goods back from a failed delivery are counted in and the order closes, through receive_return().
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, ledgerSum, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string; let rider: string;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => {
  r = await rig(); village = await openShop(r.db);
  rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
  await r.db.rpc("start_shift", { p_driver: rider });
}, 120_000);

async function failed() {
  const o = await placeOrder(r.db, village, "cod", 8);
  const d = await r.db.rpc("dispatch_order", { p_order: o.id });
  await r.db.rpc("rider_respond", { p_delivery: d.delivery_id, p_driver: rider, p_accept: true });
  await r.db.rpc("rider_picked_up", { p_delivery: d.delivery_id, p_driver: rider });
  await r.db.rpc("rider_arrived", { p_order: o.id, p_driver: rider });
  await r.db.pg.query(`update delivery_stops set arrived_at = now() - interval '20 minutes' where order_id = $1`, [o.id]);
  await r.db.rpc("rider_no_answer", { p_order: o.id, p_driver: rider });
  return o;
}
const onHand = async (product: string) => Number((await r.db.one(`select on_hand from stock_levels where product_id = $1 and source_id = $2`, [product, r.source])).on_hand);

describe("Returns", () => {
  it("a picker counts the goods back: what is fit goes on the shelf, the rest is written off, and the order closes", async () => {
    const o = await failed();
    const picker = await r.staff("picker", "Pia");
    const b = r.browser();
    await b.signIn(picker);
    const page = (await b.get("/returns")).text;
    expect(page).toContain(o.code);
    expect(page).toContain(`name="restock_${o.product}"`);
    expect(page).toContain("come with task 2.3");
    const before = await onHand(o.product);
    const res = await b.post(`/returns/${o.id}`, { [`restock_${o.product}`]: 5 });
    expect(flashOf(res.text)).toMatch(/^Received\. 5 back on the shelf, 3 written off/);
    expect(await onHand(o.product)).toBe(before + 5);
    expect((await r.db.one(`select status from orders where id = $1`, [o.id])).status).toBe("closed");
    expect((await r.db.one(`select actor_id from stock_movements where order_id = $1 and reason = 'return'`, [o.id])).actor_id).toBe(picker.partyId);
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
    expect(flashOf((await b.post(`/returns/${o.id}`, { [`restock_${o.product}`]: 5 })).text)).toBe("Already received; nothing changed.");
    expect(await onHand(o.product)).toBe(before + 5);
  });

  it("refuses a negative count before asking the database", async () => {
    const o = await failed();
    const lead = await r.staff("ops_lead");
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/returns");
    expect(flashOf((await b.post(`/returns/${o.id}`, { [`restock_${o.product}`]: -1 })).text)).toBe("Counts must be zero or more.");
    expect((await r.db.one(`select status from orders where id = $1`, [o.id])).status).toBe("failed_delivery");
  });
});
