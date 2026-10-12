import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestInfo } from "@/lib/request";
import { pickLang } from "@/lib/site";

// "/" sends each visitor to the language of their browser (Arabic when it names none we support, §24.5).
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { acceptLanguage } = await getRequestInfo();
    throw redirect({ to: "/$lang", params: { lang: pickLang(acceptLanguage) }, statusCode: 302 });
  },
});
