import { createFileRoute } from "@tanstack/react-router";
import { getRequestInfo } from "@/lib/request";
import { llmsTxt } from "@/lib/seo-files";
import { getOverview, getVendorSlugs } from "@/lib/site-data";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async () => {
        const [info, overview, vendors] = await Promise.all([
          getRequestInfo(),
          getOverview(),
          getVendorSlugs(),
        ]);
        return new Response(llmsTxt(info.origin, overview, vendors), {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=0, s-maxage=3600",
          },
        });
      },
    },
  },
});
