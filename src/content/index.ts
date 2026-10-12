// Loads one language at a time, so a visitor never downloads the other two (§37.5 JavaScript budget).
import type { SiteLang } from "@/lib/site";
import type { Copy } from "./en";
import type { LegalCopy } from "./legal.en";

export type { Copy, FaqItem } from "./en";
export type { LegalCopy, LegalDoc, LegalSlug } from "./legal.en";

export async function loadCopy(lang: SiteLang): Promise<Copy> {
  if (lang === "ar") return (await import("./ar")).ar;
  if (lang === "fr") return (await import("./fr")).fr;
  return (await import("./en")).en;
}

export async function loadLegal(lang: SiteLang): Promise<LegalCopy> {
  if (lang === "ar") return (await import("./legal.ar")).legalAr;
  if (lang === "fr") return (await import("./legal.fr")).legalFr;
  return (await import("./legal.en")).legalEn;
}
