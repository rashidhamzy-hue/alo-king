import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import jakartaLatin from "../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2?url";
import plexArabic400 from "../design/fonts/plex-arabic-400.woff2?url";
import plexArabic700 from "../design/fonts/plex-arabic-700.woff2?url";
import { loadCopy } from "@/content";
import { isLang, type SiteLang } from "@/lib/site";
import { getOverview } from "@/lib/site-data";
import { ContoursDefs } from "@/design/Contours";
import { SiteProvider } from "@/components/site/context";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";

// The public site lives under /ar, /en and /fr (DECISIONS §24.5). Anything else is a real 404.
export const Route = createFileRoute("/$lang")({
  beforeLoad: async ({ params }) => {
    if (!isLang(params.lang)) throw notFound();
    const lang: SiteLang = params.lang;
    return { lang, copy: await loadCopy(lang) };
  },
  loader: async () => ({ overview: await getOverview() }),
  // The fonts the page needs are fetched with the HTML, so text appears in its final face and does not reflow (CLS).
  head: ({ params }) => ({
    links: (params.lang === "ar"
      ? [plexArabic400, plexArabic700, jakartaLatin]
      : [jakartaLatin]
    ).map((href) => ({
      rel: "preload",
      as: "font",
      type: "font/woff2",
      href,
      crossOrigin: "anonymous" as const,
    })),
  }),
  staleTime: 60_000,
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
  }),
  component: LangLayout,
});

function LangLayout() {
  const { lang, copy, info } = Route.useRouteContext();
  const { overview } = Route.useLoaderData();
  return (
    <SiteProvider
      value={{ lang, t: copy, info: info ?? { origin: "", indexing: false }, overview }}
    >
      <div className="ak-site tone-night min-h-screen">
        <ContoursDefs />
        <a className="ak-skip" href="#main">
          {copy.a11y.skip}
        </a>
        <Header />
        <main id="main">
          <Outlet />
        </main>
        <Footer />
      </div>
    </SiteProvider>
  );
}
