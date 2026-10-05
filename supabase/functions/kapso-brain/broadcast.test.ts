import { describe, expect, it } from "vitest";
import { detectLanguage, isOptOutTitle, promoAttempts, replyFrom } from "./broadcast";

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
    expect(detectLanguage("3pm")).toBeNull();
    expect(detectLanguage("5pcs")).toBeNull();
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

describe("isOptOutTitle", () => {
  it("matches STOP words and the template quick-reply titles", () => {
    for (const s of ["STOP", "stop", "Stop offers", "إيقاف العروض", "ايقاف", "unsubscribe", " وقف "]) expect(isOptOutTitle(s)).toBe(true);
  });
  it("does not match ordinary messages", () => {
    for (const s of ["cancel", "cancel my order", "إلغاء", "stop the order", "وقّف الطلبات 30 دقيقة", "I want soft drinks", ""]) expect(isOptOutTitle(s)).toBe(false);
  });
});

describe("replyFrom", () => {
  it("reads interactive button and list replies", () => {
    expect(replyFrom({ interactive: { button_reply: { id: "CONFIRM|1", title: "Confirm" } } })).toEqual({ id: "CONFIRM|1", title: "Confirm" });
    expect(replyFrom({ interactive: { list_reply: { id: "ORD|v|i", title: "Item" } } })).toEqual({ id: "ORD|v|i", title: "Item" });
  });
  it("reads a template quick-reply tap", () => {
    expect(replyFrom({ type: "button", button: { payload: "OPTOUT", text: "Stop offers" } })).toEqual({ id: "OPTOUT", title: "Stop offers" });
    expect(replyFrom({ type: "button", button: { text: "إيقاف العروض" } })).toEqual({ id: "إيقاف العروض", title: "إيقاف العروض" });
  });
  it("returns null for plain text", () => {
    expect(replyFrom({ type: "text", text: { body: "hi" } })).toBeNull();
  });
});
