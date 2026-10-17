// Explore (session 5g part B): /<lang>/e?t=<token>, opened from the chat's "Explore" button. Every shop that delivers to
// the customer's point, with its cover, fee, ETA and distance (public.web_explore reads shop_place_routes: zero routing
// calls), categories, search, popular dishes, new shops, and "Not on Alo King yet" last. Infinite scroll asks for the next
// page with the same token.
import { rpc } from "./rest";
import type { Names, UnclaimedCard } from "./site-data";

export type ExploreShop = Names & {
  vendor_id: string;
  slug: string;
  cuisine_ar: string | null;
  cuisine_en: string | null;
  cuisine_fr: string | null;
  village_ar: string | null;
  village_en: string | null;
  village_fr: string | null;
  cover: boolean;
  demo: boolean;
  open_now: boolean;
  fee_usd: number | null;
  road_km: number | null;
  eta_min: number;
  eta_max: number;
};
export type ExploreDish = Names & {
  id: string;
  price_usd: number;
  slug: string;
  vendor_ar: string | null;
  vendor_en: string | null;
  vendor_fr: string | null;
};
export type ExploreCategory = Names & { key: string; emoji: string; shops: number };
export type ExplorePage =
  | { status: "expired" }
  | { status: "no_address"; lang?: string }
  /** The customer's place is not delivered to (yet): no shop list as if it were. */
  | { status: "outside"; lang?: string; place: Names | null }
  | {
      status: "ok";
      lang: "ar" | "en" | "fr";
      place: Names;
      /** Today's dated USD to LBP rate, for showing prices in both (§39.15.5). */
      rate: number | null;
      shops: ExploreShop[];
      next_offset: number | null;
      categories?: ExploreCategory[];
      new?: ExploreShop[];
      popular?: { by_sales: boolean; items: ExploreDish[] };
      unclaimed?: UnclaimedCard[];
    };

/** The search box's text as the server takes it: at most 60 characters, trimmed. */
export const exploreQuery = (q: unknown): string | undefined =>
  typeof q === "string" && q.trim() ? q.trim().slice(0, 60) : undefined;
/** A category key as the server takes it. */
export const exploreCategory = (c: unknown): string | undefined =>
  typeof c === "string" && /^[a-z][a-z_]{0,30}$/.test(c) ? c : undefined;

export async function getExplore(
  token: string,
  o: { q?: string; category?: string; offset?: number } = {},
): Promise<ExplorePage | null> {
  return rpc<ExplorePage>("web_explore", {
    p_token: token,
    p_q: o.q ?? null,
    p_category: o.category ?? null,
    p_offset: o.offset ?? 0,
  });
}
