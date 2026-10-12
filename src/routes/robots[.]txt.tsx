import { createFileRoute } from "@tanstack/react-router";
import { getRequestInfo } from "@/lib/request";
import { robotsTxt } from "@/lib/seo-files";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () =>
        new Response(robotsTxt(await getRequestInfo()), {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=3600" },
        }),
    },
  },
});
