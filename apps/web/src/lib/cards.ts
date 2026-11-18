// WEB4a: a catalogue card (the database's) into what the reference's card draws (components/ref/Product.tsx). Words only: every figure is
// the database's. What a price is for (0244): "per kg", "per pack of about X g", or "per pack, weight not confirmed yet" (never a guess).
import type { CatalogCard, PriceFor } from "@ak/commerce/index";
import type { CardData } from "../components/ref/Product";
import { pictureUrl, type WebEnv } from "./db";
import { toneOf } from "./category-photos";
import { nameIn, t, unitLabel, type Lang } from "./i18n";

export function priceForText(lang: Lang, pf: PriceFor | null | undefined): string | null {
  if (!pf) return null;
  if (pf.per === "kg") return t(lang, "w4_per_kg");
  return pf.about_g ? t(lang, "w4_per_pack_about", { g: Math.round(pf.about_g) }) : t(lang, "w4_per_pack");
}

/** "by weight (pre-pack)" is not shown as a unit: what the price is for says it, in words. */
const shownUnit = (lang: Lang, c: Pick<CatalogCard, "sell_unit" | "price_for">) => (c.price_for ? "" : unitLabel(lang, c.sell_unit));

export function toCard(lang: Lang, env: WebEnv, c: CatalogCard, code = ""): CardData {
  const name = nameIn(lang, c.name_en, c.name_ar);
  const aisle = c.category_code || code;
  return {
    sku: c.sku, name, unit: shownUnit(lang, c), price: Number(c.price_usd), inStock: !!c.in_stock, comingSoon: !!c.coming_soon,
    img: c.picture ? pictureUrl(env, c.picture.path, 400) : null, imgAlt: name, tone: toneOf(aisle), code: aisle, per: priceForText(lang, c.price_for),
  };
}
