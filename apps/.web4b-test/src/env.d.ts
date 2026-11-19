// What the middleware puts on every request (src/middleware.ts); the tests put the same on a rendered page.
import type { WebCatalog, WebJoin, WebListings } from "@ak/commerce/index";
import type { Lang } from "./lib/i18n";
import type { WebEnv } from "./lib/db";

declare global {
  namespace App {
    interface Locals {
      lang: Lang;
      env: WebEnv;
      /** The catalog reads, as the database role web_channel. Throws NotConfigured when the Worker has no token yet. */
      catalog: () => WebCatalog;
      /** The Food pages (LV1): the places listed before they sign. */
      listings: () => WebListings;
      /** The join pages (UX3): an application to ride or to sell. */
      join: () => WebJoin;
    }
  }
}
export {};
