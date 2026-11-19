// Today as an exception inbox (session D5): what needs a person comes first, each with its one action; a quiet day says so.
// CON1: Today is "needs attention", most urgent first: high-priority exceptions before the others, each kind oldest first.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, rig, type Rig } from "./kit";

let r: Rig;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { r = await rig(); }, 120_000);
const raise = (kind: string, ref: string, detail: object = {}) => r.db.rpc("raise_ops_exception", { p_kind: kind, p_ref: ref, p_detail: detail });

describe("Today", () => {
  it("on a day with no order, exception or customer waiting, lists only what waits behind the scenes (approvals, stock), and says so in green when nothing does", async () => {
    const lead = await r.staff("ops_lead", "Maya"); const b = r.browser(); await b.signIn(lead);
    const page = (await b.get("/")).text;
    expect(page).toContain("Needs attention"); expect(page).not.toContain("past its promised time"); expect(page).not.toContain('class="tag high"');
    expect(page).toMatch(/\d+ approvals waiting/);                                                 // the 282 proposed names of the seed wait for a person
    // nothing waiting anywhere: the green line
    await r.db.pg.query(`delete from product_name_proposals where status = 'proposed'`);
    await r.db.pg.query(`delete from product_images where status = 'proposed'`);
    await r.db.pg.query(`update stock_levels set on_hand = 500, reorder_point = 0`);
    const quiet = (await b.get("/")).text;
    expect(quiet).not.toContain("approvals waiting"); expect(quiet).not.toContain("running low");
    expect(quiet).toContain('class="summary-ok"'); expect(quiet).toContain("All quiet");
  });

  it("lists exceptions oldest first, high priority marked, each with its one action and the two buttons", async () => {
    const a = await raise("count_needed", "shelf-9", {}); await raise("allergen_complaint", "case-9", { order: "AK-4000" }); await raise("pick_empty", "AK-4001", {});
    await r.db.pg.query(`update ops_exceptions set created_at = now() - interval '50 minutes' where id = $1`, [a]);
    const lead = await r.staff("ops_lead", "Maya"); const b = r.browser(); await b.signIn(lead);
    const page = (await b.get("/")).text;
    expect(page).toContain("Needs attention"); expect(page).not.toContain("All quiet");
    const list = page.slice(page.indexOf("<main"));                                               // DS1: the bell in the header names the high-priority ones too
    const at = (s: string) => list.indexOf(s);
    expect(at("Allergen complaint")).toBeLessThan(at("A shelf count is needed"));                // CON1: the high-priority one first, though younger
    expect(page).toMatch(/Allergen complaint<\/strong><br><span class="muted"><span class="tag high">high priority<\/span>/);
    expect(page).not.toMatch(/A shelf count is needed<\/strong><br><span class="muted"><span class="tag high"/);
    expect(page).toMatch(/href="\/cases">[\s\S]{0,400}?Open the case/); expect(page).toMatch(/href="\/orders\/AK-4001">[\s\S]{0,400}?Open the order/); expect(page).toMatch(/href="\/catalog">[\s\S]{0,400}?Open the catalog/);
    expect(page).toContain("I&#39;m on it"); expect(page).toContain('name="back" value="/"');
    expect(page).toMatch(/50 min/);
  });

  it("'I'm on it' and 'Resolved' work from Today and come back to Today", async () => {
    const id = await raise("rider_off", "rider-9:1", {});
    const lead = await r.staff("ops_lead", "Maya"); const b = r.browser(); await b.signIn(lead);
    await b.get("/");
    const ack = await b.post(`/exceptions/${id}/acknowledged`, { back: "/" });
    expect(flashOf(ack.text)).toBe("Marked as being handled."); expect(b.lastPath).toBe("/"); expect(ack.text).toContain("being handled");
    const done = await b.post(`/exceptions/${id}/resolved`, { back: "/" });
    expect(flashOf(done.text)).toBe("Marked resolved."); expect(done.text).not.toContain("A rider cannot continue");
    expect((await r.db.one(`select status from ops_exceptions where id = $1`, [id])).status).toBe("resolved");
    // the exceptions page's own form is as it was: it returns to the exceptions page
    const other = await raise("rider_off", "rider-9:2", {});
    await b.get("/exceptions");
    const back = await b.post(`/exceptions/${other}/resolved`, {});
    expect(b.lastPath).toBe("/exceptions"); expect(flashOf(back.text)).toBe("Marked resolved.");
    // a back address that is not Today is ignored
    const third = await raise("rider_off", "rider-9:3", {});
    await b.post(`/exceptions/${third}/resolved`, { back: "https://evil.example/" }); expect(b.lastPath).toBe("/exceptions");
  });

  it("is in Arabic when asked, with the exceptions named in Arabic; a picker sees no inbox", async () => {
    await raise("payment_proof", "pay-9", {});
    const lead = await r.staff("admin", "Rasheed"); const b = r.browser(); await b.signIn(lead);
    await b.get("/lang?to=ar&next=/");
    const page = (await b.get("/")).text;
    expect(page).toContain("يحتاج انتباهك"); expect(page).toContain("إثبات دفع بالانتظار"); expect(page).toContain('<html lang="ar" dir="rtl">');
    const p = await r.staff("picker", "Pia"); const pb = r.browser(); await pb.signIn(p);
    const pp = await pb.get("/");
    expect(pp.status).toBe(303); expect(pp.location).toBe("/pick");                          // CON1: a picker's Today is the pick queue
    expect((await pb.get("/pick")).text).not.toContain("A payment proof waits");
  });
});
