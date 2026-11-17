// PD1 (g): the honest answer when nothing fits (docs/PRODUCT_DATA_STANDARD.md, "Why the two voice notes failed").
//
// On staging (15 Nov 22:20) "snacks with no sugar for 5 kids" got "I found no snacks with these specifications, shall I show you the
// catalogue?", and the catalogue button answered "write what you want". Code now answers a request for a kind of product with a fact
// (no sugar, high protein, gluten-free, fragrance-free ...) when no approved record can answer it:
//   - the kinds we do not carry yet, said as not carried and noted;
//   - the kinds we carry, with the fact we cannot confirm yet;
//   - at most three real items whose own printed name holds the words ("Zero Sugar", "No Sugar"), each by its exact name and the
//     price quote_order gives. Quoting a name is not a claim: the line says "with 'No Sugar' in their name", never "sugar-free".
// Each request is logged with log_demand (0022, 0202): the kind asked, the facts asked, audience, quantity and language. One text
// message, no buttons: never a catalogue button. When an approved record could answer for a product of that kind, the Concierge
// answers instead, with the record (food_facts) and its source.
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliver, noteReturned, type ToolContext } from "./concierge-tools";
import { messages, productName } from "./messages";
import type { OrderIntent } from "./schemas";
import type { QuoteLineInput } from "./concierge-tools";
import type { Quote } from "./order-card";
import { asksFacts, mergeFilters, readSearch, type SearchFilters } from "./search-reading";
import { factLine, searchProducts, type Found } from "./search";

export type FactKey = "sugar" | "protein" | "gluten" | "lactose" | "fat" | "salt" | "fragrance";

/** The words that ask for a fact, in Arabic, Arabizi, English and French. A bare "protein" is part of a kind ("protein bars"), not a fact. */
const FACT_WORDS: [FactKey, RegExp][] = [
  ["sugar", /(?:no|zero|without|low|less|free of)(?: added)? sugars?\b|sugar[- ]?free|\bsans sucres?\b|\bsucre ajouté|\bpeu de sucre|بدون سكر|بلا سكر|من دون سكر|خالي من السكر|قليل السكر|سكر قليل|زيرو شوغر|زيرو سكر|\b(?:bala|bidoun|bdoun|bidun|men ghayr) s[eiou]kk?[ae]r\b|\bzero sugar\b/iu],
  ["protein", /high[- ]protein|protein[- ]rich|rich in protein|lots of protein|riche en protéines|غني بالبروتين|بروتين عالي|بروتين كتير|\bktir protein\b|\bprotein ktir\b/iu],
  ["gluten", /gluten[- ]?free|without gluten|no gluten|\bsans gluten\b|بدون غلوتين|بلا غلوتين|خالي من الغلوتين|\bbala gluten\b/iu],
  ["lactose", /lactose[- ]?free|no lactose|without lactose|\bsans lactose\b|بدون لاكتوز|بلا لاكتوز|خالي من اللاكتوز|\bbala lactose\b/iu],
  ["fat", /low[- ]fat|fat[- ]free|no fat|\bsans matières? grasses?\b|قليل الدسم|خالي من الدسم|بلا دسم|\bbala dasam\b/iu],
  ["salt", /low[- ]salt|no salt|unsalted|without salt|\bsans sel\b|بلا ملح|بدون ملح|قليل الملح|\bbala mele7\b/iu],
  ["fragrance", /fragrance[- ]?free|unscented|no fragrance|without (?:fragrance|perfume)|\bsans parfum\b|بدون ريحة|بلا ريحة|بدون عطر|بلا عطر|خالي من العطر|\bbala ri7a\b/iu],
];
/** The phrases an item's printed name may hold for each fact, for the "with ... in their name" list. */
const NAME_PHRASES: Record<FactKey, string[]> = {
  sugar: ["Zero Sugar", "No Sugar", "No Added Sugar", "Sugar Free", "Sugar-Free", "Sans Sucre"],
  protein: ["High Protein", "Protein"],
  gluten: ["Gluten Free", "Gluten-Free", "Sans Gluten"],
  lactose: ["Lactose Free", "Lactose-Free", "Sans Lactose"],
  fat: ["Low Fat", "Fat Free", "Light"],
  salt: ["Unsalted", "Low Salt", "No Salt"],
  fragrance: ["Fragrance Free", "Fragrance-Free", "Unscented"],
};
/** The record that could answer each fact (0021): nutrition panels; gluten and milk as allergens. Fragrance has none before PD1's templates. */
const FACT_RECORD: Record<FactKey, { attribute: string; kind: string } | null> = {
  sugar: { attribute: "nutrition", kind: "nutrition" }, protein: { attribute: "nutrition", kind: "nutrition" },
  fat: { attribute: "nutrition", kind: "nutrition" }, salt: { attribute: "nutrition", kind: "nutrition" },
  gluten: { attribute: "gluten", kind: "allergen" }, lactose: { attribute: "milk", kind: "allergen" }, fragrance: null,
};

