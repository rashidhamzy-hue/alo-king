// LB1 (coordinator, 16 November evening): the simulator's copy of staging empties every column that points at a person, so an approved
// fact arrived with approved_at set and approved_by empty and 0021's check refused it (SR1's sim-test run 43900749787 stopped there, USD 0
// spent). A column that records WHO decided (approved_by, proposed_by, reviewed_by ...) now points at one stand-in staff party made in the
// throwaway database; no real party is ever copied, and the other columns that point at a person stay empty.
import { describe, expect, it } from "vitest";
import { openTestDb } from "../../../test/db/harness";
import { makeFactComplete } from "../../../test/db/fact-kit";
import { COPY_TABLES } from "../staging";
import { openWorld, STAND_IN_STAFF } from "../world";

describe("the copy keeps what a person approved, approved by a stand-in", () => {
  it("approved facts, with the real approver's id nowhere in the copy", async () => {
    // What staging would return: every copied table of a database where a real person approved a fact.
    const src = await openTestDb();
    const real = (await src.one(`insert into parties(role, display_name) values ('ops_lead', 'A real approver') returning id`)).id as string;
    const product = (await src.one(`select id from products where is_active order by sku limit 1`)).id as string;
    await makeFactComplete(src, product, real);
    const approved = (await src.one(`select count(*)::int as n from product_facts where approved_at is not null and approved_by = $1`, [real])).n as number;
    expect(approved).toBeGreaterThan(10);
    const copy: Record<string, Record<string, unknown>[]> = {};
    for (const t of COPY_TABLES) copy[t.table] = JSON.parse(JSON.stringify(await src.all(`select * from ${t.table}${t.filter ? " where approved_at is not null and superseded_at is null" : ""}`)));
    await src.pg.close();

    const w = await openWorld({ label: "copy", copy, oosSkus: [], log: () => {} });
    const facts = await w.db.all(`select approved_by, approved_at, proposed_by from product_facts where approved_at is not null`);
    expect(facts.length).toBe(approved);
    expect(facts.every((f) => f.approved_by === STAND_IN_STAFF && f.approved_at !== null)).toBe(true);
    // who proposed it is a person too: the same stand-in, never null on a column the table requires, never the real id
    expect(facts.every((f) => f.proposed_by === null || f.proposed_by === STAND_IN_STAFF)).toBe(true);
    expect(await w.db.one(`select count(*)::int as n from parties where id = $1`, [real])).toEqual({ n: 0 });
    expect(await w.db.one(`select role::text as role, is_blocked from parties where id = $1`, [STAND_IN_STAFF])).toEqual({ role: "ops_lead", is_blocked: false });
    // the facts answer as approved facts do: a food question about that item is answered from its record
    expect((await w.db.rpc("product_facts_for_chat", { p_product: product }))).toMatchObject({ applies: true });
    // and no other column that points at a person was filled
    expect(w.adjustments.join("\n")).toMatch(/approved_by.*stand-in/i);
  }, 180_000);

  it("a fact the automatic rule approved (0207's published_sources) keeps the rule party as its approver: 0207's check names it", async () => {
    const AUTO = "00000000-0000-4000-8000-0000000000a1";
    const src = await openTestDb();
    const product = (await src.one(`select id from products where is_active order by sku limit 1`)).id as string;
    await src.pg.query(`insert into product_facts(product_id, attribute, value, detail, status, source, proposed_by, approved_by, approved_at)
      values ($1, 'ingredients', null, '{"text": "water, salt", "automatic": true}', 'declared', 'published_sources', $2, $2, now())`, [product, AUTO]);
    const copy: Record<string, Record<string, unknown>[]> = {};
    for (const t of COPY_TABLES) copy[t.table] = JSON.parse(JSON.stringify(await src.all(`select * from ${t.table}${t.filter ? " where approved_at is not null and superseded_at is null" : ""}`)));
    await src.pg.close();
    const w = await openWorld({ label: "copy", copy, oosSkus: [], log: () => {} });
    expect(await w.db.one(`select approved_by, proposed_by, source from product_facts where source = 'published_sources'`)).toEqual({ approved_by: AUTO, proposed_by: AUTO, source: "published_sources" });
  }, 180_000);
});
