import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getItem,
  getVendorDemo,
  toCredits,
  toDeliveryMap,
  toItemPage,
  toUnclaimedCard,
  toUnclaimedList,
  toUnclaimedVendorPage,
} from "./site-data";

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

describe("delivery map counts (§39.11)", () => {
  it("keeps valid rows and defaults bad counts to 0", () => {
    expect(
      toDeliveryMap({
        places: [
          { slug: "chf-baakline", shops: 2, unclaimed: "41" },
          { slug: "Bad Slug", shops: 1 },
          { slug: "chf-niha", shops: -3, unclaimed: null },
          null,
        ],
        unclaimed_total: 41,
      }),
    ).toEqual({
      places: [
        { slug: "chf-baakline", shops: 2, unclaimed: 41 },
        { slug: "chf-niha", shops: 0, unclaimed: 0 },
      ],
      unclaimed_total: 41,
    });
    expect(toDeliveryMap(null)).toEqual({ places: [], unclaimed_total: 0 });
  });
});

// ---- Item pages, credits and demo shops (§39.15.7) ---------------------------------------------------------------------
const ITEM_ID = "80000000-0000-0000-0000-000000000001";
const rawItem = {
  item: {
    id: ITEM_ID,
    name_ar: "شاورما دجاج",
    name_en: "Chicken shawarma",
    name_fr: null,
    description: "  ",
    price_usd: "3.50",
    per_kg: false,
    est_weight_kg: null,
    available: true,
    vegetarian: false,
    vegan: false,
    spicy: null,
    pork: false,
    alcohol: false,
    photo: true,
    photo_source: "merchant_site",
    credit: {
      credit: "Shop website",
      license: "Used with permission",
      source_url: "javascript:alert(1)",
    },
  },
  vendor: {
    slug: "abou-ali-shawarma",
    name_ar: null,
    name_en: "Abou Ali Shawarma",
    name_fr: null,
    place_slug: "chf-baakline",
    place_ar: "بعقلين",
    place_en: "Baakline",
    place_fr: null,
    orderable: true,
    paused: false,
    open_now: true,
    demo: false,
    public_page: true,
  },
  nutrition: { kcal: 520, protein_g: 31.5, carbs_g: null, fat_g: 21.5, status: "estimated" },
  allergens: null,
  options: [
    {
      name_en: "Size",
      min: 1,
      max: 1,
      options: [
        { name_en: "Regular", price_usd: 0 },
        { name_en: "", price_usd: 9 },
      ],
    },
    { name_en: "Empty", min: 0, max: 1, options: [] },
  ],
  goes_well: { id: "not-a-uuid", name_en: "Ayran", price_usd: 1.25, per_kg: false, photo: true },
  rate: 89500,
};

describe("item page data (site_item)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects an id that is not a UUID without calling the database", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const id of ["abc", "../site_vendor", `${ITEM_ID}x`, ""])
      expect(await getItem(id)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("asks site_item for a UUID and checks the answer", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(rawItem), { status: 200 }));
    const d = await getItem(ITEM_ID.toUpperCase());
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/rest\/v1\/rpc\/site_item$/);
    expect(JSON.parse(String(init?.body))).toEqual({ p_item_id: ITEM_ID });
    expect(d?.item.price_usd).toBe(3.5);
  });
  it("keeps allergens null when the shop declared none, and drops unsafe links and empty choices", () => {
    const d = toItemPage(rawItem)!;
    expect(d.allergens).toBeNull();
    expect(d.item.description).toBeNull();
    expect(d.item.credit).toEqual({
      credit: "Shop website",
      license: "Used with permission",
      source_url: null,
    });
    expect(d.options).toHaveLength(1);
    expect(d.options[0]!.options).toEqual([
      { name_ar: null, name_en: "Regular", name_fr: null, price_usd: 0 },
    ]);
    expect(d.goes_well).toBeNull();
    expect(d.nutrition).toEqual({
      kcal: 520,
      protein_g: 31.5,
      carbs_g: null,
      fat_g: 21.5,
      status: "estimated",
    });
    expect(toItemPage({ ...rawItem, allergens: ["gluten", 3] })!.allergens).toEqual(["gluten"]);
    expect(toItemPage({ ...rawItem, item: { ...rawItem.item, id: "x" } })).toBeNull();
    expect(toItemPage(null)).toBeNull();
  });
});

describe("photo credits (site_credits)", () => {
  it("keeps rows with a shop, and an item id on item rows", () => {
    const row = {
      kind: "item",
      item_id: ITEM_ID,
      vendor_slug: "abou-ali-shawarma",
      vendor_en: "Abou Ali Shawarma",
      item_en: "Chicken shawarma",
      source: "packshot",
      credit: "Example Packshots",
      license: "CC BY 4.0",
      source_url: "https://packshots.example/x",
    };
    const c = toCredits({
      total: 3,
      page: 1,
      page_size: 100,
      photos: [row, { ...row, item_id: null }, { ...row, kind: "cover", item_id: null }],
    });
    expect(c.total).toBe(3);
    expect(c.photos.map((p) => p.kind)).toEqual(["item", "cover"]);
    expect(c.photos[0]!.source_url).toBe("https://packshots.example/x");
    expect(toCredits(null)).toEqual({ total: 0, page: 1, page_size: 100, photos: [] });
  });
});

describe("demo shop page (site_vendor_demo)", () => {
  afterEach(() => vi.restoreAllMocks());
  it("is always marked demo, and null when the shop is not a demo shop", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ vendor: { slug: "demo-x" }, hours: [], sections: [] })),
    );
    expect((await getVendorDemo("demo-x"))?.vendor.demo).toBe(true);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("null"));
    expect(await getVendorDemo("abou-ali-shawarma")).toBeNull();
  });
});
