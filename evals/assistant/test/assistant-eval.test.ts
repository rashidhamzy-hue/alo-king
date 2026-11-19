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
  it("has twenty questions, each with its facts and a script", () => {
    expect(QUESTIONS).toHaveLength(20);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(20);
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
