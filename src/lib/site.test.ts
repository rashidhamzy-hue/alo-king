import { describe, expect, it } from "vitest";
import {
  buildHead,
  fmt,
  localePath,
  pickLang,
  pickName,
  splitLangPath,
  swapLang,
  waLink,
} from "./site";

describe("language in the URL", () => {
  it("picks the first supported browser language by weight, and Arabic when none is supported", () => {
    expect(pickLang("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(pickLang("en-US,en;q=0.9,ar;q=0.8")).toBe("en");
    expect(pickLang("de-DE,de;q=0.9")).toBe("ar");
    expect(pickLang("")).toBe("ar");
    expect(pickLang(null)).toBe("ar");
    expect(pickLang("en;q=0.1, fr;q=0.9")).toBe("fr");
    expect(pickLang("en;q=0, ar;q=0.5")).toBe("ar");
  });
  it("builds and swaps localized paths", () => {
    expect(localePath("fr")).toBe("/fr");
    expect(localePath("en", "/places/chf-baakline")).toBe("/en/places/chf-baakline");
    expect(splitLangPath("/ar/m/x")).toEqual({ lang: "ar", path: "/m/x" });
    expect(splitLangPath("/ar")).toEqual({ lang: "ar", path: "/" });
    expect(splitLangPath("/merchant")).toEqual({ lang: null, path: "/merchant" });
    expect(swapLang("/en/legal/privacy", "fr")).toBe("/fr/legal/privacy");
    expect(swapLang("/ar", "en")).toBe("/en");
  });
  it("fills placeholders and picks names with fallbacks", () => {
    expect(fmt("{n} shops in {place}", { n: 3, place: "Baakline" })).toBe("3 shops in Baakline");
    expect(fmt("a {gone} b", {})).toBe("a  b");
    expect(pickName({ name_ar: "بعقلين", name_en: null, name_fr: null }, "name", "fr")).toBe(
      "بعقلين",
    );
    expect(
      pickName({ name_ar: null, name_en: "Baakline", name_fr: "Baakline" }, "name", "ar"),
    ).toBe("Baakline");
  });
});

import { shopRef, withShop } from "./site";
describe("a shop's key in its WhatsApp text (CUSTOMER-EXPERIENCE §3.1 #2)", () => {
  it("follows the shop's name, and a slug that is not one adds nothing", () => {
    expect(withShop("Eatout", "eatout-baakline")).toBe("Eatout (shop:eatout-baakline)");
    expect(shopRef("Bad Slug")).toBe("");
    expect(withShop("Eatout", null)).toBe("Eatout");
    expect(
      fmt("Hi Alo King, I'd like to order from {vendor}", { vendor: withShop("Eatout", "eatout") }),
    ).toBe("Hi Alo King, I'd like to order from Eatout (shop:eatout)");
  });
});

describe("WhatsApp link", () => {
  it("is null without a number, never a dead link", () => {
    expect(waLink("hello", "")).toBeNull();
  });
  it("pre-fills the text", () => {
    expect(waLink("Hi Alo King, 2× falafel", "+961 70 000 000")).toBe(
      "https://wa.me/96170000000?text=Hi%20Alo%20King%2C%202%C3%97%20falafel",
    );
  });
});

describe("page head", () => {
  const base = { lang: "fr" as const, path: "/places/chf-baakline", title: "T", description: "D" };
  it("has canonical, three hreflang links and x-default (Arabic)", () => {
    const h = buildHead({ ...base, info: { origin: "https://aloking.com", indexing: true } });
    expect(h.links).toContainEqual({
      rel: "canonical",
      href: "https://aloking.com/fr/places/chf-baakline",
    });
    expect(h.links.filter((l) => l.rel === "alternate").map((l) => l.hrefLang)).toEqual([
      "ar",
      "en",
      "fr",
      "x-default",
    ]);
    expect(h.links.find((l) => l.hrefLang === "x-default")?.href).toBe(
      "https://aloking.com/ar/places/chf-baakline",
    );
    expect(h.meta).toContainEqual({
      name: "robots",
      content: "index,follow,max-image-preview:large",
    });
  });
  it("is noindex when the site is not indexing, or the page is thin", () => {
    expect(
      buildHead({ ...base, info: { origin: "https://x", indexing: false } }).meta,
    ).toContainEqual({ name: "robots", content: "noindex,nofollow" });
    expect(
      buildHead({ ...base, noindex: true, info: { origin: "https://x", indexing: true } }).meta,
    ).toContainEqual({ name: "robots", content: "noindex,nofollow" });
  });
  it("escapes < in structured data so it cannot close the script tag", () => {
    const h = buildHead({
      ...base,
      info: { origin: "https://x", indexing: true },
      jsonLd: [{ name: "</script><b>" }],
    });
    expect(h.scripts[0]?.children).not.toContain("</script>");
  });
});

import { isPrivatePath } from "./site";
describe("private paths", () => {
  it("separates the staff apps from every public page, including the 404", () => {
    for (const p of [
      "/merchant",
      "/merchant/orders",
      "/driver",
      "/admin",
      "/claim/abou-ali",
      "/for-business",
    ])
      expect(isPrivatePath(p)).toBe(true);
    for (const p of [
      "/",
      "/en",
      "/ar/m/x",
      "/fr/track/abc",
      "/this-page-does-not-exist",
      "/merchants-are-great",
      "/administrator",
    ])
      expect(isPrivatePath(p)).toBe(false);
  });
});
