// SR1 (4): the reading step for search, case by case (evals/cases/sr1_search_reading.json). Code, no model.
import { describe, expect, it } from "vitest";
import cases from "../cases/sr1_search_reading.json";
import { readSearch } from "../../packages/agents/src/search-reading";

describe("SR1: the customer's words become filters", () => {
  it.each(cases.cases.map((c) => [c.id, c] as const))("%s", (_id, c: any) => {
    const r = readSearch(c.text);
    const why = JSON.stringify(r);
    if (c.expect.query !== undefined) expect(r.query, why).toBe(c.expect.query);
    if (c.expect.filters) expect(r.filters, why).toMatchObject(c.expect.filters);
    for (const k of c.expect.absent ?? []) expect((r.filters as any)[k], why).toBeUndefined();
    if (c.expect.count !== undefined) expect(r.count, why).toBe(c.expect.count);
    if (c.expect.basket !== undefined) {
      if (c.expect.basket === null) expect(r.basket, why).toBeNull();
      else expect(r.basket, why).toMatchObject(c.expect.basket);
    }
  });
});
