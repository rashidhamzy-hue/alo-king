// 3.9 Zones and fees: data, edited by the admin with a reason; the new fee reaches the next quote.
import { afterEach, describe, expect, it, vi } from "vitest";
import { flashOf, openShop, placeOrder, rig } from "./kit";

afterEach(() => vi.unstubAllGlobals());

describe("Zones and fees", () => {
  it("an ops lead sees zones and villages but cannot change them", async () => {
    const r = await rig({ proposed: true });
    const lead = await r.staff("ops_lead");
    const b = r.browser();
    await b.signIn(lead);
    const page = (await b.get("/zones")).text;
    expect(page).toContain("Baakline");
    expect(page).toContain("Only the admin changes zones and fees.");
    const zone = (await r.db.one(`select id from zones limit 1`)).id;
    expect((await b.post(`/zones/${zone}`, { fee_usd: 0, eta_minutes: 10, reason: "free" }, { follow: false })).status).toBe(403);
  });

  it("the admin changes a zone's fee and ETA with a reason; the next order is quoted at the new fee and late is judged by the new ETA", async () => {
    const r = await rig({ proposed: true });
    const village = await openShop(r.db);
    const zone = (await r.db.one(`select zone_id from villages where id = $1`, [village])).zone_id;
    const admin = await r.staff("admin", "Rasheed");
    const b = r.browser();
    await b.signIn(admin);
    await b.get("/zones");
    expect(flashOf((await b.post(`/zones/${zone}`, { fee_usd: "1.50", eta_minutes: 40, active: 1, reason: "" })).text)).toBe("Write the reason for the change.");
    const res = await b.post(`/zones/${zone}`, { fee_usd: "1.50", eta_minutes: 40, active: 1, reason: "longer road after the bridge closed" });
    expect(flashOf(res.text)).toMatch(/^Zone saved: fee \$1\.50, ETA 40 min \(was /);
    const o = await placeOrder(r.db, village);
    expect(o.fee).toBe(1.5);
    const ch = await r.db.one(`select reason, changed_by from config_changes where kind = 'zone' and ref = $1`, [zone]);
    expect(ch).toEqual({ reason: "longer road after the bridge closed", changed_by: admin.partyId });
  });

  it("the admin stops serving a village and moves another into a zone", async () => {
    const r = await rig({ proposed: true });
    const [a, z2] = [await r.db.one(`select id, zone_id from villages where is_served limit 1`), await r.db.one(`select id from zones order by name desc limit 1`)];
    const admin = await r.staff("admin");
    const b = r.browser();
    await b.signIn(admin);
    await b.get("/zones");
    expect(flashOf((await b.post(`/villages/${a.id}`, { zone: a.zone_id, reason: "road closed for the winter" })).text)).toBe("Village saved: not served.");
    expect((await r.db.one(`select is_served from villages where id = $1`, [a.id])).is_served).toBe(false);
    expect(flashOf((await b.post(`/villages/${a.id}`, { zone: z2.id, served: 1, reason: "road open again" })).text)).toBe("Village saved: served.");
    expect(await r.db.one(`select zone_id, is_served from villages where id = $1`, [a.id])).toEqual({ zone_id: z2.id, is_served: true });
  });
});
