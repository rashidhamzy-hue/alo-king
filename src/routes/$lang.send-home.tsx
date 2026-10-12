import { createFileRoute } from "@tanstack/react-router";
import { buildHead } from "@/lib/site";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { OrderButton } from "@/components/site/OrderButton";
import { Clocks } from "@/components/site/Clocks";
import { FaqList } from "@/components/site/FaqList";
import { faqLd } from "@/lib/faq";
import { Contours } from "@/design/Contours";
import { CreditCard, Camera } from "lucide-react";

export const Route = createFileRoute("/$lang/send-home")({
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    const faq = copy.sendHomePage.faq.map((f, i) => ({ id: String(i), q: f.q, a: f.a }));
    return buildHead({
      lang,
      path: "/send-home",
      title: copy.sendHomePage.seoTitle,
      description: copy.sendHomePage.seoDescription,
      info: info ?? { origin: "", indexing: false },
      jsonLd: [faqLd(faq)],
    });
  },
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
  }),
  component: SendHomePage,
});

function SendHomePage() {
  const { t } = useSite();
  const s = t.sendHomePage;
  const faq = s.faq.map((f, i) => ({ id: String(i), q: f.q, a: f.a }));
  return (
    <>
      <PageHero
        eyebrow={s.eyebrow}
        title={s.title}
        lead={s.lead}
        crumbs={[{ label: "", to: "/$lang" }, { label: t.nav.sendHome }]}
      >
        <OrderButton text={t.wa.sendHome} />
        <ul className="flex flex-wrap gap-2">
          {[CreditCard, Camera].map((Icon, i) => (
            <li key={i} className="ak-chip">
              <Icon className="size-4 text-gold" aria-hidden="true" />
              {t.home.sendHome.badges[i]}
              <span className="ak-chip-gold rounded-full px-2 py-px text-[0.7rem] font-bold">
                {t.common.comingSoon}
              </span>
            </li>
          ))}
        </ul>
      </PageHero>

      <section className="tone-cream ak-section !pt-12" aria-labelledby="sh-steps">
        <div className="ak-container">
          <div className="ak-card ak-callout mb-12 flex flex-col gap-2 p-6 sm:p-8">
            <h2 className="ak-h3">{s.soonTitle}</h2>
            <p className="text-tone-mute">{s.soonText}</p>
          </div>
          <h2 id="sh-steps" className="ak-h2">
            {s.stepsTitle}
          </h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {s.steps.map((st, i) => (
              <li key={st.title} className="ak-card p-6">
                <span className="grid size-10 place-items-center rounded-full bg-ink text-lg font-extrabold text-gold">
                  {i + 1}
                </span>
                <h3 className="ak-h3 mt-4">{st.title}</h3>
                <p className="mt-2 text-tone-mute">{st.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="tone-night ak-contours ak-section" aria-labelledby="sh-clocks">
        <Contours />
        <div className="ak-container grid items-center gap-10 lg:grid-cols-[1fr_1fr]">
          <h2 id="sh-clocks" className="ak-h2">
            {s.clocksTitle}
          </h2>
          <Clocks here={s.clockHere} there={s.clockThere} pick={s.clockPick} />
        </div>
      </section>

      <section className="tone-cream ak-section" aria-labelledby="sh-faq">
        <div className="ak-container grid gap-10 lg:grid-cols-[0.8fr_1.4fr]">
          <div>
            <h2 id="sh-faq" className="ak-h2">
              {s.faqTitle}
            </h2>
            <div className="mt-6">
              <OrderButton text={t.wa.sendHome} variant="ink" />
            </div>
          </div>
          <FaqList items={faq} />
        </div>
      </section>
    </>
  );
}
