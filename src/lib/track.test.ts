import { describe, expect, it } from "vitest";
import { stepOf } from "./track";

describe("tracking steps", () => {
  it("walks a delivery order from sent to delivered", () => {
    expect(["placed", "accepted", "preparing", "ready", "picked_up", "near_drop", "delivered"].map((s) => stepOf(s, false))).toEqual([0, 1, 2, 2, 3, 3, 4]);
  });
  it("a pickup order that is ready is at 'Ready at the shop', not 'Being prepared'", () => {
    expect(stepOf("ready", true)).toBe(3);
    expect(stepOf("preparing", true)).toBe(2);
    expect(stepOf("delivered", true)).toBe(4);
  });
  it("an unknown status starts at the first step", () => {
    expect(stepOf("something_new", false)).toBe(0);
  });
});
