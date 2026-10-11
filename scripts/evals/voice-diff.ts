// Compares the orders read from two transcripts of one voice note (DECISIONS §30.7).
export type Order = {
  items: { dish: string; quantity: number | null; details: string }[];
  place: string | null;
  merchant_or_cuisine: string | null;
};
const norm = (s: string | null) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim();
/** Disagreements that matter for an order: a dish, a quantity or a place (§30.7). */
export function disagreements(a: Order, b: Order): string[] {
  const out: string[] = [];
  const key = (o: Order) => new Map(o.items.map((i) => [norm(i.dish), i.quantity]));
  const ka = key(a);
  const kb = key(b);
  for (const [d, q] of ka) {
    if (!kb.has(d)) out.push(`dish "${d}" only in A`);
    else if ((kb.get(d) ?? null) !== (q ?? null))
      out.push(`quantity of "${d}": A ${q ?? "?"} vs B ${kb.get(d) ?? "?"}`);
  }
  for (const d of kb.keys()) if (!ka.has(d)) out.push(`dish "${d}" only in B`);
  if (norm(a.place) !== norm(b.place))
    out.push(`place: A ${a.place ?? "none"} vs B ${b.place ?? "none"}`);
  return out;
}
