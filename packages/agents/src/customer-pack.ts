// CX1 (the customer pack): docs/strategy/02-journeys.md section 1 and 03 section B, by code only. No model writes any of it.
//  - The first-ever welcome: what we do, the hours, three buttons (Order, Browse, Do you deliver to me?) and one privacy line, whose
//    words are kept with the customer's consent (claim_welcome, 0143).
//  - The card's two choices, one tap each, in the list under the confirmation (the card's three buttons are WhatsApp's limit): what to
//    do if an item is missing, which note the customer pays with, the change kept as credit, and Cancel (set_order_choice, 0144).
//  - "Cancel my order" in words: what a cancel gives back, and a button that cancels (cancel_terms, 0145). After picking started, the
//    exact refundable amount and a person (a case).
//  - The handover code with the confirmation of a prepaid order (0146), and pickup at the hub from settings.pickup.
import { buttons, list, type Outbound } from "@ak/wa/kapso";
import type { ToolContext } from "./concierge-tools";
import { messages, type Lang } from "./messages";
import { orderButtonId } from "./order-card";
import { MENU_BROWSE } from "./support";
import { normalise } from "./quick-intent";
import { holdDraft, resumeBasket } from "./pipeline";

export const WELCOME_ORDER = "welcome:order", WELCOME_AREA = "welcome:area";
export type MissingPref = "best_match" | "ask" | "remove";

