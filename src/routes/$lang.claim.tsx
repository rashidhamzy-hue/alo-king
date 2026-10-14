import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved to the business section (DECISIONS §39.11). Old links, and claim links already sent (?q= / ?v=), keep working.
export const Route = createFileRoute("/$lang/claim")({
  validateSearch: (s: Record<string, unknown>): { q?: string; v?: string } => ({
    q: typeof s.q === "string" ? s.q.slice(0, 80) : undefined,
    v: typeof s.v === "string" ? s.v.slice(0, 40) : undefined,
  }),
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/$lang/business/claim",
      params: { lang: params.lang },
      search: { q: search.q, v: search.v },
      statusCode: 301,
    });
  },
});
