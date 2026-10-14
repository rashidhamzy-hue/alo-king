import { createFileRoute, notFound } from "@tanstack/react-router";
import { loadLegal } from "@/content";
import { buildHead } from "@/lib/site";
import { BUSINESS_LEGAL, LegalView } from "@/components/site/LegalView";

// The businesses' legal pages (DECISIONS §24.2, §39.11): merchant terms, the collection mandate, and the privacy policy
// (the same text as the customers' copy, shown on this side so a merchant never leaves it; that copy is not indexed).
export const Route = createFileRoute("/$lang/business/legal/$doc")({
  loader: async ({ params }) => {
    if (!BUSINESS_LEGAL.some(([s]) => s === params.doc)) throw notFound();
    const legal = await loadLegal(params.lang as "ar" | "en" | "fr");
    const doc = legal.docs.find((d) => d.slug === params.doc);
    if (!doc) throw notFound();
    return {
      doc,
      updatedOn: legal.updatedOn,
      draftNote: legal.draftNote,
      entityHeading: legal.entityHeading,
      entityText: legal.entityText,
    };
  },
  staleTime: 3_600_000,
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
  }),
  head: ({ loaderData, match, params }) => {
    if (!loaderData) return {};
    const { lang, info } = match.context;
    return buildHead({
      lang,
      path: `/business/legal/${params.doc}`,
      title: `${loaderData.doc.title} | Alo King`,
      description: loaderData.doc.description,
      info: info ?? { origin: "", indexing: false },
      noindex: params.doc === "privacy",
    });
  },
  component: BusinessLegal,
});

function BusinessLegal() {
  return <LegalView {...Route.useLoaderData()} side="business" />;
}
