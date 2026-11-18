// WEB2: the small readers the turn and the checkout use, written so no pattern can backtrack on a long run of spaces (CodeQL, #118).
import { describe, expect, it } from "vitest";
import { CARD_AGAIN, SIGN_OUT, webWords } from "@ak/agents/web-orders";
import { parsePin, splitAmount } from "../../apps/web/src/lib/order";

describe("the readers", () => {
  it("'sign out' and 'Card AK-xxxx', however spaced or ended, and nothing longer", () => {
    for (const t of ["sign out", "  Sign   me  out. ", "SIGNOUT!", "log out everywhere", "déconnexion", "تسجيل الخروج", "سجل خروج من كل الأجهزة"]) expect(SIGN_OUT.test(webWords(t)), t).toBe(true);
    for (const t of ["how do I sign out of the site", "sign out and order milk", "out"]) expect(SIGN_OUT.test(webWords(t)), t).toBe(false);
    expect(CARD_AGAIN.exec(webWords("  Card   AK-1042 . "))?.[1]).toBe("AK-1042");
    expect(CARD_AGAIN.exec(webWords("card AK-1042 please"))).toBeNull();
  });
  it("a long run of spaces is read at once", () => {
    const t0 = Date.now();
    const evil = "sign" + " ".repeat(50_000) + "x";
    expect(SIGN_OUT.test(webWords(evil))).toBe(false);
    expect(CARD_AGAIN.test(webWords("card" + " ".repeat(50_000) + "!"))).toBe(false);
    expect(parsePin("33.6" + " ".repeat(50_000) + "x")).toBeNull();
    expect(Date.now() - t0).toBeLessThan(500);
  });
  it("a pin from coordinates or a map link", () => {
    expect(parsePin("33.68, 35.56")).toEqual({ lat: 33.68, lng: 35.56 });
    expect(parsePin("33.68 35.56")).toEqual({ lat: 33.68, lng: 35.56 });
    expect(parsePin("https://www.google.com/maps/@12.3456,45.6789,17z")).toEqual({ lat: 12.3456, lng: 45.6789 });
    expect(parsePin("https://maps.google.com/?q=33.68%2C35.56")).toEqual({ lat: 33.68, lng: 35.56 });
    expect(parsePin("my house")).toBeNull();
    expect(parsePin("95.0, 35.0")).toBeNull();
  });
  it("a card line's label and amount", () => {
    expect(splitAmount("Delivery (Baakline): $1.00")).toEqual(["Delivery (Baakline):", "$1.00"]);
    expect(splitAmount("*Total · $16.45*")).toEqual(["Total", "$16.45"]);                        // CX2: the chat's « · » is not the label's
    expect(splitAmount("Delivery to Baakline · $1.00")).toEqual(["Delivery to Baakline", "$1.00"]);
    expect(splitAmount("or 1,472,000 LBP")).toEqual(["or", "1,472,000 LBP"]);
    expect(splitAmount("If an item is missing: we ask you")).toEqual(["If an item is missing: we ask you", null]);
  });
});
