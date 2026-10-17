import { createFileRoute } from "@tanstack/react-router";
import { buildHead } from "@/lib/site";
import { isWebToken } from "@/lib/web-menu";
import { exploreCategory, exploreQuery, getExplore, type ExplorePage } from "@/lib/web-explore";
import { Explore, ExploreGone } from "@/components/site/webmenu/Explore";

type Search = { t?: string; q?: string; c?: string };

export const Route = createFileRoute("/$lang/e")({
  // Explore (session 5g part B): the customer's signed link (?t=) from the chat's "Explore" button, a search (?q=) or a
  // category (?c=). Never cached by a CDN, never indexed; without a link it says how to get one.
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(typeof s.t === "string" ? { t: isWebToken(s.t) ? s.t : "x" } : {}),
    ...(exploreQuery(s.q) ? { q: exploreQuery(s.q) } : {}),
    ...(exploreCategory(s.c) ? { c: exploreCategory(s.c) } : {}),
  }),
  loaderDeps: ({ search }) => ({ t: search.t, q: search.q, c: search.c }),
  loader: async ({ deps }): Promise<{ page: ExplorePage; token: string }> => {
    if (!deps.t || !isWebToken(deps.t)) return { page: { status: "expired" }, token: "" };
    const page = (await getExplore(deps.t, { q: deps.q, category: deps.c })) ?? {
      status: "expired",
    };
    return { page, token: deps.t };
  },
  headers: (): Record<string, string> => ({
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
  }),
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    const h = buildHead({
      lang,
      path: "/e",
      title: copy.exploreWeb.seoTitle,
      description: copy.home.seo.description,
      info: info ?? { origin: "", indexing: false },
      noindex: true,
    });
    // The token never leaves in a Referer, whatever the navigation (as on the web menu).
    h.meta.push({ name: "referrer", content: "no-referrer" });
    return h;
  },
  component: ExploreRoute,
});

function ExploreRoute() {
  const d = Route.useLoaderData();
  const s = Route.useSearch();
  if (!d) return null;
  if (d.page.status === "ok") return <Explore d={d.page} token={d.token} q={s.q} category={s.c} />;
  if (d.page.status === "outside") return <ExploreGone kind="outside" place={d.page.place} />;
  return <ExploreGone kind={d.page.status === "no_address" ? "no_address" : "expired"} />;
}
