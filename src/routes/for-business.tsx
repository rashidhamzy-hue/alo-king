import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestInfo } from "@/lib/request";
import { pickLang } from "@/lib/site";

// The old "for business" page is now "For businesses" under the language prefix (DECISIONS §37.4). Old links keep working.
export const Route = createFileRoute("/for-business")({
  beforeLoad: async () => {
    const { acceptLanguage } = await getRequestInfo();
    throw redirect({
      to: "/$lang/business",
      params: { lang: pickLang(acceptLanguage) },
      statusCode: 302,
    });
  },
});
