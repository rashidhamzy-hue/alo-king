// VOICE1: which place a customer meant when the name they said (or a speech model heard) is not one we know. Deterministic code, no model.
// Staging, 23 Nov: «عنفطة Chicken Tin» was Safa Chicken. A name is compared with every name of every place this customer may order from
// (its own and the names customers use, food_place_choices, 0276) three ways: the spelling (Arabic folded), the same word in the other script
// (a transliteration), and how it sounds (a consonant key: «صفا» and "safa" are both "sf", «تشيكن» and "chicken" both "xkn"). The best place is
// only ever asked about («قصدك …؟»), never assumed; a tie or nothing close lists the places instead.

export interface PlaceChoice { source_id: string; name: string; names: string[] }
export interface PlaceGuess { source_id: string; name: string; score: number }

const AR: Record<string, string> = {
  "ب": "b", "ت": "t", "ث": "s", "ج": "j", "ح": "h", "خ": "q", "د": "d", "ذ": "z", "ر": "r", "ز": "z", "س": "s", "ش": "x", "ص": "s", "ض": "d",
  "ط": "t", "ظ": "z", "غ": "q", "ف": "f", "ق": "k", "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "ة": "", "ع": "", "ء": "", "ا": "", "أ": "",
  "إ": "", "آ": "", "و": "", "ي": "", "ى": "", "ئ": "", "ؤ": "", "چ": "x", "پ": "b", "ڤ": "f", "گ": "j",
};

/** One word's sound key: consonant classes, vowels and long-vowel letters dropped, a letter said twice once. */
export function soundKey(word: string): string {
  let w = word.toLowerCase().normalize("NFKD").replace(/[ً-ٰٟـ̀-ͯ]/g, "");
  // Arabizi digits
  w = w.replace(/7/g, "h").replace(/5/g, "q").replace(/8/g, "q").replace(/9/g, "s").replace(/[23]/g, "");
  w = w.replace(/x/g, "ks").replace(/tch|tsh|ch|sh/g, "x").replace(/kh|gh/g, "q").replace(/ck/g, "k").replace(/ph/g, "f").replace(/th/g, "t")
       .replace(/dj/g, "j").replace(/[cq]/g, "k").replace(/v/g, "f").replace(/p/g, "b").replace(/g/g, "j");
  // after the digraphs: the placeholders x (sh) and q (kh, gh) are set; Latin q and c became k above
  w = [...w].map((ch) => (ch in AR ? AR[ch]! : ch)).join("");
  w = w.replace(/tx/g, "x").replace(/[aeiouyw]/g, "").replace(/[^a-z]/g, "").replace(/(.)\1+/g, "$1");
  return w.replace(/h$/, "");
}

/** Words that say what kind of place it is, not which one: they never decide a guess. */
const GENERIC = new Set(["مطعم", "مطبخ", "سناك", "كافيه", "كافه", "فرن", "محل", "عند", "من", "ال", "restaurant", "resto", "snack", "cafe",
  "kitchen", "shop", "the", "from", "min", "men", "3and", "and"].map((w) => soundKey(w)).filter(Boolean));

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const keys = (s: string) => words(s).map(soundKey).filter((k) => k.length > 0);

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}
/** How alike two sound keys are, 0 to 1. Keys of one or two letters must be equal. */
export function keyLike(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) <= 2) return 0;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
}

/**
 * How well `said` names `name`, 0 to 1: the share of the name's own words (by sound) found in what was said, counting only words that
 * say which place it is (not "restaurant", «مطبخ»). A name of only such words counts them all.
 */
export function nameScore(name: string, said: string): number {
  const all = keys(name);
  const own = all.filter((k) => !GENERIC.has(k));
  const want = own.length ? own : all;
  const heard = keys(said);
  if (!want.length || !heard.length) return 0;
  let hit = 0;
  for (const k of want) if (heard.some((h) => keyLike(k, h) >= 0.75)) hit++;
  return hit / want.length;
}

/** The one place close enough to ask about, or null (nothing close, or two places equally close). */
export function guessPlace(said: string, places: PlaceChoice[], min = 0.5): PlaceGuess | null {
  const scored = places.map((p) => ({ source_id: p.source_id, name: p.name,
    score: Math.max(0, ...[p.name, ...(p.names ?? [])].filter(Boolean).map((n) => nameScore(n, said))) }))
    .filter((p) => p.score >= min).sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[1]!.score >= scored[0]!.score) return null;
  return scored[0]!;
}
