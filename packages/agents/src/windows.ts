// W1: delivery windows for customers (C3's requests 1 to 4 and 7). A time said in words is read here, by code; which windows are
// open, full or past their cut-off is the database's (open_delivery_windows_when, request_delivery_window, quote_order with a
// slot). Nothing here knows the clock or the hub's time zone: the reader returns words (tomorrow, the morning), the database
// turns them into windows. The eval cases are evals/cases/delivery_time.json.
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliver, issueCard, sendCard, type ToolContext } from "./concierge-tools";
import { formatWindowChoice, type DeliveryWindow, type Quote } from "./order-card";
import { messages } from "./messages";

/** Every fixed message in this conversation's language (M1). */
const T = (ctx: ToolContext) => messages(ctx.state.lang);

/** A time said in words. day_offset 0 today; dow ISO (1 Monday); at/before/after hub-local HH:MM; any: "show me the times". */
export interface When {
  day_offset?: number; dow?: number; part?: "morning" | "noon" | "afternoon" | "evening";
  at?: string; before?: string; after?: string; any?: boolean;
}

/** Lower case, no accents, diacritics or tatweel, one alef, ta marbuta as ha, alef maqsura as ya, western digits, no punctuation. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/ـ/g, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[-_]/g, " ").replace(/[^\p{L}\p{N}': ]+/gu, " ").replace(/\s+/g, " ").trim();
}

const alt = (xs: string[]) => xs.join("|");
// Greetings that carry a part of the day and say nothing about delivery.
const GREETINGS = alt(["good morning", "good afternoon", "good evening", "صباح الخير", "صباح النور", "مسا الخير", "مساء الخير", "مسا النور",
  "sabah el kheir", "sabah el kher", "saba7 el kher", "saba7 el kheir", "sabah al khair", "masa el kheir", "masa el kher", "masa2 el kher"]);
const ANY = alt(["مش هلق", "مش هلا", "مش هلء", "مش هلا", "مش هلأ", "بعدين", "بوقت تاني", "وقت تاني", "شو الاوقات", "اوقات التوصيل",
  "(?:ايمتي|امتي|ايمت|امت) (?:فيك|فيكن|فيكم|فيكو) (?:توصل|توصلو|توصلوا|توصلولي|تبعت|تبعتو|تبعتوا|تجيبو|تجيبوا)",
  "mish halla2", "mish hala2", "msh halla2", "msh hala2", "mesh halla2", "mesh hala2", "ba3dein", "ba3den", "ba3dein", "later",
  "another time", "plus tard", "when can you deliver", "delivery times", "delivery slots", "emta fikon twasslo", "aymta fikon twasslo"]);
const DAY_AFTER = alt(["بعد بكرا", "بعد بكره", "ba3d bokra", "ba3d bukra", "ba3ed bokra", "baad bokra", "ba3d bkra", "day after tomorrow", "apres demain"]);
const TOMORROW = alt(["بكرا", "بكره", "bokra", "bukra", "bkra", "boukra", "bokrah", "tomorrow", "tmrw", "demain"]);
const TODAY = alt(["اليوم", "lyom", "el yom", "al yom", "elyom", "lyoum", "today", "aujourd'hui", "aujourdhui"]);
const TONIGHT = alt(["tonight", "this evening", "ce soir"]);
const THIS_MORNING = alt(["this morning", "ce matin"]);
const THIS_AFTERNOON = alt(["this afternoon", "cet apres midi"]);
const DOWS: [number, string][] = [
  [1, alt(["الاتنين", "الاثنين", "التنين", "el tanen", "tanen", "el tenen", "etnen", "monday", "lundi"])],
  [2, alt(["التلاتا", "التلاته", "الثلاثاء", "الثلاثا", "el talata", "talata", "tlata", "tuesday", "mardi"])],
  [3, alt(["الاربعا", "الاربعاء", "الاربعه", "el arb3a", "arb3a", "arba3a", "wednesday", "mercredi"])],
  [4, alt(["الخميس", "el khamis", "khamis", "5amis", "thursday", "jeudi"])],
  [5, alt(["الجمعه", "el jem3a", "jem3a", "jum3a", "jumaa", "jom3a", "joum3a", "jumu3a", "friday", "vendredi"])],
  [6, alt(["السبت", "el sabt", "l sabt", "saturday", "samedi"])],                    // never «سبت» alone: a basket
  [7, alt(["الاحد", "el a7ad", "a7ad", "el ahad", "ahad", "sunday", "dimanche"])],
];
// The afternoon first: «بعد الضهر» holds «الضهر».
const PARTS: [NonNullable<When["part"]>, string][] = [
  ["afternoon", alt(["بعد الضهر", "بعد الظهر", "بعد الضهريه", "العصر", "عالعصر", "ba3d el dohr", "ba3d l dohr", "ba3d el do7r", "ba3d edohr",
    "ba3d el duhr", "ba3ed el dohr", "ba3d dohr", "el 3asr", "3al 3asr", "3asr", "afternoon", "apres midi", "aprem"])],
  ["noon", alt(["الضهر", "الظهر", "عالضهر", "الضهريه", "el dohr", "el do7r", "dohr", "do7r", "duhr", "noon", "midday", "midi"])],
  ["morning", alt(["الصبح", "الصباح", "عالصبح", "بالصبح", "الصبحيه", "el sob7", "el sobh", "3al sob7", "sob7", "sobh", "sobo7", "morning", "le matin", "matin"])],
  ["evening", alt(["المسا", "المساء", "عالمسا", "بالمسا", "العشيه", "عشيه", "بالليل", "عالليل", "الليل", "el masa", "bel masa", "3al masa",
    "3ashiye", "3ashiyeh", "3ashieh", "3achiye", "bel lel", "el lel", "evening", "le soir", "soir"])],
];
const NUM = "(\\d{1,2})(?::(\\d{2}))?(?: ?(am|pm|h))?";
const CLOCK_WORD = "(?:الساعه |عالساعه |sa3a |el sa3a |l sa3a |3al sa3a |)";
const BEFORE = `(?:قبل|before|avant|2abl|abel|abl|qabl) ${CLOCK_WORD}${NUM}`;
const AFTER = `(?:بعد|after|apres|ba3d|ba3ed) ${CLOCK_WORD}${NUM}`;
// An hour needs a word that makes it one («الساعه 10», "at 10", "10am", "10h"): a bare number is a quantity.
const AT = [`(?:الساعه|عالساعه|sa3a|el sa3a|3al sa3a|at|around|حوالي الساعه) ${NUM}`, `(?:a |vers )?(\\d{1,2})(?::(\\d{2}))? ?(am|pm|h)`];

/** One match at a time, in order; what matched is masked so a later pattern never reads it again. */
function take(state: { t: string }, pattern: string): RegExpExecArray | null {
  const re = new RegExp(`(?:^| )(?:${pattern})(?= |$)`, "u");
  const m = re.exec(state.t);
  if (!m) return null;
  const start = m.index + (m[0].startsWith(" ") ? 1 : 0);
  state.t = state.t.slice(0, start) + m[0].trimStart().replace(/[^ ]+/g, "_") + state.t.slice(m.index + m[0].length);
  return m;
}

