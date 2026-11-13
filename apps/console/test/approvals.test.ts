// 3.13 Second approval: a big price change and a big refund wait for a second person; the asker cannot approve their own.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deliver, flashOf, ledgerSum, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string; let rider: string;
let maya: { partyId: string; email: string; password: string }; let rasheed: { partyId: string; email: string; password: string };
afterAll(() => vi.unstubAllGlobals());
beforeAll(async () => {
  r = await rig(); village = await openShop(r.db);
  rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
  await r.db.rpc("start_shift", { p_driver: rider });
  maya = await r.staff("ops_lead", "Maya");
  rasheed = await r.staff("admin", "Rasheed");
}, 120_000);

describe("Second approval", () => {
  it("a price change above the limit waits; the asker cannot approve it; another lead does, in the asker's name", async () => {
    const p = (await r.db.one(`select id from products where name_en = 'Leen Taanayel Labneh Premium'`)).id;
    const old = Number((await r.db.one(`select price_usd from offers where product_id = $1 and source_id = $2`, [p, r.source])).price_usd);
    const big = Math.round(old * 1.5 * 100) / 100;
    const m = r.browser();
    await m.signIn(maya);
    await m.get(`/catalog/${p}`);
    let res = await m.post(`/catalog/${p}/offer`, { price_usd: big.toFixed(2), available: 1, reason: "new supplier list" });
    expect(flashOf(res.text)).toMatch(/^Waiting for a second approval: \$[\d.]+ moves 5\d(\.\d+)?% from \$/);
    expect(Number((await r.db.one(`select price_usd from offers where product_id = $1 and source_id = $2`, [p, r.source])).price_usd)).toBe(old);
    // Sent twice, it is one request.
    await m.post(`/catalog/${p}/offer`, { price_usd: big.toFixed(2), available: 1, reason: "new supplier list" });
    const pend = await r.db.all(`select id from pending_approvals where status = 'pending'`);
    expect(pend).toHaveLength(1);
    res = await m.get("/approvals");
    expect(res.text).toContain("waiting for someone else");
    expect(flashOf((await m.post(`/approvals/${pend[0].id}/approve`)).text)).toBe("You asked for this change: a second person must approve it.");

    const a = r.browser();
    await a.signIn(rasheed);
    expect((await a.get("/approvals")).text).toContain("Leen Taanayel Labneh Premium");
    expect(flashOf((await a.post(`/approvals/${pend[0].id}/approve`)).text)).toBe("Approved: the change is made.");
    expect(Number((await r.db.one(`select price_usd from offers where product_id = $1 and source_id = $2`, [p, r.source])).price_usd)).toBe(big);
    expect(await r.db.one(`select changed_by, reason from config_changes where kind = 'offer' and ref = $1 order by created_at desc limit 1`, [p]))
      .toEqual({ changed_by: maya.partyId, reason: "new supplier list (approved by Rasheed)" });
    expect(await r.db.one(`select status, decided_by from pending_approvals where id = $1`, [pend[0].id])).toEqual({ status: "approved", decided_by: rasheed.partyId });
    expect(flashOf((await a.post(`/approvals/${pend[0].id}/approve`)).text)).toBe("Already approved.");
  });

  it("a refund above the limit is checked now, waits, and is paid once approved; a rejected one moves no money", async () => {
    const o = await placeOrder(r.db, village, "cod", 40);
    await deliver(r.db, o.id, rider);
    await r.db.rpc("rider_collect", { p_order: o.id, p_driver: rider, p_usd: o.total, p_lbp: 0 });
    expect(o.total).toBeGreaterThan(25);
    const m = r.browser();
    await m.signIn(maya);
    await m.get(`/refunds?order=${o.code}`);
    // Impossible refunds are refused at once, not after someone approves them.
    expect(flashOf((await m.post(`/refunds/${o.id}`, { amount_usd: "500", charged_to: "goods", reason: "damaged", settle: "credit" })).text))
      .toBe("That is more than was paid on this order, counting earlier refunds.");
    expect(flashOf((await m.post(`/refunds/${o.id}`, { amount_usd: "25", charged_to: "goods", reason: "damaged", settle: "omt" })).text))
      .toBe("Type the transfer reference (at least 4 characters).");
    const key = "big-refund-key-1";
    let res = await m.post(`/refunds/${o.id}`, { amount_usd: "25", charged_to: "goods", reason: "damaged", settle: "cash", _key: key });
    expect(flashOf(res.text)).toBe("Waiting for a second approval: $25.00 is above the refund limit. Another ops lead or admin approves it under Approvals.");
    res = await m.post(`/refunds/${o.id}`, { amount_usd: "25", charged_to: "goods", reason: "damaged", settle: "cash", _key: key });
    expect(flashOf(res.text)).toBe("That refund is already waiting for a second approval.");
    expect(Number((await r.db.one(`select count(*) as n from refunds where order_id = $1`, [o.id])).n)).toBe(0);
    res = await m.post(`/refunds/${o.id}`, { amount_usd: "21", charged_to: "goodwill", reason: "late", settle: "credit" });
    const [first, second] = await r.db.all(`select id from pending_approvals where kind = 'refund' order by requested_at`);

    const a = r.browser();
    await a.signIn(rasheed);
    await a.get("/approvals");
    expect(flashOf((await a.post(`/approvals/${first.id}/approve`)).text)).toBe("Approved: the change is made.");
    const ref = await r.db.one(`select amount_usd, settle, by_party, request_key from refunds where order_id = $1`, [o.id]);
    expect(ref).toEqual({ amount_usd: "25.00", settle: "cash", by_party: maya.partyId, request_key: `console:${key}` });
    expect(flashOf((await a.post(`/approvals/${second.id}/reject`, { note: "late by five minutes only" })).text)).toBe("Rejected: nothing changes.");
    expect(Number((await r.db.one(`select count(*) as n from refunds where order_id = $1`, [o.id])).n)).toBe(1);
    expect((await a.get("/approvals")).text).toContain("rejected: late by five minutes only");
    // Below the limit, nothing waits.
    expect(flashOf((await m.post(`/refunds/${o.id}`, { amount_usd: "1", charged_to: "goodwill", reason: "late", settle: "credit" })).text)).toMatch(/^Refunded \$1\.00 as credit/);
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
    const picker = await r.staff("picker");
    await expect(r.db.rpc("decide_approval", { p_id: second.id, p_by: picker.partyId, p_approve: true })).rejects.toThrow(/NOT_AUTHORISED/);
  });
});
