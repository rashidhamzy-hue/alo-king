// The facts step against the real migrations (PGlite): what is filed, what is refused, and that nothing can become a fact a customer hears.
// Open Food Facts and the model are replaced; the SQL is the SQL that ships.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb } from "../../../test/db/harness";
import { processItem, summarise } from "../fetch-product-data.mjs";

const PASTA = {
  code: "8076802085738", product_name: "Spaghetti n.5", brands: "Barilla", quantity: "500 g", lang: "en", last_modified_t: 1700000000,
  ingredients_text: "Durum wheat semolina, water. May contain traces of egg and soy.",
  allergens: "en:gluten", allergens_tags: ["en:gluten"], traces: "en:eggs,en:soybeans", traces_tags: ["en:eggs", "en:soybeans"],
  labels_tags: ["en:halal"], ingredients_analysis_tags: ["en:vegan", "en:vegetarian"],
  nutriments: { "energy-kcal_100g": 359, fat_100g: 2, carbohydrates_100g: 71, proteins_100g: 13 }, nutrition_data_per: "100g",
};
const MAPPED = { allergens: [{ code: "gluten", field: "ingredients", value: "contains", quote: "wheat" }], ingredients_ar: "سميد القمح القاسي، ماء. قد يحتوي على آثار من البيض وفول الصويا." };

let db; let items; let ops; let picker;
const counts = { off: 0, map: 0 };
const mk = (over = {}) => ({
  runId: "run-1", model: "fast-model", now: () => new Date("2026-11-13T10:00:00Z"),
  off: async () => { counts.off++; return { found: true, code: "8076802085738", product: PASTA }; },
  map: async () => { counts.map++; return MAPPED; },
  store: { rpc: (fn, args) => db.rpc(fn, args) },
  ...over,
});
const facts = (product, extra = "") => db.all(`select * from product_facts where product_id = $1 and source = 'open_food_facts' ${extra} order by attribute`, [product]);
const current = (product) => facts(product, "and approved_at is null and superseded_at is null");

beforeAll(async () => {
  db = await openTestDb();
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker') returning id`)).id;
  items = await db.rpc("product_data_to_fetch");
});

describe("which items are looked up", () => {
  it("only items with a real product number: not the store's own 2xx codes, and not the ones with no barcode", async () => {
    const cat = await db.rpc("product_data_catalog");
    const coverage = await db.rpc("product_data_coverage");
    expect(items.length).toBe(coverage.lookup_candidates);
    expect(coverage.lookup_candidates + coverage.internal_codes + coverage.without_barcode).toBe(coverage.products);
    expect(coverage.products).toBe(291);
    expect(coverage.without_barcode).toBe(34);
    expect(coverage.internal_codes).toBeGreaterThan(20);
    expect(items.every((i) => /^\d{6,}$/.test(i.barcode) && !/^2\d{12}$/.test(i.barcode))).toBe(true);
    expect(items.find((i) => i.sku === "AK-0042")).toBeUndefined();            // Leen Taanayel Labneh, 2201340000000
    expect(cat.length).toBe(291);
    expect(cat[0]).toMatchObject({ sku: "AK-0001", name_en: "Potato" });
  });
});

