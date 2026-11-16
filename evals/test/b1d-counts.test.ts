// Session B1d (counts and edits): the readings of the wrong-product conversations of sim-test 43781701377 (evals/cases/b1d_counts_edits.json),
// tidied by code before the planner, and the count of packs against the product chosen. Code, no model.
import { describe, expect, it } from "vitest";
import file from "../cases/b1d_counts_edits.json";
import { OrderIntent } from "../../packages/agents/src/schemas";
import { packSizeCount, tidyReading } from "../../packages/agents/src/reading";

describe("B1d: counts and edits read against the customer's words", () => {
  it.each(file.readings.map((c) => [c.id, c] as const))("%s", (_id, c: any) => {
    const intent = OrderIntent.parse({ language: "mixed", ...c.reading, lines: c.reading.lines.map((l: any) => ({ confidence: 0.9, ...l })) });
    const out = tidyReading(intent, c.text);
    expect(out.lines.length, JSON.stringify(out.lines)).toBe(c.expect.lines.length);
    c.expect.lines.forEach((e: any, i: number) => {
      const l = out.lines[i] as any;
      if (e.raw !== undefined) expect(l.raw).toBe(e.raw);
      if (e.qty !== undefined) expect(l.qty, JSON.stringify(l)).toBe(e.qty);
      if (e.change !== undefined) expect(l.change ?? null, JSON.stringify(l)).toBe(e.change);
    });
  });
});

describe("B1d: a count against the chosen pack's own measure", () => {
  it.each(file.packs.map((c) => [c.id, c] as const))("%s", (_id, c: any) => {
    expect(packSizeCount(c.line, [c.product, null])).toBe(c.expect);
  });
});

describe("B1d: every wrong-product conversation of the run is read and placed", () => {
  it("25 conversations, each with what was wrong, what must happen and what holds it", () => {
    expect(file.cases).toHaveLength(25);
    for (const c of file.cases) for (const k of ["id", "class", "wrong", "expect", "tested_by"]) expect((c as any)[k], `${c.id}.${k}`).toBeTruthy();
  });
});
