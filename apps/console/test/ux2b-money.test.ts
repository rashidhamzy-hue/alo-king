// UX2b: Money on one frame: Ledger (/money), To confirm (/payments), Cash drops (/money/drops), Refunds (/refunds). The routes, roles and functions are
// the ones the older pages had (confirm_payment, review_payment_proof, confirm_cash_drop, refund_order, record_*); what is new is the tab bar with what
// waits on each, the cash drops grouped by rider with what each holds against what they are owed, and the words in Arabic.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deliver, dropAtHub, flashOf, ledgerSum, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string; let rider: string;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => {
  r = await rig(); village = await openShop(r.db);
  rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
  await r.db.rpc("start_shift", { p_driver: rider });
}, 120_000);
const who = async (role: "ops_lead" | "picker" | "admin", name: string, lang = "en") => { const w = await r.staff(role, name); const b = r.browser(); await b.signIn(w); b.cookies.set("ak_lang", lang); return { ...w, b }; };

describe("the tab bar", () => {
  it("is on all four pages, marks the one you are on, and counts what waits", async () => {
    const o = await placeOrder(r.db, village, "whish");
    await r.db.rpc("submit_payment_proof", { p_party: o.customer, p_wamid: `wamid.proof.${o.id}`, p_media_path: `payment_proofs/${o.id}.jpg`, p_sha256: `sha-${o.id}` });
    const lead = await who("ops_lead", "Maya");
    for (const [path, label] of [["/money", "Ledger"], ["/payments", "To confirm"], ["/money/drops", "Cash drops"], ["/refunds", "Refunds"]] as const) {
      const t = (await lead.b.get(path)).text;
      for (const href of ["/money", "/payments", "/money/drops", "/refunds"]) expect(t, `${path} has ${href}`).toContain(`href="${href}"`);
      expect(t, path).toMatch(new RegExp(`aria-current="page"[^>]*>[\\s\\S]{0,40}${label}|${label}[\\s\\S]{0,120}aria-current`));
      expect(t).toContain('href="/fx"'); expect(t).toContain('href="/day-close"');
    }
    expect((await lead.b.get("/money")).text).toMatch(/href="\/payments">To confirm<span class="ak-count">1<\/span>/);
  });
  it("is for the ops lead and the admin: a picker is refused every page", async () => {
    const p = await who("picker", "Pia");
    for (const path of ["/money", "/payments", "/money/drops", "/refunds", "/riders"]) expect((await p.b.get(path)).status, path).toBe(403);
  });
});

describe("Ledger", () => {
  it("shows the drawer and the bank by the books, today's movements, and the three ways cash leaves the drawer", async () => {
    const lead = await who("ops_lead", "Maya2");
    const t = (await lead.b.get("/money")).text;
    expect(t).toMatch(/Drawer by the books: <strong>\$[\d.]+ \+ [\d,]+ LBP<\/strong>/);
    expect(t).toContain('action="/money/deposit"'); expect(t).toContain('action="/money/petty"'); expect(t).toContain('action="/money/expense"');
    expect(t).toContain("<option>fuel</option>");
    expect(t).toContain("Nothing yet today.");
  });
  it("a petty cash entry still goes through its function, and shows in the day's list with who recorded it", async () => {
    const lead = await who("ops_lead", "Maya3");
    const c = await placeOrder(r.db, village);                                           // cash comes into the drawer first: a rider's drop, confirmed
    await deliver(r.db, c.id, rider); await r.db.rpc("rider_collect", { p_order: c.id, p_driver: rider, p_usd: c.total, p_lbp: 0 });
    await dropAtHub(r.db, rider, lead.partyId);
    await lead.b.get("/money");
    const res = await lead.b.post("/money/petty", { usd: "3.5", reason: "bin bags", name: "Hala" });
    expect(flashOf(res.text)).toMatch(/^Petty cash recorded\./);
    expect(res.text).toContain("bin bags"); expect(res.text).toContain("Maya3");
  });
  it("in Arabic: the tabs, the tiles and the forms", async () => {
    const lead = await who("ops_lead", "Maya4", "ar");
    const t = (await lead.b.get("/money")).text;
    expect(t).toMatch(/<html lang="ar" dir="rtl">/);
    for (const w of ["السجل", "للتأكيد", "تسليم النقد", "المبالغ المستردة", "الصندوق بحسب الدفاتر", "نقد إلى البنك", "النثرية"]) expect(t, w).toContain(w);
  });
});

