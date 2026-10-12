import { createFileRoute } from "@tanstack/react-router";
import { buildHead } from "@/lib/site";
import { faqItems, faqLd } from "@/lib/faq";
import { EMPTY_OVERVIEW } from "@/lib/site-data";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { OrderButton } from "@/components/site/OrderButton";
import { FaqList } from "@/components/site/FaqList";

export const Route = createFileRoute("/$lang/help")({
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    return buildHead({
      lang,
      path: "/help",
      title: copy.help.seoTitle,
      description: copy.help.seoDescription,
      info: info ?? { origin: "", indexing: false },
      jsonLd: [faqLd(faqItems(copy, EMPTY_OVERVIEW))],
    });
  },
  headers: () => ({ "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600" }),
  component: HelpPage,
});

function HelpPage() {
  const { t, overview } = useSite();
  return (
    <>
      <PageHero title={t.help.title} lead={t.help.lead} crumbs={[{ label: "", to: "/$lang" }, { label: t.nav.help }]}>
        <OrderButton text={t.wa.person} label={t.help.contactCta} />
      </PageHero>
      <section className="tone-cream ak-section !pt-12">
        <div className="ak-container grid gap-12 lg:grid-cols-[0.8fr_1.4fr]">
          <div>
            <h2 className="ak-h3">{t.help.stepsTitle}</h2>
            <ol className="mt-5 space-y-3">
              {t.help.steps.map((s, i) => (
                <li key={s} className="flex gap-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink font-extrabold text-gold">{i + 1}</span>
                  <span className="pt-1">{s}</span>
                </li>
              ))}
            </ol>
          </div>
          <FaqList items={faqItems(t, overview)} />
        </div>
      </section>
    </>
  );
}
