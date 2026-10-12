import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestUrl } from "@tanstack/react-start/server";

/**
 * What the server knows about this request that pages need: the public origin (canonical and hreflang are absolute),
 * whether search engines may index this deployment, and the visitor's preferred language.
 * Indexing is OFF unless the deployment sets SITE_INDEXING=on (DECISIONS cut-over): previews and staging never index.
 */
export const getRequestInfo = createServerFn({ method: "GET" }).handler(async () => {
  const url = getRequestUrl({ xForwardedHost: true, xForwardedProto: true });
  const site = (process.env["SITE_URL"] ?? "").replace(/\/+$/, "");
  return {
    origin: site || url.origin,
    indexing: process.env["SITE_INDEXING"] === "on",
    acceptLanguage: getRequestHeader("accept-language") ?? "",
  };
});
