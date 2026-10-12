import { Check, MapPin, Plus } from "lucide-react";
import { Crown } from "@/design/Crown";
import { lbpAt, usd } from "@/lib/site";
import { useSite } from "../context";

// Illustrative menu prices for the phone mock-ups (an example, like the chat demo; real prices come from each shop).
const PRICES = [3.5, 4, 2.5];

function Screen({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="ak-phone ak-phone-sm" role="img" aria-label={title}>
      <div className="ak-phone-screen !min-h-[21rem]">
        <div className="ak-chat-head !py-3">
          <span className="grid size-8 place-items-center rounded-full bg-gold text-ink">
            <Crown className="h-4 w-5" />
          </span>
          <span className="text-sm font-bold">Alo King</span>
        </div>
        <div className="ak-chat-body !gap-2.5 !px-3">{children}</div>
      </div>
    </div>
  );
}

/** Pin, pick, confirm, as three phone frames (DECISIONS §37.3.2). Built from markup, not images: sharp at any size. */
export function ThreeTaps() {
  const { t, overview, lang } = useSite();
  const s = t.home.taps;
  const total = 2 * 3.5 + 1 + (overview.fees.min_usd ?? 0);
  return (
    <section id="how" className="tone-cream ak-section" aria-labelledby="taps-title">
      <div className="ak-container">
        <p className="ak-eyebrow">{s.eyebrow}</p>
        <h2 id="taps-title" className="ak-h2 mt-3 max-w-3xl">
          {s.title}
        </h2>
        <p className="ak-lead mt-4">{s.sub}</p>
        <ol className="mt-12 grid gap-12 md:grid-cols-3 md:gap-8">
          {s.steps.map((step, i) => (
            <li
              key={step.title}
              className="flex flex-col items-center text-center md:items-start md:text-start"
            >
              <div className="mb-5 flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-full bg-ink text-lg font-extrabold text-gold">
                  {step.n}
                </span>
                <h3 className="ak-h3">{step.title}</h3>
              </div>
              <p className="mb-7 max-w-xs text-tone-mute">{step.text}</p>
              <div className="mt-auto w-full">
                {i === 0 && (
                  <Screen title={step.title}>
                    <div className="ak-bubble ak-bubble-bot">{s.phone1.button}</div>
                    <div className="ak-route !mt-0 !h-28 self-stretch">
                      <svg
                        className="ak-route-bg"
                        viewBox="0 0 280 112"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <circle cx="140" cy="62" r="26" fill="rgb(244 182 60 / 0.14)" />
                        <circle cx="140" cy="62" r="9" fill="rgb(244 182 60 / 0.3)" />
                      </svg>
                      <MapPin
                        className="absolute start-1/2 top-[34%] size-8 -translate-x-1/2 text-gold rtl:translate-x-1/2"
                        aria-hidden="true"
                        strokeWidth={2.4}
                      />
                      <span className="absolute bottom-1.5 start-2 rounded bg-ink/80 px-1.5 text-[0.7rem] text-tone-fg">
                        {s.phone1.place}
                      </span>
                    </div>
                    <div className="ak-wa-card !w-full">
                      <div className="ak-wa-btn !mt-0 !border-0">📍 {s.phone1.button}</div>
                    </div>
                  </Screen>
                )}
                {i === 1 && (
                  <Screen title={step.title}>
                    <div className="ak-wa-card !w-full">
                      <strong>{s.phone2.shop}</strong>
                      <hr />
                      <ul className="space-y-2">
                        {s.phone2.rows.map((r, k) => (
                          <li key={r} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 leading-snug">
                              {r}
                              <bdi className="ak-num block text-xs opacity-75">
                                {usd(PRICES[k] ?? 0)}
                              </bdi>
                            </span>
                            <span
                              className={`grid size-7 shrink-0 place-items-center rounded-full ${k === 0 ? "bg-gold text-ink" : "border border-tone-line text-gold"}`}
                              role="img"
                              aria-label={s.phone2.add}
                            >
                              {k === 0 ? (
                                <Check className="size-4" aria-hidden="true" />
                              ) : (
                                <Plus className="size-4" aria-hidden="true" />
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Screen>
                )}
                {i === 2 && (
                  <Screen title={step.title}>
                    <div className="ak-wa-card !w-full">
                      <ul className="space-y-1 text-[0.85rem]">
                        {t.home.demo.items.map((it) => (
                          <li key={it.name} className="flex justify-between">
                            <span>
                              <bdi className="ak-num">{it.n}×</bdi> {it.name}
                            </span>
                            <bdi className="ak-num">{usd(it.n * it.price)}</bdi>
                          </li>
                        ))}
                      </ul>
                      <hr />
                      <div className="flex items-baseline justify-between font-bold">
                        <span>{s.phone3.total}</span>
                        <span className="text-end">
                          <bdi className="ak-num">{usd(total)}</bdi>
                          {overview.rate ? (
                            <span className="block text-xs font-medium opacity-75">
                              <bdi className="ak-num">{lbpAt(total, overview.rate, lang)}</bdi>{" "}
                              {t.common.lbp}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </div>
                    <div className="ak-bubble ak-bubble-me !mt-1 self-stretch !max-w-none text-center font-bold">
                      ✅ {s.phone3.confirm}
                    </div>
                  </Screen>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
