import { describe, expect, it } from "vitest";
import { toUnclaimedCard, toUnclaimedList, toUnclaimedVendorPage } from "./site-data";

const card = {
  slug: "falafel-vs-koushari",
  name_ar: null,
  name_en: "Falafel vs Koushari",
  name_fr: null,
  branch_label: null,
  business_type: "restaurant",
  business_type_ar: "مطعم",
  business_type_en: "Restaurant",
  business_type_fr: "Restaurant",
  cuisine_tags: ["falafel"],
  cuisines: [{ tag: "falafel", name_ar: "فلافل", name_en: "Falafel", name_fr: "Falafel" }],
  place_slug: "chf-bakaata",
  place_ar: "بقعاتا",
  place_en: "Bakaata",
  place_fr: "Boqaata",
  hours_seed: "Monday: 8 AM to 8 PM",
  menu_items: 6,
  menu_preview: [{ name_ar: null, name_en: "Falafel Sandwich", name_fr: null }],
};

describe('"Not on Alo King yet" data (DECISIONS §39.3)', () => {
  it("maps a card from site_place_unclaimed / site_cuisine_unclaimed", () => {
    expect(toUnclaimedCard(card)).toEqual(card);
  });
  it("drops a card without a usable slug or name, and fills missing lists", () => {
    expect(toUnclaimedCard({ ...card, slug: "Bad Slug" })).toBeNull();
    expect(toUnclaimedCard({ ...card, name_en: " " })).toBeNull();
    expect(toUnclaimedCard(null)).toBeNull();
    const c = toUnclaimedCard({ slug: "x", name_ar: "س" })!;
    expect(c.cuisines).toEqual([]);
    expect(c.menu_preview).toEqual([]);
    expect(c.menu_items).toBe(0);
    expect(c.hours_seed).toBeNull();
    expect(c.place_slug).toBeNull();
  });
  it("never carries a price, phone or coordinates even if the database sent one", () => {
    const c = toUnclaimedCard({
      ...card,
      phone: "+96171123456",
      lat: 33.6,
      menu_preview: [{ name_en: "Falafel", price: 3 }],
    })!;
    const s = JSON.stringify(c);
    expect(s).not.toMatch(/phone|\+961|lat|price/);
  });
  it("a list page: total, page and size, and an empty list when the call failed", () => {
    expect(
      toUnclaimedList({ total: 278, page: 2, page_size: 24, vendors: [card, { slug: "" }] }),
    ).toEqual({
      total: 278,
      page: 2,
      page_size: 24,
      vendors: [card],
    });
    expect(toUnclaimedList(null)).toEqual({ total: 0, page: 1, page_size: 24, vendors: [] });
  });
  it("a vendor page keeps item names and descriptions only, and needs the vendor id for the claim link", () => {
    const p = toUnclaimedVendorPage({
      vendor: { ...card, vendor_id: "00fee5cc-ab52-4263-9277-9c6133345cad" },
      sections: [
        {
          name_en: "Sandwiches",
          items: [
            { name_en: "Falafel Sandwich", description: "With tahini", price: 3, currency: "USD" },
            { name_en: "" },
          ],
        },
        { name_en: "Empty", items: [] },
      ],
    })!;
    expect(p.vendor.vendor_id).toBe("00fee5cc-ab52-4263-9277-9c6133345cad");
    expect(p.sections).toEqual([
      {
        name_ar: null,
        name_en: "Sandwiches",
        name_fr: null,
        items: [
          { name_ar: null, name_en: "Falafel Sandwich", name_fr: null, description: "With tahini" },
        ],
      },
    ]);
    expect(toUnclaimedVendorPage({ vendor: card, sections: [] })).toBeNull();
  });
});
