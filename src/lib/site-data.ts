// Typed access to what the public pages read (the site_* functions of migration 20261013090100, and later ones below).
import { rpc, select } from "./rest";

export type Names = { name_ar: string | null; name_en: string | null; name_fr: string | null };

export type SitePlaceRow = Names & {
  id: string;
  slug: string;
  kind: string;
  district_code: string;
  lat: number;
  lon: number;
  merchants: number;
};
export type SiteCuisineRow = Names & { tag: string; sort_order: number; vendors: number };
export type Fees = { min_usd: number | null; max_usd: number | null; max_km: number | null };

export type SiteOverview = {
  places: SitePlaceRow[];
  cuisines: SiteCuisineRow[];
  merchants: number;
  fees: Fees;
  order_fee_usd: number | null;
  order_fee_free_days: number | null;
  rate: number | null;
  rate_at: string | null;
};

export type VendorCard = {
  slug: string;
  name_ar: string | null;
  name_en: string | null;
  name_fr: string | null;
  branch_label: string | null;
  business_type: string;
  business_type_ar: string;
  business_type_en: string;
  business_type_fr: string;
  cuisine_tags: string[];
  delivery: boolean;
  pickup: boolean;
  open_now: boolean;
  paused: boolean;
  orderable: boolean;
  place_slug: string | null;
  place_ar: string | null;
  place_en: string | null;
  place_fr: string | null;
  /** A demo shop (§39.12, site_vendor_card): labelled Demo wherever its card shows. */
  demo?: boolean;
};

export type SitePlacePage = {
  place: Names & {
    id: string;
    slug: string;
    kind: string;
    district_code: string;
    lat: number;
    lon: number;
    district_ar: string | null;
    district_en: string | null;
    district_fr: string | null;
  };
  vendors: VendorCard[];
  fees: Fees;
  rate: number | null;
};

export type SiteCuisinePage = {
  cuisine: Names & { tag: string };
  vendors: VendorCard[];
  rate: number | null;
};

export type MenuItem = Names & {
  description: string | null;
  price_usd: number;
  per_kg: boolean;
  vegetarian: boolean;
  vegan: boolean;
  spicy: number;
  pork: boolean;
  alcohol: boolean;
  allergens: string[] | null;
};
export type MenuSection = Names & { items: MenuItem[] };

export type SiteVendorPage = {
  vendor: VendorCard & {
    delivery_radius_km: number | null;
    paused_until: string | null;
    cash_currencies: string[] | null;
    updated_at: string;
    cuisines: (Names & { tag: string })[];
    /** A demo shop (§39.12, site_vendor_demo): labelled Demo and never indexed. */
    demo?: boolean;
  };
  hours: { weekday: number; opens: string; closes: string }[];
  sections: MenuSection[];
  fees: Fees;
  rate: number | null;
};

