// Food facts and intake pages, session D4: the basis of every proposal in words, and "the label wins" when a label reading and a web
// source disagree (audit G1, points 1 and 4): flagged on both pages, a web proposal cannot be confirmed against the label's value
// (the page offers only "set aside"; the database refuses too), and a database without 0114 still shows the pages.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { basisWords, confirmedFrom } from "../src/basis";
import { flashOf, openShop, rig, type Rig } from "./kit";

let r: Rig; let product: string; let lead: Awaited<ReturnType<Rig["staff"]>>;
afterAll(() => vi.unstubAllGlobals());
const pending = () => r.db.all(`select id, attribute, source, value, detail from product_facts where product_id = $1 and approved_at is null and superseded_at is null order by attribute, source`, [product]);
const factOf = async (attribute: string, source: string) => (await pending()).find((f) => f.attribute === attribute && f.source === source)!;

beforeAll(async () => {
  r = await rig(); await openShop(r.db);
  lead = await r.staff("ops_lead", "Maya");
  product = (await r.db.one(`select id from products where sku = 'AK-0042'`)).id;
  // Open Food Facts (N1): an allergen from its tag, one mapped from the ingredient text, a diet claim and a panel.
  await r.db.rpc("propose_off_facts", { p_product: product, p_run: "run-1", p_facts: [
    { attribute: "milk", value: "contains", detail: { source_text: "allergens_tags: en:milk", quote: "en:milk", off_code: "2201340000000", fingerprint: "m1", basis: "off_tag", source_field: "allergens_tags" } },
    { attribute: "gluten", value: "contains", detail: { source_text: "Ingredients: wheat flour, milk", quote: "wheat", off_code: "2201340000000", fingerprint: "g1", basis: "text_mapped_by_model", source_field: "ingredients" } },
    { attribute: "vegetarian", value: "yes", detail: { source_text: "ingredients_analysis_tags: en:vegetarian", quote: "en:vegetarian", off_code: "2201340000000", fingerprint: "v1", basis: "off_ingredient_analysis", source_field: "ingredients_analysis_tags" } },
    { attribute: "nutrition", value: null, detail: { source_text: "nutriments", off_code: "2201340000000", fingerprint: "n1", per: "100g", values: { energy_kcal: 150, fat: 10, salt: 1.0 } } },
  ] });
  // A web page for the Gulf market (P2): ingredients say sesame; halal as a pack claim.
  await r.db.rpc("propose_web_facts", { p_product: product, p_run: "web-1", p_facts: [
    { attribute: "sesame", value: "contains", detail: { page_url: "https://shop.example.test/labneh", market: "Gulf", source_text: "Contains sesame and milk", quote: "Contains sesame", fingerprint: "s1", basis: "literal_quote_from_the_page" } },
    { attribute: "halal", value: "yes", detail: { page_url: "https://shop.example.test/labneh", market: null, source_text: "Halal certified", quote: "Halal certified", fingerprint: "h1", basis: "pack_claim_or_certificate_as_the_page_shows_it" } },
    { attribute: "ingredients", value: null, detail: { page_url: "https://shop.example.test/labneh", market: "Gulf", source_text: "Milk, salt", text: "Milk, salt", lang: "en", fingerprint: "i1" } },
  ] });
}, 120_000);

