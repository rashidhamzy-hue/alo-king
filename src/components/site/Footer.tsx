import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Contours } from "@/design/Contours";
import { Crown } from "@/design/Crown";
import { LANGS, LANG_NAME, splitLangPath } from "@/lib/site";
import { useSite } from "./context";
import { BUSINESS_LEGAL, CUSTOMER_LEGAL } from "./LegalView";
import { OrderButton } from "./OrderButton";

function Col({ title, children }: { title: string; children: ReactNode }) {
  return (
    <nav aria-label={title}>
      <h2 className="ak-foot-title">{title}</h2>
      <ul className="mt-4 space-y-2.5">{children}</ul>
    </nav>
  );
}

function Languages() {
  const { lang, t } = useSite();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const rest = splitLangPath(pathname).path;
  return (
    <ul className="ak-foot-langs" aria-label={t.footer.languages}>
      {LANGS.map((l) => (
        <li key={l}>
          <a
            href={`/${l}${rest === "/" ? "" : rest}`}
            hrefLang={l}
            lang={l}
            aria-current={l === lang ? "true" : undefined}
          >
            {LANG_NAME[l]}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The customers' footer (DECISIONS §39.11, §39.15.5): no merchant terms; one link to the business side. */
export function Footer() {
  const { lang, t } = useSite();
  return (
    <footer className="tone-night ak-contours ak-foot">
      <Contours />
      <div className="ak-container">
        <div className="ak-foot-sign">
          <Link
            to="/$lang"
            params={{ lang }}
            className="flex items-center gap-3 no-underline"
            aria-label={t.nav.homeLabel}
          >
            <Crown className="h-9 w-11 text-gold" />
            <span className="text-2xl font-extrabold tracking-tight">{t.site.name}</span>
          </Link>
          <p className="ak-foot-blurb">{t.footer.blurb}</p>
          <OrderButton size="md" />
        </div>
        <div className="ak-foot-cols">
          <Col title={t.footer.explore}>
            <li>
              <Link to="/$lang/places" params={{ lang }}>
                {t.nav.places}
              </Link>
            </li>
            <li>
              <Link to="/$lang/cuisine" params={{ lang }}>
                {t.common.cuisines}
              </Link>
            </li>
            <li>
              <Link to="/$lang/send-home" params={{ lang }}>
                {t.nav.sendHome}
              </Link>
            </li>
          </Col>
          <Col title={t.footer.company}>
            <li>
              <Link to="/$lang/help" params={{ lang }}>
                {t.nav.help}
              </Link>
            </li>
            <li>
              <Link to="/$lang/contact" params={{ lang }}>
                {t.nav.contact}
              </Link>
            </li>
            <li>
              <Link to="/$lang/business" params={{ lang }}>
                {t.nav.business}
              </Link>
            </li>
          </Col>
          <Col title={t.footer.legal}>
            {CUSTOMER_LEGAL.map(([d, key]) => (
              <li key={d}>
                <Link to="/$lang/legal/$doc" params={{ lang, doc: d }}>
                  {t.footer[key]}
                </Link>
              </li>
            ))}
            {/* DECISIONS §38.1: who took the photos the shops did not take themselves. */}
            <li>
              <Link to="/$lang/credits" params={{ lang }}>
                {t.footer.credits}
              </Link>
            </li>
          </Col>
        </div>
        <div className="ak-foot-base">
          <Languages />
          <p>
            © 2026 {t.footer.entity}. {t.footer.rights}
          </p>
        </div>
      </div>
    </footer>
  );
}

/** The businesses' footer: their pages and terms only, and one way back to ordering. */
export function BizFooter() {
  const { lang, t } = useSite();
  const b = t.biz;
  return (
    <footer className="tone-cream ak-foot ak-foot-biz">
      <div className="ak-container">
        <div className="ak-foot-sign">
          <Link
            to="/$lang/business"
            params={{ lang }}
            className="flex items-center gap-3 no-underline"
            aria-label={b.nav.home}
          >
            <Crown className="h-9 w-11 text-ink" />
            <span className="text-2xl font-extrabold tracking-tight">{t.site.name}</span>
            <span className="ak-biz-tag">{b.nav.short}</span>
          </Link>
          <p className="ak-foot-blurb">{b.footer.blurb}</p>
          <Link to="/$lang/business/claim" params={{ lang }} className="ak-btn ak-btn-ink">
            {b.nav.claim}
          </Link>
        </div>
        <div className="ak-foot-cols">
          <Col title={b.nav.primary}>
            <li>
              <Link to="/$lang/business" params={{ lang }} hash="pricing">
                {b.nav.pricing}
              </Link>
            </li>
            <li>
              <Link to="/$lang/business/claim" params={{ lang }}>
                {b.nav.claim}
              </Link>
            </li>
            <li>
              <Link to="/$lang/business/register" params={{ lang }}>
                {t.merchantsPage.hero.register}
              </Link>
            </li>
            <li>
              <Link to="/$lang/business/drivers" params={{ lang }}>
                {b.nav.drivers}
              </Link>
            </li>
          </Col>
          <Col title={b.nav.help}>
            <li>
              <Link to="/$lang/business/help" params={{ lang }}>
                {b.help.title}
              </Link>
            </li>
            <li>
              <Link to="/$lang/business/contact" params={{ lang }}>
                {b.nav.contact}
              </Link>
            </li>
            <li>
              <Link to="/merchant">{b.nav.signIn}</Link>
            </li>
          </Col>
          <Col title={b.footer.legal}>
            {BUSINESS_LEGAL.map(([d, key]) => (
              <li key={d}>
                <Link to="/$lang/business/legal/$doc" params={{ lang, doc: d }}>
                  {t.footer[key]}
                </Link>
              </li>
            ))}
          </Col>
        </div>
        <div className="ak-foot-base">
          <Languages />
          <p>
            © 2026 {t.footer.entity}. {t.footer.rights}
          </p>
          <Link to="/$lang" params={{ lang }} className="ak-foot-back">
            {b.nav.customerSite}
          </Link>
        </div>
      </div>
    </footer>
  );
}
