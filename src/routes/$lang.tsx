import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { loadCopy } from "@/content";
import { isLang, type SiteLang } from "@/lib/site";
import { getOverview } from "@/lib/site-data";
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
  staleTime: 60_000,
  headers: () => ({ "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600" }),
  component: LangLayout,
});

function LangLayout() {
  const { lang, copy, info } = Route.useRouteContext();
  const { overview } = Route.useLoaderData();
  return (
    <SiteProvider value={{ lang, t: copy, info: info ?? { origin: "", indexing: false }, overview }}>
      <div className="ak-site tone-night min-h-screen">
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
