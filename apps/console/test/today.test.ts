// 3.2 Today: orders by status, late first (against the zone's ETA from the database); riders on shift with cash and exposure.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { beirutMidnight } from "../src/pages/today";
import { deliver, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { r = await rig(); village = await openShop(r.db); }, 120_000);

describe("Today", () => {
  it("lists open orders with the late one first, measured against its zone's ETA, and riders with cash per currency", async () => {
    const rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
    await r.db.rpc("start_shift", { p_driver: rider });
    const cod = await placeOrder(r.db, village);
    await deliver(r.db, cod.id, rider);
    await r.db.rpc("rider_collect", { p_order: cod.id, p_driver: rider, p_usd: Math.round((cod.total - 2) * 100) / 100, p_lbp: 2 * 89500 });

    const onTime = await placeOrder(r.db, village);
    const late = await placeOrder(r.db, village);
    const eta = Number((await r.db.one(`select z.base_eta_minutes as m from villages v join zones z on z.id = v.zone_id where v.id = $1`, [village])).m);
    await r.db.pg.query(`update orders set confirmed_at = now() - make_interval(mins => $2::int), created_at = now() - make_interval(mins => $2::int) where id = $1`, [late.id, eta + 25]);


    const picker = await r.staff("picker", "Pia");
    const b = r.browser();
    await b.signIn(picker);
    const page = (await b.get("/")).text;
    const iLate = page.indexOf(late.code), iOn = page.indexOf(onTime.code);
    expect(iLate).toBeGreaterThan(0);
    expect(iLate).toBeLessThan(iOn);
    expect(page).toMatch(new RegExp(`${late.code}[\\s\\S]*?\\(2[5-6] late\\)`));
    expect(page).toContain("1 late");
    expect(page).toContain("no rider yet");
    expect(page).toContain("Rami");
    expect(page).toContain(`$${(cod.total - 2).toFixed(2)} + 179,000 LBP`);
    expect(page).toContain("closed: 1");                 // the cash order closed when the rider recorded the cash
  });

  it("works out Beirut midnight across the DST change", () => {
    expect(beirutMidnight(new Date("2026-07-01T10:30:00Z")).toISOString()).toBe("2026-06-30T21:00:00.000Z");
    expect(beirutMidnight(new Date("2026-12-01T10:30:00Z")).toISOString()).toBe("2026-11-30T22:00:00.000Z");
  });
});
