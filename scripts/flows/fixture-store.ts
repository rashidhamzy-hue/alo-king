// A FlowAppStore over in-memory fixtures (DECISIONS §39.15.13): the Flow app's endpoint logic run without a database, for
// the Flowso scenarios in CI (supabase/functions/_shared/flows.test.ts), the screenshots (scripts/flows/screens.ts) and
// a local preview (scripts/flows/dev-endpoint.ts). It mirrors what web_explore, web_menu and the flow_app_* RPCs return
// for a customer in Baakline: two shops, sections, an item with a required size and add-ons, a basket priced here the
// way basket_view prices it (menu price plus option deltas), and a delivery fee. No real data, no network.
import type { FlowAppStore } from "../../supabase/functions/_shared/flow-app";

/** A 1×1 JPEG (base64): every fixture image, far under Meta's 100 KB. */
export const TINY_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

export const FX = {
  token: "AAAAAAAAAAAAAAAAAAAAAAAA",
  flowToken: `AAAAAAAAAAAAAAAAAAAAAAAA.${"s".repeat(43)}`,
  shop1: "10000000-0000-0000-0000-000000000001",
  shop2: "10000000-0000-0000-0000-000000000002",
  shaw: "51000000-0000-0000-0000-000000000001",
  falafel: "51000000-0000-0000-0000-000000000002",
  fries: "51000000-0000-0000-0000-000000000003",
  pepsi: "51000000-0000-0000-0000-000000000004",
  pizza: "51000000-0000-0000-0000-000000000005",
  regular: "52000000-0000-0000-0000-000000000001",
  large: "52000000-0000-0000-0000-000000000002",
  cheese: "52000000-0000-0000-0000-000000000003",
  garlic: "52000000-0000-0000-0000-000000000004",
};

const item = (
  id: string,
  en: string,
  ar: string,
  price: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  name_en: en,
  name_ar: ar,
  name_fr: null,
  description: null as string | null,
  price_usd: price,
  per_kg: false,
  est_weight_kg: null,
  photo: true,
  allergens: null as string[] | null,
  nutrition: null as Record<string, number> | null,
  goes_well: null as string | null,
  groups: [] as any[],
  ...extra,
});

function menuFor(slug: string) {
  if (slug === "alo-test-grill")
    return {
      shop: {
        vendor_id: FX.shop1,
        slug,
        name_en: "Alo Test Grill",
        name_ar: "ألو تست غريل",
        cuisine_en: "Grills",
        cuisine_ar: "مشاوي",
        village_en: "Baakline",
        village_ar: "بعقلين",
        open_now: true,
        hours_today: "11:00–23:00",
      },
      delivery: {
        status: "ok",
        fee_usd: 2,
        eta_min: 25,
        eta_max: 35,
        place_en: "Baakline",
        place_ar: "بعقلين",
      },
      sections: [
        {
          id: "s1",
          name_en: "Sandwiches",
          name_ar: "سندويشات",
          items: [
            item(FX.shaw, "Chicken Shawarma", "شاورما دجاج", 5, {
              description: "Chicken, garlic sauce, pickles and fries in Lebanese bread",
              allergens: ["gluten", "eggs"],
              nutrition: { kcal: 520, protein_g: 32 },
              goes_well: FX.fries,
              groups: [
                {
                  id: "g1",
                  name_en: "Size",
                  name_ar: "الحجم",
                  min: 1,
                  max: 1,
                  options: [
                    { id: FX.regular, name_en: "Regular", name_ar: "عادي", price_usd: 0 },
                    { id: FX.large, name_en: "Large", name_ar: "كبير", price_usd: 1.5 },
                  ],
                },
                {
                  id: "g2",
                  name_en: "Extras",
                  name_ar: "إضافات",
                  min: 0,
                  max: 2,
                  options: [
                    { id: FX.cheese, name_en: "Cheese", name_ar: "جبنة", price_usd: 0.5 },
                    { id: FX.garlic, name_en: "Extra garlic", name_ar: "توم زيادة", price_usd: 0 },
                  ],
                },
              ],
            }),
            item(FX.falafel, "Falafel Sandwich", "سندويش فلافل", 3, { photo: false }),
          ],
        },
        {
          id: "s2",
          name_en: "Sides and drinks",
          name_ar: "مقبلات ومشروبات",
          items: [
            item(FX.fries, "Fries", "بطاطا", 2),
            item(FX.pepsi, "Pepsi", "بيبسي", 1, { photo: false }),
          ],
        },
      ],
      basket: null,
      rate: 89500,
    };
  if (slug === "pizza-place")
    return {
      shop: {
        vendor_id: FX.shop2,
        slug,
        name_en: "Pizza Place",
        name_ar: "محل البيتزا",
        cuisine_en: "Pizza",
        open_now: false,
      },
      delivery: { status: "ok", fee_usd: 3, eta_min: 30, eta_max: 45 },
      sections: [
        {
          id: "p1",
          name_en: "Pizza",
          name_ar: "بيتزا",
          items: [item(FX.pizza, "Margherita", "مارغريتا", 8)],
        },
      ],
      basket: null,
      rate: 89500,
    };
  return null;
}

