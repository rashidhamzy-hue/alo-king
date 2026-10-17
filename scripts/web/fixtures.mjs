// Fixture data for the website quality checks (screenshots, Lighthouse, axe). Every shop, dish and order here is made up:
// nothing in this file is a real business, price or customer. Shapes match the site_* functions of
// supabase/migrations/20261013090100_site_public_data.sql.

import { readFileSync } from "node:fs";

const names = (en, ar, fr = en) => ({ name_en: en, name_ar: ar, name_fr: fr });
const pl = (slug, en, ar, merchants, lat, lon, fr = en) => ({
  id: `LB-${slug.toUpperCase()}`,
  slug,
  ...names(en, ar, fr),
  kind: "village",
  district_code: "CHF",
  lat,
  lon,
  merchants,
});

const PLACES = [
  pl("chf-baakline", "Baakline", "بعقلين", 4, 33.6774, 35.5635),
  pl("chf-beiteddine", "Beiteddine", "بيت الدين", 3, 33.6942, 35.5812),
  pl("chf-semqanieh", "Semqanieh", "السمقانية", 1, 33.679, 35.5885),
  pl("chf-bakaata", "Bakaata", "بقعاتا", 0, 33.6666, 35.5997),
];
// Session W: every other place of the real §39.2 zone (src/design/chouf-map.generated.ts) is switched on with no shop, so
// the map and its index look like the pilot. Only the four above have shops (made up).
// The generated file is TypeScript formatted by prettier: take the ZONE array literal and evaluate it (our own file).
const ZONE = new Function(
  `return ${
    readFileSync(new URL("../../src/design/chouf-map.generated.ts", import.meta.url), "utf8").match(
      /export const ZONE: ZonePlace\[\] = (\[[\s\S]*?\n\]);/,
    )[1]
  }`,
)();
const ALL_PLACES = [
  ...PLACES,
  ...ZONE.filter((z) => !PLACES.some((p) => p.slug === z.slug)).map((z) =>
    pl(z.slug, z.en, z.ar, 0, 33.68, 35.6, z.fr),
  ),
];
const CUISINES = [
  { tag: "lebanese", ...names("Lebanese", "لبناني", "Libanais"), sort_order: 1, vendors: 6 },
  { tag: "shawarma", ...names("Shawarma", "شاورما"), sort_order: 4, vendors: 3 },
  { tag: "manakish", ...names("Manakish", "مناقيش"), sort_order: 6, vendors: 3 },
  {
    tag: "lebanese_sweets",
    ...names("Lebanese sweets", "حلو عربي", "Douceurs libanaises"),
    sort_order: 24,
    vendors: 2,
  },
];
const FEES = { min_usd: 2, max_usd: 6, max_km: 20 };
const RATE = 89500;

const card = (slug, en, ar, type, tags, place, open = true, extra = {}) => ({
  slug,
  ...names(en, ar),
  branch_label: null,
  business_type: type,
  business_type_ar: type === "bakery_manakish" ? "مخبز ومناقيش" : "مطعم",
  business_type_en: type === "bakery_manakish" ? "Bakery & manakish" : "Restaurant",
  business_type_fr: type === "bakery_manakish" ? "Boulangerie et manakish" : "Restaurant",
  cuisine_tags: tags,
  delivery: true,
  pickup: true,
  open_now: open,
  paused: false,
  orderable: true,
  place_slug: place.slug,
  place_ar: place.name_ar,
  place_en: place.name_en,
  place_fr: place.name_fr,
  ...extra,
});
const VENDORS = [
  card(
    "abou-ali-shawarma",
    "Abou Ali Shawarma",
    "شاورما أبو علي",
    "restaurant",
    ["shawarma", "lebanese"],
    PLACES[0],
  ),
  card(
    "fournil-el-chouf",
    "Fournil el Chouf",
    "فرن الشوف",
    "bakery_manakish",
    ["manakish", "lebanese"],
    PLACES[0],
  ),
  card(
    "beit-el-mezze",
    "Beit el Mezze",
    "بيت المازة",
    "restaurant",
    ["lebanese"],
    PLACES[0],
    false,
  ),
  card("hlou-el-balad", "Hlou el Balad", "حلو البلد", "restaurant", ["lebanese_sweets"], PLACES[0]),
  card("saj-w-kaak", "Saj w Kaak", "صاج وكعك", "bakery_manakish", ["manakish"], PLACES[1]),
  card(
    "shawarma-el-qasr",
    "Shawarma el Qasr",
    "شاورما القصر",
    "restaurant",
    ["shawarma"],
    PLACES[1],
    true,
    { pickup: false },
  ),
  card("mezze-el-dar", "Mezze el Dar", "مازة الدار", "restaurant", ["lebanese"], PLACES[1]),
];

