// G1-01 (session F1): a rider who records less cash than the total. Within settings.over_short.cod_tolerance_usd (lira-note
// rounding, default 0.25) the difference is the company's (cash_over_short). Beyond it and up to cod_max_usd (1.00) the shortfall
// is owed by the rider (rider_receivable:<driver>) and flagged. Above that the collection is refused, as before.
// The day close shows over/short per rider.
import { beforeAll, describe, expect, it } from "vitest";
import { balance, deliverToDoor, expectBooksBalanced, openHub, placeOrder, total, type Hub } from "./hub-kit";

let h: Hub; let WATER: string; let rider: string;
beforeAll(async () => {
  h = await openHub({ pickerOnOps: false });
  WATER = await h.product("Tannourine Mineral Water 2L X6");
  rider = h.riders[0]!;
}, 120_000);

async function deliveredOrder() {
  const o = await placeOrder(h, [{ product_id: WATER, qty: 3 }]);
  await deliverToDoor(h, o.orderId, rider);
  return { ...o, total: await total(h, o.orderId) };
}
const collect = (orderId: string, usd: number, lbp = 0) =>
  h.db.rpc("rider_collect", { p_order: orderId, p_driver: rider, p_usd: Number(usd.toFixed(2)), p_lbp: lbp });
const flags = async (rule: string) => Number((await h.db.one(
  `select count(*) as n from risk_flags where subject_kind = 'driver' and subject_id = $1 and rule = $2`, [rider, rule])).n);

describe("cash on delivery over and short (G1-01)", () => {
  it("the tolerance is a setting, 0.25 by default, beside the existing write-off limit", async () => {
    const s = (await h.db.one(`select value from settings where key = 'over_short'`)).value;
    expect(s).toMatchObject({ cod_tolerance_usd: 0.25, cod_max_usd: 1, auto_writeoff_usd: 1 });
  });

  it("within the tolerance the difference is rounding, booked to cash_over_short with no flag", async () => {
    const o = await deliveredOrder();
    const before = await balance(h, "cash_over_short");
    await collect(o.orderId, o.total - 0.2);
    expect(await balance(h, "cash_over_short")).toBeCloseTo(before + 0.2, 2);
    expect(await balance(h, `rider_receivable:${rider}`)).toBeCloseTo(0, 2);
    expect(await flags("cod_short")).toBe(0);
    expect(Number((await h.db.one(`select over_short_usd from payments where order_id = $1`, [o.orderId])).over_short_usd)).toBeCloseTo(-0.2, 2);
    await expectBooksBalanced(h);
  });

  it("beyond the tolerance and up to a dollar, the whole shortfall is owed by the rider and flagged", async () => {
    const o = await deliveredOrder();
    const before = await balance(h, "cash_over_short");
    await collect(o.orderId, o.total - 0.6);
    expect(await balance(h, "cash_over_short")).toBeCloseTo(before, 2);
    expect(await balance(h, `rider_receivable:${rider}`)).toBeCloseTo(0.6, 2);
    expect(await flags("cod_short")).toBe(1);
    const f = await h.db.one(`select severity, details from risk_flags where subject_id = $1 and rule = 'cod_short'`, [rider]);
    expect(f.severity).toBe(2);
    expect(f.details).toMatchObject({ order_id: o.orderId, short_usd: 0.6 });
    await expectBooksBalanced(h);
  });

  it("more than a dollar short is refused, as before, and nothing is booked", async () => {
    const o = await deliveredOrder();
    const n = Number((await h.db.one(`select count(*) as n from ledger_entries`)).n);
    await expect(collect(o.orderId, o.total - 1.5)).rejects.toThrow(/AMOUNT_MISMATCH/);
    expect(Number((await h.db.one(`select count(*) as n from ledger_entries`)).n)).toBe(n);
    await collect(o.orderId, o.total);
  });

  it("more cash than the total beyond the tolerance is kept on cash_over_short and flagged for the day close", async () => {
    const o = await deliveredOrder();
    const before = await balance(h, "cash_over_short");
    await collect(o.orderId, o.total + 0.5);
    expect(await balance(h, "cash_over_short")).toBeCloseTo(before - 0.5, 2);
    expect(await flags("cod_over")).toBe(1);
    await expectBooksBalanced(h);
  });

  it("a lower tolerance in settings moves a smaller shortfall to the rider", async () => {
    await h.db.pg.exec(`update settings set value = value || '{"cod_tolerance_usd": 0.10}' where key = 'over_short'`);
    const o = await deliveredOrder();
    const owed = await balance(h, `rider_receivable:${rider}`);
    await collect(o.orderId, o.total - 0.2);
    expect(await balance(h, `rider_receivable:${rider}`)).toBeCloseTo(owed + 0.2, 2);
    await h.db.pg.exec(`update settings set value = value || '{"cod_tolerance_usd": 0.25}' where key = 'over_short'`);
    await expectBooksBalanced(h);
  });

  it("the day close shows over and short per rider, and what the rider owes for it", async () => {
    const rep = await h.db.rpc("day_close_report", {});
    const r = rep.riders.find((x: { rider: string }) => x.rider === "Rider1");
    // -0.20, -0.60, 0 (the refused one was then collected in full), +0.50, -0.20
    expect(Number(r.over_short_usd)).toBeCloseTo(-0.5, 2);
    expect(Number(r.short_owed_usd)).toBeCloseTo(0.8, 2);
    expect(Number(r.cod_flags)).toBe(3);
    expect(Number(rep.unexplained_usd)).toBeCloseTo(0, 2);
    await expectBooksBalanced(h);
  });
});
