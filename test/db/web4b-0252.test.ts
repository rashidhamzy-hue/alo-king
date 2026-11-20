// WEB4b, migration 0252: (1) the rider shifts set to the hours through the console's own audited door; (2) brand words that are another
// item's kind word (evals/cases/web4b_brand_words.json): «لبن» must not find Halloum, «ماي» not Maestro tea, "asir" not bread, "mee" not
// noodles. Staging's terms are written after the seeds through save_search_words (the job's own door); the same database without 0252
// shows the fault, so the case failed before the fix.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";
import c from "../../evals/cases/web4b_brand_words.json";

async function stagingLike(without: string[] = []): Promise<TestDb> {
  const db = await openTestDb({ without });
  await db.pg.exec(`update stock_levels set on_hand = 20;`);
  for (const [sku, terms] of Object.entries(c.staging_terms)) {
    await db.rpc("save_search_words", { p_sku: sku, p_rows: (terms as string[][]).map(([term, level, lang]) => ({ term, level, lang })), p_version: "auto-2026-11-16" });
  }
  await db.rpc("refresh_search_documents", {});
  return db;
}
const skus = async (db: TestDb, q: string) =>
  ((await db.rpc<{ matches: { sku: string }[] }>("find_products", { p_query: q, p_filters: {}, p_limit: 40 })).matches ?? []).map((m) => m.sku);
const webSkus = async (db: TestDb, q: string) =>
  ((await db.rpc<{ matches: { sku: string }[] }>("web_catalog_search", { p_text: q, p_limit: 40 })).matches ?? []).map((m) => m.sku);

describe("before 0252: the fault as staging had it", () => {
  let db: TestDb;
  // 0267 (PERF1) builds on 0252's feed JPEG table, so the database without 0252 is also without it.
  beforeAll(async () => { db = await stagingLike(["0252", "0267"]); }, 180_000);
  afterAll(async () => { await db?.pg.close(); });
  it("«لبن» finds Halloum, «ماي» finds the tea", async () => {
    expect(await skus(db, "لبن")).toContain("AK-0044");
    expect(await skus(db, "ماي")).toContain("AK-0143");
  });
  it("the rider shifts are UX3's draft, outside the hours", async () => {
    expect((await db.one(`select value->'rider'->'shifts' s from settings where key = 'join'`)).s.map((x: any) => `${x.from}-${x.to}`)).toEqual(["08:00-15:30", "15:30-23:00"]);
  });
});

