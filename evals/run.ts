// Scoring helpers for the voice-note evaluation. Wire the STT provider and runConcierge in build step 4.
export interface TruthLine { item: string; qty: number; modifiers: string[]; source: string | null }
export interface Score { recall: number; precision: number; invented: number; qtyAccuracy: number }

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
const same = (a: string, b: string) => norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a));

export function scoreLines(truth: TruthLine[], got: { query: string; qty: number }[]): Score {
  const used = new Set<number>();
  let hits = 0, qtyOk = 0;
  for (const t of truth) {
    const i = got.findIndex((g, idx) => !used.has(idx) && same(g.query, t.item));
    if (i >= 0) { used.add(i); hits++; if (got[i]!.qty === t.qty) qtyOk++; }
  }
  return {
    recall: truth.length ? hits / truth.length : 1,
    precision: got.length ? hits / got.length : 1,
    invented: got.length - hits,
    qtyAccuracy: hits ? qtyOk / hits : 1,
  };
}
