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
