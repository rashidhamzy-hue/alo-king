// B1a (SIM1 fixes 1, 3 and 4): the basket the customer is building, held by code between turns.
//
// The basket is ConversationState.lastQuote (lines, village, pickup, the last quote), or the lines of a card that waits on the
// customer's tap. It changes only by explicit edits: add (more of a product), set (the quantity becomes this), remove. Each
// edit names a product the customer picked: a line the planner matched, a product already in the basket, or a substitute the
// quote itself listed for a line that ran out. Nothing is added from a tentative word or a model's guess, and nothing said
// earlier drops out: the card is built from the whole basket, and a card that changed one shows what changed.
//
// The minimum order is said by code, with the minimum, the basket and the gap from quote_order's below_minimum issue, and with
// two buttons (browse, let it go). The model never words it (the output guard refuses it).
import { buttons } from "@ak/wa/kapso";
import { deliver, type CardTerms, type QuoteLineInput, type ToolContext } from "./concierge-tools";
import type { Quote, QuoteLine } from "./order-card";
import { messages, productName, type Lang } from "./messages";
import type { OrderIntent } from "./schemas";
import { MENU_BROWSE } from "./support";

export type BasketOp = "add" | "set" | "remove";
export interface BasketEdit { op: BasketOp; product_id: string; qty?: number; source_id?: string | null; modifiers?: string[]; note?: string | null;
  /** When the product replaces another line (a substitute the quote listed for it), that line's product. */
  replaces?: string | null }
export interface BasketChange { kind: "added" | "removed" | "qty"; product_id: string; from: number; to: number }

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Applies the edits in order. add: the quantity grows by qty (a new product is added with qty). set: the quantity becomes qty
 * (a new product is added with qty). remove: the line goes. A product that replaces another (a substitute) takes that line's
 * place. Returns the new lines and what changed, product by product, from the lines before to the lines after.
 */
export function applyEdits(lines: QuoteLineInput[], edits: BasketEdit[]): { lines: QuoteLineInput[]; changes: BasketChange[] } {
  const out = lines.map((l) => ({ ...l }));
  for (const e of edits) {
    if (e.replaces && e.replaces !== e.product_id) {
      const i = out.findIndex((l) => l.product_id === e.replaces);
      if (i >= 0) out.splice(i, 1);
    }
    const i = out.findIndex((l) => l.product_id === e.product_id);
    if (e.op === "remove") { if (i >= 0) out.splice(i, 1); continue; }
    const qty = Number(e.qty ?? 1);
    if (!(qty > 0)) { if (e.op === "set" && i >= 0) out.splice(i, 1); continue; }
    if (i < 0) {
      out.push({ product_id: e.product_id, qty: round(qty), ...(e.source_id ? { source_id: e.source_id } : {}),
                 ...(e.modifiers?.length ? { modifiers: e.modifiers } : {}), ...(e.note ? { note: e.note } : {}) });
    } else {
      const l = out[i]!;
      l.qty = round(e.op === "add" ? Number(l.qty) + qty : qty);
      if (e.modifiers?.length) l.modifiers = [...new Set([...(l.modifiers ?? []), ...e.modifiers])];
      if (e.note) l.note = l.note && !l.note.includes(e.note) ? `${l.note} | ${e.note}` : e.note;
    }
  }
  return { lines: out, changes: diffLines(lines, out) };
}

/** What changed between two baskets, product by product: added, removed, or a new quantity. */
export function diffLines(before: QuoteLineInput[], after: QuoteLineInput[]): BasketChange[] {
  const q = (ls: QuoteLineInput[]) => {
    const m = new Map<string, number>();
    for (const l of ls) m.set(l.product_id, round((m.get(l.product_id) ?? 0) + Number(l.qty)));
    return m;
  };
  const a = q(before), b = q(after);
  const out: BasketChange[] = [];
  for (const [p, to] of b) {
    const from = a.get(p);
    if (from === undefined) out.push({ kind: "added", product_id: p, from: 0, to });
    else if (from !== to) out.push({ kind: "qty", product_id: p, from, to });
  }
  for (const [p, from] of a) if (!b.has(p)) out.push({ kind: "removed", product_id: p, from, to: 0 });
  return out;
}

/** A plan line, as plan_order returns it (pipeline.ts PlanLine), with only what an edit needs. */
interface PlannedLine { idx: number; status: string; qty: number; chosen: { product_id: string } | null; candidates: { product_id: string }[] | null;
  /** The planner chose by a rule, not by the customer's words (the best seller, or the house default: pick = house). */
  assumed?: boolean; pick?: string | null;
  /** B1c (0138): every product the line's words fit, so a generic word finds the one already in the basket. */
  tied?: { product_id: string }[] | null }
