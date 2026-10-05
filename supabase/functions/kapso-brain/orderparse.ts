// Multi-item natural-language ordering without a model: "2 shawarma, fries and a Pepsi from X" (English, Arabic, Arabizi) -> quantities + queries,
// then a deterministic decision: add everything (one basket card), ask ONE short question, or hand the turn to the model with the resolved matches.
// Pure functions. Prices never appear here: the basket re-reads them from the database.
import { extractVendorHint, normText, splitSegments } from "./resolve.ts";

export type Seg = { qty: number; query: string; raw: string; risky: boolean }; // risky: the typed quantity was 0 or above 10 and was clamped, or came from a number that may be part of a dish name
const MAX_SEGMENTS = 8, MAX_QTY = 20;
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1,
  wahad: 1, wahed: 1, wahde: 1, wa7ad: 1, tnein: 2, tneen: 2, etneen: 2, etnein: 2, tnen: 2, tlete: 3, tlet: 3, tlata: 3, arba3a: 4, arba3: 4, arba3a_: 4, khamse: 5, "5amse": 5, khamsa: 5, sitte: 6, sette: 6, sab3a: 7, sab3: 7, tmenye: 8, tmene: 8, tmanye: 8, tes3a: 9, tes3: 9, "3ashra": 10, "3ashre": 10,
  واحد: 1, واحده: 1, اتنين: 2, اثنين: 2, تنين: 2, اثنتين: 2, ثنتين: 2, ثلاثه: 3, تلاته: 3, تلات: 3, ثلاث: 3, اربعه: 4, اربع: 4, خمسه: 5, خمس: 5, سته: 6, سبعه: 7, ثمانيه: 8, تمانيه: 8, ثمان: 8, تسعه: 9, تسع: 9, عشره: 10, // "ست" (lady), "سبع" (lion), "تمن" (price), "عشر" are ordinary words: only the unambiguous forms count
};
const FILL = new Set(["i", "want", "wanna", "would", "like", "can", "could", "you", "get", "give", "me", "us", "please", "pls", "plz", "add", "order", "also", "and", "some", "bring", "send", "need", "have", "to", "ill", "take", "lets", "let's",
  "badde", "bade", "bde", "bdi", "badi", "baddi", "bddi", "badna", "bdna", "baddna", "3teni", "a3tini", "jibli", "w", "wi", "yalla", "ya", "men", "bdk", "badna",
  "بدي", "بدنا", "بدّي", "عطيني", "اعطيني", "جبلي", "ضيف", "اضافه", "وكمان", "كمان", "لو", "سمحت", "فضلك", "من", "و", "اريد", "ابغى", "بدك"]);
const ORDER_VERBS = new Set(["want", "wanna", "give", "add", "order", "get", "need", "bring", "send", "take", "badde", "bade", "bde", "bdi", "badi", "baddi", "bddi", "badna", "bdna", "baddna", "3teni", "a3tini", "jibli", "بدي", "بدنا", "عطيني", "اعطيني", "جبلي", "ضيف", "اريد", "ابغى", "اطلب"]);

export const numOf = (tok: string): number | null => {
  const t = digits(tok.toLowerCase());
  let m = t.match(/^(\d{1,3})x?$/) ?? t.match(/^x(\d{1,3})$/); if (m) return Number(m[1]);
  const w = NUM_WORDS[normText(t)]; return w ?? null;
};
const clampQ = (n: number) => Math.max(1, Math.min(MAX_QTY, n));
const RISKY_QTY = 10; // a typed quantity of 0 or above this goes to the model (typo, size or pack number)

/** Split the typed text into {qty, query} segments plus an optional vendor named at the end. `known` lets the caller undo an attached Arabic "و" (وبطاطا -> و بطاطا) only when the remainder is a real menu word. */
export function parseOrder(text: string, known?: (word: string) => boolean): { segments: Seg[]; hint: string | null } {
  let t = digits(String(text ?? "")).replace(/[؟?!.]+/g, " ").trim();
  if (!t) return { segments: [], hint: null };
  if (known) t = t.split(/\s+/).map((w) => { const n = normText(w); return n.length >= 4 && n.startsWith("و") && !known(n) && known(n.slice(1)) ? `و ${n.slice(1)}` : w; }).join(" ");
  const { rest, hint } = extractVendorHint(t);
  const segments: Seg[] = [];
  for (const raw of splitSegments(rest).slice(0, MAX_SEGMENTS)) {
    let toks = raw.split(/\s+/).filter(Boolean), qty = 1;
    while (toks.length && FILL.has(normText(toks[0]))) toks.shift();
    if (toks.length >= 3 && /^couple$/i.test(toks[1]) && /^a$/i.test(toks[0]) && /^of$/i.test(toks[2])) { qty = 2; toks = toks.slice(3); }
    else if (toks.length > 1) { const n = numOf(toks[0]); if (n !== null) { qty = n; toks.shift(); } }
    if (toks.length > 1) { const n = numOf(toks[toks.length - 1]); if (n !== null && /^x\d+$|^\d+x$/i.test(toks[toks.length - 1])) { qty = n; toks.pop(); } }
    while (toks.length && /^(please|pls|plz|thanks|thank|من|فضلك|سمحت|لو)$/i.test(toks[toks.length - 1])) toks.pop();
    const query = toks.join(" ").trim();
    if (query) segments.push({ qty: clampQ(qty), query, raw, risky: qty < 1 || qty > RISKY_QTY });
  }
  return { segments, hint };
}

