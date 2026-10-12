import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { loadLegal, type LegalSlug } from "@/content";
import { buildHead } from "@/lib/site";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";

const SLUGS: LegalSlug[] = ["terms", "privacy", "refund", "cookies"];

export const Route = createFileRoute("/$lang/legal/$doc")({
  loader: async ({ params }) => {
    const legal = await loadLegal(params.lang as "ar" | "en" | "fr");
    const doc = legal.docs.find((d) => d.slug === params.doc);
    if (!doc) throw notFound();
    return {
      doc,
      updatedOn: legal.updatedOn,
      draftNote: legal.draftNote,
      entityHeading: legal.entityHeading,
      entityText: legal.entityText,
    };
  },
  staleTime: 3_600_000,
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
  }),
  head: ({ loaderData, match, params }) => {
    if (!loaderData) return {};
    const { lang, info } = match.context;
    return buildHead({
      lang,
      path: `/legal/${params.doc}`,
      title: `${loaderData.doc.title} | Alo King`,
      description: loaderData.doc.description,
      info: info ?? { origin: "", indexing: false },
    });
  },
  component: LegalPage,
});

function LegalPage() {
  const { doc, updatedOn, draftNote, entityHeading, entityText } = Route.useLoaderData();
  const { t, lang } = useSite();
  const date = new Intl.DateTimeFormat(lang === "ar" ? "ar-u-nu-latn" : lang, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${updatedOn}T00:00:00Z`));
  return (
    <>
      <PageHero
        title={doc.title}
        lead={doc.intro}
        crumbs={[{ label: "", to: "/$lang" }, { label: doc.title }]}
      />
      <section className="tone-cream ak-section !pt-12">
        <div className="ak-container grid gap-12 lg:grid-cols-[1fr_16rem]">
          <article className="ak-prose">
            <p className="text-sm font-semibold text-tone-mute">
              {t.common.updated.replace("{date}", date)}
            </p>
            <p className="ak-card mt-4 p-4 text-sm text-tone-mute">{draftNote}</p>
            {doc.sections.map((s) => (
              <section key={s.h}>
                <h2>{s.h}</h2>
                {s.p?.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                {s.ul && (
                  <ul>
                    {s.ul.map((li) => (
                      <li key={li}>{li}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
            <h2>{entityHeading}</h2>
            <p>{entityText}</p>
          </article>
          <nav aria-label={t.footer.legal} className="lg:sticky lg:top-24 lg:self-start">
            <ul className="space-y-1">
              {SLUGS.map((s) => (
                <li key={s}>
                  <Link
                    to="/$lang/legal/$doc"
                    params={{ lang, doc: s }}
                    className="block rounded-xl px-3 py-2 font-semibold no-underline hover:bg-tone-surface-2"
                    activeProps={{ className: "bg-ink text-cream hover:!bg-ink" }}
                  >
                    {t.footer[s]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>
    </>
  );
}
