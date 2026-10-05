import { describe, expect, it } from "vitest";
import { buildReorderCard, isGreeting, isReorderRequest, parseQrText, parseReferral, parseReorderTap } from "./customer";

describe("parseReferral (click-to-WhatsApp)", () => {
  it("extracts the ad source and click id", () => {
    const a = parseReferral({ referral: { source_type: "ad", source_id: "238519284710201", source_url: "https://fb.me/x", headline: "Grills in Baakline", ctwa_clid: "ARBn8_xY" } })!;
    expect(a.source).toBe("ctwa");
    expect(a.ref).toMatchObject({ source_id: "238519284710201", ctwa_clid: "ARBn8_xY", headline: "Grills in Baakline" });
  });
  it("ignores messages without a referral", () => {
    expect(parseReferral({ text: { body: "hi" } })).toBeNull();
    expect(parseReferral({ referral: {} })).toBeNull();
  });
});
describe("parseQrText", () => {
  it("parses table, express and reorder codes", () => {
    expect(parseQrText("ORDER_BAAK_SANAWBAR_T12")).toEqual({ source: "qr", ref: { code: "ORDER_BAAK_SANAWBAR_T12", kind: "ORDER", village: "BAAK", merchant: "SANAWBAR", location: "T12" } });
    expect(parseQrText("express_baak_sanawbar_pickup")!.ref).toMatchObject({ kind: "EXPRESS", location: "PICKUP" });
    expect(parseQrText("REORDER_BAAK_SANAWBAR")!.ref).toMatchObject({ kind: "REORDER", location: null });
  });
  it("does not match normal messages", () => {
    for (const s of ["I want an order", "ORDER_X", "ORDER a pizza please", ""]) expect(parseQrText(s)).toBeNull();
  });
});
describe("greeting / reorder detection", () => {
  it("greetings", () => {
    for (const s of ["hi", "Hello!", "مرحبا", "marhaba", "السلام عليكم", "good morning"]) expect(isGreeting(s)).toBe(true);
    for (const s of ["hi I want a burger", "مرحبا بدي برغر", ""]) expect(isGreeting(s)).toBe(false);
  });
  it("reorder requests", () => {
    for (const s of ["reorder", "same again", "نفس الطلب", "repeat my last order"]) expect(isReorderRequest(s)).toBe(true);
    for (const s of ["I want the same burger but bigger", "order pizza"]) expect(isReorderRequest(s)).toBe(false);
  });
});
describe("buildReorderCard", () => {
  const id = "8872435b-34f7-4fde-b43e-d8c5dcea2445";
  it("has Reorder and Menu buttons within 20 chars, in the customer's language", () => {
    for (const lang of ["en", "ar"] as const) {
      const c: any = buildReorderCard("961", lang, { orderId: id, vendorId: "v1", vendorName: "Al Tahouneh", lines: [{ quantity: 2, name_en: "Soft Drinks" }] });
      const b = c.interactive.action.buttons.map((x: any) => x.reply);
      expect(b[0].id).toBe(`REORDER|${id}`);
      expect(b[1].id).toBe("MENU|v1");
      for (const x of b) expect(x.title.length).toBeLessThanOrEqual(20);
      expect(c.interactive.body.text).toContain("2 × Soft Drinks");
    }
  });
  it("parseReorderTap validates ids", () => {
    expect(parseReorderTap(`REORDER|${id}`)).toBe(id);
    expect(parseReorderTap("REORDER|nope")).toBeNull();
    expect(parseReorderTap(`CONFIRM|${id}`)).toBeNull();
  });
});
