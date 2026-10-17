import { createFileRoute, Link } from "@tanstack/react-router";
import { buildHead, fmt } from "@/lib/site";
import { WHATSAPP_DISPLAY } from "@/lib/config";
import { COMPANY_LINE, SUPPORT } from "@/lib/site-config";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { OrderButton } from "@/components/site/OrderButton";

// The businesses' contact page (DECISIONS §39.15.5): the claim and registration flows end here, and every business page
// can reach it. Customers have their own contact page; the two sides never share pages (§39.11).
export const Route = createFileRoute("/$lang/business/contact")({
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    return buildHead({
      lang,
      path: "/business/contact",
      title: copy.biz.contact.seoTitle,
      description: copy.biz.contact.seoDescription,
      info: info ?? { origin: "", indexing: false },
    });
  },
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
  }),
  component: BusinessContact,
});

function BusinessContact() {
  const { t, lang } = useSite();
  const c = t.biz.contact;
  return (
    <>
      <PageHero
        title={c.title}
        lead={c.lead}
        crumbs={[{ label: t.biz.nav.home, to: "/$lang/business" }, { label: t.biz.nav.contact }]}
      />
      <section className="tone-cream ak-section !pt-4">
        <div className="ak-container grid gap-4 md:grid-cols-2">
          <div id="whatsapp" className="ak-card p-6 md:col-span-2">
            <h2 className="ak-h3">{c.whatsappTitle}</h2>
            <p className="mt-2 text-tone-mute">{c.whatsappText}</p>
            {WHATSAPP_DISPLAY ? (
              <>
                <p className="ak-num mt-4 text-3xl font-extrabold">
                  <bdi>{WHATSAPP_DISPLAY}</bdi>
                </p>
                <OrderButton
                  className="mt-5"
                  size="md"
                  variant="ink"
                  text={t.wa.business}
                  label={c.cta}
                  business
                />
              </>
            ) : (
              <p className="mt-4 font-semibold">{t.contact.whatsappSoon}</p>
            )}
          </div>
          <div className="ak-card p-6">
            <h2 className="ak-h3">{c.hoursTitle}</h2>
            <p className="mt-2 text-tone-mute">
              {fmt(t.contact.hours, {
                fast: SUPPORT.fastMinutes,
                from: SUPPORT.fastFrom,
                to: SUPPORT.fastTo,
              })}
            </p>
            <h3 className="mt-5 font-bold">{t.contact.languagesTitle}</h3>
            <p className="mt-1 text-tone-mute">{t.contact.languages}</p>
          </div>
          <div className="ak-card p-6">
            <h2 className="ak-h3">{c.startTitle}</h2>
            <p className="mt-2 text-tone-mute">{c.startText}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                to="/$lang/business/claim"
                params={{ lang }}
                className="ak-btn ak-btn-ink ak-btn-sm"
              >
                {t.biz.nav.claim}
              </Link>
              <Link
                to="/$lang/business/register"
                params={{ lang }}
                className="ak-btn ak-btn-line ak-btn-sm"
              >
                {t.merchantsPage.hero.register}
              </Link>
            </div>
          </div>
          <div className="ak-card p-6">
            <h2 className="ak-h3">{c.dashboardTitle}</h2>
            <p className="mt-2 text-tone-mute">{c.dashboardText}</p>
            <Link to="/merchant" className="ak-btn ak-btn-line ak-btn-sm mt-5">
              {t.biz.nav.signIn}
            </Link>
          </div>
          <div className="ak-card p-6">
            <h2 className="ak-h3">{t.contact.companyTitle}</h2>
            <p className="mt-2 text-tone-mute">{COMPANY_LINE[lang]}</p>
            <Link
              to="/$lang/business/legal/$doc"
              params={{ lang, doc: "merchant-terms" }}
              className="mt-3 inline-block font-bold underline underline-offset-4"
            >
              {t.footer.merchantTerms}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
