import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { buildHead, fmt } from "@/lib/site";
import { businessFaqIds, faqItems, faqLd } from "@/lib/faq";
import { EMPTY_OVERVIEW, getDeliveryMap } from "@/lib/site-data";
import { COMPETITOR_COMMISSION } from "@/lib/site-config";
import { useSite } from "@/components/site/context";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { CalcCard, feeLabel } from "@/components/site/biz/Calculator";
import { FaqList } from "@/components/site/FaqList";

// Alo King for business (DECISIONS §37.4, §39.11): the merchants' own landing, by day. The calculator lives here, not on
// the customers' home page.
export const Route = createFileRoute("/$lang/business/")({
  loader: async () => ({ listed: (await getDeliveryMap()).unclaimed_total }),
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    return buildHead({
      lang,
      path: "/business",
      title: copy.merchantsPage.seoTitle,
      description: copy.merchantsPage.seoDescription,
      info: info ?? { origin: "", indexing: false },
      jsonLd: [faqLd(faqItems(copy, EMPTY_OVERVIEW, businessFaqIds(copy)))],
    });
  },
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
  }),
  component: Business,
});

function ClaimSearch({ id, big = false }: { id: string; big?: boolean }) {
  const { t, lang } = useSite();
  const p = t.merchantsPage;
  return (
    <form
      action={`/${lang}/business/claim`}
      method="get"
      role="search"
      className="w-full max-w-xl"
      aria-label={p.hero.searchLabel}
    >
      <label htmlFor={id} className="ak-label">
        {p.hero.searchLabel}
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-tone-mute"
            aria-hidden="true"
          />
          <input
            id={id}
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
        <button type="submit" className={`ak-btn ak-btn-ink ${big ? "ak-btn-lg" : ""}`}>
          {p.hero.searchButton}
        </button>
      </div>
      <p className="mt-3 text-sm text-tone-mute">
        {p.hero.notListed}{" "}
        <Link
          to="/$lang/business/register"
          params={{ lang }}
          className="font-bold text-tone-fg underline underline-offset-4"
        >
          {p.hero.register}
        </Link>
      </p>
    </form>
  );
}

function Business() {
  const { t, lang, overview } = useSite();
  const { listed } = Route.useLoaderData();
  const p = t.merchantsPage;
  const m = t.home.merchants;
  const fee = overview.order_fee_usd;
  const days = overview.order_fee_free_days;
  const pct = Math.round(COMPETITOR_COMMISSION.high * 100);
  const faq = faqItems(t, overview, businessFaqIds(t));
  return (
    <>
      <section
        className="tone-cream ak-section ak-biz-hero !pt-8 sm:!pt-12"
        aria-labelledby="biz-title"
      >
        <div className="ak-container">
          <Breadcrumbs items={[{ label: t.biz.nav.home }]} />
          <div className="mt-8 grid items-start gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
            <div>
              <h1 id="biz-title" className="ak-display ak-biz-display">
                {fee != null
                  ? fmt(m.title, { fee: feeLabel(fee), pct })
                  : fmt(m.title.replace("{fee} ", ""), { pct })}
              </h1>
              <p className="ak-lead mt-6">{days != null ? fmt(m.sub, { days }) : m.subNoFree}</p>
              <p className="mt-4 max-w-xl font-semibold">{p.hero.lead}</p>
              <div className="mt-8">
                <ClaimSearch id="hero-q" big />
              </div>
            </div>
            <CalcCard id="pricing" />
          </div>
        </div>
      </section>

      {listed > 0 && (
        <section className="tone-cream ak-section !pt-0" aria-labelledby="listed-title">
          <div className="ak-container">
            <div className="ak-listed">
              <h2 id="listed-title" className="ak-listed-h">
                <span className="ak-listed-n ak-num">
                  <bdi>{listed}</bdi>
                </span>{" "}
                <span className="ak-h2">{p.listed.title}</span>
              </h2>
              <p className="ak-lead">{p.listed.text}</p>
            </div>
          </div>
        </section>
      )}

      <section className="tone-night ak-section ak-counter" aria-labelledby="how-title">
        <div className="ak-container">
          <h2 id="how-title" className="ak-h2 max-w-3xl">
            {p.how.title}
          </h2>
          <ol className="ak-steps-row">
            {p.how.steps.map((s, i) => (
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

      <section className="tone-cream ak-section" aria-labelledby="gets-title">
        <div className="ak-container grid gap-10 lg:grid-cols-[0.8fr_1.4fr] lg:gap-16">
          <div>
            <h2 id="gets-title" className="ak-h2">
              {p.gets.title}
            </h2>
            <p className="mt-5 max-w-sm text-tone-mute">{p.gets.dashboard}</p>
          </div>
          <ul className="ak-gets">
            {p.gets.items.map((s) => (
              <li key={s.title}>
                <h3 className="ak-h3">{s.title}</h3>
                <p className="mt-1.5 text-tone-mute">{s.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="tone-cream ak-section !pt-0" aria-labelledby="terms-title">
        <div className="ak-container">
          <div className="ak-card flex flex-wrap items-center justify-between gap-5 p-6 sm:p-8">
            <div className="max-w-xl">
              <h2 id="terms-title" className="ak-h3">
                {p.terms.title}
              </h2>
              <p className="mt-2 text-tone-mute">{p.terms.text}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/$lang/business/legal/$doc"
                params={{ lang, doc: "merchant-terms" }}
                className="ak-btn ak-btn-line"
              >
                {p.terms.merchantTerms}
              </Link>
              <Link
                to="/$lang/business/legal/$doc"
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
        <div className="ak-container grid gap-10 lg:grid-cols-[0.8fr_1.4fr] lg:gap-16">
          <div>
            <h2 id="mfaq-title" className="ak-h2">
              {p.faq.title}
            </h2>
            <Link to="/$lang/business/help" params={{ lang }} className="ak-btn ak-btn-line mt-6">
              {t.biz.help.title}
            </Link>
          </div>
          <FaqList items={faq} />
        </div>
      </section>

      <section className="tone-night ak-section ak-counter" aria-labelledby="band-title">
        <div className="ak-container grid items-center gap-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 id="band-title" className="ak-h2">
              {p.band.title}
            </h2>
            <p className="ak-lead mt-3">{p.band.text}</p>
          </div>
          <div className="tone-cream ak-band-form">
            <ClaimSearch id="band-q" />
          </div>
        </div>
      </section>
    </>
  );
}
