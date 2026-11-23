// TEST1 (staging's friends' test): a test order is marked on the Orders page and on its own page; "Clear test orders" is for leads, needs a
// reason, touches test orders only, logs who and why, and takes them off the list. A picker cannot reach it.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { r = await rig(); village = await openShop(r.db); }, 120_000);

describe("test orders on the console", () => {
  it("are marked, cleared by a lead with a reason (test orders only, logged), and leave the list", async () => {
    const real = await placeOrder(r.db, village);
    const test = await placeOrder(r.db, village);
    await r.db.pg.query(`update orders set is_test = true where id = $1`, [test.id]);
    const lead = await r.staff("ops_lead", "Maya"); const br = r.browser(); await br.signIn(lead);
    const list = (await br.get("/orders")).text;
    expect(list).toContain("🧪 Test: no delivery, no payment");
    expect(list).toContain("Clear test orders");
    expect((await br.get(`/orders/${test.id}`)).text).toContain("🧪 Test");
    expect((await br.get(`/orders/${real.id}`)).text).not.toContain("🧪 Test");
    expect(flashOf((await br.post("/orders/clear-tests", { reason: "" })).text)).toBe("Write why you clear them.");
    // This rig's order was confirmed (stock reserved) before it was marked as a test order by hand: the clear says so, never hides it.
    const said = flashOf((await br.post("/orders/clear-tests", { reason: "first round done" })).text);
    expect(said).toContain("Cleared 1 test order(s).");
    expect(said).toContain("Warning: 1 stock or money row(s) belong to test orders");
    const after = (await br.get("/orders")).text;
    expect(after).not.toContain(`href="/orders/${test.id}"`);
    expect(after).toContain(`href="/orders/${real.id}"`);
    expect(after).not.toContain("Clear test orders");
    expect((await r.db.one(`select test_cleared_at is not null c from orders where id = $1`, [real.id])).c).toBe(false);
    expect(await r.db.one(`select action, reason, by_party from test_mode_log order by id desc limit 1`))
      .toEqual({ action: "clear_test_orders", reason: "first round done", by_party: lead.partyId });
    // the page still opens by its address, marked as cleared
    expect((await br.get(`/orders/${test.id}`)).text).toContain("cleared");
  });
  it("is not open to a picker", async () => {
    const p = await r.staff("picker", "Sami"); const br = r.browser(); await br.signIn(p);
    expect((await br.post("/orders/clear-tests", { reason: "try" }, { follow: false })).status).toBe(403);
  });
});
