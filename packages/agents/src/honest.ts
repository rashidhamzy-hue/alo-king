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
import { guardAttribute } from "./concierge-tools";
import { messages, productName } from "./messages";
import type { OrderIntent } from "./schemas";

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
const USABLE = new Set(["certified", "declared", "calculated"]);

interface Ask { idx: number; kind: string; facts: FactKey[]; qty: number; words: string }
interface Match { product_id: string; name_en?: string | null; name_ar?: string | null }

/**
 * The honest answer, when every line the customer said asks for a fact that no approved record can answer. Returns true when it was
 * sent (the turn is answered), false when the turn goes on as before: no fact asked, an item whose own name holds the words (an order
 * for that item), or a product of that kind with an approved record (the Concierge answers with it).
 */
export async function honestAnswer(ctx: ToolContext, intent: OrderIntent, said: string): Promise<boolean> {
  if (!ASK_INTENTS.has(intent.intent) || intent.lines.length === 0 || intent.repeat_last) return false;
  const one = intent.lines.length === 1;
  const asks: Ask[] = [];
  for (const [idx, l] of intent.lines.entries()) {
    const words = [l.raw, l.query, ...(l.modifiers ?? []), ...(one ? [said, ...(intent.restrictions ?? [])] : [])].join(" \n ");
    const facts = factsAsked(words);
    if (!facts.length) return false;                                 // a plain item beside it: the usual path answers the whole message
    const kind = kindOf(l.query || l.raw) || kindOf(l.raw);
    if (!kind) return false;
    asks.push({ idx, kind, facts, qty: Number(l.qty) || 1, words });
  }
  const notCarried: Ask[] = [], unconfirmed: Ask[] = [];
  for (const a of asks) {
    const phrases = a.facts.flatMap((f) => NAME_PHRASES[f]);
    const found = await rpc<{ matches: Match[]; reason: string | null }>(ctx.db, "search_catalog", { p_query: a.kind, p_source_hint: null, p_limit: 12 })
      .catch(() => ({ matches: [] as Match[], reason: "error" }));
    const matches = found.reason ? [] : found.matches;
    // An item whose own name holds the words the customer said ("Lipton Ice Tea Zero Sugar"): an order for that item, not a fact.
    if (matches.some((m) => phrases.some((p) => fold(m.name_en).includes(fold(p)) || (m.name_ar ?? "").includes(p)))) return false;
    const category = await rpc<{ code: string; product_ids: string[] } | null>(ctx.db, "kind_in_catalog", { p_query: a.kind }).catch(() => null);
    const ids = [...new Set([...matches.map((m) => String(m.product_id)), ...(category?.product_ids ?? [])])];
    if (!ids.length) { notCarried.push(a); continue; }
    // A product of that kind with an approved, current record that can answer the fact: the Concierge answers with it.
    for (const id of ids.slice(0, 40)) {
      const facts = await rpc<{ attribute: string; kind: string; status: string; expired: boolean }[]>(ctx.db, "product_food_facts", { p_product: id }).catch(() => []);
      const usable = facts.filter((f) => !f.expired && USABLE.has(f.status));
      if (a.facts.some((k) => { const r = FACT_RECORD[k]; return !!r && usable.some((f) => guardAttribute(f.attribute, f.kind) === guardAttribute(r.attribute, r.kind)); })) return false;
    }
    unconfirmed.push(a);
  }

  const lang = ctx.state.lang ?? "ar";
  const T = messages(lang).honest;
  const facts = [...new Set(asks.flatMap((a) => a.facts))];
  const out: string[] = [];
  if (notCarried.length) out.push(T.notCarried(notCarried.map((a) => a.kind)));
  for (const f of facts) {
    const kinds = unconfirmed.filter((a) => a.facts.includes(f)).map((a) => a.kind);
    if (kinds.length) out.push(T.cannotConfirm(T.fact[f], kinds));
  }
  // At most three real items whose own name holds the words, priced by quote_order (one each, at the hub).
  const named = await rpc<{ product_id: string; name_en: string; name_ar: string | null; phrase: string | null }[]>(ctx.db, "items_named_with",
    { p_phrases: facts.flatMap((f) => NAME_PHRASES[f]), p_limit: 3 }).catch(() => []);
  if (named.length) {
    const q = await rpc<{ lines: { product_id?: string; name: string; name_ar: string | null; unit_price_usd: number; ok: boolean }[] }>(ctx.db, "quote_order",
      { p_lines: named.map((n) => ({ product_id: n.product_id, qty: 1 })), p_village: null, p_pickup: true }).catch(() => ({ lines: [] }));
    if (q.lines.length) {
      const said = [...new Set(named.map((n) => n.phrase).filter((x): x is string => !!x))];
      out.push(T.named(said.length ? said : facts.flatMap((f) => NAME_PHRASES[f]).slice(0, 1)));
      for (const l of q.lines.slice(0, 3)) {
        out.push(messages(lang).fixed.priced(productName(l, lang), Number(l.unit_price_usd), l.ok));
        noteReturned(ctx, l.product_id, l.name, l.name_ar);
      }
      out.push(T.closeItems);
    } else out.push(T.closeNone);
  } else out.push(T.closeNone);

  const body = out.join("\n");
  const sent = await deliver(ctx, { type: "text", text: { body } }, body);
  if (!sent.ok) return false;
  // The request, for purchasing (unmet_demand): one row per kind asked. Logging never breaks the turn.
  const audience = audienceOf(said);
  for (const a of asks) {
    const carried = !notCarried.includes(a);
    await ctx.db.rpc("log_demand", {
      p_kind: carried ? "facts_unconfirmed" : "unknown_product", p_origin: "honest_answer", p_party: ctx.partyId, p_query: a.kind,
      p_detail: { kind_asked: a.kind, facts_asked: a.facts, audience, quantity: a.qty, language: intent.language, carried, said: a.words.split(" \n ")[0] },
    }).then(() => undefined, () => undefined);
  }
  return true;
}
