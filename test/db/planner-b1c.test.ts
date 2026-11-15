// Session B1c (wrong products, part 3): the planner never picks one product for a generic word or a brand alone, and never a size
// the customer did not say. Cases: evals/cases/b1c_wrong_products.json (sim-test 43756167947, B1b's second run on main), the
// examples of the B1c prompt («ربطة خبز», «قنينة مي», "Pepsi"), on the real catalog seeds. Migration 0138.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let party: string; let skuOf: Map<string, string>; let idOf: Map<string, string>;
beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`update stock_levels set on_hand = 50`);
  party = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
  const rows = await db.all<{ id: string; sku: string }>(`select id, sku from products`);
  skuOf = new Map(rows.map((r) => [r.id, r.sku])); idOf = new Map(rows.map((r) => [r.sku, r.id]));
}, 120_000);
afterAll(async () => { await db?.pg.close(); });

const line = (raw: string, query = raw, extra: Record<string, unknown> = {}) =>
  ({ raw, query, qty: 1, unit: "each", modifiers: [], brand_hint: null, source_hint: null, confidence: 0.8, ...extra });
async function plan(lines: unknown[], message?: string, who = party) {
  return db.rpc("plan_order_core", { p_party: who, p_intent: { intent: "order", lines, ...(message ? { _message: message } : {}) }, p_village: null, p_choices: {} });
}
const skus = (xs: { product_id: string }[] | null) => (xs ?? []).map((x) => skuOf.get(x.product_id));

