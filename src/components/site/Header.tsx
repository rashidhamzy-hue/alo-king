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
      <ul className="tone-night absolute end-0 top-full z-50 mt-2 min-w-40 rounded-2xl border border-tone-line p-1.5 shadow-2xl">
        {LANGS.map((l) => (
          <li key={l}>
            <a
              href={swapLang(pathname, l)}
              hrefLang={l}
              lang={l}
              aria-current={l === lang ? "true" : undefined}
              className="flex items-center justify-between gap-4 rounded-xl px-3 py-2.5 font-semibold hover:bg-tone-surface-2 aria-[current=true]:text-gold"
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

export function Header() {
  const { lang, t } = useSite();
  const links = [
    { to: "/$lang/places" as const, label: t.nav.places },
    { to: "/$lang/send-home" as const, label: t.nav.sendHome },
    { to: "/$lang/help" as const, label: t.nav.help },
    { to: "/$lang/contact" as const, label: t.nav.contact },
  ];
  return (
    <header className="tone-night sticky top-0 z-40 border-b border-tone-line bg-[color-mix(in_srgb,var(--ink)_88%,transparent)] backdrop-blur-xl">
      <div className="ak-container flex h-16 items-center gap-2 sm:gap-3">
        <Link
          to="/$lang"
          params={{ lang }}
          className="flex items-center gap-2.5 text-tone-fg no-underline"
          aria-label={t.nav.homeLabel}
        >
          <Crown className="h-7 w-9 text-gold" />
          <span className="text-lg font-extrabold tracking-tight">{t.site.name}</span>
        </Link>
        <nav className="ms-6 hidden items-center gap-1 lg:flex" aria-label={t.nav.primary}>
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              params={{ lang }}
              className="rounded-full px-3.5 py-2 text-[0.95rem] font-semibold text-tone-mute no-underline hover:text-tone-fg"
              activeProps={{ className: "text-tone-fg", "aria-current": "page" }}
            >
              {l.label}
            </Link>
          ))}
          <a
            href="/for-business"
            className="rounded-full px-3.5 py-2 text-[0.95rem] font-semibold text-tone-mute no-underline hover:text-tone-fg"
          >
            {t.nav.merchants}
          </a>
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <OrderButton
            size="sm"
            label={t.cta.orderShort}
            iconOnlyOnMobile
            className="max-sm:!px-3"
          />
          <LangSwitch />
          <details className="relative lg:hidden">
            <summary
              className="ak-btn ak-btn-line ak-btn-sm list-none !px-3 [&::-webkit-details-marker]:hidden"
              aria-label={t.nav.menu}
            >
              <Menu className="size-5 [details[open]_&]:hidden" aria-hidden="true" />
              <X className="hidden size-5 [details[open]_&]:block" aria-hidden="true" />
            </summary>
            <nav
              className="tone-night absolute end-0 top-full z-50 mt-2 w-64 rounded-2xl border border-tone-line p-2 shadow-2xl"
              aria-label={t.nav.menu}
            >
              {links.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  params={{ lang }}
                  className="block rounded-xl px-3 py-3 font-semibold no-underline hover:bg-tone-surface-2"
                >
                  {l.label}
                </Link>
              ))}
              <a
                href="/for-business"
                className="block rounded-xl px-3 py-3 font-semibold no-underline hover:bg-tone-surface-2"
              >
                {t.nav.merchants}
              </a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
