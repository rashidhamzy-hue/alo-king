// 3.7 Catalog: count, adjust with a reason, price and availability with a reason; the database decides who may do what.
import { afterEach, describe, expect, it, vi } from "vitest";
import { flashOf, openShop, rig, type Rig } from "./kit";

afterEach(() => vi.unstubAllGlobals());
const labneh = async (r: Rig) => (await r.db.one(`select id from products where name_en = 'Leen Taanayel Labneh Premium'`)).id as string;
const level = async (r: Rig, p: string) => Number((await r.db.one(`select on_hand from stock_levels where product_id = $1 and source_id = $2`, [p, r.source])).on_hand);

describe("Catalog", () => {
  it("searches, then a picker counts and adjusts with a reason; a double tap changes stock once; the picker limit holds", async () => {
    const r = await rig();
    await openShop(r.db);
    const p = await labneh(r);
    const picker = await r.staff("picker", "Pia");
    const b = r.browser();
    await b.signIn(picker);
    const list = (await b.get("/catalog?q=labneh")).text;
    expect(list).toContain("Leen Taanayel Labneh Premium");
    expect(list).not.toContain("Najjar");

    const page = (await b.get(`/catalog/${p}`)).text;
    expect(page).toContain("on hand <strong>500</strong>");
    expect(page).not.toContain("Price and availability");               // pickers do not change prices

    expect(flashOf((await b.post(`/catalog/${p}/count`, { counted: 497, note: "shelf A3" })).text)).toBe("Count saved: the system had 500, a difference of -3.");
    expect(await level(r, p)).toBe(497);

    const key = "same-form-key-1";
    expect(flashOf((await b.post(`/catalog/${p}/adjust`, { delta: -2, reason: "damaged", note: "torn lids", _key: key })).text)).toBe("Saved. On hand now 495.");
    expect(flashOf((await b.post(`/catalog/${p}/adjust`, { delta: -2, reason: "damaged", note: "torn lids", _key: key })).text)).toBe("That change was already saved.");
    expect(await level(r, p)).toBe(495);

    expect(flashOf((await b.post(`/catalog/${p}/adjust`, { delta: 3, reason: "damaged" })).text)).toBe("That reason does not fit the direction of the change.");
    expect(flashOf((await b.post(`/catalog/${p}/adjust`, { delta: -40, reason: "expired" })).text)).toBe("Above the picker limit: an ops lead must make this change.");
    expect(flashOf((await b.post(`/catalog/${p}/adjust`, { delta: -1, reason: "made-up" })).text)).toBe("Pick a reason from the list.");
    expect(await level(r, p)).toBe(495);
    const moves = await r.db.all(`select adjust_reason, actor_id from stock_movements where product_id = $1 and adjust_reason is not null order by created_at`, [p]);
    expect(moves.map((m) => m.adjust_reason)).toEqual(["count", "damaged"]);
    expect(moves.every((m) => m.actor_id === picker.partyId)).toBe(true);
    expect((await b.post(`/catalog/${p}/offer`, { price_usd: 1, available: 1, reason: "test" }, { follow: false })).status).toBe(403);
  });

  it("without set_offer() in the database, the price form says so instead of pretending", async () => {
    const r = await rig({ without: ["set_offer"] });
    const p = await labneh(r);
    const lead = await r.staff("ops_lead");
    const b = r.browser();
    await b.signIn(lead);
    expect((await b.get(`/catalog/${p}`)).text).toContain("needs set_offer()");
  });

  it("with set_offer(), an ops lead changes price and availability with a reason, and it is recorded", async () => {
    const r = await rig();
    const p = await labneh(r);
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    const old = Number((await r.db.one(`select price_usd from offers where product_id = $1 and source_id = $2`, [p, r.source])).price_usd);
    const next = Math.round(old * 1.05 * 100) / 100;            // within the 10% that needs no second approval (3.13)
    await b.get(`/catalog/${p}`);
    expect(flashOf((await b.post(`/catalog/${p}/offer`, { price_usd: next.toFixed(2), available: 1, reason: "" })).text)).toBe("Write the reason for the change.");
    const res = await b.post(`/catalog/${p}/offer`, { price_usd: next.toFixed(2), reason: "supplier price up" });     // unchecked: unavailable
    expect(flashOf(res.text)).toBe(`Saved: $${next.toFixed(2)}, unavailable (was $${old.toFixed(2)}).`);
    expect(await r.db.one(`select price_usd, is_available from offers where product_id = $1 and source_id = $2`, [p, r.source])).toMatchObject({ price_usd: next.toFixed(2), is_available: false });
    const ch = await r.db.one(`select reason, changed_by, before, after from config_changes where kind = 'offer' and ref = $1`, [p]);
    expect(ch).toMatchObject({ reason: "supplier price up", changed_by: lead.partyId, after: { price_usd: next, is_available: false } });
    const picker = await r.staff("picker");
    await expect(r.db.rpc("set_offer", { p_product: p, p_price_usd: 1, p_available: true, p_by: picker.partyId, p_reason: "cheaper" })).rejects.toThrow(/NOT_AUTHORISED/);
  });
});
