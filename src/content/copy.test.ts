import { describe, expect, it } from "vitest";
import businessProfile from "../../whatsapp/business-profile.json";
import { llmsTxt } from "@/lib/seo-files";
import { EMPTY_OVERVIEW } from "@/lib/site-data";
import { ar } from "./ar";
import { en } from "./en";
import { fr } from "./fr";
import { legalAr } from "./legal.ar";
import { legalEn } from "./legal.en";
import { legalFr } from "./legal.fr";

// DECISIONS §39.15.5: what customers read on the site, in the legal pages, llms.txt and the WhatsApp profile.
const copies = { ar, en, fr };
const ARABIZI = /arabizi|عربيزي/i;

describe("customer copy (DECISIONS §39.15.5)", () => {
  it("never says Arabizi where a customer reads", () => {
    for (const c of [ar, en, fr, legalAr, legalEn, legalFr, businessProfile])
      expect(JSON.stringify(c)).not.toMatch(ARABIZI);
  });

  it("uses the decided languages line", () => {
    expect(en.home.speak.sub).toContain("Arabic, English or French, the way you text, even mixed.");
    expect(ar.home.speak.sub).toContain(
      "بالعربي، بالإنكليزي أو بالفرنسي، متل ما بتكتب عالواتساب، حتى لو خلطتهم.",
    );
    expect(fr.home.speak.sub).toContain(
      "En arabe, anglais ou français, comme vous écrivez, même mélangés.",
    );
    // The example stays, labelled "The way you text".
    for (const c of Object.values(copies))
      expect(c.home.speak.phrases.map((p) => p.text)).toContain("2 shawarma w pepsi");
  });

  it("gives the business side one name", () => {
    expect([en.nav.business, ar.nav.business, fr.nav.business]).toEqual([
      "For businesses",
      "لأصحاب المحلات",
      "Pour les commerces",
    ]);
    for (const c of Object.values(copies)) {
      expect(c.biz.nav.short).toBe(c.nav.business);
      expect(c.home.merchants.cta).toBe(c.nav.business);
      expect(c.merchantsPage.hero.eyebrow).toBe(c.nav.business);
    }
    expect(JSON.stringify(en)).not.toMatch(/For merchants/);
    expect(JSON.stringify(fr)).not.toMatch(/Pour les commerçants/);
  });

  it("has a fee headline that needs no number", () => {
    for (const c of Object.values(copies)) {
      expect(c.home.merchants.title).toContain("{fee}");
      expect(c.home.merchants.titleNoFee).not.toContain("{fee}");
      expect(c.home.merchants.titleNoFee).toContain("{pct}");
    }
  });

  it("writes no em dash in the copy added for the audit", () => {
    for (const c of Object.values(copies))
      expect(JSON.stringify([c.home.pay, c.biz.contact, c.places.map.allLead])).not.toContain("—");
  });

  it("says Whish is not available yet, never that it works", () => {
    expect(en.home.pay.whishNote).toMatch(/not available yet/);
    expect(fr.home.pay.whishNote).toMatch(/pas encore disponible/);
    expect(ar.home.pay.whishNote).toMatch(/مش متوفّر بعد/);
  });

  it("keeps llms.txt free of the word", () => {
    const txt = llmsTxt("https://example.test", EMPTY_OVERVIEW, []);
    expect(txt).not.toMatch(ARABIZI);
    expect(txt).toContain("the way people text, even mixed");
  });
});
