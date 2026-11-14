// A cart sent from the WhatsApp catalog (1.21 step 5). Code, not the model: the cart's items become the same quote lines a typed
// order produces (plan_cart, 0085), priced by quote_order, and the customer gets the normal order card and confirms with a tap.
// The catalog never confirms. Anything gone or repriced since Meta read the feed is named before the card.
import type { CardTerms, QuoteLineInput, ToolContext } from "./concierge-tools";
import { deliver, keepUntilOpen } from "./concierge-tools";
import { FIXED, type Quote } from "./order-card";
import { sendBasket, WHERE_ISSUES } from "./pipeline";

/** The `order` object of an inbound WhatsApp order message (Meta's webhook reference). */
export interface CartOrder { catalog_id?: string; text?: string;
  product_items?: { product_retailer_id?: string; quantity?: number | string; item_price?: number | string; currency?: string }[] }
interface CartPlan {
  ok: boolean; error?: string;
  lines: { sku: string; product_id: string; name: string; name_ar: string | null; qty: number }[];
  quote_lines: QuoteLineInput[]; quote: Quote | null; issues: { code: string; [k: string]: unknown }[];
  removed: { sku: string; name?: string; name_ar?: string | null; reason: "unknown" | "out_of_stock" }[];
  price_changed: { sku: string; name: string; name_ar: string | null; cart_price: number; price_usd: number }[];
  village_id: string | null; place_id: string | null; payment_method: "cod" | "whish" | "omt";
}

const money = (n: number) => `$${Number(n).toFixed(2)}`;
export const CART_TEXT = {
  removed: (names: string[], unknown: number) => [
    names.length ? `هول مش متوفّرين هلّق وشلناهن من الطلب: ${names.join("، ")}.` : null,
    unknown ? (unknown === 1 ? "في غرض بالسلة ما عاد موجود عنا، وشلناه." : `في ${unknown} أغراض بالسلة ما عادوا موجودين عنا، وشلناهن.`) : null,
  ].filter(Boolean).join("\n"),
  /** Prices said by code from the database, never by the model: the card shows the same ones. */
  priceChanged: (items: { name: string; price: number }[]) => `تغيّر السعر من وقت ما انعرض بالكتالوج: ${items.map((i) => `${i.name} صار ${money(i.price)}`).join("، ")}. الورقة فيها السعر الجديد.`,
  nothing: "ما بقي شي من السلة متوفّر هلّق. شو بتحب تطلب بدالهن؟",
  wrongCatalog: "ما قدرنا نقرا هالسلة. فيك تبعتلنا الطلب كتابة؟",
};

/** The cart in words, for the Concierge when code cannot finish it (an issue that needs a question). */
export function cartAsText(order: CartOrder | undefined, lines?: CartPlan["lines"]): string {
  const items = lines?.length ? lines.map((l) => `${l.qty} × ${l.name_ar ?? l.name}`)
                              : (order?.product_items ?? []).map((i) => `${Number(i.quantity ?? 1)} × ${i.product_retailer_id ?? "?"}`);
  return `[catalog cart: ${items.join(", ") || "empty"}${order?.text ? ` | note: ${order.text}` : ""}]`;
}

/**
 * Handles one cart. done: the turn is answered (a card, a pin request, the closed message, or what was missing). Otherwise the
 * basket is kept in the conversation and the Concierge words the question (below the minimum, a village we do not serve, ...).
 */
export async function takeCart(ctx: ToolContext, order: CartOrder | undefined): Promise<{ done: true; path: string } | { done: false; asText: string }> {
  const items = (order?.product_items ?? [])
    .filter((i) => typeof i.product_retailer_id === "string" && i.product_retailer_id)
    .map((i) => ({ sku: i.product_retailer_id!, qty: Number(i.quantity ?? 1) || 1,
                   price: i.item_price === undefined || i.item_price === null ? null : Number(i.item_price), currency: i.currency ?? null }));
  if (!items.length) return { done: false, asText: cartAsText(order) };
  const { data, error } = await ctx.db.rpc("plan_cart", { p_party: ctx.partyId, p_items: items, p_village: ctx.state.villageId ?? null,
                                                         p_catalog: order?.catalog_id ?? null });
  if (error) throw new Error(`plan_cart: ${error.message}`);
  const plan = data as CartPlan;
  if (!plan.ok) {
    const r = await deliver(ctx, { type: "text", text: { body: CART_TEXT.wrongCatalog } }, CART_TEXT.wrongCatalog);
    return r.ok ? { done: true, path: "cart_wrong_catalog" } : { done: false, asText: cartAsText(order) };
  }
  if (plan.village_id) ctx.state.villageId = plan.village_id;
  if (plan.place_id) ctx.state.placeId = plan.place_id;
  const gone = plan.removed.filter((r) => r.reason === "out_of_stock").map((r) => r.name_ar ?? r.name ?? r.sku);
  const unknown = plan.removed.filter((r) => r.reason === "unknown").length;
  const before = [gone.length || unknown ? CART_TEXT.removed(gone, unknown) : null,
                  plan.price_changed.length ? CART_TEXT.priceChanged(plan.price_changed.map((c) => ({ name: c.name_ar ?? c.name, price: c.price_usd }))) : null]
    .filter(Boolean).join("\n") || undefined;
  if (!plan.quote_lines.length || !plan.quote) {
    const text = before ? `${before}\n${CART_TEXT.nothing}` : CART_TEXT.nothing;
    const r = await deliver(ctx, { type: "text", text: { body: text } }, text);
    return r.ok ? { done: true, path: "cart_nothing_left" } : { done: false, asText: cartAsText(order) };
  }
  // The customer's own words sent with the cart travel to the rider, like any order note.
  const note = order?.text?.trim().slice(0, 300) || null;
  const terms: CardTerms = { payment: plan.payment_method, changeForUsd: null, notes: note };
  const basket = { lines: plan.quote_lines, villageId: plan.village_id, placeId: plan.place_id, pickup: false };
  const closed = plan.issues.find((i) => i.code === "closed");
  if (closed && plan.issues.every((i) => i.code === "closed" || WHERE_ISSUES.has(i.code))) {
    const kept = await keepUntilOpen(ctx, { ...basket, quote: plan.quote }, terms, String(closed.opens ?? ""), { before });
    return kept.ok ? { done: true, path: "cart_closed_kept" } : { done: false, asText: cartAsText(order) };
  }
  if (plan.issues.some((i) => i.code === "fx_paused")) {
    ctx.state.lastQuote = { ...basket, quote: plan.quote };
    const text = before ? `${before}\n${FIXED.fxPaused}` : FIXED.fxPaused;
    const r = await deliver(ctx, { type: "text", text: { body: text } }, text);
    return r.ok ? { done: true, path: "cart_fx_paused" } : { done: false, asText: cartAsText(order) };
  }
  if (plan.issues.every((i) => WHERE_ISSUES.has(i.code))) {
    const routed = await sendBasket(ctx, basket, terms, plan.quote, before);
    if (routed.done) return { done: true, path: `cart_${routed.path}` };
  }
  // Something needs words (below the minimum, a village we do not serve): the basket is kept and the Concierge asks.
  ctx.state.lastQuote = { ...basket, quote: plan.quote };
  return { done: false, asText: cartAsText(order, plan.lines) };
}
