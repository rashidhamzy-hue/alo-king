// B1f: «لبنة» finds labneh only, every spelling finds the same items, «لبن» still finds laban (evals/cases/b1f_labneh_search.json).
// Staging's names and search terms are written after the seeds through save_search_words, the job's own door, as on staging. The same
// database without 0253 shows the fault (so the case failed before the fix); with it, the fault is gone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";
import c from "../../evals/cases/b1f_labneh_search.json";

async function stagingLike(without: string[] = []): Promise<TestDb> {
  const db = await openTestDb({ without });
  await db.pg.exec(`update stock_levels set on_hand = 20;`);
  for (const [sku, name] of Object.entries(c.staging_names)) await db.pg.query(`update products set name_ar = $2 where sku = $1`, [sku, name]);
  for (const [sku, terms] of Object.entries(c.staging_terms)) {
    await db.rpc("save_search_words", { p_sku: sku, p_rows: (terms as string[][]).map(([term, level]) => ({ term, level, lang: "ar" })), p_version: "auto-2026-11-16" });
  }
  await db.rpc("refresh_search_documents", {});
  return db;
}
const skus = async (db: TestDb, q: string) =>
  ((await db.rpc<{ matches: { sku: string }[] }>("find_products", { p_query: q, p_filters: {}, p_limit: 30 })).matches ?? []).map((m) => m.sku).sort();
const webSkus = async (db: TestDb, q: string) =>
  ((await db.rpc<{ matches: { sku: string }[] }>("web_catalog_search", { p_text: q, p_limit: 30 })).matches ?? []).map((m) => m.sku).sort();

describe("before 0253: the fault as staging had it", () => {
  let db: TestDb;
  beforeAll(async () => { db = await stagingLike(["0253"]); }, 180_000);
  afterAll(async () => { await db?.pg.close(); });
  it("«لبنة» finds laban and yoghurt beside the labneh, 'labni' not what 'labneh' finds", async () => {
    expect(await skus(db, "لبنة")).toEqual(expect.arrayContaining(["AK-0048", "AK-0056", "AK-0057"]));
    expect(await skus(db, "labni")).not.toEqual(await skus(db, "labneh"));
  });
});

describe("B1f: one set of labneh, whatever the spelling", () => {
  let db: TestDb;
  beforeAll(async () => { db = await stagingLike(); }, 180_000);
  afterAll(async () => { await db?.pg.close(); });

  it.each(c.same_as_labneh.map((q) => [q] as const))("%s finds the labneh items and nothing else", async (q) => {
    expect(await skus(db, q)).toEqual([...c.labneh_skus].sort());
  });
  it("the website finds the same for every spelling", async () => {
    const want = await webSkus(db, "labneh");
    expect(want.length).toBeGreaterThan(0);
    for (const q of c.same_as_labneh) expect(await webSkus(db, q), q).toEqual(want);
  });
  it("«لبن» still finds laban, never labneh", async () => {
    const got = await skus(db, c.laban.query);
    expect(got).toEqual(expect.arrayContaining(c.laban.must_find));
    for (const s of c.laban.must_not_find) expect(got).not.toContain(s);
  });
  it("the job can never write «لبنة» on laban again: the term is refused and logged", async () => {
    const r = await db.rpc("save_search_words", { p_sku: "AK-0050", p_rows: [{ term: "لبن", level: "kind" }, { term: "لبنة", level: "kind" }, { term: "labneh", level: "kind" }], p_version: "t" });
    expect(r.written).toBe(1);
    expect((await db.all(`select term from language_pack where sku = 'AK-0050' order by term`)).map((x) => x.term)).toEqual(["لبن"]);
    expect((await db.all(`select term from search_word_drops where sku = 'AK-0050' order by term`)).map((x) => x.term)).toEqual(["labneh", "لبنة"]);
    // and on a labneh item it is written
    const ok = await db.rpc("save_search_words", { p_sku: "AK-0046", p_rows: [{ term: "لبنة", level: "kind" }, { term: "labni", level: "kind" }], p_version: "t" });
    expect(ok.written).toBe(2);
  });
  it("Talaya: «مياه فوارة طلاية» finds the Talaya water (sim-006 was offered oranges)", async () => {
    for (const q of c.talaya.queries) expect(await skus(db, q), q).toContain(c.talaya.sku);
  });
});
