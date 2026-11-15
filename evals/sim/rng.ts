// Seeded randomness for the simulated customers (SIM1). The same seed always gives the same numbers, on every machine.

/** mulberry32: a small, fast, well-mixed 32-bit generator. Returns floats in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: () => number, xs: readonly T[]): T => {
  if (xs.length === 0) throw new Error("pick from an empty list");
  return xs[Math.floor(r() * xs.length)]!;
};

export function shuffle<T>(r: () => number, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** n distinct items (or all of them when there are fewer). */
export const sample = <T>(r: () => number, xs: readonly T[], n: number): T[] => shuffle(r, xs).slice(0, n);

/** A string hash for deriving sub-seeds ("seed:noise:3"). FNV-1a. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
