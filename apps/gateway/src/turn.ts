// One customer turn: everything that arrived in a burst, handled in order.
// Buttons, pins and STOP are handled by code. Only free text and voice reach the model.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askLocation, type KapsoReceived, type Outbound } from "@ak/wa/kapso";
import { alertOps, handleSubstitutionButton, processOpsTurn } from "./ops-turn";
import { OutboxUnavailable, type SendRequest, type SendResult } from "@ak/wa/gateway";
import { ModelUnavailable, withCapacityFallback, type CapacityOptions } from "@ak/agents/capacity";
import { detectConsentSignal } from "@ak/core/optout";
import { extractOrder, runAskLoop, type ModelClient } from "@ak/agents/concierge";
import { answerQuick, completePending, planReading } from "@ak/agents/pipeline";
import { looksLikePhoneAttempt, parsePhone } from "@ak/agents/phone";
import { quickIntent } from "@ak/agents/quick-intent";
import { parseRepeatButton, rebuildStale, repeatLast } from "@ak/agents/answers";
import type { OrderIntent } from "@ak/agents/schemas";
import { makeConciergeTools, type ConversationState, type ToolContext } from "@ak/agents/concierge-tools";
import { buttonReplyText, FIXED, parseOrderButton } from "@ak/agents/order-card";
import { readVoiceNote, type SttProvider } from "@ak/agents/stt";
import { PROOF_TEXT, readPaymentProof, takePaymentProof } from "@ak/agents/payment-proof";
import { answerMemory, handleMemoryButton, memoryCommand, offerToRemember } from "@ak/agents/memory";
import { decideVoice } from "@ak/agents/voice";
import { FEEDBACK_TEXT, parseFeedbackButton } from "@ak/agents/feedback";

export interface Pending { line: "customer" | "ops"; who: { waUserId?: string; phone?: string }; event: KapsoReceived }
export interface TurnDeps {
  db: SupabaseClient;
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
  /** A second speech-to-text provider (1.7), passed by the worker only when its key is configured. settings.stt decides use. */
  stt?: SttProvider;
}
export interface TurnResult { outcome: "ignored" | "buttons" | "opt_out" | "opt_in" | "audio_unusable" | "human" | "agent_ok" | "agent_handoff" | "card" | "answered" | "rider" | "duplicate" | "error"; sent: string[] }

const HISTORY_MAX = 8;

