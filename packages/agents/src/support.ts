// HO1 (docs/strategy/05-console-website-design-handoff.md section D): the never-stranded hand-off.
// A person is added to a conversation; the bot is never removed from it. A technical failure is not a hand-off.
//
// Everything that used to lock a chat (human_handoff) now opens a case through open_case() (0135) and tells the customer one
// line; the bot keeps taking orders, giving status and answering. Only a staff claim or a staff reply pauses the bot
// (conversations.bot_paused_until). The words are messages(lang).support; the database decides open hours and the case.
import { buttons, type Outbound } from "@ak/wa/kapso";
import type { ToolContext } from "./concierge-tools";
import { messages } from "./messages";

export type CaseKind = "person_requested" | "order_problem" | "complaint" | "refund" | "payment" | "safety" | "other";
export interface OpenedCase { case_id: string; kind: CaseKind; opened: boolean; after_hours: boolean; opens: string | null; state: string; order_id?: string | null }
/** What the turn learns about cases while it runs (the turn's outcome and the sim's checks read it). */
export interface SupportNote { opened?: OpenedCase; foodFact?: boolean; stalled?: boolean; reminded?: boolean }

const T = (ctx: ToolContext) => messages(ctx.state.lang);

// ---------- buttons ----------
export const CASE_KEEP = "case:keep", CASE_VOICE = "case:voice";
export const MENU_BROWSE = "menu:browse", MENU_ORDER = "menu:order", MENU_PERSON = "menu:person";
export const callbackButtonId = (caseId: string) => `case:cb:${caseId}`;
export function parseCallbackButton(id: string): string | null {
  const m = /^case:cb:([0-9a-f-]{36})$/.exec(id);
  return m ? m[1]! : null;
}
/** A button that repeats a tap whose handler failed. The original id rides along (WhatsApp allows 256 characters). */
export const RETRY_PREFIX = "again:";
export const retryButtonId = (tapped: string) => `${RETRY_PREFIX}${tapped}`.slice(0, 256);

/** The customer's six lines and the technical lines, as WhatsApp messages in the conversation's language. */
export function supportMessage(lang: string | null | undefined, what: "opened" | "reminder" | "stillOnIt" | "resumed" | "resolved" | "technical" | "capMenu" | "stalled",
                               opts: { caseId?: string; callback?: boolean } = {}): Outbound {
  const s = messages(lang).support;
  const b = { browse: { id: MENU_BROWSE, title: s.browseButton }, order: { id: MENU_ORDER, title: s.myOrderButton }, person: { id: MENU_PERSON, title: s.personButton } };
  switch (what) {
    case "opened":
      return opts.callback && opts.caseId ? buttons(s.opened, [{ id: callbackButtonId(opts.caseId), title: s.callbackButton }]) : text(s.opened);
    case "stillOnIt":
      return buttons(s.stillOnIt, [{ id: CASE_KEEP, title: s.keepOrderingButton }, ...(opts.caseId ? [{ id: callbackButtonId(opts.caseId), title: s.callbackButton }] : []),
                                   { id: CASE_VOICE, title: s.voiceNoteButton }]);
    case "technical": return buttons(s.technical, [b.browse, b.person]);
    case "capMenu": return buttons(s.capMenu, [b.browse, b.order, b.person]);
    case "stalled": return buttons(s.stalled, [b.browse, b.order, b.person]);
    default: return text(s[what]);
  }
}
const text = (body: string): Outbound => ({ type: "text", text: { body } });