const item = (en, ar, fr, price, extra = {}) => ({
  ...names(en, ar, fr),
  description: null,
  price_usd: price,
  per_kg: false,
  vegetarian: false,
  vegan: false,
  spicy: 0,
  pork: false,
  alcohol: false,
  allergens: null,
  ...extra,
});
const VENDOR_PAGE = {
  vendor: {
    ...VENDORS[0],
    delivery_radius_km: 6,
    paused_until: null,
    cash_currencies: ["USD", "LBP"],
    updated_at: "2026-10-12T10:00:00Z",
    cuisines: [CUISINES[1], CUISINES[0]].map(({ tag, name_ar, name_en, name_fr }) => ({
      tag,
      name_ar,
      name_en,
      name_fr,
    })),
  },
  hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    weekday: d,
    opens: "11:00",
    closes: d === 5 || d === 6 ? "01:00" : "23:00",
  })),
  sections: [
    {
      ...names("Sandwiches", "سندويشات", "Sandwichs"),
      items: [
        item("Chicken shawarma", "شاورما دجاج", "Shawarma poulet", 3.5, {
          description: "Garlic sauce, pickles, fries inside.",
          allergens: ["sesame", "gluten"],
        }),
        item("Beef shawarma", "شاورما لحمة", "Shawarma bœuf", 4, {
          description: "Tahini, tomato, parsley and onion.",
          allergens: ["sesame", "gluten"],
        }),
        item("Falafel sandwich", "سندويش فلافل", "Sandwich falafel", 2.5, {
          vegan: true,
          vegetarian: true,
          allergens: ["sesame"],
        }),
        item("Spicy chicken wrap", "راب دجاج حار", "Wrap poulet épicé", 4.25, { spicy: 2 }),
      ],
    },
    {
      ...names("Plates", "أطباق", "Assiettes"),
      items: [
        item("Chicken shawarma plate", "صحن شاورما دجاج", "Assiette shawarma poulet", 7.5, {
          description: "Rice, salad, garlic sauce and pita.",
        }),
        item("Mixed grill plate", "صحن مشاوي مشكل", "Assiette de grillades mixtes", 12),
        item("Lamb by the kilo", "لحمة غنم بالكيلو", "Agneau au kilo", 22, { per_kg: true }),
      ],
    },
    {
      ...names("Drinks", "مشروبات", "Boissons"),
      items: [
        item("Pepsi", "بيبسي", "Pepsi", 1),
        item("Ayran", "عيران", "Ayran", 1.25, { vegetarian: true, allergens: ["milk"] }),
        item("Fresh lemonade", "ليموناضة طازة", "Citronnade fraîche", 2, {
          vegan: true,
          vegetarian: true,
        }),
      ],
    },
  ],
  fees: { min_usd: 2, max_usd: 4.5, max_km: 6 },
  rate: RATE,
};

// "Not on Alo King yet" (DECISIONS §39.3): made-up seed shops in the shapes of site_place_unclaimed, site_cuisine_unclaimed
// and site_vendor_unclaimed. Names only, never a price, phone or coordinates.
const EVERY_DAY = (h) =>
  ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    .map((d) => `${d}: ${h(d)}`)
    .join(" | ");
const ucard = (slug, en, ar, type, tags, place, hours, preview, count) => ({
  slug,
  ...names(en, ar),
  branch_label: null,
  business_type: type,
  business_type_ar: type === "bakery_manakish" ? "مخبز ومناقيش" : type === "cafe" ? "مقهى" : "مطعم",
  business_type_en:
    type === "bakery_manakish" ? "Bakery & manakish" : type === "cafe" ? "Café" : "Restaurant",
  business_type_fr:
    type === "bakery_manakish"
      ? "Boulangerie et manakish"
      : type === "cafe"
        ? "Café"
        : "Restaurant",
  cuisine_tags: tags,
  cuisines: CUISINES.filter((c) => tags.includes(c.tag)).map(
    ({ tag, name_ar, name_en, name_fr }) => ({
      tag,
      name_ar,
      name_en,
      name_fr,
    }),
  ),
  place_slug: place.slug,
  place_ar: place.name_ar,
  place_en: place.name_en,
  place_fr: place.name_fr,
  hours_seed: hours,
  menu_items: count,
  menu_preview: preview.map(([e, a]) => names(e, a)),
});
const UNCLAIMED = [
  ucard(
    "kaak-abou-salim",
    "Kaak Abou Salim",
    "كعك أبو سليم",
    "bakery_manakish",
    ["manakish"],
    PLACES[0],
    EVERY_DAY(() => "6 AM to 2 PM"),
    [
      ["Zaatar manousheh", "منقوشة زعتر"],
      ["Cheese manousheh", "منقوشة جبنة"],
      ["Kaak with sesame", "كعك بسمسم"],
      ["Lahm bi ajine", "لحم بعجين"],
    ],
    14,
  ),
  ucard(
    "shawarma-el-midan",
    "Shawarma el Midan",
    "شاورما الميدان",
    "restaurant",
    ["shawarma", "lebanese"],
    PLACES[2],
    EVERY_DAY((d) => (d === "Monday" ? "Closed" : "11 AM to 11:30 PM")),
    [
      ["Chicken shawarma", "شاورما دجاج"],
      ["Beef shawarma", "شاورما لحمة"],
    ],
    2,
  ),
  ucard("ahwet-el-saha", "Ahwet el Saha", "قهوة الساحة", "cafe", [], PLACES[1], null, [], 0),
];
const UNCLAIMED_PAGE = {
  vendor: { ...UNCLAIMED[1], vendor_id: "20000000-0000-0000-0000-0000000000e1" },
  sections: [
    {
      ...names("Sandwiches", "سندويشات", "Sandwichs"),
      items: [
        {
          ...names("Chicken shawarma", "شاورما دجاج", "Shawarma poulet"),
          description: "Garlic sauce and pickles.",
        },
        { ...names("Beef shawarma", "شاورما لحمة", "Shawarma bœuf"), description: null },
      ],
    },
  ],
};
const unclaimedList = (vendors, page = 1) => ({
  total: vendors.length,
  page,
  page_size: 24,
  vendors: page === 1 ? vendors : [],
});

