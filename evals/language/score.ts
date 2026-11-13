// Build plan 1.22: item scoring for the catalog language eval. Pure, so CI tests it without a model.
// An expected item is hit when a matched line's product is its SKU (or one of its `accept` SKUs). A matched product that hits
// no expected item is a wrong product: the customer would have received something they did not ask for. Lines left
// ambiguous or not found are misses (the customer gets a question, not a wrong card).
export interface Expected { sku: string; accept?: string[] }
export interface Got { sku: string; assumed?: boolean }
export interface CaseScore { tp: number; wrong: Got[]; missed: Expected[] }

export function scoreCase(expected: Expected[], got: Got[]): CaseScore {
  const left = [...expected]; const wrong: Got[] = []; let tp = 0;
  for (const g of got) {
    const i = left.findIndex((e) => e.sku === g.sku || (e.accept ?? []).includes(g.sku));
    if (i >= 0) { left.splice(i, 1); tp++; } else wrong.push(g);
  }
  return { tp, wrong, missed: left };
}

export interface Totals { cases: number; items: number; tp: number; fp: number; fn: number; precision: number; recall: number; f1: number; perfect_cases: number }
export function totals(scores: CaseScore[]): Totals {
  const tp = scores.reduce((s, c) => s + c.tp, 0), fp = scores.reduce((s, c) => s + c.wrong.length, 0), fn = scores.reduce((s, c) => s + c.missed.length, 0);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { cases: scores.length, items: tp + fn, tp, fp, fn,
    precision: r(tp + fp ? tp / (tp + fp) : 1), recall: r(tp + fn ? tp / (tp + fn) : 1), f1: r(2 * tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : 1),
    perfect_cases: scores.filter((c) => c.wrong.length === 0 && c.missed.length === 0).length };
}
