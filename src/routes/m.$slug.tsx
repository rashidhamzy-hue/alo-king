import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestInfo } from "@/lib/request";
import { pickLang } from "@/lib/site";

// Old shop links (before the language prefix) keep working.
export const Route = createFileRoute("/m/$slug")({
  beforeLoad: async ({ params }) => {
    const { acceptLanguage } = await getRequestInfo();
    throw redirect({
      to: "/$lang/m/$slug",
      params: { lang: pickLang(acceptLanguage), slug: params.slug },
      statusCode: 301,
    });
  },
});
