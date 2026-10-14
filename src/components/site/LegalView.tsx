import { Link } from "@tanstack/react-router";
import type { LegalDoc } from "@/content";
import { useSite } from "./context";
import { PageHero } from "./PageHero";

/** The customers' legal pages, and the businesses' (DECISIONS §24.2, §39.11: each side has its own). */
export const CUSTOMER_LEGAL = [
  ["terms", "terms"],
  ["privacy", "privacy"],
  ["refund", "refund"],
  ["cookies", "cookies"],
] as const;
export const BUSINESS_LEGAL = [
  ["merchant-terms", "merchantTerms"],
  ["collection-mandate", "collectionMandate"],
  ["privacy", "privacy"],
] as const;
export type LegalSide = "customer" | "business";

export function LegalView({
  side,
  doc,
  updatedOn,
  draftNote,
  entityHeading,
  entityText,
}: {
  side: LegalSide;
  doc: LegalDoc;
  updatedOn: string;
  draftNote: string;
  entityHeading: string;
  entityText: string;
}) {
  const { t, lang } = useSite();
  const date = new Intl.DateTimeFormat(lang === "ar" ? "ar-u-nu-latn" : lang, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${updatedOn}T00:00:00Z`));
  const links = side === "business" ? BUSINESS_LEGAL : CUSTOMER_LEGAL;
  return (
    <>
      <PageHero
        title={doc.title}
        lead={doc.intro}
        crumbs={
          side === "business"
            ? [{ label: t.biz.nav.home, to: "/$lang/business" }, { label: doc.title }]
            : [{ label: "", to: "/$lang" }, { label: doc.title }]
        }
      />
      <section className="tone-cream ak-section !pt-12">
        <div className="ak-container grid gap-12 lg:grid-cols-[1fr_16rem]">
          <article className="ak-prose">
            <p className="text-sm font-semibold text-tone-mute">
              {t.common.updated.replace("{date}", date)}
            </p>
            <p className="ak-card mt-4 p-4 text-sm text-tone-mute">{draftNote}</p>
            {doc.sections.map((s) => (
              <section key={s.h}>
                <h2>{s.h}</h2>
                {s.p?.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                {s.ul && (
                  <ul>
                    {s.ul.map((li) => (
                      <li key={li}>{li}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
            <h2>{entityHeading}</h2>
            <p>{entityText}</p>
          </article>
          <nav aria-label={t.footer.legal} className="lg:sticky lg:top-24 lg:self-start">
            <ul className="ak-legal-nav">
              {links.map(([s, key]) => (
                <li key={s}>
                  {side === "business" ? (
                    <Link
                      to="/$lang/business/legal/$doc"
                      params={{ lang, doc: s }}
                      activeProps={{ "aria-current": "page" }}
                    >
                      {t.footer[key]}
                    </Link>
                  ) : (
                    <Link
                      to="/$lang/legal/$doc"
                      params={{ lang, doc: s }}
                      activeProps={{ "aria-current": "page" }}
                    >
                      {t.footer[key]}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>
    </>
  );
}
