import { describe, expect, it } from "vitest";
import { disagreements } from "./voice-diff";

const o = (items: [string, number | null][], place: string | null = null) => ({
  items: items.map(([dish, quantity]) => ({ dish, quantity, details: "" })),
  place,
  merchant_or_cuisine: null,
});

describe("voice label disagreements (§30.7)", () => {
  it("agree when dishes, quantities and place match (case and punctuation ignored)", () => {
    expect(
      disagreements(
        o([["Chicken shawarma", 2]], "Baakline"),
        o([["chicken shawarma", 2]], "baakline"),
      ),
    ).toEqual([]);
  });
  it("flags a dish, a quantity or a place", () => {
    expect(disagreements(o([["shawarma", 2]]), o([["shawarma", 3]]))).toEqual([
      'quantity of "shawarma": A 2 vs B 3',
    ]);
    expect(disagreements(o([["shawarma", 2]]), o([["falafel", 2]])).length).toBe(2);
    expect(disagreements(o([], "Baakline"), o([], "Bakaata"))).toEqual([
      "place: A Baakline vs B Bakaata",
    ]);
  });
});
