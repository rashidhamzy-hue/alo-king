import { Ballat } from "@/design/Ballat";
import { CashIcon } from "@/design/icons";
import { useSite } from "../context";

/**
 * How customers pay (DECISIONS §39.15.5): cash on delivery, in dollars or lira, with two plain banknotes; Whish appears as a
 * neutral wordmark with a "Soon" chip until online payment is live (§20.1). Nothing here says or suggests Whish works.
 */
export function PayBand({
  tone = "night",
  flush = false,
}: {
  tone?: "night" | "cream";
  /** Follows a section of the same tone: no space above. */
  flush?: boolean;
}) {
  const { t } = useSite();
  const p = t.home.pay;
  return (
    <section
      className={`tone-${tone} ak-section ak-ballat ${flush ? "!pt-0" : "!pt-12 sm:!pt-16"} !pb-12 sm:!pb-16`}
      aria-labelledby="pay-title"
    >
      <Ballat />
      <div className="ak-container">
        <div className="ak-pay">
          <div className="ak-pay-cash" aria-hidden="true">
            <figure>
              <CashIcon sign="$" />
              <figcaption>{p.dollars}</figcaption>
            </figure>
            <figure>
              <CashIcon sign="LL" />
              <figcaption>{p.lira}</figcaption>
            </figure>
          </div>
          <div>
            <p className="ak-eyebrow">{p.eyebrow}</p>
            <h2 id="pay-title" className="ak-h3 mt-2">
              {p.title}
            </h2>
            <p className="mt-2 text-tone-mute">{p.text}</p>
          </div>
          <div className="ak-pay-whish">
            <span className="ak-whish">
              <span className="ak-whish-word" lang="en" dir="ltr">
                Whish
              </span>
              <span className="ak-chip">{p.soon}</span>
            </span>
            <span className="text-sm text-tone-mute">{p.whishNote}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
