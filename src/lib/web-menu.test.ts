import { describe, expect, it } from "vitest";
import {
  addLine,
  cartTotals,
  isWebToken,
  lineKey,
  linesFromBasket,
  setQuantity,
  sitePhotoUrl,
  toggleOption,
  unitPrice,
  unmetGroups,
  type WebItem,
  type WebMenu,
} from "./web-menu";

const size = {
  id: "g-size",
  name_ar: "الحجم",
  name_en: "Size",
  name_fr: null,
  min: 1,
  max: 1,
  options: [
    { id: "o-reg", name_ar: null, name_en: "Regular", name_fr: null, price_usd: 0 },
    { id: "o-lg", name_ar: null, name_en: "Large", name_fr: null, price_usd: 1.5 },
  ],
};
const extras = {
  id: "g-ext",
  name_ar: null,
  name_en: "Extras",
  name_fr: null,
  min: 0,
  max: 2,
  options: [
    { id: "o-ch", name_ar: null, name_en: "Cheese", name_fr: null, price_usd: 0.75 },
    { id: "o-fr", name_ar: null, name_en: "Fries", name_fr: null, price_usd: 1 },
    { id: "o-pk", name_ar: null, name_en: "Pickles", name_fr: null, price_usd: 0.25 },
  ],
};
const item = (o: Partial<WebItem> = {}): WebItem => ({
  id: "i-1",
  name_ar: "شاورما",
  name_en: "Chicken Shawarma",
  name_fr: null,
  description: null,
  price_usd: 4.5,
  per_kg: false,
  est_weight_kg: null,
  vegetarian: false,
  vegan: false,
  spicy: 0,
  photo: true,
  photo_source: "merchant",
  allergens: null,
  nutrition: null,
  goes_well: null,
  groups: [size, extras],
  ...o,
});

describe("web menu tokens and links", () => {
  it("takes only the server's 24-character URL-safe tokens", () => {
    expect(isWebToken("Ab3_-".repeat(4) + "Ab3_")).toBe(true); // 24
    expect(isWebToken("Ab3_-".repeat(5))).toBe(false); // 25
    expect(isWebToken("Ab3_-".repeat(4) + "Ab3")).toBe(false); // 23
    expect(isWebToken("Ab3_-".repeat(4) + "Ab3=")).toBe(false);
    expect(isWebToken(undefined)).toBe(false);
  });
  it("points photos at the site's photo route, never at storage", () => {
    expect(sitePhotoUrl({ item: "i-1" })).toMatch(
      /\/functions\/v1\/dispatch\?route=site-photo&i=i-1$/,
    );
    expect(sitePhotoUrl({ shop: "v-1" })).toMatch(/route=site-photo&c=v-1$/);
  });
});

describe("the item's price and choices", () => {
  it("adds the chosen options to the item's price", () => {
    expect(unitPrice(item(), [])).toBe(4.5);
    expect(unitPrice(item(), ["o-lg", "o-ch"])).toBe(6.75);
  });
  it("prices a kilo item at its usual weight", () => {
    expect(
      unitPrice(item({ per_kg: true, est_weight_kg: 0.4, price_usd: 28, groups: [] }), []),
    ).toBe(11.2);
  });
  it("lists the groups a choice still misses, and too many add-ons", () => {
    expect(unmetGroups(item(), []).map((g) => g.id)).toEqual(["g-size"]);
    expect(unmetGroups(item(), ["o-reg"])).toEqual([]);
    expect(unmetGroups(item(), ["o-reg", "o-ch", "o-fr", "o-pk"]).map((g) => g.id)).toEqual([
      "g-ext",
    ]);
  });
  it("swaps a one-choice group and caps a many-choice group at its max", () => {
    let o = toggleOption(item(), [], size, "o-reg");
    expect(o).toEqual(["o-reg"]);
    o = toggleOption(item(), o, size, "o-lg");
    expect(o).toEqual(["o-lg"]);
    expect(toggleOption(item(), o, size, "o-lg")).toEqual(["o-lg"]); // a required size stays chosen
    o = toggleOption(item(), o, extras, "o-ch");
    o = toggleOption(item(), o, extras, "o-fr");
    expect(toggleOption(item(), o, extras, "o-pk")).toEqual(o); // max 2
    expect(toggleOption(item(), o, extras, "o-ch")).toEqual(["o-lg", "o-fr"]);
  });
});

describe("the cart", () => {
  const a = { item_id: "i-1", quantity: 1, option_ids: ["o-lg"], note: null };
  it("keeps one line per item, choices and note", () => {
    let l = addLine([], a);
    l = addLine(l, { ...a, quantity: 2 });
    expect(l).toHaveLength(1);
    expect(l[0]!.quantity).toBe(3);
    l = addLine(l, { ...a, note: "no onions" });
    l = addLine(l, { ...a, option_ids: ["o-reg"] });
    expect(l).toHaveLength(3);
    expect(lineKey({ item_id: "x", option_ids: ["b", "a"], note: " n " })).toBe(
      lineKey({ item_id: "x", option_ids: ["a", "b"], note: "n" }),
    );
  });
  it("never goes past the server's limits", () => {
    expect(addLine([{ ...a, quantity: 49 }], { ...a, quantity: 5 })[0]!.quantity).toBe(50);
    const full = Array.from({ length: 50 }, (_, k) => ({ ...a, item_id: `i-${k}` }));
    expect(addLine(full, { ...a, item_id: "new" })).toHaveLength(50);
  });
  it("removes a line at zero", () => {
    const l = addLine([], a);
    expect(setQuantity(l, lineKey(a), 0)).toEqual([]);
    expect(setQuantity(l, lineKey(a), 4)[0]!.quantity).toBe(4);
  });
  it("totals the menu prices of what is in the cart", () => {
    const m = new Map([["i-1", item()]]);
    expect(cartTotals([{ ...a, quantity: 2 }], m)).toEqual({ count: 2, subtotal: 12 });
    expect(cartTotals([{ ...a, item_id: "gone" }], m)).toEqual({ count: 0, subtotal: 0 });
  });
  it("starts from the server's basket, only with items the menu still shows", () => {
    const menu = {
      status: "ok",
      sections: [{ id: "s", name_ar: null, name_en: "S", name_fr: null, items: [item()] }],
      basket: {
        other_vendor: false,
        lines: [
          { item_id: "i-1", quantity: 2, option_ids: ["o-lg"], note: "x" },
          { item_id: "sold-out", quantity: 1, option_ids: [], note: null },
        ],
      },
    } as unknown as Extract<WebMenu, { status: "ok" }>;
    expect(linesFromBasket(menu)).toEqual([
      { item_id: "i-1", quantity: 2, option_ids: ["o-lg"], note: "x" },
    ]);
    expect(
      linesFromBasket({ ...menu, basket: { other_vendor: true, vendor_ar: null, vendor_en: "B" } }),
    ).toEqual([]);
  });
});
