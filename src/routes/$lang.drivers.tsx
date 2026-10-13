import { createFileRoute } from "@tanstack/react-router";
import { buildHead } from "@/lib/site";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { DriverForm } from "@/components/site/forms/DriverForm";
import { Contours } from "@/design/Contours";

export const Route = createFileRoute("/$lang/drivers")({
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    return buildHead({
      lang,
      path: "/drivers",
      title: copy.driversPage.seoTitle,
      description: copy.driversPage.seoDescription,
      info: info ?? { origin: "", indexing: false },
    });
  },
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
  }),
  component: DriversPage,
});

function DriversPage() {
  const { t } = useSite();
  const d = t.driversPage;
  return (
    <>
      <PageHero
        eyebrow={d.eyebrow}
        title={d.title}
        lead={d.lead}
        crumbs={[{ label: "", to: "/$lang" }, { label: d.eyebrow }]}
      />
      <section className="tone-night ak-contours ak-section !pt-4" aria-labelledby="drivers-steps">
        <Contours />
        <div className="ak-container">
          <p className="ak-card max-w-3xl p-5">{d.honest}</p>
          <h2 id="drivers-steps" className="ak-h2 mt-12">
            {d.stepsTitle}
          </h2>
          <ol className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {d.steps.map((s, i) => (
              <li key={s.title} className="ak-card p-6">
                <span
                  className="grid size-10 place-items-center rounded-full bg-gold text-lg font-extrabold text-ink"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <h3 className="ak-h3 mt-4">{s.title}</h3>
                <p className="mt-2 text-tone-mute">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="tone-cream ak-section">
        <div className="ak-container max-w-3xl">
          <DriverForm />
        </div>
      </section>
    </>
  );
}
