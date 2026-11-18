// WEB4a: the reference's product card, rail and grid (its components/ak/ProductCard.tsx), rendered on the server, shared by the home page,
// the aisles, an aisle, the product page's "more in this aisle" and search. Every figure is the database's: the price, what the price is for
// (0244: per kg, or per pack of about X g, or "weight not confirmed yet"), stock, "coming soon" (SELL1).
// The founder's correction (stage 1): a card with no photo shows its aisle's icon on the tone field, not the name a second time.
// "Add to basket" is a button of the page's one form (AddForm.astro, id "ak-add"): it posts "sku:price" with no script and comes back.
import {
  Apple, Baby, Bath, Beef, CookingPot, Cookie, Croissant, CupSoda, Milk, Package, Plus, Sandwich, Snowflake, Soup, SprayCan, Wheat,
  type LucideIcon,
} from "lucide-react";
import { t, type Lang } from "../../lib/i18n";
import type { Tone } from "../../lib/category-photos";
import { Price, cx } from "./ui";

export interface CardData {
  sku: string; name: string; unit: string; price: number; inStock: boolean; comingSoon: boolean; img: string | null; imgAlt: string; tone: Tone;
  /** the aisle (catalog_categories.code): its icon stands in for a missing photo */
  code: string;
  /** what the price is for, in words ("per kg", "per pack of about 500 g"); null for an item sold as a piece */
  per: string | null;
}

export const TONE_BG: Record<Tone, string> = {
  clay: "bg-tone-clay text-tone-clay-ink", sky: "bg-tone-sky text-tone-sky-ink", wheat: "bg-tone-wheat text-tone-wheat-ink", rose: "bg-tone-rose text-tone-rose-ink",
  ice: "bg-tone-ice text-tone-ice-ink", saffron: "bg-tone-saffron text-tone-saffron-ink", olive: "bg-tone-olive text-tone-olive-ink",
};
/** One icon per aisle (Lucide, ISC licence). An aisle not listed gets a plain pack. */
const AISLE_ICONS: Record<string, LucideIcon> = {
  fruits_vegetables: Apple, meat_poultry: Beef, deli_ready_meals: Sandwich, dairy_eggs: Milk, frozen_food: Snowflake, bakery: Croissant,
  water_drinks: CupSoda, breakfast_cereal: Wheat, snacks_sweets: Cookie, pantry_staples: Package, canned_jarred: Soup, cooking_baking: CookingPot,
  cleaning_household: SprayCan, personal_care: Bath, baby_pet: Baby,
};
export function AisleIcon({ code, className = "" }: { code: string; className?: string }) {
  const I = AISLE_ICONS[code] ?? Package;
  return <I className={className} strokeWidth={1.5} aria-hidden="true" />;
}

/** The picture, or the aisle's tone with its icon (never the name again: it is under the picture). */
export function ProductVisual({ p, big = false }: { p: Pick<CardData, "img" | "imgAlt" | "tone" | "code">; big?: boolean }) {
  return p.img
    ? <span className={cx("relative block aspect-square overflow-hidden bg-white", big ? "rounded-3xl" : "rounded-xl")}>
        <img src={p.img} alt={p.imgAlt} loading={big ? "eager" : "lazy"} decoding="async" className={cx("size-full object-contain", big ? "p-6" : "p-3")} />
      </span>
    : <span className={cx("relative grid aspect-square place-items-center overflow-hidden", big ? "rounded-3xl" : "rounded-xl", TONE_BG[p.tone])}>
        <span className="paper-grain absolute inset-0 opacity-50" aria-hidden="true" />
        <span className="absolute -end-[12%] -top-[12%] size-[62%] rounded-full bg-card/50" aria-hidden="true" />
        <AisleIcon code={p.code} className={cx("relative opacity-80", big ? "size-[42%]" : "size-[46%]")} />
      </span>;
}

export function ProductCard({ p, lang, as = "article" }: { p: CardData; lang: Lang; as?: "article" | "li" }) {
  const out = !p.inStock;
  const Tag = as;
  return (
    <Tag className="ak-product group relative flex list-none flex-col">
      <div className="relative">
        <a href={`/p/${encodeURIComponent(p.sku)}`} tabIndex={-1} aria-hidden="true" className="block rounded-xl no-underline transition group-hover:-translate-y-0.5">
          <span className={cx("block", (out || p.comingSoon) && "opacity-55 grayscale")}><ProductVisual p={p} /></span>
        </a>
        {(out || p.comingSoon) && (
          <span className="absolute start-2 top-2 rounded-full bg-ink px-2 py-0.5 text-[11px] font-bold text-paper">{t(lang, p.comingSoon ? "coming_soon" : "out_of_stock")}</span>
        )}
        {!out && !p.comingSoon && (
          <button type="submit" form="ak-add" name="sku" value={`${p.sku}:${p.price}`} aria-label={t(lang, "w4_add", { name: p.name })}
            className="press absolute bottom-2 end-2 grid size-11 place-items-center rounded-full bg-ink text-gold shadow-lift">
            <Plus className="size-5" strokeWidth={2.6} aria-hidden="true" />
          </button>
        )}
      </div>
      <a href={`/p/${encodeURIComponent(p.sku)}`} className="flex flex-1 flex-col rounded-xl px-0.5 pb-1 pt-1.5 text-foreground no-underline hover:[&_.nm]:underline">
        <span className="price"><Price value={p.price} className="text-[17px] font-bold" /></span>
        <span className="nm line-clamp-2 text-[13.5px] font-medium leading-snug">{p.name}</span>
        {(p.per || p.unit) && <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.per ?? p.unit}</span>}
      </a>
    </Tag>
  );
}

export function ProductRail({ items, lang }: { items: CardData[]; lang: Lang }) {
  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">
      {items.map((p) => <div key={p.sku} className="w-[42vw] max-w-44 shrink-0 snap-start sm:w-44"><ProductCard p={p} lang={lang} /></div>)}
    </div>
  );
}
export function ProductGrid({ items, lang }: { items: CardData[]; lang: Lang }) {
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-5 p-0 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {items.map((p) => <ProductCard key={p.sku} p={p} lang={lang} as="li" />)}
    </ul>
  );
}
