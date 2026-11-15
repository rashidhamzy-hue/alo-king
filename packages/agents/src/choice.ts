// B1c (wrong products, part 3): a line the planner could not tell apart is asked by code, one short question with at most three
// buttons, never left to the model's guess.
//
// sim-test 43756167947 (B1b's second run on main): when a line was ambiguous, the ask loop's model often chose for the customer
// (the 6 L gallon for «مي تنورين ٢ ليتر ربطة ٦», sim-139), asked about one line and dropped the others (the garlic of sim-088, the
// chicken strips of sim-130), or lost the count said with it (B1a's sim-105: «٢ نجار» came back as one after the tap). Here the
// question lists the products the planner offered (best fit, then the fastest sellers; prices from the plan), each a button that
// carries the product. The line's own words, count and unit wait in the conversation with the question, and the other lines of the
// message stay in the basket. The tap re-plans that one line with the product chosen (plan_order's p_choices), so the count, the
// unit and the price are the database's, and the basket goes on (the next question, the minimum, the pin, the card).
import { buttons } from "@ak/wa/kapso";
import { deliver, type CardTerms, type QuoteLineInput, type ToolContext } from "./concierge-tools";
import type { Quote } from "./order-card";
import { messages, productName, type Lang } from "./messages";
import { applyEdits, itemsOf } from "./basket";
import type { OrderIntent } from "./schemas";
import { packSizeCount } from "./reading";

/** One line waiting on the customer's choice: their words, the reading of the line, and the products offered. */
export interface AskingLine {
  raw: string;
  line: OrderIntent["lines"][number];
  candidates: { product_id: string; name: string; name_ar: string | null; price_usd: number | null }[];
}
type Candidate = { product_id: string; name?: string; name_ar?: string | null; price_usd?: number | null; in_stock?: boolean };
type PlanLineLike = { idx: number; raw?: string; status: string; candidates: Candidate[] | null };

export const PICK = "pick:";
export const pickButtonId = (productId: string) => `${PICK}${productId}`;
export function parsePickButton(id: string): string | null {
  const m = /^pick:([0-9a-f-]{36})$/.exec(id);
  return m ? m[1]! : null;
}

/** A plan line the code can ask about: ambiguous, every product offered in stock. */
export const askableLine = (l: PlanLineLike): boolean => l.status === "ambiguous" && (l.candidates ?? []).length > 0
  // one of them out of stock: the loop words it (what ran out, what replaces it), as before
  && (l.candidates ?? []).every((c) => c.in_stock !== false && !!c.name);

/** The questions for these plan lines, in the order said (at most three products each, those in stock). */
export function questionsFor(lines: PlanLineLike[], intent: Pick<OrderIntent, "lines">): AskingLine[] {
  return lines.filter(askableLine).flatMap((l) => {
    const line = intent.lines[l.idx];
    if (!line) return [];
    const candidates = (l.candidates ?? []).filter((c) => c.in_stock !== false).slice(0, 3)
      .map((c) => ({ product_id: c.product_id, name: c.name ?? "", name_ar: c.name_ar ?? null, price_usd: c.price_usd == null ? null : Number(c.price_usd) }));
    return candidates.length ? [{ raw: (line.raw || l.raw || line.query).trim().slice(0, 60), line, candidates }] : [];
  });
}

/** Button titles of at most 20 characters that tell the products apart: the name, else the brand and the size, else numbered. */
export function pickTitles(cands: { name: string; name_ar: string | null; product_id: string }[], lang: Lang): string[] {
  const full = cands.map((c) => productName(c, lang));
  if (full.every((n) => n.length <= 20) && new Set(full).size === full.length) return full;
  const size = (n: string) => /(\d+(?:[.,]\d+)?\s?(?:kg|g|ml|cl|l|ltr|pieces|pcs|rolls|sheets|loaves)\b(?:\s?x\s?\d+)?)/i.exec(n)?.[1] ?? "";
  const short = full.map((n) => {
    if (n.length <= 20) return n;
    const s = size(n);
    const head = n.replace(s, "").replace(/\s+/g, " ").trim();
    return s ? `${head.slice(0, 19 - s.length).trim()} ${s}` : head.slice(0, 20).trim();
  });
  if (new Set(short).size === short.length) return short;
  return short.map((n, i) => `${i + 1}. ${n}`.slice(0, 20));
}

