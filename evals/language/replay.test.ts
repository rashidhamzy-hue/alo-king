// Build plan 1.22: replay the model's recorded readings (a results file from live.lang.test.ts) through the current planner,
// with no model call. Measures a change to the matcher or the pack before spending a live run. Skipped unless asked for:
//   ALO_LANG_REPLAY=evals/language/results/before.json npx vitest run evals/language/replay.test.ts
// Older results files hold the readings of imperfect runs only (wrong + missed); those are replayed and the rest counted.
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openTestDb } from "../../test/db/harness";
import { scoreCase, totals, type Expected, type Got } from "./score";

const env = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});
const file = env.ALO_LANG_REPLAY;
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
type Line = { raw: string; query: string; brand_hint: string | null; source_hint?: string | null };

describe.skipIf(!file)("replay readings (1.22)", () => {
  it("scores the recorded readings on the current planner", async () => {
    const res = JSON.parse(readFileSync(file!, "utf8"));
    const cases = new Map<string, { text: string; items: Expected[] }>();
    for (const f of ["hand.json", "cases.json"]) if (existsSync(here(f))) for (const c of JSON.parse(readFileSync(here(f), "utf8")).cases) cases.set(c.id, c);
    const readings: { id: string; lines: Line[] }[] = res.readings ?? [...res.wrong, ...res.missed].filter((r: any, i: number, a: any[]) => a.findIndex((x) => x.id === r.id) === i);
    const db = await openTestDb();
    await db.pg.exec(`update stock_levels set on_hand = 50`);
    const party = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
    const skuOf = new Map((await db.all<{ id: string; sku: string }>(`select id, sku from products`)).map((r) => [r.id, r.sku]));
    const out: any[] = [];
    for (const r of readings) {
      const c = cases.get(r.id); if (!c) continue;
      const lines = r.lines.map((l) => ({ ...l, qty: 1, unit: "each", modifiers: [], confidence: 0.8 }));
      const plan = lines.length ? await db.rpc("plan_order_core", { p_party: party, p_intent: { intent: "order", lines }, p_village: null, p_choices: {} }) : { lines: [] };
      const got: Got[] = (plan.lines ?? []).filter((l: any) => l.status === "matched").map((l: any) => ({ sku: skuOf.get(l.chosen.product_id)!, assumed: l.assumed }));
      out.push({ id: r.id, text: c.text, expected: c.items, got, score: scoreCase(c.items, got),
                 lines: (plan.lines ?? []).map((l: any) => ({ raw: l.raw, status: l.status, via: l.via, unexplained: l.unexplained,
                          cand: (l.candidates ?? []).map((x: any) => skuOf.get(x.product_id)) })) });
    }
    const t = totals(out.map((o) => o.score));
    console.log(JSON.stringify({ replayed: out.length, of: res.all?.cases, ...t }));
    writeFileSync(here("results/replay.json"), JSON.stringify({ totals: t, wrong: out.filter((o) => o.score.wrong.length), missed: out.filter((o) => o.score.missed.length) }, null, 1) + "\n");
    expect(out.length).toBeGreaterThan(0);
  }, 1_800_000);
});
