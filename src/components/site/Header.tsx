import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, Menu, X } from "lucide-react";
import { Crown } from "@/design/Crown";
import { LANGS, LANG_NAME, swapLang } from "@/lib/site";
import { useSite } from "./context";
import { OrderButton } from "./OrderButton";

function LangSwitch() {
  const { lang, t } = useSite();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <details className="relative">
      <summary
        className="ak-btn ak-btn-line ak-btn-sm list-none gap-1 [&::-webkit-details-marker]:hidden"
        aria-label={`${lang.toUpperCase()} · ${t.nav.language}`}
      >
        <span className="font-bold uppercase" lang={lang}>
          {lang}
        </span>
        <ChevronDown className="size-4" aria-hidden="true" />
      </summary>
      <ul className="ak-pop absolute end-0 top-full z-50 mt-2 min-w-40 p-1.5">
        {LANGS.map((l) => (
          <li key={l}>
            <a
              href={swapLang(pathname, l)}
              hrefLang={l}
              lang={l}
              aria-current={l === lang ? "true" : undefined}
              className="ak-pop-item justify-between"
            >
              {LANG_NAME[l]}
              <span className="text-xs uppercase opacity-70">{l}</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

type NavTo =
  | "/$lang/places"
  | "/$lang/send-home"
  | "/$lang/help"
  | "/$lang/contact"
  | "/$lang/business"
  | "/$lang/business/help"
  | "/$lang/business/drivers";
type NavLink = { to: NavTo; label: string; hash?: string };

function MobileMenu({
  links,
  label,
  extra,
}: {
  links: NavLink[];
  label: string;
  extra?: React.ReactNode;
}) {
  const { lang } = useSite();
  return (
    <details className="relative lg:hidden">
      <summary
        className="ak-btn ak-btn-line ak-btn-sm list-none !px-3 [&::-webkit-details-marker]:hidden"
        aria-label={label}
      >
        <Menu className="size-5 [details[open]_&]:hidden" aria-hidden="true" />
        <X className="hidden size-5 [details[open]_&]:block" aria-hidden="true" />
      </summary>
      <nav className="ak-pop absolute end-0 top-full z-50 mt-2 w-64 p-2" aria-label={label}>
        {links.map((l) => (
          <Link
            key={l.to + (l.hash ?? "")}
            to={l.to}
            params={{ lang }}
            hash={l.hash}
            className="ak-pop-item"
          >
            {l.label}
          </Link>
        ))}
        {extra}
      </nav>
    </details>
  );
}

/**
 * The customers' header (DECISIONS §39.11): ordering, the delivery map, Send Home, help. No merchant pages: the one way
 * to the business side is the "For businesses" link at the foot of the home page.
 */
export function Header() {
  const { lang, t } = useSite();
  const links: NavLink[] = [
    { to: "/$lang/places", label: t.nav.places },
    { to: "/$lang/send-home", label: t.nav.sendHome },
    { to: "/$lang/help", label: t.nav.help },
    { to: "/$lang/contact", label: t.nav.contact },
  ];
  return (
    <header className="tone-night ak-head">
      <div className="ak-container ak-head-row">
        <Link to="/$lang" params={{ lang }} className="ak-head-brand" aria-label={t.nav.homeLabel}>
          <Crown className="h-7 w-9 text-gold" />
          <span>{t.site.name}</span>
        </Link>
        <nav className="ak-head-nav" aria-label={t.nav.primary}>
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              params={{ lang }}
              className="ak-head-link"
              activeProps={{ "aria-current": "page" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <OrderButton
            size="sm"
            label={t.cta.orderShort}
            iconOnlyOnMobile
            className="max-sm:!px-3"
          />
          <LangSwitch />
          <MobileMenu links={links} label={t.nav.menu} />
        </div>
      </div>
    </header>
  );
}

/** The businesses' header: daylight, their own pages, sign-in and the one action, claiming a shop. */
export function BizHeader() {
  const { lang, t } = useSite();
  const b = t.biz.nav;
  const links: NavLink[] = [
    { to: "/$lang/business", label: b.pricing, hash: "pricing" },
    { to: "/$lang/business/help", label: b.help },
    { to: "/$lang/business/drivers", label: b.drivers },
  ];
  return (
    <header className="tone-cream ak-head ak-head-biz">
      <div className="ak-container ak-head-row">
        <Link to="/$lang/business" params={{ lang }} className="ak-head-brand" aria-label={b.home}>
          <Crown className="h-7 w-9 text-ink" />
          <span>{t.site.name}</span>
          <span className="ak-biz-tag">{b.short}</span>
        </Link>
        <nav className="ak-head-nav" aria-label={b.primary}>
          {links.map((l) => (
            <Link
              key={l.to + (l.hash ?? "")}
              to={l.to}
              params={{ lang }}
              hash={l.hash}
              className="ak-head-link"
              activeOptions={{ includeHash: !!l.hash }}
              activeProps={l.hash ? {} : { "aria-current": "page" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <Link to="/merchant" className="ak-btn ak-btn-line ak-btn-sm ak-head-signin">
            {b.signIn}
          </Link>
          <Link
            to="/$lang/business/claim"
            params={{ lang }}
            className="ak-btn ak-btn-ink ak-btn-sm ak-head-claim"
          >
            {b.claim}
          </Link>
          <LangSwitch />
          <MobileMenu
            links={links}
            label={t.nav.menu}
            extra={
              <>
                <Link to="/$lang/business/claim" params={{ lang }} className="ak-pop-item">
                  {b.claim}
                </Link>
                <Link to="/merchant" className="ak-pop-item">
                  {b.signIn}
                </Link>
              </>
            }
          />
        </div>
      </div>
    </header>
  );
}
