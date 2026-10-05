import { describe, expect, it } from "vitest";
import { isNotifiable, lifecycleText, parseLifecycleTap, pickSubstitute, ratingRows, ratingTapId, swapLine, windowOpen } from "./lifecycle";

describe("isNotifiable", () => {
  it.each(["accepted", "preparing", "out_for_delivery", "delivered", "cancelled", "rejected"])("%s notifies", (s) => expect(isNotifiable(s)).toBe(true));
  it.each(["pending", "ready", "", "weird"])("%s does not", (s) => expect(isNotifiable(s)).toBe(false));
});

describe("lifecycleText", () => {
  const o = { code: "AB12", vendor: "Al Tahouneh", prepMin: 25, trackUrl: "https://t.example/x" };
  it("English, one rich message per status, no prices", () => {
    expect(lifecycleText("accepted", "en", o)).toContain("#AB12");
    expect(lifecycleText("accepted", "en", o)).toContain("Al Tahouneh");
    expect(lifecycleText("accepted", "en", o)).toContain("25");
    expect(lifecycleText("preparing", "en", o)).toMatch(/prepar/i);
    expect(lifecycleText("out_for_delivery", "en", o)).toContain("https://t.example/x");
    expect(lifecycleText("delivered", "en", o)).toMatch(/deliver/i);
    for (const s of ["accepted", "preparing", "out_for_delivery", "delivered", "cancelled", "rejected"]) expect(lifecycleText(s, "en", o)).not.toMatch(/\$\d/);
  });
  it("Arabic", () => {
    for (const s of ["accepted", "preparing", "out_for_delivery", "delivered", "cancelled", "rejected"]) expect(lifecycleText(s, "ar", o)).toMatch(/[؀-ۿ]/);
  });
  it("omits the track link when there is none and never emits undefined", () => {
    const t = lifecycleText("out_for_delivery", "en", { code: "X", vendor: "V" });
    expect(t).not.toMatch(/undefined|null/);
    expect(t).not.toContain("http");
  });
});

describe("rating", () => {
  it("five rows, ids carry order and stars, titles within WhatsApp limits", () => {
    const rows = ratingRows("ord-1", "en");
    expect(rows).toHaveLength(5);
    expect(rows[0].id).toBe(ratingTapId("ord-1", 5));
    expect(rows.every((r) => r.title.length <= 24 && (r.description ?? "").length <= 72)).toBe(true);
  });
});

describe("parseLifecycleTap", () => {
  it.each([
    ["CANCEL|o1", { kind: "CANCEL", orderId: "o1" }],
    ["KEEP|o1", { kind: "KEEP", orderId: "o1" }],
    ["RATE|o1|4", { kind: "RATE", orderId: "o1", stars: 4 }],
    ["SUB|f1|ok", { kind: "SUB", offerId: "f1", answer: "ok" }],
    ["SUB|f1|cancel", { kind: "SUB", offerId: "f1", answer: "cancel" }],
  ])("%s", (id, want) => expect(parseLifecycleTap(id)).toEqual(want));
  it.each(["RATE|o1|0", "RATE|o1|6", "RATE|o1|x", "SUB|f1|maybe", "CANCEL|", "CANCEL|a|b", "CONFIRM|x"])("rejects %s", (id) => expect(parseLifecycleTap(id)).toBeNull());
});

describe("windowOpen (free-form messages only inside WhatsApp's 24h customer window)", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  it("open within 24h, closed after, closed with no inbound", () => {
    expect(windowOpen("2026-10-05T01:00:00Z", now)).toBe(true);
    expect(windowOpen("2026-10-04T11:59:00Z", now)).toBe(false);
    expect(windowOpen(null, now)).toBe(false);
    expect(windowOpen("garbage", now)).toBe(false);
  });
});

const m = (id: string, price: number, extra: any = {}) => ({ item_id: id, item_name_en: id, item_name_ar: null, price_usd: price, section: "Mezza", is_popular: false, available: true, ...extra });
describe("pickSubstitute", () => {
  const missing = { item_id: "hummus", section: "Mezza", price_usd: 4 };
  it("same section, available, priced, not already ordered, at most 25% dearer; closest price wins", () => {
    const cands = [m("hummus", 4), m("moutabal", 4.5), m("fattoush", 3.9), m("steak", 4, { section: "Grill" }), m("tabbouleh", 6), m("off", 4, { available: false })];
    expect(pickSubstitute(missing, cands, ["hummus"])?.item_id).toBe("fattoush");
    expect(pickSubstitute(missing, cands, ["hummus", "fattoush"])?.item_id).toBe("moutabal");
  });
  it("null when nothing qualifies", () => expect(pickSubstitute(missing, [m("tabbouleh", 9)], [])).toBeNull());
  it("popular breaks a price tie", () => expect(pickSubstitute(missing, [m("a", 4), m("b", 4, { is_popular: true })], [])?.item_id).toBe("b"));
  it("section match ignores case and spacing", () => expect(pickSubstitute({ ...missing, section: "HOT  mezza" }, [m("x", 4, { section: "Hot Mezza" })], [])?.item_id).toBe("x"));
});

describe("swapLine (server-side money; the customer's quantity is kept, the price comes from the database)", () => {
  const lines = [
    { item_id: "hummus", name_en: "Hummus", name_ar: null, unit_price_usd: 4, quantity: 2, choices: [] },
    { item_id: "coke", name_en: "Coke", name_ar: null, unit_price_usd: 1.5, quantity: 1, choices: [] },
  ];
  it("re-prices from the substitute and recomputes subtotal and total with the delivery fee", () => {
    const r = swapLine(lines, "hummus", { item_id: "fattoush", item_name_en: "Fattoush", item_name_ar: "فتوش", price_usd: 3.5 }, 2, 150);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines[0]).toMatchObject({ item_id: "fattoush", quantity: 2, unit_price_usd: 3.5, name_en: "Fattoush" });
      expect(r.subtotal).toBe(8.5);
      expect(r.total).toBe(10.5);
      expect(r.delta).toBe(-1);
    }
  });
  it("refuses lines with options, unknown items and totals over the COD cap", () => {
    expect(swapLine([{ ...lines[0], choices: [{ group: "Size", option: "L" }] }], "hummus", { item_id: "f", item_name_en: "F", item_name_ar: null, price_usd: 1 }, 2, 150).ok).toBe(false);
    expect(swapLine(lines, "nope", { item_id: "f", item_name_en: "F", item_name_ar: null, price_usd: 1 }, 2, 150).ok).toBe(false);
    expect(swapLine(lines, "hummus", { item_id: "f", item_name_en: "F", item_name_ar: null, price_usd: 500 }, 2, 150).ok).toBe(false);
    expect(swapLine(lines, "hummus", { item_id: "f", item_name_en: "F", item_name_ar: null, price_usd: 0 }, 2, 150).ok).toBe(false);
  });
  it("rounds to cents", () => {
    const r = swapLine([{ item_id: "a", name_en: "A", name_ar: null, unit_price_usd: 1, quantity: 3, choices: [] }], "a", { item_id: "b", item_name_en: "B", item_name_ar: null, price_usd: 1.115 }, 2, 150);
    expect(r.ok && r.subtotal).toBe(3.35);
  });
});
