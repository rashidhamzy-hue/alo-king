import { describe, expect, it } from "vitest";
import { scoreCase, totals } from "./score";

describe("1.22 item scoring", () => {
  it("a right product is a hit, another product is wrong, a question is a miss", () => {
    const s = scoreCase([{ sku: "A" }, { sku: "B" }, { sku: "C" }], [{ sku: "A" }, { sku: "X" }]);
    expect(s.tp).toBe(1);
    expect(s.wrong).toEqual([{ sku: "X" }]);
    expect(s.missed.map((m) => m.sku)).toEqual(["B", "C"]);
  });
  it("accept lists cover generic words (any arabic bread for «خبز»)", () => {
    expect(scoreCase([{ sku: "AK-0080", accept: ["AK-0081"] }], [{ sku: "AK-0081" }]).tp).toBe(1);
  });
  it("one product cannot answer two lines", () => {
    const s = scoreCase([{ sku: "A" }, { sku: "A" }], [{ sku: "A" }]);
    expect([s.tp, s.missed.length]).toEqual([1, 1]);
  });
  it("F1 counts wrong products against precision and misses against recall", () => {
    const t = totals([scoreCase([{ sku: "A" }, { sku: "B" }], [{ sku: "A" }, { sku: "Z" }])]);
    expect(t).toMatchObject({ tp: 1, fp: 1, fn: 1, precision: 0.5, recall: 0.5, f1: 0.5, perfect_cases: 0 });
  });
});
