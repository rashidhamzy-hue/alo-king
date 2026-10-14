import { createFileRoute } from "@tanstack/react-router";
import { buildHead } from "@/lib/site";
import { getDeliveryMap } from "@/lib/site-data";
import { DeliveryMap, VillageIndex } from "@/components/site/map/DeliveryMap";

// "Where we deliver" (DECISIONS §39.2, §39.11): the interactive map of the delivery zone, then every place as a list.
export const Route = createFileRoute("/$lang/places/")({
  validateSearch: (s: Record<string, unknown>): { v?: string } =>
    typeof s.v === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.v) && s.v.length <= 80
      ? { v: s.v }
      : {},
  loader: async () => ({ counts: await getDeliveryMap() }),
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    return buildHead({
      lang,
      path: "/places",
      title: copy.places.indexSeoTitle,
      description: copy.places.indexSeoDescription,
      info: info ?? { origin: "", indexing: false },
    });
  },
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
  }),
  component: PlacesIndex,
});

function PlacesIndex() {
  const { counts } = Route.useLoaderData();
  const { v } = Route.useSearch();
  return (
    <>
      <section className="tone-night zm-section">
        <DeliveryMap counts={counts} initial={v} />
      </section>
      <VillageIndex counts={counts} />
    </>
  );
}