function hour(h: number, min: number, suffix: string | undefined, part: When["part"]): string | null {
  if (h > 23 || min > 59) return null;
  if (suffix === "pm" && h < 12) h += 12;
  else if (suffix === "am" && h === 12) h = 0;
  else if (suffix !== "am" && h <= 12) {
    if (part === "afternoon" || part === "evening") { if (h < 12) h += 12; }
    else if (part === "noon") { if (h <= 5) h += 12; }
    else if (part !== "morning" && h < 7) h += 12;                // «الساعه 4» is four in the afternoon; nobody delivers at four in the morning
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function read(text: string): { when: When | null; rest: string } {
  const state = { t: ` ${fold(text)} `.trim() };
  while (take(state, GREETINGS)) { /* greetings say nothing about a time */ }
  const w: When = {};
  let any = false;
  while (take(state, ANY)) any = true;
  if (take(state, DAY_AFTER)) w.day_offset = 2;
  else if (take(state, TONIGHT)) { w.day_offset = 0; w.part = "evening"; }
  else if (take(state, THIS_MORNING)) { w.day_offset = 0; w.part = "morning"; }
  else if (take(state, THIS_AFTERNOON)) { w.day_offset = 0; w.part = "afternoon"; }
  else if (take(state, TOMORROW)) w.day_offset = 1;
  else if (take(state, TODAY)) w.day_offset = 0;
  if (w.day_offset === undefined) for (const [d, p] of DOWS) if (take(state, p)) { w.dow = d; break; }
  if (!w.part) for (const [k, p] of PARTS) if (take(state, p)) { w.part = k; break; }
  const clock = (m: RegExpExecArray | null) => (m ? hour(Number(m[1]), Number(m[2] ?? 0), m[3], w.part) : null);
  const before = clock(take(state, BEFORE)); if (before) w.before = before;
  const after = clock(take(state, AFTER)); if (after) w.after = after;
  for (const p of AT) { const at = clock(take(state, p)); if (at) { w.at = at; break; } }
  if (Object.keys(w).length === 0) return { when: any ? { any: true } : null, rest: state.t };
  return { when: w, rest: state.t };
}

/** The time in the customer's words, or null. Read by code, judged by evals/cases/delivery_time.json. */
export function readWhen(text: string): When | null {
  return read(text).when;
}

// Words that may stand around a time in a message that says nothing else («ابعتولي ياه بكرا الصبح لو سمحت»).
const FILLER = new Set([
  "_", "لو", "سمحت", "من", "فضلك", "بدي", "بدنا", "ياه", "ياها", "يا", "هيدا", "ابعتو", "ابعتوه", "ابعتولي", "ابعتلي", "ابعت", "بعتو", "بعتولي",
  "جيبو", "جيبوه", "جيبولي", "وصلو", "وصلوه", "وصلولي", "وصلي", "خليه", "خليها", "خلي", "التوصيل", "توصيل", "الطلب", "طلبي", "الطلبيه", "يوم",
  "نهار", "ع", "عال", "على", "في", "بس", "اذا", "فيك", "فيكن", "ممكن", "تمام", "اوك", "و", "او", "شكرا", "يعطيك", "العافيه", "هو", "هي", "عليه",
  "please", "pls", "plz", "law", "sama7t", "iza", "fik", "fikon", "bade", "baddi", "badde", "bdi", "yeh", "yeha", "ab3ato", "ab3atoulle", "b3ato",
  "jibo", "jibouleh", "wasslo", "el", "talab", "talabi", "yom", "nhar", "3a", "3al", "ok", "okay", "merci", "thanks", "thank", "you", "w", "aw",
  "send", "it", "deliver", "bring", "the", "on", "in", "at", "for", "my", "order", "can", "delivery", "by", "make", "this", "yes",
  "livrer", "livraison", "le", "la", "pour", "svp", "stp", "ma", "commande", "envoyer", "envoyez", "oui",
]);

/** The time, when the message says nothing but the time (and polite words around it): answered by code, with no model call. */
export function whenOnly(text: string): When | null {
  const r = read(text);
  if (!r.when) return null;
  return r.rest.split(" ").filter(Boolean).every((tok) => FILLER.has(tok)) ? r.when : null;
}

// ---------- the windows, from the database ----------

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Words that name a time worth scheduling. "Today" alone means now. */
export function schedules(w: When | null): w is When {
  return !!w && !(Object.keys(w).length === 1 && w.day_offset === 0);
}

/** The open windows (never a full one, never past its cut-off) for a village, matching the words; all of them for null or "any". */
export async function windowsFor(ctx: ToolContext, villageId: string | null, fresh: boolean, when: When | null): Promise<DeliveryWindow[]> {
  if (!when || when.any) return rpc<DeliveryWindow[]>(ctx.db, "open_delivery_windows", { p_village: villageId, p_fresh: fresh });
  return rpc<DeliveryWindow[]>(ctx.db, "open_delivery_windows_when", { p_village: villageId, p_fresh: fresh, p_when: when });
}

/** What the words lead to: one window, a list to choose from (matching, or every open one when none matched), or no window at all. */
export type Picked = { kind: "one"; window: DeliveryWindow } | { kind: "list"; windows: DeliveryWindow[]; body: string } | { kind: "nothing" };
export async function pickWindow(ctx: ToolContext, villageId: string | null, fresh: boolean, when: When): Promise<Picked> {
  const matched = await windowsFor(ctx, villageId, fresh, when);
  if (!when.any && matched.length === 1) return { kind: "one", window: matched[0]! };
  if (matched.length > 0) return { kind: "list", windows: matched, body: T(ctx).windows.choose };
  if (when.any) return { kind: "nothing" };
  const all = await windowsFor(ctx, villageId, fresh, null);
  return all.length ? { kind: "list", windows: all, body: T(ctx).windows.noneAt } : { kind: "nothing" };
}

const say = async (ctx: ToolContext, text: string, orderId?: string) => (await deliver(ctx, { type: "text", text: { body: text } }, text, orderId)).ok;

interface StoredCard { order_id: string; short_code: string; status: string; payment_method: "cod" | "whish" | "omt"; change_for_usd: number | null;
  window: DeliveryWindow | null; replaces: string | null; prepay: { reason: "first_order"; maxCodUsd: number } | null; quote: Quote;
  /** WEB2 (0229): the choices on the card, so a card sent again says what the first said. Absent on an older database. */
  change_for_lbp?: number | null; missing_pref?: "best_match" | "ask" | "remove" | null; keep_change?: boolean; reopened_from?: string | null;
  missing_items?: { product_id: string; name: string; name_ar: string | null; pref: "best_match" | "ask" | "remove" }[] }

/** The card of an order sent again, as stored (no new order, no new price), with the window it now carries. */
export async function resendCard(ctx: ToolContext, orderId: string): Promise<boolean> {
  const c = await rpc<StoredCard | null>(ctx.db, "order_card", { p_order: orderId, p_party: ctx.partyId });
  if (!c) return false;
  return (await sendCard(ctx, { orderId, shortCode: c.short_code, quote: c.quote, paymentMethod: c.payment_method, changeForUsd: c.change_for_usd,
                                prepay: c.prepay, window: c.window, replaces: c.replaces, reopenedFrom: c.reopened_from ?? null,
                                changeForLbp: c.change_for_lbp ?? null, missingPref: c.missing_pref ?? null, missingItems: c.missing_items ?? null,
                                keepChange: c.keep_change ?? false })).ok;
}

type Requested = { ok: boolean; reason?: string; status?: string; short_code: string; window?: DeliveryWindow | null; windows?: DeliveryWindow[] };

/**
 * A row of the window list under a card was tapped, or a time was said for it (C3's request 2). The database decides
 * (request_delivery_window); on ok the same card goes again with its window. A full, closed or past window: the open ones instead.
 * A card sent back to draft (the window filled at the tap, C3's request 3): the same lines go as a new card for the window chosen.
 */
export async function orderWindowTap(ctx: ToolContext, slotId: string | null, orderId: string): Promise<boolean> {
  // A draft (sent back by a full window at the tap, or by "edit") cannot be confirmed as it is: it goes again as a new card.
  const stored = await rpc<StoredCard | null>(ctx.db, "order_card", { p_order: orderId, p_party: ctx.partyId });
  if (stored?.status === "draft") {
    const b = await rpc<{ found: boolean; lines?: { product_id: string; source_id: string; qty: number }[]; village_id?: string | null; place_id?: string | null;
                          pickup?: boolean; payment_method?: "cod" | "whish" | "omt"; change_for_usd?: number | null; notes?: string | null }>(
      ctx.db, "basket_from_order", { p_party: ctx.partyId, p_order: orderId });
    if (!b.found || !b.lines?.length) return say(ctx, T(ctx).windows.noneAtAll);
    const card = await issueCard(ctx, { lines: b.lines, villageId: b.pickup ? null : b.village_id ?? null, placeId: b.place_id ?? null, pickup: !!b.pickup },
      { payment: b.payment_method ?? "cod", changeForUsd: b.change_for_usd ?? null, notes: b.notes ?? null }, { slotId });
    return card.ok;
  }
  const r = await rpc<Requested>(ctx.db, "request_delivery_window", { p_order: orderId, p_slot: slotId, p_party: ctx.partyId });
  if (r.ok) return resendCard(ctx, orderId);
  if (r.reason === "status") return say(ctx, T(ctx).windows.notChangeable(r.short_code), orderId);
  if (r.reason === "pickup") return say(ctx, T(ctx).windows.pickupNoWindow, orderId);
  if (r.reason === "restaurant") return say(ctx, T(ctx).windows.restaurantNoWindow, orderId);
  const windows = r.windows ?? [];
  if (!windows.length) return say(ctx, T(ctx).windows.none, orderId);
  const body = r.reason === "now_unavailable" ? T(ctx).windows.nowUnavailable : T(ctx).windows.gone;
  return (await deliver(ctx, formatWindowChoice(orderId, windows, { lang: ctx.state.lang, body }), `[windows ${r.short_code}] ${body}`, orderId)).ok;
}

/** The card waiting on this customer's tap (card_in_hand, 0119). */
export interface CardInHand { order_id: string; short_code: string; village_id: string | null; pickup: boolean; fresh: boolean; hub_only: boolean;
  open_now: boolean; window: DeliveryWindow | null }
export async function cardInHand(ctx: ToolContext): Promise<CardInHand | null> {
  return rpc<CardInHand | null>(ctx.db, "card_in_hand", { p_party: ctx.partyId, p_conversation: ctx.conversationId });
}

/** A time said while a card waits on the tap (C3's request 1): one window goes on the card; several, or none that match, a list. */
export async function cardWhen(ctx: ToolContext, card: CardInHand, when: When): Promise<boolean> {
  if (card.pickup) return say(ctx, T(ctx).windows.pickupNoWindow, card.order_id);
  if (!card.hub_only) return say(ctx, T(ctx).windows.restaurantNoWindow, card.order_id);
  const p = await pickWindow(ctx, card.village_id, card.fresh, when);
  if (p.kind === "one") return orderWindowTap(ctx, p.window.slot_id, card.order_id);
  if (p.kind === "nothing") return say(ctx, T(ctx).windows.none, card.order_id);
  const msg = formatWindowChoice(card.order_id, p.windows, { lang: ctx.state.lang, body: p.body, withNow: card.open_now && !!when.any });
  return (await deliver(ctx, msg, `[windows ${card.short_code}] ${p.body}`, card.order_id)).ok;
}