interface PlannedBasket { lines: PlannedLine[]; quote_lines: QuoteLineInput[] }

/** The default edit of a line the reading did not mark: "add" for intent add_to_order, else "set" (a restated item keeps its count). */
export const defaultOp = (intent: OrderIntent["intent"]): BasketOp => (intent === "add_to_order" ? "add" : intent === "cancel" ? "remove" : "set");

const ORDINALS: [RegExp, number][] = [
  [/تالت|تالتة|ثالث|ثالثة|\btal(?:e)?t(?:e|a)?\b|\bthird\b|\btroisième\b/iu, 3],
  [/رابع|رابعة|\brab(?:e)?3(?:a|e)?\b|\bfourth\b|\bquatrième\b/iu, 4],
  [/خامس|خامسة|\bkhames(?:e|a)?\b|\bfifth\b|\bcinquième\b/iu, 5],
];
/** "A third one", «رابعة», "talte": the count it makes in all (3 to 5), or null. */
export function ordinalIn(said: string): number | null {
  for (const [re, n] of ORDINALS) if (re.test(said)) return n;
  return null;
}

/**
 * The edits a reading makes to the basket in hand, from the planner's lines. A line to remove or to re-count names a product in the
 * basket (the planner's choice, or the one basket product among its candidates); a line that adds names the product the planner
 * matched. A product listed as a substitute for a basket line that ran out (in the held quote's issues) replaces that line.
 * `unresolved`: lines that need a question (ambiguous, not found, or a remove that names nothing in the basket).
 */
