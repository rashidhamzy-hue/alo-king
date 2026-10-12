// Fixture data for the website quality checks (screenshots, Lighthouse, axe). Every shop, dish and order here is made up:
// nothing in this file is a real business, price or customer. Shapes match the site_* functions of
// supabase/migrations/20261013090100_site_public_data.sql.

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
const FEES = { min_usd: 2, max_usd: 4.5, max_km: 10 };
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
        places: live ? PLACES : [],
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
      const p = PLACES.find((x) => x.slug === args.p_slug);
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
    case "order_track_public":
      return TRACKS[args.p_token] ?? null;
    default:
      return null;
  }
}
