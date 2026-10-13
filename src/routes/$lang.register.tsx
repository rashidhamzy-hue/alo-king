import { createFileRoute } from "@tanstack/react-router";
import { buildHead } from "@/lib/site";
import { getBusinessTypes } from "@/lib/site-data";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { RegisterFlow } from "@/components/site/forms/RegisterFlow";

export const Route = createFileRoute("/$lang/register")({
  loader: async () => ({ types: await getBusinessTypes() }),
  staleTime: 3_600_000,
  // A form with a person's details: never cached, never indexed.
  headers: () => ({ "cache-control": "no-store" }),
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    return buildHead({
      lang,
      path: "/register",
      title: copy.register.seoTitle,
      description: copy.register.seoDescription,
      info: info ?? { origin: "", indexing: false },
      noindex: true,
    });
  },
  component: RegisterPage,
});

function RegisterPage() {
  const { t } = useSite();
  const { types } = Route.useLoaderData();
  return (
    <>
      <PageHero
        eyebrow={t.register.eyebrow}
        title={t.register.title}
        lead={t.register.lead}
        crumbs={[
          { label: "", to: "/$lang" },
          { label: t.nav.merchants, to: "/$lang/for-merchants" },
          { label: t.register.eyebrow },
        ]}
      />
      <section className="tone-cream ak-section !pt-10">
        <div className="ak-container max-w-3xl">
          <RegisterFlow types={types} />
        </div>
      </section>
    </>
  );
}