describe("filing a product", () => {
  it("files proposals with the source beside each, as status partial and source open_food_facts, none approved", async () => {
    const item = items[0];
    const r = await processItem(item, mk());
    expect(r).toMatchObject({ outcome: "proposed" });
    const rows = await facts(item.product_id);
    const attrs = rows.map((x) => x.attribute);
    expect(attrs).toEqual(expect.arrayContaining(["gluten", "eggs", "soy", "ingredients", "nutrition", "halal", "vegan", "vegetarian"]));
    for (const x of rows) {
      expect(x).toMatchObject({ status: "partial", source: "open_food_facts", approved_at: null, approved_by: null, proposed_by: null, superseded_at: null });
      expect(x.detail.source_text.length).toBeGreaterThan(0);
      expect(x.detail).toMatchObject({ off_code: "8076802085738", run_id: "run-1", proposal_only: true });
    }
    const ing = rows.find((x) => x.attribute === "ingredients");
    expect(ing.detail).toMatchObject({ text: PASTA.ingredients_text, ar_by: "model" });
    expect(ing.detail.ar).toMatch(/سميد/);
    expect(rows.find((x) => x.attribute === "gluten")).toMatchObject({ value: "contains" });
    expect(rows.find((x) => x.attribute === "eggs")).toMatchObject({ value: "may_contain" });
    const att = await db.one(`select * from product_data_attempts where product_id = $1`, [item.product_id]);
    expect(att).toMatchObject({ outcome: "proposed", run_id: "run-1" });
    expect(att.detail.off).toMatchObject({ name: "Spaghetti n.5", brands: "Barilla", quantity: "500 g" });
  });

  it("nothing proposed is a fact: a customer-side read returns nothing, and a restriction check stays unknown", async () => {
    const p = items[0].product_id;
    expect(await db.rpc("product_food_facts", { p_product: p })).toEqual([]);
    const gluten = await db.rpc("product_meets_restrictions", { p_product: p, p_restrictions: ["gluten", "halal", "vegan"] });
    expect(gluten.meets).toBe(false);
    expect(gluten.checks.map((c) => [c.restriction, c.result, c.reason])).toEqual([["gluten", "unknown", "no_approved_record"], ["halal", "unknown", "no_approved_record"], ["vegan", "unknown", "no_approved_record"]]);
  });

  it("code cannot approve it: the function refuses, and so does the table, even for a direct update", async () => {
    const p = items[0].product_id;
    const [f] = await current(p);
    await expect(db.rpc("approve_product_fact", { p_fact: f.id, p_by: ops })).rejects.toThrow(/SECOND_OPINION_ONLY/);
    await expect(db.pg.query(`update product_facts set approved_by = $1, approved_at = now() where id = $2`, [ops, f.id])).rejects.toThrow(/product_facts_off_never_approved/);
    await expect(db.pg.query(`insert into product_facts(product_id, attribute, value, status, source, approved_by, approved_at, reviewed_at) values ($1, 'milk', 'free', 'declared', 'open_food_facts', $2, now(), now())`, [p, ops])).rejects.toThrow(/product_facts_off_never_approved/);
    expect((await db.rpc("product_data_coverage")).approved_from_open_food_facts).toBe(0);
  });

  it("a person confirms against the pack and records it as a label fact; that is what a customer may hear, and a rerun leaves it alone", async () => {
    const p = items[0].product_id;
    const label = await db.rpc("propose_product_fact", { p_product: p, p_attribute: "gluten", p_value: "contains", p_status: "declared", p_source: "label", p_by: picker });
    await db.rpc("approve_product_fact", { p_fact: label, p_by: ops });
    const before = await facts(p, "and attribute = 'gluten'");
    const r = await processItem(items[0], mk({ runId: "run-2" }));
    expect(r.skipped.gluten).toBe("approved_exists");
    expect(await facts(p, "and attribute = 'gluten'")).toEqual(before);
    const approved = await db.one(`select * from product_facts where id = $1`, [label]);
    expect(approved).toMatchObject({ source: "label", superseded_at: null });
    expect(approved.approved_at).not.toBeNull();
    expect((await db.rpc("product_meets_restrictions", { p_product: p, p_restrictions: ["gluten"] })).checks[0].result).toBe("fails");
  });
});

