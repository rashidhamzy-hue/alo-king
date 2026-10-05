// Search-first entry: any food word or mood returns ONE list of the best open, nearest matches (no category tree on the default path).
// Pure functions (mood lexicon, distance, ordering, WhatsApp rows); the database/index work lives in index.ts.
import { normText, tokens } from "./resolve.ts";
import { hasOrderIntent } from "./orderparse.ts";
import { isGreeting } from "./customer.ts";
import { isCancelText, isYesText } from "./basket.ts";
import { META } from "../_shared/meta-limits.ts";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export type Mood = "light" | "sweet" | "spicy" | "breakfast" | "cheap" | "popular";
const MOODS: { mood: Mood; words: string[]; terms: string[] }[] = [
  { mood: "light", words: ["light", "healthy", "lighter", "خفيف", "صحي", "khafif", "se7i", "sa7i", "sehi"], terms: ["salad", "grill", "grilled", "soup", "fattoush", "tabbouleh", "سلطة", "مشاوي", "شوربة", "فتوش", "تبولة"] },
  { mood: "sweet", words: ["sweet", "sweets", "dessert", "desserts", "sugar", "حلو", "حلوى", "حلويات", "حلا", "7ilo", "7elo", "7ilou", "helou", "7alaweyet"], terms: ["dessert", "sweet", "knefe", "kunafa", "baklava", "cake", "waffle", "ice cream", "crepe", "حلو", "حلويات", "كنافة", "بقلاوة", "كيك", "وافل", "بوظة"] },
  { mood: "spicy", words: ["spicy", "chili", "chilli", "حار", "حامي", "7arr", "7ar", "7ami", "harr"], terms: ["spicy", "hot", "chili", "buffalo", "harra", "حار", "حرة"] },
  { mood: "breakfast", words: ["breakfast", "brunch", "morning", "فطور", "صباحي", "ftour", "ftoor", "fto0r"], terms: ["breakfast", "manakish", "manoushe", "saj", "eggs", "foul", "labneh", "فطور", "منقوشة", "فول", "بيض", "لبنة", "صاج"] },
  { mood: "cheap", words: ["cheap", "cheapest", "budget", "affordable", "رخيص", "ارخص", "rakhis", "ar5as", "arkhas", "ar5ass"], terms: ["sandwich", "manoushe", "falafel", "فلافل", "ساندويش", "منقوشة"] },
  { mood: "popular", words: ["hungry", "starving", "anything", "recommend", "recommendation", "جوعان", "جعان", "جوعانة", "jou3an", "jou3ane", "jaan", "جوعانه"], terms: [] },
];
const POPULAR_PHRASES = ["whats good", "what s good", "surprise me", "what do you recommend", "شو احلى", "شو الاحلى", "فاجئني"];

/** A mood ("something light", "حلو", "7ilo") -> the search terms that stand for it. A plain dish word is not a mood. */
export function moodTerms(text: string): { mood: Mood; terms: string[] } | null {
  const n = normText(text); const toks = new Set(n.split(" "));
  for (const m of MOODS) if (m.words.some((w) => toks.has(normText(w)))) return { mood: m.mood, terms: m.terms };
  if (POPULAR_PHRASES.some((p) => n.includes(normText(p)))) return { mood: "popular", terms: [] };
  return null;
}

