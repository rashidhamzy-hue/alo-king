// The Food pages (session LV1; docs/DECISIONS.md, "Listings before they sign, 17 November 2026"): places in the Chouf that are listed before they
// have signed. A place shows its name, its kind, its village, its distance from the hub and a map link, and the line that it is not on Alo King yet.
// Never a phone, a rating, a review count, a menu, hours, a photo or a price: the data has none, and these helpers invent none.
// Sorting is by distance or name only (invariant 14). Nothing here is read from a prompt or typed in: every value comes from web_food_list and web_food_place.
import type { Listing } from "@ak/commerce/index";
import { t, type Key, type Lang } from "./i18n";

export const PAGE_SIZE = 20;
const KINDS = ["restaurant", "cafe", "bakery", "sweets", "catering", "butcher"];

/** The kind in the page's language; a kind the words do not know yet is shown as it is, capitalised. */
export function kindLabel(lang: Lang, kind: string): string {
  return KINDS.includes(kind) ? t(lang, `kind_${kind}` as Key) : kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, " ");
}

export interface FoodQuery { kind: string; village: string; sort: "distance" | "name"; page: number }

/** What the address says, made safe: a kind is lower-case letters and underscores, a village is plain text of a sensible length, a sort is distance or name, a page is a small whole number. */
export function foodQuery(p: URLSearchParams): FoodQuery {
  const kind = (p.get("kind") ?? "").trim();
  const village = (p.get("village") ?? "").trim();
  const page = Number(p.get("page") ?? "1");
  return {
    kind: /^[a-z][a-z_]{0,29}$/.test(kind) ? kind : "",
    village: village.length > 0 && village.length <= 60 && !/[\u0000-\u001f\u007f]/.test(village) ? village : "",
    sort: p.get("sort") === "name" ? "name" : "distance",
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

/** The address of the Food page for a set of choices; a default (distance, page 1, nothing chosen) is left out, so the plain address stays plain. */
export function foodHref(q: Partial<FoodQuery>): string {
  const u = new URLSearchParams();
  if (q.kind) u.set("kind", q.kind);
  if (q.village) u.set("village", q.village);
  if (q.sort === "name") u.set("sort", "name");
  if (q.page && q.page > 1) u.set("page", String(q.page));
  const s = u.toString();
  return s ? `/food?${s}` : "/food";
}

export const placeHref = (id: string) => `/food/${encodeURIComponent(id)}`;
/** A listing id is one word of at most 120 characters; anything else is not one and never reaches the database. */
export const validListingId = (id: string) => id.length > 0 && id.length <= 120 && !/[\s\u0000-\u001f\u007f]/.test(id);

export const kmText = (lang: Lang, km: number | string) => t(lang, "food_km", { km: Number(km).toFixed(1) });
/** The village in the page's language: Arabic where the village list knows it, otherwise as listed; "not listed" for none. */
export const villageIn = (lang: Lang, l: Pick<Listing, "village" | "village_ar">): string => (l.village === null ? t(lang, "food_village_none") : lang === "ar" && l.village_ar ? l.village_ar : l.village);

/** Our WhatsApp with "Claim <listing_id>" already typed. The customer-line turn reads it by code (no model). Null until a person has set the chat's address. */
export const claimLink = (chat: string | null | undefined, id: string): string | null => (chat ? `${chat.replace(/\?.*$/, "")}?text=${encodeURIComponent(`Claim ${id}`)}` : null);
