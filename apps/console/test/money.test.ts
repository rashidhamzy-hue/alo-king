// 3.15 Petty cash and bank deposits (and 3.12 expenses): money out of the hub drawer, recorded by SQL with who, why and the photo.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deliver, flashOf, FX, ledgerSum, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string; let rider: string; let lead: { partyId: string; email: string; password: string };
afterEach(() => vi.unstubAllGlobals());
const JPEG = { name: "slip.jpg", type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]) };
const drawer = async () => {
  const n = await r.db.one(`select * from account_native('hub_cash')`);
  return { usd: Number(n.usd), lbp: Number(n.lbp) };
};

beforeAll(async () => {
  r = await rig(); village = await openShop(r.db);
  rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
  lead = await r.staff("ops_lead", "Maya");
  await r.db.rpc("start_shift", { p_driver: rider });
  // Cash reaches the drawer the way it does in life: a rider collects at the door and drops it at the hub.
  for (let i = 0; i < 3; i++) {
    const o = await placeOrder(r.db, village, "cod", 15);
    await deliver(r.db, o.id, rider);
    await r.db.rpc("rider_collect", { p_order: o.id, p_driver: rider, p_usd: Math.round((o.total - 1) * 100) / 100, p_lbp: FX });
  }
  const n = await r.db.one(`select * from driver_cash_native($1)`, [rider]);
  const drop = await r.db.rpc("declare_cash_drop", { p_driver: rider, p_method: "hub", p_usd: Number(n.usd), p_lbp: Number(n.lbp) });
  await r.db.rpc("confirm_cash_drop", { p_drop: drop, p_by: lead.partyId });
}, 120_000);

describe("Hub money", () => {
  it("takes cash to the bank with the slip and its photo, once, and never more than the drawer holds", async () => {
    const b = r.browser();
    await b.signIn(lead);
    const before = await drawer();
    expect(before.lbp).toBe(3 * FX);
    expect((await b.get("/money")).text).toContain(`Drawer by the books: <strong>$${before.usd.toFixed(2)} + 268,500 LBP</strong>`);

    let res = await b.postFiles("/money/deposit", { usd: "10", lbp: FX, slip_ref: "BLOM-5521" }, { slip: JPEG });
    expect(flashOf(res.text)).toBe(`Deposit recorded. The drawer now holds $${(before.usd - 10).toFixed(2)} + 179,000 LBP by the books.`);
    const m = await r.db.one(`select reference, media_path, value_usd, by_party from hub_cash_movements where kind = 'bank_deposit'`);
    expect(m).toMatchObject({ reference: "BLOM-5521", by_party: lead.partyId, value_usd: "11.00" });     // the lira leave at the value they came in at
    expect(m.media_path).toMatch(/^bank_slips\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{64}\.jpg$/);
    expect(r.media.objects.get(m.media_path)).toBe("[8 bytes]");
    expect(res.text).toContain("BLOM-5521");
    expect(res.text).toContain(">photo</a>");
    expect(Number((await r.db.one(`select usd from account_native('bank')`)).usd)).toBe(10);

    res = await b.post("/money/deposit", { usd: "1", slip_ref: "BLOM-5521" });
    expect(flashOf(res.text)).toBe("That slip number was already recorded for another deposit.");
    res = await b.post("/money/deposit", { usd: "100000", slip_ref: "BLOM-5522" });
    expect(flashOf(res.text)).toBe("The drawer does not hold that much by the books. Count it, and check what came in today.");
    res = await b.post("/money/deposit", { slip_ref: "BLOM-5523" });
    expect(flashOf(res.text)).toBe("Type an amount in dollars or lira.");
    expect(Number((await r.db.one(`select count(*) as n from hub_cash_movements`)).n)).toBe(1);
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
  });

  it("records petty cash with a reason and a name; a double tap is one movement; pickers cannot", async () => {
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/money");
    const before = await drawer();
    expect(flashOf((await b.post("/money/petty", { usd: "3", reason: "bin bags", name: "" })).text)).toBe("Write who spent it or was paid.");
    const key = "petty-form-key-1";
    let res = await b.post("/money/petty", { usd: "3", reason: "bin bags and tape", name: "Pia", _key: key });
    expect(flashOf(res.text)).toMatch(/^Petty cash recorded\./);
    res = await b.post("/money/petty", { usd: "3", reason: "bin bags and tape", name: "Pia", _key: key });
    expect(flashOf(res.text)).toBe("That was already recorded.");
    expect((await drawer()).usd).toBeCloseTo(before.usd - 3, 2);
    expect(await r.db.one(`select payee, reason, category from hub_cash_movements where kind = 'petty_cash'`))
      .toEqual({ payee: "Pia", reason: "bin bags and tape", category: "petty_cash" });
    expect(res.text).toContain("bin bags and tape");

    const picker = await r.staff("picker");
    const p = r.browser();
    await p.signIn(picker);
    expect((await p.get("/money")).status).toBe(403);
    await expect(r.db.rpc("record_petty_cash", { p_usd: 1, p_lbp: 0, p_reason: "snacks", p_name: "me", p_by: picker.partyId })).rejects.toThrow(/NOT_AUTHORISED/);
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
  });
});

describe("Expenses (3.12)", () => {
  it("records an expense from the drawer or the bank, in a category from the settings", async () => {
    const b = r.browser();
    await b.signIn(lead);
    expect((await b.get("/money")).text).toContain("<option>fuel</option>");
    let res = await b.post("/money/expense", { usd: "4", paid_from: "hub_cash", category: "fuel", reason: "generator diesel", payee: "Total station", reference: "F-118" });
    expect(flashOf(res.text)).toBe("Expense recorded (fuel, from the drawer).");
    res = await b.post("/money/expense", { usd: "2", paid_from: "bank", category: "fees", reason: "bank charges" });
    expect(flashOf(res.text)).toBe("Expense recorded (fees, from the bank).");
    res = await b.post("/money/expense", { usd: "2", paid_from: "hub_cash", category: "petty_cash", reason: "sneaking around the name" });
    expect(flashOf(res.text)).toBe("Pick a category from the list.");
    res = await b.post("/money/expense", { usd: "50", paid_from: "bank", category: "rent", reason: "more than the bank holds" });
    expect(flashOf(res.text)).toBe("The bank does not hold that much by the books.");
    const rows = await r.db.all(`select category, paid_from, payee, reference from hub_cash_movements where kind = 'expense' order by created_at`);
    expect(rows).toEqual([{ category: "fuel", paid_from: "hub_cash", payee: "Total station", reference: "F-118" }, { category: "fees", paid_from: "bank", payee: null, reference: null }]);
    expect(Number((await r.db.one(`select coalesce(sum(e.usd_equiv), 0) as s from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = 'expense:fuel'`)).s)).toBe(4);
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 6);
  });
});