// Anything about diets, allergies, negation or a complaint is never answered by a canned list: the model (with search_menu and the allergen rules) handles it.
const GUARD = /(?:^|\s)(?:no|not|non|without|free|allergic|allergy|allergies|allergen|allergens|nut|nuts|peanut|peanuts|sesame|gluten|vegan|vegetarian|halal|kosher|lactose|dairy|diabetic|celiac|coeliac|safe|ingredients|is it|are they|was|were|late|driver|delivery|delivered|cold|wrong|missing|rude|dirty|bad|worst|terrible|refund|complaint|bala|bdon|bedon|bidun|bedoun|msh|mish|ma3|وصل|وصلت|بدون|بلا|ما|مش|حساسية|حساسيه|نباتي|نباتيه|خالي|حلال|لاكتوز|سكري|متأخر|بارد|غلط|سائق|توصيل)(?:\s|$)/;
const NOT_SEARCH = /\b(?:checkout|basket|my order|my data|delete|stop|unsubscribe|person|human|agent|refund|cancel|where is|talk to|speak to|make it|my name|street|building|near the|please call|thanks|thank you|ok|okay)\b|سلة|سلتي|طلبي|موظف|حدا|الغي|اسمي|شارع|بناية|شكرا|وين طلبي|احذف|بدي احكي/i;
/** A short message with no digits, not an order, not a command/greeting/confirmation: worth trying as a search. Whether it really matches the menu is decided by the caller. */
export function looksLikeSearch(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || t.length > 60) return false;
  const digits = /\d/.test(t) || /[٠-٩]/.test(t);
  if (digits && !(moodTerms(t) && normText(t).split(" ").filter(Boolean).length <= 3)) return false; // digits mean quantities, phone numbers or addresses, except Arabizi mood words (7ilo, 7ar, jou3an, ftour)
  if (isGreeting(t) || isYesText(t) || isCancelText(t) || NOT_SEARCH.test(t)) return false;
  const g = normText(t); if (GUARD.test(g) || GUARD.test(g.replace(/(^|\s)و(?=\S{2})/g, "$1"))) return false; // also with an attached Arabic "و" removed (وما وصل, وبدون)
  if (hasOrderIntent(t)) return false;
  const words = normText(t).split(" ").filter(Boolean).length;
  if (moodTerms(t) !== null) return words <= 3; // a mood is a short phrase ("something light", "حلو"), not a word inside a longer sentence
  return tokens(t).length >= 1 && tokens(t).length <= 4;
}

export type SearchHit = { item_id: string; vendor_id: string; vendor_name: string; name_en: string; name_ar: string; price_usd: number; score: number; is_popular: boolean; km: number | null; exact?: boolean };

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180, dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Relevance tier first (within 0.15 of the best), then nearest (unknown last), then popular, then score. */
export function orderNearest(hits: SearchHit[]): SearchHit[] {
  const best = Math.max(0, ...hits.map((h) => h.score));
  const tier = (h: SearchHit) => (h.score >= best - 0.15 ? 0 : 1);
  return [...hits].sort((a, b) => tier(a) - tier(b) || (a.km ?? Infinity) - (b.km ?? Infinity) || Number(b.is_popular) - Number(a.is_popular) || b.score - a.score);
}

/** At most 10 rows (WhatsApp's list limit), at most 3 per vendor so one kitchen cannot fill the list. Ids open the item card (`ITEM|vendor|item`). */
export function buildSearchRows(hits: SearchHit[], ar: boolean, both: (n: number) => string): { id: string; title: string; description: string }[] {
  const per = new Map<string, number>(); const rows: { id: string; title: string; description: string }[] = [];
  for (const h of hits) {
    if (rows.length >= META.listRows) break;
    if ((per.get(h.vendor_id) ?? 0) >= 3) continue;
    per.set(h.vendor_id, (per.get(h.vendor_id) ?? 0) + 1);
    const km = h.km != null && h.exact !== false ? ` · ${h.km.toFixed(1)} km` : "";
    const price = both(h.price_usd);
    rows.push({ id: clip(`ITEM|${h.vendor_id}|${h.item_id}`, META.rowId), title: clip((ar && h.name_ar) || h.name_en || h.name_ar || h.item_id, META.rowTitle), description: clip(`${clip(h.vendor_name, Math.max(8, META.rowDescription - price.length - km.length - 3))}${km} · ${price}`, META.rowDescription) });
  }
  return rows;
}

/** vendor_is_open returns true (open), false (closed) or null (no opening hours configured). Everywhere else in the bot only an explicit `false` blocks ordering, so null means "open"; an RPC error counts as closed because this list says "Open now". */
export const isOpenResult = (r: { data: unknown; error?: unknown }): boolean => !r.error && r.data !== false;
