import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved to the business section (DECISIONS §39.11: customers and merchants never share pages). Old links keep working.
export const Route = createFileRoute("/$lang/for-merchants")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$lang/business", params: { lang: params.lang }, statusCode: 301 });
  },
});
