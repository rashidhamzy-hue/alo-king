// 1.18: the off-topic cases are well formed and balanced. The real model's reading of each is scored live (evals/live/).
import { describe, expect, it } from "vitest";
import cases from "../cases/off_topic.json";

describe("stay on the job (evals/cases/off_topic.json)", () => {
  it("holds both kinds, and no message twice", () => {
    const kinds = new Set(cases.cases.map((c) => c.expect));
    expect([...kinds].sort()).toEqual(["not_off_topic", "off_topic"]);
    expect(new Set(cases.cases.map((c) => c.text)).size).toBe(cases.cases.length);
    expect(cases.cases.filter((c) => c.expect === "off_topic").length).toBeGreaterThanOrEqual(10);
  });
});
