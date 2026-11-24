// One customer turn: everything that arrived in a burst, handled in order.
// Buttons, pins and STOP are handled by code. Only free text and voice reach the model.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askLocation, type KapsoReceived, type Outbound } from "@ak/wa/kapso";
import { alertOps, handleSubstitutionButton, processOpsTurn } from "./ops-turn";
import { OutboxUnavailable, type SendRequest, type SendResult } from "@ak/wa/gateway";
import { ModelUnavailable, withCapacityFallback, type CapacityOptions } from "@ak/agents/capacity";
import { ModelAccountRefused, withAccountAlarm } from "@ak/agents/model-account";
import { detectConsentSignal } from "@ak/core/optout";
import { extractOrder, runAskLoop, type CallTiming, type ModelClient, type Usage } from "@ak/agents/concierge";
import { answerQuick, answerWhen, askPinVillage, nameLost, settlePinVillage, basketWindowTap, choosePinVillage, completePending, explainNotSent, holdDraft, planReading, sendKept, takeAddress,
         routeBasket, waitingForPlace } from "@ak/agents/pipeline";
import { BASKET_CLEAR, BASKET_KEEP_MS, clearBasket } from "@ak/agents/basket";
import { parsePickButton, takePick } from "@ak/agents/choice";
import { parseCallButton, parseFoodButton, placeYes, takeCallAnswer, takeFoodTap } from "@ak/agents/food";
import { looksLikePhoneAttempt, parsePhone } from "@ak/agents/phone";
import { quickIntent } from "@ak/agents/quick-intent";
import { parseRepeatButton, rebuildStale, reopenLapsed, repeatLast } from "@ak/agents/answers";
import type { OrderIntent } from "@ak/agents/schemas";
import { catalogueReady, deliveryHours, makeConciergeTools, notePlanAreas, notePlanNames, type ConversationState, type ToolContext } from "@ak/agents/concierge-tools";
import { buttonReplyText, formatWindowChoice, KEPT_BUTTON, parseOrderButton, parsePinVillageButton, parseWindowButton, type DeliveryWindow } from "@ak/agents/order-card";
import { orderWindowTap, resendCard, schedules, whenOnly } from "@ak/agents/windows";
import { CARD_AGAIN, LINK_CODE, SIGN_OUT, webWords } from "@ak/agents/web-orders";
import { readVoiceNote, type SttProvider } from "@ak/agents/stt";
import { catalogOffer, catalogueAsked } from "@ak/agents/catalog-messages";
import { readPaymentProof, takePaymentProof } from "@ak/agents/payment-proof";
import { asLang, messages, REPLY_RULE, STAFF_LANG, villageName } from "@ak/agents/messages";
import { keepLanguage, langOfSpeech, replyLanguage, type Speech } from "@ak/agents/language";
import { answerMemory, handleMemoryButton, memoryCommand, offerToRemember } from "@ak/agents/memory";
import { factsAsked } from "@ak/agents/honest";
import { decideVoice } from "@ak/agents/voice";
import { parseFeedbackButton } from "@ak/agents/feedback";
import { takeCart, type CartOrder } from "@ak/agents/cart";
import { personSignal } from "@ak/agents/person-request";
import type { ClaimListingResult } from "@ak/commerce/index";
import { CASE_KEEP, CASE_VOICE, MENU_BROWSE, MENU_ORDER, MENU_PERSON, RETRY_PREFIX, openCase, parseCallbackButton, remindCase, retryButtonId,
         supportMessage, tellOpened, type OpenedCase } from "@ak/agents/support";
import { buttons as buttonMsg } from "@ak/wa/kapso";
import { applyChoice, cancelAsk, cancelRefusedText, cancelWords, confirmedWithChoices, parseChoiceButton, pickupWords, sendWelcome, switchToPickup,
         WELCOME_AREA, WELCOME_ORDER, type CancelTerms } from "@ak/agents/customer-pack";

interface SavedPin { place_id: string; village_id: string | null; village: string | null; village_ar?: string | null; served?: boolean | null;
  status: "located" | "unsure" | "outside"; said_village_id?: string | null; said_village_ar?: string | null;
  candidates?: { village_id: string; name_ar: string | null; name_en: string }[] }
export interface Pending { line: "customer" | "ops"; who: { waUserId?: string; phone?: string }; event: KapsoReceived }
export interface TurnDeps {
  db: SupabaseClient;
  /** SR1: query embeddings for search by meaning (the Worker's Workers AI binding). Absent: search runs on words alone. */
  embedder?: import("@ak/agents/embeddings").Embedder;
  model: ModelClient;
  modelName: string;
  send: (req: SendRequest) => Promise<SendResult>;      // packages/wa/src/gateway.ts send(), bound to env
  /** Set by runTurn. Outbound messages are keyed on it so a retried turn cannot send anything twice. */
  turnKey?: string;
  /** Model-capacity retry timing (1.15). Tests shorten it; production uses the defaults. */
  capacity?: Pick<CapacityOptions, "backoffMs" | "sleep">;
  /** Called once a customer's tap has confirmed an order (COD) so a rider can be offered the job. */
  onOrderConfirmed?: (orderId: string) => Promise<unknown>;
  /** Rider-side events the customer should hear about ("on the way", "rider is at your door"). */
  notifyCustomer?: (deliveryOrOrderId: string, what: "on_the_way" | "rider_waiting") => Promise<unknown>;
  /** Fetches inbound media from Kapso's media URL (1.6). Defaults to fetch(); pass one that adds Kapso's key if its URLs need it. */
  fetchMedia?: (url: string) => Promise<Response>;
  /**
   * WhatsApp's typing indicator on the message being answered (1.8): the gateway marks it read with a typing indicator, which
   * WhatsApp shows until the reply or for 25 seconds. Called once a turn needs the model. Optional: until the gateway has it
   * (packages/wa, lane A), nothing is shown. Never sends a message and never blocks the turn.
   */
  typing?: (waMessageId: string) => Promise<unknown>;
  /** TEST1: the friends' test mode may apply (the Worker's ENVIRONMENT is staging). The database still decides whether it is on. */
  testMode?: boolean;
  /** Our own speech-to-text (VOICE1: ElevenLabs Scribe), passed by the worker only when its key is configured. settings.stt decides use. */
  stt?: SttProvider;
}
/**
 * HO1: "case" a case opened and the customer was told; "paused" a person claimed the chat and the bot stepped back (a person
 * answers; the 2-minute alarm watches); "menu" the hourly cap's fixed menu; "technical" the fixed technical line after the
 * turn was queued again once. Nothing locks a chat: "human" and "agent_handoff" are no longer produced.
 */
export interface TurnResult { outcome: "ignored" | "buttons" | "opt_out" | "opt_in" | "audio_unusable" | "paused" | "agent_ok" | "case" | "menu" | "technical" | "card" | "answered" | "rider" | "duplicate" | "error" | "claim"; sent: string[] }

/** HO1: the model was unavailable or the turn failed before anything was sent. The turn is queued again once, after `ms`. */
export class RetryTurnLater extends Error {
  constructor(public readonly ms: number, cause: unknown) { super(`RETRY_TURN_LATER ${String(cause).slice(0, 200)}`); this.name = "RetryTurnLater"; }
}
export const TECHNICAL_RETRY_MS = 60_000;

const HISTORY_MAX = 8;
/** How long after "edit" on a confirmed scheduled order the next basket is still its change (W1). The cut-off may end it sooner. */
const CHANGE_OPEN_MS = 2 * 3600_000;

/** What open_turn() returns (0100): begin_turn, touch_conversation, the first contact and the stored messages, in one call. */
export interface OpenedTurn {
  turn: "run" | "retry" | "done" | "give_up";
  known?: boolean; party_id: string; conversation_id: string; human_handoff?: boolean; blocked?: boolean;
  /** HO1 (0135): a person claimed or answered within settings.support.pause_min: the model stays out until then. */
  bot_paused?: boolean;
  /** HO1 (0135): the conversation's open cases. */
  cases?: { case_id: string; kind: string; topic: string | null; state: string }[];
  /** CX1 (0143): this is the customer's first message ever and the welcome is on (claim_welcome decides, and records it). */
  welcome_due?: boolean;
  budget?: { allowed: boolean; used: number; limit: number } | null;
  customer_context?: unknown;
}