export function editsFromPlan(intent: Pick<OrderIntent, "intent" | "lines">, plan: PlannedBasket, held: QuoteLineInput[], heldQuote?: Pick<Quote, "issues" | "lines"> | null,
                              hints: Map<number, string[]> = new Map(), message = ""): { edits: BasketEdit[]; unresolved: PlannedLine[] } {
  const inBasket = new Set(held.map((l) => l.product_id));
  const substituteOf = new Map<string, string>();
  for (const i of heldQuote?.issues ?? []) {
    if ((i.code === "out_of_stock" || i.code === "insufficient_stock") && Array.isArray(i.substitutes))
      for (const s of i.substitutes as { product_id?: string }[]) if (s.product_id && i.product_id) substituteOf.set(s.product_id, String(i.product_id));
  }
  const edits: BasketEdit[] = [], unresolved: PlannedLine[] = [];
  // Every line the customer said counts: one the planner dropped (it joins or drops words it cannot place) is planned as not found,
  // so an edit never disappears in silence.
  const planned = intent.lines.map((l, idx) => plan.lines.find((x) => x.idx === idx)
    ?? { idx, status: "not_found", qty: Number(l.qty ?? 1), chosen: null, candidates: null } as PlannedLine);
  for (const pl of planned) {
    if (pl.status === "same_as_before") continue;                      // the same product said twice in one message
    const said = intent.lines[pl.idx] as (OrderIntent["lines"][number] & { change?: BasketOp | null }) | undefined;
    const explicit = said?.change ?? null;
    const priced = pl.chosen ? plan.quote_lines.find((q) => q.product_id === pl.chosen!.product_id) : undefined;
    const qty = Number(priced?.qty ?? pl.qty);
    // «زيدلي ربطة خبز تالتة»: "a third one" makes three in all, it does not add three (the second B1a run, sim-051: 5 pita). Only from
    // three on: «تانية» is also "another", one more whatever the count.
    const ordinal = ordinalIn(`${said?.raw ?? ""}`);
    let op: BasketOp = ordinal != null && ordinal === qty && (explicit ?? defaultOp(intent.intent)) === "add" ? "set" : explicit ?? defaultOp(intent.intent);
    // B1d (sim-135): a size the customer says («3 من مقاس 5») that is not the basket product's size («Size 6») is never that product.
    const saidSize = sizeIn(`${said?.raw ?? ""} ${said?.query ?? ""}`);
    const clash = (p: string) => { if (saidSize == null) return false; const nm = heldQuote?.lines.find((l) => l.product_id === p);
                                   const s = nm ? sizeIn(`${nm.name} ${nm.name_ar ?? ""}`) : null; return s != null && s !== saidSize; };
    const inB = (p: string | null | undefined): p is string => !!p && inBasket.has(p) && !clash(p);
    // B1c: the basket product these words name: the planner's choice; else the one basket product among those the words fit
    // («wet wipes» is the Oui Oui in the basket, sim-021; «mortadelle» the Tanmia, sim-025; «لبن» the Khoury yogurt, sim-052); else by
    // name; else by the catalogue search.
    const fits = [...(pl.tied ?? []), ...(pl.candidates ?? []), ...(pl.chosen ? [pl.chosen] : [])].map((c) => c.product_id);
    const named = inB(pl.chosen?.product_id) ? pl.chosen!.product_id
      : onlyOne(fits.filter(inB))
        // the basket product named by its brand («add 2 more Dove cream bars»: the Dove soap, never a cream; sim-083)
        ?? byBrand([said?.query, said?.raw], (heldQuote?.lines ?? []).filter((l) => inB(l.product_id)))
        // by name or by the search only when the planner found nothing these words fit, or to take something off: «شيبس ماستر» fits the
        // Master chips, so it is never the Dolsi in the basket (sim-143)
        ?? (fits.length === 0 || op === "remove"
          ? byName([said?.query, said?.raw], (heldQuote?.lines ?? []).filter((l) => inB(l.product_id))) ?? onlyOne((hints.get(pl.idx) ?? []).filter(inB))
          : null);
    // B1c: a product the customer named by its own words (matched, not chosen by a rule) that is not in the basket is a new line,
    // never the basket's other product of that kind («٢ كيس شيبس ماستر» added two Dolsi, sim-143).
    const ownNew = pl.status === "matched" && !!pl.chosen && !inB(pl.chosen.product_id) && !pl.assumed;
    // B1c: the count already in the basket, said again («baddi ba3ten el 3 3elab Candia», sim-117; «شكلهن ما انضافوا», sim-028): the
    // customer is telling us what they want, not asking for as many again. Unless they say more («كمان», "more").
    const target = ownNew ? null : named;
    if (target && op === "add" && (!explicit || MISSING.test(fold(message))) && !MORE_WORDS.test(fold(`${said?.raw ?? ""}`))) {
      const now = held.find((l) => l.product_id === target)?.qty;
      if (now != null && Number(now) === qty) op = "set";
    }
    // "Add 2 more", "make it 3", "take the bread off": the line names something already in the basket. The planner's choice when it
    // is there; else the one basket product among its candidates; else the one basket product whose name shares the customer's words.
    if (explicit) {
      if (target) { edits.push({ op, product_id: target, qty: op === "remove" ? undefined : qty }); continue; }
      if (op === "remove") { unresolved.push(pl); continue; }
    }
    if (pl.status !== "matched" || !pl.chosen) {
      // A restated item the planner could not tell apart, whose words fit exactly one product already in the basket, is that product.
      if (pl.status === "ambiguous" && target) { edits.push({ op, product_id: target, qty }); continue; }
      unresolved.push(pl);
      continue;
    }
    // B1c: the planner chose by a rule (the house default) while the basket already holds one of what the words fit: that one.
    if (pl.assumed && target && !inB(pl.chosen.product_id)) { edits.push({ op, product_id: target, qty }); continue; }
    const p = pl.chosen.product_id;
    edits.push({ op: inBasket.has(p) ? op : "add", product_id: p, qty, source_id: priced?.source_id ?? null,
                 modifiers: priced?.modifiers, note: priced?.note ?? null, replaces: inBasket.has(p) ? null : substituteOf.get(p) ?? null });
  }
  return { edits, unresolved };
}
const onlyOne = (xs: string[]): string | null => (new Set(xs).size === 1 ? xs[0]! : null);
/** The size a text names: «مقاس 5», "size 6", "taille 4", "ma2as 3" (diapers, clothes), or null. */
export function sizeIn(text: string): number | null {
  const m = /(?:مقاس|المقاس|قياس|نمره|نمرة|size|taille|ma2as|mi2as|ma2es)\s*(\d+)/iu.exec(fold(text));
  return m ? Number(m[1]) : null;
}
/** Lower case, Western digits, one alef: for the phrase checks below. */
const fold = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
/** "It wasn't added", "they're missing": the customer thinks a basket line is not there (sim-028's «شكلهن ما انضافوا»). */
const MISSING = /ما\s*(?:انضاف|انضافو|انضافوا|ضفت|ضفتو|ضفتوا|زدت|زدتو|حطيت|حطيتو)|شكل(?:ه|ها|هن|هم)?\s*ما|مش\s*(?:مضاف|موجود|محطوط)|نسيت|نسيتو|ما\s*في\s*بالطلب|\b(?:ma|mesh|mish)\s*(?:nzed|ndaf|daf|zed|7atet|7atayt)|\bnot\s+(?:added|there|in)\b|\bmissing\b|\bforgot\b|didn'?t\s+add|\bmanque\b|\boubli|pas\s+(?:ajout|mis)|make\s+sure|تأكد|تاكد|ta2akkad|t2akkad|assurez/u;
/** Words that ask for more of something: «كمان», «زيد», "more", "another", "encore". */
const MORE_WORDS = /(?:^|[^\p{L}])(?:كمان|زياده|زيدلي|زيد|زيدو|زيدها|ضيف|ضيفلي|kman|kaman|kamen|kamein|zyede|ziyade|zid|zidli|zidlo|dif|difli|more|another|extra|encore|de plus|en plus)(?:$|[^\p{L}])/u;

