import { createFileRoute, notFound } from "@tanstack/react-router";
import { buildHead, fmt, localePath, pickName } from "@/lib/site";
import { getCuisine } from "@/lib/site-data";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { OrderButton } from "@/components/site/OrderButton";
import { VendorCardItem } from "@/components/site/VendorCardItem";
import { crumbsLd } from "@/components/site/Breadcrumbs";
import { MIN_MERCHANTS_TO_INDEX } from "@/lib/site-config";

export const Route = createFileRoute("/$lang/cuisine/$tag")({
  loader: async ({ params }) => {
    const d = await getCuisine(params.tag);
    if (!d) throw notFound();
    return d;
  },
  staleTime: 60_000,
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
  }),
  head: ({ loaderData, match }) => {
    if (!loaderData) return {};
    const { lang, copy, info } = match.context;
    const cuisine = pickName(loaderData.cuisine, "name", lang);
    const base = info?.origin ?? "";
    return buildHead({
      lang,
      path: `/cuisine/${loaderData.cuisine.tag}`,
      title: fmt(copy.cuisine.seoTitle, { cuisine }),
      description: fmt(copy.cuisine.seoDescription, { cuisine }),
      info: info ?? { origin: "", indexing: false },
      noindex: loaderData.vendors.length < MIN_MERCHANTS_TO_INDEX,
      jsonLd: [
        crumbsLd([
          { label: copy.common.home, url: `${base}${localePath(lang)}` },
          { label: copy.common.cuisines, url: `${base}${localePath(lang, "/cuisine")}` },
          {
            label: cuisine,
            url: `${base}${localePath(lang, `/cuisine/${loaderData.cuisine.tag}`)}`,
          },
        ]),
      ],
    });
  },
  component: CuisinePage,
});

function CuisinePage() {
  const d = Route.useLoaderData();
  const { t, lang } = useSite();
  const cuisine = pickName(d.cuisine, "name", lang);
  const n = d.vendors.length;
  const fact = fmt(n === 0 ? t.cuisine.factNone : n === 1 ? t.cuisine.factOne : t.cuisine.fact, {
    n,
    cuisine,
  });
  return (
    <>
      <PageHero
        title={fmt(t.cuisine.title, { cuisine })}
        lead={fact}
        crumbs={[
          { label: "", to: "/$lang" },
          { label: t.common.cuisines, to: "/$lang/cuisine" },
          { label: cuisine },
        ]}
      >
        <OrderButton text={fmt(t.wa.cuisine, { cuisine })} />
      </PageHero>
      <section className="tone-cream ak-section !pt-12" aria-labelledby="shops-title">
        <div className="ak-container">
          <h2 id="shops-title" className="ak-h2">
            {fmt(t.cuisine.shops, { cuisine })}
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
        </div>
      </section>
    </>
  );
}
