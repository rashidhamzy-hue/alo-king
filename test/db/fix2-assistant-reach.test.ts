// FIX2 (Sentry ALO-KING-GATEWAY-8): the nightly digest failed on staging with "permission denied for table dish_declarations" under the
// assistant's read-only role. The products tool reaches product_template_status(), which reads dish_declarations only for a vendor dish,
// and AST1's invented day had none. Two guards, so a grant missing on a branch the test data does not take cannot pass CI again:
//   1. A static walk: from every assistant_* function, through every security-invoker function it names (their bodies, comments and
//      string literals left out), every table and view named must be readable by assistant_reader, every row-secured one must have a
//      policy that lets it read, and every function named must be executable by it.
//   2. The real digest (writeDigest -> assistant_digest_facts, which runs every tool as its owner, assistant_reader) end to end on a world
//      with a vendor dish and its declared facts (the seeded test kitchen), food orders, AUTO1's decisions; a row is written.
// And the role still cannot write (the same refusals AST1 proved, repeated here on dish_declarations and AUTO1's tables).
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";
import { NOW, seedWorld } from "../../evals/assistant/world";
import { switchOn } from "../../evals/assistant/eval";
import { readFileSync } from "node:fs";
import { pgDb } from "../../apps/console/test/kit";
import { writeDigest } from "../../apps/console/src/assistant/digest";
import type { ModelFn } from "../../apps/console/src/assistant/run";
import type Anthropic from "@anthropic-ai/sdk";

let db: TestDb;
beforeAll(async () => {
  db = await openTestDb();
  await seedWorld(db);
  await db.pg.exec(readFileSync(new URL("../../scripts/staging/test-place.sql", import.meta.url), "utf8"));   // the test kitchen and its dishes
  await switchOn(db);
  // a vendor dish with a declared allergen, so product_template_status takes its 'declared_facts' branch
  const dish = (await db.one(`select p.id from products p join sources s on s.id = p.owner_source_id where s.listing_id = 'ak-test-kitchen-staging' order by p.sku limit 1`)).id;
  const by = (await db.one(`select id from parties where is_probe and role = 'ops_lead' limit 1`)).id;
  await db.pg.query(`insert into dish_declarations(product_id, attribute, value, declared_by) values ($1, 'gluten', 'contains', $2)`, [dish, by]);
  await db.rpc("automation_run_dishes", {});
}, 180_000);

/** Identifiers in a function body, with comments and string literals removed (dynamic SQL is not followed: none of the tools uses it). */
const idents = (src: string) => new Set((src.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/'(?:[^']|'')*'/g, "''").toLowerCase()
  .match(/[a-z_][a-z0-9_]*/g)) ?? []);