/** Lower case, one alef, ta marbuta as ha, no diacritics or punctuation: for matching a customer's words to a basket item's name. */
const foldWords = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
  .replace(/^ال/u, "").split(/[^\p{L}\p{N}]+/u).map((w) => w.replace(/^ال/u, "")).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
/** The one basket line whose brand (the first word of its English name, four letters or more) the customer said. */
function byBrand(said: (string | null | undefined)[], lines: QuoteLine[]): string | null {
  const words = new Set(said.flatMap((s) => (s ? foldWords(s) : [])));
  const hits = lines.filter((l) => { const b = foldWords(l.name)[0]; return !!b && b.length >= 4 && words.has(b); }).map((l) => l.product_id!);
  return onlyOne(hits);
}
/** The one basket line whose English or Arabic name shares a word (three letters or more) with what the customer said. */
function byName(said: (string | null | undefined)[], lines: QuoteLine[]): string | null {
  const words = new Set(said.flatMap((s) => (s ? foldWords(s) : [])));
  if (!words.size) return null;
  const hits = lines.filter((l) => [...foldWords(l.name), ...foldWords(l.name_ar ?? "")].some((w) => words.has(w))).map((l) => l.product_id!);
  return onlyOne(hits);
}

/** The rows of "what changed", in the conversation's language: "+ 2 × name", "− name", "name: 1 → 3". */
export function changeRows(changes: BasketChange[], names: Map<string, { name: string; name_ar: string | null }>, lang: Lang): string[] {
  const n = (p: string) => { const x = names.get(p); return x ? productName({ ...x, product_id: p }, lang) : "?"; };
  const qty = (x: number) => String(Number(x));
  return changes.map((c) => c.kind === "added" ? `+ ${qty(c.to)} × ${n(c.product_id)}`
    : c.kind === "removed" ? `− ${n(c.product_id)}` : `${n(c.product_id)}: ${qty(c.from)} → ${qty(c.to)}`);
}

/** Names of products by id, from quotes (a removed line is named from the quote before). */
export function namesOf(...quotes: (Pick<Quote, "lines"> | null | undefined)[]): Map<string, { name: string; name_ar: string | null }> {
  const m = new Map<string, { name: string; name_ar: string | null }>();
  for (const q of quotes) for (const l of q?.lines ?? []) if (l.product_id && !m.has(l.product_id)) m.set(l.product_id, { name: l.name, name_ar: l.name_ar });
  return m;
}

// ---------- the minimum ----------
export const BASKET_CLEAR = "basket:clear";
/** The below_minimum issue of a quote: the minimum, the subtotal and the gap (rounded to the cent). */
export function minimumGap(quote: Pick<Quote, "issues"> | null | undefined): { min: number; now: number; gap: number } | null {
  const i = quote?.issues.find((x) => x.code === "below_minimum");
  if (!i) return null;
  const min = Number(i.minimum_usd), now = Number(i.subtotal_usd);
  if (!Number.isFinite(min) || !Number.isFinite(now)) return null;
  return { min, now, gap: Math.max(0.01, Math.round((min - now) * 100) / 100) };
}

/** What may stand beside the minimum when it is said: where and when are asked after the basket reaches it. */
export const MINIMUM_FIRST = (code: string) => code === "below_minimum" || code === "no_delivery_village" || code === "village_not_recognised"
  || code === "closed" || code.startsWith("slot_");