describe("a generic word is a question, never one product (B1c fix 1)", () => {
  it.each([
    ["قنينة مي", "water bottle"],             // the prompt's own example: Nejmeh 2 L was chosen
    ["عدس", "lentils"],                       // sim-029: Zain lentils
    ["wet wipes", "wet wipes"],               // sim-021: Wellplus, by the model's phrase
    ["tomato paste", "tomato paste"],         // sim-077: the 1325 G tin
    ["لبن", "laban"],                         // sim-052: Mazaraana laban 1 kg
    ["mortadelle", "mortadella"],             // sim-025: Al Mouna
    ["ورق حمام ربطة صغيرة", "toilet paper small pack"],   // sim-048
  ])("«%s» is ambiguous, with at most three candidates", async (raw, query) => {
    const p = await plan([line(raw, query)], raw);
    const l = p.lines[0];
    expect(l.status, JSON.stringify([skuOf.get(l.chosen?.product_id), l.b4])).toBe("ambiguous");
    expect(l.chosen).toBeNull();
    expect(l.candidates.length).toBeGreaterThan(1);
    expect(l.candidates.length).toBeLessThanOrEqual(3);
    expect(p.next).toBe("ask");
  });

  it("«ربطة خبز» (the prompt's own example) with no house default is the question too", async () => {
    await db.pg.query(`update products set house_default = false where sku = 'AK-0080'`);
    try {
      const p = await plan([line("ربطة خبز", "bread")], "ربطة خبز");
      expect(p.lines[0].status).toBe("ambiguous");
      expect(p.lines[0].candidates.length).toBeLessThanOrEqual(3);
    } finally { await db.pg.query(`update products set house_default = true where sku = 'AK-0080'`); }
  });

  it("the question offers the fastest sellers first: a slow seller never comes before a faster one of the same fit", async () => {
    await db.pg.query(`update products set house_default = false where sku = 'AK-0080'`);
    const p = await plan([line("ربطة خبز", "bread")], "ربطة خبز");
    await db.pg.query(`update products set house_default = true where sku = 'AK-0080'`);
    const tiers = await db.all<{ sku: string; velocity_tier: string }>(`select sku, velocity_tier from products where id = any($1::uuid[])`,
      [p.lines[0].candidates.map((c: { product_id: string }) => c.product_id)]);
    const order = skus(p.lines[0].candidates).map((s) => tiers.find((t) => t.sku === s)!.velocity_tier);
    expect(order).toEqual([...order].sort());
    expect(skus(p.lines[0].candidates)).not.toContain("AK-0086");    // Pain d'Or is the slowest (C) of the four loaves
  });

  it("every product the words fit is listed in `tied`, so an edit can find the one already in the basket", async () => {
    const p = await plan([line("wet wipes")], "wet wipes");
    expect(new Set(skus(p.lines[0].tied))).toEqual(new Set(["AK-0269", "AK-0283", "AK-0284"]));
  });

  it("a brand alone with one product is that product («Gorosti», sim-016; Snickers), marked pick = only", async () => {
    const p = await plan([line("Gorosti", "Gorosti turkey breast")], "مرحبا، كيفك؟ بدي Gorosti لو سمحت");
    expect(p.lines[0].status).toBe("matched");
    expect(skuOf.get(p.lines[0].chosen.product_id)).toBe("AK-0092");
    expect(p.lines[0].pick).toBe("only");
  });

  it("a brand alone with several products is a question («نجار»: which coffee)", async () => {
    await db.pg.query(`update products set house_default = false where sku = 'AK-0133'`);
    try {
      const p = await plan([line("نجار", "Najjar")], "بدي نجار");
      expect(p.lines[0].status).toBe("ambiguous");
      expect(p.lines[0].candidates.length).toBeGreaterThan(1);
    } finally { await db.pg.query(`update products set house_default = true where sku = 'AK-0133'`); }
  });

  it("a longer brand with a word the pack does not know keeps the model's phrase («kis 6a7in Gold Medal», gate case g0001)", async () => {
    const p = await plan([line("kis 6a7in Gold Medal 1 kilo", "Gold Medal flour 1kg", { brand_hint: "Gold Medal" })],
      "Marhaba 3amo, baddi 2 kilo batata, kis 6a7in Gold Medal 1 kilo");
    expect(p.lines[0].status).not.toBe("not_found");
  });

  it("\"Pepsi\" is a question (the prompt's example)", async () => {
    const p = await plan([line("Pepsi")], "Pepsi");
    expect(p.lines[0].status).toBe("ambiguous");
    expect(p.lines[0].candidates.length).toBeLessThanOrEqual(3);
  });

  it("a brand heard in another word, with the customer's other words left over, is not that brand («سيكس باك بيرة», sim-093)", async () => {
    const p = await plan([line("سيكس باك بيرة", "six pack beer")], "مرحبا، بدي سيكس باك بيرة لو سمحت");
    expect(p.lines[0].status).toBe("not_found");
    expect(p.lines[0].candidates ?? []).toEqual([]);
  });

  it("«تنتين ... ٢ ليتر»: the 2 before a unit is the size, not the count, so it never picks the 6 L gallon (sim-139)", async () => {
    // The reading's qty (2, «تنتين») explained the «٢» of «٢ ليتر» too, and «ربطة ٦» then named the gallon alone.
    const p = await plan([line("مي تنورين ٢ ليتر ربطة ٦", "Tannourine water 2L pack of 6", { qty: 2 })], "بدي لو نوبا ويفر حبة وتنتين مي تنورين ٢ ليتر ربطة ٦");
    expect(skuOf.get(p.lines[0].chosen?.product_id) ?? null).not.toBe("AK-0109");
    if (p.lines[0].status === "ambiguous") expect(skus(p.lines[0].candidates)).toContain("AK-0103");
    else expect(skuOf.get(p.lines[0].chosen.product_id)).toBe("AK-0103");
    // a count said before a unit of weight stays the count («2 kilo batata»)
    const q = await plan([line("2 kilo batata", "potato", { qty: 2, unit: "kg" })], "baddi 2 kilo batata");
    expect(skuOf.get(q.lines[0].chosen.product_id)).toBe("AK-0001");
  });

  it("brand and kind with two sizes left is a question, not the best seller («خبز وودن بيكري»)", async () => {
    const p = await plan([line("خبز وودن بيكري", "Wooden Bakery bread", { brand_hint: "Wooden Bakery" })], "بدي خبز وودن بيكري");
    expect(p.lines[0].status).toBe("ambiguous");
    expect(new Set(skus(p.lines[0].candidates))).toEqual(new Set(["AK-0081", "AK-0082"]));
  });

  it("«قنينة مي»: the single bottle fits best, so no 6-pack default is given for it; the question", async () => {
    const p = await plan([line("قنينة مي", "water bottle")], "قنينة مي");
    expect(p.lines[0].status).toBe("ambiguous");
  });

  it("bought before is no reason to choose for a generic word", async () => {
    const who = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
    const o = (await db.one(`insert into orders(customer_id, short_code, status) values ($1, 'AK-B1C1', 'delivered') returning id`, [who])).id;
    const f = (await db.one(`insert into fulfilments(order_id, source_id) select $1, id from sources where kind = 'dark_store' limit 1 returning id`, [o])).id;
    await db.pg.query(`insert into order_items(order_id, fulfilment_id, product_id, name_snapshot, qty, unit_price_usd) values ($1, $2, $3, 'x', 1, 1.01)`,
      [o, f, idOf.get("AK-0086")]);
    const p = await plan([line("ربطة خبز", "bread")], "ربطة خبز", who);
    expect(skuOf.get(p.lines[0].chosen?.product_id) ?? null).not.toBe("AK-0086");
  });
});

