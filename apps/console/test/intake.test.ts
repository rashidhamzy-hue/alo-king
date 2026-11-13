// 5.15 Label scan at intake, and the review of proposed food facts (N1's Open Food Facts proposals, the label reading, pickers'
// entries) against the pack, field by field. Nothing is published until a person confirms it.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LabelReading } from "../src/label";
import { flashOf, openShop, rig, type Rig } from "./kit";

let r: Rig; let product: string;
afterAll(() => vi.unstubAllGlobals());
const PHOTO = { name: "label.jpg", type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]) };
const reading: LabelReading = {
  name_en: "Labneh Premium", name_ar: "لبنة", brand: "Leen Taanayel", size: "500 g", barcode: "2201340000000",
  ingredients_text: "Pasteurised cow's milk, salt, lactic cultures",
  allergens: [{ code: "milk", value: "contains", quote: "cow's milk" }, { code: "sesame", value: "may_contain", quote: "May contain traces of sesame" },
              { code: "eggs", value: "free", quote: "" }],                       // no printed words: dropped, never guessed
  diet: [], nutrition_per_100g: { energy_kcal: 160, fat: 12, saturated_fat: null, carbohydrates: 4, sugars: null, fiber: null, proteins: 7, salt: 1.1 },
};
const pending = async () => r.db.all(`select id, attribute, source, detail from product_facts where product_id = $1 and approved_at is null and superseded_at is null order by attribute, source`, [product]);
const check = async (code: string) => ((await r.db.rpc("product_meets_restrictions", { p_product: product, p_restrictions: [code] })) as { checks: { result: string; reason: string }[] }).checks[0]!;

beforeAll(async () => {
  r = await rig(); await openShop(r.db);
  product = (await r.db.one(`select id from products where sku = 'AK-0042'`)).id;
  // What N1 (5.18) files from Open Food Facts: proposals only, with the source text beside every value.
  const fp = (s: string) => ({ off_code: "2201340000000", fingerprint: s });
  await r.db.rpc("propose_off_facts", { p_product: product, p_run: "run-1", p_facts: [
    { attribute: "milk", value: "contains", detail: { source_text: "Ingrédients: lait de vache pasteurisé, sel", quote: "lait", ...fp("a") } },
    { attribute: "ingredients", value: null, detail: { source_text: "lait de vache pasteurisé, sel", text: "lait de vache pasteurisé, sel", ar: "حليب بقر مبستر، ملح", ...fp("b") } },
    { attribute: "nutrition", value: null, detail: { source_text: "{\"energy-kcal_100g\":150}", per: "100g", values: { energy_kcal: 150 }, ...fp("c") } },
  ] });
}, 120_000);

