import type { Copy } from "@/content";
import type { SiteOverview } from "./site-data";
import { fmt, iso, usd } from "./site";

export type Faq = { id: string; q: string; a: string };

/** The FAQ with the numbers filled from the database (fees, radius). Without them, the answer that needs none is used. */
export function faqItems(t: Copy, o: SiteOverview, only?: string[]): Faq[] {
  const f = o.fees;
  const have = f.min_usd != null && f.max_usd != null && f.max_km != null;
  const v = have
    ? { min: iso(usd(f.min_usd)), max: iso(usd(f.max_usd)), km: iso(f.max_km ?? "") }
    : {};
  return t.faq
    .filter((i) => !only || only.includes(i.id))
    .map((i) => ({ id: i.id, q: i.q, a: fmt(!have && i.fallback ? i.fallback : i.a, v) }));
}

/** schema.org FAQPage for exactly the questions shown on the page (§24.5: only data that is visible). */
export const faqLd = (items: Faq[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map((i) => ({
    "@type": "Question",
    name: i.q,
    acceptedAnswer: { "@type": "Answer", text: i.a },
  })),
});

/** Each side has its own FAQ (DECISIONS §39.11): the customers' questions, and the businesses' (ids starting "m_"). */
export const customerFaqIds = (t: Copy) =>
  t.faq.filter((i) => !i.id.startsWith("m_") && i.id !== "merchant").map((i) => i.id);
export const businessFaqIds = (t: Copy) =>
  t.faq.filter((i) => i.id.startsWith("m_")).map((i) => i.id);
