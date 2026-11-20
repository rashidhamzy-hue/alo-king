// AST1: the eval's twenty founder questions with a scripted model (free; CI). Each question runs through the real turn code against the
// invented day (world.ts): the tools it names are called and answer from the read-only SQL functions, the honesty check passes on the
// scripted answer (every figure is in the tool results), and the grader finds every expected fact and no forbidden word. The same
// questions and grader run once against the real model in live.assistant.test.ts.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "../../../test/db/harness";
import { seedWorld } from "../world";
import { QUESTIONS, runQuestion, scriptedModel, switchOn } from "../eval";

let db: TestDb;
beforeAll(async () => { db = await openTestDb(); await seedWorld(db); await switchOn(db); }, 120_000);

describe("the assistant's eval, scripted model", () => {
  it("has twenty-three questions, each with its facts and a script", () => {
    expect(QUESTIONS).toHaveLength(23);   // AST1's twenty and FIX2's three follow-ups
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(23);
    for (const q of QUESTIONS) { expect(q.facts.length, q.id).toBeGreaterThan(0); expect(q.script.answer, q.id).not.toBe(""); }
  });
  it.each(QUESTIONS.map((q) => [q.id, q] as const))("%s", async (_id, q) => {
    const { g } = await runQuestion(db, q, scriptedModel(q.script));
    expect(g.outcome, g.answer).toBe("answered");
    expect(g.wrong, g.answer).toEqual([]);
    expect(g.missingTools).toEqual([]);
    expect(g.forbidden).toEqual([]);
    expect(g.language).toBe(true);
  });
});

// FIX2 (AST1's follow-ups from its live run): the model called riders "he" and "she" from their names, and gave cash held and cash to
// collect for "yesterday" although the data only knows them now. The prompt says both; the tools mark "now" figures on another day.
describe("FIX2: no gender from a name; 'now' figures said as now", () => {
  it("the prompt forbids guessing gender, in English and Arabic, and asks for 'as of now'", async () => {
    const { SYSTEM } = await import("../../../apps/console/src/assistant/prompt");
    expect(SYSTEM).toMatch(/never guess a rider's, customer's or staff member's gender from their name/);
    expect(SYSTEM).toMatch(/«معه» or «معها»/);
    expect(SYSTEM).toMatch(/now_only/);
  });
  it("money and riders for another day carry now_only and its note; for today they do not", async () => {
    const { markNowOnly } = await import("../../../apps/console/src/assistant/tools");
    const NOW = new Date("2026-11-18T13:00:00Z");
    expect(markNowOnly("money", "2026-11-17", NOW, { cash_to_collect_usd: 42 })).toMatchObject({ now_only: ["cash_to_collect_usd", "cash_to_collect_orders", "cash_held_by_riders_usd"], now_only_note: expect.stringContaining("not on 2026-11-17") });
    expect(markNowOnly("money", "2026-11-18", NOW, { cash_to_collect_usd: 42 })).toEqual({ cash_to_collect_usd: 42 });
    expect(markNowOnly("money", null, NOW, { cash_to_collect_usd: 42 })).toEqual({ cash_to_collect_usd: 42 });
    expect(markNowOnly("riders", "2026-11-17", NOW, { on_shift: 2 })).toHaveProperty("now_only");
    expect(markNowOnly("orders", "2026-11-17", NOW, { orders: 7 })).toEqual({ orders: 7 });
  });
  it("the 'yesterday' cash question reaches the model with the mark", async () => {
    const q = QUESTIONS.find((x) => x.id === "cash_other_day")!;
    const m = scriptedModel(q.script);
    await runQuestion(db, q, m);
    const results = JSON.stringify(m.calls.at(-1)!.messages);
    expect(results).toContain("now_only");
  });
});