const AUDIENCE = /\b(?:kids?|children|child|toddlers?|enfants?|wl[ae]d|ewled|awlad|lunch ?box)\b|(?<![\p{L}])(?:لل?|ل)?(?:ولاد|أولاد|اولاد|الولاد|ولادي|أطفال|اطفال|الأطفال|الاطفال)(?![\p{L}])/iu;
/** The audience said ("kids"): a shopping tag for the demand log, never a claim. */
export function audienceOf(said: string): "kids" | null {
  return AUDIENCE.test(said) ? "kids" : null;
}

/** The facts the customer asks for, in a fixed order. */
export function factsAsked(said: string): FactKey[] {
  return FACT_WORDS.filter(([, re]) => re.test(said)).map(([k]) => k);
}

const NUMBER_WORDS = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|wa7ad|wa7de|tnen|tlete|arba3a|khamse|sette|un|deux|trois|quatre|cinq|six)\b|(?<![\p{L}])ل?(?:واحد|تنين|تلاتة|تلات|أربعة|اربعة|أربع|خمسة|خمس|ستة|ست|سبعة|تمانية|تسعة|عشرة)(?![\p{L}])/giu;
const FILLER = /\b(?:i want|i need|i'd like|baddi|bade|badde|bidde|some|any|please|with|for|pour|avec|de|des|du|la|lal|lil|w|and|et)\b|(?<![\p{L}])(?:بدي|بدّي|شي|مع|و|لـ|عشان|كرمال)(?![\p{L}])/giu;
/** The kind of product in the customer's words: what is left once the facts, the audience, numbers and filler words are taken out. */
export function kindOf(words: string): string {
  let s = ` ${words} `;
  for (const [, re] of FACT_WORDS) s = s.replace(new RegExp(re.source, "giu"), " ");
  s = s.replace(new RegExp(AUDIENCE.source, "giu"), " ").replace(/\d+/g, " ").replace(NUMBER_WORDS, " ")
       .replace(/(?<![\p{L}])ل(?=\s)/gu, " ");
  for (let i = 0; i < 3; i++) s = s.replace(FILLER, " ");
  return s.replace(/[^\p{L}\p{N}' -]+/gu, " ").replace(/\s+/g, " ").trim();
}

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

const fold = (x: string | null | undefined) => String(x ?? "").toLowerCase();
const ASK_INTENTS = new Set(["order", "add_to_order", "question"]);

interface Ask { idx: number; kind: string; facts: FactKey[]; qty: number; words: string; filters: SearchFilters }
interface Match { product_id: string; name_en?: string | null; name_ar?: string | null }

/**
 * SR1: the answer to a kind of product asked with a fact or a restriction, from find_products (0214) and the approved facts only.
 *   - items that pass: code lists them (at most three a kind), each with its facts and their source ("the pack says “No added sugar”") and
 *     its price from quote_order: the chat states a fact only from an approved record of that item (invariants 14, 15);
 *   - nothing passes: PD1's honest answer: the kinds we do not carry yet (noted), the kinds whose fact we cannot confirm yet, and at most
 *     three real items whose own name holds the words; the request is logged with log_demand.
 * Returns true when it answered (the turn is done), false when the turn goes on as before: no fact asked, a plain item beside it, or an
 * item whose own name holds the words (an order for that item).
 */
export async function honestAnswer(ctx: ToolContext, intent: OrderIntent, said: string): Promise<boolean> {
  if (!ASK_INTENTS.has(intent.intent) || intent.lines.length === 0 || intent.repeat_last) return false;
  const one = intent.lines.length === 1;
  const said_ = readSearch(said);
  const stated = readSearch((intent.restrictions ?? []).join(". "));
  const asks: Ask[] = [];
  for (const [idx, l] of intent.lines.entries()) {
    const words = [l.raw, l.query, ...(l.modifiers ?? []), ...(one ? [said, ...(intent.restrictions ?? [])] : [])].join(" \n ");
    const own = readSearch([l.raw, ...(l.modifiers ?? [])].join(" "));
    // the line's own facts; with one line, the whole message's; allergies and diets said anywhere hold for every line (invariant 16)
    let filters = mergeFilters(own.filters, one ? said_.filters : {});
    filters = mergeFilters(filters, { ...(said_.filters.free_of ? { free_of: said_.filters.free_of } : {}), ...(said_.filters.diet ? { diet: said_.filters.diet } : {}),
                                      ...(stated.filters.free_of ? { free_of: stated.filters.free_of } : {}), ...(stated.filters.diet ? { diet: stated.filters.diet } : {}) });
    if (!asksFacts(filters)) return false;                           // a plain item beside it: the usual path answers the whole message
    const facts = [...new Set([...factsAsked(words), ...(own.asked as FactKey[]), ...(one ? (said_.asked as FactKey[]) : [])])].filter((f) => f in NAME_PHRASES) as FactKey[];
    const kind = own.query || kindOf(l.query || l.raw) || kindOf(l.raw);
    if (!kind) return false;
    asks.push({ idx, kind, facts, qty: Number(l.qty) || said_.count || 1, words, filters });
  }
  const notCarried: Ask[] = [], unconfirmed: Ask[] = [], failing: Ask[] = [];
  const fits: { ask: Ask; found: Found[] }[] = [];
  const soon: { name_en: string; name_ar: string | null; product_id: string }[] = [];
  for (const a of asks) {
    const phrases = a.facts.flatMap((f) => NAME_PHRASES[f]);
    // An item whose own name holds the words the customer said ("Lipton Ice Tea Zero Sugar"): an order for that item, not a fact.
    if (phrases.length) {
      const named = await rpc<{ matches: Match[]; reason: string | null }>(ctx.db, "search_catalog", { p_query: a.kind, p_source_hint: null, p_limit: 12 })
        .catch(() => ({ matches: [] as Match[], reason: "error" }));
      if (!named.reason && named.matches.some((m) => phrases.some((p) => fold(m.name_en).includes(fold(p)) || (m.name_ar ?? "").includes(p)))) return false;
    }
    const r = await searchProducts(ctx.db, ctx.embedder, a.kind, a.filters, 3).catch(() => null);
    if (!r) return false;                                            // the search failed: the usual path answers, never a guess
    // SELL1 (0226): an item that is coming soon (no label reading yet) never "fits": it cannot be ordered. It is said as coming soon, by code.
    const soonHere = r.matches.filter((m) => m.coming_soon === true);
    for (const m of soonHere) soon.push({ name_en: m.name_en, name_ar: m.name_ar, product_id: m.product_id });
    const buyable = r.matches.filter((m) => m.coming_soon !== true);
    if (buyable.length) { fits.push({ ask: a, found: buyable }); continue; }
    if (soonHere.length) continue;
    // only an allergy or a diet, nothing confirmed to pass, and a product named by its brand («لبنة ليبان ليه»): the usual ordering path,
    // which puts the restriction on the card (1.14). A kind ("hummus", "halal chicken") gets the honest answer below: never "which one
    // would you like?" over items nobody can confirm are safe.
    if (onlyRestrictions(a.filters) && (intent.lines[a.idx]?.brand_hint || await namesBrand(ctx, a.kind))) return false;
    if (r.reason === "no_match") {
      // the kind may still be carried under a category's name ("snacks"): PD1's check
      const category = await rpc<{ code: string; product_ids: string[] } | null>(ctx.db, "kind_in_catalog", { p_query: a.kind }).catch(() => null);
      if (!category?.product_ids?.length) { notCarried.push(a); continue; }
    }
    // items of that kind were checked against approved facts and failed (none is merely unknown): say they do not fit
    const failed = Object.entries(r.failed ?? {});
    if (failed.length && failed.every(([why]) => why !== "not_fact_complete")) failing.push(a);
    else unconfirmed.push(a);
  }

  const lang = ctx.state.lang ?? "ar";
  const M = messages(lang);
  const T = M.honest;
  const out: string[] = [];
  // what fits, each item with its facts and their source, priced by quote_order
  if (fits.length) {
    out.push(T.fits(fits.map((f) => f.ask.kind)));
    const ids = fits.flatMap((f) => f.found.slice(0, 3).map((m) => m.product_id));
    const q = await rpc<{ lines: { product_id?: string; name: string; name_ar: string | null; unit_price_usd: number; ok: boolean }[] }>(ctx.db, "quote_order",
      { p_lines: ids.map((product_id) => ({ product_id, qty: 1 })), p_village: null, p_pickup: true }).catch(() => ({ lines: [] }));
    for (const f of fits) for (const m of f.found.slice(0, 3)) {
      const l = q.lines.find((x) => x.product_id === m.product_id);
      if (!l) continue;
      out.push(M.fixed.priced(productName(l, lang), Number(l.unit_price_usd), l.ok));
      const said = [...new Set(m.evidence.map((e) => factLine(e, lang)).filter((x): x is string => !!x))];
      if (said.length) out.push(`   ${said.join("; ")}`);
      noteReturned(ctx, m.product_id, l.name, l.name_ar);
    }
  }
  if (soon.length) out.push(M.basket.comingSoon([...new Map(soon.map((s) => [s.product_id, productName({ name: s.name_en, name_ar: s.name_ar }, lang)])).values()].slice(0, 3)));
  const facts = [...new Set([...notCarried, ...unconfirmed, ...failing].flatMap((a) => a.facts))];
  if (notCarried.length) out.push(T.notCarried(notCarried.map((a) => a.kind)));
  if (failing.length) out.push(T.noneFits(failing.map((a) => a.kind)));
  for (const f of facts) {
    const kinds = unconfirmed.filter((a) => a.facts.includes(f)).map((a) => a.kind);
    if (kinds.length) out.push(T.cannotConfirm(T.fact[f], kinds));
  }
  // a restriction with no fact word (an allergy): the kinds we carry and cannot confirm free of it
  const plain = unconfirmed.filter((a) => !a.facts.length);
  if (plain.length) out.push(T.cannotConfirm(restrictionWords(plain[0]!.filters, lang), plain.map((a) => a.kind)));
  if (!fits.length) {
    // At most three real items whose own name holds the words, priced by quote_order (one each, at the hub).
    const named = facts.length ? await rpc<{ product_id: string; name_en: string; name_ar: string | null; phrase: string | null }[]>(ctx.db, "items_named_with",
      { p_phrases: facts.flatMap((f) => NAME_PHRASES[f]), p_limit: 3 }).catch(() => []) : [];
    if (named.length) {
      const q = await rpc<{ lines: { product_id?: string; name: string; name_ar: string | null; unit_price_usd: number; ok: boolean }[] }>(ctx.db, "quote_order",
        { p_lines: named.map((n) => ({ product_id: n.product_id, qty: 1 })), p_village: null, p_pickup: true }).catch(() => ({ lines: [] }));
      if (q.lines.some((l) => !(l as { coming_soon?: boolean }).coming_soon)) {
        const phr = [...new Set(named.map((n) => n.phrase).filter((x): x is string => !!x))];
        out.push(T.named(phr.length ? phr : facts.flatMap((f) => NAME_PHRASES[f]).slice(0, 1)));
        for (const l of q.lines.filter((x) => !(x as { coming_soon?: boolean }).coming_soon).slice(0, 3)) {
          out.push(M.fixed.priced(productName(l, lang), Number(l.unit_price_usd), l.ok));
          noteReturned(ctx, l.product_id, l.name, l.name_ar);
        }
        out.push(T.closeItems);
      } else out.push(T.closeNone);
    } else out.push(T.closeNone);
  } else out.push(notCarried.length || unconfirmed.length || failing.length ? T.closeItems : T.closeFits);

  const body = out.join("\n");
  const sent = await deliver(ctx, { type: "text", text: { body } }, body);
  if (!sent.ok) return false;
  // The request, for purchasing (unmet_demand): one row per kind asked that nothing fits. Logging never breaks the turn.
  const audience = audienceOf(said);
  for (const a of [...notCarried, ...unconfirmed, ...failing]) {
    const carried = !notCarried.includes(a);
    await ctx.db.rpc("log_demand", {
      p_kind: carried ? "facts_unconfirmed" : "unknown_product", p_origin: "honest_answer", p_party: ctx.partyId, p_query: a.kind,
      p_detail: { kind_asked: a.kind, facts_asked: a.facts, restrictions: [...(a.filters.free_of ?? []), ...(a.filters.diet ?? [])], audience, quantity: a.qty,
                  language: intent.language, carried, said: a.words.split(" \n ")[0] },
    }).then(() => undefined, () => undefined);
  }
  return true;
}

/** Do the words name a brand we stock («ليبان ليه» in «لبنة ليبان ليه»)? Any one or two words in a row, as catalog_is_brand (0053) reads them. */
async function namesBrand(ctx: ToolContext, words: string): Promise<boolean> {
  const t = words.split(/\s+/).filter(Boolean);
  const grams = [...t.map((_, i) => t.slice(i, i + 2).join(" ")).filter((g) => g.includes(" ")), ...t.filter((w) => w.length >= 3)];
  for (const g of grams.slice(0, 8)) if (await rpc<boolean>(ctx.db, "catalog_is_brand", { p_name: g }).catch(() => false)) return true;
  return false;
}

/** Only an allergy or a diet: no nutrient, claim, animal or age asked. */
function onlyRestrictions(f: SearchFilters): boolean {
  const { free_of, diet, audience, prefer_tags, tags, ...rest } = f;
  return !!(free_of?.length || diet?.length) && !asksFacts(rest);
}

/** What a restriction is called in "I can't confirm ... for our ...": "free of peanuts", «بلا فستق», "sans arachides". */
function restrictionWords(f: SearchFilters, lang: string): string {
  const names: Record<string, Record<string, string>> = {
    en: { peanuts: "peanuts", tree_nuts: "nuts", sesame: "sesame", gluten: "gluten", milk: "milk", eggs: "eggs", soy: "soy", fish: "fish" },
    fr: { peanuts: "arachides", tree_nuts: "fruits à coque", sesame: "sésame", gluten: "gluten", milk: "lait", eggs: "œufs", soy: "soja", fish: "poisson" },
    ar: { peanuts: "فستق عبيد", tree_nuts: "مكسرات", sesame: "سمسم", gluten: "غلوتين", milk: "حليب", eggs: "بيض", soy: "صويا", fish: "سمك" },
  };
  const l = lang === "en" || lang === "fr" ? lang : "ar";
  const free = (f.free_of ?? []).map((a) => names[l]![a] ?? a);
  const diets = (f.diet ?? []).map((d) => ({ en: { vegan: "vegan", vegetarian: "vegetarian", halal: "halal", fasting: "fasting (siyami)" },
                                              fr: { vegan: "végan", vegetarian: "végétarien", halal: "halal", fasting: "siyami" },
                                              ar: { vegan: "نباتي صرف", vegetarian: "نباتي", halal: "حلال", fasting: "صيامي" } } as Record<string, Record<string, string>>)[l]![d] ?? d);
  const without = free.length ? (l === "en" ? `free of ${free.join(", ")}` : l === "fr" ? `sans ${free.join(", ")}` : `بلا ${free.join("، ")}`) : "";
  return [without, ...diets].filter(Boolean).join(l === "ar" ? " و" : ", ");
}

/**
 * SR1 (6): a basket said in words ("mjadra for 6", "lunchbox snacks for the week", "a basket under $20"): built by code (build_basket, 0215),
 * priced by quote_order and sent as the order card, which the customer confirms (invariants 4, 7). Returns true when it answered.
 */
export async function basketAnswer(ctx: ToolContext, intent: OrderIntent, said: string): Promise<boolean> {
  if (intent.intent !== "order" || intent.repeat_last) return false;
  const r = readSearch(said);
  if (!r.basket) return false;
  const filters: SearchFilters = { ...r.filters };
  delete filters.prefer_tags; delete filters.audience;
  const stated = readSearch((intent.restrictions ?? []).join(". ")).filters;
  const f = mergeFilters(filters, { ...(stated.free_of ? { free_of: stated.free_of } : {}), ...(stated.diet ? { diet: stated.diet } : {}) });
  const built = await rpc<{ ok: boolean; refused?: string; type?: string; dish?: string; dish_name?: { en: string; ar: string }; people?: number; units?: number;
                            lines?: { product_id: string; qty: number; kind: string }[]; missing?: { kind: string; reason: string }[]; max_usd?: number | null;
                            over_budget?: boolean }>(ctx.db, "build_basket", { p_text: said, p_ask: r.basket, p_filters: f }).catch(() => null);
  if (!built || built.refused === "no_dish" || built.refused === "budget") return false;   // not a basket after all: the usual path
  const lang = ctx.state.lang ?? "ar";
  const B = messages(lang).built;
  const say = async (text: string) => (await deliver(ctx, { type: "text", text: { body: text } }, text)).ok;
  if (built.refused === "people") return say(B.tooMany(50));
  const missing = (built.missing ?? []).map((m) => m.kind);
  if (!built.lines?.length) {
    const ok = await say([missing.length ? B.missing(missing) : null, B.none].filter(Boolean).join("\n"));
    for (const m of built.missing ?? []) await ctx.db.rpc("log_demand", { p_kind: m.reason === "not_carried" ? "unknown_product" : "facts_unconfirmed", p_origin: "honest_answer",
      p_party: ctx.partyId, p_query: m.kind, p_detail: { kind_asked: m.kind, basket: r.basket, restrictions: f.free_of ?? [], language: intent.language, said } }).then(() => undefined, () => undefined);
    return ok;
  }
  const head = built.type === "dish" ? B.dish(lang === "en" || lang === "fr" ? built.dish_name?.en ?? String(built.dish) : built.dish_name?.ar ?? String(built.dish), built.people ?? 1)
             : built.type === "lunchbox" ? B.lunchbox(built.units ?? 0) : B.budget(Number(built.max_usd ?? 0));
  const before = [head, missing.length ? B.missing(missing) : null, built.over_budget && built.max_usd ? B.overBudget(Number(built.max_usd)) : null].filter(Boolean).join("\n");
  // a basket already in hand gets these lines added; otherwise it is the basket
  const held = ctx.state.lastQuote?.lines ?? [];
  const lines: QuoteLineInput[] = [...held.filter((h) => !built.lines!.some((l) => l.product_id === h.product_id)),
                                   ...built.lines.map((l) => ({ product_id: l.product_id, qty: Number(l.qty) }))];
  const villageId = ctx.state.villageId ?? null;
  const pickup = intent.fulfilment === "pickup";
  const quote = await rpc<Quote>(ctx.db, "quote_order", { p_lines: lines, p_village: pickup ? null : villageId, p_pickup: pickup });
  ctx.state.lastQuote = { lines, villageId, pickup, quote };
  ctx.state.basketAt = Date.now();
  for (const l of quote.lines ?? []) noteReturned(ctx, (l as { product_id?: string }).product_id, (l as { name?: string }).name, (l as { name_ar?: string | null }).name_ar);
  const { routeBasket } = await import("./pipeline");
  const terms = ctx.state.pending ?? { payment: "cod" as const, changeForUsd: null, notes: ctx.state.directions ?? null };
  const done = await routeBasket(ctx, { lines, villageId, placeId: ctx.state.placeId ?? null, pickup }, terms, quote, before);
  return done.done;
}