/** The one database call before the model on the customer line (SP1). Same work, same order as the four calls it replaced. */
export async function openTurn(db: SupabaseClient, key: string, pending: Pending[]): Promise<OpenedTurn> {
  const first = pending[0]!;
  const head = first.event.message as typeof first.event.message & { referral?: unknown };
  return call<OpenedTurn>(db, "open_turn", {
    p_key: key, p_line: first.line, p_wa_user_id: first.who.waUserId ?? null, p_phone: first.who.phone ?? null,
    p_name: first.event.conversation.contact_name ?? null,
    p_messages: pending.map((p, i) => ({
      wa_message_id: p.event.message.id, type: p.event.message.type,
      body: p.event.message.text?.body ?? p.event.message.interactive?.button_reply?.id ?? p.event.message.interactive?.list_reply?.id ?? templatePayload(p.event.message) ?? null,
      transcript: p.event.message.kapso.transcript ? { kapso: p.event.message.kapso.transcript.text } : null,
      // Where a new customer came from (1.13): read from the first message only, as before.
      ...(i === 0 ? { body_text: head.text?.body ?? null, referral: head.referral ?? null } : {}),
    })),
  });
}

export async function processTurn(deps: TurnDeps, pending: Pending[], state: ConversationState, opened?: OpenedTurn): Promise<TurnResult> {
  const first = pending[0];
  if (!first) return { outcome: "ignored", sent: [] };
  if (first.line !== "customer") return processOpsTurn(deps, pending);          // riders today; merchants and staff in step 7

  const { db } = deps;
  const to = first.who.phone ?? first.who.waUserId!;
  if (!deps.turnKey) throw new Error("NO_TURN_KEY: processTurn must be called through runTurn");
  const turnKey = deps.turnKey;
  // begin_turn, touch_conversation, record_first_contact and the wa_messages insert, in one round trip (0100).
  const conv = opened ?? await openTurn(db, turnKey, pending);
  if (conv.turn === "done" || conv.turn === "give_up") return { outcome: "duplicate", sent: [] };
  if (!conv.known || conv.blocked) return { outcome: "ignored", sent: [] };

  const sent: string[] = [];
  // M1: every fixed message in the conversation's language (state.lang: the last reading's, or the words of a turn code answers).
  const T = () => messages(state.lang);
  // W1: an "edit" tap answered long ago no longer turns the next basket into a change of that order: a new order is a new order.
  if (state.replacing && Date.now() - (state.replacing.since ?? 0) > CHANGE_OPEN_MS) state.replacing = null;
  // B1a: a basket nobody touched for BASKET_KEEP_MS is let go (one kept overnight for the opening stays until it is taken up); a basket
  // in hand counts from the customer's last message.
  if (state.lastQuote && state.awaiting !== "opening" && state.basketAt && Date.now() - state.basketAt > BASKET_KEEP_MS) {
    state.lastQuote = null; state.pending = null; state.awaiting = null; state.slotId = null; state.basketAt = null; state.editing = null;
  }
  if (state.lastQuote) state.basketAt = Date.now();
  // G1-19 (SP1): a message's key is the turn plus what it says, not its place in the turn. A retried turn whose model words or
  // orders its messages differently sends what is new and skips what already went; before, a message that took another's
  // place was dropped. The same words twice in one turn are told apart by their count.
  const keyCount = new Map<string, number>();
  const sendRaw = async (msg: Outbound, orderId?: string, authored?: SendRequest["authored"], fallback?: SendRequest["fallback"]): Promise<SendResult> => {
    const h = await contentHash(msg);
    const n = keyCount.get(h) ?? 0;
    keyCount.set(h, n + 1);
    return deps.send({ line: "customer", partyId: conv.party_id, to, msg, category: "service", orderId,
                       dedupeKey: replyKey(turnKey, h, n), ...(authored ? { authored } : {}), ...(fallback ? { fallback } : {}) });
  };
  const say = async (text: string, orderId?: string) => { const r = await sendRaw({ type: "text", text: { body: text } }, orderId); if (r.ok) sent.push(text); return r; };
  // The model, with the capacity fallback around it: one fixed "one moment" on the first failure (keyed so a retried turn
  // never sends it twice), retries with backoff, then ModelUnavailable.
  // OPS1 (0140): inside the capacity wrapper, so the first thing to see a provider error is the one that knows an account refusal
  // (usage limit, billing, key) from a bug of ours. It raises the high-priority model_account exception; a limit is not retried.
  const model = withCapacityFallback(withAccountAlarm(deps.model, accountReport(db)), { ...deps.capacity, onFirstFailure: async () => {
    const r = await deps.send({ line: "customer", partyId: conv.party_id, to, msg: { type: "text", text: { body: T().fixed.oneMoment } },
                                category: "service", dedupeKey: `${turnKey}:wait` });
    if (r.ok) sent.push(T().fixed.oneMoment);
  } });

  const ctx: ToolContext = {
    db, partyId: conv.party_id, conversationId: conv.conversation_id, state, turnKey,
    send: (msg, opts) => sendRaw(msg, opts?.orderId, opts?.authored, opts?.fallback), sent: { count: 0, texts: [] },
    openCaseIds: (conv.cases ?? []).map((c) => c.case_id),
    ...(deps.embedder ? { embedder: deps.embedder } : {}),
  };
  const texts: string[] = [];
  const turnIds = pending.map((p) => p.event.message.id);
  const transcripts: { primary: string; secondary?: string }[] = [];
  // B1b (SIM1 fix 6): the customer's language is kept for the conversation, learnt from their own words only (language.ts). A tapped
  // button's title is ours (often an English product name) and is evidence only when nothing else is known yet.
  const tapTitles: string[] = [];
  const ownTexts: string[] = [];
  const learnLang = (own: string[], reading?: string | null) => {
    const prev = state.speech ?? (state.lang ? (state.lang as Speech) : undefined);
    state.speech = keepLanguage(prev, { reading: reading ?? null, own, taps: tapTitles }) ?? state.speech;
    state.lang = langOfSpeech(state.speech) ?? state.lang;
  };
  let buttonsHandled = 0, audioFailed = 0, voiceSecondsThisTurn = 0, pins = 0, phoneSaved = false, personAsked = false, chased = false, claimed = false;
  const openCases = conv.cases ?? [];

  // TEST1 (test mode, staging only: deps.testMode is set only when the Worker's ENVIRONMENT is staging, and the database answers "on"
  // only when it is marked as staging). A number not on the tester list gets one short "we're not open yet" in its language, before any
  // model, with no price and no menu. STOP and START still win (invariant 6); nothing is dropped in silence (invariant 18).
  let tester = false;
  if (deps.testMode) {
    const gate = await call<{ on: boolean; allowed: boolean; tester?: boolean }>(db, "test_mode_gate", { p_party: conv.party_id });
    tester = !!gate.on && !!gate.tester;
    if (!gate.allowed) {
      for (const p of pending) {
        const m = p.event.message;
        if (m.type !== "text") continue;
        const body = m.text?.body ?? "";
        if (body) learnLang([body]);
        const signal = detectConsentSignal(body);
        if (signal === "opt_out") {
          await say(T().fixed.optOut);
          await call(db, "record_consent_signal", { p_party: conv.party_id, p_line: "customer", p_action: "opt_out", p_source: "stop_keyword", p_wamid: m.id });
          return { outcome: "opt_out", sent };
        }
        if (signal === "opt_in") {
          await call(db, "record_consent_signal", { p_party: conv.party_id, p_line: "customer", p_action: "opt_in", p_source: "start_keyword", p_wamid: m.id });
          await say(T().fixed.optIn);
          return { outcome: "opt_in", sent };
        }
      }
      await say(T().testMode.notOpen);
      return { outcome: "answered", sent };
    }
  }

  // HO1: a tap whose handler failed is a technical failure, not a hand-off: the error line with a button that repeats the tap,
  // and an ops exception carrying the error. The bot stays in the chat.
  const tapFailed = async (tap: string, where: string, err: unknown, orderId?: string) => {
    await db.rpc("raise_ops_exception", { p_kind: "technical", p_ref: `${turnKey}:${where}`,
      p_detail: { conversation_id: conv.conversation_id, where, error: String(err).slice(0, 300) } });
    const r = await sendRaw(buttonMsg(T().support.buttonError, [{ id: retryButtonId(tap), title: T().support.retryButton }]), orderId);
    if (r.ok) sent.push(T().support.buttonError);
  };
  /** A case just opened: the opened line. Already open: the reminder (asked again for a person, the customer is never ignored). */
  const sayCase = async (c: OpenedCase) => {
    if (c.opened) { await tellOpened(ctx, c); return; }
    if (await remindCase(ctx, c.case_id)) return;
    if ((await sendRaw({ type: "text", text: { body: T().support.reminder } })).ok) ctx.sent.texts.push(T().support.reminder);
  };
  /** CX1: Cancel (tapped, or said) once picking started or the order left: the exact refundable amount, and a case for a person. */
  const cancelTooLate = async (t: CancelTerms): Promise<boolean> => {
    const text = cancelRefusedText(t, state.lang);
    if (!text) return false;
    await openCase(ctx, "order_problem", `cancel_refused: ${t.short_code} (${t.reason}, refundable ${t.refundable_usd})`, { orderId: t.order_id, source: "code" });
    await say(text, t.order_id);
    return true;
  };
  /** B1a (SIM1 fix 9): Cancel tapped on an order the database will not cancel now. A fixed line and a case for a person. */
  const cancelRefused = async (orderId: string) => {
    const b = await call<{ found: boolean; short_code?: string; status?: string }>(db, "basket_from_order", { p_party: conv.party_id, p_order: orderId });
    const code = b.short_code ?? "";
    if (b.status === "cancelled") { await say(buttonReplyText({ status: "cancelled", short_code: code, changed: false }, {}, state.lang), orderId); return; }
    await openCase(ctx, "order_problem", `cancel_refused: ${code} (${b.status ?? "?"})`, { orderId, source: "code" });
    await say(T().basket.cancelRefused(code), orderId);
  };
  /** The case and menu buttons (support.ts). True when the tap was one of them. */
  const supportTap = async (tap: string): Promise<boolean> => {
    const s = T().support;
    const cb = parseCallbackButton(tap);
    if (cb) {
      const r = await call<{ ok: boolean }>(db, "request_callback", { p_case: cb, p_party: conv.party_id });
      await ctx.send({ type: "text", text: { body: r.ok ? s.callbackNoted : s.keepOrdering } }).then((x) => { if (x.ok) ctx.sent.texts.push(r.ok ? s.callbackNoted : s.keepOrdering); });
      return true;
    }
    if (tap === CASE_KEEP || tap === CASE_VOICE) {
      const body = tap === CASE_KEEP ? s.keepOrdering : s.voiceNoteAsk;
      if ((await ctx.send({ type: "text", text: { body } })).ok) ctx.sent.texts.push(body);
      return true;
    }
    if (tap === MENU_PERSON) {
      await sayCase(await openCase(ctx, "person_requested", "asked by button", { source: "button" }));
      return true;
    }
    if (tap === MENU_ORDER) {
      if (!(await answerQuick(ctx, "status")).done && (await ctx.send({ type: "text", text: { body: T().answer.noOpenOrder } })).ok) ctx.sent.texts.push(T().answer.noOpenOrder);
      return true;
    }
    if (tap === MENU_BROWSE) {
      const r = await makeConciergeTools(ctx).show_catalog({}) as { ok?: boolean };
      if (r?.ok === false && (await ctx.send({ type: "text", text: { body: s.browseInWords } })).ok) ctx.sent.texts.push(s.browseInWords);
      return true;
    }
    return false;
  };

  let welcome: string | null = null;

  for (const p of pending) {
    const m = p.event.message;

    // 1. Buttons never reach the model. A list row (W1: a delivery window) is a tap too, and so is a template's quick reply (M1:
    //    a code-started message sent after 24 hours carries the same button ids as payloads).
    let tapped = m.type === "interactive" ? (m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id) : m.type === "button" ? templatePayload(m) : undefined;
    // HO1: "try again" under the error line repeats the tap that failed.
    if (tapped?.startsWith(RETRY_PREFIX)) tapped = tapped.slice(RETRY_PREFIX.length);
    if (tapped) {
      const btn = parseOrderButton(tapped);
      if (btn) {
        buttonsHandled++;
        try {
          // CFG1: the "reopen" button under the lapsed-order notice. No database tap exists for it: reopenLapsed asks reopen_check.
          if (btn.action === "reopen") {
            const re = await reopenLapsed(ctx, btn.orderId);
            if (!re.done) await say(buttonReplyText({ status: "cancelled", short_code: re.short_code ?? "", changed: false }, {}, state.lang), btn.orderId);
            continue;
          }
          const r = await call<{ status: string; short_code: string; changed: boolean; payment_method?: string; total_usd?: number;
                                 window?: DeliveryWindow | null; windows?: DeliveryWindow[] }>(
            db, btn.action === "confirm" ? "confirm_order_checked" : "handle_order_button",
            btn.action === "confirm" ? { p_order: btn.orderId, p_party: conv.party_id, p_wamid: m.id }
                                     : { p_order: btn.orderId, p_action: btn.action, p_party: conv.party_id, p_wamid: m.id });
          if (r.status === "stale_quote") {
            // Prices or stock moved since the card. The same lines, re-priced now, with anything gone named first. No model.
            state.lastQuote = null;
            if (!(await rebuildStale(ctx, btn.orderId)).done) await say(T().fixed.outOfStock, btn.orderId);
            continue;
          }
          if (r.status === "needs_location") { await sendRaw(askLocation(T().tap.needsLocation), btn.orderId); continue; }
          // CFG1: Confirm or Edit on a card the timer cancelled (nobody tapped in time) opens it again as a new order from the same
          // basket, at today's prices; the old one stays cancelled. Anything else cancelled is final and gets the cancelled line below.
          if (r.status === "cancelled" && btn.action !== "cancel" && (await reopenLapsed(ctx, btn.orderId)).done) continue;
          // CX1: Cancel once picking started (or the order left): nothing is cancelled; the exact refundable amount and a person.
          if (r.status === "too_late" && await cancelTooLate({ ...(r as unknown as CancelTerms), order_id: btn.orderId })) continue;
          const reply = buttonReplyText(r, {}, state.lang);
          if (btn.action === "confirm" && r.changed && (r.status === "confirmed" || r.status === "awaiting_payment")) {
            // CX1: the confirmation carries the card's two choices (a missing item, the note) and Cancel, as one list; a prepaid
            // order's handover code is under the words. Still one message.
            const msg = await confirmedWithChoices(ctx, reply, { orderId: btn.orderId, status: r.status, payment_method: r.payment_method,
                                                               total_usd: r.total_usd, handover_code: (r as { handover_code?: string | null }).handover_code ?? null });
            if ((await sendRaw(msg, btn.orderId)).ok) sent.push(reply);
          } else await say(reply, btn.orderId);
          // W1 (C3's request 3): the window filled or closed before the tap. The order is a draft again; the open windows follow.
          if ((r.status === "slot_full" || r.status === "slot_closed") && r.windows?.length)
            await sendRaw(formatWindowChoice(btn.orderId, r.windows, { body: T().windows.choose, lang: state.lang }), btn.orderId);
          // W1 (C3's request 4): "edit" on a confirmed scheduled order before its cut-off. The next basket is a new card that
          // replaces it (link_replacement_order); nothing changes until that card is confirmed.
          if (r.status === "change_open") state.replacing = { orderId: btn.orderId, shortCode: r.short_code, slotId: r.window?.slot_id ?? null, since: Date.now() };
          // Finding a rider must never turn a confirmed order into an error message. If it fails here, the cron retries every minute.
          if (r.changed && r.status === "confirmed") await deps.onOrderConfirmed?.(btn.orderId).catch(() => undefined);
          // B1a: "edit" on a card waiting for the tap sends it back to a draft. Its lines stay in hand as the basket being changed, so
          // the next words edit it and "where is my order?" brings it back as a card (the second B1a run: sim-079, sim-146 heard
          // «no open order», and the model claimed changes it never made). A draft from a full window keeps its own path (W1).
          if (r.status === "draft") { state.lastQuote = null; if (btn.action === "edit") await holdDraft(ctx, btn.orderId).catch(() => undefined); }
        } catch (err) {
          if (err instanceof OutboxUnavailable || (err as Error)?.name === "OutboxUnavailable") throw err;
          if (String(err).includes("OUT_OF_STOCK")) await say(T().fixed.outOfStock, btn.orderId);
          // B1a (SIM1 fix 9): a cancel the database refuses (the order is being prepared or is on its way) gets a fixed answer, and a
          // case for a person (its exception alerts ops). Never the error line with a "try again" that would fail the same way.
          else if (btn.action === "cancel" && /ILLEGAL_TRANSITION/.test(String(err))) await cancelRefused(btn.orderId);
          else await tapFailed(tapped, "button", err, btn.orderId);
        }
        continue;
      }
      // CX1: a row of the choices under the confirmation (a missing item, the note, the change kept as credit). Code answers.
      const choice = parseChoiceButton(tapped);
      if (choice) {
        buttonsHandled++;
        try { await say(await applyChoice(ctx, choice), choice.orderId); }
        catch (err) {
          if (err instanceof OutboxUnavailable || (err as Error)?.name === "OutboxUnavailable") throw err;
          await tapFailed(tapped, "choice", err, choice.orderId);
        }
        continue;
      }
      // CX1: the welcome's buttons (Browse is the menu's own, below).
      if (tapped === WELCOME_ORDER) { buttonsHandled++; await say(T().cx.orderAsk); continue; }
      if (tapped === WELCOME_AREA) { buttonsHandled++; if ((await sendRaw(askLocation(T().cx.areaAsk))).ok) sent.push(T().cx.areaAsk); continue; }
      // A delivery window chosen from a list (W1, C3's request 2): for the card it was offered under, or for the basket in hand.
      const win = parseWindowButton(tapped);
      if (win) {
        buttonsHandled++;
        try {
          const before = ctx.sent.count;
          if (win.orderId) await orderWindowTap(ctx, win.slotId, win.orderId);
          else await basketWindowTap(ctx, win.slotId);
          // B1a (SIM1's two no-reply turns): a basket that could not go for the window always gets an answer: the minimum, what ran
          // out, or the fixed question.
          if (ctx.sent.count === before && !win.orderId) await explainNotSent(ctx);
        } catch (err) {
          if (err instanceof OutboxUnavailable || (err as Error)?.name === "OutboxUnavailable") throw err;
          await tapFailed(tapped, "window", err, win.orderId ?? undefined);
        }
        sent.push(...ctx.sent.texts.splice(0));
        continue;
      }
      // B1a (SIM1 fix 1): "Cancel order" under the minimum line lets the basket go. Code answers; never the model.
      if (tapped === BASKET_CLEAR) {
        buttonsHandled++;
        try {
          await clearBasket(ctx);
        } catch (err) {
          if (err instanceof OutboxUnavailable || (err as Error)?.name === "OutboxUnavailable") throw err;
          await tapFailed(tapped, "basket", err);
        }
        sent.push(...ctx.sent.texts.splice(0));
        continue;
      }
      const repeatOf = parseRepeatButton(tapped);
      if (repeatOf) {
        // "Same as last time" (1.20): re-priced and re-checked by the database; repeat_plan refuses an order that is not theirs and closed.
        buttonsHandled++;
        await repeatLast(ctx, { orderId: repeatOf });
        continue;
      }
      const fb = parseFeedbackButton(tapped);
      if (fb) {
        // One tap after delivery (2.9). A problem goes to a person at once; a repeat tap does nothing.
        buttonsHandled++;
        const r = await call<{ ok: boolean; changed?: boolean; short_code?: string }>(db, "record_feedback",
          { p_order: fb.orderId, p_party: conv.party_id, p_verdict: fb.verdict });
        if (r.ok && r.changed && fb.verdict === "problem") {
          // HO1: a case of kind order_problem (its ops exception alerts staff); the bot stays in the chat.
          const c = await openCase(ctx, "order_problem", `delivery_problem: ${r.short_code ?? ""}`, { orderId: fb.orderId, source: "button" });
          if (c.after_hours) { await tellOpened(ctx, c, fb.orderId); sent.push(...ctx.sent.texts.splice(0)); }
          else await say(T().feedback.problem(r.short_code ?? ""), fb.orderId);
        } else if (r.ok && r.changed) await say(T().feedback.fine, fb.orderId);
        continue;
      }
      // Keep or remove a substitute the picker offered (C2, 2.2): the hub's code answers; never the model.
      if (tapped.startsWith("sub:")) {
        try { if (await handleSubstitutionButton(deps, conv.party_id, tapped, m.id, state.lang)) { buttonsHandled++; continue; } }
        catch (err) {
          if (err instanceof OutboxUnavailable || (err as Error)?.name === "OutboxUnavailable") throw err;
          buttonsHandled++; await tapFailed(tapped, "substitution", err); continue;
        }
      }
      // The village a pin is in, tapped when the pin alone was not clear (B4). The database checks it is near the pin.
      const pinVillage = parsePinVillageButton(tapped);
      if (pinVillage) {
        buttonsHandled++;
        if (!(await choosePinVillage(ctx, pinVillage))) {
          state.awaiting = state.lastQuote ? "pin" : null;
          await sendRaw(askLocation(T().fixed.pinVillageRefused));
        } else if (!(await completePending(ctx))) await say(T().fixed.pinSaved(villageName(state.lang ?? "ar", state.pinCheck?.villageAr, state.pinCheck?.villageEn)));
        sent.push(...ctx.sent.texts.splice(0));
        continue;
      }
      // «ابعت طلبي» under the closed-hours message (K1): the kept basket carries on, by code. Nothing kept, or a basket that cannot
      // go as it was (an item gone overnight): the Concierge reads the tap with the basket in hand.
      if (tapped === KEPT_BUTTON) {
        if (await sendKept(ctx)) { buttonsHandled++; sent.push(...ctx.sent.texts.splice(0)); continue; }
        if (!state.lastQuote) { buttonsHandled++; await say(T().fixed.keptGone); continue; }
        texts.push(T().fixed.keptButton);
        continue;
      }
      if (await handleMemoryButton(ctx, tapped)) { buttonsHandled++; continue; }     // forget / keep a restriction (1.14)
      // B1c: a product chosen from the question code asked («ربطة خبز»: which one?). Its line's count is kept; the basket goes on.
      // A button from a question no longer waiting is read as words, as the Concierge's own buttons are.
      const pick = parsePickButton(tapped);
      if (pick) {
        try {
          if ((await takePick(ctx, pick, routeBasket)).done) { buttonsHandled++; sent.push(...ctx.sent.texts.splice(0)); continue; }
        } catch (err) {
          if (err instanceof OutboxUnavailable || (err as Error)?.name === "OutboxUnavailable") throw err;
          buttonsHandled++; await tapFailed(tapped, "basket", err); continue;
        }
      }
      // FD2: a dish, an option or "no, thanks" from the food questions code asked (food.ts). An old button is read as words.
      const foodTap = parseFoodButton(tapped);
      if (foodTap) {
        try {
          if ((await takeFoodTap(ctx, foodTap, routeBasket)).done) { buttonsHandled++; sent.push(...ctx.sent.texts.splice(0)); continue; }
        } catch (err) {
          if (err instanceof OutboxUnavailable || (err as Error)?.name === "OutboxUnavailable") throw err;
          buttonsHandled++; await tapFailed(tapped, "basket", err); continue;
        }
      }
      // FD2: the customer's answer to what staff found when they called the place (keep the rest, accept a new price, or cancel). Code answers.
      const callAnswer = parseCallButton(tapped);
      if (callAnswer) {
        buttonsHandled++;
        try { await takeCallAnswer(ctx, callAnswer); sent.push(...ctx.sent.texts.splice(0)); }
        catch (err) {
          if (err instanceof OutboxUnavailable || (err as Error)?.name === "OutboxUnavailable") throw err;
          await tapFailed(tapped, "choice", err);
        }
        continue;
      }
      // HO1: the buttons of the case lines and of the fixed technical, cap and stalled lines. Code answers each; never the model.
      if (await supportTap(tapped)) { buttonsHandled++; sent.push(...ctx.sent.texts.splice(0)); continue; }
      if (tapped === "marketing:yes" || tapped === "marketing:no") {
        buttonsHandled++;
        await db.from("consent_events").insert({ party_id: conv.party_id, line: "customer", kind: "marketing",
          action: tapped === "marketing:yes" ? "opt_in" : "opt_out", source: "marketing_button", evidence_message_id: m.id });
        continue;
      }
      const title = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? tapped;
      texts.push(title);     // a button the Concierge itself offered
      if (title !== tapped) tapTitles.push(title);
      continue;
    }

    // 2. A location pin is data, not conversation. The pin decides the village (B4): on 13 Nov a pin in Khraibeh was saved as
    //    Baakline because the text had said Baakline. What the conversation believed before is passed only to be named.
    if (m.type === "location" && m.location) {
      const place = await call<SavedPin>(db, "save_customer_pin",
        { p_party: conv.party_id, p_lat: m.location.latitude, p_lng: m.location.longitude, p_village: state.villageId ?? null });
      const saidBefore = state.villageId ?? null;
      state.placeId = place.place_id;
      state.villageId = place.village_id ?? null;
      state.pinCheck = { status: place.status, villageAr: place.village_ar ?? null, villageEn: place.village ?? null, served: place.served ?? null, candidates: place.candidates ?? [],
                         saidAr: place.village_id && place.said_village_id && place.said_village_id !== place.village_id ? place.said_village_ar ?? null : null,
                         saidId: place.said_village_id ?? saidBefore };
      pins++;
      texts.push(`[location pin received, ${place.village ? `village: ${place.village}` : "village not clear: the customer is asked to choose"}]`);
      continue;
    }

    // 2b. A cart sent from the WhatsApp catalog (1.21): code turns it into the order card, as a typed order would be. The catalog
    //     never confirms; the customer taps Confirm on the card. When the cart needs a question, the Concierge gets it in words.
    if (m.type === "order") {
      const r = await takeCart(ctx, (m as typeof m & { order?: CartOrder }).order);
      if (r.done) { buttonsHandled++; sent.push(...ctx.sent.texts.splice(0)); continue; }
      texts.push(r.asText);
      continue;
    }

    // 3. STOP wins, before any model.
    if (m.type === "text") {
      const body = m.text?.body ?? "";
      // VOICE1: «ايه», "yes", «oui» typed to «قصدك …؟»: the button's yes, before any model.
      if (state.placeGuess && placeYes(body)) {
        const g = state.placeGuess;
        try { if ((await takeFoodTap(ctx, { kind: "place", sourceId: g.sourceId }, routeBasket)).done) { buttonsHandled++; sent.push(...ctx.sent.texts.splice(0)); continue; } }
        catch (err) {
          if (err instanceof OutboxUnavailable || (err as Error)?.name === "OutboxUnavailable") throw err;
          buttonsHandled++; await tapFailed(`fplace:${g.sourceId}`, "basket", err); continue;
        }
      }
      // LV1: "Claim <listing_id>" is a code we typed for the owner, not the customer's own words: it says nothing of their language.
      const claimShaped = /^\s*claim\s+\S+\s*$/i.test(body);
      // WEB2: the website's sign-in code and "Card AK-xxxx" are typed by the website too: only the words around a code are the customer's.
      const linkCode = body.length <= 80 ? LINK_CODE.exec(body) : null;
      const cardAgain = CARD_AGAIN.exec(webWords(body));
      const own = linkCode ? body.replace(linkCode[0], " ").trim() : body;
      if (!claimShaped && !cardAgain && own) learnLang([own]);
      const signal = detectConsentSignal(body);
      if (signal === "opt_out") {
        await say(T().fixed.optOut);                                    // the one permitted confirmation, sent before the gate closes
        await call(db, "record_consent_signal", { p_party: conv.party_id, p_line: "customer", p_action: "opt_out", p_source: "stop_keyword", p_wamid: m.id });
        return { outcome: "opt_out", sent };
      }
      if (signal === "opt_in") {
        await call(db, "record_consent_signal", { p_party: conv.party_id, p_line: "customer", p_action: "opt_in", p_source: "start_keyword", p_wamid: m.id });
        await say(T().fixed.optIn);
        return { outcome: "opt_in", sent };
      }
      // LV1: "Claim <listing_id>", typed for the owner by the website's button. Read by code, before any model: a staff case with the listing and the sender, and one
      // fixed line that we will be in touch. Only the exact words and a listing we know are a claim; anything else (a word or two after "Claim") goes on as a message.
      // Nothing is sent to anyone else, nothing about the listing changes, and nothing can be ordered from it.
      if (claimShaped) {
        const claim = await call<ClaimListingResult>(db, "claim_listing", { p_party: conv.party_id, p_conversation: conv.conversation_id, p_text: body, p_wamid: m.id });
        if (claim.ok) { await say(T().fixed.listingClaimed(claim.name)); claimed = true; continue; }
        learnLang([body]);                          // not a claim after all: ordinary words
      }
      // WEB2: "Confirm your number on WhatsApp" on the website opens this chat with its code typed. Read by code, before any model: the
      // message proves the number, links the website's session and records consent (claim_link_code, 0129); one fixed line answers.
      if (linkCode) {
        const link = await call<{ ok: boolean; status: string }>(db, "claim_link_code", { p_party: conv.party_id, p_code: body, p_wamid: m.id });
        const W = T().web;
        const line = link.ok ? W.linked : link.status === "expired" ? W.codeExpired : link.status === "used" ? W.codeUsed : link.status === "unknown" ? W.codeUnknown : null;
        if (line) { await say(line); claimed = true; continue; }
      }
      // WEB2: "Sign out" on WhatsApp ends every website session of this number (docs/WEBSITE.md, "Identity and consent", step 3).
      if (SIGN_OUT.test(webWords(body))) {
        const ended = await call<number>(db, "web_sessions_revoke", { p_party: conv.party_id, p_reason: "sign_out_whatsapp" });
        await say(ended > 0 ? T().web.signedOut(ended) : T().web.notSignedIn);
        claimed = true; continue;
      }
      // WEB2: "Card AK-xxxx", typed by the order page's button: the card of the sender's own order that still waits, sent again. It never
      // confirms anything; only the card's Confirm button does (invariant 4).
      if (cardAgain) {
        const again = await call<{ ok: boolean; status?: string; order_id?: string; short_code?: string; lang?: string | null; claimed?: boolean }>(
          db, "web_card_again", { p_party: conv.party_id, p_code: cardAgain[1] });
        // CX2 (AK-1063): one card, in the page's language; a request the cron had not sent yet is now this one (0255).
        if (again.ok && again.order_id) {
          const ok = await resendCard(ctx, again.order_id, again.lang ? asLang(again.lang) : null);
          if (again.claimed) await call(db, "web_card_done", { p_order: again.order_id, p_outcome: ok ? "sent:card_again" : "refused:card_again" });
          if (ok) { sent.push(...ctx.sent.texts.splice(0)); claimed = true; continue; }
        }
        await say(again.status === "not_waiting" ? T().web.cardNotWaiting(again.short_code ?? cardAgain[1]!.toUpperCase()) : T().web.cardUnknown);
        claimed = true; continue;
      }
      // The number a rider can call, when we have just asked for it (1.19). Read only then, so a quantity is never taken for a phone.
      if (state.awaiting === "phone") {
        const phone = parsePhone(body);
        if (phone) {
          await call(db, "set_contact_phone", { p_party: conv.party_id, p_phone: phone });
          phoneSaved = true;
          if (looksLikePhoneAttempt(body)) continue;                // just the number: nothing else to read
        } else if (looksLikePhoneAttempt(body)) { await say(T().fixed.badPhone); buttonsHandled++; continue; }
      }
      // HO1: "I want a person" in any of the four ways of writing, before any model.
      const sig = personSignal(body);
      if (sig === "person") personAsked = true; else if (sig === "chase") chased = true;
      texts.push(body); ownTexts.push(body);
      continue;
    }

    // 4. Voice: the policy, then the transcripts (VOICE1: ours first with keyterms, Kapso's as the fallback), then mechanical checks.
    if (m.type === "audio") {
      // Policy first (1.17): the role's limit and the sender's hourly budget from settings.voice_limits, across turns. A note
      // over a limit is answered politely and not read. Nothing is dropped in silence.
      const policy = await decideVoice({ db, partyId: conv.party_id, line: "customer", role: "customer" }, m, voiceSecondsThisTurn, turnIds);
      if (policy.reply) { await say(policy.reply); buttonsHandled++; continue; }
      const seconds = policy.seconds;
      voiceSecondsThisTurn += seconds;
      // VOICE1: Scribe's transcript, biased by keyterms (the places, their other names, item words, villages, brands: stt_context), when
      // its key exists and settings.stt names it primary; Kapso's is the fallback. judge() decides; the provider and cost are recorded.
      const { verdict } = await readVoiceNote({ db, fetchMedia: deps.fetchMedia, stt: deps.stt }, conv.party_id, m, seconds);
      if (verdict.usable) {
        transcripts.push({ primary: verdict.primary.text, ...(verdict.secondary ? { secondary: verdict.secondary.text } : {}) });
        learnLang([verdict.primary.text]);
        const sig = personSignal(verdict.primary.text);
        if (sig === "person") personAsked = true; else if (sig === "chase") chased = true;
      }
      else audioFailed++;
      continue;
    }

    // 5. A picture while an order waits for a transfer is the receipt (1.6): stored privately, queued for a person, no model reply.
    if (m.type === "image") {
      const proof = await takePaymentProof({ db, fetchMedia: deps.fetchMedia }, conv.party_id, m);
      if (proof.kind === "stored") {
        buttonsHandled++;
        await say(T().payment.proofReceived(proof.shortCode), proof.orderId);
        await alertOps(deps, messages(STAFF_LANG).ops.proofAlert(proof.method === "omt" ? "OMT" : "Whish", proof.shortCode, proof.totalUsd, proof.reusedImage), `proof:${proof.proofId}`);
        // The optional read pre-fills amount and reference for the person who confirms. It never confirms anything.
        if (!proof.already && (await db.rpc("setting", { p_key: "payment_proofs" })).data?.model_read !== false) {
          const reading = await readPaymentProof(deps.model, deps.modelName, proof.bytes, proof.mime);
          if (reading) await db.rpc("record_proof_reading", { p_proof: proof.proofId, p_extracted: reading });
        }
        continue;
      }
      if (proof.kind === "unreadable") { buttonsHandled++; await say(T().payment.proofResend); continue; }
      texts.push(`[image received${m.image?.caption ? `: ${m.image.caption}` : ""}]`);
      continue;
    }
  }

  // CX1: the first-ever welcome, before the answer to the customer's words. Sent once the turn's messages are read, so it is in the
  // language of what they said or spoke (sim-test 43772497024: a first English voice note got it in Arabic when it went before the
  // note was read). STOP and START returned above, so a first message that is either gets none. Asked of the database once per
  // conversation (open_turn's welcome_due); claim_welcome records it.
  if (!state.welcomed && !claimed) {                // a claim (or WEB2's code, sign out, card) is answered by its own line; the welcome comes with the next message
    if (conv.welcome_due) {
      welcome = await sendWelcome(ctx, turnIds);
      if (welcome) sent.push(welcome);
    }
    state.welcomed = true;
  }
  // VOICE1: WhatsApp's own "View catalog" button (Meta shows no cart icon in the header for our numbers): with the welcome, and in the
  // friends' test with a tester's first reply. Once per conversation; only when the catalogue is connected; never for a tap alone.
  let catalogSent = false;
  if (!state.catalogOffered && !claimed && (welcome || tester) && (texts.length > 0 || transcripts.length > 0)) {
    const offer = await catalogOffer(db, state.lang).catch(() => null);
    if (offer && (await sendRaw(offer.msg, undefined, undefined, offer.fallback)).ok) { sent.push(offer.text); state.catalogOffered = true; catalogSent = true; }
  }

  if (texts.length === 0 && transcripts.length === 0 && !phoneSaved) {
    if (audioFailed > 0) { await say(T().fixed.audioUnusable); return { outcome: "audio_unusable", sent }; }
    return { outcome: claimed ? "claim" : buttonsHandled ? "buttons" : "ignored", sent };
  }
  // CX1: a first message that only says hello is answered by the welcome itself.
  if (welcome && transcripts.length === 0 && pins === 0 && texts.length > 0
      && texts.every((t) => { const q = quickIntent(t); return q === "greeting" || q === "small_talk"; })) return { outcome: "answered", sent };
  // HO1: a person claimed or answered this chat within settings.support.pause_min: the bot steps back until then. Buttons,
  // pins, STOP and payments were handled above. The 2-minute alarm (customer_unanswered) watches that the person answers.
  if (conv.bot_paused) return { outcome: "paused", sent };
  // HO1: "I want a person", recognised by code before any model: a case, the customer told, and the bot keeps answering.
  if (personAsked) {
    const c = await openCase(ctx, "person_requested", [...texts, ...transcripts.map((t) => t.primary)].join(" / ").slice(0, 300), { source: "customer_words" });
    await sayCase(c);
    sent.push(...ctx.sent.texts.splice(0));
    await db.from("agent_runs").insert({ agent: "concierge", conversation_id: conv.conversation_id, model: deps.modelName, input_tokens: 0, output_tokens: 0,
      latency_ms: 0, outcome: "ok", trace: { path: c.opened ? "person_requested" : "case_reminder", sent } });
    return { outcome: c.opened ? "case" : "answered", sent };
  }
  // A customer asking after the open request: the short "your request is open", at most every topic_reminder_min. Otherwise the
  // Concierge answers, knowing the request is open.
  if (chased && openCases.length && texts.length + transcripts.length === 1) {
    if (await remindCase(ctx, openCases[0]!.case_id)) { sent.push(...ctx.sent.texts.splice(0)); return { outcome: "answered", sent }; }
  }
  // Only a pin or a phone number arrived: the data a waiting card needed, nothing to read.
  const dataOnly = (pins > 0 || phoneSaved) && texts.length === pins && transcripts.length === 0;

  const remember = () => {
    sent.push(...ctx.sent.texts);
    state.history = [...(state.history ?? []),
      { role: "customer" as const, text: [...texts, ...transcripts.map((t) => t.primary)].join(" / ").slice(0, 600) },
      ...ctx.sent.texts.map((t) => ({ role: "assistant" as const, text: t.slice(0, 600) })),
    ].slice(-HISTORY_MAX);
  };
  const started = Date.now();
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: [] as CallTiming[] };
  const add = (u: Usage) => {
    usage.input += u.input; usage.output += u.output; usage.cacheRead += u.cacheRead ?? 0; usage.cacheWrite += u.cacheWrite ?? 0;
    usage.calls.push(...(u.calls ?? []));
  };
  let intent: OrderIntent | null = null;
  // SP1: each model call's time and tokens (agent_latency can split a turn), and the cached input, which input_tokens leaves
  // out (agent_run_costs prices it, 0102).
  const record = (outcome: string, path: string) => db.from("agent_runs").insert({ agent: "concierge", conversation_id: conv.conversation_id,
    model: deps.modelName, input_tokens: usage.input, output_tokens: usage.output, latency_ms: Date.now() - started, outcome,
    trace: { path, intent, sent: ctx.sent.texts, calls: usage.calls,
             cache_read_input_tokens: usage.cacheRead, cache_creation_input_tokens: usage.cacheWrite } });
  try {
    // A pin or a number for a card that was only waiting on it: the card goes out, no model.
    if (dataOnly) {
      const waited = state.awaiting;
      if (await completePending(ctx)) {
        remember(); await record("ok", state.awaiting === "phone" ? `ask_phone_after_${waited}` : `card_after_${waited}`);
        return { outcome: "card", sent };
      }
      if (texts.length === 0) { await say(T().fixed.phoneSaved); remember(); return { outcome: "answered", sent }; }
      // A pin with no basket waiting, that no village clearly owns: the customer chooses by tap, never the model.
      if (pins > 0 && !state.villageId && await settlePinVillage(ctx)) {
        // B1b: the village the customer already named, when the pin is near it: no question.
        await say(T().fixed.pinSaved(villageName(state.lang ?? "ar", state.pinCheck?.villageAr, state.pinCheck?.villageEn)));
        remember(); await record("ok", "pin_village_said"); return { outcome: "answered", sent };
      }
      if (pins > 0 && !state.villageId && await askPinVillage(ctx)) { remember(); await record("ok", "ask_pin_village"); return { outcome: "answered", sent }; }
    }

    // CX1: "cancel my order" said on its own, about a confirmed order: what a cancel gives back and a button that cancels; once
    // picking started, the exact refundable amount and a person. A card still waiting for its tap keeps the usual path.
    const one = texts.length === 1 && transcripts.length === 0 && pins === 0 ? texts[0]! : null;
    // VOICE1: «بدي شوف الكتالوج», "show me the catalogue", «le catalogue»: the catalogue by code, no model (said twice in one turn, once).
    if (one && catalogueAsked(one)) {
      // CAT2: never silent. The catalogue (or, refused, its link) counts as sent; if nothing at all went out, the words to type.
      if (!catalogSent) await makeConciergeTools(ctx).show_catalog({});
      if (sent.length === 0 && ctx.sent.texts.length === 0 && (await sendRaw({ type: "text", text: { body: T().support.browseInWords } })).ok) ctx.sent.texts.push(T().support.browseInWords);
      remember(); await record("ok", "catalog_words"); return { outcome: "answered", sent };
    }
    if (one && cancelWords(one)) {
      const s = await call<{ order_id?: string; status?: string } | null>(db, "order_status_for", { p_party: conv.party_id });
      if (s?.order_id && s.status !== "awaiting_confirmation") {
        const t = await call<CancelTerms>(db, "cancel_terms", { p_order: s.order_id });
        if (t.cancellable) { if ((await sendRaw(cancelAsk(t, state.lang), t.order_id)).ok) ctx.sent.texts.push(T().cx.cancelAsk(t.short_code, Number(t.paid_usd))); }
        else if (!(await cancelTooLate(t))) await say(buttonReplyText({ status: "too_late", short_code: t.short_code, changed: false }, {}, state.lang), t.order_id);
        remember(); await record("ok", "cancel_words"); return { outcome: "answered", sent };
      }
    }
    // CX1: "I'll pick it up": the basket in hand (or the card waiting for its tap) goes on as a pickup at the hub, no delivery fee.
    if (one && pickupWords(one)) {
      const r = await switchToPickup(ctx);
      if (r.done) { remember(); await record("ok", r.path); return { outcome: r.path.includes("card") ? "card" : "answered", sent }; }
    }
    // A time said on its own («بكرا الصبح», "jumaa ba3d el dohr") while a card, a basket or a change is in hand (W1): code reads it
    // (evals/cases/delivery_time.json) and the database matches it to the open windows. No model call.
    const when = texts.length === 1 && transcripts.length === 0 && pins === 0 ? whenOnly(texts[0]!) : null;
    if (when && schedules(when)) {
      const r = await answerWhen(ctx, when);
      if (r.done) { remember(); await record("ok", `when:${r.path}`); return { outcome: r.path.includes("card") ? "card" : "answered", sent }; }
    }
    // Where is my order, when are you open, same as last time: typed in a few words, answered by the database alone (1.3).
    // What do you know about me, forget, stop remembering (1.14): typed on their own, answered by code.
    const mem = texts.length === 1 && transcripts.length === 0 && pins === 0 ? memoryCommand(texts[0]!) : null;
    if (mem) {
      const r = await answerMemory(ctx, mem);
      if (r.done) { remember(); await record("ok", r.path); return { outcome: "answered", sent }; }
    }
    const quick = texts.length === 1 && transcripts.length === 0 && pins === 0 ? quickIntent(texts[0]!) : null;
    if (quick) {
      const r = await answerQuick(ctx, quick);
      if (r.done) { remember(); await record("ok", `quick:${r.path}`); return { outcome: r.path.includes("card") ? "card" : "answered", sent }; }
    }

    // Past the hourly cap on model turns (1.8, settings.model_turns), a person takes over: no model call.
    const budget = conv.budget !== undefined ? conv.budget
      : (await db.rpc("model_turn_budget", { p_party: conv.party_id })).data as { allowed: boolean; used: number; limit: number } | null;
    if (budget && budget.allowed === false) {
      // HO1: no model call, and no hand-off: a fixed menu (browse, my order, a person). Ops is told by the exception.
      const hour = Math.floor(Date.now() / 3_600_000);
      await db.rpc("raise_ops_exception", { p_kind: "model_turn_cap", p_ref: `${conv.party_id}:${hour}`,
        p_detail: { conversation_id: conv.conversation_id, used: budget.used, limit: budget.limit } });
      await alertOps(deps, messages(STAFF_LANG).ops.turnCap(budget.limit), `turncap:${conv.party_id}:${hour}`);
      const menu = supportMessage(state.lang, "capMenu");
      if ((await sendRaw(menu)).ok) sent.push(T().support.capMenu);
      await record("menu", "model_turn_cap");
      return { outcome: "menu", sent };
    }
    const lastInbound = [...pending].reverse().find((p) => p.event.message.type === "text" || p.event.message.type === "audio");
    // Never for a staging probe: its messages exist only in our database, and nothing about them may reach Kapso (4.10).
    const isProbe = (lastInbound?.event.message.kapso as { probe?: boolean } | undefined)?.probe === true;
    if (lastInbound && deps.typing && !isProbe) await deps.typing(lastInbound.event.message.id).catch(() => undefined);

    const input = { texts, transcripts,
      state: { delivery_village_id: state.villageId ?? null, has_saved_place: !!state.placeId, open_quote: state.lastQuote?.quote ?? null,
               audio_messages_unreadable: audioFailed, recent: state.history ?? [],
               // HO1: requests a person already has. The bot keeps serving; it never hands the same request off twice.
               ...(openCases.length ? { open_requests_with_a_person: openCases.map((c) => ({ kind: c.kind, topic: c.topic })) } : {}),
               // What we know about this person from delivered orders: usuals, brands, saved places, how they pay. Facts, not a transcript.
               known_customer: (conv.customer_context !== undefined ? conv.customer_context
                                : (await db.rpc("customer_context", { p_party: conv.party_id })).data) ?? null } };

    // 1. Parse once.
    const reading = await extractOrder(model, deps.modelName, input);
    add(reading.usage);
    intent = reading.intent;
    // B1b (the run on main, 43751120408: «Eh, hayda», "Rje3 3al taleb"): a tap on a button the Concierge offered answers our own question,
    // so it is never off-topic, whatever the reading says of its few words.
    if (intent && intent.intent === "off_topic" && tapTitles.length && transcripts.length === 0 && texts.every((x) => tapTitles.includes(x)))
      intent = { ...intent, intent: "question" };
    // M1: the reading names the customer's language when their own words have not (B1b: it never overrides them, language.ts).
    learnLang([...ownTexts, ...transcripts.map((t) => t.primary)], intent?.language);
    // A restriction said now applies to the order built now; keeping it for later waits for the customer's yes (1.14).
    const stated = [...(intent?.restrictions ?? [])];
    if (stated.length) state.orderRestrictions = [...new Set([...(state.orderRestrictions ?? []), ...stated])];
    const said = [...texts, ...transcripts.map((t) => t.primary)].join("\n");
    // PD1 (e): the customer's own words this turn, so their request said back («you asked for protein bars») is not read as a claim.
    ctx.customerWords = said;
    // A basket waiting on where to deliver, and an answer with no new items: those words are the address (B4). The card follows.
    if (intent && waitingForPlace(ctx)) {
      const took = await takeAddress(ctx, intent, said);
      if (took.done) { remember(); await record("ok", took.path); return { outcome: took.path.includes("card") ? "card" : "answered", sent }; }
    }
    // 2. The database decides: card, handoff, or a question.
    const routed = await planReading(ctx, intent, said);
    // B1e (QA1): after the honest answer, a fact that only describes the kind asked ("no sugar" of "protein bars with no sugar") is a
    // search the answer has used, not a restriction for an order: never offered as one, never kept for the next basket. An allergy stays.
    if (routed.done && routed.path === "honest_answer" && stated.some((r) => factsAsked(r).length)) {
      const facts = stated.filter((r) => factsAsked(r).length);
      state.orderRestrictions = (state.orderRestrictions ?? []).filter((r) => !facts.includes(r));
      stated.splice(0, stated.length, ...stated.filter((r) => !facts.includes(r)));
    }
    if (routed.done) { if (stated.length) await offerToRemember(ctx, stated); remember(); await record("ok", routed.path); return { outcome: routed.path === "handoff" ? (ctx.support?.opened ? "case" : "answered") : routed.path.includes("card") || routed.path === "ask_pin" ? "card" : "answered", sent }; }
    // 3. Only a question needs the tool loop.
    // M1: the length rule goes with the ask loop's input, never into the reading's prompt (REPLY_RULE).
    // B1b (SIM1 fix 6): the language to write in, kept for the conversation (Arabizi in Latin letters for an Arabizi customer).
    // PD1 (e): the products the planner returned are names the reply may use as written; (g) the catalogue is offered only when connected.
    notePlanNames(ctx, routed.plan);
    notePlanAreas(ctx, routed.plan, intent?.address?.village);
    ctx.catalogueReady = await catalogueReady(db);
    ctx.hours = await deliveryHours(db);                                // B1f: the time guard never lets a time outside the hours through
    const ask = { ...input, reading: intent, plan: routed.plan, reply_rule: REPLY_RULE, ...(replyLanguage(state.speech) ? { reply_language: replyLanguage(state.speech) } : {}) };
    const res = await runAskLoop(model, deps.modelName, ask, makeConciergeTools(ctx));
    add(res.usage);
    // CX2: a line the planner could not find, which the reply did not name, is said by code. Nothing asked for is dropped in silence.
    if (res.outcome === "ok") await nameLost(ctx, routed.plan, intent);
    if (stated.length && res.outcome === "ok") await offerToRemember(ctx, stated);
    remember();
    // HO1: the loop's own "handoff" is a case opened (or recalled), a food fact not on record, or the stalled question.
    const how = ctx.support?.stalled ? "stalled" : ctx.support?.opened ? "case" : ctx.support?.foodFact ? "not_on_record" : res.outcome;
    await record(how, "ask");
    return { outcome: how === "case" ? "case" : how === "stalled" ? "answered" : "agent_ok", sent };
  } catch (err) {
    // The outbox could not say whether a message is ours to send: nothing more may go out. The whole turn retries.
    if (err instanceof OutboxUnavailable || (err as Error)?.name === "OutboxUnavailable") throw err;
    // HO1: a technical failure is not a hand-off. Nothing sent yet: the turn is queued again once, a minute later. The second
    // failure gets the fixed technical line (Browse, Talk to a person) and an ops exception; the chat stays with the bot.
    // OPS1: a refusal for an account reason (usage limit, billing, key) is the same kind of failure, but a limit does not clear in a minute,
    // so it is not retried: the customer gets the technical line at once. The high-priority model_account exception is already open
    // (the model wrapper raised it); the technical exception below carries which reason it was, so each chat that met it is findable.
    const account = err instanceof ModelAccountRefused ? err : null;
    const capacity = err instanceof ModelUnavailable;
    const cause = capacity ? String((err as ModelUnavailable).cause) : String(err);
    if (!account && ctx.sent.count === 0 && state.technicalRetry !== turnKey) {
      state.technicalRetry = turnKey;
      throw new RetryTurnLater(TECHNICAL_RETRY_MS, err);
    }
    state.technicalRetry = null;
    await db.rpc("raise_ops_exception", { p_kind: "technical", p_ref: turnKey,
      p_detail: { conversation_id: conv.conversation_id, where: account ? `model_account:${account.reason}` : capacity ? "model_capacity" : "agent_error", error: cause.slice(0, 300) } });
    if (ctx.sent.count === 0 && (await sendRaw(supportMessage(state.lang, "technical"))).ok) sent.push(T().support.technical);
    sent.push(...ctx.sent.texts.splice(0));
    await record("technical", account ? `model_account:${account.reason}` : capacity ? "model_capacity" : "agent_error").then(() => undefined, () => undefined);
    return { outcome: "technical", sent };
  }
}

