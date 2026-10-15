import { describe, expect, it } from "vitest";
import { readPhone, readQuantity, readRecipient } from "./lexicon";

describe("quantities in four languages (§38.3 Arabizi number normalisation)", () => {
  it("a standalone number is the quantity; Arabizi letter digits stay in the words", () => {
    expect(readQuantity("Pepsi diet 2")).toEqual({ qty: 2, rest: "Pepsi diet" });
    expect(readQuantity("2 man2oushe kishk")).toEqual({ qty: 2, rest: "man2oushe kishk" });
    expect(readQuantity("bade shi 7arr w rkhis")).toEqual({
      qty: null,
      rest: "bade shi 7arr w rkhis",
    });
    expect(readQuantity("ta2ouk x3")).toEqual({ qty: 3, rest: "ta2ouk" });
    expect(readQuantity("7up")).toEqual({ qty: null, rest: "7up" });
  });
  it("number words and Arabic digits", () => {
    expect(readQuantity("tnen shawarma").qty).toBe(2);
    expect(readQuantity("deux manouches").qty).toBe(2);
    expect(readQuantity("٣ كنافة")).toEqual({ qty: 3, rest: "كنافة" });
    expect(readQuantity("تلاتة شاورما").qty).toBe(3);
    expect(readQuantity("a shawarma").qty).toBeNull();
  });
  it("never a quantity above 50", () => expect(readQuantity("99 falafel").qty).toBeNull());
});

describe("phone numbers and recipients (§22.1)", () => {
  it("Lebanese numbers written the usual ways", () => {
    for (const t of [
      "70 123 456",
      "70123456",
      "03 123 456",
      "+961 70 123 456",
      "0096170123456",
      "٧٠١٢٣٤٥٦",
    ])
      expect(readPhone(t), t).toMatch(/^\+961(70123456|3123456)$/);
  });
  it("international numbers keep their country code", () => {
    expect(readPhone("+33 6 12 34 56 78")).toBe("+33612345678");
    expect(readPhone("+971 50 123 4567")).toBe("+971501234567");
  });
  it("not a number", () => {
    expect(readPhone("my mother")).toBeNull();
    expect(readPhone("12345")).toBeNull();
  });
  it("a name and a number from one message", () => {
    expect(readRecipient("Mom 70 123 456")).toEqual({ name: "Mom", phone: "+96170123456" });
    expect(readRecipient("ماما +961 3 123 456")).toEqual({ name: "ماما", phone: "+9613123456" });
    expect(readRecipient("my mother")).toEqual({ name: "my mother", phone: null });
  });
});