describe("To confirm", () => {
  it("the screenshot beside what is expected, with the fields for what the person sees in the account", async () => {
    const o = await placeOrder(r.db, village, "omt");
    await r.db.rpc("submit_payment_proof", { p_party: o.customer, p_wamid: `wamid.proof2.${o.id}`, p_media_path: `payment_proofs/${o.id}.jpg`, p_sha256: `sha2-${o.id}` });
    const lead = await who("ops_lead", "Maya5");
    const t = (await lead.b.get("/payments")).text;
    expect(t).toContain(`expected <strong>$${o.total.toFixed(2)}</strong>`);
    expect(t).toContain(`https://media.test/payment_proofs/${o.id}.jpg`);
    expect(t).toMatch(/name="amount_usd"/); expect(t).toMatch(/name="reference"/);
    expect(t).toContain('name="decision" value="confirm"'); expect(t).toContain('name="decision" value="reject"');
    const ar = await who("ops_lead", "Maya6", "ar");
    const a = (await ar.b.get("/payments")).text;
    for (const w of ["المتوقع", "أكّد الدفعة", "ارفض اللقطة", "المرجع"]) expect(a, w).toContain(w);
    const ok = await lead.b.post(`/payments/order/${o.id}`, { amount_usd: o.total.toFixed(2), reference: "OMT-UX2B-1" });
    expect(flashOf(ok.text)).toBe("Payment confirmed and booked.");
    expect(Math.abs(await ledgerSum(r.db))).toBeLessThan(0.0001);
  });
});

describe("Cash drops, by rider", () => {
  it("shows each rider with what they hold, what they are owed and the drop to count; confirming goes through confirm_cash_drop and comes back here", async () => {
    const o = await placeOrder(r.db, village);
    await deliver(r.db, o.id, rider);
    await r.db.rpc("rider_collect", { p_order: o.id, p_driver: rider, p_usd: o.total, p_lbp: 0 });
    await r.db.rpc("declare_cash_drop", { p_driver: rider, p_method: "hub", p_usd: o.total, p_lbp: 0 });
    const lead = await who("ops_lead", "Maya7");
    let t = (await lead.b.get("/money/drops")).text;
    expect(t).toContain("Rami");
    expect(t).toMatch(/Cash held[\s\S]*?<strong>\$[\d.]+ \+ [\d,]+ LBP<\/strong>/);
    expect(t).toContain("Counted: confirm");
    expect(t).toContain("Pay earnings"); expect(t).toContain("Send statement on WhatsApp");
    expect(t).toMatch(/Cash drops to confirm \(1\)/);
    const drop = (await r.db.one(`select id from cash_drops where driver_id = $1 and status = 'declared'`, [rider])).id;
    const res = await lead.b.post(`/riders/drop/${drop}`);
    expect(flashOf(res.text)).toMatch(/^Drop confirmed\./);
    expect(res.text).toMatch(/Cash drops to confirm \(0\)/);                           // it came back to this tab
    t = (await lead.b.get("/money/drops")).text;
    expect(t).toContain("Record damaged note");
  });
  it("in Arabic: the cards and the buttons", async () => {
    const lead = await who("ops_lead", "Maya8", "ar");
    const t = (await lead.b.get("/money/drops")).text;
    for (const w of ["تسليم النقد ودفعات المناديب", "النقد معه", "الأرباح المستحقة", "الأوراق التالفة"]) expect(t, w).toContain(w);
  });
});

describe("Refunds", () => {
  it("looks an order up, and keeps the old words: paid, nothing yet, the credit rows", async () => {
    const o = await placeOrder(r.db, village);
    const lead = await who("ops_lead", "Maya9");
    const t = (await lead.b.get(`/refunds?order=${o.code}`)).text;
    expect(t).toContain(`${o.code} · `);
    expect(t).toContain("nothing yet");
    expect(t).toContain('name="order"');
    const ar = await who("ops_lead", "Maya10", "ar");
    expect((await ar.b.get(`/refunds?order=${o.code}`)).text).toContain("لا شيء بعد");
  });
});
