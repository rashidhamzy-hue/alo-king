// Typed access to what the public pages read (the site_* functions of migration 20261013090100).
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
