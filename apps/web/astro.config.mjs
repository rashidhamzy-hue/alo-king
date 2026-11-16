import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";

// docs/WEBSITE.md "Shape": Astro, the Cloudflare adapter, every page rendered on the server (HTML first; nothing needs JavaScript).
// Styles are files, not inline, so the content security policy can name its own origin. Pictures come from the public `catalog`
// bucket, so the adapter's image service is not used.
export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  build: { inlineStylesheets: "never", format: "file" },
  trailingSlash: "never",   // /offline is a file, not a redirect to /offline/: the service worker caches it and serves it to a navigation
  security: { checkOrigin: true },
  session: false,   // no sessions here: the cart session (WEB2) is the database's web_sessions, not the framework's KV
  devToolbar: { enabled: false },
  telemetry: false,
  // The commerce client is the monorepo's package (no logic, no dependency); the same alias is in tsconfig.json and vitest.config.ts.
  // DS1: the design system is the monorepo's packages/ui (tokens, components). Tailwind v4 compiles the one stylesheet at build time.
  vite: { plugins: [tailwindcss()], resolve: { alias: {
    "@ak/commerce": fileURLToPath(new URL("../../packages/commerce/src", import.meta.url)),
    // SR1: the search box is read by the chat's own reading step (pure code, no dependency): one search, one set of filters (invariant 19)
    "@ak/search": fileURLToPath(new URL("../../packages/search/src", import.meta.url)),
    "@ak/ui-astro": fileURLToPath(new URL("../../packages/ui/astro", import.meta.url)),
    "@ak/ui": fileURLToPath(new URL("../../packages/ui/src", import.meta.url)),
  } } },
});