// ---- Item pages, photo credits and a demo shop (DECISIONS §39.15.7, migration 20261016160000) ------------------------------
// Shapes of site_item, site_credits and site_vendor_demo. The photos are the mock's drawn placeholders (itemPhotoSvg) and
// the credits name no real person or site (.example addresses).
export const ITEM_IDS = {
  shawarma: "80000000-0000-0000-0000-000000000001",
  ayran: "80000000-0000-0000-0000-000000000002",
  demo: "80000000-0000-0000-0000-0000000000d1",
  // No photo and a very long name, at a shop that takes orders but has no page of its own (named, not linked).
  long: "80000000-0000-0000-0000-0000000000e1",
};
const DEMO_VENDOR = card(
  "demo-mashawi-el-dayaa",
  "Mashawi el Dayaa",
  "مشاوي الضيعة",
  "restaurant",
  ["lebanese"],
  PLACES[2],
  true,
  { demo: true },
);
export const DEMO_SLUG = DEMO_VENDOR.slug;
// Takes orders, no page of its own: its items have pages (the catalogue links them), the shop is not linked.
const NO_PAGE_VENDOR = card(
  "furn-el-ain",
  "Furn el Ain",
  "فرن العين",
  "bakery_manakish",
  ["manakish"],
  PLACES[1],
);
const DEMO_PAGE = {
  vendor: {
    ...DEMO_VENDOR,
    delivery_radius_km: 8,
    paused_until: null,
    cash_currencies: ["USD"],
    updated_at: "2026-10-16T09:00:00Z",
    cuisines: [{ tag: "lebanese", ...names("Lebanese", "لبناني", "Libanais") }],
    demo: true,
  },
  hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, opens: "12:00", closes: "23:00" })),
  sections: [
    {
      ...names("Grills", "مشاوي", "Grillades"),
      items: [
        item("Lamb kafta by the kilo", "كفتة غنم بالكيلو", "Kefta d'agneau au kilo", 18, {
          per_kg: true,
          description: "Minced lamb with parsley and onion, ready to grill.",
        }),
        item("Shish taouk plate", "صحن شيش طاووق", "Assiette de chich taouk", 8.5, {
          description: "Grilled chicken, garlic sauce, fries and pickles.",
          allergens: ["gluten"],
        }),
      ],
    },
  ],
  fees: { min_usd: 2, max_usd: 5, max_km: 8 },
  rate: RATE,
};
// ownPage: the shop has a public page; a demo shop has its demo page. has_page = either (site_item's vendor.has_page).
const itemVendor = (v, demo, ownPage = !demo) => ({
  slug: v.slug,
  name_ar: v.name_ar,
  name_en: v.name_en,
  name_fr: v.name_fr,
  place_slug: v.place_slug,
  place_ar: v.place_ar,
  place_en: v.place_en,
  place_fr: v.place_fr,
  orderable: v.orderable,
  paused: v.paused,
  open_now: v.open_now,
  demo,
  public_page: !demo && ownPage,
  has_page: demo || ownPage,
});
const pageItem = (id, en, ar, fr, price, extra = {}) => ({
  id,
  ...names(en, ar, fr),
  description: null,
  price_usd: price,
  per_kg: false,
  est_weight_kg: null,
  available: true,
  vegetarian: false,
  vegan: false,
  spicy: 0,
  pork: false,
  alcohol: false,
  photo: true,
  photo_source: "merchant",
  credit: null,
  ...extra,
});
const opt = (en, ar, fr, price) => ({ ...names(en, ar, fr), price_usd: price });
const CREDIT = {
  shop: {
    credit: "Abou Ali Shawarma website",
    license: "Used with permission",
    source_url: "https://abou-ali-shawarma.example/menu",
  },
  packshot: {
    credit: "Example Packshots",
    license: "CC BY 4.0",
    source_url: "https://packshots.example/ayran",
  },
  demo: { credit: "Drawn for the Alo King demo", license: "CC0 1.0", source_url: null },
};
const ITEMS = {
  [ITEM_IDS.shawarma]: {
    item: pageItem(ITEM_IDS.shawarma, "Chicken shawarma", "شاورما دجاج", "Shawarma poulet", 3.5, {
      description: "Garlic sauce, pickles, fries inside.",
      photo_source: "merchant_site",
      credit: CREDIT.shop,
    }),
    vendor: itemVendor(VENDORS[0], false),
    nutrition: { kcal: 520, protein_g: 31.5, carbs_g: 48, fat_g: 21.5, status: "estimated" },
    allergens: ["gluten", "sesame"],
    options: [
      {
        ...names("Size", "الحجم", "Taille"),
        min: 1,
        max: 1,
        options: [opt("Regular", "عادي", "Normal", 0), opt("Large", "كبير", "Grand", 1.5)],
      },
      {
        ...names("Extras", "إضافات", "Suppléments"),
        min: 0,
        max: 3,
        options: [
          opt("Extra garlic sauce", "زيادة توم", "Sauce à l'ail en plus", 0.25),
          opt("Cheese", "جبنة", "Fromage", 0.5),
          opt("No pickles", "بلا كبيس", "Sans cornichons", 0),
        ],
      },
    ],
    goes_well: {
      id: ITEM_IDS.ayran,
      ...names("Ayran", "عيران", "Ayran"),
      price_usd: 1.25,
      per_kg: false,
      photo: true,
    },
    rate: RATE,
  },
  [ITEM_IDS.ayran]: {
    item: pageItem(ITEM_IDS.ayran, "Ayran", "عيران", "Ayran", 1.25, {
      vegetarian: true,
      photo_source: "packshot",
      credit: CREDIT.packshot,
    }),
    vendor: itemVendor(VENDORS[0], false),
    nutrition: null,
    allergens: ["dairy"],
    options: [],
    goes_well: null,
    rate: RATE,
  },
  // The demo item: sold by weight, an illustration, allergens not declared, nutrition from the shop.
  [ITEM_IDS.demo]: {
    item: pageItem(
      ITEM_IDS.demo,
      "Lamb kafta by the kilo",
      "كفتة غنم بالكيلو",
      "Kefta d'agneau au kilo",
      18,
      {
        description: "Minced lamb with parsley and onion, ready to grill.",
        per_kg: true,
        est_weight_kg: 0.5,
        photo_source: "illustrative",
        credit: CREDIT.demo,
      },
    ),
    vendor: itemVendor(DEMO_VENDOR, true),
    nutrition: { kcal: 1250, protein_g: 85, carbs_g: 4, fat_g: 98, status: "merchant_verified" },
    allergens: null,
    options: [
      {
        ...names("Ready as", "التحضير", "Préparation"),
        min: 0,
        max: 1,
        options: [opt("Skewers", "أسياخ", "Brochettes", 0), opt("Patties", "أقراص", "Galettes", 0)],
      },
    ],
    goes_well: null,
    rate: RATE,
  },
  // No photo, a very long name in every language, a required choice, at a shop without a page of its own: the layout
  // without the photo column, long names wrapping in the title and the breadcrumbs, the shop named but not linked.
  [ITEM_IDS.long]: {
    item: pageItem(
      ITEM_IDS.long,
      "Family feast of mixed grills: shish taouk, lamb kafta, beef kebab, grilled halloumi, batata harra, hummus, mutabbal, fattoush and warm saj bread for six to eight people",
      "وليمة العائلة من المشاوي المشكلة: شيش طاووق وكفتة غنم وكباب لحم وحلوم مشوي وبطاطا حرة وحمص ومتبل وفتوش وخبز صاج سخن لستة إلى ثمانية أشخاص",
      "Festin familial de grillades mixtes : chich taouk, kefta d'agneau, kebab de bœuf, halloumi grillé, batata harra, houmous, moutabal, fattouch et pain saj chaud pour six à huit personnes",
      42,
      { photo: false, photo_source: null, credit: null, description: null },
    ),
    vendor: itemVendor(NO_PAGE_VENDOR, false, false),
    nutrition: null,
    allergens: ["gluten", "sesame", "dairy"],
    options: [
      {
        ...names("Bread", "الخبز", "Pain"),
        min: 1,
        max: 1,
        options: [opt("Saj", "صاج", "Saj", 0), opt("Markouk", "مرقوق", "Markouk", 1)],
      },
    ],
    goes_well: null,
    rate: RATE,
  },
};
const creditRow = (kind, id, v, it, source, c, hasPage = true) => ({
  kind,
  item_id: id,
  vendor_slug: v.slug,
  vendor_ar: v.name_ar,
  vendor_en: v.name_en,
  vendor_fr: v.name_fr,
  item_ar: it?.name_ar ?? null,
  item_en: it?.name_en ?? null,
  item_fr: it?.name_fr ?? null,
  source,
  has_page: hasPage,
  ...c,
});
const CREDITS = [
  creditRow("cover", null, VENDORS[0], null, "merchant_site", {
    ...CREDIT.shop,
    source_url: "https://abou-ali-shawarma.example/",
  }),
  creditRow(
    "item",
    ITEM_IDS.ayran,
    VENDORS[0],
    ITEMS[ITEM_IDS.ayran].item,
    "packshot",
    CREDIT.packshot,
  ),
  creditRow(
    "item",
    ITEM_IDS.shawarma,
    VENDORS[0],
    ITEMS[ITEM_IDS.shawarma].item,
    "merchant_site",
    CREDIT.shop,
  ),
  creditRow(
    "item",
    ITEM_IDS.demo,
    DEMO_VENDOR,
    ITEMS[ITEM_IDS.demo].item,
    "illustrative",
    CREDIT.demo,
  ),
  // A shop without a page of its own: named on /credits, not linked.
  creditRow(
    "cover",
    null,
    NO_PAGE_VENDOR,
    null,
    "illustrative",
    { credit: "Drawn for the Alo King checks", license: "CC0 1.0", source_url: null },
    false,
  ),
];

