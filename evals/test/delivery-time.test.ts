// W1 (C3's request 7): a delivery time said in words is read by code. evals/cases/delivery_time.json judges the reader.
import { describe, expect, it } from "vitest";
import { readWhen, whenOnly } from "@ak/agents/windows";
import cases from "../cases/delivery_time.json";

type Case = { text: string; expect: Record<string, unknown> | null; only?: boolean };

describe("a delivery time said in words (evals/cases/delivery_time.json)", () => {
  it.each((cases.cases as Case[]).map((c) => [c.text, c] as const))("%s", (_text, c) => {
    expect(readWhen(c.text)).toEqual(c.expect);
    if (c.expect) expect(!!whenOnly(c.text)).toBe(!!c.only);
    else expect(whenOnly(c.text)).toBeNull();
  });
});
