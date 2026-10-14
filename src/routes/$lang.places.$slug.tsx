import { createFileRoute, notFound } from "@tanstack/react-router";
import { buildHead, fmt, localePath, pickName, unclaimedPage, usd } from "@/lib/site";
import { getPlace, getPlaceUnclaimed } from "@/lib/site-data";
import { MIN_MERCHANTS_TO_INDEX } from "@/lib/site-config";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { OrderButton } from "@/components/site/OrderButton";
import { VendorCardItem } from "@/components/site/VendorCardItem";
import { crumbsLd } from "@/components/site/Breadcrumbs";
import { UnclaimedSection } from "@/components/site/UnclaimedSection";

export const Route = createFileRoute("/$lang/places/$slug")({
  // ?u=<n>: the page of the "Not on Alo King yet" list (DECISIONS §39.3).
  validateSearch: (s: Record<string, unknown>): { u?: number } => ({ u: unclaimedPage(s.u) }),
  loaderDeps: ({ search }) => ({ u: search.u ?? 1 }),
  loader: async ({ params, deps }) => {
    const [d, unclaimed] = await Promise.all([
      getPlace(params.slug),
      getPlaceUnclaimed(params.slug, deps.u),
    ]);
    if (!d) throw notFound();
    return { ...d, unclaimed };
  },
  staleTime: 60_000,
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
  }),
  head: ({ loaderData, match }) => {
    if (!loaderData) return {};
    const { lang, copy, info } = match.context;
    const place = pickName(loaderData.place, "name", lang);
    const base = info?.origin ?? "";
    return buildHead({
      lang,
      path: `/places/${loaderData.place.slug}`,
      title: fmt(copy.places.seoTitle, { place }),
      description: fmt(copy.places.seoDescription, { place }),
      info: info ?? { origin: "", indexing: false },
      // Indexed on its live merchants only; the other pages of the unclaimed list stay out (§24.5: no thin pages).
      noindex: loaderData.vendors.length < MIN_MERCHANTS_TO_INDEX || loaderData.unclaimed.page > 1,
      jsonLd: [
        crumbsLd([
          { label: copy.common.home, url: `${base}${localePath(lang)}` },
          { label: copy.common.places, url: `${base}${localePath(lang, "/places")}` },
          { label: place, url: `${base}${localePath(lang, `/places/${loaderData.place.slug}`)}` },
        ]),
      ],
    });
  },
  component: PlacePage,
});

function PlacePage() {
  const d = Route.useLoaderData();
  const { t, lang } = useSite();
  const place = pickName(d.place, "name", lang);
  const n = d.vendors.length;
  const f = d.fees;
  const withFees = f.min_usd != null && f.max_usd != null;
  const raw = n === 0 ? t.places.factNone : n === 1 ? t.places.factOne : t.places.fact;
  // The one factual sentence the page opens with, generated from live data (DECISIONS §24.6).
  const fact = fmt(withFees || n === 0 ? raw : raw.split(/[;؛]/)[0] + ".", {
    n,
    place,
    min: usd(f.min_usd),
    max: usd(f.max_usd),
  });
  const district = pickName(d.place, "district", lang);
  return (
    <>
      <PageHero
        eyebrow={district ? fmt(t.places.district, { district }) : undefined}
        title={fmt(t.places.title, { place })}
        lead={fact}
        crumbs={[
          { label: "", to: "/$lang" },
          { label: t.common.places, to: "/$lang/places" },
          { label: place },
        ]}
      >
        <OrderButton text={fmt(t.wa.place, { place })} />
      </PageHero>
      <section className="tone-cream ak-section !pt-12" aria-labelledby="shops-title">
        <div className="ak-container">
          <h2 id="shops-title" className="ak-h2">
            {fmt(t.places.shops, { place })}
          </h2>
          {n > 0 ? (
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {d.vendors.map((v) => (
                <VendorCardItem key={v.slug} v={v} />
              ))}
            </ul>
          ) : (
            <p className="mt-6 max-w-2xl text-lg text-tone-mute">{t.places.noShops}</p>
          )}
          <UnclaimedSection
            list={d.unclaimed}
            lead={fmt(t.unclaimed.leadPlace, { place })}
            to="/$lang/places/$slug"
            params={{ lang, slug: d.place.slug }}
          />
          <h2 className="ak-h3 mt-14">{fmt(t.places.howTitle, { place })}</h2>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2">
            {t.help.steps.map((s, i) => (
              <li key={s} className="ak-card flex gap-4 p-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink font-extrabold text-gold">
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
