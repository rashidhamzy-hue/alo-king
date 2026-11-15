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

// B1b (SIM1 fix 8): code's check after the reading. Even when the reading says off_topic, a greeting, a thank-you, a goodbye or a
// message about shopping for a dish is not turned away; every off_topic case still is.
import { courtesyOf, stillOffTopic } from "../../packages/agents/src/courtesy";
describe("code's check after an off_topic reading (SIM1 fix 8)", () => {
  const b1b = cases.cases.slice(cases.cases.findIndex((c) => c.text === "marhaba") + 1);
  it("the B1b cases are there", () => { expect(b1b.length).toBeGreaterThanOrEqual(20); });
  it.each(cases.cases.filter((c) => c.expect === "off_topic").map((c) => [c.text] as const))("still off-topic: %s", (text) => {
    expect(stillOffTopic(text)).toBe(true);
  });
  it.each(b1b.map((c) => [c.text] as const))("not off-topic: %s", (text) => { expect(stillOffTopic(text)).toBe(false); });
  it("names what each courtesy is", () => {
    expect(courtesyOf("kifkon?")).toBe("greeting");
    expect(courtesyOf("مرحبا، كيفك؟ عندي سؤال بسيط")).toBe("greeting");
    expect(courtesyOf("ok np, thanks anyway. bye")).toBe("thanks");
    expect(courtesyOf("ماشي مرسي، يعطيكن العافية")).toBe("thanks");
    expect(courtesyOf("لا شكراً")).toBe("thanks");
    expect(courtesyOf("بدي علبتين لبنة وربطة خبز")).toBeNull();
    expect(courtesyOf("kifak? shu 3am ta3mol lyom? khabberne 3an 7alak")).toBeNull();     // chat about the assistant: off-topic
  });
});
