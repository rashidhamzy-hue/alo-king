// Party builder (P1-8): "breakfast for 5 adults and 2 kids" -> ONE complete spread from ONE open vendor, sized for the party, with a total and a one-tap accept.
// Pure: request parsing, sizing from the portion data we already have (menu_items.serves, else portion_grams), the spread, the card and the tap id.
// Prices come from the database rows passed in by index.ts; an accept tap re-validates every line through addLine (open, available, no alcohol, server prices).
import { daypartAt, daypartScore, isExtraItem, itemDayparts, type Daypart } from "./daypart.ts";
import { isAlcohol } from "../_shared/alcohol.ts";
import { isDrinkItem } from "./browse.ts";
import { isAddOn } from "./numbered.ts";
import { META } from "../_shared/meta-limits.ts";

export type PartyRequest = { adults: number; kids: number; meal: Daypart | null };

const AR_DIG = "٠١٢٣٤٥٦٧٨٩";
const norm = (s: string) => String(s ?? "").normalize("NFKD").replace(/[̀-ًͯ-ٟـ]/g, "").toLowerCase().replace(/[٠-٩]/g, (d) => String(AR_DIG.indexOf(d))).replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[,،؛;]+/g, " ").replace(/\s+/g, " ").trim();
const ADULT = "adults?|people|persons?|pax|guests|ppl|grown ?ups?|big|كبار|كبير|اشخاص|ناس|شخص|بالغين|kbar|ashkhas|nas|shakhs";
const KID = "kids?|children|child|toddlers?|babies|little ones|اولاد|اطفال|ولاد|صغار|ولد|طفل|wlad|walad|atfal|sghar|zghar";
const MEAL: [RegExp, Daypart][] = [[/\b(?:breakfast|brunch|ftour|ftoor|fto0r)\b|فطور|فطار/, "breakfast"], [/\b(?:lunch|ghada|ghedaa)\b|غداء|غدا/, "lunch"], [/\b(?:dinner|3asha|aasha|supper)\b|عشاء/, "dinner"], [/\b(?:late night|snacks?)\b|سهره/, "late"]];
const INTENT = /\b(?:food|order|eat|feed|spread|catering|party|meal|menu|hungry)\b|اكل|طلب|وليمه|عزومه|وجبه|جوعانين/;

/** A request to feed a group (three or more people, with a meal word or an ordering word). Anything else is null and goes through the normal flow. */
export function parsePartyRequest(text: string): PartyRequest | null {
  const t = norm(text);
  if (!t || t.length > 200) return null;
  const num = (re: RegExp) => { const m = t.match(re); return m ? Math.min(60, Number(m[1])) : 0; };
  let adults = num(new RegExp(`(?<![\\d.:/])(\\d{1,2})\\s*(?:x\\s*)?(?:${ADULT})(?![a-z\\u0600-\\u06ff])`)), kids = num(new RegExp(`(?<![\\d.:/])(\\d{1,2})\\s*(?:x\\s*)?(?:${KID})(?![a-z\\u0600-\\u06ff])`));
  const meal = MEAL.find(([re]) => re.test(t))?.[1] ?? null;
  if (!adults && !kids) { const m = t.match(/\b(?:for|ل|لـ)\s*(\d{1,2})\b(?!\s*(?:min|mins|minutes|hours?|days?|pm|am|usd|lbp|\$|dollars?))/) ?? t.match(/(?:^|\s)لـ?\s*(\d{1,2})(?:\s|$)/); if (m) adults = Math.min(60, Number(m[1])); }
  if (adults + kids < 3 || adults + kids > 40) return null;
  if (!meal && !INTENT.test(t)) return null;
  return { adults, kids, meal };
}

export type PartyItem = { item_id: string; item_name_en?: string | null; item_name_ar?: string | null; price_usd: number | string; section?: string | null; is_popular?: boolean | null; sort_order?: number | null; contains_alcohol?: boolean | null; serves?: number | string | null; portion_grams?: number | string | null; customizations?: unknown };

