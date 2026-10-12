import { Link } from "@tanstack/react-router";
import { Crown } from "@/design/Crown";
import { LANGS, LANG_NAME, splitLangPath } from "@/lib/site";
import { useRouterState } from "@tanstack/react-router";
import { useSite } from "./context";
import { OrderButton } from "./OrderButton";

export function Footer() {
  const { lang, t } = useSite();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const rest = splitLangPath(pathname).path;
  const year = 2026;
  return (
    <footer className="tone-night ak-contours border-t border-tone-line pb-10 pt-14">
      <div className="ak-container grid gap-10 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div>
          <Link to="/$lang" params={{ lang }} className="flex items-center gap-2.5 no-underline" aria-label={t.nav.homeLabel}>
            <Crown className="h-8 w-10 text-gold" />
            <span className="text-xl font-extrabold tracking-tight">{t.site.name}</span>
          </Link>
          <p className="mt-4 max-w-xs text-tone-mute">{t.footer.blurb}</p>
          <OrderButton className="mt-5" size="md" />
        </div>
        <nav aria-label={t.footer.explore}>
          <h2 className="text-sm font-bold uppercase tracking-wider text-tone-mute rtl:tracking-normal">{t.footer.explore}</h2>
          <ul className="mt-3 space-y-2">
            <li>
              <Link to="/$lang/places" params={{ lang }} className="no-underline hover:underline">
                {t.nav.places}
              </Link>
            </li>
            <li>
              <Link to="/$lang/cuisine" params={{ lang }} className="no-underline hover:underline">
                {t.common.cuisines}
              </Link>
            </li>
            <li>
              <Link to="/$lang/send-home" params={{ lang }} className="no-underline hover:underline">
                {t.nav.sendHome}
              </Link>
            </li>
            <li>
              <a href="/for-business" className="no-underline hover:underline">
                {t.nav.merchants}
              </a>
            </li>
          </ul>
        </nav>
        <nav aria-label={t.footer.company}>
          <h2 className="text-sm font-bold uppercase tracking-wider text-tone-mute rtl:tracking-normal">{t.footer.company}</h2>
          <ul className="mt-3 space-y-2">
            <li>
              <Link to="/$lang/help" params={{ lang }} className="no-underline hover:underline">
                {t.nav.help}
              </Link>
            </li>
            <li>
              <Link to="/$lang/contact" params={{ lang }} className="no-underline hover:underline">
                {t.nav.contact}
              </Link>
            </li>
          </ul>
          <h2 className="mt-6 text-sm font-bold uppercase tracking-wider text-tone-mute rtl:tracking-normal">{t.footer.languages}</h2>
          <ul className="mt-3 space-y-2">
            {LANGS.map((l) => (
              <li key={l}>
                <a href={`/${l}${rest === "/" ? "" : rest}`} hrefLang={l} lang={l} className="no-underline hover:underline" aria-current={l === lang ? "true" : undefined}>
                  {LANG_NAME[l]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t.footer.legal}>
          <h2 className="text-sm font-bold uppercase tracking-wider text-tone-mute rtl:tracking-normal">{t.footer.legal}</h2>
          <ul className="mt-3 space-y-2">
            {(["terms", "privacy", "refund", "cookies"] as const).map((d) => (
              <li key={d}>
                <Link to="/$lang/legal/$doc" params={{ lang, doc: d }} className="no-underline hover:underline">
                  {t.footer[d]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="ak-container mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-tone-line-soft pt-6 text-sm text-tone-mute">
        <p>
          © {year} {t.footer.entity}. {t.footer.rights}
        </p>
        <p>{t.footer.madeIn}</p>
      </div>
    </footer>
  );
}
