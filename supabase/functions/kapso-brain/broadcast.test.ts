import { describe, expect, it } from "vitest";
import { detectLanguage, promoAttempts } from "./broadcast";

describe("detectLanguage", () => {
  it("Arabic script and Arabizi are Arabic", () => {
    expect(detectLanguage("مرحبا بدي برغر")).toBe("ar");
    expect(detectLanguage("marhaba baddi shawarma")).toBe("ar");
    expect(detectLanguage("ma3 toum please")).toBe("ar");
  });
  it("clear English is English", () => {
    expect(detectLanguage("I want 2 soft drinks")).toBe("en");
    expect(detectLanguage("What is on the menu?")).toBe("en");
  });
  it("bare greetings and French stay unknown (default Arabic)", () => {
    expect(detectLanguage("hi")).toBeNull();
    expect(detectLanguage("hello")).toBeNull();
    expect(detectLanguage("bonjour")).toBeNull();
    expect(detectLanguage("2x burger")).toBeNull();
  });
});

describe("promoAttempts", () => {
  const templates = { ar: { name: "alo_offer_ar", language: "ar" }, en: { name: "alo_offer_en_optout", language: "en_US" } };
  const base = { to: "96171000000", message: "10% off\nburgers  today", vendorName: "Al Tahouneh", templates };
  it("outside the window sends only the language template with the opt-out payload", () => {
    const a = promoAttempts({ ...base, lang: "en", inWindow: false });
    expect(a).toHaveLength(1);
    expect(a[0].type).toBe("template");
    const t = (a[0] as any).template;
    expect(t.name).toBe("alo_offer_en_optout");
    expect(t.language.code).toBe("en_US");
    expect(t.components[0].parameters[0].text).toBe("10% off burgers today");
    expect(t.components[1]).toEqual({ type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "OPTOUT" }] });
  });
  it("inside the window tries a plain message with an opt-out line first, then the template", () => {
    const a = promoAttempts({ ...base, lang: "ar", inWindow: true });
    expect(a.map((x) => x.type)).toEqual(["text", "template"]);
    expect((a[0] as any).text.body).toContain("STOP");
    expect((a[1] as any).template.name).toBe("alo_offer_ar");
  });
});
