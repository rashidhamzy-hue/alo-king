import { createFileRoute, notFound } from "@tanstack/react-router";
import { localePath, pickName } from "@/lib/site";
import { getItem, isUuid } from "@/lib/site-data";
import { itemHead } from "@/lib/item";
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
    const d = loaderData;
    const base = info?.origin ?? "";
    const place = pickName(d.vendor, "place", lang);
    return itemHead(d, lang, copy, info ?? { origin: "", indexing: false }, [
      crumbsLd([
        { label: copy.common.home, url: `${base}${localePath(lang)}` },
        ...(d.vendor.place_slug && place
          ? [{ label: place, url: `${base}${localePath(lang, `/places/${d.vendor.place_slug}`)}` }]
          : []),
        {
          label: pickName(d.vendor, "name", lang),
          url: `${base}${localePath(lang, `/m/${d.vendor.slug}`)}`,
        },
        {
          label: pickName(d.item, "name", lang),
          url: `${base}${localePath(lang, `/i/${d.item.id}`)}`,
        },
      ]),
    ]);
  },
  component: ItemRoute,
});

function ItemRoute() {
  return <ItemView d={Route.useLoaderData()} />;
}