/** How many people one portion feeds: the vendor's `serves`, else the portion weight (about 300 g a person), else 1. */
export function servesOf(it: Pick<PartyItem, "serves" | "portion_grams">): number {
  const s = Number(it.serves); if (Number.isFinite(s) && s >= 1) return Math.min(20, Math.floor(s));
  const g = Number(it.portion_grams); if (Number.isFinite(g) && g > 0) return Math.max(1, Math.min(20, Math.round(g / 300)));
  return 1;
}
/** Adult = 1 portion, child = half. */
export const portionsNeeded = (r: PartyRequest): number => Math.max(1, Math.ceil(r.adults + r.kids * 0.5));
const needsChoice = (it: PartyItem) => (Array.isArray(it.customizations) ? it.customizations : []).some((g: any) => g?.name && (g.required || Number(g.min ?? 0) > 0));

export type Spread = { lines: { item: PartyItem; qty: number }[]; subtotal: number; feeds: number };
export type SpreadResult = { ok: true; spread: Spread } | { ok: false; reason: "no_dishes" | "too_big" };

/** One spread from one vendor's menu: up to three different main dishes for the meal (different sections first), quantities sized to cover the party, plus one drink each when the vendor has a plain drink. */
export function buildSpread(menu: PartyItem[], req: PartyRequest, o: { meal?: Daypart | null; deliveryFee: number; codCap: number; now?: Date }): SpreadResult {
  const meal = req.meal ?? o.meal ?? daypartAt(o.now);
  const ok = menu.filter((it) => Number(it.price_usd) > 0 && !isAlcohol(it) && !isAddOn(it as any) && !isExtraItem(it) && !needsChoice(it) && daypartScore(it, meal) >= 1);
  const ranked = [...ok].sort((a, b) => daypartScore(b, meal) - daypartScore(a, meal) || Number(!!b.is_popular) - Number(!!a.is_popular) || (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || String(a.item_name_en ?? "").localeCompare(String(b.item_name_en ?? "")));
  if (!ranked.length) return { ok: false, reason: "no_dishes" };
  const picks: PartyItem[] = [], sections = new Set<string>();
  for (const it of ranked) { const s = String(it.section ?? ""); if (picks.length < 3 && !sections.has(s)) { picks.push(it); sections.add(s); } }
  for (const it of ranked) { if (picks.length >= 3) break; if (!picks.includes(it)) picks.push(it); }
  const need = portionsNeeded(req), share = Math.ceil(need / picks.length);
  const lines = picks.map((item) => ({ item, qty: Math.max(1, Math.min(20, Math.ceil(share / servesOf(item)))) }));
  const heads = Math.min(20, req.adults + req.kids);
  const drink = menu.filter((it) => Number(it.price_usd) > 0 && isDrinkItem(it as any) && !needsChoice(it)).sort((a, b) => Number(!!b.is_popular) - Number(!!a.is_popular) || Number(a.price_usd) - Number(b.price_usd))[0];
  const r2 = (n: number) => Math.round(n * 100) / 100, sum = (ls: { item: PartyItem; qty: number }[]) => r2(ls.reduce((s, l) => s + Number(l.item.price_usd) * l.qty, 0));
  const withDrink = drink ? [...lines, { item: drink, qty: Math.max(1, heads) }] : lines;
  const final = sum(withDrink) + o.deliveryFee <= o.codCap ? withDrink : sum(lines) + o.deliveryFee <= o.codCap ? lines : null;
  if (!final) return { ok: false, reason: "too_big" };
  return { ok: true, spread: { lines: final, subtotal: sum(final), feeds: lines.reduce((s, l) => s + servesOf(l.item) * l.qty, 0) } };
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const nm = (it: PartyItem, ar: boolean) => (ar && it.item_name_ar ? it.item_name_ar : it.item_name_en || it.item_name_ar || it.item_id);
const MEAL_LABEL: Record<Daypart, [string, string]> = { breakfast: ["Breakfast", "فطور"], lunch: ["Lunch", "غداء"], dinner: ["Dinner", "عشاء"], late: ["Late-night food", "أكل سهرة"] };

export const partyTapId = (vendorId: string, lines: { item_id: string; qty: number }[]) => `PARTY|${vendorId}|${lines.map((l) => `${l.item_id}:${l.qty}`).join(",")}`;
export function parsePartyTap(id: string): { vendorId: string; lines: { item_id: string; qty: number }[] } | null {
  const p = String(id ?? "").split("|");
  if (p.length !== 3 || p[0] !== "PARTY" || !p[1] || !p[2]) return null;
  const lines = p[2].split(",").map((x) => { const i = x.lastIndexOf(":"); return { item_id: x.slice(0, i), qty: Number(x.slice(i + 1)) }; });
  return lines.length && lines.length <= 5 && lines.every((l) => l.item_id && Number.isInteger(l.qty) && l.qty >= 1 && l.qty <= 20) ? { vendorId: p[1], lines } : null;
}

/** The proposal: the lines, what it feeds, the total (dual currency via `both`) and [Add all to basket] [Change]. Null when the accept id would not fit WhatsApp's id limit. */
export function spreadCard(o: { vendorId: string; vendorName: string; req: PartyRequest; spread: Spread; meal: Daypart; deliveryFee: number; both: (n: number) => string; ar: boolean }): { body: string; buttons: { id: string; title: string }[] } | null {
  const id = partyTapId(o.vendorId, o.spread.lines.map((l) => ({ item_id: l.item.item_id, qty: l.qty })));
  if (id.length > META.buttonId) return null;
  const who = o.ar ? `${o.req.adults ? `${o.req.adults} كبار` : ""}${o.req.adults && o.req.kids ? " و" : ""}${o.req.kids ? `${o.req.kids} أولاد` : ""}` : `${o.req.adults ? `${o.req.adults} adult${o.req.adults > 1 ? "s" : ""}` : ""}${o.req.adults && o.req.kids ? " + " : ""}${o.req.kids ? `${o.req.kids} kid${o.req.kids > 1 ? "s" : ""}` : ""}`;
  const rows = o.spread.lines.map((l) => `• ${l.qty} × ${clip(nm(l.item, o.ar), 40)} — ${o.both(Number(l.item.price_usd) * l.qty)}`).join("\n");
  const total = Math.round((o.spread.subtotal + o.deliveryFee) * 100) / 100;
  const body = o.ar
    ? `*${MEAL_LABEL[o.meal][1]} لـ ${who}* — ${clip(o.vendorName, 40)} 🍽\n\n${rows}\n\nبيكفي حوالي ${o.spread.feeds} أشخاص\nالمجموع مع التوصيل: *${o.both(total)}*\nدفع عند التسليم`
    : `*${MEAL_LABEL[o.meal][0]} for ${who}* — ${clip(o.vendorName, 40)} 🍽\n\n${rows}\n\nFeeds about ${o.spread.feeds}\nTotal with delivery: *${o.both(total)}*\nCash on delivery`;
  return { body: clip(body, META.body), buttons: [{ id, title: o.ar ? "✅ أضف الكل للسلة" : "✅ Add all to basket" }, { id: `MENU|${o.vendorId}`, title: o.ar ? "✏️ غيّر" : "✏️ Change" }] };
}

/** Vendors worth trying first: those with the most dishes made for the meal, nearer first (km already computed by the caller; null = unknown). */
export function rankVendorsForParty(items: { vendor_id: string; section: string; name_en: string; name_ar: string }[], meal: Daypart, km: (vendorId: string) => number | null): string[] {
  const score = new Map<string, number>();
  for (const it of items) if ((itemDayparts(it as any)?.includes(meal) ?? false) && !isExtraItem(it)) score.set(it.vendor_id, (score.get(it.vendor_id) ?? 0) + 1);
  return [...score.entries()].filter(([, n]) => n >= 2).sort((a, b) => (km(a[0]) ?? 1e9) - (km(b[0]) ?? 1e9) || b[1] - a[1]).map(([v]) => v).slice(0, 12);
}
