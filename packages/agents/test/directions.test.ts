// The rider's note is the customer's own words about where they are (directionsOf). B4's staging proof (AK-1008) found the
// floor said twice: «… الطابق الأول | طابق الطابق الأول». K1 wrote this before the fix.
import { describe, expect, it } from "vitest";
import { directionsOf } from "../src/pipeline";
import type { OrderIntent } from "../src/schemas";

const intent = (address: Partial<OrderIntent["address"]>) =>
  ({ address: { floor: null, village: null, building: null, landmark: null, verbatim: null, recipient_name: null, ...address } }) as OrderIntent;

describe("directionsOf: the floor once", () => {
  it("AK-1008: a floor that already says «الطابق» is not prefixed again", () => {
    const note = directionsOf(intent({ verbatim: "بيت الاختبار، الطابق الأول، حد ساحة الضيعة", building: "بيت الاختبار", floor: "الطابق الأول", landmark: "حد ساحة الضيعة" }));
    expect(note).toBe("بيت الاختبار، الطابق الأول، حد ساحة الضيعة");
    expect(note).not.toContain("طابق الطابق");
  });
  it("a floor alone, without verbatim, keeps its own words", () => {
    expect(directionsOf(intent({ building: "بيت الاختبار", floor: "الطابق التاني" }))).toBe("بيت الاختبار | الطابق التاني");
    expect(directionsOf(intent({ floor: "2nd floor" }))).toBe("2nd floor");
    expect(directionsOf(intent({ floor: "tabe2 el tene" }))).toBe("tabe2 el tene");
  });
  it("a bare floor number or word still gets the word «طابق»", () => {
    expect(directionsOf(intent({ building: "بناية النور", floor: "2" }))).toBe("بناية النور | طابق 2");
    expect(directionsOf(intent({ floor: "أرضي" }))).toBe("طابق أرضي");
  });
});
