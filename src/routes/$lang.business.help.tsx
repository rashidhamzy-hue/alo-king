import { createFileRoute, Link } from "@tanstack/react-router";
import { buildHead } from "@/lib/site";
import { businessFaqIds, faqItems, faqLd } from "@/lib/faq";
import { EMPTY_OVERVIEW } from "@/lib/site-data";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { OrderButton } from "@/components/site/OrderButton";
import { FaqList } from "@/components/site/FaqList";

// Help for businesses (DECISIONS §39.11): the merchants' own FAQ, never the customers'.
export const Route = createFileRoute("/$lang/business/help")({
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    return buildHead({
      lang,
      path: "/business/help",
      title: copy.biz.help.seoTitle,
      description: copy.biz.help.seoDescription,
      info: info ?? { origin: "", indexing: false },
      jsonLd: [faqLd(faqItems(copy, EMPTY_OVERVIEW, businessFaqIds(copy)))],
    });
  },
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
  }),
  component: BusinessHelp,
});

function BusinessHelp() {
  const { t, lang, overview } = useSite();
  const h = t.biz.help;
  return (
    <>
      <PageHero
        title={h.title}
        lead={h.lead}
        crumbs={[{ label: t.biz.nav.home, to: "/$lang/business" }, { label: t.biz.nav.help }]}
      />
      <section className="tone-cream ak-section !pt-12">
        <div className="ak-container grid gap-12 lg:grid-cols-[1.4fr_0.8fr]">
          <FaqList items={faqItems(t, overview, businessFaqIds(t))} />
          <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
            <div className="ak-card p-6">
              <h2 className="ak-h3">{h.contactTitle}</h2>
              <p className="mt-2 text-tone-mute">{h.contactText}</p>
              <OrderButton
                className="mt-5"
                size="md"
                variant="ink"
                text={t.wa.business}
                label={h.contactCta}
                business
              />
              <Link
                to="/$lang/business/contact"
                params={{ lang }}
                className="mt-4 block font-bold underline underline-offset-4"
              >
                {t.contact.bizContact}
              </Link>
            </div>
            <div className="ak-card p-6">
              <h2 className="ak-h3">{h.dashboardTitle}</h2>
              <p className="mt-2 text-tone-mute">{h.dashboardText}</p>
              <Link to="/merchant" className="ak-btn ak-btn-line mt-5">
                {h.dashboardCta}
              </Link>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
