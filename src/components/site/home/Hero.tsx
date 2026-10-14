import { Check } from "lucide-react";
import { Contours } from "@/design/Contours";
import { fmt } from "@/lib/site";
import { useSite } from "../context";
import { OrderButton } from "../OrderButton";
import { ChatDemo } from "./ChatDemo";

/**
 * Live chat hero (DECISIONS §37.3.1). The word the brand is named after, "ألو" (hello), stands behind the headline as a
 * lit sign; the headline is static text (the largest paint); the chat plays beside it. The status line is live: how many
 * places are switched on, from the database.
 */
export function Hero() {
  const { t, overview } = useSite();
  const h = t.home.hero;
  const n = overview.places.length;
  return (
    <section
      className="tone-night ak-contours ak-glow ak-section ak-hero !pb-16 !pt-10 sm:!pt-16 lg:!pt-20"
      aria-labelledby="hero-title"
    >
      <Contours />
      <span className="ak-hero-word" aria-hidden="true" lang="ar" dir="rtl">
        ألو
      </span>
      <div className="ak-container grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <div className="relative">
          <p className="ak-status">
            <span
              className={n > 0 ? "ak-lantern" : "ak-lantern ak-lantern-off"}
              aria-hidden="true"
            />
            {n > 0 ? fmt(h.statusLive, { n }) : h.statusSoon}
          </p>
          <h1 id="hero-title" className="ak-display mt-5">
            {h.title}
          </h1>
          <p className="ak-lead mt-6">{h.sub}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <OrderButton />
            <a href="#how" className="ak-btn ak-btn-line ak-btn-lg">
              {t.cta.howItWorks}
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[0.95rem] font-semibold text-tone-mute">
            {h.points.map((p) => (
              <li key={p} className="flex items-center gap-2">
                <Check className="size-4 text-gold" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <ChatDemo />
      </div>
    </section>
  );
}
