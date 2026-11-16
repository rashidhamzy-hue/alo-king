// SR1: search by meaning and facts (0212 to 0216), on the real migrations with the seeded test facts (evals/search/facts.json).
// The meaning list is tested with small invented vectors under a test model name: what is tested is the SQL (the nearest items, the
// distance cut, the fusion, the cache), not a model. The flows run through the real turn code with a scripted reading.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { asSupabase } from "./harness";
import { flow, openFlowDb, read, recordKapso, type Sent } from "./flow-kit";
import { seedSearchFacts } from "./search-kit";
import { searchProducts } from "@ak/agents/search";
import type { Embedder } from "@ak/agents/embeddings";
import { readSearch } from "@ak/agents/search-reading";
import { REQUESTS } from "../../evals/search/score";

/** The heading of a list of items that fit, in any language (messages.honest.fits). */
const FITS = /What fits|Ce qui convient|هيدول يلي بيناسبوا/;

let db: TestDb; let idOf: Map<string, string>; let skuOf: Map<string, string>;
beforeAll(async () => { ({ db } = await openFlowDb()); ({ idOf, skuOf } = await seedSearchFacts(db)); }, 300_000);
afterAll(async () => { await db?.pg.close(); });
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(() => { vi.unstubAllGlobals(); });

const find = async (q: string, filters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  db.rpc<any>("find_products", { p_query: q, p_filters: filters, p_limit: 8, p_embedding: null, p_model: null, p_cache_key: null, ...extra });
const skus = (r: any) => (r.matches as any[]).map((m) => skuOf.get(m.product_id));
const bodyOf = (s: Sent): string => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";

describe("SR1 (3): filters by approved facts only", () => {
  it("a fact filter passes only fact-complete items; unknown never passes", async () => {
    const r = await find("chips", { free_of: ["peanuts"] });
    expect(skus(r)).toEqual(["AK-0161"]);                       // the only chips with an approved allergen list that has no peanuts
    expect(r.failed.not_fact_complete).toBeGreaterThan(0);      // the other chips are unknown, and unknown never passes
    expect(r.failed.restriction).toBe(1);                       // Snack Jiha: contains peanuts
  });
  it("'may contain' fails a stated allergy (a restriction, never a preference)", async () => {
    const r = await find("protein bar", { free_of: ["peanuts"] });
    expect(skus(r)).toEqual([]);
    expect(r.reason).toBe("none_pass");
  });
  it("a food filter never passes on a non-food item, and a non-food filter uses the template's own fields", async () => {
    expect(skus(await find("shampoo", { sugar: "none" }))).toEqual([]);
    expect(skus(await find("shampoo", { claims: ["fragrance_free"], audience: "kids" }))).toEqual(["SR1T-004"]);
    expect(skus(await find("cat food", { species: "cat", life_stage: ["baby", "young", "adult", "senior", "all"] })).sort()).toEqual(["AK-0289", "AK-0290"]);
    expect(skus(await find("cat food", { species: "cat", life_stage: ["baby", "young"] }))).toEqual([]);
    expect(skus(await find("diapers", { age_months: 24 }))).toEqual(["AK-0288"]);
  });
  it("an audience on food ranks (a shopping tag), it never filters", async () => {
    const r = await find("juice", { audience: "kids" });
    expect(skus(r).length).toBeGreaterThan(3);                  // juices without the tag still come back
    expect(["AK-0114", "AK-0119", "AK-0120"]).toContain(skus(r)[0]);
  });
  it("a filter it does not know fails closed: nothing passes", async () => {
    const r = await find("chips", { sugar_frees: true });
    expect(skus(r)).toEqual([]);
    expect(r.failed.unknown_filter).toBeGreaterThan(0);
  });
  it("each match carries the approved records that made it pass, with their source", async () => {
    const r = await find("protein bars", { sugar: "none" });
    expect(skus(r)).toEqual(["SR1T-001"]);
    expect(r.matches[0].evidence).toEqual([{ kind: "claim", code: "no_added_sugar", quote: "No added sugar", source: "label_photo" }]);
    const n = await find("drinks", { sugar: "none" });
    expect(n.matches.find((m: any) => skuOf.get(m.product_id) === "AK-0112").evidence[0]).toMatchObject({ kind: "nutrition", key: "sugars_g", value: 0 });
  });
  it("a fact withdrawn after approval no longer passes (no cache of facts)", async () => {
    const id = idOf.get("SR1T-001")!;
    await db.pg.query(`update product_claims set status = 'superseded' where product_id = $1 and claim_code = 'no_added_sugar'`, [id]);
    try { expect(skus(await find("protein bars", { sugar: "none" }))).toEqual([]); }   // its panel says 1.2 g: above 0.5, no claim left
    finally { await db.pg.query(`update product_claims set status = 'approved' where product_id = $1 and claim_code = 'no_added_sugar'`, [id]); }
  });
  it("only facts said, no kind: every item with an approved record is a candidate", async () => {
    const r = await find("", { sugar: "none" }, { p_limit: 30 });
    expect(skus(r)).toEqual(expect.arrayContaining(["SR1T-003", "AK-0122", "AK-0112"]));
    expect(skus(r)).not.toContain("SR1T-002");
  });
});

describe("SR1 (2, 5): the meaning list, fused with the word list; the cache, the cap, the cost, the fallback", () => {
  const MODEL = "test-3d";
  beforeAll(async () => {
    // three invented directions: "sweet" items, "cleaning" items, and the rest far away
    const vec: Record<string, string> = { "SR1T-003": "[1,0.1,0]", "AK-0247": "[0.95,0.2,0]", "SR1T-001": "[0.9,0.3,0.1]", "AK-0256": "[0,0,1]" };
    for (const [sku, v] of Object.entries(vec))
      await db.rpc("save_product_embeddings", { p_model: MODEL, p_rows: [{ product_id: idOf.get(sku), digest: "x", embedding: JSON.parse(v) }] });
    await db.pg.query(`insert into model_prices(model, effective_from, input_usd_per_mtok, output_usd_per_mtok, source) values ($1, '2026-11-01', 0.012, 0, 'test')`, [MODEL]);
    await db.pg.query(`update settings set value = value || '{"embeddings": "on", "model": "test-3d", "daily_cap_usd": 0.5}'::jsonb where key = 'search'`);
  });
  it("an item found by meaning alone comes back; a far one does not", async () => {
    const r = await find("something crunchy for school", {}, { p_embedding: "[1,0,0]", p_model: MODEL });
    expect(skus(r).slice(0, 3)).toEqual(["SR1T-003", "AK-0247", "SR1T-001"]);
    expect(skus(r)).not.toContain("AK-0256");                   // the bleach: distance 1, past meaning_max_distance
    expect(r.meaning).toBe("given");
  });
  it("the two lists are fused: an item on both outranks one on either", async () => {
    const r = await find("rice cakes", {}, { p_embedding: "[0.9,0.3,0.1]", p_model: MODEL });  // words: the two rice cakes; meaning: SR1T-001 first
    expect(skus(r)[0]).toMatch(/SR1T-003|AK-0247/);
    expect(skus(r)).toContain("SR1T-001");
  });
  it("hard filters apply to meaning matches too", async () => {
    const r = await find("something crunchy for school", { free_of: ["gluten"] }, { p_embedding: "[1,0,0]", p_model: MODEL });
    expect(skus(r)).not.toContain("AK-0247");                   // gluten: may contain
  });
  it("searchProducts: embeds once, records the cost, caches; the next time it reads the cache", async () => {
    let calls = 0;
    const embedder: Embedder = { async embed() { calls++; return { vectors: [[1, 0, 0]], tokens: 100_000 }; } };
    const a = await searchProducts(asSupabase(db) as any, embedder, "school crunch", {}, 5);
    expect(a.how).toBe("embedded");
    expect(a.matches.map((m) => m.sku)).toContain("SR1T-003");
    const b = await searchProducts(asSupabase(db) as any, embedder, "School  crunch", {}, 5);   // the same words, folded
    expect(b.how).toBe("cache");
    expect(calls).toBe(1);
    const cost = await db.one(`select calls, input_tokens, usd::float as usd from model_costs where workflow = 'search' and model = $1 and step = 'query'`, [MODEL]);
    expect(cost).toMatchObject({ calls: 1, input_tokens: 100_000 });
    expect(cost.usd).toBeCloseTo(0.0012, 6);
  });
  it("a failing embedding falls back to words and still answers", async () => {
    const embedder: Embedder = { async embed() { throw new Error("embedding_timeout"); } };
    const r = await searchProducts(asSupabase(db) as any, embedder, "rice cakes for my son", {}, 5);
    expect(r.how).toBe("error");
    expect(r.matches.map((m) => m.sku)).toEqual(expect.arrayContaining(["SR1T-003", "AK-0247"]));
  });
  it("at the daily cap no call is made, and words answer", async () => {
    await db.pg.query(`update settings set value = value || '{"daily_cap_usd": 0}'::jsonb where key = 'search'`);
    let calls = 0;
    const embedder: Embedder = { async embed() { calls++; return { vectors: [[1, 0, 0]], tokens: 1 }; } };
    try {
      const r = await searchProducts(asSupabase(db) as any, embedder, "labneh for breakfast", {}, 5);
      expect(r.how).toBe("cap");
      expect(calls).toBe(0);
      expect(r.matches.length).toBeGreaterThan(0);
    } finally { await db.pg.query(`update settings set value = value || '{"daily_cap_usd": 0.5}'::jsonb where key = 'search'`); }
  });
  it("a model with no price is refused, never counted as free", async () => {
    await expect(db.rpc("record_embedding_cost", { p_model: "no-such-model", p_step: "query", p_calls: 1, p_tokens: 5 })).rejects.toThrow(/NO_PRICE/);
  });
  afterAll(async () => { await db.pg.query(`update settings set value = value || '{"embeddings": "off", "model": "@cf/baai/bge-m3"}'::jsonb where key = 'search'`); });
});

describe("SR1 (8, invariant 19): the website's search is the same function with the same filters", () => {
  it("web_catalog_search returns what find_products returns, restricted to what the site shows", async () => {
    const f = { sugar: "none" };
    const chat = skus(await find("drinks", f));
    const web = await db.rpc<any>("web_catalog_search", { p_text: "drinks", p_limit: 12, p_filters: f });
    expect(web.ok).toBe(true);
    const shown = (web.matches as any[]).map((m) => m.sku);
    for (const s of shown) expect(chat).toContain(s);
    expect(shown.length).toBeGreaterThan(0);
    expect(web.matches[0].facts.length).toBeGreaterThan(0);
  });
  it("nothing passes: the miss is logged as facts_unconfirmed demand", async () => {
    const web = await db.rpc<any>("web_catalog_search", { p_text: "juice", p_limit: 12, p_filters: { sugar: "none" } });
    expect(web.matches).toEqual([]);
    expect(web.reason).toBe("none_pass");
    expect(await db.one(`select kind::text from demand_signals where origin = 'web_search' order by created_at desc limit 1`)).toEqual({ kind: "facts_unconfirmed" });
  });
});

const line = (l: { raw: string; query: string; qty: number; modifiers?: string[] }) =>
  ({ unit: "each", brand_hint: null, source_hint: null, confidence: 0.9, modifiers: [], ...l });
const order = (lines: unknown[], language: string, extra: Record<string, unknown> = {}) =>
  ({ intent: "order", language, fulfilment: "unknown", lines, address: { village: null, landmark: null, building: null, floor: null, recipient_name: null, verbatim: null }, ...extra });

describe("SR1 (7): when facts exist, the chat states them with their source; the two voice notes of 15 November", () => {
  it("«protein bars with no sugar»: the item that passes, with what its pack says and its price; no demand row", async () => {
    const t = flow(db, [read(order([line({ raw: "protein bars with no sugar", query: "protein bars", qty: 1 })], "en"))]);
    const party = (await t.customer()).party_id;
    await t.text("protein bars with no sugar");
    expect(t.seen.length).toBe(1);                               // the reading only: code answers
    const body = outbound.map(bodyOf).join("\n");
    expect(body).toContain("Fitbar Protein Bar Chocolate No Added Sugar 40G");
    expect(body).toContain("the pack says “No added sugar”");
    expect(body).toContain("$1.60");
    expect(body).not.toContain("Peanut Caramel");                // 18 g sugar: it fails
    expect(await db.all(`select 1 from demand_signals where party_id = $1 and origin = 'honest_answer'`, [party])).toEqual([]);
  });
  it("«بدي سناكات بلا سكر ل ٥ ولاد»: snacks that pass, each with its fact, in Arabic", async () => {
    const t = flow(db, [read(order([line({ raw: "سناكات بلا سكر", query: "سناكات", qty: 5 })], "ar_lb"))]);
    await t.customer();
    await t.text("بدي سناكات بلا سكر ل ٥ ولاد");
    const body = outbound.map(bodyOf).join("\n");
    expect(body).toMatch(/مكتوب على العلبة «No added sugar»|جدول القيم الغذائية على العلبة/);
    expect(body).toContain("كعك رز");
    expect(body).not.toMatch(/Kinder|كيندر/);
  });
  it("«dog food for a puppy»: not carried; the honest answer and a demand row", async () => {
    const t = flow(db, [read(order([line({ raw: "dog food for a puppy", query: "dog food", qty: 1 })], "en"))]);
    const party = (await t.customer()).party_id;
    await t.text("dog food for a puppy");
    const body = outbound.map(bodyOf).join("\n");
    expect(body).not.toContain("Miglior Gatto");
    expect(await db.all(`select 1 from demand_signals where party_id = $1 and origin = 'honest_answer'`, [party])).toHaveLength(1);
  });
});

describe("SR1 (6): a basket said in words is built by code, priced by quote_order, and confirmed by the customer", () => {
  it("«a lebanese breakfast for 5» (pickup): the card with labneh, bread and eggs; nothing is confirmed until the customer taps", async () => {
    const t = flow(db, [read(order([line({ raw: "a lebanese breakfast for 5", query: "breakfast", qty: 5 })], "en", { fulfilment: "pickup" }))]);
    const party = (await t.customer()).party_id;
    await t.text("a lebanese breakfast for 5, I'll pick it up");
    const body = outbound.map(bodyOf).join("\n");
    expect(body).toContain("Lebanese breakfast for 5");
    const o = await db.one(`select o.id, o.status::text from orders o where o.customer_id = $1 order by o.created_at desc limit 1`, [party]);
    expect(o?.status).toBe("awaiting_confirmation");            // the card waits for the customer's own tap (invariant 4)
    const kinds = (await db.all<{ kind: string }>(`select product_kind(l.product_id) as kind from order_items l where l.order_id = $1`, [o.id])).map((r) => r.kind).sort();
    expect(kinds).toEqual(["arabic bread", "eggs", "labneh"]);
  });
  it("«mjadra for 60 people»: refused by code, with what to do instead", async () => {
    const t = flow(db, [read(order([line({ raw: "mjadra for 60 people", query: "mjadra", qty: 60 })], "en"))]);
    await t.customer();
    await t.text("mjadra for 60 people");
    expect(outbound.map(bodyOf).join("\n")).toContain("up to 50 people");
  });
});

describe("SR1 (7): every 'nothing fits' request of the set gets the honest answer through the real turn, and its demand row", () => {
  // The scripted reading is what code reads from the words (the live model's own reading is scored in evals/search/live.search.test.ts).
  it.each(REQUESTS.filter((r) => r.expect.type === "nothing").map((r) => [r.id, r] as const))("%s", async (_id, r) => {
    const reading = readSearch(r.text);
    const lang = r.lang === "ar" ? "ar_lb" : r.lang;
    const t = flow(db, [read(order([line({ raw: r.text, query: reading.query || r.text, qty: reading.count ?? 1 })], lang))]);
    const party = (await t.customer()).party_id;
    await t.text(r.text);
    expect(outbound.length).toBeGreaterThan(0);                                   // answered, never silent
    const body = outbound.map(bodyOf).join("\n");
    const offered = (await db.all<{ name_en: string }>(`select name_en from products where sku = any($1)`, [[...skuOf.values()]]))
      .filter((p) => body.includes(p.name_en) && FITS.test(body)).map((p) => p.name_en);
    expect(offered, body).toEqual([]);                                             // nothing offered as fitting
    expect(await db.all(`select 1 from demand_signals where party_id = $1`, [party]), body).not.toHaveLength(0);
  });
});
