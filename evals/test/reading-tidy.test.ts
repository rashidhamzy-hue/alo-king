// Session B1b: what code corrects in the model's reading before the planner (evals/cases/reading_tidy.json). Code, no model.
import { describe, expect, it } from "vitest";
import cases from "../cases/reading_tidy.json";
import { OrderIntent } from "../../packages/agents/src/schemas";
import { tidyReading } from "../../packages/agents/src/reading";

describe("the reading, tidied by code (B1a's leftovers)", () => {
  it.each(cases.cases.map((c) => [c.id, c] as const))("%s", (_id, c: any) => {
    const intent = OrderIntent.parse({ language: "mixed", ...c.reading, lines: c.reading.lines.map((l: any) => ({ confidence: 0.9, ...l })) });
    const out = tidyReading(intent, c.text);
    expect(out.lines.length, JSON.stringify(out.lines)).toBe(c.expect.lines.length);
    c.expect.lines.forEach((e: any, i: number) => {
      const l = out.lines[i] as any;
      if (e.query !== undefined) expect(l.query).toBe(e.query);
      if (e.raw !== undefined) expect(l.raw).toBe(e.raw);
      if (e.qty !== undefined) expect(l.qty).toBe(e.qty);
      if (e.change !== undefined) expect(l.change ?? null).toBe(e.change);
    });
    if (c.expect.building !== undefined) expect(out.address.building).toBe(c.expect.building);
  });
});
