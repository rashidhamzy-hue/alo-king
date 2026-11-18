// B1f: the console's "Weights to record on label day" (migration 0253, weights_to_record and resolve_price_basis). Every by-weight item with
// no approved pack weight, its aisle and what the pages say the price is for; the open "price basis to confirm" checks; only an ops lead
// or admin answers one, and the eggs are off sale until then.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, openShop, rig, type Rig } from "./kit";

let r: Rig;
afterEach(() => vi.unstubAllGlobals());
const who = async (role: "ops_lead" | "picker" | "admin", name: string, lang = "en") => { const w = await r.staff(role, name); const b = r.browser(); await b.signIn(w); b.cookies.set("ak_lang", lang); return { ...w, b }; };

beforeAll(async () => {
  r = await rig(); await openShop(r.db);
  await r.db.rpc("b1f_price_basis_checks", {});      // the seeds load after the migrations in the test database
}, 120_000);

describe("weights to record on label day", () => {
  it("lists the by-weight items with their aisle and the pages' words; the eggs say they are not sold until answered", async () => {
    const picker = await who("picker", "Pia");
    const page = (await picker.b.get("/weights")).text;
    expect(page).toContain("Weights to record on label day");
    expect(page).toContain("Chicken Legs");
    expect(page).toContain("per pack, weight not confirmed yet");
    expect(page).toContain("Hawa Chicken Red Egg");
    expect(page).toContain("not sold until answered");
    expect(page).toContain("How many eggs");
    expect(page).not.toContain("Save the answer");                       // a picker reads, never answers
    const ar = await who("picker", "Pia2", "ar");
    expect((await ar.b.get("/weights")).text).toContain("للعلبة، الوزن غير مؤكّد بعد");
  });
  it("only an ops lead answers; the eggs come back on sale with their price unchanged", async () => {
    const id = (await r.db.one(`select k.id from price_basis_checks k join products p on p.id = k.product_id where p.sku = 'AK-0049' and k.resolved_at is null`)).id;
    const price = (await r.db.one(`select o.price_usd from offers o join products p on p.id = o.product_id where p.sku = 'AK-0049'`)).price_usd;
    const picker = await who("picker", "Pia3");
    expect((await picker.b.post("/weights/answer", { check: id, resolution: "per_pack", note: "tray" }, { follow: false })).status).toBe(403);
    const lead = await who("ops_lead", "Maya");
    expect(flashOf((await lead.b.post("/weights/answer", { check: id, resolution: "per_pack", note: "" })).text)).toBe("Say how you know: the invoice, the scale or the tray.");
    expect(flashOf((await lead.b.post("/weights/answer", { check: id, resolution: "per_pack", note: "tray of 30 on the invoice" })).text)).toBe("Saved: the price is for the pack.");
    const o = await r.db.one(`select o.is_available, o.price_usd from offers o join products p on p.id = o.product_id where p.sku = 'AK-0049'`);
    expect(o.is_available).toBe(true);
    expect(o.price_usd).toBe(price);
    expect((await lead.b.get("/weights")).text).not.toContain("How many eggs");
  });
});
