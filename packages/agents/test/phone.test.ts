import { describe, expect, it } from "vitest";
import { looksLikePhoneAttempt, parsePhone } from "../src/phone";

describe("a number the rider can call", () => {
  it.each([
    ["03 123 456", "+9613123456"], ["03123456", "+9613123456"], ["3123456", "+9613123456"], ["71 123 456", "+96171123456"],
    ["رقمي 76-123456", "+96176123456"], ["+961 3 123 456", "+9613123456"], ["00961 70 123 456", "+96170123456"],
    ["9613123456", "+9613123456"], ["٠٣١٢٣٤٥٦", "+9613123456"], ["05 123 456", "+9615123456"], ["+44 7700 900123", "+447700900123"],
  ])("%s -> %s", (text, e164) => expect(parsePhone(text)).toBe(e164));

  it.each(["بدي 3 علب لبنة و 2 خبز", "123", "12 3456", "طابق 3 بناية 12", "0612345678"])("%s is not a phone", (text) =>
    expect(parsePhone(text)).toBeNull());

  it("knows a message that was meant to be a number", () => {
    expect(looksLikePhoneAttempt("03 12 34")).toBe(true);
    expect(looksLikePhoneAttempt("بدي 3 علب")).toBe(false);
  });
});
