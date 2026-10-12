import { Banknote, Languages, Tag, UserRound } from "lucide-react";
import { useSite } from "../context";

/** Only real facts (DECISIONS §37.3.7): no invented reviews, ratings or order counts. */
export function Trust() {
  const { t } = useSite();
  const s = t.home.trust;
  const icons = [Banknote, Tag, Languages, UserRound];
  return (
    <section className="tone-cream ak-section" aria-labelledby="trust-title">
      <div className="ak-container">
        <p className="ak-eyebrow">{s.eyebrow}</p>
        <h2 id="trust-title" className="ak-h2 mt-3">
          {s.title}
        </h2>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {s.items.map((it, i) => {
            const Icon = icons[i] ?? Banknote;
            return (
              <li key={it.title} className="ak-card p-6">
                <span className="grid size-11 place-items-center rounded-full bg-ink text-gold">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="ak-h3 mt-4">{it.title}</h3>
                <p className="mt-2 text-tone-mute">{it.text}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
