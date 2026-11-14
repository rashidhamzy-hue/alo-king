// G1-11 (session F1): every function in public has a fixed search_path, so no caller's path can change what a name means.
// Functions that call trigram functions keep "public, extensions, pg_temp" (C1, 0020); the rest get "public, pg_temp".
// A later migration that creates a function ends with `select pin_search_paths();` (0103), and this test names any it missed.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb;
beforeAll(async () => { db = await openTestDb(); }, 120_000);

const OURS = `from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;
const pathOf = `(select substr(c, 13) from unnest(p.proconfig) c where c like 'search_path=%')`;

describe("fixed search_path on every function (G1-11)", () => {
  it("no function in public is left without one", async () => {
    const missing = await db.all<{ name: string }>(`select p.oid::regprocedure::text as name ${OURS} and ${pathOf} is null order by 1`);
    expect(missing.map((m) => m.name)).toEqual([]);
    expect(Number((await db.one(`select count(*) as n ${OURS}`)).n)).toBeGreaterThan(300);
  });

  it("functions that call trigram functions keep the extensions schema on their path", async () => {
    const trigram = await db.all<{ name: string; path: string }>(`select p.proname as name, ${pathOf} as path ${OURS}
      and p.prosrc ~* '(word_similarity|similarity|show_trgm)\\s*\\('`);
    expect(trigram.length).toBeGreaterThan(3);
    for (const t of trigram) expect(t.path, t.name).toMatch(/extensions/);
    const search = await db.one(`select ${pathOf} as path from pg_proc p where p.proname = 'search_catalog'`);
    expect(search.path).toBe("public, extensions, pg_temp");
  });

  it("the rest are pinned to public and pg_temp, and still work with a hostile caller path", async () => {
    const r = await db.one(`select ${pathOf} as path from pg_proc p where p.proname = 'post_cod_collection'`);
    expect(r.path).toBe("public, pg_temp");
    await db.pg.exec(`create schema if not exists evil; create function evil.setting(p_key text) returns jsonb language sql as $$ select '{"enabled": true}'::jsonb $$;`);
    await db.pg.exec(`set search_path = evil, public`);
    try {
      // can_send reads setting('marketing'); evil.setting says marketing is on. With its own path pinned it never finds it.
      const p = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
      expect(await db.rpc("can_send", { p_party: p, p_line: "customer", p_category: "marketing", p_is_template: true })).toBe("marketing_disabled");
      expect(await db.rpc("search_catalog", { p_query: "labneh" })).not.toBeNull();
    } finally { await db.pg.exec(`set search_path = public, extensions; drop schema evil cascade;`); }
  });

  it("pin_search_paths() pins a function created later, and is safe to run again", async () => {
    await db.pg.exec(`create function f1_later() returns int language sql as $$ select 1 $$;`);
    expect((await db.one(`select proconfig from pg_proc where proname = 'f1_later'`)).proconfig).toBeNull();
    const n = await db.rpc("pin_search_paths");
    expect(Number(n)).toBe(1);
    expect((await db.one(`select proconfig from pg_proc where proname = 'f1_later'`)).proconfig).toEqual(["search_path=public, pg_temp"]);
    expect(Number(await db.rpc("pin_search_paths"))).toBe(0);
    await db.pg.exec(`drop function f1_later()`);
  });
});