// ---- The web shop menu (session 5g, CUSTOMER-EXPERIENCE §4, migration 20261017110000) ---------------------------------------
// Shapes of web_menu and web_basket_save for the signed link ?t=<token>. Made-up shop and dishes; photos are drawn plates.
export const WEB_TOKEN = "QAweb_menu-token-0000001";
export const WEB_TOKEN_EXPIRED = "QAweb_menu-token-expired";
export const WEB_SLUG = "abou-ali-shawarma";
const wid = (n) => `90000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const wItem = (n, en, ar, fr, price, extra = {}) => ({
  id: wid(n),
  ...names(en, ar, fr),
  description: null,
  price_usd: price,
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
  groups: [],
  ...extra,
});
const wGroup = (n, en, ar, fr, min, max, opts) => ({
  id: wid(500 + n),
  ...names(en, ar, fr),
  min,
  max,
  options: opts.map(([oen, oar, ofr, price], k) => ({
    id: wid(600 + n * 10 + k),
    ...names(oen, oar, ofr),
    price_usd: price,
  })),
});
const SIZE = (n) =>
  wGroup(n, "Size", "الحجم", "Taille", 1, 1, [
    ["Regular", "عادي", "Normal", 0],
    ["Large", "كبير", "Grand", 1.5],
  ]);
export const WEB_MENU = {
  status: "ok",
  lang: "en",
  shop: {
    vendor_id: "10000000-0000-0000-0000-0000000000a1",
    slug: WEB_SLUG,
    ...names("Abou Ali Shawarma", "شاورما أبو علي", "Abou Ali Shawarma"),
    branch_label: null,
    cuisine_ar: "شاورما",
    cuisine_en: "Shawarma",
    cuisine_fr: "Chawarma",
    village_ar: "بعقلين",
    village_en: "Baakline",
    village_fr: "Baakline",
    open_now: true,
    hours_today: "11:00–23:30",
    paused: false,
    cover: true,
    demo: false,
    delivery: true,
    pickup: true,
    min_order_usd: 5,
  },
  delivery: {
    status: "ok",
    fee_usd: 2,
    road_km: 3.4,
    eta_min: 25,
    eta_max: 35,
    place_ar: "بعقلين",
    place_en: "Baakline",
    place_fr: "Baakline",
    demo_address: false,
  },
  sections: [
    {
      id: wid(901),
      ...names("Sandwiches", "سندويشات", "Sandwichs"),
      items: [
        wItem(1, "Chicken Shawarma", "شاورما دجاج", "Chawarma poulet", 4.5, {
          description: "Garlic sauce, pickles and fries, rolled in Lebanese bread.",
          groups: [
            SIZE(1),
            wGroup(2, "Extras", "إضافات", "Suppléments", 0, 2, [
              ["Extra garlic", "توم زيادة", "Ail en plus", 0.5],
              ["Cheese", "جبنة", "Fromage", 0.75],
              ["Fries inside", "بطاطا جوّا", "Frites dedans", 0],
            ]),
          ],
          goes_well: wid(6),
          allergens: ["gluten", "sesame"],
          nutrition: { kcal: 520, protein_g: 32, carbs_g: 48, fat_g: 21, status: "estimated" },
        }),
        wItem(2, "Beef Shawarma", "شاورما لحمة", "Chawarma bœuf", 5.5, {
          description: "Tahini, parsley, onion and tomato.",
          groups: [SIZE(3)],
        }),
        wItem(3, "Falafel Sandwich", "سندويش فلافل", "Sandwich falafel", 2.5, {
          vegetarian: true,
          photo: false,
          description: "Tahini, tomato, mint and pickled turnip.",
        }),
      ],
    },
    {
      id: wid(902),
      ...names("Plates", "صحون", "Assiettes"),
      items: [
        wItem(4, "Mixed Grill Plate", "صحن مشاوي مشكل", "Assiette de grillades", 14, {
          description: "Kafta, taouk and lamb, with garlic sauce, fries and bread.",
        }),
        wItem(5, "Lamb Chops", "ريش غنم", "Côtelettes d'agneau", 28, {
          per_kg: true,
          est_weight_kg: 0.4,
          photo: false,
        }),
      ],
    },
    {
      id: wid(903),
      ...names("Sides and drinks", "مقبلات ومشروبات", "Accompagnements et boissons"),
      items: [
        wItem(6, "French Fries", "بطاطا مقلية", "Frites", 2.5, { photo_source: "illustrative" }),
        wItem(7, "Hummus", "حمص", "Houmous", 3, { photo: false, vegan: true }),
        wItem(8, "Ayran", "عيران", "Ayran", 1, {}),
        wItem(9, "Mint Lemonade", "ليموناضة بالنعنع", "Citronnade à la menthe", 2.5, {
          groups: [
            wGroup(4, "Size", "الحجم", "Taille", 1, 1, [
              ["Small", "صغير", "Petit", 0],
              ["Large", "كبير", "Grand", 1],
            ]),
          ],
        }),
      ],
    },
  ],
  basket: {
    other_vendor: false,
    lines: [{ item_id: wid(8), quantity: 2, option_ids: [], note: null }],
  },
  note_max: 80,
  rate: RATE,
  expires_at: "2026-10-18T09:00:00Z",
};

/** The catalogue image route's stand-in: a drawn plate, its colour taken from the item id. */
export function itemPhotoSvg(id) {
  const hue = (parseInt(id.slice(-2), 16) * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="hsl(${hue} 35% 22%)"/><circle cx="400" cy="420" r="270" fill="#fff9f0"/><circle cx="400" cy="420" r="205" fill="hsl(${hue} 65% 52%)"/><circle cx="330" cy="370" r="46" fill="hsl(${hue} 70% 70%)"/></svg>`;
}

