import { createFileRoute, Link } from "@tanstack/react-router";
import { buildHead, fmt, pickName } from "@/lib/site";
import { PILOT_PLACES_NAMES } from "@/lib/site-config";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { OrderButton } from "@/components/site/OrderButton";

export const Route = createFileRoute("/$lang/places/")({
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    return buildHead({
      lang,
      path: "/places",
      title: copy.places.indexSeoTitle,
      description: copy.places.indexSeoDescription,
      info: info ?? { origin: "", indexing: false },
    });
  },
  headers: () => ({ "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600" }),
  component: PlacesIndex,
});

function PlacesIndex() {
  const { t, lang, overview } = useSite();
  const km = overview.fees.max_km;
  const names = Object.values(PILOT_PLACES_NAMES).map((n) => n[lang]);
  return (
    <>
      <PageHero
        title={t.places.indexTitle}
        lead={fmt(t.places.indexLead, { km: km ?? "" })}
        crumbs={[{ label: "", to: "/$lang" }, { label: t.common.places }]}
      >
        <OrderButton />
      </PageHero>
      <section className="tone-cream ak-section !pt-12">
        <div className="ak-container">
          {overview.places.length > 0 ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {overview.places.map((p) => (
                <li key={p.id} className="ak-card relative p-5 transition-transform hover:-translate-y-0.5">
                  <Link to="/$lang/places/$slug" params={{ lang, slug: p.slug }} className="text-lg font-extrabold no-underline after:absolute after:inset-0 after:content-['']">
                    {pickName(p, "name", lang)}
                  </Link>
                  <p className="mt-1 text-sm text-tone-mute ak-num">
                    {t.places.shops.replace("{place}", "").trim()}: <bdi>{p.merchants}</bdi>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ak-card max-w-2xl p-8">
              <p className="ak-h3">{t.common.news}</p>
              <p className="mt-3 text-tone-mute">{fmt(t.places.none, { list: names.join(lang === "ar" ? "، " : ", ") })}</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