describe("Label intake", () => {
  it("a picker scans the pack; the reading and Open Food Facts wait; the ops lead confirms, corrects or rejects each field against the photo", async () => {
    const picker = await r.staff("picker", "Pia");
    const lead = await r.staff("ops_lead", "Maya");
    const l = r.browser();
    await l.signIn(lead);
    // Before any photo of the pack: an Open Food Facts field cannot be confirmed, it has nothing of ours to rest on.
    const milkOff = (await pending()).find((f) => f.attribute === "milk")!;
    await l.get(`/intake/${product}`);
    expect(flashOf((await l.post(`/intake/fact/${milkOff.id}/confirm`, { value: "contains", status: "declared", evidence: "" })).text))
      .toBe("Attach the pack (a photo) or the document, or give its reference.");
    await expect(r.db.rpc("approve_product_fact", { p_fact: milkOff.id, p_by: lead.partyId })).rejects.toThrow(/SECOND_OPINION_ONLY|product_facts_off_never_approved/);

    let seen: number | null = null;
    r.deps.readLabel = async (images) => { seen = images.length; return reading; };
    r.deps.labelModel = "claude-haiku-5-5";
    const p = r.browser();
    await p.signIn(picker);
    await p.get("/intake");
    let res = await p.postFiles("/intake/scan", { code: "AK-0042" }, { photo_1: PHOTO, photo_2: { ...PHOTO, bytes: new Uint8Array([0xff, 0xd8, 9]) } });
    expect(flashOf(res.text)).toBe("Photos saved for Leen Taanayel Labneh Premium; 4 fields read from the label, each waiting to be checked against the pack.");
    expect(seen).toBe(2);
    expect(res.text).toContain("The ops lead checks this.");
    expect(res.text).not.toContain("Confirm against the pack");
    expect(res.text).toContain("Open Food Facts (second opinion)");
    expect(res.text).toContain("read from the label photo by a model");
    expect(res.text).toMatch(/<img class="proof" src="https:\/\/media\.test\/labels\//);
    const scan = await r.db.one(`select read_by, model, scanned_by, array_length(evidence_ids, 1) as n, reading->'facts' as facts from label_scans`);
    expect(scan).toMatchObject({ read_by: "model", model: "claude-haiku-5-5", scanned_by: picker.partyId, n: 2 });
    expect((await pending()).map((f) => `${f.attribute}:${f.source}`)).toEqual(
      ["ingredients:label", "ingredients:open_food_facts", "milk:label", "milk:open_food_facts", "nutrition:label", "nutrition:open_food_facts", "sesame:label"]);
    expect((await check("sesame")).result).toBe("unknown");                    // proposed is not published
    expect((await p.post(`/intake/fact/${milkOff.id}/confirm`, { value: "contains", status: "declared" }, { follow: false })).status).toBe(403);

    // The ops lead, field by field, with the pack photo beside each row.
    res = await l.get(`/intake/${product}`);
    expect(res.text).toContain("Proposed fields (7)");
    expect(res.text).toContain("Arabic: حليب بقر مبستر، ملح");
    expect(res.text).toContain("printed words: “May contain traces of sesame”");
    const ids = Object.fromEntries((await pending()).map((f) => [`${f.attribute}:${f.source}`, f.id]));
    const photo = (await r.db.one(`select id from evidence_documents where product_id = $1 and kind = 'label_photo' order by created_at desc limit 1`, [product])).id;
    expect(res.text).toContain(`<option value="${photo}" selected>`);                  // the form offers the pack photo first
    // Open Food Facts' milk: confirmed as the pack prints it; the published fact is the pack's, with the photo as evidence.
    expect(flashOf((await l.post(`/intake/fact/${ids["milk:open_food_facts"]}/confirm`, { value: "contains", status: "declared", evidence: photo })).text)).toBe("Confirmed against the pack and published.");
    const milk = await r.db.one(`select id, source, status, value, evidence_id, approved_by from product_facts where product_id = $1 and attribute = 'milk' and approved_at is not null`, [product]);
    expect(milk).toMatchObject({ source: "label", status: "declared", value: "contains", approved_by: lead.partyId });
    expect((await r.db.one(`select kind from evidence_documents where id = $1`, [milk.evidence_id])).kind).toBe("label_photo");
    expect(await r.db.one(`select approved_at, superseded_by from product_facts where id = $1`, [ids["milk:open_food_facts"]])).toEqual({ approved_at: null, superseded_by: milk.id });
    expect((await check("milk")).result).toBe("fails");
    // The duplicate reading of the same field: rejected, with why.
    expect(flashOf((await l.post(`/intake/fact/${ids["milk:label"]}/reject`, { note: "same as the confirmed one" })).text)).toBe("Rejected: nothing is published from it.");
    // Ingredients: the pack differs from Open Food Facts' French; corrected to what is printed. The model's Arabic is not carried over.
    expect(flashOf((await l.post(`/intake/fact/${ids["ingredients:open_food_facts"]}/confirm`, { ingredients: "Pasteurised cow's milk, salt, lactic cultures", status: "declared", evidence: photo })).text))
      .toBe("Confirmed as the pack prints it (corrected) and published.");
    const ingr = await r.db.one(`select detail from product_facts where product_id = $1 and attribute = 'ingredients' and approved_at is not null`, [product]);
    expect(ingr.detail.text).toBe("Pasteurised cow's milk, salt, lactic cultures");
    expect(ingr.detail.ar).toBeUndefined();
    expect(ingr.detail.confirmed_from).toBe(ids["ingredients:open_food_facts"]);
    await l.post(`/intake/fact/${ids["ingredients:label"]}/reject`, { note: "duplicate" });
    // Nutrition: Open Food Facts' panel is not the pack's; rejected. The label reading's panel is confirmed as read.
    await l.post(`/intake/fact/${ids["nutrition:open_food_facts"]}/reject`, { note: "panel on the pack differs" });
    expect(await r.db.one(`select rejected_by, review_note from product_facts where id = $1`, [ids["nutrition:open_food_facts"]]))
      .toEqual({ rejected_by: lead.partyId, review_note: "panel on the pack differs" });
    expect(flashOf((await l.post(`/intake/fact/${ids["nutrition:label"]}/confirm`, { n_energy_kcal: "160", n_fat: "12", n_carbohydrates: "4", n_proteins: "7", n_salt: "1.1", status: "declared" })).text))
      .toBe("Confirmed against the pack and published.");
    // Sesame "may contain": confirmed; it fails a sesame restriction.
    await l.post(`/intake/fact/${ids["sesame:label"]}/confirm`, { value: "may_contain", status: "declared" });
    expect((await check("sesame")).result).toBe("fails");
    // A decided field stays decided; the queue is empty for this item; nothing from Open Food Facts was ever approved.
    expect(flashOf((await l.post(`/intake/fact/${ids["sesame:label"]}/confirm`, { value: "free", status: "declared" })).text)).toBe("That field was already decided.");
    expect(await pending()).toEqual([]);
    expect((await l.get("/intake")).text).toContain("Waiting to be checked against the pack (0 items)");
    expect(Number((await r.db.one(`select count(*) as n from product_facts where source = 'open_food_facts' and approved_at is not null`)).n)).toBe(0);
    expect((await r.db.rpc("product_food_facts", { p_product: product })).map((f: { attribute: string }) => f.attribute).sort()).toEqual(["ingredients", "milk", "nutrition", "sesame"]);
  });

  it("without a label reader the photos are saved and the fields are typed from the pack; an unknown code is refused", async () => {
    delete r.deps.readLabel;
    const picker = await r.staff("picker");
    const b = r.browser();
    await b.signIn(picker);
    expect((await b.get("/intake")).text).toContain("No label reader is set up on this console");
    expect(flashOf((await b.postFiles("/intake/scan", { code: "999999999" }, { photo_1: PHOTO })).text)).toBe("No item with barcode or SKU 999999999. A new item is added to the catalog first.");
    const res = await b.postFiles("/intake/scan", { code: "AK-0042" }, { photo_1: { ...PHOTO, bytes: new Uint8Array([0xff, 0xd8, 7, 7]) } });
    expect(flashOf(res.text)).toBe("Photos saved for Leen Taanayel Labneh Premium. Type the fields from the pack.");
    expect((await r.db.one(`select read_by from label_scans order by created_at desc limit 1`)).read_by).toBe("none");
  });
});
