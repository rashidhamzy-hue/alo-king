import { describe, expect, it } from "vitest";
import { kitchenState, receivedFooter, stillWaitingText } from "./kitchen.ts";

describe("kitchenState", () => {
  it("a linked owner phone or a kitchen screen means a kitchen can answer", () => {
    expect(kitchenState({ ownerLinked: true, hasKitchenScreen: false, isLive: true })).toBe("linked");
    expect(kitchenState({ ownerLinked: false, hasKitchenScreen: true, isLive: false })).toBe("linked"); // the demo vendor on /merchant
  });
  it("nobody attached: a demo order when the vendor is not live, otherwise the restaurant has not been reached", () => {
    expect(kitchenState({ ownerLinked: false, hasKitchenScreen: false, isLive: false })).toBe("demo");
    expect(kitchenState({ ownerLinked: false, hasKitchenScreen: false, isLive: true })).toBe("unlinked");
  });
});

describe("receivedFooter tells the truth", () => {
  it("only linked kitchens are 'confirming now'", () => {
    expect(receivedFooter("linked", "X", false)).toMatch(/confirming it now/);
    for (const s of ["demo", "unlinked"] as const) for (const ar of [false, true]) expect(receivedFooter(s, "X", ar)).not.toMatch(/confirming (it )?now|عم يأكد/);
  });
  it("demo says demo; unlinked says awaiting the restaurant and offers cancel", () => {
    expect(receivedFooter("demo", "X", false)).toMatch(/demo order/i);
    expect(receivedFooter("demo", "X", true)).toMatch(/تجريبي/);
    expect(receivedFooter("unlinked", "Zaatar", false)).toMatch(/Zaatar.*isn't connected.*cancel/s);
    expect(receivedFooter("unlinked", "Zaatar", true)).toMatch(/Zaatar/);
  });
});

describe("stillWaitingText", () => {
  it("demo orders get no 'still confirming' message", () => expect(stillWaitingText("demo", "AB1", "X", false)).toBeNull());
  it("unlinked: honest wording with cancel; linked: the usual", () => {
    expect(stillWaitingText("unlinked", "AB1", "X", false)).toMatch(/haven't been able to reach.*cancel/s);
    expect(stillWaitingText("linked", "AB1", "X", false)).toMatch(/still being confirmed/);
    expect(stillWaitingText("linked", "AB1", "X", true)).toMatch(/AB1/);
  });
});
