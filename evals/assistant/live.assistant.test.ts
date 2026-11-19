// AST1: the one live run of the assistant's eval: the twenty founder questions (questions.json) on the invented day (world.ts), answered by
// the real model through the real turn code. Skipped unless asked for:
//   ALO_LIVE_EVAL=1 ANTHROPIC_API_KEY=... MODEL_COST_CAP_USD=0.5 npx vitest run evals/assistant/live.assistant.test.ts
// COST1: every call is counted in model_costs (workflow assistant-eval) and the run stops at its cap. The report (one line per question,
// then the totals and the kill-gate's verdict) is written to evals/assistant/results/live.json and live.txt.
// Kill-gate: more than MAX_WRONG_FACTS facts wrong and the panel stays off (settings.assistant.enabled false, 0262).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { startMeter, finishMeter } from "../../scripts/lib/model-cost.mjs";
import { openTestDb, type TestDb } from "../../test/db/harness";
import { anthropicModel } from "../../apps/console/src/assistant/run";
import { seedWorld } from "./world";
import { MAX_WRONG_FACTS, QUESTIONS, runQuestion, switchOn, type Graded } from "./eval";

const env = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});
const live = env.ALO_LIVE_EVAL === "1" && !!env.ANTHROPIC_API_KEY;
// The meter wraps fetch before the client is built (the SDK takes fetch when it is constructed).
const meter = live ? await startMeter({ workflow: "assistant-eval", capDefault: 0.5, step: "live" }) : null;
const graded: Graded[] = [];
let db: TestDb;

beforeAll(async () => { if (live) { db = await openTestDb(); await seedWorld(db); await switchOn(db); } }, 120_000);
afterAll(async () => {
  if (!live) return;
  const wrong = graded.reduce((a, g) => a + g.wrong.length, 0), facts = graded.reduce((a, g) => a + g.facts, 0);
  const verdict = { questions: graded.length, facts, wrong, passes_gate: wrong <= MAX_WRONG_FACTS && graded.length === QUESTIONS.length,
    tools_missing: graded.filter((g) => g.missingTools.length).map((g) => `${g.id}: ${g.missingTools.join(",")}`),
    forbidden: graded.filter((g) => g.forbidden.length).map((g) => `${g.id}: ${g.forbidden.join(",")}`),
    wrong_language: graded.filter((g) => !g.language).map((g) => g.id), usd_in_world: Number(graded.reduce((a, g) => a + g.usd, 0).toFixed(4)) };
  mkdirSync("evals/assistant/results", { recursive: true });
  writeFileSync("evals/assistant/results/live.json", JSON.stringify({ verdict, graded }, null, 1));
  writeFileSync("evals/assistant/results/live.txt", [
    `AST1 live eval: ${verdict.questions} questions, ${verdict.facts} facts, ${verdict.wrong} wrong (gate: at most ${MAX_WRONG_FACTS}): ${verdict.passes_gate ? "PASSES" : "FAILS, the panel stays off"}`,
    ...graded.map((g) => `${g.wrong.length ? "WRONG" : "ok   "} ${g.id} [${g.outcome}; tools ${g.tools.join(",") || "none"}]${g.wrong.length ? ` missing: ${g.wrong.join("; ")}` : ""}\n      ${g.answer.replace(/\n/g, " / ").slice(0, 400)}`),
  ].join("\n") + "\n");
  console.log(JSON.stringify(verdict));
  if (meter) await finishMeter(meter);
});

describe.skipIf(!live)("live: the assistant's twenty founder questions", () => {
  const model = live ? anthropicModel(env.ANTHROPIC_API_KEY!) : null;
  // One after another: the run's cost cap is checked between calls, and the answers stay in the order of the file.
  it.each(QUESTIONS.map((q) => [q.id, q] as const))("%s", async (_id, q) => {
    const { g } = await runQuestion(db, q, model!);
    graded.push(g);
    console.log(JSON.stringify({ id: g.id, outcome: g.outcome, wrong: g.wrong, tools: g.tools, usd: g.usd }));
    expect(g.outcome).not.toBe("failed");
  }, 120_000);
});
