import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { promoAttempts } from "./broadcast.ts";

// (The promotional-wording check for utility templates is a tripwire for the obvious cases, not a guarantee: Meta decides the final category.)
// docs/legacy/whatsapp-templates.md is the source of truth for every template. These tests check each payload in it against Meta's categorization rules
// (developers.facebook.com .../templates/template-categorization, as mirrored in the Kapso WhatsApp docs) so a template that Meta would re-categorize
// (and bill as marketing) or reject cannot be added quietly.
const DOC = readFileSync(resolve(__dirname, "../../../docs/legacy/whatsapp-templates.md"), "utf8");
const payloads: any[] = [...DOC.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1])).filter((j) => j && j.name && j.category);
const of = (cat: string) => payloads.filter((p) => p.category === cat);
const body = (p: any) => p.components.find((c: any) => c.type === "BODY");
const vars = (t: string) => [...t.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
const EMOJI = /\p{Extended_Pictographic}/u, URL = /https?:\/\/|www\./i;

describe("the payloads in the doc", () => {
  it("there is at least one of each category and every payload has a unique name+language", () => {
    expect(of("AUTHENTICATION").length).toBeGreaterThan(0); expect(of("MARKETING").length).toBeGreaterThanOrEqual(2); expect(of("UTILITY").length).toBeGreaterThan(0);
    const keys = payloads.map((p) => `${p.name}/${p.language}`); expect(new Set(keys).size).toBe(keys.length);
  });
  it.each(of("AUTHENTICATION").map((p) => [p.name + "/" + p.language, p]))("AUTHENTICATION %s: library format, an OTP button, no free text, no URL / media / emoji", (_n, p: any) => {
    expect(body(p).text).toBeUndefined(); expect(body(p).add_security_recommendation).toBe(true); // Meta writes the body; only the security recommendation is optional
    const btns = p.components.find((c: any) => c.type === "BUTTONS").buttons; expect(btns).toHaveLength(1); expect(btns[0].type).toBe("OTP");
    expect(["COPY_CODE", "ONE_TAP"]).toContain(btns[0].otp_type);
    const s = JSON.stringify(p); expect(s).not.toMatch(URL); expect(EMOJI.test(s)).toBe(false);
    expect(p.components.some((c: any) => c.type === "HEADER")).toBe(false); // no media
  });
  it.each(of("MARKETING").map((p) => [p.name + "/" + p.language, p]))("MARKETING %s: one variable inside fixed text, an example, an opt-out", (_n, p: any) => {
    const t = body(p).text as string;
    expect(vars(t)).toEqual([1]);
    expect(t.trim().startsWith("{{")).toBe(false); expect(t.trim().endsWith("}}")).toBe(false); // never starts or ends with a variable, never only a variable
    expect(t.replace(/\{\{1\}\}/, "").trim().length).toBeGreaterThan(20);
    expect(body(p).example.body_text[0]).toHaveLength(1);
    const q = p.components.find((c: any) => c.type === "BUTTONS")?.buttons ?? [];
    expect(q.some((b: any) => b.type === "QUICK_REPLY")).toBe(true); // the opt-out
    expect(t).toMatch(/STOP/); // and the typed keyword
  });
  it.each(of("UTILITY").map((p) => [p.name + "/" + p.language, p]))("UTILITY %s: about the user's order, nothing promotional, every variable exemplified", (_n, p: any) => {
    const t = body(p).text as string;
    expect(t).toMatch(/\border\b|طلب/i); // specific to the user's order
    expect(t).not.toMatch(/\b(off|discount|offer|offers|sale|deal|coupon|promo|free|win|save|reorder|try|new|limited)\b|%|خصم|عرض|عروض|تخفيض|مجاني|جديد/i); // promotional or upsell wording would make Meta bill it as marketing
    expect(t).not.toMatch(URL);
    const n = vars(t).length; expect(n).toBeGreaterThan(0); expect(body(p).example.body_text[0]).toHaveLength(n);
    expect(t.trim().startsWith("{{")).toBe(false); expect(t.trim().endsWith("}}")).toBe(false);
    expect(JSON.stringify(p.components.filter((c: any) => c.type === "BUTTONS"))).not.toMatch(/URL|PHONE|COPY/); // no marketing-style call to action
  });
});

describe("the code sends what the doc describes", () => {
  it("the live promo template names are the ones in the doc and the broadcast payload fits the marketing template (one body variable, one quick-reply payload, no line breaks in the variable)", () => {
    for (const n of ["alo_offer_ar", "alo_offer_en_optout"]) expect(DOC).toContain(n);
    const a = promoAttempts({ to: "96170000001", lang: "en", message: "10%  off\nburgers\ttoday", vendorName: "V", inWindow: false, templates: { ar: { name: "alo_offer_ar", language: "ar" }, en: { name: "alo_offer_en_optout", language: "en_US" } } });
    expect(a).toHaveLength(1); const t = (a[0] as any).template;
    const bodyParams = t.components.find((c: any) => c.type === "body").parameters; expect(bodyParams).toHaveLength(1);
    expect(bodyParams[0].text).not.toMatch(/[\n\t]|\s{2,}/); // Meta rejects line breaks, tabs and 4+ spaces inside a template variable
    expect(t.components.find((c: any) => c.type === "button").sub_type).toBe("quick_reply");
  });
  it("a very long offer is clipped to 900 characters inside the variable", () => {
    const a = promoAttempts({ to: "1", lang: "ar", message: "x".repeat(2000), vendorName: "V", inWindow: false, templates: { ar: { name: "a", language: "ar" }, en: { name: "b", language: "en_US" } } });
    expect((a[0] as any).template.components[0].parameters[0].text.length).toBeLessThanOrEqual(900);
  });
  it("an in-window promo is plain text with the sender and the opt-out line (never a bare offer)", () => {
    const a = promoAttempts({ to: "1", lang: "en", message: "Offer", vendorName: "Al Tahouneh", inWindow: true, templates: { ar: { name: "a", language: "ar" }, en: { name: "b", language: "en_US" } } });
    expect(a).toHaveLength(2); expect((a[0] as any).type).toBe("text"); expect((a[0] as any).text.body).toMatch(/Al Tahouneh/); expect((a[0] as any).text.body).toMatch(/STOP/i);
  });
  it("the OTP payload sent by claim-vendor matches the authentication template (code in the body variable and in the copy-code button, six digits)", async () => {
    const { buildOtpPayload } = await import("../claim-vendor/otp.ts");
    const p: any = buildOtpPayload("96170000001", "alo_verify_code", "en_US", "123456");
    expect(p.template.components.map((c: any) => c.type)).toEqual(["body", "button"]);
    expect(p.template.components[1].sub_type).toBe("url"); // Meta's required shape for OTP buttons
    const src = readFileSync(resolve(__dirname, "../claim-vendor/index.ts"), "utf8");
    expect(src).toMatch(/% 1_000_000\)\.padStart\(6, "0"\)/); // the real generator makes six-digit codes, far under the 15-character limit for authentication parameters
  });
});
