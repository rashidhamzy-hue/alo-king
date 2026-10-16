import { createFileRoute, notFound } from "@tanstack/react-router";
import { localePath } from "@/lib/site";
import { getItem, isUuid } from "@/lib/site-data";
import { itemHead, itemTrail } from "@/lib/item";
import { crumbsLd } from "@/components/site/Breadcrumbs";
import { ItemView } from "@/components/site/ItemView";

export const Route = createFileRoute("/$lang/i/$id")({
  // One item's page (DECISIONS §39.15.7): the `link` of its product in the WhatsApp catalogue. Anything that is not a
  // UUID is a 404 without asking the database.
  loader: async ({ params }) => {
    if (!isUuid(params.id)) throw notFound();
    const d = await getItem(params.id);
    if (!d) throw notFound();
    return d;
  },
  staleTime: 60_000,
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
  }),
  head: ({ loaderData, match }) => {
    if (!loaderData) return {};
    const { lang, copy, info } = match.context;
    const base = info?.origin ?? "";
    // The same trail as the visible breadcrumbs (ItemView): Home › village › shop › item.
    return itemHead(loaderData, lang, copy, info ?? { origin: "", indexing: false }, [
      crumbsLd(
        itemTrail(loaderData, lang, copy.common.home).map((s) => ({
          label: s.label,
          url: `${base}${localePath(lang, s.path)}`,
        })),
      ),
    ]);
  },
  component: ItemRoute,
});

function ItemRoute() {
  return <ItemView d={Route.useLoaderData()} />;
}
