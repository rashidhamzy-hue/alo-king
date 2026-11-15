// Founder decision (14 Nov, M1): a mixed word joining two items is one mixed product when the catalog has one, otherwise a
// question offering both. evals/cases/mixed_words.json, through plan_order_core on every migration and the catalog seeds, no model.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "../../test/db/harness";
import data from "../cases/mixed_words.json";

let db: TestDb; let party: string; let skuOf: Map<string, string>;
beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`update stock_levels set on_hand = 50`);
  party = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
  skuOf = new Map((await db.all<{ id: string; sku: string }>(`select id, sku from products`)).map((r) => [r.id, r.sku]));
}, 60_000);
afterAll(async () => { await db?.pg.close(); });

type Case = { id: string; text: string; lines: string[]; expect: string; offers?: string[]; chosen?: string[]; separate?: string[] };

describe("a mixed word joining two items (evals/cases/mixed_words.json)", () => {
  it.each((data.cases as Case[]).map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const lines = c.lines.map((raw) => ({ raw, query: raw, brand_hint: null, source_hint: null, qty: 1, unit: "each", modifiers: [], confidence: 0.8 }));
    const plan = await db.rpc("plan_order_core", { p_party: party, p_intent: { intent: "order", lines, _message: c.text }, p_village: null, p_choices: {} });
    const matched = (plan.lines ?? []).filter((l: any) => l.status === "matched").map((l: any) => skuOf.get(l.chosen.product_id));
    const why = JSON.stringify((plan.lines ?? []).map((l: any) => [l.raw, l.status, l.b4, l.chosen ? skuOf.get(l.chosen.product_id) : null, (l.candidates ?? []).map((x: any) => skuOf.get(x.product_id))]));
    if (c.expect === "unchanged") { expect(matched.sort(), why).toEqual([...c.chosen!].sort()); return; }
    if (c.expect === "ask") {
      expect(matched, why).toEqual([]);
      const asked = (plan.lines ?? []).find((l: any) => l.status === "ambiguous");
      expect(asked, why).toBeDefined();
      for (const s of c.offers ?? []) expect(asked.candidates.map((x: any) => skuOf.get(x.product_id)), why).toContain(s);
      return;
    }
    expect(matched.filter((s: string | undefined) => s === c.expect), why).toHaveLength(1);
    // nothing else was chosen from the two items: no carrot, no peas alone, no seed
    expect(matched.filter((s: string | undefined) => s !== c.expect), why).toEqual([]);
    // an item said before them stays its own line, with its own answer
    for (const raw of c.separate ?? []) expect((plan.lines ?? []).some((l: any) => l.raw === raw), why).toBe(true);
  }, 30_000);
});