describe("rerun", () => {
  it("an unchanged record is not proposed again, and the item is not looked up again", async () => {
    const item = items[1];
    await processItem(item, mk());
    const n = (await facts(item.product_id)).length;
    const again = await processItem(item, mk({ runId: "run-2" }));
    expect(Object.keys(again.skipped).length).toBe(n);
    expect(new Set(Object.values(again.skipped))).toEqual(new Set(["unchanged"]));
    expect((await facts(item.product_id)).length).toBe(n);
    expect((await db.rpc("product_data_to_fetch")).find((i) => i.sku === item.sku)).toBeUndefined();
    expect((await db.rpc("product_data_to_fetch", { p_force: true })).find((i) => i.sku === item.sku)).toBeDefined();
  });

  it("a changed record supersedes the old proposal and keeps it as history; one current proposal per attribute", async () => {
    const item = items[1];
    const changed = { ...PASTA, ingredients_text: "Durum wheat semolina, water, sesame", traces: "", traces_tags: [] };
    await processItem(item, mk({ runId: "run-3", off: async () => ({ found: true, code: "8076802085738", product: changed }) }));
    const ing = await facts(item.product_id, "and attribute = 'ingredients'");
    expect(ing.length).toBe(2);
    expect(ing.filter((x) => x.superseded_at === null).length).toBe(1);
    const old = ing.find((x) => x.superseded_at !== null);
    expect(old.superseded_by).toBe(ing.find((x) => x.superseded_at === null).id);
    expect(old.detail.text).toBe(PASTA.ingredients_text);
  });

  it("an error is recorded and tried again; a product Open Food Facts does not have is recorded once and left", async () => {
    const [a, b] = [items[2], items[3]];
    const boom = await processItem(a, mk({ off: async () => { throw new Error("off_http_429"); } }));
    expect(boom).toMatchObject({ outcome: "error", error: "off_http_429" });
    expect((await db.rpc("product_data_to_fetch")).find((i) => i.sku === a.sku)).toBeDefined();
    const miss = await processItem(b, mk({ off: async () => ({ found: false, reason: "not_in_off" }) }));
    expect(miss.outcome).toBe("not_in_off");
    expect((await db.rpc("product_data_to_fetch")).find((i) => i.sku === b.sku)).toBeUndefined();
    expect(await facts(b.product_id)).toEqual([]);
    const att = await db.one(`select outcome, detail from product_data_attempts where product_id = $1`, [b.product_id]);
    expect(att).toMatchObject({ outcome: "not_in_off", detail: { reason: "not_in_off" } });
  });

  it("a model failure files nothing for that item (the item is tried again), and a refused key stops the run", async () => {
    const item = items[4];
    const r = await processItem(item, mk({ map: async () => { throw new Error("model_http_529"); } }));
    expect(r.outcome).toBe("error");
    expect(await facts(item.product_id)).toEqual([]);
    const { Fatal } = await import("../fetch-product-data.mjs");
    await expect(processItem(item, mk({ map: async () => { throw new Fatal("model_http_401"); } }))).rejects.toThrow(/401/);
  });

  it("a record with nothing usable is recorded as found, with the reasons", async () => {
    const item = items[5];
    const r = await processItem(item, mk({ off: async () => ({ found: true, code: "1234567", product: { code: "1234567", product_name: "Mystery", nutriments: {} } }) }));
    expect(r.outcome).toBe("found_nothing_usable");
    expect(await facts(item.product_id)).toEqual([]);
    // The run summary must take every shape processItem returns (a number here crashed the first staging run after all items were done).
    const s = summarise([r, { sku: "x", outcome: "not_in_off", reason: "not_in_off" }, { sku: "y", outcome: "error", error: "e" }]);
    expect(s.outcomes).toEqual({ found_nothing_usable: 1, not_in_off: 1, error: 1 });
  });
  it("a found record whose facts are all refused reports what was refused", async () => {
    const item = items[6];
    const r = await processItem(item, mk({ map: async () => ({ allergens: [], ingredients_ar: "" }), off: async () => ({ found: true, code: "1234567", product: { code: "1234567", product_name: "Mystery", ingredients_text: "x".repeat(7000), nutriments: { fat_100g: 500 } } }) }));
    expect(r.outcome).toBe("found_nothing_usable");
    expect(r.rejected.map((x) => x.kind).sort()).toEqual(["ingredients", "nutrition"]);
    expect(summarise([r]).refused_by_checks).toEqual({ "ingredients:too_long": 1, "nutrition:too_few_values": 1 });
  });
});