// ---- "Not on Alo King yet" (DECISIONS §39.3, migration 20261014170000) ---------------------------------------------------
/** A seed merchant that is not on Alo King yet: public fields only. No price, rating, photo, phone or coordinates. */
export type UnclaimedCard = Names & {
  slug: string;
  branch_label: string | null;
  business_type: string;
  business_type_ar: string | null;
  business_type_en: string | null;
  business_type_fr: string | null;
  cuisine_tags: string[];
  cuisines: (Names & { tag: string })[];
  place_slug: string | null;
  place_ar: string | null;
  place_en: string | null;
  place_fr: string | null;
  /** The seed file's opening-hours text, unconfirmed ("Monday: 8 AM to 8 PM | …"). */
  hours_seed: string | null;
  /** How many items the draft menu has, and the first few names. */
  menu_items: number;
  menu_preview: Names[];
};
export type UnclaimedList = {
  total: number;
  page: number;
  page_size: number;
  vendors: UnclaimedCard[];
};
export type UnclaimedVendorPage = {
  vendor: UnclaimedCard & { vendor_id: string };
  sections: (Names & { items: (Names & { description: string | null })[] })[];
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const names = (r: Record<string, unknown>): Names => ({
  name_ar: str(r.name_ar),
  name_en: str(r.name_en),
  name_fr: str(r.name_fr),
});
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Checks one card from the database: a card without a usable slug or name is dropped, missing lists become empty. */
export function toUnclaimedCard(raw: unknown): UnclaimedCard | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = names(r);
  if (typeof r.slug !== "string" || !SLUG.test(r.slug) || !(n.name_ar || n.name_en || n.name_fr))
    return null;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    ...n,
    slug: r.slug,
    branch_label: str(r.branch_label),
    business_type: typeof r.business_type === "string" ? r.business_type : "other_food",
    business_type_ar: str(r.business_type_ar),
    business_type_en: str(r.business_type_en),
    business_type_fr: str(r.business_type_fr),
    cuisine_tags: arr(r.cuisine_tags).filter((t): t is string => typeof t === "string"),
    cuisines: arr(r.cuisines)
      .filter((c) => c && typeof c === "object" && typeof (c as { tag?: unknown }).tag === "string")
      .map((c) => ({ tag: (c as { tag: string }).tag, ...names(c as Record<string, unknown>) })),
    place_slug: typeof r.place_slug === "string" && SLUG.test(r.place_slug) ? r.place_slug : null,
    place_ar: str(r.place_ar),
    place_en: str(r.place_en),
    place_fr: str(r.place_fr),
    hours_seed: str(r.hours_seed),
    menu_items: Number.isFinite(Number(r.menu_items)) ? Number(r.menu_items) : 0,
    menu_preview: arr(r.menu_preview)
      .filter((x) => x && typeof x === "object")
      .map((x) => names(x as Record<string, unknown>))
      .filter((x) => x.name_ar || x.name_en || x.name_fr),
  };
}

export const EMPTY_UNCLAIMED: UnclaimedList = { total: 0, page: 1, page_size: 24, vendors: [] };

/** A page of the list; an empty list when the call fails (the orderable list above it still shows). */
export function toUnclaimedList(raw: unknown): UnclaimedList {
  if (!raw || typeof raw !== "object") return EMPTY_UNCLAIMED;
  const r = raw as Record<string, unknown>;
  const vendors = (Array.isArray(r.vendors) ? r.vendors : [])
    .map(toUnclaimedCard)
    .filter((v): v is UnclaimedCard => v !== null);
  const size = Number(r.page_size) > 0 ? Number(r.page_size) : EMPTY_UNCLAIMED.page_size;
  return {
    total: Math.max(Number(r.total) || 0, vendors.length),
    page: Number(r.page) >= 1 ? Number(r.page) : 1,
    page_size: size,
    vendors,
  };
}

export function toUnclaimedVendorPage(raw: unknown): UnclaimedVendorPage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const card = toUnclaimedCard(r.vendor);
  const id = (r.vendor as Record<string, unknown> | null)?.vendor_id;
  if (!card || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const sections = (Array.isArray(r.sections) ? r.sections : [])
    .filter((s) => s && typeof s === "object")
    .map((s) => {
      const x = s as Record<string, unknown>;
      const items = (Array.isArray(x.items) ? x.items : [])
        .filter((i) => i && typeof i === "object")
        .map((i) => ({
          ...names(i as Record<string, unknown>),
          description: str((i as Record<string, unknown>).description),
        }))
        .filter((i) => i.name_ar || i.name_en || i.name_fr);
      return { ...names(x), items };
    })
    .filter((s) => s.items.length > 0);
  return { vendor: { ...card, vendor_id: id }, sections };
}

export const getPlaceUnclaimed = async (slug: string, page = 1) =>
  toUnclaimedList(await rpc("site_place_unclaimed", { p_slug: slug, p_page: page }));
export const getCuisineUnclaimed = async (tag: string, page = 1) =>
  toUnclaimedList(await rpc("site_cuisine_unclaimed", { p_tag: tag, p_page: page }));
export const getVendorUnclaimed = async (slug: string) =>
  toUnclaimedVendorPage(await rpc("site_vendor_unclaimed", { p_slug: slug }));