/** A fixed line from code. Not counted against the model's two messages: it is code's own answer, one line. */
async function say(ctx: ToolContext, msg: Outbound, summary: string, orderId?: string): Promise<boolean> {
  const r = await ctx.send(msg, orderId ? { orderId } : undefined);
  if (r.ok) { ctx.sent.count++; ctx.sent.texts.push(summary); }
  return r.ok;
}
const bodyOf = (m: Outbound) => m.type === "text" ? m.text.body : String((m as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ?? "");

/**
 * What the model's own hand-off reason (handoff_human) is about, read by code. A food fact the records do not hold is not a
 * case (invariant 15: the fixed "not confirmed" answer, and the bot keeps serving). Safety first: an illness is never a food question.
 */
export function kindOfReason(reason: string): CaseKind | "food_fact" {
  const r = reason.toLowerCase();
  if (/reaction|hospital|sick|\bill\b|poison|emergenc|choking|swallow|تسمم|مستشفى|مرض|حساسية قوية|urgence|malade|intoxi/u.test(r)) return "safety";
  if (/refund|rembours|money back|مصاري|ترجع|استرجاع|استرداد/u.test(r)) return "refund";
  if (/complain|late|spoil|damag|broken|expired|wrong item|missing|not good|was bad|upset|terrible|rude|خربان|تالف|متأخر|ناقص|plainte|abîm/u.test(r)) return "complaint";
  if (/pay|whish|omt|transfer|receipt|charged|دفع|تحويل|paiement/u.test(r)) return "payment";
  if (/halal|allerg|vegan|vegetarian|gluten|lactose|ingredient|sesame|nut|food.?fact|not on record|kitchen|label|حلال|مكونات|نباتي|صيامي|ingrédient/u.test(r)) return "food_fact";
  if (/person|human|team|staff|manager|agent|shakhs|real|bot|فريق|شخص|موظف|personne/u.test(r)) return "person_requested";
  if (/order|cancel|delivery|طلب|commande/u.test(r)) return "order_problem";
  return "other";
}

export async function openCase(ctx: ToolContext, kind: CaseKind, topic: string | null, opts: { orderId?: string | null; source: string }): Promise<OpenedCase> {
  const { data, error } = await ctx.db.rpc("open_case", { p_conversation: ctx.conversationId, p_kind: kind, p_topic: topic,
                                                          p_order: opts.orderId ?? null, p_source: opts.source });
  if (error) throw new Error(`open_case: ${error.message}`);
  return data as OpenedCase;
}

/** The line for a case just opened: within minutes and ordering continues; or, after hours, the honest opening time. */
export async function tellOpened(ctx: ToolContext, c: OpenedCase, orderId?: string): Promise<boolean> {
  const s = T(ctx).support;
  if (c.after_hours) return say(ctx, text(s.afterHours(c.opens ?? "")), s.afterHours(c.opens ?? ""), orderId);
  const m = supportMessage(ctx.state.lang, "opened", { caseId: c.case_id, callback: c.kind === "person_requested" });
  return say(ctx, m, bodyOf(m), orderId);
}

/** "Your request is open", at most every settings.support.topic_reminder_min. False when it is not due (or not sent). */
export async function remindCase(ctx: ToolContext, caseId: string): Promise<boolean> {
  const { data, error } = await ctx.db.rpc("case_remind", { p_case: caseId });
  if (error || data !== true) return false;
  return say(ctx, text(T(ctx).support.reminder), T(ctx).support.reminder);
}

/**
 * The one hand-off path for the planner and the model (handoff_human). Opens the case and says the opened line; a case of that
 * kind already open gets the reminder when due. Returns ok false when nothing was sent, so the model answers the customer itself.
 */
export async function handoffToCase(ctx: ToolContext, reason: string, source: "model" | "planner" | "code", note: SupportNote, orderId?: string | null):
    Promise<{ ok: true } | { ok: false; error: string; note: string }> {
  if (reason === "agent_did_not_finish") {
    // The loop stalled: never silence, never a case. One fixed question with buttons.
    note.stalled = true;
    const m = supportMessage(ctx.state.lang, "stalled");
    return (await say(ctx, m, bodyOf(m))) ? { ok: true } : { ok: false, error: "not_sent", note: "" };
  }
  const kind = kindOfReason(reason);
  if (kind === "food_fact") {
    note.foodFact = true;
    const s = T(ctx).support;
    return (await say(ctx, text(s.notOnRecord), s.notOnRecord)) ? { ok: true } : { ok: false, error: "not_sent", note: "" };
  }
  const c = await openCase(ctx, kind, reason.slice(0, 300), { orderId: orderId ?? null, source });
  if (c.opened) {
    note.opened = c;
    return (await tellOpened(ctx, c)) ? { ok: true } : { ok: false, error: "not_sent", note: "" };
  }
  if (await remindCase(ctx, c.case_id)) { note.reminded = true; return { ok: true }; }
  return { ok: false, error: "request_already_open",
    note: "A person already has this request and will answer. Do not hand off again: answer the customer now with reply (help with anything else, or say the request is with the team)." };
}
