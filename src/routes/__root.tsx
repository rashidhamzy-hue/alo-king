import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { LangProvider } from "@/lib/i18n";
import { captureError } from "@/lib/sentry";
import { dirOf, isLang, type RequestInfo, type SiteLang } from "@/lib/site";
import { getRequestInfo } from "@/lib/request";
import { Crown } from "@/design/Crown";
import { Contours, ContoursDefs } from "@/design/Contours";

/** Shown for any address we don't know: all three languages at once, because the visitor's language is not known yet. */
function NotFoundComponent() {
  return (
    <div className="tone-night ak-site ak-contours ak-glow ak-section grid min-h-screen place-items-center">
      <ContoursDefs />
      <Contours />
      <div className="ak-container text-center">
        <Crown className="mx-auto h-12 w-16 text-gold" />
        <p className="ak-eyebrow mt-6 text-gold">404</p>
        <h1 className="ak-display mt-2" lang="en">
          We couldn't find that page
        </h1>
        <p className="ak-lead mx-auto mt-4" lang="en">
          It may have moved, or the link is not quite right. You can always say Alo on WhatsApp.
        </p>
        <p className="mt-6 text-lg font-bold" lang="ar" dir="rtl">
          ما لقينا هالصفحة
        </p>
        <p className="mt-2 text-lg font-bold" lang="fr">
          Nous n'avons pas trouvé cette page
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a className="ak-btn ak-btn-gold ak-btn-lg" href="/ar" hrefLang="ar" lang="ar">
            العربية
          </a>
          <a className="ak-btn ak-btn-line ak-btn-lg" href="/en" hrefLang="en" lang="en">
            English
          </a>
          <a className="ak-btn ak-btn-line ak-btn-lg" href="/fr" hrefLang="fr" lang="fr">
            Français
          </a>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    captureError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="tone-night ak-site ak-section grid min-h-screen place-items-center">
      <div className="ak-container text-center">
        <h1 className="ak-h2">This page didn't load</h1>
        <p className="ak-lead mx-auto mt-3">
          Something went wrong on our side. Try again in a moment.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="ak-btn ak-btn-gold"
          >
            Try again
          </button>
          <a href="/" className="ak-btn ak-btn-line">
            Alo King
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ info?: RequestInfo }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#17131a" },
      // Only the rebuilt site serves this: scripts/kapso/profile.ts lists a website on the WhatsApp profile only when it
      // answers with this exact tag (an older deployment on the same address does not).
      { name: "alo-king-build", content: "rebuild" },
      { title: "Alo King" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  beforeLoad: async () => ({ info: await getRequestInfo() }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/** The document's language and direction come from the URL, so the server renders the right ones (§37.2, RTL first-class). */
function RootShell({ children }: { children: ReactNode }) {
  const lang = useRouterState({
    select: (s) => {
      const p = s.matches.find((m) => "lang" in (m.params as Record<string, string>))?.params as
        { lang?: string } | undefined;
      return p?.lang && isLang(p.lang) ? (p.lang as SiteLang) : null;
    },
  });
  return (
    <html lang={lang ?? "en"} dir={lang ? dirOf(lang) : "ltr"} className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  // On the public site the language is the URL's: the provider must agree from the first render, or hydration flips the
  // page to left-to-right for a moment and everything shifts (CLS).
  const lang = useRouterState({
    select: (s) => {
      const p = s.matches.find((m) => "lang" in (m.params as Record<string, string>))?.params as
        { lang?: string } | undefined;
      return p?.lang && isLang(p.lang) ? p.lang : null;
    },
  });
  return (
    <LangProvider forced={lang ?? undefined}>
      <Outlet />
    </LangProvider>
  );
}
