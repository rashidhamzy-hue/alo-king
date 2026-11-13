// 3.11 Day-close report: one SQL function, one screen, the counted drawer, and the nightly message to the founder.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dayCloseText, sendDayClose, type DayReport } from "../src/pages/dayclose";
import { deliver, flashOf, FX, ledgerSum, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string; let rider: string; let lead: { partyId: string; email: string; password: string };
let order: Awaited<ReturnType<typeof placeOrder>>;
afterAll(() => vi.unstubAllGlobals());
beforeAll(async () => {
  r = await rig(); village = await openShop(r.db);
  rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
  lead = await r.staff("ops_lead", "Maya");
  await r.db.rpc("start_shift", { p_driver: rider });
  order = await placeOrder(r.db, village, "cod", 15);
  await deliver(r.db, order.id, rider);
  await r.db.rpc("rider_collect", { p_order: order.id, p_driver: rider, p_usd: Math.round((order.total - 1) * 100) / 100, p_lbp: FX });
  await r.db.rpc("pay_rider_earnings", { p_driver: rider, p_by: lead.partyId });
  const n = await r.db.one(`select * from driver_cash_native($1)`, [rider]);
  const drop = await r.db.rpc("declare_cash_drop", { p_driver: rider, p_method: "hub", p_usd: Number(n.usd), p_lbp: Number(n.lbp) });
  await r.db.rpc("confirm_cash_drop", { p_drop: drop, p_by: lead.partyId });
  await r.db.rpc("record_petty_cash", { p_usd: 1, p_lbp: 0, p_reason: "bin bags", p_name: "Pia", p_by: lead.partyId });
  await r.db.rpc("refund_order", { p_order: order.id, p_by: lead.partyId, p_amount_usd: 0.5, p_charged_to: "goods", p_reason: "damaged" });
}, 120_000);

describe("Day close", () => {
  it("reports the day from the database, with an unexplained balance of zero, and closes when the drawer matches", async () => {
    const rep = await r.db.rpc<DayReport>("day_close_report", {});
    const o = await r.db.one(`select subtotal_usd, delivery_fee_usd from orders where id = $1`, [order.id]);
    expect(rep.orders).toEqual({ closed: 1 });
    expect(Number(rep.sales.goods_usd)).toBeCloseTo(Number(o.subtotal_usd) - 0.5, 2);     // the refund reversed half a dollar of goods
    expect(Number(rep.sales.delivery_fees_usd)).toBe(0);                                  // the fee moved to the rider when the order closed
    expect(Number(rep.rider_earnings_settled_usd)).toBeCloseTo(Number(o.delivery_fee_usd), 2);
    expect(rep.payments.cod).toMatchObject({ count: 1 });
    expect(Number(rep.credits.refunded_usd)).toBe(0.5);
    expect(Number(rep.drawer.petty_cash_usd)).toBe(1);
    expect(Number(rep.drawer.lbp)).toBe(FX);
    expect(rep.stock.mismatches).toEqual([]);
    expect(Number(rep.stock.picked_units)).toBe(Number(rep.stock.sold_units));
    expect(Number(rep.unexplained_usd)).toBe(0);
    expect(rep.balanced).toBe(true);
    expect(rep.count).toBeNull();

    const b = r.browser();
    await b.signIn(lead);
    let page = (await b.get("/day-close")).text;
    expect(page).toContain("Unexplained balance: $0.00.");
    expect(page).toContain("Rami");
    const book = Number(rep.drawer.usd);
    expect(flashOf((await b.post("/day-close", { day: rep.day, counted_usd: book.toFixed(2), counted_lbp: FX })).text)).toBe("Day closed. The drawer matches the books.");
    page = (await b.get("/day-close")).text;
    expect(page).toContain("No difference.");
    expect(flashOf((await b.post("/day-close", { day: rep.day, counted_usd: 0, counted_lbp: 0 })).text)).toBe("This day was already closed; the first count stands.");
    expect((await r.db.one(`select closed_by from day_closes where day = $1`, [rep.day])).closed_by).toBe(lead.partyId);
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
  });

  it("a short drawer needs a note, is posted, and leaves the day unexplained; the founder gets it once on the ops line", async () => {
    await r.db.pg.exec(`delete from day_closes`);
    const book = Number((await r.db.one(`select usd from account_native('hub_cash')`)).usd);
    const b = r.browser();
    await b.signIn(lead);
    const day = (await r.db.one(`select hub_today()::text as d`)).d as string;
    await b.get("/day-close");
    expect(flashOf((await b.post("/day-close", { day, counted_usd: (book - 2).toFixed(2), counted_lbp: FX })).text)).toBe("The count differs from the books: write a note saying what you know.");
    expect(flashOf((await b.post("/day-close", { day, counted_usd: (book - 2).toFixed(2), counted_lbp: FX, note: "short by two, counted twice" })).text))
      .toBe("Day closed with a difference of $-2.00 and 0 LBP, recorded with your note.");
    expect(Number((await r.db.one(`select usd from account_native('hub_cash')`)).usd)).toBeCloseTo(book - 2, 2);   // the books now match the drawer
    const rep = await r.db.rpc<DayReport>("day_close_report", {});
    expect(Number(rep.unexplained_usd)).toBe(-2);
    expect(rep.balanced).toBe(false);
    expect((await b.get("/day-close")).text).toContain("short by two, counted twice");
    expect(dayCloseText(rep)).toContain("UNEXPLAINED: $-2.00");
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
    await expect(r.db.rpc("close_day", { p_day: "2999-01-01", p_counted_usd: 0, p_counted_lbp: 0, p_by: lead.partyId })).rejects.toThrow(/DAY_NOT_OVER/);

    // The founder: an admin on the ops line with an open window gets it once; one whose window is closed is refused by the gateway.
    const founder = await r.staff("admin", "Rasheed");
    await r.db.pg.query(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ($1, 'ops', 'bsuid-rasheed', '+96170999000')`, [founder.partyId]);
    await r.db.pg.query(`insert into conversations(line, party_id, last_inbound_at) values ('ops', $1, now())`, [founder.partyId]);
    const away = await r.staff("admin", "Away");
    await r.db.pg.query(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ($1, 'ops', 'bsuid-away', '+96170999001')`, [away.partyId]);
    await r.db.pg.query(`insert into conversations(line, party_id, last_inbound_at) values ('ops', $1, now() - interval '3 days')`, [away.partyId]);
    const out = await sendDayClose(r.deps);
    expect(out.find((o) => o.party === founder.partyId)!.result.ok).toBe(true);
    expect(out.find((o) => o.party === away.partyId)!.result.ok).toBe(false);
    await sendDayClose(r.deps);
    const sent = r.kapso.filter((k) => k.url.includes("PN_OPS"));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.text.body).toMatch(/^Alo King day close \d{4}-\d{2}-\d{2}\nOrders: closed 1/);
    expect(r.kapso.some((k) => k.url.includes("PN_CUSTOMER"))).toBe(false);
    const picker = await r.staff("picker");
    await expect(r.db.rpc("close_day", { p_day: day, p_counted_usd: 0, p_counted_lbp: 0, p_by: picker.partyId })).rejects.toThrow(/NOT_AUTHORISED/);
  });
});
