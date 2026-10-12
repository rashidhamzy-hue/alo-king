import { createFileRoute } from "@tanstack/react-router";
import { getRequestInfo } from "@/lib/request";
import { sitemapIndex } from "@/lib/seo-files";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const info = await getRequestInfo();
        return new Response(sitemapIndex(info.origin, new Date().toISOString().slice(0, 10)), {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=0, s-maxage=3600",
          },
        });
      },
    },
  },
});