describe("the basis of a proposal, in words", () => {
  it("says what each kind of proposal rests on, without anyone guessing", () => {
    expect(basisWords({ source: "open_food_facts", detail: { basis: "text_mapped_by_model", source_field: "ingredients" } }))
      .toBe("Open Food Facts (second opinion): inferred from the ingredient list on Open Food Facts, not printed on the pack");
    expect(basisWords({ source: "open_food_facts", detail: { basis: "text_mapped_by_model", source_field: "traces", quote: "may contain nuts" } }))
      .toBe("Open Food Facts (second opinion): read from Open Food Facts' own “may contain” text (“may contain nuts”), not checked against the pack");
    expect(basisWords({ source: "open_food_facts", detail: { basis: "off_tag" } })).toContain("listed in Open Food Facts' allergen tags");
    expect(basisWords({ source: "open_food_facts", detail: { basis: "off_ingredient_analysis" } })).toContain("inferred by Open Food Facts from the ingredient list, not printed on the pack");
    expect(basisWords({ source: "open_food_facts", detail: { basis: "off_label_claim" } })).toContain("a claim Open Food Facts records from the label");
    expect(basisWords({ source: "open_food_facts", detail: {} })).toBe("Open Food Facts (second opinion): as Open Food Facts lists it, not checked against the pack");
    expect(basisWords({ source: "web_page", detail: { market: "Gulf", basis: "literal_quote_from_the_page" } }))
      .toBe("from a web page for the Gulf market, quoted from the page; not printed on our pack, and a recipe sold in another market may differ from the Lebanese one");
    expect(basisWords({ source: "web_page", detail: { market: null } })).toMatch(/^from a web page \(the market is not stated\); not printed on our pack/);
    expect(basisWords({ source: "web_page", detail: { market: "Lebanon" } })).toBe("from a web page for the Lebanon market; not checked against our pack");
    expect(basisWords({ source: "label", detail: { read_by: "model" } })).toBe("read from the label photo by a model: a person has not checked it against the pack yet");
    expect(basisWords({ source: "label", approved_at: "2026-11-14", detail: {} })).toBe("from the pack label, checked by a person");
    expect(basisWords({ source: "label", detail: {} })).toBe("typed from the pack label, waiting for the ops lead to approve it");
    expect(basisWords({ source: "supplier" })).toBe("from the supplier's specification sheet");
    expect(basisWords({ source: "lab" })).toBe("from a lab report");
    expect(confirmedFrom({ source: "label", detail: { confirmed_from: "x", proposal_source: "web_page" } })).toBe("confirmed against the pack, from a web-page proposal");
    expect(confirmedFrom({ source: "label", detail: {} })).toBe("");
  });

  it("the food-facts page lists what waits with its basis; the intake page shows the same words beside each field", async () => {
    const b = r.browser();
    await b.signIn(lead);
    const page = (await b.get(`/food-facts/${product}`)).text;
    expect(page).toContain("Waiting for a person (7)");
    expect(page).toContain("inferred from the ingredient list on Open Food Facts, not printed on the pack");
    expect(page).toContain("from a web page for the Gulf market, quoted from the page");
    expect(page).toContain("from a web page (the market is not stated)");
    expect(page).toContain("inferred by Open Food Facts from the ingredient list, not printed on the pack");
    const intake = (await b.get(`/intake/${product}`)).text;
    expect(intake).toContain("Open Food Facts (second opinion): listed in Open Food Facts&#39; allergen tags");
    expect(intake).toContain("from a web page for the Gulf market");
    expect(intake).not.toContain("Label and web disagree");          // no label reading yet: nothing to disagree with
  });
});

