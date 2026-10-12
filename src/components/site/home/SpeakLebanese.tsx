import { useSite } from "../context";

/** Arabic, Arabizi, English and French examples flip through (DECISIONS §37.3.3). CSS only; all four stay in the HTML. */
export function SpeakLebanese() {
  const { t } = useSite();
  const s = t.home.speak;
  return (
    <section className="tone-night ak-contours ak-section" aria-labelledby="speak-title">
      <div className="ak-container grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <p className="ak-eyebrow text-gold">{s.eyebrow}</p>
          <h2 id="speak-title" className="ak-h2 mt-3">
            {s.title}
          </h2>
          <p className="ak-lead mt-4">{s.sub}</p>
        </div>
        <div className="ak-card p-6 sm:p-9">
          <div className="ak-cycle min-h-[7.5rem] items-center text-center sm:min-h-[8.5rem]" aria-label={s.phrases.map((p) => p.text).join(" · ")}>
            {s.phrases.map((p, i) => (
              <p
                key={p.lang}
                lang={p.lang === "العربية" ? "ar" : p.lang === "Français" ? "fr" : "en"}
                dir={p.dir}
                className="mx-auto max-w-[20ch] text-[clamp(1.7rem,1rem+3.2vw,2.9rem)] font-extrabold leading-[1.2] tracking-tight"
                style={{ ["--i" as string]: i } as React.CSSProperties}
              >
                “{p.text}”
              </p>
            ))}
          </div>
          <ul className="mt-6 flex flex-wrap justify-center gap-2" aria-hidden="true">
            {s.phrases.map((p, i) => (
              <li key={p.lang} className="ak-chip ak-cycle-chip" style={{ ["--i" as string]: i } as React.CSSProperties}>
                {p.lang}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
