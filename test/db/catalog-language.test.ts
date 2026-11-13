// Build plan 1.22: the catalog is searched in the customer's own words (migration 0053, the pack in 0054).
// The readings below are what the live model wrote on staging on 13 Nov 2026 (docs/HANDOFF.md, A2 "Finding for lane B"):
// English generic words, a misheard brand, no brand_hint. The plan must still resolve each line to the right product,
// and must never turn a line into another kind of product.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let party: string; let sku: (id: string) => string;
const line = (raw: string, query: string, extra: Record<string, unknown> = {}) => ({ raw, query, qty: 1, unit: "each", brand_hint: null, modifiers: [], confidence: 0.8, ...extra });
const plan = (lines: unknown[], address: Record<string, unknown> = {}) =>
  db.rpc("plan_order_core", { p_party: party, p_intent: { intent: "order", fulfilment: "delivery", lines, address }, p_village: null, p_choices: {} });
const chosen = (p: any) => p.lines.map((l: any) => (l.status === "matched" ? sku(l.chosen.product_id) : l.status));

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500);
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 50;`);
  party = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
  const m = new Map((await db.all<{ id: string; sku: string }>(`select id, sku from products`)).map((r) => [r.id, r.sku]));
  sku = (id) => m.get(id) ?? "?";
}, 120_000);

describe("catalog language (1.22)", () => {
  it("the 0.13 demo message, as the live model read it, becomes the right card", async () => {
    const p = await plan([
      line("كرتونة مي تنورين", "Tannourine water carton", { unit: "pack" }),
      line("ربطة خبز الفورنو", "Al Forno bread bundle", { unit: "bundle" }),
      line("قهوة نجار", "Nassar coffee"),
    ], { village: "بعقلين", verbatim: "عبعقلين" });
    expect(chosen(p)).toEqual(["AK-0103", "AK-0080", "AK-0133"]);
    expect(p.next).toBe("card");
  });

  it("«ربطتين خبز» read as 'bread' finds Arabic bread, not nothing", async () => {
    const p = await plan([line("ربطتين خبز", "bread", { qty: 2, unit: "bundle" })]);
    expect(["AK-0080", "AK-0081", "AK-0082", "AK-0086"]).toContain(chosen(p)[0]);
  });

  it("labneh stays labneh and eggs stay eggs, even when only the brand ties", async () => {
    const p = await plan([line("علبتين لبنة ليبان ليه", "labneh Liban Lait", { qty: 2, brand_hint: "Liban Lait" }),
                          line("بيض هوا", "Hawa Chicken eggs", { brand_hint: "Hawa Chicken" })]);
    expect(["AK-0046", "AK-0051"]).toContain(chosen(p)[0]);
    expect(["AK-0049", "AK-0055"]).toContain(chosen(p)[1]);
  });

  it("a word the catalog cannot explain stops the planner from assuming: it asks", async () => {
    const p = await plan([line("قهوة نجار زنزلخت", "Najjar coffee zanzalakht")]);
    expect(p.lines[0].status).toBe("ambiguous");
    expect(p.lines[0].unexplained).toContain("زنزلخت");
    expect(p.lines[0].candidates.map((c: any) => sku(c.product_id))).toContain("AK-0133");
  });

  it("the model's phrase may choose among the products the customer's words allow, never outside them", async () => {
    await db.pg.exec(`insert into language_pack(sku, term, level, lang, version) values ('AK-0042', 'لبنة طعنايل', 'exact', 'ar', 'test')`);
    const inside = await plan([line("لبنة", "لبنة طعنايل")]);
    expect(chosen(inside)).toEqual(["AK-0042"]);
    const outside = await plan([line("لبنة", "لبن ليبان ليه")]);
    expect(chosen(outside)[0]).not.toBe("AK-0050");                    // laban is not labneh
    await db.pg.exec(`delete from language_pack where version = 'test'`);
  });

  it("words that never describe a product count neither for nor against one", async () => {
    const r = await db.rpc("catalog_pack_search", { p_text: "بدي لو سمحت كيلو بندورة" });
    expect(r[0]).toMatchObject({ sku: "AK-0002", unexplained: [] });
  });

  it("tokens fold Arabic, split numbers from units and strip clitics on both sides", async () => {
    expect(await db.rpc("catalog_tokens", { p: "بدي ٢كرتونة مي تنورين، 500ml وقهوة!" }))
      .toEqual(["بدي", "2", "كرتونه", "مي", "تنورين", "500", "ml", "وقهوه"]);
    expect(await db.rpc("catalog_token_forms", { t: "والفورنو" })).toEqual(expect.arrayContaining(["والفورنو", "فورنو"]));
    expect(await db.rpc("catalog_token_forms", { t: "بيض" })).toEqual(["بيض"]);         // no two-letter leftovers
  });

  it("pack terms are keyed by SKU, so the pack loads before or after the catalog", async () => {
    await db.pg.exec(`insert into language_pack(sku, term, level, lang, version) values ('AK-0187', 'زقزوق دومو', 'exact', 'ar', 'test'), ('AK-9999', 'لا شيء', 'kind', 'ar', 'test')`);
    const r = await db.rpc("catalog_pack_search", { p_text: "بدي زقزوق دومو" });
    expect(r[0]).toMatchObject({ sku: "AK-0187", level: 3 });
    await db.pg.exec(`delete from language_pack where version = 'test'`);
  });

  it("the pack that ships: no exact term points at two products, and no term states a food fact", async () => {
    const shared = await db.all(`select tokens, array_agg(distinct sku) as skus from language_pack where level = 'exact'
                                  group by tokens having count(distinct sku) > 1`);
    expect(shared).toEqual([]);
    const food = await db.all(`select lp.sku, lp.term from language_pack lp join products p on p.sku = lp.sku
      where lp.tokens && array['حلال','halal','gluten','غلوتين','vegan','نباتيه','صحي','healthy','حساسيه','كالوري','calories']
        and not (lower(p.name_en) ~ 'halal|gluten|vegan|vegetarian|healthy|calorie')
        and p.category not in ('Cleaning & Household', 'Beauty & Personal Care', 'Baby & Child', 'Pet Zone')
        and not lp.term ~ '^(زيت|سمنة|سمنه) نباتي'`);
    expect(food).toEqual([]);
  });

  it("negation rules a product out: «مش البانيه», «bala zaytoun»", async () => {
    const r = await db.rpc("catalog_pack_search", { p_text: "مرتديلا تنمية بلا زيتون" });
    expect(r.map((m: any) => m.sku)).not.toContain("AK-0096");                // the one with olives
    expect(await db.rpc("catalog_negated", { p_tokens: ["msh", "l", "pane", "400"] })).toEqual([2, 3]);
  });

  it("the pack's precomputed tokens and forms are exactly what the SQL functions give", async () => {
    expect(await db.all(`select sku, term from language_pack
      where tokens <> catalog_tokens(term) or not (forms @> catalog_term_forms(term) and forms <@ catalog_term_forms(term))`)).toEqual([]);
    await db.pg.exec(`insert into language_pack(sku, term, level, lang, version) values ('AK-0187', 'نشا الذرة الكبير', 'exact', 'ar', 'test')`);
    expect(await db.one(`select tokens, forms @> array['kbir', 'ذره'] as ok from language_pack where version = 'test'`)).toEqual({ tokens: ["نشا", "الذره", "الكبير"], ok: true });
    await db.pg.exec(`delete from language_pack where version = 'test'`);
  });

  it("a named restaurant still goes the 1.2 way", async () => {
    const r = await db.rpc("catalog_lookup", { p_raw: "برغر من سناك أبو علي", p_query: "cheeseburger", p_source_hint: "Snack Abou Ali" });
    expect(r).toMatchObject({ reason: "merchant_not_onboarded", via: "legacy" });
  });
});