export type PublicTrack = {
  code: string;
  status: string;
  fulfilment: "delivery" | "pickup";
  vendor_ar: string | null;
  vendor_en: string | null;
  vendor_fr: string | null;
  total_usd: number;
  total_lbp: number;
  usd_lbp_rate: number;
  estimated: boolean;
  eta: { min?: number; max?: number } | null;
  driver_assigned: boolean;
  area_ar: string | null;
  area_en: string | null;
  area_fr: string | null;
  placed_at: string | null;
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  expires_at: string;
};

export const EMPTY_OVERVIEW: SiteOverview = {
  places: [],
  cuisines: [],
  merchants: 0,
  fees: { min_usd: null, max_usd: null, max_km: null },
  order_fee_usd: null,
  order_fee_free_days: null,
  rate: null,
  rate_at: null,
};

export const getOverview = async (): Promise<SiteOverview> =>
  (await rpc<SiteOverview>("site_overview")) ?? EMPTY_OVERVIEW;
export const getPlace = (slug: string) => rpc<SitePlacePage>("site_place", { p_slug: slug });
export const getCuisine = (tag: string) => rpc<SiteCuisinePage>("site_cuisine", { p_tag: tag });
export const getVendorPage = (slug: string) => rpc<SiteVendorPage>("site_vendor", { p_slug: slug });
export const getVendorSlugs = async () =>
  (await rpc<{ slug: string; updated_at: string }[]>("site_vendor_slugs")) ?? [];
export const getTrack = (token: string) =>
  rpc<PublicTrack>("order_track_public", { p_token: token });

export type BusinessTypeRow = Names & { business_type: string };
/** The kinds of business a new registration can choose (public reference data, in the owner's language). */
export const getBusinessTypes = async (): Promise<BusinessTypeRow[]> =>
  (await select<BusinessTypeRow>(
    "business_type_labels",
    "select=business_type,name_ar,name_en,name_fr&order=sort_order",
  )) ?? [];

// ---- The "Where we deliver" map (DECISIONS §39.11, migration 20261015090000) ----------------------------------------------
/** Per place that is on: shops on Alo King and shops not on Alo King yet that have their home there. */
export type DeliveryMapData = {
  places: { slug: string; shops: number; unclaimed: number }[];
  unclaimed_total: number;
};
export const EMPTY_DELIVERY_MAP: DeliveryMapData = { places: [], unclaimed_total: 0 };

/** Checks the map counts: rows without a usable slug are dropped, counts default to 0. */
export function toDeliveryMap(raw: unknown): DeliveryMapData {
  if (!raw || typeof raw !== "object") return EMPTY_DELIVERY_MAP;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) =>
    Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0;
  return {
    places: (Array.isArray(r.places) ? r.places : [])
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .filter((p) => typeof p.slug === "string" && SLUG.test(p.slug))
      .map((p) => ({ slug: p.slug as string, shops: n(p.shops), unclaimed: n(p.unclaimed) })),
    unclaimed_total: n(r.unclaimed_total),
  };
}
export const getDeliveryMap = async () => toDeliveryMap(await rpc("site_delivery_map"));
/** The "Not on Alo King yet" shops based in one village (the map's panel). */
export const getVillageUnclaimed = async (slug: string) =>
  toUnclaimedList(await rpc("site_village_unclaimed", { p_slug: slug }));

// ---- Item pages and photo credits (DECISIONS §39.15.7, spec §3.4 #24; migration 20261016160000) ---------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export type PhotoCredit = {
  credit: string | null;
  license: string | null;
  source_url: string | null;
};
export type ItemOption = Names & { price_usd: number };
export type ItemOptionGroup = Names & { min: number; max: number; options: ItemOption[] };
export type ItemNutrition = {
  kcal: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  status: "estimated" | "merchant_verified";
};
export type GoesWell = Names & { id: string; price_usd: number; per_kg: boolean; photo: boolean };

