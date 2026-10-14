import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { loadLegal } from "@/content";
import { buildHead } from "@/lib/site";
import { BUSINESS_LEGAL, CUSTOMER_LEGAL, LegalView } from "@/components/site/LegalView";

// The customers' legal pages (DECISIONS §24.2). The merchant terms and the collection mandate moved to the business side
// (§39.11); their old addresses redirect there.
export const Route = createFileRoute("/$lang/legal/$doc")({
  beforeLoad: ({ params }) => {
    if (
      !CUSTOMER_LEGAL.some(([s]) => s === params.doc) &&
      BUSINESS_LEGAL.some(([s]) => s === params.doc)
    )
      throw redirect({
        to: "/$lang/business/legal/$doc",
        params: { lang: params.lang, doc: params.doc },
        statusCode: 301,
      });
  },
  loader: async ({ params }) => {
    if (!CUSTOMER_LEGAL.some(([s]) => s === params.doc)) throw notFound();
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
      path: `/legal/${params.doc}`,
      title: `${loaderData.doc.title} | Alo King`,
      description: loaderData.doc.description,
      info: info ?? { origin: "", indexing: false },
    });
  },
  component: LegalPage,
});

function LegalPage() {
  return <LegalView {...Route.useLoaderData()} side="customer" />;
}
