import type { ReactNode } from "react";
import { Contours } from "@/design/Contours";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";
import { useSite } from "./context";

/** The top of an inner page: breadcrumbs, a title, one factual lead, and room for the page's one action. */
export function PageHero({
  eyebrow,
  title,
  lead,
  crumbs,
  tone,
  aside,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  crumbs?: Crumb[];
  tone?: "night" | "cream";
  children?: ReactNode;
  /** A picture beside the title on wide screens (the place page's map). */
  aside?: ReactNode;
}) {
  const { side } = useSite();
  // The business side reads by day (DECISIONS §39.11); the customer side lives at night.
  tone ??= side === "business" ? "cream" : "night";
  return (
    <section
      className={`${tone === "night" ? "tone-night ak-contours ak-glow" : "tone-cream"} ak-section !pb-12 !pt-8 sm:!pt-12`}
    >
      {tone === "night" && <Contours />}
      <div
        className={`ak-container ${aside ? "grid items-center gap-10 lg:grid-cols-[1.3fr_0.7fr]" : ""}`}
      >
        <div>
          {crumbs && <Breadcrumbs items={crumbs} />}
          {eyebrow && (
            <p className={`ak-eyebrow mt-6 ${tone === "night" ? "text-gold" : ""}`}>{eyebrow}</p>
          )}
          <h1 className={`ak-h1 max-w-4xl ${eyebrow ? "mt-3" : "mt-6"}`}>{title}</h1>
          {lead && <p className="ak-lead mt-5">{lead}</p>}
          {children && <div className="mt-8 flex flex-wrap items-center gap-3">{children}</div>}
        </div>
        {aside}
      </div>
    </section>
  );
}
