// Session 5f part 8b (CUSTOMER-EXPERIENCE §3.7 #41): the message for an order a shop rejected or did not answer, with the
// closest shops that have the same dish, and the new tap ids.
import { describe, expect, it } from "vitest";
import { customerStatusMessages, parseCustomerAction } from "./customer-cards";

const U = "11111111-2222-3333-4444-555555555555";
const card = {
  order_id: U,
  code: "AB3CD9",
  vendor_name: "Shop",
  total_usd: 12.5,
  total_lbp: 1118750,
  usd_lbp_rate: 89500,
};

describe("a shop that can't take the order (session 5f part 8b, spec §3.7 #41)", () => {
  const SHOP = "8b000000-0000-0000-0000-0000000000b1";
  const SHOP2 = "8b000000-0000-0000-0000-0000000000c1";
  const alts = [
    { ref: "v1", vendor_id: SHOP, name_ar: "سفن", name_en: "SEVEN", same_dish: true, matched: 2 },
    {
      ref: "v2",
      vendor_id: SHOP2,
      name_en: "Corner Shawarma House of the Shouf",
      same_dish: true,
      matched: 1,
    },
  ];
  it("rejected: sorry, the reason in plain words, and one tap per shop with the same dish that rebuilds the basket", () => {
    const [m]: any = customerStatusMessages(
      "+96170000001",
      { kind: "rejected", lang: "en", reason: "busy", alternatives: alts },
      card,
    );
    expect(m.interactive.body.text).toBe(
      "😔 Sorry! Shop can't take order #AB3CD9 (busy). Nothing was charged.\nSame dish at these shops near you. Tap one to rebuild your basket there:",
    );
    expect(m.interactive.action.buttons.map((b: any) => b.reply.id)).toEqual([
      `rb:${U}:${SHOP}`,
      `rb:${U}:${SHOP2}`,
    ]);
    expect(m.interactive.action.buttons[1].reply.title).toBe("Corner Shawarma Hou…");
    for (const b of m.interactive.action.buttons)
      expect(parseCustomerAction(b.reply.id)).toMatchObject({ a: "rebuild", orderId: U });
  });
  it("the shop did not answer: the cancellation, in each language, with the same buttons", () => {
    for (const lang of ["ar", "en", "fr", "arabizi"]) {
      const [m]: any = customerStatusMessages(
        "+96170000001",
        { kind: "cancelled", lang, reason: "merchant_unreachable", alternatives: alts },
        card,
      );
      expect(m.interactive.action.buttons).toHaveLength(2);
      expect(m.interactive.body.text).toMatch(/AB3CD9/);
    }
    const [en]: any = customerStatusMessages(
      "+96170000001",
      { kind: "cancelled", lang: "en", reason: "merchant_unreachable", alternatives: alts },
      card,
    );
    expect(en.interactive.body.text).toMatch(
      /^😔 Sorry! Order #AB3CD9 from Shop was cancelled \(the shop didn't answer\)\. Nothing was charged\./,
    );
  });
  it("without a shop with the same dish, the open shops as before; a row that is not one is never a button", () => {
    const [m]: any = customerStatusMessages(
      "+1",
      { kind: "rejected", lang: "en", reason: "busy", alternatives: [{ ref: "v1", name_en: "A" }] },
      card,
    );
    expect(m.interactive.action.buttons.map((b: any) => b.reply.id)).toEqual(["pv:v1"]);
    const [n]: any = customerStatusMessages(
      "+1",
      {
        kind: "rejected",
        lang: "en",
        reason: "busy",
        alternatives: [{ same_dish: true, vendor_id: "x';drop" }],
      },
      card,
    );
    expect(n.interactive.action.buttons.map((b: any) => b.reply.id)).toEqual(["c:find"]);
  });
  it("the new tap ids round-trip; anything else is refused", () => {
    expect(parseCustomerAction(`rb:${U}:${SHOP}`)).toEqual({
      a: "rebuild",
      orderId: U,
      vendorId: SHOP,
    });
    expect(parseCustomerAction(`gap:${SHOP}`)).toEqual({ a: "gap_item", itemId: SHOP });
    expect(parseCustomerAction("dps:skip")).toEqual({ a: "photo_skip" });
    expect(parseCustomerAction(`rb:${U}`)).toBeNull();
    expect(parseCustomerAction("gap:x")).toBeNull();
    expect(parseCustomerAction("dps:no")).toBeNull();
  });
});
