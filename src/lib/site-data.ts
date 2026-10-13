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
