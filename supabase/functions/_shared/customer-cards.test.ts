import { describe, expect, it } from "vitest";
import { afterSunset, customerStatusMessages, moneyLine, parseCustomerAction } from "./customer-cards";

const U = "11111111-2222-3333-4444-555555555555";
const card = { order_id: U, code: "AB3CD9", vendor_name: "Shop", total_usd: 12.5, total_lbp: 1118750, usd_lbp_rate: 89500 };

describe("customer cards", () => {
  it("money shows both totals and the rate, locked or today's (§13)", () => {
    expect(moneyLine(12.5, 1118750, 89500, "en")).toBe("$12.50 = 1,118,750 LBP (rate 89,500, locked at order)");
    expect(moneyLine(12.5, 1118750, 89500, "en", false)).toContain("today's rate");
  });
  it("accepted carries the ETA range, the totals and the delivery code", () => {
    const [m]: any = customerStatusMessages("+96170000001", { kind: "accepted", lang: "en", eta: { min: 20, max: 30 } }, card, { deliveryCode: "4821" });
    expect(m.text.body).toContain("20-30 min");
    expect(m.text.body).toContain("$12.50 = 1,118,750 LBP");
    expect(m.text.body).toContain("4821");
  });
  it("near drop offers the live-location button only when the door is unknown or after sunset (§27.3)", () => {
    const base = { kind: "near_drop", lang: "en", driver_phone: "+96171000009" };
    const [a]: any = customerStatusMessages("+1", { ...base, door_confirmed: true }, card, { afterSunset: false });
    expect(a.type).toBe("text");
    const [b]: any = customerStatusMessages("+1", { ...base, door_confirmed: false }, card, { afterSunset: false });
    expect(b.interactive.type).toBe("cta_url");
    expect(b.interactive.action.parameters.url).toMatch(/^https:\/\/wa\.me\/96171000009\?text=/);
    const [c]: any = customerStatusMessages("+1", { ...base, door_confirmed: true }, card, { afterSunset: true });
    expect(c.interactive.type).toBe("cta_url");
  });
  it("a driver number that is not E.164 is never linked", () => {
    const [m]: any = customerStatusMessages("+1", { kind: "on_the_way", lang: "en", driver_phone: "javascript:alert(1)" }, card);
    expect(m.type).toBe("text");
  });
  it("unknown kinds send nothing", () => {
    expect(customerStatusMessages("+1", { kind: "drop_table" }, card)).toEqual([]);
  });
  it("button ids round-trip and anything else is refused", () => {
    expect(parseCustomerAction(`rcv:${U}:ok`)).toEqual({ a: "received", orderId: U, ok: true });
    expect(parseCustomerAction(`rate:${U}:f4`)).toEqual({ a: "rate", orderId: U, food: 4 });
    expect(parseCustomerAction(`rate:${U}:d0`)).toEqual({ a: "rate", orderId: U, deliveryOk: false });
    expect(parseCustomerAction(`cfm:${U}:17`)).toEqual({ a: "confirm", basketId: U, version: 17 });
    expect(parseCustomerAction("c:checkout")).toEqual({ a: "simple", what: "checkout" });
    expect(parseCustomerAction(`rate:${U}:f9`)).toBeNull();
    expect(parseCustomerAction(`acc:${U}:15`)).toBeNull(); // a merchant id is not a customer action
    expect(parseCustomerAction("c:drop")).toBeNull();
  });
  it("after sunset in Beirut", () => {
    expect(afterSunset(new Date("2026-10-11T12:00:00Z"))).toBe(false);
    expect(afterSunset(new Date("2026-10-11T16:00:00Z"))).toBe(true);
    expect(afterSunset(new Date("2026-06-21T16:00:00Z"))).toBe(false);
  });
});