export async function processTurn(deps: TurnDeps, pending: Pending[], state: ConversationState): Promise<TurnResult> {
  const first = pending[0];
  if (!first) return { outcome: "ignored", sent: [] };
  if (first.line !== "customer") return processOpsTurn(deps, pending);          // riders today; merchants and staff in step 7

  const { db } = deps;
  const to = first.who.phone ?? first.who.waUserId!;
  const conv = await call<{ known: boolean; party_id: string; conversation_id: string; human_handoff: boolean; blocked: boolean }>(db, "touch_conversation", {
    p_line: "customer", p_wa_user_id: first.who.waUserId ?? null, p_phone: first.who.phone ?? null,
    p_name: first.event.conversation.contact_name ?? null,
  });
  if (!conv.known || conv.blocked) return { outcome: "ignored", sent: [] };

  const sent: string[] = [];
  let sendSeq = 0;
  if (!deps.turnKey) throw new Error("NO_TURN_KEY: processTurn must be called through runTurn");
  const turnKey = deps.turnKey;
  const sendRaw = async (msg: Outbound, orderId?: string, authored?: SendRequest["authored"]): Promise<SendResult> =>
    deps.send({ line: "customer", partyId: conv.party_id, to, msg, category: "service", orderId,
                dedupeKey: `${turnKey}:${sendSeq++}`, ...(authored ? { authored } : {}) });
  const say = async (text: string, orderId?: string) => { const r = await sendRaw({ type: "text", text: { body: text } }, orderId); if (r.ok) sent.push(text); return r; };
  // The model, with the capacity fallback around it: one fixed "one moment" on the first failure (keyed so a retried turn
  // never sends it twice), retries with backoff, then ModelUnavailable.
  const model = withCapacityFallback(deps.model, { ...deps.capacity, onFirstFailure: async () => {
    const r = await deps.send({ line: "customer", partyId: conv.party_id, to, msg: { type: "text", text: { body: FIXED.oneMoment } },
                                category: "service", dedupeKey: `${turnKey}:wait` });
    if (r.ok) sent.push(FIXED.oneMoment);
  } });

  // Where a new customer came from (1.13): an ad click, a QR code or a referral code on their very first message. Data only;
  // the database writes it once and ignores later messages. A failure here never stops the turn.
  const head = first.event.message as typeof first.event.message & { referral?: unknown };
  await db.rpc("record_first_contact", { p_party: conv.party_id, p_wamid: head.id, p_text: head.text?.body ?? null, p_referral: head.referral ?? null })
    .then(() => undefined, () => undefined);

  await db.from("wa_messages").insert(pending.map((p) => ({
    line: "customer", direction: "inbound", party_id: conv.party_id, conversation_id: conv.conversation_id,
    wa_message_id: p.event.message.id, type: p.event.message.type, status: "received",
    body: p.event.message.text?.body ?? p.event.message.interactive?.button_reply?.id ?? null,
    transcript: p.event.message.kapso.transcript ? { kapso: p.event.message.kapso.transcript.text } : null,
  })));

  const ctx: ToolContext = {
    db, partyId: conv.party_id, conversationId: conv.conversation_id, state,
    send: (msg, opts) => sendRaw(msg, opts?.orderId, opts?.authored), sent: { count: 0, texts: [] },
  };
  const texts: string[] = [];
  const turnIds = pending.map((p) => p.event.message.id);
  const transcripts: { primary: string; secondary?: string }[] = [];
  let buttonsHandled = 0, audioFailed = 0, voiceSecondsThisTurn = 0, pins = 0, phoneSaved = false;

  for (const p of pending) {
    const m = p.event.message;

    // 1. Buttons never reach the model.
    const tapped = m.type === "interactive" ? m.interactive?.button_reply?.id : undefined;
    if (tapped) {
      const btn = parseOrderButton(tapped);
      if (btn) {
        buttonsHandled++;
        try {
          const r = await call<{ status: string; short_code: string; changed: boolean; payment_method?: string; total_usd?: number }>(
            db, btn.action === "confirm" ? "confirm_order_checked" : "handle_order_button",
            btn.action === "confirm" ? { p_order: btn.orderId, p_party: conv.party_id, p_wamid: m.id }
                                     : { p_order: btn.orderId, p_action: btn.action, p_party: conv.party_id, p_wamid: m.id });
          if (r.status === "stale_quote") {
            // Prices or stock moved since the card. The same lines, re-priced now, with anything gone named first. No model.
            state.lastQuote = null;
            if (!(await rebuildStale(ctx, btn.orderId)).done) await say(FIXED.outOfStock, btn.orderId);
            continue;
          }
          if (r.status === "needs_location") { await sendRaw(askLocation("قبل ما نأكّد، بعتلنا موقعك 📍 أو اكتب العنوان بالتفصيل."), btn.orderId); continue; }
          await say(buttonReplyText(r), btn.orderId);
          // Finding a rider must never turn a confirmed order into an error message. If it fails here, the cron retries every minute.
          if (r.changed && r.status === "confirmed") await deps.onOrderConfirmed?.(btn.orderId).catch(() => undefined);
          if (r.status === "draft") state.lastQuote = null;
        } catch (err) {
          await say(String(err).includes("OUT_OF_STOCK") ? FIXED.outOfStock : FIXED.error, btn.orderId);
          if (!String(err).includes("OUT_OF_STOCK")) await handoff(db, conv.conversation_id, `button_error: ${String(err).slice(0, 200)}`);
        }
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
          await handoff(db, conv.conversation_id, `delivery_problem: ${r.short_code}`);
          await alertOps(deps, FEEDBACK_TEXT.opsAlert(r.short_code ?? ""), `fbproblem:${fb.orderId}`);
          await say(FEEDBACK_TEXT.problem(r.short_code ?? ""), fb.orderId);
        } else if (r.ok && r.changed) await say(FEEDBACK_TEXT.fine, fb.orderId);
        continue;
      }
      // Keep or remove a substitute the picker offered (C2, 2.2): the hub's code answers; never the model.
      if (tapped.startsWith("sub:")) {
        try { if (await handleSubstitutionButton(deps, conv.party_id, tapped, m.id)) { buttonsHandled++; continue; } }
        catch (err) {
          if (err instanceof OutboxUnavailable || (err as Error)?.name === "OutboxUnavailable") throw err;
          buttonsHandled++; await say(FIXED.error); await handoff(db, conv.conversation_id, `substitution_error: ${String(err).slice(0, 200)}`); continue;
        }
      }
      if (await handleMemoryButton(ctx, tapped)) { buttonsHandled++; continue; }     // forget / keep a restriction (1.14)
      if (tapped === "marketing:yes" || tapped === "marketing:no") {
        buttonsHandled++;
        await db.from("consent_events").insert({ party_id: conv.party_id, line: "customer", kind: "marketing",
          action: tapped === "marketing:yes" ? "opt_in" : "opt_out", source: "marketing_button", evidence_message_id: m.id });
        continue;
      }
      texts.push(m.interactive?.button_reply?.title ?? tapped);     // a button the Concierge itself offered
      continue;
    }

    // 2. A location pin is data, not conversation.
    if (m.type === "location" && m.location) {
      const place = await call<{ place_id: string; village_id: string | null; village: string | null }>(db, "save_customer_pin",
        { p_party: conv.party_id, p_lat: m.location.latitude, p_lng: m.location.longitude, p_village: state.villageId ?? null });
      state.placeId = place.place_id;
      if (place.village_id) state.villageId = place.village_id;
      pins++;
      texts.push(`[location pin received${place.village ? `, village: ${place.village}` : ""}]`);
      continue;
    }

    // 3. STOP wins, before any model.
    if (m.type === "text") {
      const body = m.text?.body ?? "";
      const signal = detectConsentSignal(body);
      if (signal === "opt_out") {
        await say(FIXED.optOut);                                    // the one permitted confirmation, sent before the gate closes
        await call(db, "record_consent_signal", { p_party: conv.party_id, p_line: "customer", p_action: "opt_out", p_source: "stop_keyword", p_wamid: m.id });
        return { outcome: "opt_out", sent };
      }
      if (signal === "opt_in") {
        await call(db, "record_consent_signal", { p_party: conv.party_id, p_line: "customer", p_action: "opt_in", p_source: "start_keyword", p_wamid: m.id });
        await say(FIXED.optIn);
        return { outcome: "opt_in", sent };
      }
      // The number a rider can call, when we have just asked for it (1.19). Read only then, so a quantity is never taken for a phone.
      if (state.awaiting === "phone") {
        const phone = parsePhone(body);
        if (phone) {
          await call(db, "set_contact_phone", { p_party: conv.party_id, p_phone: phone });
          phoneSaved = true;
          if (looksLikePhoneAttempt(body)) continue;                // just the number: nothing else to read
        } else if (looksLikePhoneAttempt(body)) { await say(FIXED.badPhone); buttonsHandled++; continue; }
      }
      texts.push(body);
      continue;
    }

    // 4. Voice: the policy, then the transcripts (Kapso first, a second provider behind settings.stt), then mechanical checks.
    if (m.type === "audio") {
      // Policy first (1.17): the role's limit and the sender's hourly budget from settings.voice_limits, across turns. A note
      // over a limit is answered politely and not read. Nothing is dropped in silence.
      const policy = await decideVoice({ db, partyId: conv.party_id, line: "customer", role: "customer" }, m, voiceSecondsThisTurn, turnIds);
      if (policy.reply) { await say(policy.reply); buttonsHandled++; continue; }
      const seconds = policy.seconds;
      voiceSecondsThisTurn += seconds;
      // Kapso's transcript first; a second provider's too when settings.stt names one we have (1.7). Both are judged.
      const { verdict } = await readVoiceNote({ db, fetchMedia: deps.fetchMedia, stt: deps.stt }, conv.party_id, m, seconds);
      if (verdict.usable) transcripts.push({ primary: verdict.primary.text, ...(verdict.secondary ? { secondary: verdict.secondary.text } : {}) });
      else audioFailed++;
      continue;
    }

    // 5. A picture while an order waits for a transfer is the receipt (1.6): stored privately, queued for a person, no model reply.
    if (m.type === "image") {
      const proof = await takePaymentProof({ db, fetchMedia: deps.fetchMedia }, conv.party_id, m);
      if (proof.kind === "stored") {
        buttonsHandled++;
        await say(PROOF_TEXT.received(proof.shortCode), proof.orderId);
        await alertOps(deps, PROOF_TEXT.opsAlert(proof), `proof:${proof.proofId}`);
        // The optional read pre-fills amount and reference for the person who confirms. It never confirms anything.
        if (!proof.already && (await db.rpc("setting", { p_key: "payment_proofs" })).data?.model_read !== false) {
          const reading = await readPaymentProof(deps.model, deps.modelName, proof.bytes, proof.mime);
          if (reading) await db.rpc("record_proof_reading", { p_proof: proof.proofId, p_extracted: reading });
        }
        continue;
      }
      if (proof.kind === "unreadable") { buttonsHandled++; await say(PROOF_TEXT.resend); continue; }
      texts.push(`[image received${m.image?.caption ? `: ${m.image.caption}` : ""}]`);
      continue;
    }
  }

  if (texts.length === 0 && transcripts.length === 0 && !phoneSaved) {
    if (audioFailed > 0) { await say(FIXED.audioUnusable); return { outcome: "audio_unusable", sent }; }
    return { outcome: buttonsHandled ? "buttons" : "ignored", sent };
  }
  if (conv.human_handoff) return { outcome: "human", sent };          // a person has this chat; the model stays out
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
  const usage = { input: 0, output: 0 };
  let intent: OrderIntent | null = null;
  const record = (outcome: string, path: string) => db.from("agent_runs").insert({ agent: "concierge", conversation_id: conv.conversation_id,
    model: deps.modelName, input_tokens: usage.input, output_tokens: usage.output, latency_ms: Date.now() - started, outcome,
    trace: { path, intent, sent: ctx.sent.texts } });
  try {
    // A pin or a number for a card that was only waiting on it: the card goes out, no model.
    if (dataOnly) {
      const waited = state.awaiting;
      if (await completePending(ctx)) {
        remember(); await record("ok", state.awaiting === "phone" ? `ask_phone_after_${waited}` : `card_after_${waited}`);
        return { outcome: "card", sent };
      }
      if (texts.length === 0) { await say(FIXED.phoneSaved); remember(); return { outcome: "answered", sent }; }
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
    const budget = (await db.rpc("model_turn_budget", { p_party: conv.party_id })).data as { allowed: boolean; used: number; limit: number } | null;
    if (budget && budget.allowed === false) {
      const hour = Math.floor(Date.now() / 3_600_000);
      await handoff(db, conv.conversation_id, "model_turn_cap");
      await db.rpc("raise_ops_exception", { p_kind: "model_turn_cap", p_ref: `${conv.party_id}:${hour}`,
        p_detail: { conversation_id: conv.conversation_id, used: budget.used, limit: budget.limit } });
      await alertOps(deps, `⚠️ زبون تخطّى ${budget.limit} رسالة للمساعد بساعة. المحادثة صارت مع موظف.`, `turncap:${conv.party_id}:${hour}`);
      await say(FIXED.handoff);
      await record("handoff", "model_turn_cap");
      return { outcome: "agent_handoff", sent };
    }
    const lastInbound = [...pending].reverse().find((p) => p.event.message.type === "text" || p.event.message.type === "audio");
    if (lastInbound && deps.typing) await deps.typing(lastInbound.event.message.id).catch(() => undefined);

    const input = { texts, transcripts,
      state: { delivery_village_id: state.villageId ?? null, has_saved_place: !!state.placeId, open_quote: state.lastQuote?.quote ?? null,
               audio_messages_unreadable: audioFailed, recent: state.history ?? [],
               // What we know about this person from delivered orders: usuals, brands, saved places, how they pay. Facts, not a transcript.
               known_customer: (await db.rpc("customer_context", { p_party: conv.party_id })).data ?? null } };

    // 1. Parse once.
    const reading = await extractOrder(model, deps.modelName, input);
    usage.input += reading.usage.input; usage.output += reading.usage.output;
    intent = reading.intent;
    // A restriction said now applies to the order built now; keeping it for later waits for the customer's yes (1.14).
    const stated = intent?.restrictions ?? [];
    if (stated.length) state.orderRestrictions = [...new Set([...(state.orderRestrictions ?? []), ...stated])];
    // 2. The database decides: card, handoff, or a question.
    const routed = await planReading(ctx, intent, [...texts, ...transcripts.map((t) => t.primary)].join("\n"));
    if (routed.done) { if (stated.length) await offerToRemember(ctx, stated); remember(); await record("ok", routed.path); return { outcome: routed.path === "handoff" ? "agent_handoff" : routed.path.includes("card") || routed.path === "ask_pin" ? "card" : "answered", sent }; }
    // 3. Only a question needs the tool loop.
    const res = await runAskLoop(model, deps.modelName, { ...input, reading: intent, plan: routed.plan }, makeConciergeTools(ctx));
    usage.input += res.usage.input; usage.output += res.usage.output;
    if (stated.length && res.outcome === "ok") await offerToRemember(ctx, stated);
    remember();
    await record(res.outcome, "ask");
    return { outcome: res.outcome === "ok" ? "agent_ok" : "agent_handoff", sent };
  } catch (err) {
    // The outbox could not say whether a message is ours to send: nothing more may go out. The whole turn retries.
    if (err instanceof OutboxUnavailable || (err as Error)?.name === "OutboxUnavailable") throw err;
    if (err instanceof ModelUnavailable) {
      // The model stayed unavailable through every retry: a person takes over, and the customer is told so.
      await handoff(db, conv.conversation_id, "model_capacity");
      await db.rpc("raise_ops_exception", { p_kind: "model_capacity", p_ref: turnKey, p_detail: { conversation_id: conv.conversation_id, error: String(err.cause).slice(0, 300) } });
      await say(FIXED.handoff);
      await record("handoff", "model_capacity").then(() => undefined, () => undefined);
      return { outcome: "agent_handoff", sent };
    }
    await handoff(db, conv.conversation_id, `agent_error: ${String(err).slice(0, 200)}`);
    if (ctx.sent.count === 0) await say(FIXED.error);
    return { outcome: "error", sent };
  }
}

async function call<T = unknown>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
async function handoff(db: SupabaseClient, conversationId: string, reason: string) {
  await db.from("conversations").update({ human_handoff: true }).eq("id", conversationId);
  await db.from("handoffs").insert({ conversation_id: conversationId, reason });
}


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
  const begun = await deps.db.rpc("begin_turn", { p_key: key, p_line: pending[0]!.line, p_conversation: null });
  if (!begun.error && (begun.data === "done" || begun.data === "give_up")) return { outcome: "duplicate", sent: [] };
  const result = await processTurn({ ...deps, turnKey: key }, pending, state);
  await deps.db.rpc("finish_turn", { p_key: key, p_outcome: { outcome: result.outcome, sent: result.sent.length } });
  return result;
}