/** Asks the first waiting line by code. False when nothing waits or the question could not go out. */
export async function askChoice(ctx: ToolContext, before?: string): Promise<boolean> {
  const q = ctx.state.asking?.[0];
  if (!q || !q.candidates.length) return false;
  const lang = ctx.state.lang ?? "ar";
  const T = messages(lang);
  const usd = (n: number | null) => (n == null ? "" : `: $${Number(n).toFixed(2)}`);
  const rows = q.candidates.map((c) => `${productName(c, lang)}${usd(c.price_usd)}`);
  const titles = pickTitles(q.candidates, lang);
  const text = [before, T.basket.which(q.raw, rows)].filter(Boolean).join("\n");
  return (await deliver(ctx, buttons(text, q.candidates.map((c, i) => ({ id: pickButtonId(c.product_id), title: titles[i]! }))), `[which] ${text}`)).ok;
}

type Done = { done: true; path: string } | { done: false };
type Route = (ctx: ToolContext, basket: { lines: QuoteLineInput[]; villageId: string | null; placeId: string | null; pickup: boolean }, terms: CardTerms,
              quote: Quote, before?: string) => Promise<Done>;

/**
 * The customer tapped one of the products offered: that line is planned again with the product chosen (its count and unit as said),
 * added to the basket in hand, and the basket goes on: the next question if one waits, else `route` (the minimum, the pin, the card).
 * Not done when the tap is not for the question waiting (an old button): the caller reads its title as words.
 */
export async function takePick(ctx: ToolContext, productId: string, route: Route): Promise<Done> {
  const q = ctx.state.asking?.[0];
  if (!q || !q.candidates.some((c) => c.product_id === productId)) return { done: false };
  // the count of pieces that is the chosen pack's own size is one pack («٣٢ حبة» of the 32-piece diapers, sim-147)
  const c = q.candidates.find((x) => x.product_id === productId)!;
  const packs = packSizeCount({ raw: q.line.raw, qty: Number(q.line.qty) }, [c.name, c.name_ar]);
  const line = packs != null ? { ...q.line, qty: packs } : q.line;
  const plan = await rpc<{ lines: { status: string }[]; quote_lines: QuoteLineInput[] }>(ctx, "plan_order", {
    p_party: ctx.partyId, p_intent: { intent: "order", fulfilment: "unknown", lines: [line], address: {} }, p_village: ctx.state.villageId ?? null,
    p_choices: { 0: productId } });
  const picked = plan.quote_lines.find((l) => l.product_id === productId)
    ?? { product_id: productId, qty: Number(line.qty ?? 1) || 1, ...(line.modifiers?.length ? { modifiers: line.modifiers } : {}) };
  const held = ctx.state.lastQuote;
  const lines = applyEdits(held?.lines ?? [], [{ op: "add", product_id: picked.product_id, qty: Number(picked.qty), source_id: picked.source_id ?? null,
                                                 modifiers: picked.modifiers, note: picked.note ?? null }]).lines;
  const pickup = held?.pickup ?? false;
  const villageId = pickup ? null : ctx.state.villageId ?? held?.villageId ?? null;
  const quote = await rpc<Quote>(ctx, "quote_order", { p_lines: lines, p_village: villageId, p_pickup: pickup, ...(ctx.state.slotId ? { p_slot: ctx.state.slotId } : {}) });
  ctx.state.lastQuote = { lines, villageId, pickup, quote };
  ctx.state.basketAt = Date.now();
  ctx.state.asking = ctx.state.asking!.slice(1);
  if (!ctx.state.asking.length) ctx.state.asking = null;
  if (ctx.state.awaiting === "minimum") ctx.state.awaiting = null;
  const terms = ctx.state.pending ?? { payment: "cod" as const, changeForUsd: null, notes: ctx.state.directions ?? null };
  ctx.state.pending = terms;
  if (ctx.state.asking?.length) return (await askChoice(ctx)) ? { done: true, path: "which_next" } : { done: false };
  return route(ctx, { lines, villageId, placeId: ctx.state.placeId ?? null, pickup }, terms, quote);
}

/** The basket in hand as rows, for a question that follows a change to it. */
export const basketRows = (ctx: ToolContext): string[] =>
  ctx.state.lastQuote ? itemsOf(ctx.state.lastQuote.lines, ctx.state.lastQuote.quote, ctx.state.lang ?? "ar") : [];

async function rpc<T>(ctx: ToolContext, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await ctx.db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
