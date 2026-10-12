import { createFileRoute } from "@tanstack/react-router";
import { getRequestInfo } from "@/lib/request";
import { SITEMAP_KINDS, sitemapEntries, urlset, type SitemapKind } from "@/lib/seo-files";
import { getOverview, getVendorSlugs } from "@/lib/site-data";

// One sitemap per page type, regenerated on every request and cached for an hour (DECISIONS §24.5: nightly or better).
export const Route = createFileRoute("/sitemap/{$kind}.xml")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const kind = params.kind as SitemapKind;
        if (!SITEMAP_KINDS.includes(kind)) return new Response("Not found", { status: 404 });
        const [info, overview, vendors] = await Promise.all([
          getRequestInfo(),
          getOverview(),
          kind === "vendors" ? getVendorSlugs() : Promise.resolve([]),
        ]);
        return new Response(urlset(info.origin, sitemapEntries(kind, overview, vendors)), {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=0, s-maxage=3600",
          },
        });
      },
    },
  },
});
