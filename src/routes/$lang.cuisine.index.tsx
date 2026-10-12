import { createFileRoute, Link } from "@tanstack/react-router";
import { buildHead, pickName } from "@/lib/site";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { OrderButton } from "@/components/site/OrderButton";

export const Route = createFileRoute("/$lang/cuisine/")({
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    return buildHead({
      lang,
      path: "/cuisine",
      title: copy.cuisine.indexSeoTitle,
      description: copy.cuisine.indexSeoDescription,
      info: info ?? { origin: "", indexing: false },
    });
  },
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
  }),
  component: CuisineIndex,
});

function CuisineIndex() {
  const { t, lang, overview } = useSite();
  return (
    <>
      <PageHero
        title={t.cuisine.indexTitle}
        lead={t.cuisine.indexLead}
        crumbs={[{ label: "", to: "/$lang" }, { label: t.common.cuisines }]}
      >
        <OrderButton />
      </PageHero>
      <section className="tone-cream ak-section !pt-12">
        <div className="ak-container">
          {overview.cuisines.length > 0 ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {overview.cuisines.map((c) => (
                <li
                  key={c.tag}
                  className="ak-card relative p-5 transition-transform hover:-translate-y-0.5"
                >
                  <Link
                    to="/$lang/cuisine/$tag"
                    params={{ lang, tag: c.tag }}
                    className="text-lg font-extrabold no-underline after:absolute after:inset-0 after:content-['']"
                  >
                    {pickName(c, "name", lang)}
                  </Link>
                  <p className="ak-num mt-1 text-sm text-tone-mute">{c.vendors}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="max-w-2xl text-lg text-tone-mute">{t.cuisine.none}</p>
          )}
        </div>
      </section>
    </>
  );
}
