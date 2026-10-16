import { Link } from "@tanstack/react-router";
import { Store } from "lucide-react";
import { Contours } from "@/design/Contours";
import { fmt, iso, lbpAt, pickName, usd, type SiteLang } from "@/lib/site";
import {
  creditText,
  declaredAllergens,
  itemCanOrder,
  itemImageUrl,
  itemWaText,
  optionRule,
} from "@/lib/item";
import type { ItemOptionGroup, SiteItemPage } from "@/lib/site-data";
import { Breadcrumbs } from "./Breadcrumbs";
import { useSite } from "./context";
import { OrderButton } from "./OrderButton";

const LOCALE: Record<SiteLang, string> = { ar: "en-US", en: "en-US", fr: "fr-FR" };
const num = (n: number, lang: SiteLang, digits = 1) =>
  n.toLocaleString(LOCALE[lang], { maximumFractionDigits: digits });

/** A price as the shop page shows it: USD, "per kg" when sold by weight, and LBP at the rate of the day. */
function Price({
  amount,
  perKg,
  rate,
  big = false,
}: {
  amount: number;
  perKg: boolean;
  rate: number | null;
  big?: boolean;
}) {
  const { t, lang } = useSite();
  return (
    <span className="flex flex-wrap items-baseline gap-x-3">
      <span className={`ak-num font-extrabold ${big ? "text-3xl" : "text-base"}`}>
        <bdi>{usd(amount)}</bdi>
        {perKg && (
          <span className={`font-medium text-tone-mute ${big ? "text-base" : "text-xs"}`}>
            {" "}
            {t.common.perKg}
          </span>
        )}
      </span>
      {rate ? (
        <span className={`ak-num text-tone-mute ${big ? "" : "text-xs"}`}>
          <bdi>{lbpAt(amount, rate, lang)}</bdi> {t.common.lbp}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Nutrition and allergens (DECISIONS §32.3, §38.3). Energy and macros only as the shop gave them or the dish library
 * estimated them, labelled which. Allergens only as the shop declared them: nothing is said when it declared none (never
 * "none" or "safe"). The shared-kitchen note always shows.
 */
export function ItemFacts({ d }: { d: Pick<SiteItemPage, "nutrition" | "allergens"> }) {
  const { t, lang } = useSite();
  const n = d.nutrition;
  const allergens = declaredAllergens(d, t);
  const estimated = n?.status !== "merchant_verified";
  const grams = (x: number | null) => (x === null ? null : fmt(t.item.grams, { n: num(x, lang) }));
  const rows = n
    ? [
        [t.item.kcal, fmt(t.item.kcalValue, { n: num(n.kcal, lang, 0) })],
        [t.item.protein, grams(n.protein_g)],
        [t.item.carbs, grams(n.carbs_g)],
        [t.item.fat, grams(n.fat_g)],
      ].filter((r): r is [string, string] => r[1] !== null)
    : [];
  return (
    <>
      {n && (
        <section className="ak-card p-5" aria-labelledby="nutrition-title">
          <h2 id="nutrition-title" className="ak-h3">
            {estimated ? t.item.nutrition : t.item.nutritionVerified}
          </h2>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-tone-mute">
            <span className="ak-chip !px-2 !py-0.5 text-xs">
              {estimated ? t.item.estimated : t.item.fromShop}
            </span>
            {estimated ? t.item.estimatedNote : t.item.verifiedNote}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-sm text-tone-mute">{k}</dt>
                <dd className="ak-num text-lg font-extrabold">
                  <bdi>{v}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {allergens && (
        <section className="ak-card p-5" aria-labelledby="allergens-title">
          <h2 id="allergens-title" className="ak-h3">
            {t.item.allergens}
          </h2>
          <p className="mt-3 font-semibold">
            {fmt(t.item.contains, { list: allergens.join(lang === "ar" ? "، " : ", ") })}
          </p>
          <p className="mt-1 text-sm text-tone-mute">{t.item.declared}</p>
        </section>
      )}
      {/* DECISIONS §38.3: the shared-kitchen disclaimer appears wherever a dish is shown. */}
      <p className="text-sm text-tone-mute">{t.vendor.kitchenNote}</p>
    </>
  );
}

/** The item's choices and extras, each group with its rule and each paid option with its price. */
export function ItemExtras({ groups }: { groups: ItemOptionGroup[] }) {
  const { t, lang } = useSite();
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby="extras-title">
      <h2 id="extras-title" className="ak-h2">
        {t.item.extras}
      </h2>
      <div className="mt-6 space-y-4">
        {groups.map((g, k) => (
          <div key={k} className="ak-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="ak-h3" dir="auto">
                {pickName(g, "name", lang)}
              </h3>
              <span className="ak-chip">{optionRule(g, t)}</span>
            </div>
            <ul className="mt-3 divide-y divide-[var(--tone-line-soft)]">
              {g.options.map((o, j) => (
                <li key={j} className="flex items-baseline justify-between gap-4 py-2.5">
                  <span dir="auto" className="min-w-0 break-words">
                    {pickName(o, "name", lang)}
                  </span>
                  {o.price_usd > 0 && (
                    <span className="ak-num shrink-0 font-semibold">
                      <bdi>{fmt(t.item.plus, { price: usd(o.price_usd) })}</bdi>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * An item's public page (DECISIONS §39.15.7, spec §3.4 #24): the WhatsApp catalogue's link for the product. The photo
 * with its credit, the shop and its village, the menu's text, the price in USD and LBP, the extras, one "Goes well
 * with", nutrition and declared allergens, and Add in WhatsApp, which returns to the chat with the item's code. The
 * server prices the basket in the chat.
 */
export function ItemView({ d }: { d: SiteItemPage }) {
  const { t, lang } = useSite();
  const i = d.item;
  const v = d.vendor;
  const name = pickName(i, "name", lang);
  const arName = lang !== "ar" && i.name_ar && i.name_ar.trim() !== name ? i.name_ar.trim() : null;
  const shop = pickName(v, "name", lang);
  const place = pickName(v, "place", lang);
  const canOrder = itemCanOrder(d);
  const credit = creditText(i.credit);
  const illustrative = i.photo_source === "illustrative";
  const w = d.goes_well;
  const hasMain = d.options.length > 0 || w !== null;
  return (
    <>
      <section className="tone-night ak-contours ak-glow ak-section !pb-12 !pt-8 sm:!pt-12">
        <Contours />
        <div
          className={`ak-container ${i.photo ? "grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12" : ""}`}
        >
          <div className="min-w-0">
            <Breadcrumbs
              items={[
                { label: "", to: "/$lang" },
                { label: t.common.places, to: "/$lang/places" },
                { label: name },
              ]}
            />
            <p className="ak-eyebrow mt-6 flex-wrap text-gold">
              <Link
                to="/$lang/m/$slug"
                params={{ lang, slug: v.slug }}
                className="underline underline-offset-4"
              >
                {shop}
              </Link>
              {place && (
                <>
                  <span aria-hidden="true">·</span>
                  {v.place_slug ? (
                    <Link
                      to="/$lang/places/$slug"
                      params={{ lang, slug: v.place_slug }}
                      className="underline underline-offset-4"
                    >
                      {place}
                    </Link>
                  ) : (
                    <span>{place}</span>
                  )}
                </>
              )}
            </p>
            <h1 className="ak-h1 mt-3 max-w-4xl break-words">{name}</h1>
            {/* The Arabic name under the title, on the page's side, right to left inside its own isolate. */}
            {arName && (
              <p className="mt-3 text-xl font-bold text-tone-mute">
                <bdi lang="ar" dir="rtl">
                  {arName}
                </bdi>
              </p>
            )}
            {i.description && (
              <p dir="auto" className="ak-lead mt-5 break-words">
                {i.description}
              </p>
            )}
            <Diet d={d} />
            <div className="mt-6">
              <Price amount={i.price_usd} perKg={i.per_kg} rate={d.rate} big />
              {i.per_kg && i.est_weight_kg ? (
                <p className="mt-1 text-sm text-tone-mute">
                  {fmt(t.item.estWeight, { kg: iso(num(i.est_weight_kg, lang, 3)) })}
                </p>
              ) : null}
              {d.rate ? (
                <p className="mt-1 text-xs text-tone-mute">
                  {fmt(t.common.lbpNote, { rate: Math.round(d.rate).toLocaleString("en-US") })}
                </p>
              ) : null}
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {canOrder ? (
                <OrderButton text={itemWaText(t, d, lang)} label={t.item.add} />
              ) : (
                <p className="ak-lead !mt-0 font-semibold">{t.item.unavailable}</p>
              )}
              {v.demo && <span className="ak-chip">{t.common.demo}</span>}
              {!v.paused && (
                <span className={`ak-chip ${v.open_now ? "ak-chip-gold" : ""}`}>
                  {v.open_now ? t.common.openNow : t.common.closed}
                </span>
              )}
            </div>
            {canOrder && <p className="mt-3 text-sm text-tone-mute">{t.item.addHelp}</p>}
          </div>
          {i.photo && (
            <figure className="order-first min-w-0 lg:order-none">
              <img
                src={itemImageUrl(i.id)}
                alt={name}
                width={800}
                height={800}
                fetchPriority="high"
                decoding="async"
                className="aspect-[4/3] w-full rounded-3xl bg-tone-surface object-cover lg:aspect-square"
              />
              {(credit || illustrative) && (
                <figcaption className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-tone-mute">
                  {illustrative && (
                    <span className="ak-chip !px-2 !py-0.5 text-xs">{t.item.illustrative}</span>
                  )}
                  {credit &&
                    (i.credit?.source_url ? (
                      <a
                        href={i.credit.source_url}
                        target="_blank"
                        rel="nofollow noopener noreferrer"
                        className="break-words underline underline-offset-4"
                      >
                        {fmt(t.item.photo, { credit: iso(credit) })}
                      </a>
                    ) : (
                      <span className="break-words">
                        {fmt(t.item.photo, { credit: iso(credit) })}
                      </span>
                    ))}
                </figcaption>
              )}
            </figure>
          )}
        </div>
      </section>

      <section className="tone-cream ak-section !pt-12">
        <div
          className={`ak-container ${hasMain ? "grid items-start gap-10 lg:grid-cols-[1.7fr_1fr]" : "max-w-2xl"}`}
        >
          {hasMain && (
            <div className="min-w-0 space-y-12">
              <ItemExtras groups={d.options} />
              {w && (
                <section aria-labelledby="goes-title">
                  <h2 id="goes-title" className="ak-h2">
                    {t.item.goesWell}
                  </h2>
                  <div className="ak-card relative mt-6 flex items-center gap-4 p-4 transition-transform hover:-translate-y-0.5">
                    {w.photo && (
                      <img
                        src={itemImageUrl(w.id)}
                        alt=""
                        width={96}
                        height={96}
                        loading="lazy"
                        decoding="async"
                        className="size-20 shrink-0 rounded-2xl bg-tone-surface-2 object-cover sm:size-24"
                      />
                    )}
                    <div className="min-w-0">
                      <Link
                        to="/$lang/i/$id"
                        params={{ lang, id: w.id }}
                        className="break-words text-lg font-extrabold no-underline after:absolute after:inset-0 after:content-['']"
                      >
                        {pickName(w, "name", lang)}
                      </Link>
                      <p className="mt-1 text-sm">
                        <Price amount={w.price_usd} perKg={w.per_kg} rate={d.rate} />
                      </p>
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}
          <div className="min-w-0 space-y-6 lg:sticky lg:top-24">
            <ItemFacts d={d} />
            <Link
              to="/$lang/m/$slug"
              params={{ lang, slug: v.slug }}
              className="ak-btn ak-btn-line ak-btn-sm !whitespace-normal"
            >
              <Store className="size-4 shrink-0" aria-hidden="true" />
              {fmt(t.item.menu, { vendor: shop })}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

/** Diet and contents, as the shop set them on its menu. */
function Diet({ d }: { d: SiteItemPage }) {
  const { t } = useSite();
  const i = d.item;
  const tags = [
    i.vegan ? t.vendor.vegan : i.vegetarian ? t.vendor.vegetarian : null,
    (i.spicy ?? 0) > 0 ? t.vendor.spicy : null,
    i.pork ? t.vendor.pork : null,
    i.alcohol ? t.vendor.alcohol : null,
  ].filter(Boolean) as string[];
  if (tags.length === 0) return null;
  return (
    <p className="mt-4 flex flex-wrap gap-1.5 text-xs">
      {tags.map((x) => (
        <span key={x} className="ak-chip !px-2 !py-0.5">
          {x}
        </span>
      ))}
    </p>
  );
}