/** The basket is complete but under the minimum, and nothing else stops it (an item out of stock is a question first). */
export const underMinimumOnly = (quote: Pick<Quote, "issues"> | null | undefined): boolean =>
  !!quote && !!minimumGap(quote) && quote.issues.every((i) => MINIMUM_FIRST(i.code));

/** The customer's words ask about the minimum («شو الحد الأدنى؟», "what's the minimum?"): answered by code, never by the model. */
export const ASKS_MINIMUM = /الحد الأدنى|الحد الادنى|حد أدنى|حد ادنى|الحدّ الأدنى|minimum|minimal|7add? el adna|7ad adna|el 7ad el adna|حد الطلب|اقل طلب|أقل طلب|a2al talab|a2al shi/iu;

type Basket = { lines: QuoteLineInput[]; villageId: string | null; placeId: string | null; pickup: boolean };

/**
 * The basket is under the minimum: kept, and the customer is told by code the minimum, the basket and the gap, with two buttons:
 * browse, or let the basket go. Nothing is added for the customer: the B1a run on main (sim-test 43722643280) showed a "+n item"
 * button counted as a quantity the customer never chose in 49 of 150 conversations; the customer names what to add.
 */
export async function askMinimum(ctx: ToolContext, basket: Basket, terms: CardTerms, quote: Quote, before?: string): Promise<boolean> {
  const g = minimumGap(quote);
  if (!g) return false;
  holdBasket(ctx, basket, terms, quote, "minimum");
  const T = messages(ctx.state.lang);
  const items = [
    { id: MENU_BROWSE, title: T.support.browseButton },
    { id: BASKET_CLEAR, title: T.basket.cancelButton },
  ];
  // B1c: the basket itself, line by line, so the customer sees what is in it (sim-test 43756167947: customers who could not see it said
  // their items again, and every time they were added: 4 piston, 4 sugar, 10 milk).
  const text = [before, T.basket.minimum(g.min, g.now, g.gap, itemsOf(basket.lines, quote, ctx.state.lang ?? "ar"))].filter(Boolean).join("\n");
  return (await deliver(ctx, buttons(text, items), `[minimum] ${text}`)).ok;
}

/** The basket as "2 × name" rows, in the conversation's language, named from the quote (or the quotes given). */
export function itemsOf(lines: QuoteLineInput[], quote: Pick<Quote, "lines"> | null | undefined, lang: Lang, ...more: (Pick<Quote, "lines"> | null | undefined)[]): string[] {
  const names = namesOf(quote, ...more);
  return lines.map((l) => { const n = names.get(l.product_id); return `${Number(l.qty)} × ${n ? productName({ ...n, product_id: l.product_id }, lang) : "?"}`; });
}

/** Keeps the basket in the conversation (it waits on `awaiting`). */
export function holdBasket(ctx: ToolContext, basket: Basket, terms: CardTerms, quote: Quote, awaiting: NonNullable<ToolContext["state"]["awaiting"]>) {
  ctx.state.lastQuote = { lines: basket.lines, villageId: basket.pickup ? null : basket.villageId, pickup: basket.pickup, quote };
  if (basket.placeId) ctx.state.placeId = basket.placeId;
  if (basket.villageId && !basket.pickup) ctx.state.villageId = basket.villageId;
  ctx.state.pending = terms; ctx.state.awaiting = awaiting;
  ctx.state.basketAt = Date.now();
}

/** The customer let the basket go ("cancel" with no order yet, or the button): nothing is sent, nothing is kept. */
export async function clearBasket(ctx: ToolContext): Promise<boolean> {
  ctx.state.lastQuote = null; ctx.state.pending = null; ctx.state.awaiting = null; ctx.state.slotId = null; ctx.state.orderRestrictions = null;
  ctx.state.basketAt = null; ctx.state.editing = null; ctx.state.asking = null;
  await ctx.db.rpc("clear_kept_order", { p_party: ctx.partyId }).then(() => undefined, () => undefined);
  const T = messages(ctx.state.lang);
  return (await deliver(ctx, { type: "text", text: { body: T.basket.cleared } }, T.basket.cleared)).ok;
}

/** How long a basket nobody touched stays in hand (a basket kept overnight for opening stays until it is taken up). */
export const BASKET_KEEP_MS = 6 * 3600_000;
/** The basket in hand, if any: lines the customer chose and no card yet. */
export function heldLines(ctx: ToolContext): QuoteLineInput[] | null {
  const q = ctx.state.lastQuote;
  return q && q.lines.length ? q.lines : null;
}
