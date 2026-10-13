import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { buildHead } from "@/lib/site";
import { faqItems, faqLd } from "@/lib/faq";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { MerchantCalc } from "@/components/site/home/MerchantCalc";
import { FaqList } from "@/components/site/FaqList";
import { Contours } from "@/design/Contours";

const MERCHANT_FAQ = ["m_cost", "m_proof", "m_menu", "m_orders", "m_paid", "m_chain"];

export const Route = createFileRoute("/$lang/for-merchants")({
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    const faq = faqItems(
      copy,
      {
        places: [],
        cuisines: [],
        merchants: 0,
        fees: { min_usd: null, max_usd: null, max_km: null },
        order_fee_usd: null,
        order_fee_free_days: null,
        rate: null,
        rate_at: null,
      },
      MERCHANT_FAQ,
    );
    return buildHead({
      lang,
      path: "/for-merchants",
      title: copy.merchantsPage.seoTitle,
      description: copy.merchantsPage.seoDescription,
      info: info ?? { origin: "", indexing: false },
      jsonLd: [faqLd(faq)],
    });
  },
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
  }),
  component: ForMerchants,
});

function ForMerchants() {
  const { t, lang, overview } = useSite();
  const p = t.merchantsPage;
  const faq = faqItems(t, overview, MERCHANT_FAQ);
  return (
    <>
      <PageHero
        eyebrow={p.hero.eyebrow}
        title={p.hero.title}
        lead={p.hero.lead}
        crumbs={[{ label: "", to: "/$lang" }, { label: t.nav.merchants }]}
      >
        <form
          action={`/${lang}/claim`}
          method="get"
          role="search"
          className="w-full max-w-2xl"
          aria-label={p.hero.searchLabel}
        >
          <label htmlFor="hero-q" className="ak-label">
            {p.hero.searchLabel}
          </label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-tone-mute"
                aria-hidden="true"
              />
              <input
                id="hero-q"
                name="q"
                type="search"
                minLength={2}
                maxLength={80}
                required
                autoComplete="off"
                placeholder={p.hero.searchPlaceholder}
                className="ak-input !mt-0 !min-h-14 !ps-12"
              />
            </div>
            <button type="submit" className="ak-btn ak-btn-gold ak-btn-lg">
              {p.hero.searchButton}
            </button>
          </div>
          <p className="mt-3 text-sm text-tone-mute">
            {p.hero.notListed}{" "}
            <Link
              to="/$lang/register"
              params={{ lang }}
              className="font-bold text-tone-fg underline underline-offset-4"
            >
              {p.hero.register}
            </Link>
          </p>
        </form>
      </PageHero>

      <MerchantCalc showCta={false} />

      <section className="tone-night ak-contours ak-section" aria-labelledby="how-title">
        <Contours />
        <div className="ak-container">
          <p className="ak-eyebrow text-gold">{p.how.eyebrow}</p>
          <h2 id="how-title" className="ak-h2 mt-3 max-w-3xl">
            {p.how.title}
          </h2>
          <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {p.how.steps.map((s, i) => (
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

      <section className="tone-cream ak-section" aria-labelledby="gets-title">
        <div className="ak-container">
          <p className="ak-eyebrow">{p.gets.eyebrow}</p>
          <h2 id="gets-title" className="ak-h2 mt-3 max-w-3xl">
            {p.gets.title}
          </h2>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {p.gets.items.map((s) => (
              <li key={s.title} className="ak-card p-6">
                <h3 className="ak-h3">{s.title}</h3>
                <p className="mt-2 text-tone-mute">{s.text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-3xl text-tone-mute">{p.gets.dashboard}</p>

          <div className="ak-card mt-12 flex flex-wrap items-center justify-between gap-5 p-6 sm:p-8">
            <div className="max-w-xl">
              <h2 className="ak-h3">{p.terms.title}</h2>
              <p className="mt-2 text-tone-mute">{p.terms.text}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/$lang/legal/$doc"
                params={{ lang, doc: "merchant-terms" }}
                className="ak-btn ak-btn-line"
              >
                {p.terms.merchantTerms}
              </Link>
              <Link
                to="/$lang/legal/$doc"
                params={{ lang, doc: "collection-mandate" }}
                className="ak-btn ak-btn-line"
              >
                {p.terms.mandate}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="tone-cream ak-section !pt-0" aria-labelledby="mfaq-title">
        <div className="ak-container grid gap-10 lg:grid-cols-[0.8fr_1.4fr]">
          <div>
            <p className="ak-eyebrow">{p.faq.eyebrow}</p>
            <h2 id="mfaq-title" className="ak-h2 mt-3">
              {p.faq.title}
            </h2>
          </div>
          <FaqList items={faq} />
        </div>
      </section>

      <section className="tone-night ak-contours ak-glow ak-section" aria-labelledby="band-title">
        <Contours />
        <div className="ak-container text-center">
          <h2 id="band-title" className="ak-h2">
            {p.band.title}
          </h2>
          <p className="ak-lead mx-auto mt-3">{p.band.text}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/$lang/claim" params={{ lang }} className="ak-btn ak-btn-gold ak-btn-lg">
              {p.band.claim}
            </Link>
            <Link to="/$lang/register" params={{ lang }} className="ak-btn ak-btn-line ak-btn-lg">
              {p.band.register}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
