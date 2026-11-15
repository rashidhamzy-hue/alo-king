// B1a: the three measures read from a conversation's replies and the judge's flags (evals/sim/basket-measures.ts).
import { describe, expect, it } from "vitest";
import { basketMeasures, basketSection } from "../basket-measures";
import type { ConversationResult } from "../run";

const conv = (replies: string[][], verdict: Record<string, unknown> | null = null, id = "sim-001") => ({
  id, turns: replies.map((rs, i) => ({ n: i + 1, replies: rs.map((text) => ({ kind: "text", text, options: [] })) })), verdict,
}) as unknown as ConversationResult;

describe("B1a measures", () => {
  it("a minimum said twice with no amount is a loop; code's line with the amounts never is", () => {
    expect(basketMeasures(conv([["طلبك تحت الحد الأدنى، ضيف شي"], ["لسا تحت الحد الأدنى"]])).minimumLoop).toBe(true);
    expect(basketMeasures(conv([["🛒 طلبك أقل من الحد الأدنى.\nالحد الأدنى للطلب: $5.00\nناقصك: $4.31"], ["🛒 طلبك أقل من الحد الأدنى.\nناقصك: $0.27"]])).minimumLoop).toBe(false);
    expect(basketMeasures(conv([["Your order is below the minimum."]])).minimumLoop).toBe(false);
  });
  it("«no open order» after the first turn is a lost basket; on the first turn it is not", () => {
    expect(basketMeasures(conv([["ok"], ["You have no open order now. What would you like to order?"]])).lostBasket).toBe(true);
    expect(basketMeasures(conv([["You have no open order now. What would you like to order?"]])).lostBasket).toBe(false);
  });
  it("the judge's wrong product flag, and a section with the baseline", () => {
    const r = conv([["x"]], { wrong_or_uninvited_product: true });
    expect(basketMeasures(r).wrongProduct).toBe(true);
    expect(basketSection([r]).join("\n")).toContain("| wrong or uninvited product (judge) | 1 (100.0%) | 143 of 463");
  });
});
