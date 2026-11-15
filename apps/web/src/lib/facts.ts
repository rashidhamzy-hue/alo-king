// What a product page says about food, as data the template prints. The database has already decided what may be said
// (web_catalog_product: a current approved fact, unexpired, checked); this only groups it and words it. Invariants 14 and 15:
// no judgement about the food, and unknown is never safe, so an unchecked attribute is listed as "not verified" and never as "free".
import type { CatalogFact } from "@ak/commerce/index";
import { nameIn, t, type Lang } from "./i18n";

export interface FactLine { text: string; how: string }
export interface FactGroup {
  kind: "allergen" | "diet" | "ingredients" | "nutrition" | "text";
  title: string; lines: FactLine[]; panel?: { name: string; value: string }[]; notVerified: string[];
  /** The whole group has nothing checked. */
  empty: boolean;
}

const humanize = (k: string) => k.replace(/_/g, " ");
const dateOf = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/** "declared, pack label, checked 2026-11-10". */
function how(l: Lang, f: CatalogFact): string {
  const parts = [t(l, `status_${f.status}` as never), f.source ? t(l, `src_${f.source}` as never) : ""];
  const d = dateOf(f.reviewed_at);
  if (d) parts.push(t(l, "checked_on", { date: d }));
  return parts.filter(Boolean).join(", ");
}

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
  for (const f of by((x) => x.kind === "nutrition")) {
    const values = f.verified && f.detail?.values && typeof f.detail.values === "object" ? Object.entries(f.detail.values) : [];
    const panel = values.filter(([, v]) => typeof v === "number" || typeof v === "string").map(([k, v]) => ({ name: humanize(k), value: String(v) }));
    out.push({ kind: "nutrition", title: t(l, "nutrition"), lines: panel.length ? [{ text: "", how: how(l, f) }] : [], panel, notVerified: panel.length ? [] : [t(l, "not_verified")], empty: panel.length === 0 });
  }
  return out;
}
