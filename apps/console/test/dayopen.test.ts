// 3.17 Day-open checklist: one SQL function, one screen.
import { afterAll, describe, expect, it, vi } from "vitest";
import type { DayOpen } from "../src/pages/dayopen";
import { deliver, openShop, placeOrder, rig } from "./kit";

afterAll(() => vi.unstubAllGlobals());

describe("Day open", () => {
  it("lists what is left from yesterday and what needs a person this morning", async () => {
    const r = await rig();
    const village = await openShop(r.db);
    const lead = await r.staff("ops_lead", "Maya");
    const rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
    await r.db.rpc("start_shift", { p_driver: rider });

    let d = await r.db.rpc<DayOpen>("day_open_checklist");
    expect(d.orders_waiting).toEqual([]);
    expect(d.last_cron_at).toBeNull();

    const old = await placeOrder(r.db, village, "cod", 10);
    await deliver(r.db, old.id, rider);                                  // delivered, never paid: not closed
    await r.db.pg.query(`update orders set created_at = (select since from hub_day_bounds(hub_today())) - interval '2 hours' where id = $1`, [old.id]);
    const paid = await placeOrder(r.db, village, "cod", 10);
    await deliver(r.db, paid.id, rider);
    await r.db.rpc("rider_collect", { p_order: paid.id, p_driver: rider, p_usd: paid.total, p_lbp: 0 });   // Rami holds cash and is owed his fee
    const waiting = await placeOrder(r.db, village, "cod", 10);
    await r.db.rpc("declare_cash_drop", { p_driver: rider, p_method: "hub", p_usd: 5, p_lbp: 0 });
    const supplier = await r.db.rpc("create_supplier", { p_name: "Leen Dairy", p_by: lead.partyId });
    await r.db.rpc("receive_goods", { p_supplier: supplier, p_source: r.source, p_by: lead.partyId, p_supplier_ref: "INV-1",
      p_lines: [{ product_id: old.product, qty: 6, unit_cost_usd: 0.5, expiry_date: new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10), lot: "L9" }] });
    await r.db.rpc("open_complaint", { p_order: old.id, p_kind: "missing", p_detail: "one labneh missing", p_by: lead.partyId });
    await r.db.rpc("cron_beat");

    d = await r.db.rpc<DayOpen>("day_open_checklist");
    expect(d.not_closed_from_before_today).toEqual([expect.objectContaining({ order: old.code, status: "delivered" })]);
    expect(d.orders_waiting.map((o) => o.order)).toEqual([waiting.code]);
    expect(d.drops_not_counted).toEqual([expect.objectContaining({ rider: "Rami" })]);
    expect(d.expiring_in_3_days).toEqual([expect.objectContaining({ product: "Leen Taanayel Labneh Premium", lot: "L9" })]);
    expect(d.open_cases).toEqual([expect.objectContaining({ order: old.code, kind: "missing" })]);
    expect(d.riders).toEqual([expect.objectContaining({ rider: "Rami", usd: paid.total })]);
    expect(d.yesterday_closed).toBe(false);
    expect(d.last_cron_at).not.toBeNull();

    const picker = await r.staff("picker", "Pia");
    const b = r.browser();
    await b.signIn(picker);
    const page = (await b.get("/day-open")).text;
    expect(page).toContain(`${old.code} (delivered)`);
    expect(page).toContain("Leen Taanayel Labneh Premium");
    expect(page).toContain("(lot L9)");
    expect(page).toMatch(/Last cron heartbeat<\/td><td>[^<]+\(0 min ago\)/);
  });
});
