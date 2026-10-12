import { createFileRoute } from "@tanstack/react-router";
import { buildHead } from "@/lib/site";
import { faqItems, faqLd } from "@/lib/faq";
import { useSite } from "@/components/site/context";
import { Hero } from "@/components/site/home/Hero";
import { ThreeTaps } from "@/components/site/home/ThreeTaps";
import { SpeakLebanese } from "@/components/site/home/SpeakLebanese";
import { LebanonMap } from "@/components/site/home/LebanonMap";
import { MerchantCalc } from "@/components/site/home/MerchantCalc";
import { SendHomeSection } from "@/components/site/home/SendHomeSection";
import { Trust } from "@/components/site/home/Trust";
import { FaqList } from "@/components/site/FaqList";
import { Link } from "@tanstack/react-router";

const HOME_FAQ = ["how", "app", "languages", "pay", "prices", "where"];

export const Route = createFileRoute("/$lang/")({
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    const faq = faqItems(copy, { places: [], cuisines: [], merchants: 0, fees: { min_usd: null, max_usd: null, max_km: null }, order_fee_usd: null, order_fee_free_days: null, rate: null, rate_at: null }, HOME_FAQ);
    const base = info?.origin ?? "";
    return buildHead({
      lang,
      path: "/",
      title: copy.home.seo.title,
      description: copy.home.seo.description,
      info: info ?? { origin: "", indexing: false },
      jsonLd: [
        { "@context": "https://schema.org", "@type": "Organization", name: "Alo King", alternateName: "ألو كينغ", url: `${base}/${lang}`, logo: `${base}/icon-512.png`, description: copy.home.seo.description },
        { "@context": "https://schema.org", "@type": "WebSite", name: "Alo King", url: `${base}/${lang}`, inLanguage: lang },
        faqLd(faq),
      ],
    });
  },
  component: Home,
});

function Home() {
  const { t, lang, overview } = useSite();
  const faq = faqItems(t, overview, HOME_FAQ);
  return (
    <>
      <Hero />
      <ThreeTaps />
      <SpeakLebanese />
      <LebanonMap />
      <MerchantCalc />
      <SendHomeSection />
      <Trust />
      <section className="tone-cream ak-section !pt-0" aria-labelledby="faq-title">
        <div className="ak-container grid gap-10 lg:grid-cols-[0.8fr_1.4fr]">
          <div>
            <p className="ak-eyebrow">{t.home.faq.eyebrow}</p>
            <h2 id="faq-title" className="ak-h2 mt-3">
              {t.home.faq.title}
            </h2>
            <Link to="/$lang/help" params={{ lang }} className="ak-btn ak-btn-ink mt-6">
              {t.home.faq.more}
            </Link>
          </div>
          <FaqList items={faq} />
        </div>
      </section>
    </>
  );
}
