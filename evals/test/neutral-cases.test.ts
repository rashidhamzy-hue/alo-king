// 1.10: the neutrality and food-facts cases, run against the output guard in CI. The live model run is evals/live/.
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { checkModelText } from "@ak/agents/output-guard";
import { runWordingCase } from "../run";
import cases from "../cases/neutral_and_food_facts.json";

const rows = cases.cases.flatMap((c) => [
  ...c.bad.map(([text, code]) => [c.id, "refuses", text!, code!, c.approved] as const),
  ...c.good.map((text) => [c.id, "allows", text, null, c.approved] as const),
]);

describe("neutral and factual (evals/cases/neutral_and_food_facts.json)", () => {
  it("every case has at least one reply the guard must refuse and one it must allow", () => {
    for (const c of cases.cases) { expect(c.bad.length, c.id).toBeGreaterThan(0); expect(c.good.length, c.id).toBeGreaterThan(0); }
  });
  it.each(rows)("%s: %s %s", (_id, _verdict, text, code, approved) => {
    expect(checkModelText(text, { approvedFacts: new Set(approved) })?.code ?? null).toBe(code);
  });
});

describe("the live runner (npm run eval wiring)", () => {
  it("drives the real ask loop: a refused reply is recorded with its reason, and the reworded one is what goes out", async () => {
    const replies = ["أحسن مطعم هو أبو علي", "شو الأهم إلك: السعر أو وقت التوصيل؟"];
    let n = 0;
    const client = { messages: { create: async () => ({ content: [{ type: "tool_use", id: `t${n}`, name: "reply", input: { text: replies[n++] } }],
      usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Anthropic.Message } };
    const r = await runWordingCase(client, "scripted", cases.cases[0]!);
    expect(r.attempts).toEqual([{ tool: "reply", text: replies[0], refused: "quality_judgement" }, { tool: "reply", text: replies[1], refused: null }]);
    expect(r.sent).toBe(replies[1]);
  });
});
