import { describe, expect, it } from "vitest";
import { buildVendorOrderCard, customerNotice, needsEscalation, parseOrderTap } from "./orders";

const id = "8872435b-34f7-4fde-b43e-d8c5dcea2445";
describe("buildVendorOrderCard", () => {
  const card: any = buildVendorOrderCard("96170000099", { orderId: id, shortCode: "FF0B99", customerName: "Rami", village: "Baakleen", landmark: "near the mosque", lines: [{ quantity: 2, name_en: "Soft Drinks" }, { quantity: 1, name_en: "Tawouk", choices: [{ option: "Extra toum" }] }], totalText: "$7.00 · 626,500 LBP", notes: "no ice" });
  it("has Accept and Reject buttons carrying the order id (titles <= 20)", () => {
    const b = card.interactive.action.buttons.map((x: any) => x.reply);
    expect(b).toEqual([{ id: `ORDER|ACC|${id}`, title: "✅ Accept" }, { id: `ORDER|REJ|${id}`, title: "❌ Reject" }]);
  });
  it("shows items, dual-currency total and address", () => {
    const t = card.interactive.body.text;
    expect(t).toContain("2 × Soft Drinks");
    expect(t).toContain("(Extra toum)");
    expect(t).toContain("$7.00 · 626,500 LBP");
    expect(t).toContain("Baakleen — near the mosque");
    expect(t.length).toBeLessThanOrEqual(1024);
  });
});
describe("parseOrderTap", () => {
  it("parses accept/reject and rejects junk", () => {
    expect(parseOrderTap(`ORDER|ACC|${id}`)).toEqual({ accept: true, orderId: id });
    expect(parseOrderTap(`ORDER|REJ|${id}`)).toEqual({ accept: false, orderId: id });
    for (const s of ["ORDER|ACC|x", "CONFIRM|" + id, "ORDER|MAYBE|" + id, ""]) expect(parseOrderTap(s)).toBeNull();
  });
});
describe("needsEscalation", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const base = { status: "pending", created_at: "2026-10-05T11:58:00Z", escalated_at: null, customer_phone: "96171123456" };
  it("escalates a pending order older than 90 s", () => expect(needsEscalation(base, now)).toBe(true));
  it("not before 90 s", () => expect(needsEscalation({ ...base, created_at: "2026-10-05T11:58:45Z" }, now)).toBe(false));
  it("not twice, not once handled, not stale, not the web demo", () => {
    expect(needsEscalation({ ...base, escalated_at: "2026-10-05T11:59:40Z" }, now)).toBe(false);
    expect(needsEscalation({ ...base, status: "accepted" }, now)).toBe(false);
    expect(needsEscalation({ ...base, created_at: "2026-10-05T10:00:00Z" }, now)).toBe(false);
    expect(needsEscalation({ ...base, customer_phone: "demo-web" }, now)).toBe(false);
  });
});
describe("customerNotice", () => {
  it("localises", () => {
    expect(customerNotice.stillConfirming("en", "AB12CD", "Al Tahouneh")).toContain("still being confirmed");
    expect(customerNotice.stillConfirming("ar", "AB12CD", "Al Tahouneh")).toContain("لسا");
    expect(customerNotice.accepted("en", "AB12CD", "V", 25)).toContain("About 25 min");
  });
});
