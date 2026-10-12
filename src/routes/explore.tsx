import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestInfo } from "@/lib/request";
import { pickLang } from "@/lib/site";

// The old shop explorer is replaced by the place and cuisine pages (DECISIONS §37.4). Old links land on the places page.
export const Route = createFileRoute("/explore")({
  beforeLoad: async () => {
    const { acceptLanguage } = await getRequestInfo();
    throw redirect({
      to: "/$lang/places",
      params: { lang: pickLang(acceptLanguage) },
      statusCode: 301,
    });
  },
});