const TRACK = (over) => ({
  code: "K7M4PQ",
  status: "picked_up",
  fulfilment: "delivery",
  vendor_ar: "شاورما أبو علي",
  vendor_en: "Abou Ali Shawarma",
  vendor_fr: "Abou Ali Shawarma",
  total_usd: 10,
  total_lbp: 895000,
  usd_lbp_rate: RATE,
  estimated: false,
  eta: { min: 3, max: 8 },
  driver_assigned: true,
  area_ar: "بعقلين",
  area_en: "Baakline",
  area_fr: "Baakline",
  placed_at: "2026-10-12T17:00:00Z",
  accepted_at: "2026-10-12T17:01:00Z",
  ready_at: "2026-10-12T17:15:00Z",
  picked_up_at: "2026-10-12T17:18:00Z",
  delivered_at: null,
  expires_at: "2026-10-14T17:00:00Z",
  ...over,
});
export const TRACK_TOKENS = {
  delivery: "A".repeat(43),
  pickup: "B".repeat(43),
  done: "C".repeat(43),
};
const TRACKS = {
  [TRACK_TOKENS.delivery]: TRACK({}),
  [TRACK_TOKENS.pickup]: TRACK({
    fulfilment: "pickup",
    status: "ready",
    eta: { min: 5, max: 10 },
    driver_assigned: false,
    area_ar: null,
    area_en: null,
    area_fr: null,
    picked_up_at: null,
  }),
  [TRACK_TOKENS.done]: TRACK({
    status: "delivered",
    eta: null,
    delivered_at: "2026-10-12T17:30:00Z",
  }),
};