describe("WEB4b 0252", () => {
  let db: TestDb;
  beforeAll(async () => { db = await stagingLike(); }, 180_000);
  afterAll(async () => { await db?.pg.close(); });

  it.each(c.must_not_find.map((x) => [x.query, x.sku] as const))("%s does not find %s (chat and website)", async (q, sku) => {
    expect(await skus(db, q)).not.toContain(sku);
    expect(await webSkus(db, q)).not.toContain(sku);
  });
  it.each(c.must_find.map((x) => [x.query, x.sku] as const))("%s still finds %s", async (q, sku) => {
    expect(await skus(db, q)).toContain(sku);
  });
  it("the job cannot write the refused words again: refused and logged; the right ones are written", async () => {
    const r = await db.rpc("save_search_words", { p_sku: "AK-0044", p_rows: [{ term: "LIBAN  LAIT", level: "brand", lang: "en" }, { term: "لبن ليت", level: "brand", lang: "ar" }, { term: "ليان تعنايل", level: "brand", lang: "ar" }], p_version: "t" });
    expect(r.written).toBe(1);
    expect((await db.all(`select term from language_pack where sku = 'AK-0044'`)).map((x) => x.term)).toEqual(["ليان تعنايل"]);
    expect((await db.all(`select term from search_word_drops where sku = 'AK-0044' and reason = 'refused_term' order by id desc limit 2`)).map((x) => x.term).sort()).toEqual(["LIBAN  LAIT", "لبن ليت"]);
    // Liban Lait stays the brand of Liban Lait's own items
    const ll = await db.rpc("save_search_words", { p_sku: "AK-0050", p_rows: [{ term: "liban lait", level: "brand", lang: "arabizi" }, { term: "لبن", level: "kind", lang: "ar" }], p_version: "t" });
    expect(ll.written).toBe(2);
  });
  it("brand_word_collisions() lists none of the seven", async () => {
    const rows = await db.all(`select sku, term from brand_word_collisions()`);
    for (const [sku, terms] of Object.entries(c.staging_terms)) for (const [term] of terms as string[][]) {
      if (["لبن ليت", "Liban Lait", "liban lait", "ماي سترو", "tanour al asir", "indomie mee"].includes(term)) expect(rows).not.toContainEqual({ sku, term });
    }
  });
  it("and it finds a new one: a brand word that is another item's kind word", async () => {
    await db.rpc("save_search_words", { p_sku: "AK-0174", p_rows: [{ term: "indomie", level: "brand", lang: "en" }, { term: "indomie asir", level: "brand", lang: "en" }], p_version: "t" });
    expect(await db.all(`select sku, term, word from brand_word_collisions() where sku = 'AK-0174'`)).toEqual([{ sku: "AK-0174", term: "indomie asir", word: "asir" }]);
  });

  it("the rider shifts are 09:00 to 15:00 and 15:00 to 21:00, logged as a console change with the founder's reason", async () => {
    expect((await db.one(`select value->'rider'->'shifts' s from settings where key = 'join'`)).s).toEqual([
      expect.objectContaining({ id: "morning", from: "09:00", to: "15:00" }), expect.objectContaining({ id: "evening", from: "15:00", to: "21:00" })]);
    const log = await db.rpc<any[]>("settings_log", { p_limit: 20 });
    const ours = log.filter((x) => x.key === "join");
    expect(ours.map((x) => x.field).sort()).toEqual(["rider.shifts.0.from", "rider.shifts.0.to", "rider.shifts.1.from", "rider.shifts.1.to"]);
    for (const x of ours) {
      expect(x.reason).toBe("match the 09:00–21:00 hours (founder decision 18 Nov)");
      expect(x.by_name).toMatch(/founder's decision of 18 November/);
    }
    expect(ours.find((x) => x.field === "rider.shifts.1.to")).toMatchObject({ before: "23:00", after: "21:00" });
  });
  it("the party that applied it is blocked: it passes no role check", async () => {
    await expect(db.rpc("change_setting", { p_key: "join", p_field: "rider.shifts.0.from", p_value: JSON.stringify("09:30"), p_by: "00000000-0000-4000-8000-0000000000d1", p_reason: "try" }))
      .rejects.toThrow(/NOT_AUTHORISED/);
  });
  it("the Settings page lists the four shift edges and an admin changes one through change_setting; a shift must start before it ends", async () => {
    const items = await db.rpc<any[]>("console_settings", {});
    expect(items.filter((i) => i.key === "join").map((i) => [i.field, i.kind, i.value])).toEqual([
      ["rider.shifts.0.from", "time", "09:00"], ["rider.shifts.0.to", "time", "15:00"], ["rider.shifts.1.from", "time", "15:00"], ["rider.shifts.1.to", "time", "21:00"]]);
    const admin = (await db.one(`insert into parties(role, display_name) values ('admin', 'Test admin') returning id`)).id;
    expect(await db.rpc("change_setting", { p_key: "join", p_field: "rider.shifts.1.to", p_value: JSON.stringify("20:30"), p_by: admin, p_reason: "test" })).toMatchObject({ ok: true, status: "set" });
    expect((await db.one(`select value #>> '{rider,shifts,1,to}' v from settings where key = 'join'`)).v).toBe("20:30");
    await expect(db.rpc("change_setting", { p_key: "join", p_field: "rider.shifts.0.to", p_value: JSON.stringify("08:00"), p_by: admin, p_reason: "test" })).rejects.toThrow(/SHIFT_ORDER/);
    // a one-word field still works as before
    expect(await db.rpc("change_setting", { p_key: "min_order_usd", p_field: "", p_value: JSON.stringify(6), p_by: admin, p_reason: "test" })).toMatchObject({ ok: true });
    expect(await db.rpc("change_setting", { p_key: "hours", p_field: "open", p_value: JSON.stringify("09:30"), p_by: admin, p_reason: "test" })).toMatchObject({ ok: true });
    expect((await db.one(`select value->>'open' v from settings where key = 'hours'`)).v).toBe("09:30");
  });
});
