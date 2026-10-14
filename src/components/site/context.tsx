import { createContext, useContext, type ReactNode } from "react";
import type { Copy } from "@/content";
import type { RequestInfo, SiteLang } from "@/lib/site";
import { dirOf } from "@/lib/site";
import type { SiteOverview } from "@/lib/site-data";

export type SiteCtx = {
  lang: SiteLang;
  /** Which side of the site this page is on (DECISIONS §39.11): customers at night, businesses by day. */
  side: "customer" | "business";
  dir: "ltr" | "rtl";
  t: Copy;
  info: RequestInfo;
  overview: SiteOverview;
};
const Ctx = createContext<SiteCtx | null>(null);

export function SiteProvider({
  value,
  children,
}: {
  value: Omit<SiteCtx, "dir">;
  children: ReactNode;
}) {
  return <Ctx.Provider value={{ ...value, dir: dirOf(value.lang) }}>{children}</Ctx.Provider>;
}

export function useSite() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSite outside the language layout");
  return c;
}