/** mode "live": places switched on with shops. mode "prelaunch": nothing live yet (what production shows before the pilot). */
export function respond(fn, args, mode = "live") {
  const live = mode === "live";
  switch (fn) {
    case "site_overview":
      return {
        places: live ? ALL_PLACES : [],
        cuisines: live ? CUISINES : [],
        merchants: live ? VENDORS.length : 0,
        fees: FEES,
        order_fee_usd: 1,
        order_fee_free_days: 30,
        rate: RATE,
        rate_at: "2026-10-12T10:00:00Z",
      };
    case "site_vendor_slugs":
      return live ? VENDORS.map((v) => ({ slug: v.slug, updated_at: "2026-10-12T10:00:00Z" })) : [];
    case "site_place": {
      const p = ALL_PLACES.find((x) => x.slug === args.p_slug);
      if (!live || !p) return null;
      const { id, slug, kind, district_code, lat, lon, name_ar, name_en, name_fr } = p;
      return {
        place: {
          id,
          slug,
          kind,
          district_code,
          lat,
          lon,
          name_ar,
          name_en,
          name_fr,
          district_ar: "الشوف",
          district_en: "Chouf",
          district_fr: "Chouf",
        },
        vendors: VENDORS.filter((v) => v.place_slug === slug),
        fees: FEES,
        rate: RATE,
      };
    }
    case "site_cuisine": {
      const c = CUISINES.find((x) => x.tag === args.p_tag);
      if (!live || !c) return null;
      return {
        cuisine: { tag: c.tag, name_ar: c.name_ar, name_en: c.name_en, name_fr: c.name_fr },
        vendors: VENDORS.filter((v) => v.cuisine_tags.includes(c.tag)),
        rate: RATE,
      };
    }
    case "site_vendor":
      return live && args.p_slug === "abou-ali-shawarma" ? VENDOR_PAGE : null;
    case "site_place_unclaimed":
      return PLACES.some((x) => x.slug === args.p_slug) && live
        ? unclaimedList(UNCLAIMED, args.p_page ?? 1)
        : null;
    case "site_cuisine_unclaimed":
      return CUISINES.some((x) => x.tag === args.p_tag) && live
        ? unclaimedList(
            UNCLAIMED.filter((u) => u.cuisine_tags.includes(args.p_tag)),
            args.p_page ?? 1,
          )
        : null;
    case "site_delivery_map":
      return live
        ? {
            places: ALL_PLACES.map((p) => ({
              slug: p.slug,
              shops: p.merchants,
              unclaimed: UNCLAIMED.filter((u) => u.place_slug === p.slug).length,
            })),
            unclaimed_total: UNCLAIMED.length,
          }
        : { places: [], unclaimed_total: 0 };
    case "site_village_unclaimed": {
      if (!live || !ALL_PLACES.some((x) => x.slug === args.p_slug)) return null;
      const v = UNCLAIMED.filter((u) => u.place_slug === args.p_slug);
      return { total: v.length, vendors: v };
    }
    case "site_vendor_unclaimed":
      return live && args.p_slug === UNCLAIMED_PAGE.vendor.slug ? UNCLAIMED_PAGE : null;
    case "site_item":
      return live ? (ITEMS[args.p_item_id] ?? null) : null;
    case "web_menu":
      if (args.p_token === WEB_TOKEN_EXPIRED) return { status: "expired" };
      if (args.p_token !== WEB_TOKEN) return { status: "expired" };
      return args.p_slug === WEB_SLUG ? WEB_MENU : { status: "unavailable", lang: "en" };
    case "web_basket_save":
      return args.p_token === WEB_TOKEN
        ? {
            status: "saved",
            items: (args.p_lines ?? []).reduce((a, l) => a + (l.quantity ?? 0), 0),
            subtotal_usd: 0,
          }
        : { status: "expired" };
    case "site_vendor_demo":
      return live && args.p_slug === DEMO_SLUG ? DEMO_PAGE : null;
    case "site_credits": {
      const page = Math.max(1, Number(args.p_page) || 1);
      return {
        total: live ? CREDITS.length : 0,
        page,
        page_size: 100,
        photos: live && page === 1 ? CREDITS : [],
      };
    }
    case "order_track_public":
      return TRACKS[args.p_token] ?? null;
    default:
      return null;
  }
}

// ---- Business types and the `site-claim` function (claim, registration and driver forms, session 6b) -----------------
export const BUSINESS_TYPES = [
  ["restaurant", "مطعم", "Restaurant", "Restaurant"],
  ["fast_food", "سناك", "Fast food", "Restauration rapide"],
  ["cafe", "مقهى", "Café", "Café"],
  ["bakery_manakish", "مخبز ومناقيش", "Bakery & manakish", "Boulangerie et manakish"],
  ["sweets_pastry", "حلويات", "Sweets & pastry", "Douceurs et pâtisserie"],
  ["grocery_supermarket", "بقالة وسوبرماركت", "Grocery & supermarket", "Épicerie et supermarché"],
  ["home_essentials", "مياه وغاز", "Water & gas", "Eau et gaz"],
].map(([business_type, name_ar, name_en, name_fr]) => ({
  business_type,
  name_ar,
  name_en,
  name_fr,
}));

