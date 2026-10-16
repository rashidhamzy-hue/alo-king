// An item's public page (DECISIONS §39.15.7, spec §3.4 #24): the WhatsApp catalogue's `link` for every product. Pure
// helpers for the route and its head; unit-tested in item.test.ts.
import type { Copy } from "@/content";
import { SUPABASE_URL } from "./config";
import { buildHead, fmt, localePath, pickName, usd, type RequestInfo, type SiteLang } from "./site";
import type { ItemOptionGroup, SiteItemPage } from "./site-data";

/** The code the bot reads from the pre-filled message to add the item (`i-<item id>`). */
export const itemCode = (id: string) => `i-${id}`;

/**
 * The item's photo through the catalogue image route: a redirect to a short-lived signed URL of the private bucket, the
 * same image Meta shows. Only for an item that has a photo.
 */
export const itemImageUrl = (id: string) =>
  `${SUPABASE_URL}/functions/v1/dispatch?route=catalog-image&i=${encodeURIComponent(id)}`;

/** "Hi Alo King, please add <item> from <shop> (i-<id>)": the message the Add in WhatsApp button pre-fills. */
export function itemWaText(t: Copy, d: SiteItemPage, lang: SiteLang): string {
  return fmt(t.wa.item, {
    item: pickName(d.item, "name", lang),
    vendor: pickName(d.vendor, "name", lang),
    code: itemCode(d.item.id),
  });
}

/** The shop takes this item now: the server's answer for the item, and the shop switched on and not paused. */
export const itemCanOrder = (d: SiteItemPage) =>
  d.item.available && d.vendor.orderable && !d.vendor.paused;

/** A choice group's rule: "Choose 1", "Choose 1 to 2", "Choose up to 3", "Optional". Never more than it has options. */
export function optionRule(g: Pick<ItemOptionGroup, "min" | "max" | "options">, t: Copy): string {
  const n = g.options.length;
  const max = Math.max(1, Math.min(g.max, n || g.max));
  const min = Math.min(g.min, max);
  if (min > 0)
    return min === max ? fmt(t.item.chooseN, { n: min }) : fmt(t.item.chooseRange, { min, max });
  return max <= 1 ? t.item.optional : fmt(t.item.upTo, { max });
}

/** The allergens the shop declared, in the page's words; null when it declared none (nothing is said then, §38.3). */
export function declaredAllergens(d: Pick<SiteItemPage, "allergens">, t: Copy): string[] | null {
  if (!d.allergens || d.allergens.length === 0) return null;
  return d.allergens.map((a) => t.vendor.allergenNames[a] ?? a.replace(/_/g, " "));
}

/** "Author · License" of a photo that is not the shop's own; empty when neither is known. */
export const creditText = (c: { credit: string | null; license: string | null } | null) =>
  c ? [c.credit, c.license].filter(Boolean).join(" · ") : "";

const DIET = {
  vegan: "https://schema.org/VeganDiet",
  vegetarian: "https://schema.org/VegetarianDiet",
};

/** schema.org MenuItem with its Offer: only what the page shows. */
export function itemLd(d: SiteItemPage, lang: SiteLang, url: string) {
  const i = d.item;
  const price = i.price_usd.toFixed(2);
  return {
    "@context": "https://schema.org",
    "@type": "MenuItem",
    name: pickName(i, "name", lang),
    description: i.description || undefined,
    url,
    image: i.photo ? itemImageUrl(i.id) : undefined,
    suitableForDiet: i.vegan ? DIET.vegan : i.vegetarian ? DIET.vegetarian : undefined,
    offers: {
      "@type": "Offer",
      price,
      priceCurrency: "USD",
      availability: `https://schema.org/${itemCanOrder(d) ? "InStock" : "OutOfStock"}`,
      url,
      ...(i.per_kg
        ? {
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price,
              priceCurrency: "USD",
              unitCode: "KGM",
            },
          }
        : {}),
    },
  };
}

/**
 * The head of an item page: "<item> · <shop>". A demo shop's item (§39.12) is never indexed and carries no structured
 * data; any other item carries its MenuItem and Offer, then `extraLd` (the breadcrumbs).
 */
export function itemHead(
  d: SiteItemPage,
  lang: SiteLang,
  t: Copy,
  info: RequestInfo,
  extraLd: unknown[] = [],
) {
  const item = pickName(d.item, "name", lang);
  const vendor = pickName(d.vendor, "name", lang);
  const place = pickName(d.vendor, "place", lang);
  const path = `/i/${d.item.id}`;
  const url = `${info.origin}${localePath(lang, path)}`;
  const demo = d.vendor.demo || !d.vendor.public_page;
  return buildHead({
    lang,
    path,
    title: fmt(t.item.seoTitle, { item, vendor }),
    description: fmt(t.item.seoDescription, {
      item,
      vendor,
      where: place ? fmt(t.vendor.where, { place }) : "",
      price: `${usd(d.item.price_usd)}${d.item.per_kg ? ` ${t.common.perKg}` : ""}`,
    }),
    info,
    noindex: demo,
    image: d.item.photo ? itemImageUrl(d.item.id) : undefined,
    jsonLd: demo ? [] : [itemLd(d, lang, url), ...extraLd],
  });
}
