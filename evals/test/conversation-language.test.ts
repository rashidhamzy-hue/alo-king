// Session B1b (SIM1 fix 6): the conversation's language, kept across turns (evals/cases/conversation_language.json). Code, no model.
import { describe, expect, it } from "vitest";
import cases from "../cases/conversation_language.json";
import { keepLanguage, type Speech } from "../../packages/agents/src/language";

describe("the customer's language is kept for the conversation (SIM1 fix 6)", () => {
  it.each(cases.cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    let speech: Speech | undefined;
    c.turns.forEach((t: any, i: number) => {
      const own = [t.typed, t.voice].filter((x): x is string => typeof x === "string");
      const taps = typeof t.tap === "string" ? [t.tap] : [];
      speech = keepLanguage(speech, { reading: t.reading ?? null, own, taps }) ?? speech;
      expect(speech, `turn ${i + 1}: ${t.typed ?? t.voice ?? t.tap}`).toBe(t.expect);
    });
  });
});
