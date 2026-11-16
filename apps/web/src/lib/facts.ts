// What a product page says about food, as data the template prints. The database has already decided what may be said
// (web_catalog_product: a current approved fact, unexpired, checked, and only the groups the item's own template has); this only groups it
// and words it. The nutrition panel is not here: it comes once, typed, as `nutrition` (lib/product.ts). Invariants 14 and 15:
// no judgement about the food, and unknown is never safe, so an unchecked attribute is listed as "not verified" and never as "free".
import type { CatalogFact } from "@ak/commerce/index";
import { DICTS, nameIn, t, type Lang } from "./i18n";

export interface FactLine { text: string; how: string }
export interface FactGroup {
  kind: "allergen" | "diet" | "text";
  title: string; lines: FactLine[]; notVerified: string[];
  /** The whole group has nothing checked. */
  empty: boolean;
}

const dateOf = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/** Where a stored source comes from, in words: "from the pack", "declared by the vendor". An unknown source says nothing rather than guess. */
export const sourceWord = (l: Lang, source: string | null | undefined): string => {
  const k = `src_${source ?? ""}`;
  return source && k in DICTS[l] ? DICTS[l][k]! : "";
};

/** "from the pack, checked 2026-11-10" (a certified record says so as well). A source with no words says nothing rather than guess. */
export function howText(l: Lang, source: string | null | undefined, status: string | null | undefined, reviewedAt: string | null | undefined): string {
  const parts = [sourceWord(l, source), status === "certified" ? t(l, "status_certified") : ""];
  const d = dateOf(reviewedAt ?? null);
  if (d) parts.push(t(l, "checked_on", { date: d }));
  return parts.filter(Boolean).join(", ");
}
const how = (l: Lang, f: CatalogFact): string => howText(l, f.source, f.status, f.reviewed_at);

export function groupFacts(l: Lang, facts: CatalogFact[]): FactGroup[] {
  const by = (pred: (f: CatalogFact) => boolean) => facts.filter(pred);
  const out: FactGroup[] = [];
  const listGroup = (kind: "allergen" | "diet", title: string, line: (f: CatalogFact) => string | null) => {
    const all = by((f) => f.kind === kind);
    if (!all.length) return;
    const lines = all.filter((f) => f.verified).flatMap((f) => { const text = line(f); return text ? [{ text, how: how(l, f) }] : []; });
    const notVerified = all.filter((f) => !f.verified).map((f) => nameIn(l, f.name_en, f.name_ar));
    out.push({ kind, title, lines, notVerified, empty: lines.length === 0 });
  };
  listGroup("allergen", t(l, "allergens"), (f) => {
    const n = nameIn(l, f.name_en, f.name_ar);
    return f.value === "contains" ? `${t(l, "contains")}: ${n}` : f.value === "may_contain" ? `${t(l, "may_contain")}: ${n}` : f.value === "free" ? `${t(l, "free_of")}: ${n}` : null;
  });
  listGroup("diet", t(l, "diets"), (f) => (f.value === "yes" || f.value === "no" ? `${nameIn(l, f.name_en, f.name_ar)}: ${t(l, f.value)}` : null));

  // Printed text: ingredients, storage, origin (kind "ingredients" in the vocabulary). Shown by attribute.
  for (const f of by((x) => x.kind === "ingredients")) {
    const title = f.attribute === "ingredients" ? t(l, "ingredients") : f.attribute === "storage" ? t(l, "storage") : f.attribute === "origin" ? t(l, "origin") : nameIn(l, f.name_en, f.name_ar);
    const text = f.verified ? (l === "ar" && f.detail?.ar ? f.detail.ar : f.detail?.text) : null;
    out.push({ kind: "text", title, lines: text ? [{ text, how: how(l, f) }] : [], notVerified: text ? [] : [t(l, "not_verified")], empty: !text });
  }
  return out;
}
