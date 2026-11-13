// Build plan 1.22, the zero-wrong gate (session B4). The four phrasings B3's live runs turned into a wrong product, replayed with
// the exact readings the live model gave (zero-wrong.json), through plan_order on every migration and the catalog seeds. A wrong
// product fails. A question is the safe failure and passes; a right product passes. Runs in CI, no model.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "../../test/db/harness";
import data from "./zero-wrong.json";

let db: TestDb; let party: string; let skuOf: Map<string, string>;
beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`update stock_levels set on_hand = 50`);
  party = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
  skuOf = new Map((await db.all<{ id: string; sku: string }>(`select id, sku from products`)).map((r) => [r.id, r.sku]));
}, 60_000);
afterAll(async () => { await db?.pg.close(); });

describe("1.22 zero wrong: the four phrasings B3 left", () => {
  it.each(data.readings.map((r, k) => [`${r.id}#${k} ${r.text}`, r] as const))("%s", async (_n, r) => {
    const lines = r.lines.map((l: any) => ({ ...l, qty: l.qty ?? 1, unit: l.unit ?? "each", modifiers: l.modifiers ?? [], confidence: 0.8 }));
    const plan = await db.rpc("plan_order_core", { p_party: party, p_intent: { intent: "order", lines, _message: r.text }, p_village: null, p_choices: {} });
    const got = (plan.lines ?? []).filter((l: any) => l.status === "matched").map((l: any) => skuOf.get(l.chosen.product_id));
    const allowed = new Set(r.items.flatMap((i: any) => [i.sku, ...(i.accept ?? [])]));
    expect(got.filter((s: string | undefined) => !allowed.has(s!)), JSON.stringify(plan.lines.map((l: any) => [l.raw, l.status, l.unexplained]))).toEqual([]);
  }, 30_000);
});
