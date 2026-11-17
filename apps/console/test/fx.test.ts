// 3.8 Daily exchange rate: the morning rate is set as typed; a move above the setting within the day pauses quoting until confirmed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { flashOf, rig } from "./kit";

afterEach(() => vi.unstubAllGlobals());

describe("Exchange rate", () => {
  it("without set_fx_rate() in the database the page shows the rate and says the form is not available yet", async () => {
    const r = await rig({ without: ["set_fx_rate"] });
    await r.db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500)`);
    const lead = await r.staff("ops_lead");
    const b = r.browser();
    await b.signIn(lead);
    const page = (await b.get("/fx")).text;
    expect(page).toContain("89,500 LBP");
    expect(page).toContain("needs set_fx_rate()");
  });

  it("CFG1: a change to the rate waits for a second person; the asker cannot approve it; another lead does", async () => {
    const r = await rig();
    await r.db.pg.exec(`insert into fx_rates(lbp_per_usd, effective_from) values (89000, now() - interval '2 days')`);
    const lead = await r.staff("ops_lead", "Maya");
    const admin = await r.staff("admin", "Rasheed");
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/fx");
    expect(flashOf((await b.post("/fx", { lbp_per_usd: 90000 })).text)).toBe(
      "Waiting for a second person: 90,000 LBP per dollar takes effect when another ops lead or an admin approves it under Approvals.");
    expect(Number(await r.db.rpc("current_fx"))).toBe(89000);
    const pend = (await r.db.all(`select id from pending_approvals where kind = 'fx' and status = 'pending'`));
    expect(pend).toHaveLength(1);
    const page = (await b.get("/approvals")).text;
    expect(page).toContain("Exchange rate: 89,000 to 90,000 LBP per USD");
    expect(page).toContain("any change to the LBP rate");
    expect(page).toContain("waiting for someone else");
    expect(flashOf((await b.post(`/approvals/${pend[0].id}/approve`)).text)).toBe("You asked for this change: a second person must approve it.");
    const a = r.browser();
    await a.signIn(admin);
    await a.get("/approvals");
    expect(flashOf((await a.post(`/approvals/${pend[0].id}/approve`)).text)).toBe("Approved: the change is made.");
    expect(Number(await r.db.rpc("current_fx"))).toBe(90000);
    expect((await r.db.one(`select set_by from fx_rates order by effective_from desc limit 1`)).set_by).toBe(lead.partyId);
  });

  it("morning rate, a small move, a big move that pauses quoting, then the confirmation", async () => {
    const r = await rig();
    // The 3% hold of 0045 sits behind CFG1's second-person rule; off here to test the hold itself.
    await r.db.pg.exec(`update settings set value = value || '{"fx_rate_second_person": false}' where key = 'approvals'`);
    await r.db.pg.exec(`insert into fx_rates(lbp_per_usd, effective_from) values (89000, now() - interval '2 days')`);
    const lead = await r.staff("ops_lead", "Maya");
    const admin = await r.staff("admin", "Rasheed");
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/fx");
    // The first rate of the day is set as typed, even far from yesterday's.
    expect(flashOf((await b.post("/fx", { lbp_per_usd: 95000 })).text)).toBe("Rate set: 95,000 LBP per dollar.");
    expect(Number(await r.db.rpc("current_fx"))).toBe(95000);
    // Within 3% of the morning rate: set.
    expect(flashOf((await b.post("/fx", { lbp_per_usd: 96500 })).text)).toBe("Rate set: 96,500 LBP per dollar.");
    // More than 3% from the morning rate: held, quoting paused, the rate in force unchanged.
    const held = await b.post("/fx", { lbp_per_usd: 99000 });
    expect(flashOf(held.text)).toBe("Held: 99,000 LBP moves 4.21% from this morning's rate. Quoting is paused until it is confirmed.");
    expect(held.text).toContain("Quoting is paused.");
    expect(await r.db.rpc("fx_quoting_paused")).toBe(true);
    expect(Number(await r.db.rpc("current_fx"))).toBe(96500);

    const pending = (await r.db.one(`select id from fx_pending where status = 'pending'`)).id;
    const b2 = r.browser();
    await b2.signIn(admin);
    await b2.get("/fx");
    expect(flashOf((await b2.post(`/fx/confirm/${pending}`)).text)).toBe("Confirmed. Quoting runs again at the new rate.");
    expect(await r.db.rpc("fx_quoting_paused")).toBe(false);
    expect(Number(await r.db.rpc("current_fx"))).toBe(99000);
    expect((await r.db.one(`select set_by from fx_rates order by effective_from desc limit 1`)).set_by).toBe(admin.partyId);
    expect(flashOf((await b2.post(`/fx/confirm/${pending}`)).text)).toBe("Already confirmed.");
  });

  it("is closed to pickers, by the page and by the database", async () => {
    const r = await rig();
    const picker = await r.staff("picker");
    const b = r.browser();
    await b.signIn(picker);
    expect((await b.get("/fx")).status).toBe(403);
    await expect(r.db.rpc("set_fx_rate", { p_lbp_per_usd: 90000, p_by: picker.partyId })).rejects.toThrow(/NOT_AUTHORISED/);
  });
});
