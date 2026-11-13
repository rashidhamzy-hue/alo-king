// 3.14 Food-facts editor with evidence upload, and the "expires within three days" list.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, openShop, rig, type Rig } from "./kit";

let r: Rig; let product: string;
afterAll(() => vi.unstubAllGlobals());
const PHOTO = { name: "pack.jpg", type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 9, 9, 9]) };
const meets = async (codes: string[]) => (await r.db.rpc("product_meets_restrictions", { p_product: product, p_restrictions: codes })) as { meets: boolean; checks: { result: string }[] };
beforeAll(async () => {
  r = await rig(); await openShop(r.db);
  product = (await r.db.one(`select id from products where name_en = 'Leen Taanayel Labneh Premium'`)).id;
}, 120_000);

describe("Food facts", () => {
  it("a picker's entry from the pack waits; the ops lead's is approved; evidence is required and certified needs a certificate", async () => {
    const picker = await r.staff("picker", "Pia");
    const lead = await r.staff("ops_lead", "Maya");
    const p = r.browser();
    await p.signIn(picker);
    let page = (await p.get(`/food-facts/${product}`)).text;
    expect(page).toContain("None. Every question about this item is answered");
    let res = await p.postFiles(`/food-facts/${product}`, { attribute: "milk", allergen_value: "contains", status: "declared", evidence_kind: "label_photo" }, { evidence: PHOTO });
    expect(flashOf(res.text)).toBe("Recorded. It waits for the ops lead to approve it.");
    expect((await meets(["milk"])).checks[0]!.result).toBe("unknown");          // not approved: unknown, never safe
    const fact = await r.db.one(`select source, status, evidence_id, proposed_by from product_facts where product_id = $1 and attribute = 'milk'`, [product]);
    expect(fact).toMatchObject({ source: "label", status: "declared", proposed_by: picker.partyId });
    expect((await r.db.one(`select kind, media_path from evidence_documents where id = $1`, [fact.evidence_id])).media_path).toMatch(/^evidence\/[0-9a-f-]{36}\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{64}\.jpg$/);
    expect(res.text).toContain("Waiting for a person (1)");

    const b = r.browser();
    await b.signIn(lead);
    await b.get(`/food-facts/${product}`);
    res = await b.post(`/food-facts/${product}`, { attribute: "sesame", allergen_value: "free", status: "declared", evidence_kind: "label_photo" });
    expect(flashOf(res.text)).toBe("Attach the pack (a photo) or the document, or give its reference.");
    res = await b.postFiles(`/food-facts/${product}`, { attribute: "halal", diet_value: "yes", status: "certified", evidence_kind: "label_photo" }, { evidence: PHOTO });
    expect(flashOf(res.text)).toBe("Certified needs a certificate or a lab report as evidence.");
    res = await b.postFiles(`/food-facts/${product}`, { attribute: "ingredients", ingredients: "Pasteurised cow's milk, salt, cultures", status: "declared", evidence_kind: "label_photo" }, { evidence: PHOTO });
    expect(flashOf(res.text)).toBe("Recorded and approved.");
    res = await b.postFiles(`/food-facts/${product}`, { attribute: "nutrition", n_energy_kcal: "160", n_fat: "12", n_proteins: "7", n_salt: "1.1", status: "declared", evidence_kind: "label_photo" }, { evidence: PHOTO });
    expect(flashOf(res.text)).toBe("Recorded and approved.");
    res = await b.post(`/food-facts/${product}`, { attribute: "halal", diet_value: "yes", status: "certified", evidence_kind: "certificate", evidence_ref: "LIBNOR-HAL-2026-118" });
    expect(flashOf(res.text)).toBe("Recorded and approved.");
    expect((await meets(["halal"])).meets).toBe(true);
    // The pack says nothing about sesame: recorded as unknown, which never passes.
    res = await b.post(`/food-facts/${product}`, { attribute: "sesame", status: "unknown", evidence_kind: "label_photo" });
    expect(flashOf(res.text)).toBe("Recorded and approved.");
    expect((await meets(["sesame"])).meets).toBe(false);
    page = res.text;
    expect(page).toContain("Pasteurised cow&#39;s milk, salt, cultures");
    expect(page).toContain("energy kcal 160, fat 12, proteins 7, salt 1.1 per 100 g");
    expect(page).toContain("LIBNOR-HAL-2026-118");
    const facts = await r.db.rpc("product_food_facts", { p_product: product });
    expect(facts.map((f: { attribute: string }) => f.attribute).sort()).toEqual(["halal", "ingredients", "nutrition", "sesame"]);
    await expect(r.db.rpc("record_food_fact", { p_product: product, p_attribute: "eggs", p_value: "free", p_status: "declared", p_detail: {}, p_evidence: null,
      p_by: (await r.db.one(`insert into parties(role) values ('driver') returning id`)).id })).rejects.toThrow(/NOT_AUTHORISED/);
  });

  it("lists stock expiring within three days", async () => {
    const lead = await r.staff("ops_lead");
    const supplier = await r.db.rpc("create_supplier", { p_name: "Leen Dairy", p_by: lead.partyId });
    const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
    await r.db.rpc("receive_goods", { p_supplier: supplier, p_source: r.source, p_by: lead.partyId, p_supplier_ref: "E-1",
      p_lines: [{ product_id: product, qty: 4, unit_cost_usd: 0.5, expiry_date: day(2), lot: "SOON" }] });
    await r.db.rpc("receive_goods", { p_supplier: supplier, p_source: r.source, p_by: lead.partyId, p_supplier_ref: "E-2",
      p_lines: [{ product_id: product, qty: 4, unit_cost_usd: 0.5, expiry_date: day(20), lot: "LATER" }] });
    const picker = await r.staff("picker");
    const b = r.browser();
    await b.signIn(picker);
    const page = (await b.get("/food-facts")).text;
    expect(page).toContain("Expiring within three days (1)");
    expect(page).toContain("SOON");
    expect(page).not.toContain("LATER");
  });
});
