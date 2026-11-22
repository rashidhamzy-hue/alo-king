// B1g: "Al Forno bread" (evals/cases/b1g_brand_and_type.json). Staging's names and search words are written after the seeds through
// save_search_words, the job's own door, as on staging; the planner is run on the probe's two readings and on brand-plus-type phrases of
// three aisles. Never 'not carried' while an item of the brand or the type is sellable: chosen when one fits, else «which one?».
// `without: ["0268"]` shows the fault as staging had it on 20 November.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";
import c from "../../evals/cases/b1g_brand_and_type.json";

async function stagingLike(without: string[] = []) {
  const db = await openTestDb({ without });
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500); update stock_levels set on_hand = 50;`);
  for (const [sku, name] of Object.entries(c.staging_names)) await db.pg.query(`update products set name_ar = $2 where sku = $1`, [sku, name]);
  for (const [sku, rows] of Object.entries(c.staging_terms)) {
    await db.rpc("save_search_words", { p_sku: sku, p_rows: (rows as string[][]).map(([term, level, lang]) => ({ term, level, lang })), p_version: "auto-2026-11-16" });
  }
  // the other items of these brands: staging's brand words in place of the seed's, their kind and exact words as seeded
  for (const [sku, rows] of Object.entries(c.staging_brand_terms)) {
    const kept = await db.all<{ term: string; level: string; lang: string }>(`select term, level, lang from language_pack where sku = $1 and level <> 'brand'`, [sku]);
    await db.rpc("save_search_words", { p_sku: sku, p_rows: [...(rows as string[][]).map(([term, lang]) => ({ term, level: "brand", lang })), ...kept], p_version: "auto-2026-11-16" });
  }
  await db.rpc("refresh_search_documents", {});
  const party = (await db.one(`insert into parties(role) values ('customer') returning id`)).id as string;
  const skuOf = new Map((await db.all<{ id: string; sku: string }>(`select id, sku from products`)).map((r) => [r.id, r.sku]));
  const brandOf = new Map((await db.all<{ sku: string; brand: string }>(`select sku, brand from products`)).map((r) => [r.sku, r.brand]));
  const catOf = new Map((await db.all<{ sku: string; category: string }>(`select sku, category from products`)).map((r) => [r.sku, r.category]));
  return { db, party, skuOf, brandOf, catOf };
}
type W = Awaited<ReturnType<typeof stagingLike>>;
type L = { raw: string; query: string; unit?: string; brand_hint: string | null };
const plan = async (w: W, l: L, message: string) => {
  const p = await w.db.rpc("plan_order_core", { p_party: w.party, p_village: null, p_choices: {},
    p_intent: { intent: "order", fulfilment: "delivery", language: "ar_lb", address: {}, _message: message,
                lines: [{ qty: 1, unit: l.unit ?? "each", modifiers: [], confidence: 0.9, source_hint: null, ...l }] } });
  const line = p.lines[0];
  const chosen = line.chosen ? w.skuOf.get(line.chosen.product_id) : null;
  const offered = ((line.candidates ?? []) as { product_id: string }[]).map((x) => w.skuOf.get(x.product_id)!);
  return { status: line.status as string, b4: line.b4 as string | null, chosen, offered, reached: [chosen, ...offered].filter(Boolean) as string[] };
};

describe("before 0268: the fault as staging had it on 20 November", () => {
  let w: W;
  beforeAll(async () => { w = await stagingLike(["0268"]); }, 180_000);
  afterAll(async () => { await w?.db.pg.close(); });
  it("the probe's reading «خبز الفورنو» is 'not carried' (other_kind), though the Al Forno pita is on the shelf", async () => {
    const r = await plan(w, c.probe.readings[0]!, c.probe.message);
    expect(r.status).toBe("not_found");
    expect(r.b4).toBe("other_kind");
  });
  it("the other reading «خبز» offers breads that are not Al Forno", async () => {
    const r = await plan(w, c.probe.readings[1]!, c.probe.message);
    expect(r.reached).not.toContain("AK-0080");
  });
  it("«رب البندورة اليماما» and «صدر دجاج التانمية» are 'not carried' too", async () => {
    for (const id of ["yamama-tomato-paste", "tanmia-chicken-breast"]) {
      const k = c.cases.find((x) => x.id === id)!;
      expect((await plan(w, k, k.message)).status, id).toBe("not_found");
    }
  });
});

describe("B1g: an item of the brand or the type is sellable, so the line is chosen or asked, never 'not carried'", () => {
  let w: W;
  beforeAll(async () => { w = await stagingLike(); }, 180_000);
  afterAll(async () => { await w?.db.pg.close(); });

  it.each(c.probe.readings.map((r) => [r.query, r] as const))("the probe's reading (query «%s») finds the Al Forno pita", async (_q, r) => {
    const x = await plan(w, r, c.probe.message);
    expect(x.status).not.toBe("not_found");
    // chosen, or offered first, and every row an Al Forno bread: the probe taps the first row
    expect(x.chosen ?? x.offered[0]).toBe("AK-0080");
    for (const s of x.reached) expect(w.brandOf.get(s), s).toBe("Al Forno");
  });

  it.each(c.cases.map((k) => [k.id, k] as const))("%s", async (_id, k) => {
    const x = await plan(w, k, k.message);
    expect(x.status, JSON.stringify(x)).not.toBe("not_found");
    if ("must_reach" in k) for (const s of k.must_reach!) expect(x.reached).toContain(s);
    if ("must_reach_any" in k) expect(x.reached.some((s) => k.must_reach_any!.includes(s)), JSON.stringify(x)).toBe(true);
    if ("only_brand" in k) for (const s of x.reached) expect(w.brandOf.get(s), s).toBe(k.only_brand);
    if ("never" in k) for (const s of k.never!) expect(x.reached).not.toContain(s);
    if ("chosen" in k) expect(x.chosen).toBe(k.chosen);
    if ("ask_which" in k) {
      expect(x.status).toBe("ambiguous");
      expect(x.offered.length).toBeGreaterThan(1);
      for (const s of x.offered) expect(w.catOf.get(s), s).toBe(k.sub_category);
    }
  });

  it("brand spellings are shared by the brand's items, a product's own words are not (Al Forno, Yamama, Tanmia)", async () => {
    const has = async (sku: string, term: string) =>
      !!(await w.db.one(`select exists (select 1 from language_pack where sku = $1 and level = 'brand' and lower(term) = lower($2)) as x`, [sku, term])).x;
    expect(await has("AK-0080", "الفورنو")).toBe(true);
    expect(await has("AK-0080", "forno")).toBe(true);
    expect(await has("AK-0208", "اليماما")).toBe(true);
    expect(await has("AK-0031", "التانمية")).toBe(true);
    expect(await has("AK-0209", "yamama tomato")).toBe(false);     // a word of what one item is, never spread
    expect(await has("AK-0095", "tanmia chicken")).toBe(false);
  });

  it("the guard alone: with the brand's words split again (bypassing the job's door), the line is still asked, never 'not carried'", async () => {
    await w.db.pg.query(`delete from language_pack where sku = 'AK-0080' and level = 'brand' and version = 'b1g-shared'`);
    await w.db.rpc("refresh_search_documents", {});
    const r = await plan(w, c.probe.readings[0]!, c.probe.message);
    expect(r.status).not.toBe("not_found");
    expect(r.reached).toContain("AK-0080");
    for (const s of r.reached) expect(w.brandOf.get(s), s).toBe("Al Forno");
    // nothing the word names is sellable: "not carried" stands (the honest answer, as CX2 had it)
    await w.db.pg.query(`update stock_levels set on_hand = 0 where product_id in (select id from products where brand = 'Al Forno')`);
    expect((await plan(w, c.probe.readings[0]!, c.probe.message)).status).toBe("not_found");
    await w.db.pg.query(`update stock_levels set on_hand = 50`);
    await w.db.rpc("save_search_words", { p_sku: "AK-0083", p_rows: await w.db.all(`select term, level, lang from language_pack where sku = 'AK-0083'`), p_version: "t" });
  });

  it("staging's input (0269): the line's type words left unexplained still count for the fit; Tanmia's mortadella with olives first, only mortadellas", async () => {
    // on staging the planner leaves «تنمية», «بقر» and «زيتون» unexplained for this line (read 22 Nov); 0268 then dropped all three from the fit
    const r = (await w.db.one(`select catalog_named_items($1::uuid, $2::jsonb, $3::jsonb) as r`, [w.party, JSON.stringify(["تنميه", "بقر", "زيتون"]),
      JSON.stringify({ raw: "تلاتة مرتديلا بقر مع زيتون من تنمية", query: "مرتديلا بقر مع زيتون" })])).r;
    const all = r as { product_id: string; fit: boolean }[];
    expect(w.skuOf.get(all[0]!.product_id)).toBe("AK-0096");
    expect(all.filter((x) => x.fit).map((x) => w.skuOf.get(x.product_id))).toEqual(["AK-0096"]);
  });

  it("a brand word the job writes later reaches the brand's other items too (the job's own door)", async () => {
    const kept = await w.db.all<{ term: string; level: string; lang: string }>(`select term, level, lang from language_pack where sku = 'AK-0083'`);
    await w.db.rpc("save_search_words", { p_sku: "AK-0083", p_rows: [...kept, { term: "el forno", level: "brand", lang: "arabizi" }], p_version: "t" });
    expect((await w.db.one(`select exists (select 1 from language_pack where sku = 'AK-0080' and term = 'el forno') as x`)).x).toBe(true);
    // and an item rewritten without them gets its brand's spellings back
    const own = await w.db.all<{ term: string; level: string; lang: string }>(`select term, level, lang from language_pack where sku = 'AK-0080' and lower(term) not in ('الفورنو', 'فورنو', 'forno', 'el forno')`);
    await w.db.rpc("save_search_words", { p_sku: "AK-0080", p_rows: own, p_version: "t2" });
    expect((await w.db.one(`select count(distinct lower(term))::int as n from language_pack where sku = 'AK-0080' and level = 'brand' and lower(term) in ('الفورنو', 'فورنو', 'forno', 'el forno')`)).n).toBe(4);
  });
});