async function rpc<T>(ctx: Pick<ToolContext, "db">, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await ctx.db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

// ---------- the welcome ----------
export function welcomeMessage(lang: Lang | string | null | undefined, hours: { open: string | null; close: string | null } | null): Outbound {
  const c = messages(lang).cx;
  return buttons(c.welcome(hours?.open ?? null, hours?.close ?? null), [
    { id: WELCOME_ORDER, title: c.orderButton },
    { id: MENU_BROWSE, title: messages(lang).support.browseButton },
    { id: WELCOME_AREA, title: c.areaButton },
  ]);
}

/**
 * The welcome, on the customer's first message ever. The database decides "first" (claim_welcome: no earlier message, no order) and
 * keeps the privacy line's words with the customer; the outbox key makes a retried turn send it once. Its words when it was sent.
 */
export async function sendWelcome(ctx: ToolContext, turnIds: string[]): Promise<string | null> {
  const lang = ctx.state.lang ?? "ar";
  const claimed = await rpc<boolean>(ctx, "claim_welcome", { p_party: ctx.partyId, p_turn_ids: turnIds, p_lang: lang, p_privacy: messages(lang).cx.privacy });
  if (!claimed) return null;
  const hours = await rpc<{ open: string | null; close: string | null } | null>(ctx, "service_info", {}).catch(() => null);
  // Not counted against the model's two messages: it is code's own first line, before the turn's answer.
  const r = await ctx.send(welcomeMessage(lang, hours));
  return r.ok ? messages(lang).cx.welcome(hours?.open ?? null, hours?.close ?? null) : null;
}

// ---------- the card's choices ----------
export type Choice = { kind: "missing"; value: MissingPref; orderId: string } | { kind: "note"; value: string; orderId: string }
                   | { kind: "keep"; orderId: string };
export const choiceButtonId = (c: Choice): string =>
  c.kind === "keep" ? `choice:keep:x:${c.orderId}` : `choice:${c.kind}:${c.value}:${c.orderId}`;
export function parseChoiceButton(id: string): Choice | null {
  const m = /^choice:(missing|note|keep):([a-z_]+|\d+|x):([0-9a-f-]{36})$/.exec(id);
  if (!m) return null;
  if (m[1] === "keep") return { kind: "keep", orderId: m[3]! };
  if (m[1] === "missing") return ["best_match", "ask", "remove"].includes(m[2]!) ? { kind: "missing", value: m[2] as MissingPref, orderId: m[3]! } : null;
  return /^(\d+|exact)$/.test(m[2]!) ? { kind: "note", value: m[2]!, orderId: m[3]! } : null;
}

export interface ConfirmedOrder { orderId: string; status: string; payment_method?: string | null; total_usd?: number | null; handover_code?: string | null }

/**
 * The answer to Confirm, with the card's two choices one tap away. It replaces the plain confirmation text (no message is added): the
 * same words as body, the handover code under them for a prepaid order, and a list of rows: what to do if an item is missing, which
 * note the customer pays with (cash only; notes from settings.card_choices above the total), the change kept as credit, and Cancel.
 */
export async function confirmedWithChoices(ctx: Pick<ToolContext, "db" | "state">, body: string, o: ConfirmedOrder): Promise<Outbound> {
  const lang = ctx.state.lang ?? "ar";
  const c = messages(lang).cx;
  // CFG1: every pickup order has a code, and it is given to the hub, not to a rider.
  const pickup = o.handover_code ? await rpc<boolean>(ctx, "order_is_pickup", { p_order: o.orderId }).catch(() => false) : false;
  const text = o.handover_code ? `${body}\n\n${pickup ? c.handoverCodePickup(o.handover_code) : c.handoverCode(o.handover_code)}` : body;
  const rows: { id: string; title: string; description?: string }[] = (["best_match", "ask", "remove"] as const)
    .map((p) => ({ id: choiceButtonId({ kind: "missing", value: p, orderId: o.orderId }), title: c.missingRow[p], description: c.choicesMissing }));
  if (o.payment_method === "cod") {
    const notes = ((await rpc<{ notes_usd?: number[] } | null>(ctx, "setting", { p_key: "card_choices" }).catch(() => null))?.notes_usd ?? [])
      .filter((n) => Number(n) > Number(o.total_usd ?? 0)).slice(0, 3);
    rows.push({ id: choiceButtonId({ kind: "note", value: "exact", orderId: o.orderId }), title: c.exactRow, description: c.choicesNote },
              ...notes.map((n) => ({ id: choiceButtonId({ kind: "note", value: String(n), orderId: o.orderId }), title: c.noteRow(Number(n)), description: c.choicesNote })));
    if (notes.length) rows.push({ id: choiceButtonId({ kind: "keep", orderId: o.orderId }), title: c.keepRow, description: c.choicesNote });
  }
  rows.push({ id: orderButtonId("cancel", o.orderId), title: c.cancelRow, description: c.choicesOrder });
  return list(text, c.choicesButton, rows.slice(0, 10));
}

/** A row of the choices list, tapped: set_order_choice answers, code words the reply. */
export async function applyChoice(ctx: ToolContext, choice: Choice): Promise<string> {
  const c = messages(ctx.state.lang).cx;
  const r = await rpc<{ ok: boolean; reason?: string; short_code?: string; total_usd?: number; note_usd?: number | null; change_usd?: number }>(ctx, "set_order_choice", {
    p_order: choice.orderId, p_party: ctx.partyId, p_choice: choice.kind === "keep" ? "keep_change" : choice.kind,
    p_value: choice.kind === "keep" ? "true" : choice.value });
  if (!r.ok) {
    if (r.reason === "needs_note") return c.needsNote;
    if (r.reason === "note_too_small") return c.noteTooSmall(Number(r.total_usd ?? 0));
    return c.choiceTooLate(r.short_code ?? "");
  }
  if (choice.kind === "missing") return c.missingSet(choice.value);
  if (choice.kind === "keep") return c.keepSet(Number(r.change_usd ?? 0));
  return r.note_usd == null ? c.exactSet : c.noteSet(Number(r.note_usd), Number(r.change_usd ?? 0));
}

// ---------- cancel ----------
export interface CancelTerms { order_id: string; short_code: string; status: string; payment_method: string; cancellable: boolean; reason: string | null;
  paid_usd: number; refundable_usd: number; kept: string[] }

/** "Cancel my order" in words, said by code (Lebanese Arabic, Arabizi, English, French). The whole message must be the request. */
const CANCEL = new RegExp("^(?:(?:لو سمحت|بليز|please|svp|stp|yalla|يلا)\\s+)?(?:" + [
  "(?:بدي\\s+)?(?:الغي|لغي|الغيلي|لغيلي|الغوا|لغوا|الغو|لغو|كنسل|كنسلي|كنسلو)\\s+(?:ال)?طلب(?:يه|يتي|ي)?(?:\\s+تبعي)?",
  "(?:بدي\\s+)?(?:الغاء|لغي|الغي)\\s+(?:ال)?طلب(?:يه|يتي|ي)?",
  "ما\\s+عاد\\s+بدي\\s+(?:ال)?طلب(?:يه|يتي|ي)?",
  "(?:baddi\\s+|bade\\s+|bde\\s+)?(?:2alghi|alghi|elghi|cancel|kansel|cancell?i)\\s+(?:el\\s+|l\\s+)?(?:talab|talabi|talabiye|order)(?:\\s+taba3i)?",
  "ma\\s+3ad\\s+(?:baddi|bade|bde)\\s+(?:el\\s+|l\\s+)?(?:talab|talabi|order)",
  "(?:please\\s+)?cancel\\s+(?:my|the)\\s+order", "i\\s+(?:want|would like)\\s+to\\s+cancel(?:\\s+(?:my|the)\\s+order)?", "cancel\\s+it",
  "annule[rz]?\\s+(?:ma|la)\\s+commande", "je\\s+veux\\s+annuler(?:\\s+(?:ma|la)\\s+commande)?",
].join("|") + ")(?:\\s+(?:لو سمحت|please|svp|stp|merci|شكرا))?$", "u");
export const cancelWords = (text: string): boolean => CANCEL.test(normalise(text));

/** Pickup instead of delivery, said by code: «باخدو من عندكن», "I'll pick it up", "je passe le prendre". */
const PICKUP = new RegExp("(?:^|\\s)(?:" + [
  "(?:بمرق|بمر|بجي|رح اجي|رح مر)\\s+(?:انا\\s+)?(?:باخدو|باخدها|اخدو|اخدها|اخدن|باخدن|استلمو|استلمها)",
  "(?:باخدو|باخدها|باخدن|بستلمو|بستلمها|بستلمن)\\s+(?:انا\\s+)?(?:من\\s+)?(?:عندكن|عندكم|المحل|المستودع)",
  "استلام\\s+من\\s+(?:المحل|المستودع|عندكن)", "بلا\\s+توصيل",
  "(?:bmor|bmorr|bje|baje)\\s+(?:ana\\s+)?(?:bekhdo|bekhda|ekhdo|ekhda|bekhedon)", "(?:bekhdo|bekhda|bestelmo)\\s+(?:men|mn)\\s+(?:3endkon|3andkon|el ma7al)",
  "pick\\s*(?:it|them)?\\s*up\\s*(?:myself)?", "i(?:'ll|\\s+will)\\s+(?:come\\s+and\\s+)?(?:pick|collect)\\s+(?:it|them)(?:\\s+up)?", "no\\s+delivery", "pickup",
  "je\\s+(?:passe|viens)\\s+(?:le|la|les)\\s+(?:prendre|chercher|recuperer)", "retrait\\s+(?:sur\\s+place|au\\s+magasin)", "sans\\s+livraison",
].join("|") + ")(?:\\s|$)", "u");
export const pickupWords = (text: string): boolean => PICKUP.test(normalise(text));

/**
 * The answer when the tap or the words cannot cancel (cancel_terms said why). Picking started: the exact refundable amount, the lines
 * that cannot go back on the shelf, and a person. On its way: a person. Past a scheduled order's cut-off: the cut-off line (0040).
 */
export function cancelRefusedText(t: Pick<CancelTerms, "short_code" | "reason" | "payment_method" | "paid_usd" | "refundable_usd" | "kept">, lang: Lang | string | null | undefined): string | null {
  const c = messages(lang).cx;
  if (t.reason === "on_the_way" || t.reason === "with_rider") return c.cancelOnTheWay(t.short_code);
  if (t.reason !== "picking_started") return null;
  return Number(t.paid_usd) > 0 ? c.cancelAfterPick(t.short_code, Number(t.refundable_usd), t.kept ?? []) : c.cancelAfterPickCash(t.short_code);
}

/** The button under "cancel my order?": the card's own Cancel id, so the same database path answers it. */
export function cancelAsk(t: Pick<CancelTerms, "order_id" | "short_code" | "paid_usd">, lang: Lang | string | null | undefined): Outbound {
  const c = messages(lang).cx;
  return buttons(c.cancelAsk(t.short_code, Number(t.paid_usd)), [{ id: orderButtonId("cancel", t.order_id), title: c.cancelYes }]);
}

/** Where to collect a pickup, in the customer's language (settings.pickup), or null while pickup is off. */
export async function pickupPlace(ctx: Pick<ToolContext, "db">, lang: Lang | string | null | undefined): Promise<string | null> {
  return rpc<string | null>(ctx, "pickup_place", { p_lang: lang ?? "ar" }).catch(() => null);
}

/**
 * "I'll pick it up" said by code. The basket in hand (or the card waiting for the tap, taken back as Edit does) goes on as a pickup at
 * the hub, with no delivery fee, through the same path as any basket (resumeBasket). Pickup off (no place named): one line, and the
 * basket stays a delivery. Nothing in hand: not done, the turn reads the words as usual.
 */
export async function switchToPickup(ctx: ToolContext): Promise<{ done: boolean; path: string }> {
  const c = messages(ctx.state.lang).cx;
  const say = async (text: string) => { const r = await ctx.send({ type: "text", text: { body: text } }); if (r.ok) { ctx.sent.count++; ctx.sent.texts.push(text); } return r.ok; };
  if (!ctx.state.lastQuote) {
    const s = await rpc<{ order_id?: string; status?: string } | null>(ctx, "order_status_for", { p_party: ctx.partyId }).catch(() => null);
    if (!s?.order_id || s.status !== "awaiting_confirmation") return { done: false, path: "pickup_nothing" };
    if (!(await pickupPlace(ctx, ctx.state.lang))) return { done: await say(c.pickupOff), path: "pickup_off" };
    await rpc(ctx, "handle_order_button", { p_order: s.order_id, p_action: "edit", p_party: ctx.partyId, p_wamid: null });
    await holdDraft(ctx, s.order_id);
    if (!ctx.state.lastQuote) return { done: false, path: "pickup_nothing" };
  } else if (!(await pickupPlace(ctx, ctx.state.lang))) return { done: await say(c.pickupOff), path: "pickup_off" };
  const q = ctx.state.lastQuote!;
  ctx.state.lastQuote = { ...q, pickup: true, villageId: null };
  if (ctx.state.awaiting && ctx.state.awaiting !== "opening") ctx.state.awaiting = null;
  ctx.state.slotId = null;
  const r = await resumeBasket(ctx);
  return { done: r.done, path: r.done ? `pickup:${r.path}` : "pickup_not_sent" };
}
