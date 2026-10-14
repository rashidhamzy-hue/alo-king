import { createFileRoute } from "@tanstack/react-router";
import { buildHead } from "@/lib/site";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { DriverForm } from "@/components/site/forms/DriverForm";

export const Route = createFileRoute("/$lang/business/drivers")({
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    return buildHead({
      lang,
      path: "/business/drivers",
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
        crumbs={[{ label: t.biz.nav.home, to: "/$lang/business" }, { label: d.eyebrow }]}
      />
      <section className="tone-cream ak-section !pt-0">
        <div className="ak-container">
          <p className="ak-card max-w-3xl p-5">{d.honest}</p>
        </div>
      </section>
      <section className="tone-night ak-section ak-counter" aria-labelledby="drivers-steps">
        <div className="ak-container">
          <h2 id="drivers-steps" className="ak-h2">
            {d.stepsTitle}
          </h2>
          <ol className="ak-steps-row">
            {d.steps.map((s, i) => (
              <li key={s.title}>
                <span className="ak-step-n" aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className="ak-h3 mt-5">{s.title}</h3>
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
