import { describe, expect, it } from "vitest";
import { legalAr } from "@/content/legal.ar";
import { legalEn } from "@/content/legal.en";
import { legalFr } from "@/content/legal.fr";
import { maskPhone, toE164 } from "./site-claim";

describe("toE164", () => {
  it("builds an international number from a country code and a local number", () => {
    expect(toE164("961", "71 123 456")).toBe("+96171123456");
    expect(toE164("961", "03 123 456")).toBe("+9613123456");
    expect(toE164("+961", "(76) 555-001")).toBe("+96176555001");
  });
  it("takes a number typed in full as it is", () => {
    expect(toE164("961", "+33 6 12 34 56 78")).toBe("+33612345678");
    expect(toE164("961", "0097143221100")).toBe("+97143221100");
  });
  it("reads Arabic-Indic and Persian digits", () => {
    expect(toE164("961", "٧١ ١٢٣ ٤٥٦")).toBe("+96171123456");
    expect(toE164("961", "۷۱۱۲۳۴۵۶")).toBe("+96171123456");
  });
  it("refuses what cannot be a number", () => {
    expect(toE164("961", "")).toBeNull();
    expect(toE164("961", "12")).toBeNull();
    expect(toE164("961", "abc")).toBeNull();
    expect(toE164("961", "+0123456789")).toBeNull();
    expect(toE164("961", "1234567890123456")).toBeNull();
  });
  it("masks a number for display", () => {
    expect(maskPhone("+96176555001")).toBe("+961 ••• 001");
  });
});

describe("legal pages", () => {
  const slugs = (l: { docs: { slug: string }[] }) => l.docs.map((d) => d.slug);
  it("every language has the same documents, in the same order, including the merchant ones", () => {
    expect(slugs(legalAr)).toEqual(slugs(legalEn));
    expect(slugs(legalFr)).toEqual(slugs(legalEn));
    expect(slugs(legalEn)).toEqual(
      expect.arrayContaining(["merchant-terms", "collection-mandate"]),
    );
  });
  it("each document has the same number of sections in every language", () => {
    for (const d of legalEn.docs) {
      const n = d.sections.length;
      expect(legalAr.docs.find((x) => x.slug === d.slug)?.sections.length).toBe(n);
      expect(legalFr.docs.find((x) => x.slug === d.slug)?.sections.length).toBe(n);
    }
  });
  it("the collection mandate says it has no effect while every order is cash on delivery", () => {
    const m = legalEn.docs.find((d) => d.slug === "collection-mandate")!;
    expect(m.intro).toMatch(/cash on delivery/i);
    expect(m.intro).toMatch(/no effect/i);
  });
});