const cards = [
  {
    vendor_id: FX.shop1,
    slug: "alo-test-grill",
    name_en: "Alo Test Grill",
    name_ar: "ألو تست غريل",
    cuisine_en: "Grills",
    cuisine_ar: "مشاوي",
    village_en: "Baakline",
    village_ar: "بعقلين",
    open_now: true,
    fee_usd: 2,
    eta_min: 25,
    eta_max: 35,
    cover: true,
  },
  {
    vendor_id: FX.shop2,
    slug: "pizza-place",
    name_en: "Pizza Place",
    name_ar: "محل البيتزا",
    cuisine_en: "Pizza",
    cuisine_ar: "بيتزا",
    village_en: "Baakline",
    village_ar: "بعقلين",
    open_now: false,
    fee_usd: 3,
    eta_min: 30,
    eta_max: 45,
    cover: true,
  },
];

/** A fresh store: its own basket, so each test starts empty. `lang` is the token's language. */
export function fixtureStore(lang: "ar" | "en" = "en"): FlowAppStore & { lines: any[] } {
  const lines: any[] = [];
  let vendor: string | null = null;
  const all = () =>
    ["alo-test-grill", "pizza-place"].flatMap((s) =>
      menuFor(s)!.sections.flatMap((x: any) => x.items),
    );
  return {
    lines,
    // Flowso makes its own token for each test: any non-empty token is this fixture customer, except "bad".
    session: async (t) =>
      t && t !== "bad"
        ? { status: "ok", token: FX.token, customer_id: "c1", lang }
        : { status: "bad_signature" },
    explore: async (t, q, cat, offset) => {
      if (t !== FX.token) return { status: "expired" };
      let shops = cards;
      if (q)
        shops = shops.filter((s) =>
          `${s.name_en} ${s.cuisine_en} shawarma`.toLowerCase().includes(q.toLowerCase()),
        );
      if (cat)
        shops = shops.filter((s) =>
          cat === "pizza" ? s.slug === "pizza-place" : s.slug === "alo-test-grill",
        );
      const out: any = {
        status: "ok",
        place: { name_en: "Baakline", name_ar: "بعقلين" },
        shops: shops.slice(offset, offset + 20),
        next_offset: null,
        rate: 89500,
      };
      if (!q && !cat && offset === 0) {
        out.categories = [
          { key: "shawarma", emoji: "🌯", name_en: "Shawarma", name_ar: "شاورما", shops: 1 },
          { key: "pizza", emoji: "🍕", name_en: "Pizza", name_ar: "بيتزا", shops: 1 },
        ];
        out.popular = {
          by_sales: true,
          items: [
            {
              id: FX.shaw,
              name_en: "Chicken Shawarma",
              name_ar: "شاورما دجاج",
              price_usd: 5,
              slug: "alo-test-grill",
              vendor_en: "Alo Test Grill",
              vendor_ar: "ألو تست غريل",
            },
            {
              id: FX.pizza,
              name_en: "Margherita",
              name_ar: "مارغريتا",
              price_usd: 8,
              slug: "pizza-place",
              vendor_en: "Pizza Place",
              vendor_ar: "محل البيتزا",
            },
          ],
        };
      }
      return out;
    },
    menu: async (t, slug) => {
      if (t !== FX.token) return { status: "expired" };
      const m: any = menuFor(slug);
      if (!m) return { status: "unavailable" };
      return {
        status: "ok",
        ...m,
        basket:
          vendor && vendor !== m.shop.vendor_id
            ? vendor === FX.shop1
              ? { other_vendor: true, vendor_en: "Alo Test Grill", vendor_ar: "ألو تست غريل" }
              : { other_vendor: true, vendor_en: "Pizza Place", vendor_ar: "محل البيتزا" }
            : null,
      };
    },
    basket: async (t) => {
      if (t !== FX.token) return { status: "expired" };
      if (!lines.length) return { status: "empty" };
      const sub = lines.reduce((n, l) => n + l.line_total_usd, 0);
      return {
        status: "ok",
        vendor_en: vendor === FX.shop1 ? "Alo Test Grill" : "Pizza Place",
        vendor_ar: vendor === FX.shop1 ? "ألو تست غريل" : "محل البيتزا",
        lines,
        subtotal_usd: sub,
        fee_usd: 2,
        total_usd: sub + 2,
        total_lbp: Math.round(((sub + 2) * 89500) / 1000) * 1000,
      };
    },
    add: async (t, itemId, qty, opts, note, replace) => {
      if (t !== FX.token) return { status: "expired" };
      const it = all().find((i: any) => i.id === itemId);
      if (!it) return { status: "unavailable" };
      const shop = ["alo-test-grill", "pizza-place"]
        .map((s) => menuFor(s)!)
        .find((m: any) => m.sections.some((x: any) => x.items.some((i: any) => i.id === itemId)))!;
      for (const g of it.groups) {
        const n = g.options.filter((o: any) => opts.includes(o.id)).length;
        if (n < g.min || n > g.max) return { status: "choices", item_id: itemId };
      }
      if (vendor && vendor !== shop.shop.vendor_id && !replace)
        return { status: "other_vendor", basket_vendor: "ألو تست غريل" };
      if (vendor !== shop.shop.vendor_id) lines.length = 0;
      vendor = shop.shop.vendor_id;
      const delta = it.groups
        .flatMap((g: any) => g.options)
        .filter((o: any) => opts.includes(o.id))
        .reduce((n: number, o: any) => n + o.price_usd, 0);
      lines.push({
        line_id: `53000000-0000-0000-0000-${String(lines.length + 1).padStart(12, "0")}`,
        item_id: itemId,
        name_en: it.name_en,
        name_ar: it.name_ar,
        quantity: qty,
        line_total_usd: (it.price_usd + delta) * qty,
        options: it.groups
          .flatMap((g: any) => g.options)
          .filter((o: any) => opts.includes(o.id))
          .map((o: any) => o.name_en),
        note: note || null,
      });
      return { status: "added" };
    },
    remove: async (t, ids) => {
      if (t !== FX.token) return { status: "expired" };
      const before = lines.length;
      for (const id of ids) {
        const k = lines.findIndex((l) => l.line_id === id);
        if (k >= 0) lines.splice(k, 1);
      }
      return { status: "removed", removed: before - lines.length };
    },
    complete: async (t) =>
      t !== FX.token
        ? { status: "expired" }
        : lines.length
          ? { status: "ok", basket_id: "b1" }
          : { status: "empty" },
    thumbs: async (_kind, refs) => Object.fromEntries(refs.map((r) => [r, TINY_JPEG])),
  };
}
