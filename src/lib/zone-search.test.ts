import { describe, expect, it } from "vitest";
import { NOT_DELIVERED, ZONE } from "@/design/chouf-map.generated";
import { normArabic, normLatin, searchPlaces, skeleton, within } from "./zone-search";

const top = (q: string) => searchPlaces(ZONE, q, 3).map((p) => p.slug);

describe("village search (DECISIONS §39.11)", () => {
  it("normalises Arabic spellings", () => {
    expect(normArabic("الباروك")).toBe("باروك");
    expect(normArabic("دير القمر")).toBe("ديرقمر");
    expect(normArabic("كفر نبرخ‎")).toBe("كفرنبرخ");
    expect(normArabic("بيت الدّين")).toBe("بيتدين");
  });

  it("reads Arabizi digits and reduces Latin names to a skeleton", () => {
    expect(normLatin("Ba3e2lin")).toBe("baelin");
    expect(skeleton(normLatin("Ba3e2lin", "k"))).toBe(skeleton(normLatin("Baakline")));
    expect(skeleton(normLatin("Baakleen"))).toBe("bkln");
    expect(skeleton(normLatin("Chouf"))).toBe(skeleton(normLatin("Shouf")));
    expect(skeleton(normLatin("Deir el Qamar"))).toBe("drkmr");
    expect(within("bkln", "bklm", 1)).toBe(true);
    expect(within("bkln", "smkn", 1)).toBe(false);
  });

  it("finds the shop villages in four languages", () => {
    expect(top("Baakline")[0]).toBe("chf-baakline");
    expect(top("بعقلين")[0]).toBe("chf-baakline");
    expect(top("ba3e2lin")[0]).toBe("chf-baakline");
    expect(top("baakleen")[0]).toBe("chf-baakline");
    expect(top("Deir el Qamar")[0]).toBe("chf-deir-al-qamar");
    expect(top("دير القمر")[0]).toBe("chf-deir-al-qamar");
    expect(top("dayr al-qamar")[0]).toBe("chf-deir-al-qamar");
    expect(top("Barouk")[0]).toBe("chf-barouk");
    expect(top("el barouk")[0]).toBe("chf-barouk");
    expect(top("الباروك")[0]).toBe("chf-barouk");
    expect(top("Semqanieh")[0]).toBe("chf-semqanieh");
    expect(top("samqaniyeh")[0]).toBe("chf-semqanieh");
    expect(top("السمقانية")[0]).toBe("chf-semqanieh");
  });

  it("finds named edge villages, and partial typing narrows as you type", () => {
    expect(top("Niha")).toContain("chf-niha");
    expect(top("nee7a").length + top("niha").length).toBeGreaterThan(0);
    expect(top("Jbaa")[0]).toBe("chf-jbaa");
    expect(top("جباع")[0]).toBe("chf-jbaa");
    expect(top("Batl")[0]).toBe("chf-batloun");
    expect(top("بتل")).toContain("chf-batloun");
  });

  it("answers nothing for one letter, and places outside the zone are found in the not-delivered list", () => {
    expect(top("b")).toEqual([]);
    expect(searchPlaces(NOT_DELIVERED, "Damour", 1).length).toBe(1);
    expect(top("Damour")).not.toContain("chf-damour");
  });
});
