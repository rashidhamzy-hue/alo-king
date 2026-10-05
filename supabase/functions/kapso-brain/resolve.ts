// Server-side menu resolution: turn what the customer typed (Arabic, English, Arabizi, typos) into ranked menu items without a model call.
// Pure functions, no I/O. The model only chooses among the resolved matches; prices are always re-read from the database when anything is added.

export type IndexItem = { item_id: string; vendor_id: string; vendor_name: string; vendor_name_ar: string; name_en: string; name_ar: string; section: string; price_usd: number; is_popular: boolean };
export type Ranked = { item: IndexItem; score: number };

const AR_DIACRITICS = /[ً-ٰٟـ]/g; // harakat, dagger alef, tatweel
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Lowercase, strip Arabic diacritics, unify alef/ya/ta-marbuta forms, Arabic-Indic digits to ASCII, drop punctuation. */
export function normText(s: string): string {
  return String(s ?? "").toLowerCase().normalize("NFKC")
    .replace(AR_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ؤ]/g, "و").replace(/[ئ]/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

// One consonant skeleton for Arabic script, Arabizi and English transliterations. Vowels and the semi-vowels w/y are dropped (they are
// vowels in one spelling and consonants in another), emphatic/voiced pairs are merged, and repeated letters collapse.
const AR_MAP: Record<string, string> = { ب: "b", ت: "t", ث: "t", ج: "j", ح: "h", خ: "#", د: "d", ذ: "d", ر: "r", ز: "z", س: "s", ش: "$", ص: "s", ض: "d", ط: "t", ظ: "z", غ: "@", ف: "f", ق: "k", ك: "k", ل: "l", م: "m", ن: "n", ه: "h" };
export function skeleton(word: string): string {
  let w = normText(word).replace(/\s+/g, "");
  w = w.replace(/sh|ch/g, "$").replace(/kh/g, "#").replace(/gh/g, "@").replace(/th/g, "t").replace(/dh/g, "d").replace(/ph/g, "f").replace(/ck/g, "k").replace(/ce|ci|cy/g, (m) => "s" + m[1]);
  let out = "";
  for (const ch of w) {
    if (AR_MAP[ch]) out += AR_MAP[ch];
    else if (/[؀-ۿ]/.test(ch)) continue; // ا ع ء و ي and other vowels/marks
    else if (ch === "7") out += "h"; else if (ch === "5") out += "#"; else if (ch === "9") out += "k"; else if (ch === "6") out += "t"; else if (ch === "8") out += "@";
    else if (ch === "3" || ch === "2") continue;
    else if (ch === "g") out += "@"; else if (ch === "q" || ch === "c") out += "k"; else if (ch === "p") out += "b"; else if (ch === "v") out += "f"; else if (ch === "x") out += "ks";
    else if ("aeiouywh".includes(ch) && ch !== "h") continue;
    else if (/[a-z$#@]/.test(ch)) out += ch;
  }
  return out.replace(/(.)\1+/g, "$1");
}

const STOP = new Set([
  "a", "an", "the", "i", "me", "my", "we", "us", "want", "wanna", "need", "like", "would", "can", "could", "get", "give", "have", "please", "pls", "plz", "thanks", "thank", "you", "some", "with", "and", "or", "of", "for", "to", "from", "at", "x", "one", "two", "three", "four", "five", "six", "order", "add", "also", "too", "extra", "more", "bring", "send", "of",
  "badde", "bade", "bde", "bdi", "badi", "baddi", "bddi", "badna", "bdna", "baddna", "men", "min", "3end", "3and", "w", "wi", "wa", "fadlak", "fadlek", "yalla", "ya", "hai", "hayda", "wahad", "wahed", "tnein", "tneen", "etneen", "tlete", "tlet", "arba3a", "arba3", "khamse", "5amse", "set", "sitte",
  "بدي", "بدنا", "بدّي", "عطيني", "جبلي", "من", "عند", "و", "مع", "او", "أو", "لو", "سمحت", "فضلك", "رجاء", "رجاءا", "شكرا", "اذا", "ان", "في", "على", "واحد", "وحده", "اتنين", "اثنين", "تنين", "ثلاثه", "تلاته", "تلات", "اربعه", "اربع", "خمسه", "خمس", "ستا", "هالـ", "هيدا", "هاي",
]);
export const tokens = (text: string): string[] => normText(text).split(" ").filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t) && !/^\d+x$/.test(t) && !/^x\d+$/.test(t));

function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); rowMin = Math.min(rowMin, cur[j]); }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
const stem = (t: string) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);