describe("everything an assistant_* function can reach, assistant_reader can read (static walk)", () => {
  it("every table, view and function named on the way is granted, and row security lets the role see the rows", async () => {
    const fns = await db.all<any>(`select p.oid::int as oid, p.proname, p.prosrc, p.prosecdef, pg_get_userbyid(p.proowner) as owner, p.oid::regprocedure::text as sig,
        has_function_privilege('assistant_reader', p.oid, 'execute') as ex
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
    const rels = await db.all<any>(`select c.relname, c.relkind, c.relrowsecurity as rls, has_table_privilege('assistant_reader', c.oid, 'select') as sel,
        coalesce((select bool_or(pol.polcmd in ('r', '*') and (0 = any(pol.polroles) or 'assistant_reader'::regrole::oid = any(pol.polroles)))
                    from pg_policy pol where pol.polrelid = c.oid), false) as readable,
        case when c.relkind = 'v' then pg_get_viewdef(c.oid) end as viewdef,
        coalesce(c.reloptions::text, '') ~ 'security_invoker=(true|on)' as invoker
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')`);
    const fnBy = new Map<string, any[]>();
    for (const f of fns) { const l = fnBy.get(f.proname) ?? []; l.push(f); fnBy.set(f.proname, l); }
    const relBy = new Map<string, any>(rels.map((r) => [r.relname, r]));
    const roots = fns.filter((f) => f.proname.startsWith("assistant_"));
    expect(roots.length).toBeGreaterThanOrEqual(16);
    const seen = new Set<string>(); const queue: { name: string; src: string; from: string }[] = roots.map((f) => ({ name: f.sig, src: f.prosrc, from: f.proname }));
    const missing: string[] = [];
    while (queue.length) {
      const cur = queue.shift()!;
      if (seen.has(cur.name)) continue;
      seen.add(cur.name);
      for (const id of idents(cur.src)) {
        const r = relBy.get(id);
        if (r) {
          if (!r.sel) missing.push(`SELECT on ${id} (named by ${cur.name})`);
          if (r.relkind === "r" && r.rls && !r.readable) missing.push(`a read policy on ${id} for assistant_reader (named by ${cur.name})`);
          if (r.viewdef && r.invoker) queue.push({ name: `view ${id}`, src: r.viewdef, from: cur.name });
        }
        for (const g of fnBy.get(id) ?? []) {
          if (g.sig === cur.name) continue;
          if (!g.ex) missing.push(`EXECUTE on ${g.sig} (named by ${cur.name})`);
          // a security-definer function owned by another role runs with its owner's rights: only EXECUTE is needed
          if (!g.prosecdef || g.owner === "assistant_reader") queue.push({ name: g.sig, src: g.prosrc, from: cur.name });
        }
      }
    }
    expect(seen.size).toBeGreaterThan(roots.length);              // it does walk past the roots
    expect(seen).toContain("product_template_status(uuid)");       // the path that failed on staging
    expect(missing).toEqual([]);
  });
});

describe("the nightly digest end to end, as assistant_reader, on a world with a vendor dish (Sentry ALO-KING-GATEWAY-8)", () => {
  it("assistant_digest_facts runs every tool without a permission error", async () => {
    const f = await db.rpc<any>("assistant_digest_facts", { p_day: "2026-11-18", p_now: NOW.toISOString() });
    expect(f.orders.orders).toBe(7);
    // the products tool ran (it is the one that reaches dish_declarations): its candidate is among the fixes
    expect((f.fix_candidates as any[]).some((c) => c.what === "items not sellable" && c.count > 0)).toBe(true);
  });
  it("writeDigest writes the day's row (scripted model, USD 0)", async () => {
    const model: ModelFn = async (p) => ({ model: p.model, stop_reason: "end_turn",
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } as Anthropic.Messages.Usage,
      content: [{ type: "text", text: JSON.stringify({ en: "Went well: 2 delivered on time.", ar: "سار جيداً: 2 في الوقت." }) }] as unknown as Anthropic.Messages.ContentBlock[] }) as Anthropic.Messages.Message;
    const out = await writeDigest(pgDb(db), model, NOW, "2026-11-18");
    expect(out).toMatchObject({ day: "2026-11-18", saved: true, text: true });
    const row = await db.one<any>(`select text_en, facts from assistant_digests where day = '2026-11-18'`);
    expect(row.text_en).toContain("2 delivered on time");
    expect(row.facts.orders.orders).toBe(7);
  });
});

describe("still read-only", () => {
  it("assistant_reader holds no write privilege, and a write as the role is refused (dish_declarations and AUTO1's tables included)", async () => {
    const w = await db.one<any>(`select count(*)::int as n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f')
      and (has_table_privilege('assistant_reader', c.oid, 'insert') or has_table_privilege('assistant_reader', c.oid, 'update')
        or has_table_privilege('assistant_reader', c.oid, 'delete') or has_table_privilege('assistant_reader', c.oid, 'truncate'))`);
    expect(w.n).toBe(0);
    for (const sql of [`delete from dish_declarations`, `update dish_declarations set value = 'free'`, `delete from automation_decisions`,
                       `update settings set value = value where key = 'automation'`, `delete from assistant_digests`]) {
      await db.pg.exec(`set role assistant_reader`);
      let err = "";
      try { await db.pg.exec(sql); } catch (e) { err = (e as Error).message; } finally { await db.pg.exec(`reset role`); }
      expect(err, sql).toMatch(/permission denied/);
    }
  });
});