describe("when the label photo and a web source disagree, the label wins", () => {
  it("flags each disagreement on both pages; the web row can only be set aside; the database refuses to confirm it too", async () => {
    // The label reader read the pack: no milk (OFF says it contains milk), sesame as the web page says, a different panel.
    const scan = await r.db.rpc("record_label_scan", { p_product: product, p_photos: ["labels/t/1.jpg"], p_model: "claude-haiku-5-5", p_by: lead.partyId, p_reading: { facts: [
      { attribute: "milk", value: "free", quote: "no milk or dairy" },
      { attribute: "sesame", value: "contains", quote: "Contains sesame" },
      { attribute: "nutrition", values: { energy_kcal: 240, fat: 10, salt: 1.0 } },
      { attribute: "ingredients", text: "حليب، ملح", lang: "ar" },
    ] } });
    expect(Object.keys(scan.proposed).sort()).toEqual(["ingredients", "milk", "nutrition", "sesame"]);
    const conflicts = (await r.db.rpc("fact_basis_conflicts", { p_product: product })) as any[];
    expect(conflicts.map((x) => x.attribute)).toEqual(["milk", "nutrition"]);            // sesame agrees; ingredients are in different languages; gluten has no label reading
    expect(conflicts[0]).toMatchObject({ label: { approved: false, value: "free" }, other: { source: "open_food_facts", value: "contains" } });

    const b = r.browser();
    await b.signIn(lead);
    const page = (await b.get(`/intake/${product}`)).text;
    expect(page).toContain("Label and web disagree.");
    expect(page).toContain("Milk: the label reading says “free”, Open Food Facts says “contains”. They disagree, so the label wins.");
    expect(page).toContain("Nutrition per 100 g: the label reading says “energy kcal 240, fat 10, salt 1 per 100 g”, Open Food Facts says “energy kcal 150, fat 10, salt 1 per 100 g”.");
    expect(page).toContain("This is the label's reading: it wins over the web source.");
    expect(page).toContain("Disagrees with the label: the label wins.");
    // the label's rows come first
    expect(page.indexOf("read from the label photo by a model")).toBeLessThan(page.indexOf("Open Food Facts (second opinion)"));
    // the disagreeing OFF milk row has no confirm form, only "set aside"
    const milkOff = await factOf("milk", "open_food_facts");
    expect(page).not.toContain(`action="/intake/fact/${milkOff.id}/confirm"`);
    expect(page).toContain(`action="/intake/fact/${milkOff.id}/reject"`);
    // sesame agrees (label and web page both say contains): both rows can be confirmed
    const sesameWeb = await factOf("sesame", "web_page");
    expect(page).toContain(`action="/intake/fact/${sesameWeb.id}/confirm"`);
    // the food-facts page says it too
    expect((await b.get(`/food-facts/${product}`)).text).toContain("Label and web disagree.");

    // A forged post still cannot confirm it: the database says the label wins
    const res = await b.post(`/intake/fact/${milkOff.id}/confirm`, { value: "contains", status: "declared", evidence: (await r.db.one(`select id from evidence_documents where product_id = $1 limit 1`, [product])).id });
    expect(flashOf(res.text)).toBe("The label says otherwise. Confirm the label's field (corrected where the pack differs), then set the web proposal aside.");
    await expect(r.db.rpc("review_proposed_fact", { p_fact: milkOff.id, p_by: lead.partyId, p_decision: "confirm", p_value: "contains", p_status: "declared" })).rejects.toThrow(/LABEL_DISAGREES milk/);
    expect(await factOf("milk", "open_food_facts")).toBeTruthy();                      // still waiting, nothing published
    expect(Number((await r.db.one(`select count(*) as n from product_facts where product_id = $1 and attribute = 'milk' and approved_at is not null`, [product])).n)).toBe(0);
  });

  it("confirming the label's field first, the web row is still refused when it says otherwise, and set aside cleanly", async () => {
    const b = r.browser();
    await b.signIn(lead);
    await b.get(`/intake/${product}`);
    const milkLabel = await factOf("milk", "label");
    const ev = (await r.db.one(`select id from evidence_documents where product_id = $1 limit 1`, [product])).id;
    expect(flashOf((await b.post(`/intake/fact/${milkLabel.id}/confirm`, { value: "free", status: "declared", evidence: ev })).text)).toBe("Confirmed against the pack and published.");
    // now the approved label fact is what the web row is compared with
    const conflicts = (await r.db.rpc("fact_basis_conflicts", { p_product: product })) as any[];
    expect(conflicts.find((x) => x.attribute === "milk")).toMatchObject({ label: { approved: true, value: "free" } });
    const page = (await b.get(`/intake/${product}`)).text;
    expect(page).toContain("the label (checked by a person) says “free”");
    const milkOff = await factOf("milk", "open_food_facts");
    expect(flashOf((await b.post(`/intake/fact/${milkOff.id}/reject`, { note: "the label says otherwise" })).text)).toBe("Rejected: nothing is published from it.");
    expect((await r.db.rpc("fact_basis_conflicts", { p_product: product }) as any[]).map((x) => x.attribute)).toEqual(["nutrition"]);
    // the published fact says where it came from
    const after = (await b.get(`/food-facts/${product}`)).text;
    expect(after).toContain("confirmed against the pack, from the label reading");
    expect(after).toContain("from the pack label, checked by a person");
  });

  it("a web row that agrees with the label can still be confirmed against the pack photo", async () => {
    const b = r.browser();
    await b.signIn(lead);
    await b.get(`/intake/${product}`);
    const ev = (await r.db.one(`select id from evidence_documents where product_id = $1 limit 1`, [product])).id;
    const sesameWeb = await factOf("sesame", "web_page");
    expect(flashOf((await b.post(`/intake/fact/${sesameWeb.id}/confirm`, { value: "contains", status: "declared", evidence: ev })).text)).toBe("Confirmed against the pack and published.");
    expect((await r.db.one(`select value, source from product_facts where product_id = $1 and attribute = 'sesame' and approved_at is not null and superseded_at is null`, [product])))
      .toEqual({ value: "contains", source: "label" });
    // and unknown ("the pack does not say") is never blocked by the rule: it records nothing the label contradicts
    const halal = await factOf("halal", "web_page");
    expect(flashOf((await b.post(`/intake/fact/${halal.id}/confirm`, { value: "yes", status: "unknown", evidence: ev })).text)).toBe("Confirmed against the pack and published.");
  });

  it("compares like with like: numbers within a tenth agree, ingredient lists in one language agree after spacing and case", async () => {
    const agree = (a: string, va: string | null, da: object, vb: string | null, db: object) =>
      r.db.one(`select fact_agree($1, $2, $3::jsonb, $4, $5::jsonb) as ok`, [a, va, JSON.stringify(da), vb, JSON.stringify(db)]).then((x) => x.ok as boolean);
    expect(await agree("milk", "contains", {}, "contains", {})).toBe(true);
    expect(await agree("milk", "contains", {}, "may_contain", {})).toBe(false);
    expect(await agree("vegan", "yes", {}, "no", {})).toBe(false);
    expect(await agree("nutrition", null, { values: { energy_kcal: 160, fat: 12 } }, null, { values: { energy_kcal: 165, fat: 12.2, salt: 1 } })).toBe(true);
    expect(await agree("nutrition", null, { values: { energy_kcal: 160 } }, null, { values: { energy_kcal: 200 } })).toBe(false);
    expect(await agree("nutrition", null, { values: { salt: 0.1 } }, null, { values: { salt: 0.7 } })).toBe(false);          // small figures: half a gram apart
    expect(await agree("ingredients", null, { text: "Milk, Salt.", lang: "en" }, null, { text: "milk  salt", lang: "en" })).toBe(true);
    expect(await agree("ingredients", null, { text: "Milk, salt", lang: "en" }, null, { text: "Milk, salt, sugar", lang: "en" })).toBe(false);
    expect(await agree("ingredients", null, { text: "Milk, salt", lang: "en" }, null, { text: "Lait, sel", lang: "fr" })).toBe(true);   // different languages are not compared
    expect(await agree("ingredients", null, { text: "Milk, salt" }, null, { text: "anything", lang: "en" })).toBe(true);               // a language not stated is not compared
    expect(await agree("storage", null, { text: "cool" }, null, { text: "warm" })).toBe(true);
  });

  it("a database without 0114 (staging can lag) still shows both pages, with nothing flagged", async () => {
    const lag = await rig({ without: ["fact_basis_conflicts"] });
    await openShop(lag.db);
    const p = (await lag.db.one(`select id from products where sku = 'AK-0042'`)).id;
    await lag.db.rpc("propose_off_facts", { p_product: p, p_run: "r", p_facts: [{ attribute: "milk", value: "contains", detail: { source_text: "en:milk", quote: "en:milk", off_code: "1", fingerprint: "x", basis: "off_tag" } }] });
    const l = await lag.staff("ops_lead");
    const b = lag.browser();
    await b.signIn(l);
    expect((await b.get(`/intake/${p}`)).text).toContain("listed in Open Food Facts");
    const food = await b.get(`/food-facts/${p}`);
    expect(food.status).toBe(200);
    expect(food.text).not.toContain("Label and web disagree");
  });
});