/** How well one typed token matches one name token (0..1). */
function tokenScore(q: string, qs: string, w: string, ws: string): number {
  if (q === w) return 1;
  if (stem(q) === stem(w) && q.length >= 3) return 0.97;
  if (qs.length >= 2 && qs === ws) return 0.9;
  if (q.length >= 3 && (w.startsWith(q) || (w.length >= 3 && q.startsWith(w) && q.length - w.length <= 2))) return 0.85;
  if (q.length >= 4 && lev(q, w, 1) <= 1) return 0.8;
  if (q.length >= 7 && lev(q, w, 2) <= 2) return 0.72;
  if (qs.length >= 3 && ws.length >= 3 && lev(qs, ws, 1) <= 1) return 0.7;
  return 0;
}

type Prepared = { item: IndexItem; en: { w: string; s: string }[]; ar: { w: string; s: string }[]; vendor: { w: string; s: string }[] };
const prep = (item: IndexItem): Prepared => {
  const mk = (t: string) => normText(t).split(" ").filter(Boolean).map((w) => ({ w, s: skeleton(w) }));
  return { item, en: mk(item.name_en), ar: mk(item.name_ar), vendor: mk(`${item.vendor_name} ${item.vendor_name_ar}`) };
};
const prepCache = new WeakMap<IndexItem, Prepared>();
/** Warm the per-item token/skeleton cache once when the index is loaded, so the first customer search is not slower. */
export const prepareIndex = (items: IndexItem[]) => { for (const it of items) prepared(it); };
const prepared = (it: IndexItem) => { let p = prepCache.get(it); if (!p) { p = prep(it); prepCache.set(it, p); } return p; };

/** Ranked matches for a (segment of a) customer message. Items below the relevance floor are never returned. */
export function rankItems(query: string, items: IndexItem[], o: { vendorId?: string; preferVendors?: Set<string>; floor?: number } = {}): Ranked[] {
  const qt = tokens(query).map((w) => ({ w, s: skeleton(w) }));
  if (!qt.length) return [];
  const floor = o.floor ?? 0.6;
  const out: (Ranked & { key: number })[] = [];
  for (const it of items) {
    if (o.vendorId && it.vendor_id !== o.vendorId) continue;
    const p = prepared(it);
    let sum = 0; const used = new Set<string>(); let nameHits = 0;
    for (const q of qt) {
      let best = 0, bestKey = "";
      for (const side of [p.en, p.ar]) side.forEach((n, i) => { const sc = tokenScore(q.w, q.s, n.w, n.s); if (sc > best) { best = sc; bestKey = `${side === p.en ? "e" : "a"}${i}`; } });
      if (best > 0) { sum += best; nameHits++; used.add(bestKey); }
    }
    if (!nameHits) continue;
    let score = sum / qt.length;
    // an item name with many words the customer did not say is a worse match than a tight one
    const nameWords = Math.max(p.en.length, p.ar.length, 1);
    score *= 0.88 + 0.12 * Math.min(1, used.size / nameWords);
    score = Math.min(1, score + (it.is_popular ? 0.01 : 0));
    if (score >= floor) out.push({ item: it, score, key: score + (o.preferVendors?.has(it.vendor_id) ? 0.07 : 0) }); // the basket's vendor wins near-ties
  }
  return out.sort((a, b) => b.key - a.key || a.item.name_en.length - b.item.name_en.length).map(({ item, score }) => ({ item, score }));
}

/** "2 shawarma, fries and a Pepsi" -> ["2 shawarma", "fries", "a Pepsi"]. Splits on commas, plus, newlines and the word and/و/w. */
export function splitSegments(text: string): string[] {
  return String(text ?? "").split(/\s*(?:[,،;+\n]|\s&\s|\s+and\s+|\s+و\s+|\s+w\s+|\s+wi\s+|\s+ou\s+)\s*/i).map((s) => s.replace(/\s+/g, " ").trim().replace(/^(?:and|w|wi|و)\s+/i, "")).filter(Boolean);
}

/** "… from Shawarma King" / "من الملك" / "men pizza hut": the vendor named at the end of the message. */
export function extractVendorHint(text: string): { rest: string; hint: string | null } {
  const t = String(text ?? "").trim();
  const m = t.match(/^(.*?)(?:\s+|^)(?:from|at|min|men|من|عند|3end|3and)\s+([^,;\n]+?)\s*(?:please|pls|plz|لو سمحت|من فضلك)?\s*$/i);
  if (!m || !m[2].trim()) return { rest: t, hint: null };
  return { rest: m[1].trim(), hint: m[2].trim() };
}
