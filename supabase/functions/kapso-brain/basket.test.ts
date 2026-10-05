import { describe, expect, it } from "vitest";
import { basketCardText, basketTapId, clampQty, lineKey, parseBasketTap } from "./basket";

describe("lineKey", () => {
  it("is stable regardless of choice order and case", () => {
    expect(lineKey("i1", [{ group: "Size", option: "Large" }, { group: "Extra", option: "Cheese" }])).toBe(lineKey("i1", [{ group: "extra", option: "cheese" }, { group: "size", option: "large" }]));
  });
  it("differs by item and by options", () => {
    expect(lineKey("i1", [])).not.toBe(lineKey("i2", []));
    expect(lineKey("i1", [{ group: "Size", option: "S" }])).not.toBe(lineKey("i1", [{ group: "Size", option: "L" }]));
  });
});

describe("clampQty", () => {
  it("keeps 1..20 integers", () => {
    expect(clampQty(3)).toBe(3);
    expect(clampQty(0)).toBe(0);
    expect(clampQty(-4)).toBe(0);
    expect(clampQty(99)).toBe(20);
    expect(clampQty(2.7)).toBe(2);
    expect(clampQty("x" as any)).toBe(0);
  });
});

describe("basket taps", () => {
  it("round-trips ids", () => {
    expect(parseBasketTap(basketTapId("CHECKOUT", "abc"))).toEqual({ kind: "CHECKOUT", basketId: "abc" });
    expect(parseBasketTap("BCLR|abc")).toEqual({ kind: "BCLR", basketId: "abc" });
    expect(parseBasketTap("BASKET")).toEqual({ kind: "BASKET", basketId: null });
  });
  it("rejects anything else", () => {
    expect(parseBasketTap("CONFIRM|abc")).toBeNull();
    expect(parseBasketTap("CHECKOUT|")).toBeNull();
    expect(parseBasketTap("BCLR|a|b")).toBeNull();
  });
});

describe("basketCardText", () => {
  const lines = [{ quantity: 2, name: "Juice", choices: ["Mango"], lineTotal: 5 }, { quantity: 1, name: "Falafel", choices: [], lineTotal: 3.5 }];
  const both = (n: number) => `$${n.toFixed(2)} · ${Math.round(n * 89_500).toLocaleString("en-US")} LBP`;
  it("shows every line, subtotal and the delivery fee, each in both currencies (English)", () => {
    const t = basketCardText({ vendorName: "Al Tahouneh", lines, subtotal: 8.5, deliveryFee: 2, both, ar: false });
    expect(t).toContain("Al Tahouneh");
    expect(t).toContain("2 × Juice (Mango) — $5.00 · 447,500 LBP");
    expect(t).toContain("Subtotal   $8.50 · 760,750 LBP");
    expect(t).toContain("$2.00 · 179,000 LBP");
  });
  it("renders in Arabic", () => {
    const t = basketCardText({ vendorName: "الطحونة", lines, subtotal: 8.5, deliveryFee: 2, both, ar: true });
    expect(t).toMatch(/سلتك/);
    expect(t).toContain("447,500 LBP");
  });
  it("lists unavailable items so the customer knows they were dropped", () => {
    const t = basketCardText({ vendorName: "V", lines, subtotal: 8.5, deliveryFee: 2, both, ar: false, unavailable: ["Hummus"] });
    expect(t).toContain("Hummus");
  });
});

import { isCancelText } from "./basket";
describe("isCancelText", () => {
  it.each(["cancel", "Cancel!", "cancel my order", "never mind", "cancel, I changed my mind", "الغي الطلب", "كنسل"])("%s cancels", (t) => expect(isCancelText(t)).toBe(true));
  it.each(["cancel the soft drinks", "I want 2 juices", "don't cancel", "yes"])("%s does not", (t) => expect(isCancelText(t)).toBe(false));
});
