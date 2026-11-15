// What the middleware puts on every request (src/middleware.ts); the tests put the same on a rendered page.
import type { WebCatalog } from "@ak/commerce/index";
import type { Lang } from "./lib/i18n";
import type { WebEnv } from "./lib/db";

declare global {
  namespace App {
    interface Locals {
      lang: Lang;
      env: WebEnv;
      /** The catalog reads, as the database role web_channel. Throws NotConfigured when the Worker has no token yet. */
      catalog: () => WebCatalog;
    }
  }
}
export {};
