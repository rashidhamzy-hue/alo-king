// Village search for the "Where we deliver" map (DECISIONS §39.11): Arabic, English, French and Arabizi, spelling-tolerant.
// Pure functions, unit-tested in zone-search.test.ts. The names and spellings come from the places seed and OSM
// (src/design/chouf-map.generated.ts); nothing here is guessed per village.
//
// How a query matches a place:
//   * Arabic script: letters normalised (hamza forms, alef maqsura, taa marbuta, diacritics, tatweel, the article "ال"),
//     then compared with each Arabic name: equal, prefix, contained, or one letter off.
//   * Latin script (English, French, Arabizi): lower case, accents off, Arabizi digits read as letters (3 = ain, 7 = h,
//     5 = kh, 2 = hamza or qaf, 8 = gh, 9 = q), then reduced to a consonant skeleton (vowels, w and y dropped; q/k/c one
//     sound; ch/sh one sound; doubled letters once; the article el/al as its own word dropped), so "Baakline", "Baaqline",
//     "ba3e2lin" and "Baakleen" meet as "bkln".

const ARABIC = /[؀-ۿ]/;

/** Arabic letters in one form: no diacritics, tatweel or bidi marks; أإآٱ→ا, ى→ي, ة→ه, ؤ→و, ئ→ي; Arabic digits to Latin. */
export function normArabic(s: string): string {
  return s
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.startsWith("ال") ? w.slice(2) : w))
    .join("");
}

/** Latin and Arabizi in one form: lower case, no accents, digits read as letters, spaces and punctuation kept as spaces. */
export function normLatin(s: string, hamza: "" | "k" = ""): string {
  return s
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/3'/g, "gh")
    .replace(/2/g, hamza)
    .replace(/3/g, "")
    .replace(/5/g, "kh")
    .replace(/7/g, "h")
    .replace(/8/g, "gh")
    .replace(/9/g, "q")
    .replace(/6/g, "t")
    .replace(/['’`-]/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/** The consonant skeleton of a Latin name (see the header). */
export function skeleton(latin: string): string {
  return latin
    .split(" ")
    .filter(
      (w) =>
        w &&
        ![
          "el",
          "al",
          "il",
          "ed",
          "es",
          "ech",
          "ash",
          "ad",
          "ez",
          "et",
          "de",
          "du",
          "la",
          "le",
        ].includes(w),
    )
    .join("")
    .replace(/ch|sh/g, "S")
    .replace(/kh/g, "X")
    .replace(/gh/g, "G")
    .replace(/th/g, "t")
    .replace(/dh/g, "z")
    .replace(/ph/g, "f")
    .replace(/[qc]/g, "k")
    .replace(/h$/, "")
    .replace(/[aeiouyw]/g, "")
    .replace(/(.)\1+/g, "$1");
}

/** Levenshtein distance, stopping early above `max`. */
export function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      cur.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return false;
    prev = cur;
  }
  return (prev[b.length] ?? Infinity) <= max;
}

export type Searchable = { words: string[] };

type Keys = { ar: string[]; lat: string[]; skel: string[] };
const keyCache = new WeakMap<Searchable, Keys>();
function keysOf(p: Searchable): Keys {
  let k = keyCache.get(p);
  if (!k) {
    const ar = p.words
      .filter((w) => ARABIC.test(w))
      .map(normArabic)
      .filter(Boolean);
    const latin = p.words.filter((w) => !ARABIC.test(w)).map((w) => normLatin(w));
    k = {
      ar,
      lat: latin.map((w) => w.replace(/ /g, "")),
      skel: latin.map(skeleton).filter((s) => s.length >= 2),
    };
    keyCache.set(p, k);
  }
  return k;
}

/** How well one place answers the query, 0 for no match. Higher is better. */
export function score(p: Searchable, query: string): number {
  const q = query.trim();
  if (q.length < 2) return 0;
  const k = keysOf(p);
  if (ARABIC.test(q)) {
    const n = normArabic(q);
    if (n.length < 2) return 0;
    let s = 0;
    for (const a of k.ar) {
      if (a === n) s = Math.max(s, 100);
      else if (a.startsWith(n)) s = Math.max(s, 80);
      else if (n.length >= 3 && a.includes(n)) s = Math.max(s, 60);
      else if (n.length >= 4 && within(a, n, 1)) s = Math.max(s, 45);
    }
    return s;
  }
  let s = 0;
  for (const hamza of ["", "k"] as const) {
    const lat = normLatin(q, hamza);
    const flat = lat.replace(/ /g, "");
    const sk = skeleton(lat);
    if (flat.length < 2) continue;
    for (const w of k.lat) {
      if (w === flat) s = Math.max(s, 100);
      else if (w.startsWith(flat)) s = Math.max(s, 85);
      else if (flat.length >= 3 && w.includes(flat)) s = Math.max(s, 62);
    }
    if (sk.length >= 2)
      for (const w of k.skel) {
        if (w === sk) s = Math.max(s, 75);
        else if (sk.length >= 3 && w.startsWith(sk)) s = Math.max(s, 58);
        else if (sk.length >= 4 && within(w, sk, sk.length >= 6 ? 2 : 1)) s = Math.max(s, 42);
      }
  }
  return s;
}

/** The places that match, best first (ties keep the input order). */
export function searchPlaces<T extends Searchable>(
  places: readonly T[],
  query: string,
  limit = 8,
): T[] {
  return places
    .map((p, i) => ({ p, i, s: score(p, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.p);
}