export type SiteItemPage = {
  item: Names & {
    id: string;
    description: string | null;
    price_usd: number;
    per_kg: boolean;
    est_weight_kg: number | null;
    /** Orderable now (the item, its shop and the hours), as the server decided. */
    available: boolean;
    vegetarian: boolean;
    vegan: boolean;
    spicy: number | null;
    pork: boolean;
    alcohol: boolean;
    photo: boolean;
    photo_source: "merchant" | "merchant_site" | "packshot" | "illustrative" | null;
    /** Null for the shop's own photo: every other photo carries its author and license (§38.1). */
    credit: PhotoCredit | null;
  };
  vendor: Names & {
    slug: string;
    place_slug: string | null;
    place_ar: string | null;
    place_en: string | null;
    place_fr: string | null;
    orderable: boolean;
    paused: boolean;
    open_now: boolean;
    demo: boolean;
    public_page: boolean;
    /** The shop has its own page to link to (public_page, or a demo shop's page); otherwise it is named, not linked. */
    has_page: boolean;
  };
  nutrition: ItemNutrition | null;
  /** Only what the shop declared; null = not declared, which is never shown as "none" or "safe" (§32.3, §38.3). */
  allergens: string[] | null;
  options: ItemOptionGroup[];
  goes_well: GoesWell | null;
  rate: number | null;
};

const num = (v: unknown): number | null =>
  v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
