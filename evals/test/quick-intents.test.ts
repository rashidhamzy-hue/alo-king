// The phrases answered without a model, and the near misses that must still reach it.
import { describe, expect, it } from "vitest";
import { quickIntent } from "@ak/agents/quick-intent";
import cases from "../cases/quick_intents.json";

describe("quick intents (evals/cases/quick_intents.json)", () => {
  it.each(cases.cases.map((c) => [c.text, c.expect] as const))("%s -> %s", (text, expected) => {
    expect(quickIntent(text)).toBe(expected);
  });
});
