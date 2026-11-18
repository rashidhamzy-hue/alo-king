// B1f: CX2's three sim turn errors (sim-006, sim-016, sim-028), the turn after a customer corrects a line (evals/cases/b1f_sim_turn_errors.json).
// The planner on the sim's turns: on the database without 0257 it stops ("cannot extract elements from a scalar"); with 0257 it plans.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";
import c from "../../evals/cases/b1f_sim_turn_errors.json";

const line = (l: Record<string, unknown>) => ({ unit: "each", brand_hint: null, confidence: 0.8, modifiers: [], ...l });
async function open(without: string[]) {
  const db = await openTestDb({ without });
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500); update stock_levels set on_hand = 50;`);
  const party = (await db.one(`insert into parties(role) values ('customer') returning id`)).id as string;
  return { db, party };
}
const plan = (db: TestDb, party: string, k: (typeof c.cases)[number]) => db.rpc("plan_order_core", { p_party: party,
  p_intent: { intent: "order", fulfilment: "delivery", lines: k.lines.map(line), address: {}, _message: k.message }, p_village: null, p_choices: {} });

describe("before 0257: the turn errors as the sim had them", () => {
  let db: TestDb; let party: string;
  beforeAll(async () => { ({ db, party } = await open(["0257"])); }, 180_000);
  afterAll(async () => { await db?.pg.close(); });
  it.each(c.cases.filter((k) => k.failed_before_0257).map((k) => [k.id, k] as const))("%s stops the planner", async (_id, k) => {
    await expect(plan(db, party, k)).rejects.toThrow(/cannot extract elements from a scalar/);
  });
});

describe("with 0257 (and 0253): every turn plans", () => {
  let db: TestDb; let party: string; let skuOf: Map<string, string>;
  beforeAll(async () => {
    ({ db, party } = await open([]));
    skuOf = new Map((await db.all<{ id: string; sku: string }>(`select id, sku from products`)).map((r) => [r.id, r.sku]));
  }, 180_000);
  afterAll(async () => { await db?.pg.close(); });
  it.each(c.cases.map((k) => [k.id, k] as const))("%s", async (_id, k) => {
    const p = await plan(db, party, k);
    expect(p.lines).toHaveLength(1);
    const l = p.lines[0];
    if ("expect_sku" in k) {
      const offered = [l.chosen?.product_id, ...(l.candidates ?? []).map((x: { product_id: string }) => x.product_id)].filter(Boolean).map((id) => skuOf.get(id));
      expect(offered).toContain(k.expect_sku);
    }
  });
});
