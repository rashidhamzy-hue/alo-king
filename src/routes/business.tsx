import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestInfo } from "@/lib/request";
import { pickLang } from "@/lib/site";

// "/business" with no language: the business side in the visitor's language (DECISIONS §39.11).
export const Route = createFileRoute("/business")({
  beforeLoad: async () => {
    const { acceptLanguage } = await getRequestInfo();
    throw redirect({
      to: "/$lang/business",
      params: { lang: pickLang(acceptLanguage) },
      statusCode: 302,
    });
  },
});
