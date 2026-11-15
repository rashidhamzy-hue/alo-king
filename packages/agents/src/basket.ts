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
interface PlannedLine { idx: number; status: string; qty: number; chosen: { product_id: string } | null; candidates: { product_id: string }[] | null }
interface PlannedBasket { lines: PlannedLine[]; quote_lines: QuoteLineInput[] }

/** The default edit of a line the reading did not mark: "add" for intent add_to_order, else "set" (a restated item keeps its count). */
export const defaultOp = (intent: OrderIntent["intent"]): BasketOp => (intent === "add_to_order" ? "add" : intent === "cancel" ? "remove" : "set");

/**
 * The edits a reading makes to the basket in hand, from the planner's lines. A line to remove or to re-count names a product in the
 * basket (the planner's choice, or the one basket product among its candidates); a line that adds names the product the planner
 * matched. A product listed as a substitute for a basket line that ran out (in the held quote's issues) replaces that line.
 * `unresolved`: lines that need a question (ambiguous, not found, or a remove that names nothing in the basket).
 */
export function editsFromPlan(intent: Pick<OrderIntent, "intent" | "lines">, plan: PlannedBasket, held: QuoteLineInput[], heldQuote?: Pick<Quote, "issues" | "lines"> | null,
                              hints: Map<number, string[]> = new Map()): { edits: BasketEdit[]; unresolved: PlannedLine[] } {
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
    const op: BasketOp = explicit ?? defaultOp(intent.intent);
    const priced = pl.chosen ? plan.quote_lines.find((q) => q.product_id === pl.chosen!.product_id) : undefined;
    const qty = Number(priced?.qty ?? pl.qty);
    // "Add 2 more", "make it 3", "take the bread off": the line names something already in the basket. The planner's choice when it
    // is there; else the one basket product among its candidates; else the one basket product whose name shares the customer's words.
    if (explicit) {
      const target = pl.chosen && inBasket.has(pl.chosen.product_id) ? pl.chosen.product_id
        : onlyOne((pl.candidates ?? []).map((c) => c.product_id).filter((p) => inBasket.has(p)))
          ?? byName([said?.query, said?.raw], (heldQuote?.lines ?? []).filter((l) => l.product_id && inBasket.has(l.product_id)))
          ?? onlyOne((hints.get(pl.idx) ?? []).filter((p) => inBasket.has(p)));
      if (target) { edits.push({ op, product_id: target, qty: op === "remove" ? undefined : qty }); continue; }
      if (op === "remove") { unresolved.push(pl); continue; }
    }
    if (pl.status !== "matched" || !pl.chosen) {
      // A restated item the planner could not tell apart, whose candidates hold exactly one product already in the basket, is that product.
      const known = pl.status === "ambiguous" && op === "set" ? onlyOne((pl.candidates ?? []).map((c) => c.product_id).filter((p) => inBasket.has(p))) : null;
      if (known) { edits.push({ op: "set", product_id: known, qty }); continue; }
      unresolved.push(pl);
      continue;
    }
    const p = pl.chosen.product_id;
    edits.push({ op: inBasket.has(p) ? op : "add", product_id: p, qty, source_id: priced?.source_id ?? null,
                 modifiers: priced?.modifiers, note: priced?.note ?? null, replaces: inBasket.has(p) ? null : substituteOf.get(p) ?? null });
  }
  return { edits, unresolved };
}
const onlyOne = (xs: string[]): string | null => (new Set(xs).size === 1 ? xs[0]! : null);

/** Lower case, one alef, ta marbuta as ha, no diacritics or punctuation: for matching a customer's words to a basket item's name. */
const foldWords = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
  .replace(/^ال/u, "").split(/[^\p{L}\p{N}]+/u).map((w) => w.replace(/^ال/u, "")).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
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
  const text = [before, T.basket.minimum(g.min, g.now, g.gap)].filter(Boolean).join("\n");
  return (await deliver(ctx, buttons(text, items), `[minimum] ${text}`)).ok;
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
  ctx.state.basketAt = null;
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