export const CLAIM_VENDOR_ID = "20000000-0000-0000-0000-0000000000d1";
const CLAIM_BUSINESS = {
  vendor_id: CLAIM_VENDOR_ID,
  name: "شاورما أبو علي",
  branch_label: null,
  town: "بعقلين",
  claimed: false,
  frozen: false,
  phone_tail: "…56",
  in_brand: true,
  asked: 12,
};
const CLAIM_ID = "40000000-0000-0000-0000-000000000001";

/** What the deployed function would answer, for the claim, registration and driver flows. Never a real claim. */
export function siteClaim(body, upload) {
  if (upload) {
    // The registration comes first and the sign photo last: the sign photo completes the papers.
    return upload.kind === "sign_photo" || upload.kind === "company"
      ? { ok: true, status: "pending_review", claim_id: upload.claim_id }
      : {
          ok: true,
          status: "awaiting_documents",
          claim_id: upload.claim_id,
          missing: ["sign_photo"],
        };
  }
  switch (body.action) {
    case "search":
      return {
        ok: true,
        results: /nomatch/i.test(body.q)
          ? []
          : [
              { ...CLAIM_BUSINESS, in_brand: undefined },
              {
                vendor_id: "20000000-0000-0000-0000-0000000000d2",
                name: "Abou Ali Bakery",
                branch_label: "Hazmieh",
                town: "الحازمية",
                claimed: true,
                frozen: false,
                phone_tail: "…11",
              },
            ],
      };
    case "lookup":
      return body.vendor_id === CLAIM_VENDOR_ID
        ? { ok: true, found: true, business: CLAIM_BUSINESS }
        : { ok: true, found: false };
    case "start":
      return String(body.phone).includes("999")
        ? {
            ok: true,
            status: "awaiting_documents",
            claim_id: CLAIM_ID,
            case: "C",
            missing: ["registration", "sign_photo"],
            code_not_delivered: true,
          }
        : {
            ok: true,
            status: "code_sent",
            claim_id: CLAIM_ID,
            case: "A",
            channel: "whatsapp",
            phone_tail: "…56",
          };
    case "verify":
      return body.code === "123456"
        ? { ok: true, status: "approved", claim_id: CLAIM_ID }
        : { ok: true, status: "wrong_code", claim_id: CLAIM_ID, left: 4 };
    case "use_documents":
      return {
        ok: true,
        status: "awaiting_documents",
        claim_id: CLAIM_ID,
        missing: ["registration", "sign_photo"],
      };
    case "no_registration":
      return { ok: true, status: "waitlist" };
    case "status":
      return { ok: true, status: "no_claim" };
    case "register":
      return {
        ok: true,
        status: "awaiting_documents",
        claim_id: CLAIM_ID,
        case: "E",
        missing: body.home_kitchen ? ["registration"] : ["registration", "sign_photo"],
      };
    case "driver_apply":
      return { ok: true, status: "received" };
    default:
      return { ok: false, error: "unknown_action" };
  }
}

