import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Clock, MapPin, Bike } from "lucide-react";
import { buildHead, fmt, iso, localePath, pickName, usd, withShop } from "@/lib/site";
import {
  getVendorDemo,
  getVendorPage,
  getVendorUnclaimed,
  type SiteVendorPage,
  type UnclaimedVendorPage,
} from "@/lib/site-data";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { OrderButton } from "@/components/site/OrderButton";
import { MenuBuilder } from "@/components/site/MenuBuilder";
import { crumbsLd } from "@/components/site/Breadcrumbs";
import { UnclaimedVendor } from "@/components/site/UnclaimedVendor";
import { WebMenu, WebMenuGone } from "@/components/site/webmenu/WebMenu";
import { getWebMenu, isWebToken, sitePhotoUrl, type WebMenu as WebMenuData } from "@/lib/web-menu";

const SCHEMA_TYPE: Record<string, string> = {
  restaurant: "Restaurant",
  fast_food: "FastFoodRestaurant",
  cafe: "CafeOrCoffeeShop",
  bakery_manakish: "Bakery",
  sweets_pastry: "Bakery",
  ice_cream: "IceCreamShop",
  grocery_supermarket: "GroceryStore",
  minimarket: "ConvenienceStore",
  butcher: "Store",
  poultry: "Store",
  fish_market: "Store",
  produce: "Store",
  roastery_nuts: "Store",
  home_essentials: "Store",
  other_food: "FoodEstablishment",
};
const DAY_URL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** schema.org for the claimed shop: only what the page shows (name, cuisines, area, hours, menu and prices). */
function vendorLd(d: SiteVendorPage, lang: "ar" | "en" | "fr", url: string) {
  const v = d.vendor;
  return {
    "@context": "https://schema.org",
    "@type": SCHEMA_TYPE[v.business_type] ?? "FoodEstablishment",
    name: pickName(v, "name", lang),
    url,
    servesCuisine: v.cuisines.map((c) => pickName(c, "name", lang)),
    areaServed: pickName(v, "place", lang) || undefined,
    openingHoursSpecification: d.hours.map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${DAY_URL[h.weekday]}`,
      opens: h.opens,
      closes: h.closes,
    })),
    hasMenu: {
      "@type": "Menu",
      hasMenuSection: d.sections.map((s) => ({
        "@type": "MenuSection",
        name: pickName(s, "name", lang) || undefined,
        hasMenuItem: s.items.map((i) => ({
          "@type": "MenuItem",
          name: pickName(i, "name", lang),
          description: i.description || undefined,
          offers: { "@type": "Offer", price: i.price_usd.toFixed(2), priceCurrency: "USD" },
        })),
      })),
    },
  };
}

type PublicPage =
  | { claimed: SiteVendorPage; unclaimed: null; web?: undefined }
  | { claimed: null; unclaimed: UnclaimedVendorPage; web?: undefined };
type WebPage = { web: WebMenuData; token: string; claimed?: undefined; unclaimed?: undefined };

export const Route = createFileRoute("/$lang/m/$slug")({
  // ?t=<token>: the customer's web menu (CUSTOMER-EXPERIENCE §4), opened from the chat's "Open menu" button. Never cached
  // by a CDN, never indexed, and the token is never part of the canonical address.
  // ?i=<item>: opened from Explore's dishes, the page starts on that item's sheet.
  validateSearch: (s: Record<string, unknown>): { t?: string; i?: string } => ({
    ...(isWebToken(s.t) ? { t: s.t } : typeof s.t === "string" ? { t: "x" } : {}),
    ...(typeof s.i === "string" && /^[0-9a-f-]{36}$/.test(s.i) ? { i: s.i } : {}),
  }),
  loaderDeps: ({ search }) => ({ t: search.t }),
  // A claimed shop's page, a demo shop's page (§39.12: labelled Demo, noindex), or (DECISIONS §39.3) the noindex page of
  // a shop that is not on Alo King yet. The demo and unclaimed lookups run together; a demo shop wins.
  loader: async ({ params, deps }): Promise<PublicPage | WebPage> => {
    if (deps.t) {
      const web = (await getWebMenu(deps.t, params.slug)) ?? { status: "unavailable" as const };
      return { web, token: deps.t };
    }
    const d = await getVendorPage(params.slug);
    if (d) return { claimed: d, unclaimed: null };
    const [demo, u] = await Promise.all([
      getVendorDemo(params.slug),
      getVendorUnclaimed(params.slug),
    ]);
    if (demo) return { claimed: demo, unclaimed: null };
    if (!u) throw notFound();
    return { claimed: null, unclaimed: u };
  },
  staleTime: 60_000,
  headers: ({ match }): Record<string, string> =>
    match.search.t
      ? { "cache-control": "private, no-store", "referrer-policy": "no-referrer" }
      : { "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600" },
  head: ({ loaderData, match }) => {
    if (!loaderData) return {};
    const { lang, copy, info } = match.context;
    if (loaderData.web) {
      const w = loaderData.web;
      const name = w.status === "ok" ? pickName(w.shop, "name", lang) : copy.site.name;
      const h = buildHead({
        lang,
        path: `/m/${match.params.slug}`,
        title: fmt(copy.webMenu.seoTitle, { vendor: name }),
        description: copy.home.seo.description,
        info: info ?? { origin: "", indexing: false },
        noindex: true,
      });
      // The token never leaves in a Referer (the photo route, wa.me), whatever the navigation.
      h.meta.push({ name: "referrer", content: "no-referrer" });
      // The cover is the page's largest paint: fetched with the HTML, not after the script.
      if (w.status === "ok" && w.shop.cover)
        h.links.push({
          rel: "preload",
          as: "image",
          href: sitePhotoUrl({ shop: w.shop.vendor_id }),
        } as (typeof h.links)[number]);
      return h;
    }
    if (loaderData.unclaimed) {
      const u = loaderData.unclaimed.vendor;
      const name = pickName(u, "name", lang);
      const place = pickName(u, "place", lang);
      // Never indexed and never in a sitemap until the shop is claimed (§39.3, §5).
      return buildHead({
        lang,
        path: `/m/${u.slug}`,
        title: fmt(copy.unclaimed.seoTitle, { name, where: place ? ` · ${place}` : "" }),
        description: fmt(copy.unclaimed.seoDescription, { name }),
        info: info ?? { origin: "", indexing: false },
        noindex: true,
      });
    }
    const page = loaderData.claimed;
    const v = page.vendor;
    const name = pickName(v, "name", lang);
    const place = pickName(v, "place", lang);
    const base = info?.origin ?? "";
    const url = `${base}${localePath(lang, `/m/${v.slug}`)}`;
    return buildHead({
      lang,
      path: `/m/${v.slug}`,
      title: fmt(copy.vendor.seoTitle, { name }),
      description: fmt(copy.vendor.seoDescription, {
        name,
        type: pickName(v, "business_type", lang),
        where: place ? fmt(copy.vendor.where, { place }) : "",
      }),
      info: info ?? { origin: "", indexing: false },
      // A demo shop (§39.12) is never indexed and is not described as a real business.
      noindex: v.demo === true,
      jsonLd: v.demo
        ? []
        : [
            vendorLd(page, lang, url),
            crumbsLd([
              { label: copy.common.home, url: `${base}${localePath(lang)}` },
              ...(v.place_slug && place
                ? [{ label: place, url: `${base}${localePath(lang, `/places/${v.place_slug}`)}` }]
                : []),
              { label: name, url },
            ]),
          ],
    });
  },
  component: VendorRoute,
});

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function VendorRoute() {
  const d = Route.useLoaderData();
  const { i } = Route.useSearch();
  if (!d) return null;
  if (d.web)
    return d.web.status === "ok" ? (
      <WebMenu d={d.web} token={d.token} initialItem={i} />
    ) : (
      <WebMenuGone kind={d.web.status === "expired" ? "expired" : "unavailable"} />
    );
  return d.claimed ? <VendorPage d={d.claimed} /> : <UnclaimedVendor d={d.unclaimed!} />;
}

function VendorPage({ d }: { d: SiteVendorPage }) {
  const { t, lang } = useSite();
  const v = d.vendor;
  const name = pickName(v, "name", lang);
  const place = pickName(v, "place", lang);
  const canOrder = v.orderable && !v.paused;
  const km = v.delivery_radius_km;
  const f = d.fees;
  const how =
    v.delivery && v.pickup
      ? t.vendor.both
      : v.delivery
        ? t.vendor.deliveryOnly
        : t.vendor.pickupOnly;
  const cur = (v.cash_currencies ?? []).join(" / ");
  const byDay = new Map(d.hours.map((h) => [h.weekday, h]));
  const cuisines = v.cuisines.map((c) => ({ tag: c.tag, label: pickName(c, "name", lang) }));
  return (
    <>
      <PageHero
        eyebrow={`${pickName(v, "business_type", lang)}${place ? ` · ${place}` : ""}`}
        title={name + (v.branch_label ? ` · ${v.branch_label}` : "")}
        crumbs={[
          { label: "", to: "/$lang" },
          { label: t.common.places, to: "/$lang/places" },
          { label: name },
        ]}
      >
        {canOrder ? (
          <OrderButton text={fmt(t.wa.vendor, { vendor: withShop(name, v.slug) })} />
        ) : (
          <p className="ak-lead !mt-0">{t.vendor.paused}</p>
        )}
        {v.demo && <span className="ak-chip">{t.common.demo}</span>}
        {!v.paused && (
          <span className={`ak-chip ${v.open_now ? "ak-chip-gold" : ""}`}>
            {v.open_now ? t.common.openNow : t.common.closed}
          </span>
        )}
        {cuisines.map((c) => (
          <Link
            key={c.tag}
            to="/$lang/cuisine/$tag"
            params={{ lang, tag: c.tag }}
            className="ak-chip no-underline"
          >
            {c.label}
          </Link>
        ))}
      </PageHero>

      <section className="tone-cream ak-section !pt-12" aria-labelledby="menu-title">
        <div className="ak-container grid items-start gap-10 lg:grid-cols-[1.7fr_1fr]">
          <div>
            <h2 id="menu-title" className="ak-h2">
              {t.vendor.menu}
            </h2>
            <p className="mt-2 text-sm text-tone-mute">
              {t.common.lbpNote.replace(
                "{rate}",
                d.rate ? Math.round(d.rate).toLocaleString("en-US") : "",
              )}
            </p>
            {/* DECISIONS §38.3: the shared-kitchen disclaimer appears on every menu. */}
            <p className="mt-1 text-sm text-tone-mute">{t.vendor.kitchenNote}</p>
            <div className="mt-8">
              {d.sections.length > 0 ? (
                <MenuBuilder page={d} canOrder={canOrder} />
              ) : (
                <p className="text-tone-mute">{t.vendor.hoursUnknown}</p>
              )}
            </div>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24" aria-label={t.vendor.area}>
            <div className="ak-card p-5">
              <h3 className="ak-h3 flex items-center gap-2">
                <Bike className="size-5" aria-hidden="true" />
                {t.vendor.area}
              </h3>
              <p className="mt-3">{how}</p>
              {v.delivery && km != null && f.min_usd != null && f.max_usd != null && (
                <p className="mt-2 text-tone-mute">
                  {fmt(t.vendor.deliversUp, {
                    km: iso(km ?? ""),
                    min: iso(usd(f.min_usd)),
                    max: iso(usd(f.max_usd)),
                  })}
                </p>
              )}
              {cur && (
                <p className="mt-2 text-tone-mute">{fmt(t.vendor.cash, { currencies: cur })}</p>
              )}
              {place && (
                <p className="mt-3 flex items-center gap-2 text-sm">
                  <MapPin className="size-4" aria-hidden="true" />
                  {v.place_slug ? (
                    <Link
                      to="/$lang/places/$slug"
                      params={{ lang, slug: v.place_slug }}
                      className="underline underline-offset-4"
                    >
                      {place}
                    </Link>
                  ) : (
                    place
                  )}
                </p>
              )}
            </div>
            <div className="ak-card p-5">
              <h3 className="ak-h3 flex items-center gap-2">
                <Clock className="size-5" aria-hidden="true" />
                {t.vendor.hours}
              </h3>
              {d.hours.length > 0 ? (
                <dl className="mt-3 space-y-1.5">
                  {WEEK_ORDER.map((wd) => {
                    const h = byDay.get(wd);
                    return (
                      <div key={wd} className="flex justify-between gap-4">
                        <dt className="text-tone-mute">{t.vendor.days[wd]}</dt>
                        <dd className="ak-num font-semibold">
                          {h ? <bdi>{`${h.opens} – ${h.closes}`}</bdi> : t.vendor.closedToday}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              ) : (
                <p className="mt-3 text-tone-mute">{t.vendor.hoursUnknown}</p>
              )}
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