async function call<T = unknown>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
/** What the account alarm does when the provider refuses: raise (or count on) the one open model_account exception for that reason. */
export const accountReport = (db: SupabaseClient) => async (reason: "usage_limit" | "billing" | "invalid_key", message: string) => {
  const r = await db.rpc("raise_model_account", { p_reason: reason, p_detail: { message } });
  if (r.error) console.error("raise_model_account", r.error.message);
};


/** SHA-256 of an outbound message, first 16 hex characters. Same message, same hash, in every attempt of a turn. */
export async function contentHash(msg: Outbound): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(msg)));
  return [...new Uint8Array(bytes)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** The outbox key of a customer message: the turn, the content, and how many times this turn already said exactly that. */
export const replyKey = (turnKey: string, hash: string, n: number): string => `${turnKey}:h${hash}${n ? `:${n}` : ""}`;

/** The key of a turn is the set of WhatsApp messages it answers. Same messages, same turn, however many times it is delivered. */
export function turnKeyOf(pending: Pending[]): string {
  return `${pending[0]?.line ?? "?"}:` + pending.map((p) => p.event.message.id).sort().join("+");
}

/**
 * Runs a turn exactly once. If the worker dies half-way, the retry re-runs the turn, but every message already sent is
 * skipped by the outbox, button handlers are no-ops the second time, and a rebuilt card replaces the old one.
 */
export async function runTurn(deps: TurnDeps, pending: Pending[], state: ConversationState): Promise<TurnResult> {
  if (pending.length === 0) return { outcome: "ignored", sent: [] };
  const key = turnKeyOf(pending);
  let opened: OpenedTurn | undefined;
  if (pending[0]!.line === "customer") {
    // One round trip: begin_turn is the first thing open_turn does (0100).
    opened = await openTurn(deps.db, key, pending);
    if (opened.turn === "done" || opened.turn === "give_up") return { outcome: "duplicate", sent: [] };
  } else {
    const begun = await deps.db.rpc("begin_turn", { p_key: key, p_line: pending[0]!.line, p_conversation: null });
    if (!begun.error && (begun.data === "done" || begun.data === "give_up")) return { outcome: "duplicate", sent: [] };
  }
  const result = await processTurn({ ...deps, turnKey: key }, pending, state, opened);
  await deps.db.rpc("finish_turn", { p_key: key, p_outcome: { outcome: result.outcome, sent: result.sent.length } });
  return result;
}

/** The payload of a template's quick-reply button (type "button" on WhatsApp): the id the free message's button would carry. */
function templatePayload(m: KapsoReceived["message"]): string | undefined {
  const b = (m as { button?: { payload?: unknown } }).button;
  return typeof b?.payload === "string" ? b.payload : undefined;
}
