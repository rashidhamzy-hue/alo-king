import { Banknote, Languages, Tag, UserRound } from "lucide-react";
import { useSite } from "../context";

/** Only real facts (DECISIONS §37.3.7): no invented reviews, ratings or order counts. Set as a list, not a card grid. */
export function Trust() {
  const { t } = useSite();
  const s = t.home.trust;
  const icons = [Banknote, Tag, Languages, UserRound];
  return (
    <section className="tone-cream ak-section" aria-labelledby="trust-title">
      <div className="ak-container grid gap-10 lg:grid-cols-[0.8fr_1.4fr] lg:gap-16">
        <h2 id="trust-title" className="ak-h2 lg:sticky lg:top-28 lg:self-start">
          {s.title}
        </h2>
        <ul className="ak-facts">
          {s.items.map((it, i) => {
            const Icon = icons[i] ?? Banknote;
            return (
              <li key={it.title}>
                <span className="ak-facts-icon" aria-hidden="true">
                  <Icon className="size-5" />
                </span>
                <div>
                  <h3 className="ak-h3">{it.title}</h3>
                  <p className="mt-1.5 text-tone-mute">{it.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