describe("what the customer named exactly is still chosen", () => {
  it.each([
    ["Kinder Chocolate Barrette Maxi 21G", "AK-0"],
    ["Yamama Tomato Paste 660G", "AK-0210"],
    ["لبنة ليبان ليه 900 غ", "AK-0"],
    ["بطاطا", "AK-0001"],
    ["Oui Oui Wet Wipes Aqua Pure 80 sheets", "AK-0284"],
  ])("«%s»", async (raw, sku) => {
    const p = await plan([line(raw)], raw);
    expect(p.lines[0].status, JSON.stringify(skus(p.lines[0].candidates))).toBe("matched");
    expect(skuOf.get(p.lines[0].chosen.product_id)).toMatch(new RegExp(`^${sku}`));
  });
});

describe("the house default (products.house_default): used, and said", () => {
  it("the proposed defaults (the founder's hand cases): «ربطتين خبز» is Al Forno's pita, «مي تنورين» the 2 L x6", async () => {
    const p = await plan([line("ربطتين خبز", "bread", { qty: 2 }), line("مي تنورين", "Tannourine water")], "ربطتين خبز ومي تنورين");
    expect(p.lines.map((l: any) => skuOf.get(l.chosen?.product_id))).toEqual(["AK-0080", "AK-0103"]);
    expect(p.lines.map((l: any) => l.pick)).toEqual(["house", "house"]);
  });

  it("a generic word with one house default among the products it fits takes it, marked pick = house", async () => {
    await db.pg.query(`update products set house_default = (sku = 'AK-0082') where sku in ('AK-0082', 'AK-0080')`);
    try {
      const p = await plan([line("ربطة خبز", "bread", { qty: 2 })], "بدي ربطتين خبز");
      expect(p.lines[0].status).toBe("matched");
      expect(skuOf.get(p.lines[0].chosen.product_id)).toBe("AK-0082");
      expect(p.lines[0].pick).toBe("house");
      expect(p.lines[0].assumed).toBe(true);
      // the default is the shop's choice for the kind, never for a brand the customer named that is not it
      const q = await plan([line("خبز الفورنو", "Al Forno bread", { brand_hint: "Al Forno" })], "بدي خبز الفورنو");
      expect(skuOf.get(q.lines[0].chosen?.product_id) ?? null).not.toBe("AK-0082");
    } finally { await db.pg.query(`update products set house_default = (sku = 'AK-0080') where sku in ('AK-0082', 'AK-0080')`); }
  });

  it("two house defaults among the same words: no default, the question", async () => {
    await db.pg.query(`update products set house_default = true where sku in ('AK-0082', 'AK-0080')`);
    try {
      const p = await plan([line("ربطة خبز", "bread")], "ربطة خبز");
      expect(p.lines[0].status).toBe("ambiguous");
    } finally { await db.pg.query(`update products set house_default = (sku = 'AK-0080') where sku in ('AK-0082', 'AK-0080')`); }
  });
});
