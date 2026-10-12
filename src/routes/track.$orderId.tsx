import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestInfo } from "@/lib/request";
import { pickLang } from "@/lib/site";

// Old tracking links (before the language prefix) keep working: they land on the page for the visitor's language.
export const Route = createFileRoute("/track/$orderId")({
  beforeLoad: async ({ params }) => {
    const { acceptLanguage } = await getRequestInfo();
    throw redirect({ to: "/$lang/track/$token", params: { lang: pickLang(acceptLanguage), token: params.orderId }, statusCode: 302 });
  },
});
