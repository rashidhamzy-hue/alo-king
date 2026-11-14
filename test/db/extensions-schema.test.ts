// Migration 0020: pg_trgm moved out of public into the extensions schema (A1's finding under 0.4).
// Proves the search still works for a caller whose search_path does not name the extensions schema, the trigram
// indexes still serve the % operator, and any function that calls a trigram function carries its own search_path.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb;
// A function that calls one of these (outside a string literal) resolves it through its search_path; without `extensions` there it fails at run time.
const TRIGRAM_USE = String.raw`(similarity|word_similarity|strict_word_similarity|show_trgm|show_limit|set_limit)\s*\(|\m\w+\s+(%|<%|%>|<<%|%>>)\s`;

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`set search_path = public`);   // what a caller that knows nothing of the move has
});

describe("pg_trgm lives in the extensions schema", () => {
  it("the extension moved and no extension function is left in public", async () => {
    const ext = await db.all(`select extname, extnamespace::regnamespace::text as schema from pg_extension where extname in ('pg_trgm', 'pgcrypto') order by 1`);
    expect(ext).toEqual([{ extname: "pg_trgm", schema: "extensions" }, { extname: "pgcrypto", schema: "extensions" }]);
    const left = await db.one(`select count(*)::int as n from pg_proc p join pg_depend d on d.objid = p.oid and d.deptype = 'e'
      where p.pronamespace = 'public'::regnamespace`);
    expect(left.n).toBe(0);
  });

  it("product search, the planner and village lookup still match by trigram with search_path = public", async () => {
    const res = await db.rpc("search_catalog", { p_query: "labneh" });
    expect(res.matches.length).toBeGreaterThan(0);
    const village = await db.rpc("resolve_place", { p_party: null, p_village: "Baakline" });
    expect(village.village.name_en).toBe("Baakline");
    const plain = await db.all(`select * from search_products('labneh')`);
    expect(plain.length).toBeGreaterThan(0);
    const party = (await db.one(`insert into parties(role, display_name) values ('customer', 'T') returning id`)).id;
    const plan = await db.rpc("plan_order", { p_party: party, p_intent: { intent: "order", lines: [{ raw: "لبنة", query: "labneh", qty: 1 }] } });
    expect(plan.lines[0].status).not.toBe("not_found");
  });

  it("every trigram index now uses the moved operator class and still serves the % operator", async () => {
    const idx = await db.all<{ name: string; def: string }>(`select indexrelid::regclass::text as name, pg_get_indexdef(indexrelid) as def
      from pg_index where pg_get_indexdef(indexrelid) like '%gin_trgm_ops%' order by 1`);
    expect(idx.map((i) => i.name)).toEqual(["landmark_aliases_trgm", "product_aliases_folded_trgm", "product_aliases_trgm", "products_folded_trgm", "products_name_trgm"]);
    for (const i of idx) expect(i.def).toContain("extensions.gin_trgm_ops");
    await db.pg.exec(`set enable_seqscan = off`);
    const plan = await db.all<{ "QUERY PLAN": string }>(`explain select id from products where search_folded operator(extensions.%) 'labneh'`);
    expect(plan.map((r) => r["QUERY PLAN"]).join("\n")).toContain("products_folded_trgm");
    await db.pg.exec(`reset enable_seqscan`);
  });

  it("guard: every function of ours that calls a trigram function pins extensions on its search_path", async () => {
    // A later CREATE OR REPLACE drops the SET clause unless it repeats it. This catches that.
    const users = await db.all<{ fn: string; cfg: string | null }>(`select p.oid::regprocedure::text as fn, array_to_string(p.proconfig, ',') as cfg
      from pg_proc p where p.pronamespace = 'public'::regnamespace and regexp_replace(p.prosrc, '''[^'']*''', '', 'g') ~* $1   -- string literals (raise messages) left out
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') order by 1`, [TRIGRAM_USE]);
    expect(users.map((u) => u.fn).sort()).toEqual(expect.arrayContaining([
      // 1.22 (0053) moved the trigram calls of plan_order_core and search_catalog into catalog_brand_fits and search_catalog_legacy
      "catalog_brand_fits(text,text,text)", "resolve_place(uuid,text,text)", "search_catalog_legacy(text,text,integer)", "search_products(text,uuid,integer)"]));
    for (const u of users) expect(u.cfg, u.fn).toMatch(/search_path=.*extensions/);
  });

  it("the guard would catch a redefinition that forgets the clause", async () => {
    await db.pg.exec(`begin`);
    try {
      // 0109's event trigger would pin it as it is created; the guard is for a database without that trigger (rolled back below).
      await db.pg.exec(`alter event trigger pin_new_functions disable`);
      await db.pg.exec(`create or replace function resolve_place(p_party uuid, p_village text default null, p_landmark text default null)
        returns jsonb language plpgsql stable as $$ begin return (select to_jsonb(max(similarity(name_en, p_village))) from villages); end $$`);
      const cfg = await db.one(`select proconfig from pg_proc where oid = 'resolve_place(uuid,text,text)'::regprocedure`);
      expect(cfg.proconfig).toBeNull();
      await expect(db.rpc("resolve_place", { p_party: null, p_village: "Baakline" })).rejects.toThrow(/similarity/);
    } finally { await db.pg.exec(`rollback`); }
  });
});
