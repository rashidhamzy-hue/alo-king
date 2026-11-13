// 3.4 Cash drops and rider payouts, and the end-of-shift message through the gateway on the ops line.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { statementText } from "../src/pages/riders";
import { deliver, flashOf, ledgerSum, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string; let rider: string;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => {
  r = await rig(); village = await openShop(r.db);
  rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
  await r.db.pg.query(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ($1, 'ops', 'bsuid-rami', '+96170111222')`, [rider]);
  await r.db.pg.query(`insert into conversations(line, party_id, last_inbound_at) values ('ops', $1, now())`, [rider]);
  await r.db.rpc("start_shift", { p_driver: rider });
}, 120_000);

describe("Cash and riders", () => {
  it("confirms a counted drop, pays the rider's fees, sends the same figures on WhatsApp once, then ends the shift", async () => {
    const o = await placeOrder(r.db, village);
    await deliver(r.db, o.id, rider);
    await r.db.rpc("rider_collect", { p_order: o.id, p_driver: rider, p_usd: o.total, p_lbp: 0 });
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);

    let page = (await b.get("/riders")).text;
    expect(page).toContain("Rami");
    expect(page).toContain(`$${o.fee.toFixed(2)}`);                     // the rider's earnings: the delivery fee

    const tooMuch = await r.db.rpc("declare_cash_drop", { p_driver: rider, p_method: "hub", p_usd: o.total + 50, p_lbp: 0 });
    await b.get("/riders");
    expect(flashOf((await b.post(`/riders/drop/${tooMuch}`)).text)).toContain("more than the rider holds");

    const end1 = await b.post(`/riders/${rider}/end-shift`);
    expect(flashOf(end1.text)).toBe("Shift not ended. The rider still holds cash: confirm the drop first.");

    const paid = await b.post(`/riders/${rider}/pay`);
    expect(flashOf(paid.text)).toContain(`Kept from cash: $${o.fee.toFixed(2)}`);
    expect(Number((await r.db.rpc("rider_statement", { p_driver: rider })).earnings_usd)).toBe(0);

    const hand = Number((await r.db.rpc("rider_statement", { p_driver: rider })).cash_held_usd);
    const drop = await r.db.rpc("declare_cash_drop", { p_driver: rider, p_method: "hub", p_usd: hand, p_lbp: 0 });
    // The database checks who is acting (0046): a picker, a rider or an unknown party cannot confirm a drop, whatever calls it.
    const picker = await r.staff("picker");
    for (const who of [picker.partyId, rider, crypto.randomUUID()]) {
      await expect(r.db.rpc("confirm_cash_drop", { p_drop: drop, p_by: who })).rejects.toThrow(/NOT_AUTHORISED/);
    }
    expect((await r.db.one(`select status from cash_drops where id = $1`, [drop])).status).toBe("declared");
    page = (await b.get("/riders")).text;
    expect(page).toContain(`$${hand.toFixed(2)} + 0 LBP`);
    const ok = await b.post(`/riders/drop/${drop}`);
    expect(flashOf(ok.text)).toBe("Drop confirmed. The rider still holds $0.00 in value.");
    expect((await r.db.one(`select status, confirmed_by from cash_drops where id = $1`, [drop]))).toMatchObject({ status: "confirmed", confirmed_by: lead.partyId });
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);

    const sent = await b.post(`/riders/${rider}/statement`);
    expect(flashOf(sent.text)).toBe("Statement sent to the rider.");
    const msgs = r.kapso.filter((k) => k.url.includes("PN_OPS"));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.body.to).toBe("+96170111222");
    expect(msgs[0]!.body.text.body).toBe(statementText({ usd: 0, lbp: 0, earnings: 0, handOver: 0 }));
    expect(flashOf((await b.post(`/riders/${rider}/statement`)).text)).toContain("already sent");
    expect(r.kapso.filter((k) => k.url.includes("PN_OPS"))).toHaveLength(1);
    expect(r.kapso.some((k) => k.url.includes("PN_CUSTOMER"))).toBe(false);   // staff are never messaged from the customer number

    expect(flashOf((await b.post(`/riders/${rider}/end-shift`)).text)).toBe("Shift ended.");
  });

  it("does not send when the rider's 24-hour window is closed: the gateway refuses and the page says so", async () => {
    const other = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Sami') returning id`)).id;
    await r.db.pg.query(`insert into party_identities(party_id, line, wa_user_id) values ($1, 'ops', 'bsuid-sami')`, [other]);
    await r.db.pg.query(`insert into conversations(line, party_id, last_inbound_at) values ('ops', $1, now() - interval '3 days')`, [other]);
    await r.db.rpc("start_shift", { p_driver: other });
    const lead = await r.staff("admin");
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/riders");
    const before = r.kapso.length;
    const res = await b.post(`/riders/${other}/statement`);
    expect(flashOf(res.text)).toMatch(/^Not sent: /);
    expect(r.kapso.length).toBe(before);
  });

  it("is closed to pickers", async () => {
    const picker = await r.staff("picker");
    const b = r.browser();
    await b.signIn(picker);
    expect((await b.get("/riders")).status).toBe(403);
  });
});