describe("the database refuses what the script should never send (0073)", () => {
  const good = (over = {}) => ({ attribute: "milk", value: "contains", detail: { source_text: "Contains: milk, wheat", quote: "milk", off_code: "123456", fingerprint: "fp-1", ...over } });
  const send = (facts) => db.rpc("propose_off_facts", { p_product: items[10].product_id, p_run: "t", p_facts: facts });

  it("the happy path files it, as a proposal", async () => {
    const r = await send([good()]);
    expect(Object.keys(r.proposed)).toEqual(["milk"]);
    expect((await current(items[10].product_id))[0]).toMatchObject({ attribute: "milk", value: "contains", status: "partial", approved_at: null });
  });
  it("Open Food Facts never says free", async () => {
    await expect(send([good({}), { ...good(), attribute: "sesame", value: "free" }])).rejects.toThrow(/OFF_NEVER_SAYS_FREE/);
  });
  it("a quote that is not in the source text is refused", async () => {
    await expect(send([{ ...good({ quote: "peanuts" }), attribute: "peanuts" }])).rejects.toThrow(/QUOTE_NOT_IN_SOURCE/);
    await expect(send([{ ...good({ quote: "" }), attribute: "peanuts" }])).rejects.toThrow(/QUOTE_NOT_IN_SOURCE/);
  });
  it("a value with no source text, no code or no fingerprint is refused", async () => {
    await expect(send([{ ...good(), attribute: "eggs", detail: { quote: "egg", off_code: "1", fingerprint: "x" } }])).rejects.toThrow(/OFF_NO_SOURCE_TEXT/);
    await expect(send([{ ...good({ off_code: "" }), attribute: "eggs" }])).rejects.toThrow(/OFF_NO_CODE/);
    await expect(send([{ ...good({ fingerprint: "" }), attribute: "eggs" }])).rejects.toThrow(/OFF_NO_FINGERPRINT/);
  });
  it("an allergen takes contains or may_contain; a diet takes yes or no; ingredients take no value; an unknown attribute is refused", async () => {
    await expect(send([{ ...good(), attribute: "eggs", value: "maybe" }])).rejects.toThrow(/OFF_ALLERGEN_VALUE/);
    await expect(send([{ ...good({ source_text: "halal", quote: "halal" }), attribute: "halal", value: "contains" }])).rejects.toThrow(/OFF_DIET_VALUE/);
    await expect(send([{ attribute: "ingredients", value: "yes", detail: good().detail }])).rejects.toThrow(/OFF_VALUE_NOT_ALLOWED/);
    await expect(send([{ ...good(), attribute: "kiwi" }])).rejects.toThrow(/FACT_ATTRIBUTE_UNKNOWN/);
  });
  it("all or nothing: one bad fact saves nothing for that product", async () => {
    const p = items[11].product_id;
    await expect(db.rpc("propose_off_facts", { p_product: p, p_run: "t", p_facts: [{ ...good(), attribute: "fish", detail: { ...good().detail, quote: "fish", source_text: "fish" } }, { ...good(), attribute: "eggs", value: "free" }] })).rejects.toThrow();
    expect(await facts(p)).toEqual([]);
  });
});

describe("counts for the report", () => {
  it("coverage counts current proposals by kind, and says how many came from Open Food Facts approved (none)", async () => {
    const c = await db.rpc("product_data_coverage");
    expect(c.proposals).toBeGreaterThan(8);
    expect(c.products_with.ingredients).toBeGreaterThanOrEqual(2);
    expect(c.products_with.ingredients_in_arabic).toBe(c.products_with.ingredients);
    expect(c.products_with.nutrition).toBeGreaterThanOrEqual(2);
    expect(c.products_with.allergen_may_contain).toBeGreaterThanOrEqual(2);
    expect(c.products_with.halal).toBeGreaterThanOrEqual(2);
    expect(c.not_in_open_food_facts).toBe(1);
    expect(c.errors).toBe(2);
    expect(c.approved_from_open_food_facts).toBe(0);
    expect(c.not_yet_tried).toBe(c.lookup_candidates - c.found_in_open_food_facts - c.not_in_open_food_facts - c.errors);
  });

  it("the run summary counts outcomes, refusals and errors by name", () => {
    const s = summarise([{ sku: "a", outcome: "proposed", skipped: { milk: "unchanged" }, rejected: [{ kind: "allergen", reason: "quote_not_in_source" }] }, { sku: "b", outcome: "error", error: "off_http_429" }, { sku: "c", outcome: "not_in_off" }]);
    expect(s).toMatchObject({ processed: 3, outcomes: { proposed: 1, error: 1, not_in_off: 1 }, errors_by_message: { off_http_429: 1 }, refused_by_checks: { "allergen:quote_not_in_source": 1 }, skipped_by_reason: { unchanged: 1 } });
  });
});