// ---- The staff pages (merchant dashboard, admin console, driver app; session 6b) -------------------------------------------
// Made-up rows in the shapes the pages read. Who is signed in is decided by the `sub` of the fake token the checks plant.
export const PERSONAS = {
  merchant: { sub: "00000000-0000-0000-0000-0000000000a1", email: "owner@example.test" },
  admin: { sub: "00000000-0000-0000-0000-0000000000a2", email: "team@example.test" },
};
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const order = (n, code, status, items, total, minAgo) => ({
  id: `50000000-0000-0000-0000-00000000000${n}`,
  short_code: code,
  vendor_id: CLAIM_VENDOR_ID,
  customer_name: ["Maya", "Elie", "Rima"][n - 1],
  items,
  subtotal_usd: total - 2,
  delivery_fee_usd: 2,
  total_usd: total,
  status,
  payment_method: "cod",
  payment_status: "unpaid",
  delivery_village: "Baakline",
  building_landmark: "Near the old mosque, second floor",
  notes: n === 1 ? "No garlic please" : null,
  customer_lat: 33.6774,
  customer_lng: 35.5635,
  driver_id: null,
  driver_lat: null,
  driver_lng: null,
  driver_location_at: null,
  prep_minutes: 20,
  created_at: ago(minAgo),
  accepted_at: status === "pending" ? null : ago(minAgo - 1),
  ready_at: null,
  picked_up_at: null,
  delivered_at: null,
  is_expat_gift: false,
  gift_sender_name: null,
  gift_message: null,
});
const menuItem = (n, section, en, ar, price, extra = {}) => ({
  item_id: `60000000-0000-0000-0000-00000000000${n}`,
  vendor_id: CLAIM_VENDOR_ID,
  item_name_en: en,
  item_name_ar: ar,
  section,
  price_usd: price,
  available: true,
  sort_order: n * 10,
  description_en: null,
  allergens_reviewed: false,
  ...extra,
});
const TABLES = {
  operators: [{ user_id: PERSONAS.admin.sub, display_name: "Rasheed (test)", active: true }],
  vendor_members: [
    {
      vendor_id: CLAIM_VENDOR_ID,
      role: "owner",
      display_name: "Samir",
      status: "active",
      user_id: PERSONAS.merchant.sub,
      created_at: ago(5000),
    },
  ],
  vendors: [
    {
      vendor_id: CLAIM_VENDOR_ID,
      slug: "abou-ali-shawarma",
      name_en: "Abou Ali Shawarma",
      name_ar: "شاورما أبو علي",
      category_canonical: "Restaurant",
      village_canonical: "Baakline",
      address: "Main road, Baakline",
      latitude: 33.6774,
      longitude: 35.5635,
      open_days: null,
      open_time: null,
      close_time: null,
      menu_available: true,
      is_live: false,
      is_active: true,
    },
  ],
  vendor_profiles: [
    {
      vendor_id: CLAIM_VENDOR_ID,
      accepts_orders: true,
      delivery_radius_km: 6,
      hours: { mon: [["11:00", "23:00"]] },
    },
  ],
  vendor_private: [{ vendor_id: CLAIM_VENDOR_ID, owner_phone_urgent: null }],
  menu_items: [
    menuItem(1, "Sandwiches", "Chicken shawarma", "شاورما دجاج", 3.5, {
      description_en: "Garlic sauce, pickles, fries inside.",
    }),
    menuItem(2, "Sandwiches", "Beef shawarma", "شاورما لحمة", 4),
    menuItem(3, "Sandwiches", "Falafel sandwich", "سندويش فلافل", 2.5),
    menuItem(4, "Plates", "Mixed grill plate", "صحن مشاوي مشكل", 12, { available: false }),
    menuItem(5, "Drinks", "Pepsi", "بيبسي", 1),
  ],
  orders: [
    order(
      1,
      "K7M4PQ",
      "pending",
      [
        { name_en: "Chicken shawarma", name_ar: "شاورما دجاج", unit_price_usd: 3.5, quantity: 2 },
        { name_en: "Pepsi", name_ar: "بيبسي", unit_price_usd: 1, quantity: 1 },
      ],
      10,
      1,
    ),
    order(
      2,
      "R2T9XA",
      "preparing",
      [
        {
          name_en: "Mixed grill plate",
          name_ar: "صحن مشاوي مشكل",
          unit_price_usd: 12,
          quantity: 1,
        },
      ],
      14,
      9,
    ),
    order(
      3,
      "M5H8LC",
      "ready",
      [{ name_en: "Falafel sandwich", name_ar: "سندويش فلافل", unit_price_usd: 2.5, quantity: 3 }],
      9.5,
      22,
    ),
  ],
  vendor_claims: [
    {
      id: "40000000-0000-0000-0000-000000000011",
      vendor_id: CLAIM_VENDOR_ID,
      claimant_phone: "+96176555001",
      claimant_name: "Samir Khoury",
      claim_case: "C",
      status: "pending_review",
      contested: false,
      home_kitchen: false,
      brand_wide: false,
      documents: [
        { kind: "registration", ref: "storage:claim-documents/x/registration-1.jpg" },
        { kind: "sign_photo", ref: "storage:claim-documents/x/sign_photo-2.jpg" },
      ],
      decision_note: null,
      created_at: ago(95),
      vendors: { name_en: "Abou Ali Shawarma", name_ar: "شاورما أبو علي" },
    },
    {
      id: "40000000-0000-0000-0000-000000000012",
      vendor_id: CLAIM_VENDOR_ID,
      claimant_phone: "+96171555123",
      claimant_name: "Nadia Haddad",
      claim_case: "E",
      status: "pending_review",
      contested: true,
      home_kitchen: true,
      brand_wide: false,
      documents: [{ kind: "registration", ref: "storage:claim-documents/y/registration-1.pdf" }],
      decision_note: null,
      created_at: ago(400),
      vendors: { name_en: "Nadia's Kitchen", name_ar: null },
    },
    {
      id: "40000000-0000-0000-0000-000000000013",
      vendor_id: CLAIM_VENDOR_ID,
      claimant_phone: "+96103123456",
      claimant_name: null,
      claim_case: "A",
      status: "code_sent",
      contested: false,
      home_kitchen: false,
      brand_wide: false,
      documents: [],
      decision_note: null,
      created_at: ago(20),
      vendors: { name_en: "Hlou el Balad", name_ar: "حلو البلد" },
    },
  ],
  driver_applications: [
    {
      id: "70000000-0000-0000-0000-000000000001",
      full_name: "Karim Haddad",
      phone_e164: "+96171555123",
      place: "Baakline",
      vehicle: "motorbike",
      has_licence: true,
      languages: ["ar", "en"],
      availability: ["evenings", "weekends"],
      note: "I know the Shouf roads well.",
      status: "new",
      created_at: ago(60),
    },
    {
      id: "70000000-0000-0000-0000-000000000002",
      full_name: "Joe Aoun",
      phone_e164: "+96103999111",
      place: "Beiteddine",
      vehicle: "car",
      has_licence: true,
      languages: ["fr", "ar"],
      availability: ["mornings"],
      note: null,
      status: "contacted",
      created_at: ago(2000),
    },
  ],
};
const RPCS = {
  usd_lbp_rate: () => RATE,
  vendor_completeness: () => ({
    profile_score: 54,
    menu_score: 38,
    overall: 46,
    missing_profile: ["description", "urgent_phone", "logo"],
    menu: {
      items: 5,
      with_description: 1,
      with_photo: 0,
      with_ingredients: 0,
      allergens_reviewed: 0,
      macros_verified: 0,
      with_prep_time: 0,
    },
  }),
  driver_cash_on_hand: () => 42,
};

/** A table read by the staff pages: every row (filters are not applied: the pages are being looked at, not tested). */
export function restTable(name) {
  return TABLES[name] ?? [];
}
export const restRpc = (fn) => (RPCS[fn] ? RPCS[fn]() : null);
