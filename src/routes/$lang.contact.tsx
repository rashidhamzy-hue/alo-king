import { createFileRoute, Link } from "@tanstack/react-router";
import { buildHead, fmt } from "@/lib/site";
import { WHATSAPP_DISPLAY } from "@/lib/config";
import { COMPANY_LINE, SUPPORT } from "@/lib/site-config";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { OrderButton } from "@/components/site/OrderButton";

export const Route = createFileRoute("/$lang/contact")({
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    return buildHead({
      lang,
      path: "/contact",
      title: copy.contact.seoTitle,
      description: copy.contact.seoDescription,
      info: info ?? { origin: "", indexing: false },
    });
  },
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
  }),
  component: ContactPage,
});

function ContactPage() {
  const { t, lang } = useSite();
  const c = t.contact;
  return (
    <>
      <PageHero
        title={c.title}
        lead={c.lead}
        crumbs={[{ label: "", to: "/$lang" }, { label: t.nav.contact }]}
      />
      <section className="tone-cream ak-section !pt-12">
        <div className="ak-container grid gap-4 md:grid-cols-2">
          <div id="whatsapp" className="ak-card p-6 md:col-span-2">
            <h2 className="ak-h3">{c.whatsappTitle}</h2>
            <p className="mt-2 text-tone-mute">{c.whatsappText}</p>
            {WHATSAPP_DISPLAY ? (
              <p className="ak-num mt-4 text-3xl font-extrabold">
                <bdi>{WHATSAPP_DISPLAY}</bdi>
              </p>
            ) : (
              <p className="mt-4 font-semibold">{c.whatsappSoon}</p>
            )}
            {WHATSAPP_DISPLAY && <OrderButton className="mt-5" text={t.wa.person} variant="ink" />}
          </div>
          <div className="ak-card p-6">
            <h2 className="ak-h3">{c.hoursTitle}</h2>
            <p className="mt-2 text-tone-mute">
              {fmt(c.hours, {
                fast: SUPPORT.fastMinutes,
                from: SUPPORT.fastFrom,
                to: SUPPORT.fastTo,
              })}
            </p>
            <h3 className="mt-5 font-bold">{c.languagesTitle}</h3>
            <p className="mt-1 text-tone-mute">{c.languages}</p>
          </div>
          <div className="ak-card p-6">
            <h2 className="ak-h3">{c.privacyTitle}</h2>
            <p className="mt-2 text-tone-mute">{c.privacyText}</p>
            <Link
              to="/$lang/legal/$doc"
              params={{ lang, doc: "privacy" }}
              className="mt-3 inline-block font-bold underline underline-offset-4"
            >
              {t.footer.privacy}
            </Link>
          </div>
          <div className="ak-card p-6">
            <h2 className="ak-h3">{c.companyTitle}</h2>
            <p className="mt-2 text-tone-mute">{COMPANY_LINE[lang]}</p>
          </div>
        </div>
      </section>
    </>
  );
}