/** A link the page may render: http(s) only, so a stored value can never become a script URL. */
export const safeUrl = (v: unknown): string | null =>
  typeof v === "string" && /^https?:\/\/[^\s"<>]+$/i.test(v.trim()) ? v.trim() : null;
const PHOTO_SOURCES = ["merchant", "merchant_site", "packshot", "illustrative"] as const;

function toCredit(v: unknown): PhotoCredit | null {
  const c = obj(v);
  return c
    ? { credit: str(c.credit), license: str(c.license), source_url: safeUrl(c.source_url) }
    : null;
}

/** Checks site_item's answer: an item without a valid id, a price or a shop is dropped; missing lists become empty. */
export function toItemPage(raw: unknown): SiteItemPage | null {
  const r = obj(raw);
  const i = obj(r?.item);
  const v = obj(r?.vendor);
  const price = num(i?.price_usd);
  if (!r || !i || !v || !isUuid(i.id) || price === null) return null;
  if (typeof v.slug !== "string" || !SLUG.test(v.slug)) return null;
  const n = names(i);
  if (!(n.name_ar || n.name_en || n.name_fr)) return null;
  const nu = obj(r.nutrition);
  const kcal = num(nu?.kcal);
  const w = obj(r.goes_well);
  const wPrice = num(w?.price_usd);
  const source = PHOTO_SOURCES.find((s) => s === i.photo_source) ?? null;
  return {
    item: {
      ...n,
      id: i.id.toLowerCase(),
      description: str(i.description),
      price_usd: price,
      per_kg: i.per_kg === true,
      est_weight_kg: num(i.est_weight_kg),
      available: i.available === true,
      vegetarian: i.vegetarian === true,
      vegan: i.vegan === true,
      spicy: num(i.spicy),
      pork: i.pork === true,
      alcohol: i.alcohol === true,
      photo: i.photo === true,
      photo_source: i.photo === true ? source : null,
      credit: i.photo === true ? toCredit(i.credit) : null,
    },
    vendor: {
      ...names(v),
      slug: v.slug,
      place_slug: typeof v.place_slug === "string" && SLUG.test(v.place_slug) ? v.place_slug : null,
      place_ar: str(v.place_ar),
      place_en: str(v.place_en),
      place_fr: str(v.place_fr),
      orderable: v.orderable === true,
      paused: v.paused === true,
      open_now: v.open_now === true,
      demo: v.demo === true,
      public_page: v.public_page === true,
      has_page: v.has_page === true,
    },
    nutrition:
      nu && kcal !== null && (nu.status === "estimated" || nu.status === "merchant_verified")
        ? {
            kcal,
            protein_g: num(nu.protein_g),
            carbs_g: num(nu.carbs_g),
            fat_g: num(nu.fat_g),
            status: nu.status,
          }
        : null,
    allergens: Array.isArray(r.allergens)
      ? r.allergens.filter((a): a is string => typeof a === "string" && /^[a-z_]+$/.test(a))
      : null,
    options: (Array.isArray(r.options) ? r.options : [])
      .map(obj)
      .filter((g): g is Record<string, unknown> => g !== null)
      .map((g) => ({
        ...names(g),
        min: Math.max(0, num(g.min) ?? 0),
        max: Math.max(1, num(g.max) ?? 1),
        options: (Array.isArray(g.options) ? g.options : [])
          .map(obj)
          .filter((o): o is Record<string, unknown> => o !== null)
          .map((o) => ({ ...names(o), price_usd: num(o.price_usd) ?? 0 }))
          .filter((o) => o.name_ar || o.name_en || o.name_fr),
      }))
      .filter((g) => g.options.length > 0),
    goes_well:
      w && isUuid(w.id) && wPrice !== null
        ? {
            ...names(w),
            id: w.id.toLowerCase(),
            price_usd: wPrice,
            per_kg: w.per_kg === true,
            photo: w.photo === true,
          }
        : null,
    rate: num(r.rate),
  };
}

/** One item's page; null (the page is a 404) for an id that is not a UUID, without asking the database. */
export const getItem = async (id: string): Promise<SiteItemPage | null> =>
  isUuid(id) ? toItemPage(await rpc("site_item", { p_item_id: id.toLowerCase() })) : null;

export type CreditPhoto = {
  kind: "item" | "cover";
  item_id: string | null;
  vendor_slug: string;
  vendor_ar: string | null;
  vendor_en: string | null;
  vendor_fr: string | null;
  item_ar: string | null;
  item_en: string | null;
  item_fr: string | null;
  source: string | null;
  /** The shop has its own page to link to; otherwise the credits page names it without a link. */
  has_page: boolean;
} & PhotoCredit;
export type SiteCredits = { total: number; page: number; page_size: number; photos: CreditPhoto[] };
export const EMPTY_CREDITS: SiteCredits = { total: 0, page: 1, page_size: 100, photos: [] };

/** Checks a page of site_credits: rows without a shop are dropped, an item row needs its item id. */
export function toCredits(raw: unknown): SiteCredits {
  const r = obj(raw);
  if (!r) return EMPTY_CREDITS;
  const photos = (Array.isArray(r.photos) ? r.photos : [])
    .map(obj)
    .filter((p): p is Record<string, unknown> => p !== null)
    .filter((p) => typeof p.vendor_slug === "string" && SLUG.test(p.vendor_slug))
    .filter((p) => p.kind === "cover" || (p.kind === "item" && isUuid(p.item_id)))
    .map((p): CreditPhoto => ({
      kind: p.kind === "cover" ? "cover" : "item",
      item_id: p.kind === "item" ? (p.item_id as string).toLowerCase() : null,
      vendor_slug: p.vendor_slug as string,
      vendor_ar: str(p.vendor_ar),
      vendor_en: str(p.vendor_en),
      vendor_fr: str(p.vendor_fr),
      item_ar: str(p.item_ar),
      item_en: str(p.item_en),
      item_fr: str(p.item_fr),
      source: str(p.source),
      has_page: p.has_page === true,
      ...toCredit(p)!,
    }));
  const size = (num(r.page_size) ?? 0) > 0 ? (num(r.page_size) as number) : EMPTY_CREDITS.page_size;
  return {
    total: Math.max(Math.floor(num(r.total) ?? 0), photos.length),
    page: (num(r.page) ?? 0) >= 1 ? Math.floor(num(r.page) as number) : 1,
    page_size: size,
    photos,
  };
}
export const getCredits = async (page = 1) =>
  toCredits(await rpc("site_credits", { p_page: Math.max(1, Math.floor(page)) }));

/** A demo shop's page (§39.12): the shop page's data, always marked demo. Null for any other slug. */
export const getVendorDemo = async (slug: string): Promise<SiteVendorPage | null> => {
  const d = await rpc<SiteVendorPage>("site_vendor_demo", { p_slug: slug });
  return d?.vendor ? { ...d, vendor: { ...d.vendor, demo: true } } : null;
};