const NOT_AN_ORDER = /(?:^|\s)(?:do you|does|have you|any|is there|are there|got any|how|what|where|when|who|why|which|can i have a look|no|not|without|remove|delete|drop|cancel|cold|wrong|late|missing|burnt|bad|terrible|allergic|allergy|gluten|vegan|halal|ingredients|sorry|refund|complain|instead|bala|shil|sheel|ma|mish|msh|مش|بدون|بلا|شيل|احذف|الغي|ما|هل|شو|وين|كيف|ليش|عندكم|عندك|بارد|غلط|متأخر|حساسية|وين طلبي)(?:\s|$)|\?|؟/;

/** Does this look like the customer is ordering (vs searching or asking)? A bare "shawarma" or "do you have falafel" is a search. */
export function hasOrderIntent(text: string): boolean {
  const t = digits(String(text ?? "")).replace(/[؟?!]+/g, " ").trim();
  if (!t) return false;
  if (NOT_AN_ORDER.test(t.toLowerCase())) return false; // questions, complaints, removals and negations belong to the model / basket edit, never to a deterministic add
  const segs = splitSegments(extractVendorHint(t).rest);
  if (segs.length >= 2) return true;
  const toks = t.toLowerCase().split(/\s+/).filter(Boolean);
  if (toks.some((w) => ORDER_VERBS.has(normText(w)))) return true;
  return toks.some((w) => { const n = numOf(w); return n !== null && !/^(a|an)$/.test(w); }) && !/\b(do you|have|any|is there|how|what|where|when|who)\b|عندكم|هل|كم/.test(t.toLowerCase());
}

export type Cand = { item_id: string; vendor_id: string; name: string; score: number; needs_choices: boolean; open_now: boolean };
export type SegCands = { qty: number; query: string; cands: Cand[]; risky?: boolean };
export type Line = { item_id: string; quantity: number; name: string };
export type Decision =
  | { kind: "add"; vendorId: string; items: Line[] }
  | { kind: "ask"; vendorId: string; addNow: Line[]; question: { quantity: number; query: string; options: { item_id: string; vendor_id: string; name: string }[] } }
  | { kind: "model" };

const CONFIDENT = 0.8, MARGIN = 0.12, MAX_LINES = 10;
export function decideOrder(segs: SegCands[], o: { preferVendors?: Set<string> } = {}): Decision {
  if (!segs.length || segs.length > MAX_LINES || segs.some((s) => !s.cands.length || s.risky)) return { kind: "model" };
  // one vendor must be able to serve every segment
  const perSeg = segs.map((s) => new Set(s.cands.filter((c) => c.score >= CONFIDENT - MARGIN).map((c) => c.vendor_id)));
  let common = [...perSeg[0]].filter((v) => perSeg.every((set) => set.has(v)));
  if (common.length > 1) { const pref = common.filter((v) => o.preferVendors?.has(v)); if (pref.length === 1) common = pref; }
  if (common.length !== 1) return { kind: "model" };
  const vendorId = common[0];
  const addNow: Line[] = [];
  for (const s of segs) {
    const mine = s.cands.filter((c) => c.vendor_id === vendorId).sort((a, b) => b.score - a.score);
    const top = mine[0];
    if (!top.open_now || top.needs_choices || top.score < CONFIDENT) return { kind: "model" };
    if (new RegExp(`(^|\\D)${s.qty}(\\D|$)`).test(top.name)) return { kind: "model" }; // "4 cheese pizza" vs a dish literally named "4 Cheese Pizza": the number may be the dish, not the quantity
    const close = mine.filter((c) => c.score >= top.score - MARGIN);
    if (close.length > 1) {
      if (close.some((c) => !c.open_now || c.needs_choices)) return { kind: "model" };
      return { kind: "ask", vendorId, addNow, question: { quantity: s.qty, query: s.query, options: close.slice(0, 3).map((c) => ({ item_id: c.item_id, vendor_id: c.vendor_id, name: c.name })) } };
    }
    addNow.push({ item_id: top.item_id, quantity: s.qty, name: top.name });
  }
  return { kind: "add", vendorId, items: addNow };
}

/** The one short question for an ambiguous item: names only (no amounts), up to 3 buttons that add the chosen dish with the typed quantity. */
export function buildAskCard(o: { query: string; quantity: number; added: string[]; failed: string[]; options: { vendor_id: string; item_id: string; name: string }[]; ar: boolean }): { body: string; buttons: { id: string; title: string }[] } {
  const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
  const qty = o.quantity > 1 ? ` ×${o.quantity}` : "";
  const added = o.added.length ? (o.ar ? `\n✅ انضاف: ${o.added.join("، ")}` : `\n✅ Added: ${o.added.join(", ")}`) : "";
  const failed = o.failed.length ? (o.ar ? `\n⚠️ ما قدرت أضيف: ${o.failed.join("، ")}` : `\n⚠️ Couldn't add: ${o.failed.join(", ")}`) : "";
  const q = clip(o.query, 40);
  return { body: o.ar ? `أي واحد لـ *${q}*${qty}؟ 👇${added}${failed}` : `Which one for *${q}*${qty}? 👇${added}${failed}`,
    buttons: o.options.slice(0, 3).map((x) => ({ id: `ADD|${x.vendor_id}|${x.item_id}|${o.quantity}`.slice(0, 256), title: clip(x.name, 20) })) };
}
