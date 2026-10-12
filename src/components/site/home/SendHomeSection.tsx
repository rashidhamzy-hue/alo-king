import { Link } from "@tanstack/react-router";
import { CreditCard, Camera } from "lucide-react";
import { Clocks } from "../Clocks";
import { useSite } from "../context";

/** Send Home on the home page (DECISIONS §37.3.6): for Lebanese abroad, with both time zones. Card payment and the delivery photo are marked as coming. */
export function SendHomeSection() {
  const { t, lang } = useSite();
  const s = t.home.sendHome;
  return (
    <section className="tone-night ak-contours ak-glow ak-section" aria-labelledby="sendhome-title">
      <div className="ak-container grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="ak-eyebrow text-gold">{s.eyebrow}</p>
          <h2 id="sendhome-title" className="ak-h2 mt-3">
            {s.title}
          </h2>
          <p className="ak-lead mt-4">{s.sub}</p>
          <ul className="mt-6 flex flex-wrap gap-3">
            {[CreditCard, Camera].map((Icon, i) => (
              <li key={i} className="ak-chip">
                <Icon className="size-4 text-gold" aria-hidden="true" />
                {s.badges[i]}
                <span className="ak-chip-gold rounded-full px-2 py-px text-[0.7rem] font-bold">{s.soon}</span>
              </li>
            ))}
          </ul>
          <Link to="/$lang/send-home" params={{ lang }} className="ak-btn ak-btn-gold mt-8">
            {s.cta}
          </Link>
        </div>
        <Clocks here={s.here} there={s.there} pick={s.pick} />
      </div>
    </section>
  );
}
