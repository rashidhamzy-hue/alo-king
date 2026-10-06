// A village typed as text ("خريبة", "Khriebeh", "in Baakleen") is a place, not a dish (P2). Matched against the villages the vendors really are in,
// across Arabic script, Arabizi and English spellings using the shared consonant skeleton (resolve.skeleton), so no hand-kept alias list can go stale. Pure.
import { normText, skeleton } from "./resolve.ts";

const FILLER = new Set(["in", "at", "to", "from", "near", "around", "im", "i", "am", "my", "the", "village", "town", "location", "area", "deliver", "delivery", "me", "ma3", "fi", "ana", "bi", "men", "min", "3a", "3ala", "ba3d", "بلده", "بلدتي", "ببلده", "في", "ب", "من", "عن", "انا", "عند", "قرب", "حدا", "حد", "منطقه", "منطقتي", "ضيعه", "ضيعتي", "توصيل", "ل", "لـ"]);
const ARTICLE = /^(?:al|el|ال)/;

const ARTICLE_TOKEN = /^(?:al|el|ed|ad|ar|er|an|en|as|es|ash|esh|ez|az)$/;
/** "بيت الدين" and "Beit ed-Dine": the article (ال, el, ed, ...) is dropped from every word. */
const withoutArticles = (n: string) => n.split(" ").filter((w) => !ARTICLE_TOKEN.test(w)).map((w) => w.replace(ARTICLE, "")).join(" ");
const keys = (s: string): string[] => {
  const n = normText(s).replace(/\s+/g, " ");
  const noArt = withoutArticles(n);
  const all = [skeleton(n), skeleton(noArt)].flatMap((k) => [k, k.replace(/h$/, "")]); // a final ه / h / e is spelled or dropped either way (خريبة, Khreibeh)
  return [...new Set(all.filter((k) => k.length >= 4))]; // shorter skeletons collide with dishes (burek = Barouk, sham = Chhim): they only match by exact spelling, below
};

/** The vendors' village (as stored) the customer typed, or null. The whole message must be the village (plus filler like "in" or "في"), at most three words. */
export function matchVillage(text: string, villages: string[]): string | null {
  const words = normText(text).split(" ").filter((w) => w && !FILLER.has(w));
  if (!words.length || words.length > 3 || words.some((w) => /^\d+$/.test(w))) return null;
  const typed = keys(words.join(" "));
  const hits = new Set<string>();
  const exact = normText(words.join(" "));
  for (const v of villages) { if (!v) continue; const vk = keys(v); if (typed.some((k) => vk.includes(k)) || (exact.length >= 3 && exact === normText(v))) hits.add(v); }
  return hits.size === 1 ? [...hits][0] : null; // two different villages with the same skeleton: do not guess
}
