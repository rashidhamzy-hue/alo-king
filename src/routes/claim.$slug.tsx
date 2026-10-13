import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestInfo } from "@/lib/request";
import { pickLang } from "@/lib/site";

// Claim links from the old site named a shop by a slug of the old database. Claiming now starts from a search under the
// language prefix (DECISIONS §24.3), so those links land on it.
export const Route = createFileRoute("/claim/$slug")({
  beforeLoad: async () => {
    const { acceptLanguage } = await getRequestInfo();
    throw redirect({
      to: "/$lang/claim",
      params: { lang: pickLang(acceptLanguage) },
      statusCode: 301,
    });
  },
});
