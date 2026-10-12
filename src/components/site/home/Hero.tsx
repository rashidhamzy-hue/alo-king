import { Check } from "lucide-react";
import { Contours } from "@/design/Contours";
import { useSite } from "../context";
import { OrderButton } from "../OrderButton";
import { ChatDemo } from "./ChatDemo";

/** Live chat hero (DECISIONS §37.3.1). The headline is static text (it is the largest paint); the chat plays beside it. */
export function Hero() {
  const { t } = useSite();
  const h = t.home.hero;
  return (
    <section
      className="tone-night ak-contours ak-glow ak-section !pb-16 !pt-10 sm:!pt-16 lg:!pt-20"
      aria-labelledby="hero-title"
    >
      <Contours />
      <div className="ak-container grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <div>
          <p className="ak-eyebrow text-gold">{h.eyebrow}</p>
          <h1 id="hero-title" className="ak-display mt-4">
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
