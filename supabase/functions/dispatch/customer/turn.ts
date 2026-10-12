// One customer turn (DECISIONS §3, §4, §27.9, §28.2, §29.3, §30.1, §30.6, alo-ai-tool-safety, alo-order-flow).
//
//   1. customer_turn_begin: customer, session, basket, orders, profile; a redelivered message stops here.
//   2. Deterministic paths with zero model calls: button and list taps, location pins, live location,
//      STOP, "delete my data", "forget my history", a person, tracking, yes/no to a pending question.
//   3. Otherwise at most one model call (Haiku 4.5, config), plus one retry on the escalation model when the
//      first fails or for complaints. The model only calls typed tools (tools.ts); server code checks and
//      executes them and render.ts turns results into messages. Its free text passes a price guard.
//   4. Voice notes: "listening…" first, then transcription with our vocabulary, then the same path with the
//      transcript in its own delimited block (the model normalises it against menus and places, §30.1.6).
//   5. At most three messages per turn (§3), sent in order from the customer number.
//
// Dependencies are injected; tests run without network or database.

import {
  asLang,
  locationRequest,
  parseCustomerAction,
  text,
  type CLang,
  type CustomerAction,
} from "../../_shared/customer-cards.ts";
import { clampInteractive } from "../../_shared/meta-limits.ts";
import { deterministicIntent, detectLang, looksLikeComplaint, PRICE_RE } from "./intents.ts";
import {
  askPin,
  basketMessage,
  beyondRadius,
  cancelAsk,
  cashAsk,
  emptyQuestion,
  fulfilmentAsk,
  handoffWaitCard,
  localName,
  mainMenu,
  menuList,
  noDeliveryCard,
  qtyList,
  sectionList,
  substitutionAsk,
  dietaryList,
  optionList,
  summaryMessage,
  trackMessage,
  tr,
  upsellMessage,
  vendorChoices,
  where,
  type Basket,
  type MenuRow,
  type Quote,
  type Track,
} from "./render.ts";
import { ALLERGENS, DIETS, NUTRITION_TAGS, SYSTEM_PROMPT, TOOLS, type ToolName } from "./tools.ts";
import { buttons, moneyLine } from "../../_shared/customer-cards.ts";
import { flowMessage, parseFlowReply, type FlowName } from "../../_shared/flows.ts";
import { parseCartOrder } from "../../_shared/catalog.ts";

type Msg = Record<string, unknown>;
export type SendResult = { ok: true; id?: string } | { ok: false; retry: boolean; error: string };

export type ModelRequest = {
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  tools: unknown[];
  maxTokens: number;
  timeoutMs: number;
};
export type ModelResponse = {
  content: (
    { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: any }
  )[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string | null;
};
export type Transcript = {
  text: string;
  seconds?: number | null;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type CustomerDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
  /** Sends one payload from the customer number. */
  send: (payload: Msg) => Promise<SendResult>;
  /** One model call; null when no key is configured (then only deterministic paths run). */
  model: ((req: ModelRequest) => Promise<ModelResponse>) | null;
  /** Transcribes audio with a vocabulary prompt; null when no key is configured. */
  transcribe:
    | ((audio: Uint8Array, mime: string, prompt: string, model: string) => Promise<Transcript>)
    | null;
  /** Downloads inbound media (Kapso). */
  fetchMedia: (m: {
    url?: string | null;
    id?: string | null;
  }) => Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** Road route vendor → customer through the route cache and OpenRouteService; null when unknown. */
  route: (
    origin: { lat: number; lon: number },
    dest: { lat: number; lon: number },
  ) => Promise<unknown | null>;
  config: {
    customerModel: string;
    escalationModel: string;
    transcriptionModel: string;
    maxCalls: number;
    turnMs: number;
    lowConfidenceHandoff: number;
    voiceMaxBytes: number;
  };
  now?: () => Date;
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void;
};

// ---- Inbound -----------------------------------------------------------------------------------------------
export type CustomerInbound = {
  from: string;
  messageId: string;
  type: string;
  text: string | null;
  buttonId: string | null;
  location: { lat: number; lon: number } | null;
  audio: {
    url: string | null;
    id: string | null;
    mime: string;
    bytes: number | null;
    transcript: string | null;
  } | null;
  name: string | null;
  /** A WhatsApp Flow submission (§12). */
  flow?: { token: string; payload: Record<string, unknown> } | null;
  /** A cart sent from the Meta catalogue (§30.1.2): item ids and quantities only. */
  cart?: { lines: { itemId: string; quantity: number }[] } | null;
};

const E164 = /^\+[1-9][0-9]{6,14}$/;
export function readCustomerInbound(payload: any): CustomerInbound | null {
  const msg = payload?.message;
  if (!msg || typeof msg !== "object") return null;
  if (msg.kapso?.direction && msg.kapso.direction !== "inbound") return null;
  const raw = String(payload?.conversation?.phone_number ?? msg.from ?? "");
  const from = raw.startsWith("+") ? raw : raw ? `+${raw}` : "";
  if (!E164.test(from)) return null;
  const i = msg.interactive;
  const type = String(msg.type ?? "unknown");
  const lat = Number(msg.location?.latitude);
  const lon = Number(msg.location?.longitude);
  return {
    from,
    messageId: String(msg.id ?? ""),
    type,
    text: type === "text" ? String(msg.text?.body ?? "").slice(0, 2000) : null,
    buttonId:
      type === "interactive"
        ? (i?.button_reply?.id ?? i?.list_reply?.id ?? null)
        : type === "button"
          ? (msg.button?.payload ?? null)
          : null,
    location:
      type === "location" && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
    audio:
      type === "audio"
        ? {
            url: msg.kapso?.media_url ?? msg.kapso?.media_data?.url ?? null,
            id: msg.audio?.id ?? null,
            mime: String(
              msg.kapso?.media_data?.content_type ?? msg.audio?.mime_type ?? "audio/ogg",
            ),
            bytes: Number(msg.kapso?.media_data?.byte_size) || null,
            transcript: msg.kapso?.transcript?.text ?? null,
          }
        : null,
    name: payload?.conversation?.contact_name ?? msg.kapso?.contact_name ?? null,
    flow: parseFlowReply(msg),
    cart: parseCartOrder(msg),
  };
}

// ---- Turn state ----------------------------------------------------------------------------------------------
type Ref = { id: string; label: string };
type Session = {
  lang: CLang;
  focus_vendor_id: string | null;
  pending: Record<string, any>;
  refs: Record<string, Ref>;
  history: { r: "u" | "a"; t: string }[];
  low_confidence: number;
  /**
   * How the basket reaches the customer. `pickup` (T2): collected, not delivered, until the customer says otherwise.
   * `delivery`: the customer chose it on the Delivery / Pickup card (§37.6), so checkout does not ask again.
   * null: not chosen yet; delivery is the default and checkout asks when the shop also takes pickup.
   */
  fulfil: "pickup" | "delivery" | null;
};
type Ctx = {
  deps: CustomerDeps;
  m: CustomerInbound;
  customerId: string;
  s: Session;
  basket: any;
  orders: any[];
  profile: any;
  supportOpen: boolean;
  out: Msg[];
  tools: string[];
  calls: number;
  cost: number;
  path: "deterministic" | "model" | "voice" | "handoff" | "budget" | "error";
  summary: string[];
};

const MAX_MESSAGES = 3;
const push = (c: Ctx, ...ms: Msg[]) => {
  for (const x of ms) if (c.out.length < MAX_MESSAGES) c.out.push(x);
};
const say = (c: Ctx, key: string, v: Record<string, unknown> = {}) =>
  push(c, text(c.m.from, tr(c.s.lang, key, v)));
/**
 * Something failed on our side (T2): the customer sees the buttons, never "I'm a bit slow" (that wording is for a
 * model that answered nothing usable). The failure itself is logged by the caller.
 */
const fail = (c: Ctx) => push(c, mainMenu(c.m.from, c.s.lang, "tapFailed"));

export async function handleCustomerTurn(
  deps: CustomerDeps,
  m: CustomerInbound,
): Promise<"done" | "duplicate"> {
  const started = Date.now();
  const kind = m.buttonId ? "tap" : m.type;
  const begin = await deps.rpc("customer_turn_begin", {
    p_phone_e164: m.from,
    p_message_id: m.messageId,
    p_kind: kind.replace(/[^a-z_]/g, "_").slice(0, 40) || "unknown",
    p_display_name: m.name,
  });
  if (begin?.duplicate) return "duplicate";
  const sess = begin.session ?? {};
  const c: Ctx = {
    deps,
    m,
    customerId: begin.customer.id,
    s: {
      lang: asLang(sess.lang ?? begin.customer.language),
      focus_vendor_id: sess.focus_vendor_id ?? null,
      pending: sess.pending ?? {},
      refs: sess.refs ?? {},
      history: Array.isArray(sess.history) ? sess.history : [],
      low_confidence: Number(sess.low_confidence ?? 0),
      // kept in refs: the only session column that survives between turns
      fulfil:
        sess.refs?.fx?.id === "pickup" || sess.refs?.fx?.id === "delivery" ? sess.refs.fx.id : null,
    },
    basket: begin.basket,
    orders: begin.orders ?? [],
    profile: begin.profile ?? {},
    supportOpen: !!begin.support_open,
    out: [],
    tools: [],
    calls: 0,
    cost: 0,
    path: "deterministic",
    summary: [],
  };
  if (m.text) c.s.lang = detectLang(m.text, c.s.lang);

  try {
    if (!begin.bot_enabled) say(c, "off");
    else if (begin.customer.blocked) {
      /* blocked numbers get no reply */
    } else if (sess.handoff) await duringHandoff(c);
    else await route(c, !!begin.first_contact);
  } catch (e) {
    c.path = "error";
    deps.log?.("customer turn failed", { error: String(e).slice(0, 200) });
    if (!c.out.length) fail(c);
  }

  for (const p of c.out) {
    let r = await deps.send(clampInteractive(p));
    if (!r.ok && r.retry) r = await deps.send(clampInteractive(p)); // Kapso 409 (one in flight) or 5xx: once more
    if (!r.ok) deps.log?.("customer send failed", { error: r.error.slice(0, 120) });
  }
  if (m.text) c.s.history.push({ r: "u", t: m.text.slice(0, 300) });
  if (c.summary.length) c.s.history.push({ r: "a", t: c.summary.join(" ").slice(0, 300) });
  // The session row has no fulfil column, so the choice travels in refs (prefix "fx", never used by the lists).
  delete c.s.refs.fx;
  if (c.s.fulfil) c.s.refs.fx = { id: c.s.fulfil, label: c.s.fulfil };
  await deps.rpc("customer_turn_end", {
    p_customer_id: c.customerId,
    p_message_id: m.messageId,
    p_session: c.s,
    p_path: c.path,
    p_model_calls: c.calls,
    p_tools: c.tools,
    p_cost_usd: c.cost,
    p_latency_ms: Date.now() - started,
  });
  return "done";
}

/**
 * A conversation with a person (§30.6). The bot never goes silent (§34): every message gets an answer, and
 * "menu", "hi", "order" or any button tap ends the handoff and carries on at once. STOP and deletion work
 * throughout. The handoff also ends by itself after handoff_minutes (the database clears it).
 */
async function duringHandoff(c: Ctx) {
  const intent = c.m.text ? deterministicIntent(c.m.text) : null;
  if (intent && ["stop", "delete_data", "forget_history"].includes(intent.kind))
    return textIntent(c, intent.kind);
  const leaves = !!c.m.buttonId || intent?.kind === "greeting" || intent?.kind === "menu";
  if (leaves) {
    await c.deps.rpc("customer_handoff_end", { p_customer_id: c.customerId });
    c.s.pending = {};
    c.tools.push("handoff_end");
    return route(c, false);
  }
  c.path = "handoff";
  push(c, handoffWaitCard(c.m.from, c.s.lang));
}

async function route(c: Ctx, firstContact: boolean) {
  const m = c.m;
  if (m.buttonId) {
    const a = parseCustomerAction(m.buttonId);
    if (a) return tap(c, a);
    return say(c, "unsupported");
  }
  if (m.flow) return flowReply(c, m.flow);
  if (m.cart) return cartOrder(c, m.cart.lines);
  if (m.location) return locationPin(c, m.location);
  if (m.type === "unsupported") {
    // Live location arrives as `unsupported` on the Cloud API (§27.1): ask for a static pin instead.
    return push(c, locationRequest(m.from, tr(c.s.lang, "liveLocation")));
  }
  if (m.audio) return voice(c);
  if (m.text === null || !m.text.trim()) return say(c, "unsupported");
  const intent = deterministicIntent(m.text);
  if (intent) {
    if ((intent.kind === "yes" || intent.kind === "no") && !c.s.pending.kind)
      return modelTurn(c, m.text, false);
    return textIntent(c, intent.kind);
  }
  if (firstContact && m.text.trim().length < 4) return push(c, mainMenu(m.from, c.s.lang));
  return modelTurn(c, m.text, false);
}

// ---- Deterministic text intents ---------------------------------------------------------------------------------
async function textIntent(c: Ctx, kind: string) {
  const { deps } = c;
  c.tools.push(`intent:${kind}`);
  switch (kind) {
    case "stop":
      await deps.rpc("customer_marketing_set", { p_customer_id: c.customerId, p_opt_in: false });
      return say(c, "stopped");
    case "start_marketing":
      await deps.rpc("customer_marketing_set", { p_customer_id: c.customerId, p_opt_in: true });
      return say(c, "started");
    case "delete_data":
      c.s.pending = { kind: "delete" };
      return push(
        c,
        buttons(c.m.from, tr(c.s.lang, "confirmDelete"), [
          ["c:delete_ok", tr(c.s.lang, "yesDelete")],
          ["c:keep", tr(c.s.lang, "cancelKeep")],
        ]),
      );
    case "forget_history":
      await deps.rpc("customer_forget", { p_customer_id: c.customerId, p_scope: "history" });
      c.s = { ...c.s, history: [], refs: {}, pending: {}, focus_vendor_id: null, fulfil: null };
      return say(c, "forgotHistory");
    case "human":
      return handoff(c, "customer asked for a person");
    case "track":
      return track(c);
    case "cancel_order":
      return askCancel(c);
    case "basket":
      return push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
    case "usual":
      return reorder(c);
    case "greeting":
      return push(c, mainMenu(c.m.from, c.s.lang));
    case "menu":
      return startOrder(c);
    case "yes":
      if (c.s.pending.kind === "confirm")
        return confirm(c, c.s.pending.basket_id, c.s.pending.version);
      if (c.s.pending.kind === "delete") return tap(c, { a: "simple", what: "delete_ok" });
      return modelTurn(c, c.m.text ?? "", false);
    case "no":
      if (c.s.pending.kind === "confirm" || c.s.pending.kind === "delete") {
        c.s.pending = {};
        return push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
      }
      return modelTurn(c, c.m.text ?? "", false);
  }
}

async function handoff(c: Ctx, reason: string) {
  c.path = "handoff";
  c.tools.push("request_human");
  const r = await c.deps.rpc("customer_handoff", {
    p_customer_id: c.customerId,
    p_reason: reason.slice(0, 300),
    p_summary: null,
  });
  c.s.pending = { handoff_told: true };
  say(c, r?.support_open === false ? "handoffLate" : "handoff");
}

async function track(c: Ctx) {
  const t: Track | null = await c.deps.rpc("order_track", {
    p_customer_id: c.customerId,
    p_order_id: null,
  });
  push(c, ...trackMessage(c.m.from, c.s.lang, t));
  c.summary.push(t ? `[order ${t.code}: ${t.status}]` : "[no open order]");
}

/** "Cancel my order" by words, by the track card's button or by the model: always the same yes/no question. */
async function askCancel(c: Ctx) {
  const t: Track | null = await c.deps.rpc("order_track", {
    p_customer_id: c.customerId,
    p_order_id: null,
  });
  if (!t || ["delivered", "failed", "rejected", "cancelled"].includes(t.status))
    return say(c, "trackNone");
  return push(c, cancelAsk(c.m.from, c.s.lang, t));
}

async function reorder(c: Ctx) {
  const id = c.profile?.last_order_id;
  if (!id) return say(c, "trackNone");
  const r = await c.deps.rpc("basket_reorder", { p_customer_id: c.customerId, p_order_id: id });
  if (r?.status !== "ok") return say(c, "vendorPaused", { vendor: "" });
  c.basket = r.basket;
  push(c, ...basketMessage(c.m.from, c.s.lang, r.basket));
  c.summary.push("[reordered the last order]");
}

// ---- Taps -------------------------------------------------------------------------------------------------------
async function tap(c: Ctx, a: CustomerAction) {
  const { deps } = c;
  const id = c.customerId;
  c.tools.push(`tap:${a.a}`);
  switch (a.a) {
    case "confirm":
      return confirm(c, a.basketId, a.version);
    case "cancel": {
      const r = await deps
        .rpc("order_cancel_by_customer", { p_order_id: a.orderId, p_customer_id: id })
        .catch(() => ({ status: "unknown" }));
      const t = await deps.rpc("order_track", { p_customer_id: id, p_order_id: a.orderId });
      if (r.status === "cancelled" || r.status === "already_cancelled")
        return say(c, "cancelled", { code: t?.code ?? "" });
      if (r.status === "request_sent" || r.status === "request_pending")
        return say(c, "cancelRequested");
      return say(c, "tooLate");
    }
    case "received": {
      await deps
        .rpc("order_customer_feedback", { p_customer_id: id, p_order_id: a.orderId, p_ok: a.ok })
        .catch(() => null);
      if (a.ok) {
        // A test merchant's order is rated at once (§34); a real one 30 minutes later (§30.2.3).
        await deps
          .rpc("order_rating_prompt_now", { p_customer_id: id, p_order_id: a.orderId })
          .catch(() => null);
        return say(c, "glad");
      }
      c.path = "handoff";
      return say(c, "sorryProblem");
    }
    case "weight": {
      const r = await deps
        .rpc("order_weight_respond", {
          p_order_id: a.orderId,
          p_customer_id: id,
          p_accept: a.accept,
        })
        .catch(() => null);
      return say(c, r?.status === "cancelled" ? "cancelled" : "done", { code: "" });
    }
    case "rate":
      await deps.rpc("order_rate", {
        p_customer_id: id,
        p_order_id: a.orderId,
        p_food_score: a.food ?? null,
        p_delivery_ok: a.deliveryOk ?? null,
      });
      return say(c, "thanksRating");
    case "substitution": {
      // The customer's answer to a substitute the merchant offered (§32.5); totals come from the server.
      const r = await deps.rpc("order_substitution_decide", {
        p_customer_id: id,
        p_substitution_id: a.substitutionId,
        p_accept: a.accept,
      });
      const money = moneyLine(r?.total_usd, r?.total_lbp, r?.usd_lbp_rate, c.s.lang);
      if (r?.status === "accepted") return say(c, "subAccepted", { money });
      if (r?.status === "declined") return say(c, "subDeclined", { money });
      if (r?.status === "last_item") return say(c, "subLast");
      if (r?.status === "cod_cap") return say(c, "subCap");
      return say(c, "subGone");
    }
    case "sub_pref":
      await deps.rpc("basket_set_substitution", { p_customer_id: id, p_pref: a.pref });
      return checkout(c, {});
    case "empty":
      await deps.rpc("basket_set_empty", {
        p_customer_id: id,
        p_line_id: a.lineId,
        p_has_empty: a.hasEmpty,
      });
      return checkout(c, {});
    case "pick_vendor": {
      const v = c.s.refs[a.ref];
      if (!v) return say(c, "pickPlaceFirst");
      return showMenu(c, a.ref, null);
    }
    case "pick_item": {
      // How many? (§34 step 5); the quantity tap adds it.
      const it = c.s.refs[a.ref];
      if (!it) return say(c, "pickPlaceFirst");
      return push(c, qtyList(c.m.from, c.s.lang, it.label.replace(/ \$.*$/, ""), a.ref));
    }
    case "qty": {
      const it = c.s.refs[a.ref];
      if (!it) return say(c, "pickPlaceFirst");
      // noFlow: the Flow would drop the quantity; the option list keeps it.
      const added = await addOne(c, it.id, a.qty, [], null, null, true);
      if (added) push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
      return;
    }
    case "section":
      return showSection(c, a.ref, 0);
    case "more":
      return showSection(c, a.ref, a.offset);
    case "cash": {
      await deps.rpc("basket_set_cash_currency", { p_customer_id: id, p_currency: a.currency });
      return checkout(c, {});
    }
    case "option":
      return optionChosen(c, a.optionId);
    case "add_upsell": {
      await deps.rpc("basket_add_item", {
        p_customer_id: id,
        p_item_id: a.itemId,
        p_quantity: 1,
        p_option_ids: [],
        p_note: null,
        p_replace: false,
      });
      return checkout(c, {});
    }
    case "replace_basket": {
      const r = await deps.rpc("basket_add_item", {
        p_customer_id: id,
        p_item_id: a.itemId,
        p_quantity: a.qty,
        p_option_ids: [],
        p_note: null,
        p_replace: true,
      });
      c.basket = r?.basket ?? c.basket;
      return push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
    }
    case "simple":
      switch (a.what) {
        case "checkout":
          return checkout(c, {});
        case "clear":
          await deps.rpc("basket_clear", { p_customer_id: id });
          c.basket = null;
          c.s.pending = {};
          c.s.fulfil = null;
          return say(c, "done");
        case "basket":
          return push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
        case "menu": {
          const vid = c.basket?.vendor_id ?? c.s.focus_vendor_id;
          if (!vid) return say(c, "pickPlaceFirst");
          return showMenu(c, refFor(c, "v", vid, c.basket?.vendor ?? ""), null);
        }
        case "pickup":
        case "delivery":
          return checkout(c, { fulfilment: a.what });
        case "pickup_list":
          return pickupPlaces(c);
        case "find":
          c.s.focus_vendor_id = null;
          c.s.fulfil = null;
          return say(c, "pickPlaceFirst");
        case "human":
          return handoff(c, "customer tapped talk to a person");
        case "delete_ok":
          if (c.s.pending.kind !== "delete") return say(c, "confirmDelete");
          await deps.rpc("customer_forget", { p_customer_id: id, p_scope: "all" });
          c.s = { ...c.s, history: [], refs: {}, pending: {}, focus_vendor_id: null, fulfil: null };
          return say(c, "deletedData");
        case "keep":
          c.s.pending = {};
          return say(c, "done");
        case "usual":
          return reorder(c);
        case "no_upsell":
          return say(c, "done");
        case "address_list":
          return push(c, askPin(c.m.from, c.s.lang));
        case "order":
          return startOrder(c);
        case "track":
          return track(c);
        case "cancel":
          return askCancel(c);
      }
  }
}

/** Places the order from the summary the customer tapped (§30.1.1); nothing is created on a stale version. */
async function confirm(c: Ctx, basketId: string, version: number) {
  const { deps } = c;
  c.s.pending = {};
  if (!c.basket || c.basket.basket_id !== basketId) return say(c, "staleConfirm");
  const r = await deps.rpc("order_place", {
    p_basket_id: basketId,
    p_expected_menu_version: version,
    p_idempotency_key: `wa:${basketId}:${version}`,
  });
  const lang = c.s.lang;
  switch (r?.status) {
    case "placed": {
      c.s.fulfil = null;
      c.summary.push(`[order ${r.code} placed by the customer's tap]`);
      return say(c, "placed", {
        code: r.code,
        vendor: lang === "ar" ? c.basket.vendor : (c.basket.vendor_en ?? c.basket.vendor),
      });
    }
    case "repriced":
    case "unavailable":
      say(c, "repriced");
      return checkout(c, {});
    case "vendor_paused":
    case "vendor_closed":
      return push(
        c,
        buttons(c.m.from, tr(lang, "vendorPaused", { vendor: c.basket.vendor }), [
          ["c:find", tr(lang, "otherPlace")],
        ]),
      );
    case "fulfilment_unavailable":
      c.s.fulfil = null; // the shop does not take that way: ask again
      return checkout(c, {});
    case "needs_empty_answer":
    case "no_address":
    case "cod_cap":
    case "beyond_radius":
    case "no_route":
    case "place_paused":
      return checkout(c, {});
    default:
      c.deps.log?.("order_place unexpected", { status: String(r?.status) });
      return fail(c);
  }
}

// ---- Location ----------------------------------------------------------------------------------------------------
async function locationPin(c: Ctx, p: { lat: number; lon: number }) {
  c.tools.push("address_save_pin");
  const r = await c.deps.rpc("address_save_pin", {
    p_customer_id: c.customerId,
    p_lat: p.lat,
    p_lon: p.lon,
    p_label: null,
    p_building: null,
    p_floor: null,
    p_note: null,
  });
  if (r?.status === "outside_lebanon" || r?.status === "no_place") return say(c, "noPlace");
  if (r?.address?.place_status === "paused") return say(c, "placePaused");
  say(c, "savedPin", { where: where(c.s.lang, r.address) });
  c.summary.push("[address saved from the pin]");
  c.s.fulfil = null; // a new pin starts a delivery again; checkout asks again when the shop takes both
  // The address_capture Flow (§12) asks building, floor and a number for the driver in one sheet; the
  // checkout continues when it is submitted. Without Flows the text path below runs as before.
  if (
    r.address?.id &&
    !r.address?.building &&
    (await openFlow(c, "address_capture", { address_id: r.address.id }))
  )
    return;
  if (c.basket?.lines?.length) return checkout(c, {});
  // No basket yet: the open places that deliver here (§34 step 3), or the focused place's menu.
  const focusRef = Object.entries(c.s.refs).find(
    ([k, v]) => k.startsWith("v") && v.id === c.s.focus_vendor_id,
  )?.[0];
  const browse = c.s.pending.then === "browse" || !focusRef;
  const wantsPickup = c.s.pending.then === "pickup";
  c.s.pending = {};
  if (wantsPickup) return pickupPlaces(c);
  if (browse || !focusRef) return searchVendors(c, null, null);
  return showMenu(c, focusRef, null);
}

/** "Order" / "menu": the places that deliver to the saved pin, or ask for the pin first (§34 steps 1-3). */
async function startOrder(c: Ctx) {
  c.s.fulfil = null;
  const pt = await c.deps.rpc("customer_search_point", { p_customer_id: c.customerId });
  if (!pt?.address_id) {
    c.s.pending = { kind: "await_pin", then: "browse" };
    return push(c, askPin(c.m.from, c.s.lang));
  }
  return searchVendors(c, null, null);
}

// ---- WhatsApp Flows and catalogue carts --------------------------------------------------------------------------
/** Sends a Flow when Flows are on (config flows_enabled); false means the caller uses the text path. */
async function openFlow(
  c: Ctx,
  flow: FlowName,
  context: Record<string, unknown>,
): Promise<boolean> {
  const lang = c.s.lang === "ar" || c.s.lang === "arabizi" ? "ar" : "en";
  const r = await c.deps.rpc("flow_open", {
    p_flow: flow,
    p_lang: lang,
    p_phone: c.m.from,
    p_customer_id: c.customerId,
    p_member_id: null,
    p_context: context,
  });
  if (r?.status !== "ok") return false;
  c.tools.push(`flow:${flow}`);
  push(c, flowMessage(c.m.from, { flow, lang, token: r.token, screen: r.screen, data: r.data }));
  return true;
}

/** A Flow submission: applied by the server (flow_submit), then the next step in the chat. */
async function flowReply(c: Ctx, f: { token: string; payload: Record<string, unknown> }) {
  c.tools.push("flow_submit");
  const r = await c.deps.rpc("flow_submit", {
    p_phone: c.m.from,
    p_token: f.token,
    p_payload: f.payload,
  });
  if (r?.flow === "item_options") {
    if (r.status === "added") {
      c.basket = r.basket;
      return push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
    }
    if (r.status === "other_vendor") return say(c, "otherVendor", { vendor: r.basket_vendor });
    if (r.status === "unavailable") return say(c, "unavailable", { item: r.item });
    // Refused, expired or sent again: the same item through the text path (a used Flow cannot reopen).
    if (typeof r.item_id === "string" && r.status !== "duplicate") {
      say(c, "flowRetry");
      await addOne(c, r.item_id, 1, [], null, null, true);
      return;
    }
    if (r.status === "duplicate") return;
    return say(c, "flowRetry");
  }
  if (r?.status === "duplicate") return;
  if (r?.flow === "address_capture") {
    if (r.status === "rejected") return say(c, "flowRetry");
    c.summary.push("[address details saved from the Flow]");
    if (c.basket?.lines?.length) return checkout(c, {});
    return say(c, "addressSaved");
  }
  return say(c, "flowRetry");
}

/**
 * A cart sent from the catalogue (§30.1.2): every line re-priced by basket_add_item, catalogue prices ignored.
 * The cart replaces the basket only when something in it is added (cart_apply); lines not added (unavailable,
 * or another branch) are counted to the customer, and lines that need choices are asked one at a time.
 */
async function cartOrder(c: Ctx, lines: { itemId: string; quantity: number }[]) {
  c.tools.push("cart");
  if (!lines.length) return say(c, "unsupported");
  const needOptions: { itemId: string; quantity: number }[] = [];
  const plain: { itemId: string; quantity: number }[] = [];
  for (const l of lines) {
    const groups: any[] = (await c.deps.rpc("menu_item_options", { p_item_id: l.itemId })) ?? [];
    (groups.some((g) => g.min > 0) ? needOptions : plain).push(l);
  }
  // The lines without required choices in one server step: it replaces the basket only if one is added.
  let skipped = 0;
  if (plain.length) {
    const r = await c.deps.rpc("cart_apply", {
      p_customer_id: c.customerId,
      p_lines: plain.map((l) => ({ item_id: l.itemId, quantity: l.quantity })),
    });
    if (r?.basket) c.basket = r.basket;
    skipped = Array.isArray(r?.skipped) ? r.skipped.length : plain.length;
  }
  c.summary.push(
    `[cart from the catalogue: ${lines.length} lines, ${skipped} not added, ${needOptions.length} need choices]`,
  );
  if (skipped) say(c, "cartSkipped", { n: skipped });
  if (needOptions.length) {
    const flows = c.tools.length;
    const added = await addOne(c, needOptions[0].itemId, needOptions[0].quantity, [], null, null);
    if (needOptions.length > 1) say(c, "cartMoreOptions", { n: needOptions.length - 1 });
    // Waiting on choices (an option list or the item_options Flow): the basket is shown after them.
    if (!added && (c.s.pending.kind === "options" || c.tools.length > flows)) return;
  }
  if (c.basket?.lines?.length) push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
}

// ---- Baskets and checkout -----------------------------------------------------------------------------------------
function refFor(c: Ctx, prefix: "v" | "i" | "l" | "s", id: string, label: string): string {
  for (const [k, v] of Object.entries(c.s.refs))
    if (k.startsWith(prefix) && /^[a-z]\d+$/.test(k) && v.id === id) return k;
  let n = 1;
  while (c.s.refs[`${prefix}${n}`]) n++;
  const max = prefix === "i" ? 40 : 10;
  if (n > max) {
    for (const k of Object.keys(c.s.refs)) if (k.startsWith(prefix)) delete c.s.refs[k];
    n = 1;
  }
  c.s.refs[`${prefix}${n}`] = { id, label: label.slice(0, 60) };
  return `${prefix}${n}`;
}
const resetRefs = (c: Ctx, prefix: string) => {
  for (const k of Object.keys(c.s.refs)) if (k.startsWith(prefix)) delete c.s.refs[k];
};

async function showMenu(c: Ctx, vendorRef: string, query: string | null) {
  const v = c.s.refs[vendorRef];
  if (!v) return say(c, "pickPlaceFirst");
  c.s.focus_vendor_id = v.id;
  // The menu by section, one list per tap (§34 step 4), when the shop has two or more sections.
  if (!query) {
    const sec = await c.deps.rpc("vendor_sections", { p_vendor_id: v.id });
    const secs: any[] = Array.isArray(sec?.sections) ? sec.sections : [];
    if (secs.length >= 2 && Number(sec?.unsectioned ?? 0) === 0) {
      resetRefs(c, "s");
      const rows = secs.map((x) => ({
        ref: refFor(c, "s", x.section_id, localName(c.s.lang, x.name_ar, x.name_en)),
        name_ar: x.name_ar,
        name_en: x.name_en,
        items: Number(x.items ?? 0),
      }));
      push(c, sectionList(c.m.from, c.s.lang, v.label.replace(/ \(.*\)$/, ""), rows));
      c.summary.push(`[showed ${rows.length} menu sections of ${vendorRef}]`);
      return;
    }
  }
  const rows: any[] =
    (await c.deps.rpc("vendor_menu", {
      p_vendor_id: v.id,
      p_query: query,
      p_section_id: null,
      p_limit: 10,
      p_offset: 0,
    })) ?? [];
  resetRefs(c, "i");
  const menu: MenuRow[] = rows.map((r) => ({
    ...r,
    ref: refFor(c, "i", r.item_id, `${r.name_en ?? r.name_ar} $${Number(r.price_usd).toFixed(2)}`),
  }));
  const samePrice = (await c.deps.rpc("vendor_same_price", { p_vendor_id: v.id })) === true;
  push(c, ...menuList(c.m.from, c.s.lang, v.label.replace(/ \(.*\)$/, ""), menu, query, samePrice));
  c.summary.push(`[showed ${menu.length} items from ${vendorRef}]`);
}

/** One section of the focused place's menu, nine items and a "More" row at a time. */
async function showSection(c: Ctx, sectionRef: string, offset: number) {
  const sec = c.s.refs[sectionRef];
  const vendorId = c.s.focus_vendor_id;
  if (!sec || !vendorId) return say(c, "pickPlaceFirst");
  const rows: any[] =
    (await c.deps.rpc("vendor_menu", {
      p_vendor_id: vendorId,
      p_query: null,
      p_section_id: sec.id,
      p_limit: 10,
      p_offset: Math.max(0, offset),
    })) ?? [];
  resetRefs(c, "i");
  const more = rows.length === 10 && Number(rows[0]?.total_count ?? 0) > offset + 10;
  const menu: MenuRow[] = rows.slice(0, more ? 9 : 10).map((r) => ({
    ...r,
    ref: refFor(c, "i", r.item_id, `${r.name_en ?? r.name_ar} $${Number(r.price_usd).toFixed(2)}`),
  }));
  const vref = Object.entries(c.s.refs).find(
    ([k, v]) => k.startsWith("v") && v.id === vendorId,
  )?.[0];
  const vendor = (vref ? c.s.refs[vref].label : (c.basket?.vendor_en ?? "")).replace(
    / \(.*\)$/,
    "",
  );
  push(
    c,
    ...menuList(c.m.from, c.s.lang, vendor, menu, null, false, {
      title: sec.label,
      more: more ? { ref: sectionRef, offset: offset + 9 } : null,
    }),
  );
  c.summary.push(`[showed ${menu.length} items of section ${sectionRef}]`);
}

/** Items that fit a dietary need (§32.3): hard filters only on merchant declarations, labels on estimates. */
async function dietaryMenu(c: Ctx, input: any) {
  const v = c.s.refs[input.vendor_ref];
  if (!v) return say(c, "pickPlaceFirst");
  c.s.focus_vendor_id = v.id;
  const rows: any[] =
    (await c.deps.rpc("menu_items_filter", {
      p_vendor_id: v.id,
      p_free_from: input.free_from?.length ? input.free_from : null,
      p_diets: input.diets?.length ? input.diets : null,
      p_max_kcal: input.max_kcal ?? null,
      p_min_protein_g: input.min_protein_g ?? null,
      p_tags: input.tags?.length ? input.tags : null,
      p_limit: 10,
    })) ?? [];
  resetRefs(c, "i");
  const menu = rows.map((r) => ({
    ...r,
    orderable: true,
    ref: refFor(c, "i", r.item_id, `${r.name_en ?? r.name_ar} $${Number(r.price_usd).toFixed(2)}`),
  }));
  push(
    c,
    ...dietaryList(c.m.from, c.s.lang, v.label.replace(/ \(.*\)$/, ""), menu, {
      allergens: !!input.free_from?.length || !!input.diets?.length,
    }),
  );
  c.summary.push(`[showed ${menu.length} items fitting the filters from ${input.vendor_ref}]`);
}

async function searchVendors(c: Ctx, query: string | null, businessType: string | null) {
  const pt = await c.deps.rpc("customer_search_point", { p_customer_id: c.customerId });
  let rows: any[] =
    (await c.deps.rpc("vendor_search", {
      p_query: query,
      p_lat: pt?.lat ?? null,
      p_lon: pt?.lon ?? null,
      p_business_type: businessType,
      p_cuisine: null,
      p_limit: 10,
    })) ?? [];
  // Right after the pin (§34 step 3): only places whose road route reaches the pin, before any basket exists.
  const found = rows.length;
  if (pt?.address_id && found) {
    const ids = rows.map((r) => r.vendor_id);
    let chk = await c.deps.rpc("customer_delivery_check", {
      p_customer_id: c.customerId,
      p_vendor_ids: ids,
    });
    const unknown = (chk?.vendors ?? []).filter((v: any) => v.status === "no_route" && v.origin);
    if (unknown.length) {
      for (const v of unknown.slice(0, 5))
        await c.deps.route(v.origin, v.dest).catch((e: unknown) => {
          c.deps.log?.("route fetch failed", { error: String(e).slice(0, 120) });
          return null;
        });
      chk = await c.deps.rpc("customer_delivery_check", {
        p_customer_id: c.customerId,
        p_vendor_ids: ids,
      });
    }
    if (chk?.status === "place_paused") return say(c, "placePaused");
    // A route that still cannot be fetched (routing service down) is not a "no": the checkout checks it again.
    const beyond = new Set(
      (chk?.vendors ?? [])
        .filter((v: any) => v.status === "beyond_radius")
        .map((v: any) => v.vendor_id),
    );
    rows = rows.filter((r) => !beyond.has(r.vendor_id));
  }
  if (pt?.address_id && !rows.length && (found || !query)) {
    c.summary.push("[no open place delivers to the saved pin; offered pickup]");
    return push(c, noDeliveryCard(c.m.from, c.s.lang));
  }
  resetRefs(c, "v");
  const vs = rows.map((r) => ({
    ...r,
    ref: refFor(c, "v", r.vendor_id, `${r.name_en ?? r.name_ar}${r.is_open ? "" : " (closed)"}`),
  }));
  c.summary.push(`[found ${vs.length} places for ${query ?? "nearby"}]`);
  // A named business we lack is counted for growth (§18.1 M); nobody ever messages the business.
  if (!vs.length && query && query.trim().length >= 3)
    await c.deps.rpc("vendor_request_note", { p_query: query, p_place_id: null });
  if (vs.length === 1 && vs[0].is_open)
    return showMenu(c, vs[0].ref, vs[0].matched === "dish" ? query : null);
  push(c, ...vendorChoices(c.m.from, c.s.lang, vs, query));
}

/** The pickup choice (T2): open places near the pin that take pickup, when nothing delivers or the customer prefers it. */
async function pickupPlaces(c: Ctx) {
  const pt = await c.deps.rpc("customer_search_point", { p_customer_id: c.customerId });
  if (!pt?.address_id) {
    c.s.pending = { kind: "await_pin", then: "pickup" };
    return push(c, askPin(c.m.from, c.s.lang));
  }
  const rows: any[] =
    (await c.deps.rpc("vendor_search_pickup", { p_lat: pt.lat, p_lon: pt.lon, p_limit: 10 })) ?? [];
  if (!rows.length) return push(c, text(c.m.from, tr(c.s.lang, "noPickup")));
  c.s.fulfil = "pickup";
  resetRefs(c, "v");
  const vs = rows.map((r) => ({
    ...r,
    ref: refFor(c, "v", r.vendor_id, `${r.name_en ?? r.name_ar}${r.is_open ? "" : " (closed)"}`),
  }));
  c.summary.push(`[pickup places near the pin: ${vs.length}]`);
  if (vs.length === 1 && vs[0].is_open) return showMenu(c, vs[0].ref, null);
  push(c, ...vendorChoices(c.m.from, c.s.lang, vs, null, "pickPickup"));
}

/** Adds one item; asks for required options one group at a time (§12: Flows for 2+ groups come in session 5). */
async function addOne(
  c: Ctx,
  itemId: string,
  qty: number,
  optionNames: string[],
  note: string | null,
  chosen: string[] | null,
  noFlow = false,
): Promise<boolean> {
  const groups: any[] = (await c.deps.rpc("menu_item_options", { p_item_id: itemId })) ?? [];
  const picked = new Set(chosen ?? []);
  if (!chosen) {
    for (const g of groups)
      for (const n of optionNames) {
        const hit = g.options.find((o: any) =>
          [o.name, o.name_en].some((x: string | null) => x && fuzzyEq(x, n)),
        );
        if (hit) picked.add(hit.option_id);
      }
  }
  const missing = groups.find(
    (g) => g.min > 0 && !g.options.some((o: any) => picked.has(o.option_id)),
  );
  // Items with 2+ option groups or more than 3 options open the item_options Flow (§12) when Flows are on.
  const optionCount = groups.reduce((n, g) => n + (g.options?.length ?? 0), 0);
  if (
    missing &&
    !chosen?.length &&
    !noFlow &&
    (groups.length >= 2 || optionCount > 3) &&
    (await openFlow(c, "item_options", { item_id: itemId }))
  )
    return false;
  if (missing) {
    c.s.pending = { kind: "options", item_id: itemId, qty, note, chosen: [...picked] };
    const label =
      c.s.refs[Object.keys(c.s.refs).find((k) => c.s.refs[k].id === itemId) ?? ""]?.label?.replace(
        / \$.*$/,
        "",
      ) ?? "";
    push(c, optionList(c.m.from, c.s.lang, label, missing));
    return false;
  }
  const r = await c.deps.rpc("basket_add_item", {
    p_customer_id: c.customerId,
    p_item_id: itemId,
    p_quantity: qty,
    p_option_ids: [...picked],
    p_note: note,
    p_replace: false,
  });
  if (r?.status === "other_vendor") {
    push(
      c,
      buttons(c.m.from, tr(c.s.lang, "otherVendor", { vendor: r.basket_vendor }), [
        [`rpl:${itemId}:${Math.min(qty, 50)}`, tr(c.s.lang, "replace")],
        ["c:keep", tr(c.s.lang, "keep")],
      ]),
    );
    return false;
  }
  if (r?.status === "unavailable") {
    say(c, "unavailable", { item: r.item });
    return false;
  }
  if (r?.status !== "added") {
    say(c, "pickPlaceFirst");
    return false;
  }
  c.basket = r.basket;
  if (c.s.pending.kind === "options") c.s.pending = {};
  return true;
}

async function optionChosen(c: Ctx, optionId: string) {
  const p = c.s.pending;
  if (p.kind !== "options") return say(c, "unsupported");
  const added = await addOne(c, p.item_id, p.qty, [], p.note, [...(p.chosen ?? []), optionId]);
  if (added) push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ًͯ-ٟ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
const fuzzyEq = (a: string, b: string) => {
  const x = fold(a);
  const y = fold(b);
  return x === y || (y.length >= 3 && (x.includes(y) || y.includes(x)));
};

async function checkout(
  c: Ctx,
  args: { fulfilment?: string | null; note?: string | null; stairs?: number | null },
) {
  const { deps } = c;
  if (args.fulfilment) c.s.fulfil = args.fulfilment === "pickup" ? "pickup" : "delivery";
  // Delivery / Pickup (§37.6): a shop that takes both is asked once per basket, before the pin or the quote. A choice kept in the
  // session from an earlier basket or shop is checked against what this shop takes, and dropped when it does not apply.
  const o = await deps.rpc("basket_fulfilment_options", { p_customer_id: c.customerId });
  if (o?.status === "ok") {
    if ((c.s.fulfil === "delivery" && !o.delivery) || (c.s.fulfil === "pickup" && !o.pickup)) c.s.fulfil = null;
    if (!c.s.fulfil) {
      if (o.pickup && o.delivery) {
        c.summary.push("[asked delivery or pickup]");
        return push(c, fulfilmentAsk(c.m.from, c.s.lang));
      }
      // A pickup-only shop: nothing to ask.
      if (o.pickup && !o.delivery) c.s.fulfil = "pickup";
    }
  }
  const fulfilment = args.fulfilment ?? c.s.fulfil;
  if (fulfilment || args.note || args.stairs != null)
    await deps.rpc("basket_set_checkout", {
      p_customer_id: c.customerId,
      p_fulfilment: fulfilment ?? null,
      p_address_id: null,
      p_stairs_floors: args.stairs ?? null,
      p_note: args.note ?? null,
    });
  let q: Quote = await deps.rpc("basket_quote", { p_customer_id: c.customerId });
  if (q?.status === "no_route" && (q as any).origin && (q as any).dest) {
    await deps.route((q as any).origin, (q as any).dest);
    q = await deps.rpc("basket_quote", { p_customer_id: c.customerId });
  }
  const lang = c.s.lang;
  if (q?.basket) c.basket = q.basket;
  switch (q?.status) {
    case "no_basket":
    case "empty_basket":
      return push(c, ...basketMessage(c.m.from, lang, null));
    case "no_address":
      c.s.pending = { kind: "await_pin" };
      return push(c, askPin(c.m.from, lang));
    case "place_paused":
      return say(c, "placePaused");
    case "no_route":
      return say(c, "noRoute");
    case "beyond_radius":
      return push(c, beyondRadius(c.m.from, lang, q));
    case "ok": {
      const lines: any[] = q.basket.lines ?? [];
      const needEmpty = lines.filter((l) => l.needs_empty_answer);
      if (needEmpty.length) {
        for (const l of needEmpty.slice(0, MAX_MESSAGES))
          push(
            c,
            emptyQuestion(
              c.m.from,
              lang,
              l.line_id,
              lang === "ar" ? l.name : (l.name_en ?? l.name),
              l.deposit_usd,
            ),
          );
        return;
      }
      // Grocery-type shops (§32.5): what to do if an item is out, asked once per basket.
      const sp = await deps.rpc("basket_substitution_needed", { p_customer_id: c.customerId });
      if (sp?.needed) {
        return push(c, substitutionAsk(c.m.from, lang, Number(sp.max_usd ?? 0)));
      }
      // Cash in USD or LBP (§34 step 8), asked once per basket and only if the shop takes both.
      const cs = await deps.rpc("basket_cash_state", { p_customer_id: c.customerId });
      if (cs?.status === "ok" && !cs.cash_currency && (cs.allowed?.length ?? 0) > 1)
        return push(c, cashAsk(c.m.from, lang, cs.allowed));
      const newCustomer = Number(c.profile?.delivered_orders ?? 0) === 0;
      push(c, ...summaryMessage(c.m.from, lang, q, newCustomer, cs?.cash_currency ?? null));
      if (!q.over_cod_cap) {
        c.s.pending = {
          kind: "confirm",
          basket_id: q.basket.basket_id,
          version: q.basket.menu_version,
        };
        c.summary.push("[showed the order summary; waiting for the customer's Confirm tap]");
        const u = await deps.rpc("basket_upsell", { p_customer_id: c.customerId });
        if (u?.item_id) push(c, upsellMessage(c.m.from, lang, u));
      }
      return;
    }
    default:
      c.deps.log?.("basket_quote unexpected", { status: String(q?.status) });
      return fail(c);
  }
}

// ---- Voice (§30.1.6) --------------------------------------------------------------------------------------------
async function voice(c: Ctx) {
  const { deps, m } = c;
  c.path = "voice";
  const a = m.audio!;
  // "listening…" within 2 s, before any download or model work.
  await deps.send(text(m.from, tr(c.s.lang, "listening")));
  if (a.bytes && a.bytes > deps.config.voiceMaxBytes) return say(c, "voiceLong");
  let transcript: string | null = null;
  if (deps.transcribe) {
    const q = await deps.rpc("ai_quota_take", {
      p_customer_id: c.customerId,
      p_purpose: "voice_transcribe",
      p_model: deps.config.transcriptionModel,
      p_est_usd: 0.004,
    });
    if (q?.ok) {
      const t0 = Date.now();
      try {
        const media = await deps.fetchMedia({ url: a.url, id: a.id });
        if (media) {
          const vocab: string[] =
            (await deps.rpc("voice_vocabulary", { p_customer_id: c.customerId, p_limit: 120 })) ??
            [];
          const t = await deps.transcribe(
            media.bytes,
            media.mime,
            vocabularyPrompt(vocab),
            deps.config.transcriptionModel,
          );
          transcript = t.text?.trim() || null;
          c.cost += Number(
            (await deps.rpc("ai_call_finish", {
              p_call_id: q.call_id,
              p_input_tokens: t.inputTokens ?? null,
              p_output_tokens: t.outputTokens ?? null,
              p_audio_seconds: t.seconds ?? null,
              p_latency_ms: Date.now() - t0,
              p_ok: !!transcript,
              p_error: null,
            })) ?? 0,
          );
        } else
          await deps.rpc("ai_call_finish", {
            p_call_id: q.call_id,
            p_input_tokens: null,
            p_output_tokens: null,
            p_audio_seconds: null,
            p_latency_ms: Date.now() - t0,
            p_ok: false,
            p_error: "media download failed",
          });
      } catch (e) {
        await deps.rpc("ai_call_finish", {
          p_call_id: q.call_id,
          p_input_tokens: null,
          p_output_tokens: null,
          p_audio_seconds: null,
          p_latency_ms: Date.now() - t0,
          p_ok: false,
          p_error: String(e).slice(0, 200),
        });
      }
    }
  }
  // Kapso's own transcript is the fallback when ours is unavailable.
  transcript ??= a.transcript?.trim() || null;
  if (!transcript) return say(c, "voiceFail");
  c.s.lang = detectLang(transcript, c.s.lang);
  const intent = deterministicIntent(transcript);
  if (intent && !["yes", "no", "greeting"].includes(intent.kind)) return textIntent(c, intent.kind);
  c.s.history.push({ r: "u", t: `[voice] ${transcript.slice(0, 280)}` });
  return modelTurn(c, transcript, true);
}

/** The transcription prompt: our own dish and place names, so Lebanese words come out spelled our way. */
export function vocabularyPrompt(terms: string[]): string {
  const head =
    "Lebanese food order, Arabic (Lebanese dialect) mixed with English or French. Words: ";
  let out = head;
  for (const t of terms) {
    if (out.length + t.length + 2 > 800) break;
    out += (out === head ? "" : ", ") + t;
  }
  return out;
}

// ---- The model turn -----------------------------------------------------------------------------------------------
function contextBlock(c: Ctx): string {
  const refs = Object.fromEntries(Object.entries(c.s.refs).map(([k, v]) => [k, v.label]));
  const basket = c.basket?.lines?.length
    ? {
        vendor: c.basket.vendor_en ?? c.basket.vendor,
        lines: (c.basket.lines as any[]).map(
          (l) =>
            `${refFor(c, "l", l.line_id, `${l.quantity}x ${l.name_en ?? l.name}`)}: ${l.quantity}x ${l.name_en ?? l.name}`,
        ),
      }
    : null;
  const focus = c.s.focus_vendor_id
    ? (Object.entries(c.s.refs).find(
        ([k, v]) => k.startsWith("v") && v.id === c.s.focus_vendor_id,
      )?.[0] ?? null)
    : null;
  return JSON.stringify({
    reply_language: {
      ar: "Lebanese Arabic",
      en: "English",
      fr: "French",
      arabizi: "Arabizi (Lebanese Arabic in Latin letters)",
    }[c.s.lang],
    beirut_time: (c.deps.now?.() ?? new Date()).toLocaleString("en-GB", {
      timeZone: "Asia/Beirut",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
    refs,
    focused_place: focus,
    basket,
    open_orders: c.orders.map((o) => ({ code: o.code, status: o.status })),
    pending_question: c.s.pending.kind ?? null,
    customer: {
      past_orders: c.profile?.delivered_orders ?? 0,
      usual_places: (c.profile?.usual_vendors ?? []).map((v: any) => v.name),
      usual_items: (c.profile?.usual_items ?? []).map((v: any) => v.name),
      saved_addresses: (c.profile?.addresses ?? []).map((a: any) => a.label ?? a.place_en),
      stated_preferences: c.profile?.preferences ?? {},
    },
  });
}

async function modelTurn(c: Ctx, userText: string, isVoice: boolean) {
  const { deps } = c;
  if (!deps.model) {
    // No key or no credit: the buttons, never an error or silence (§34).
    c.path = "budget";
    return push(c, mainMenu(c.m.from, c.s.lang, "aiOff"));
  }
  c.path = isVoice ? "voice" : "model";
  const complaint = looksLikeComplaint(userText);
  const models = complaint
    ? [deps.config.escalationModel]
    : [deps.config.customerModel, deps.config.escalationModel];
  const history = c.s.history
    .slice(-6)
    .map((h) => ({ role: h.r === "u" ? ("user" as const) : ("assistant" as const), content: h.t }));
  // The API needs alternating turns starting with the user; merge or drop to keep that shape.
  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  for (const h of history) {
    if (!msgs.length && h.role === "assistant") continue;
    if (msgs.length && msgs[msgs.length - 1].role === h.role)
      msgs[msgs.length - 1].content += `\n${h.content}`;
    else msgs.push({ ...h });
  }
  if (msgs.length && msgs[msgs.length - 1].role === "user") msgs.pop();
  const block = isVoice
    ? `<voice_transcript>\n${userText}\n</voice_transcript>`
    : `<customer_message>\n${userText}\n</customer_message>`;
  msgs.push({ role: "user", content: `<context>\n${contextBlock(c)}\n</context>\n${block}` });

  const deadline = Date.now() + deps.config.turnMs;
  let answered = false; // the API replied at least once (even with nothing usable)
  for (const model of models.slice(0, deps.config.maxCalls)) {
    const left = deadline - Date.now();
    if (left < 1500) break;
    const q = await deps.rpc("ai_quota_take", {
      p_customer_id: c.customerId,
      p_purpose: "customer_turn",
      p_model: model,
      p_est_usd: 0.006,
    });
    if (!q?.ok) {
      c.path = "budget";
      if (q?.reason === "customer_cap")
        return handoff(c, "daily AI budget reached for this customer");
      return push(c, mainMenu(c.m.from, c.s.lang, "aiOff"));
    }
    c.calls++;
    const t0 = Date.now();
    let res: ModelResponse | null = null;
    let err: string | null = null;
    try {
      res = await deps.model({
        model,
        system: SYSTEM_PROMPT,
        messages: msgs,
        tools: TOOLS,
        maxTokens: 700,
        timeoutMs: Math.min(left - 500, 7000),
      });
    } catch (e) {
      err = String(e).slice(0, 200);
    }
    const calls = res
      ? res.content.filter(
          (b): b is Extract<ModelResponse["content"][number], { type: "tool_use" }> =>
            b.type === "tool_use",
        )
      : [];
    const valid = calls.filter((t) => validate(t.name as ToolName, t.input));
    c.cost += Number(
      (await deps.rpc("ai_call_finish", {
        p_call_id: q.call_id,
        p_input_tokens: res?.usage.input_tokens ?? null,
        p_output_tokens: res?.usage.output_tokens ?? null,
        p_audio_seconds: null,
        p_latency_ms: Date.now() - t0,
        p_ok: !!res && (valid.length > 0 || res.content.some((b) => b.type === "text")),
        p_error: err ?? (res && calls.length !== valid.length ? "invalid tool input" : null),
      })) ?? 0,
    );
    if (!res) continue;
    answered = true;
    if (res.stop_reason === "refusal") continue;
    if (valid.length) {
      for (const t of valid) await runTool(c, t.name as ToolName, t.input);
      return;
    }
    const textOut = res.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    if (textOut && calls.length === 0) return replyText(c, textOut, "high");
  }
  // Every call failed (no credit, rate limit, outage, timeout): the buttons, and the customer is not counted
  // as unclear, so an API problem never hands anyone to a person (§34).
  if (!answered) {
    c.path = "error";
    return push(c, mainMenu(c.m.from, c.s.lang, "aiOff"));
  }
  // The model answered but nothing usable: no invented answer, one short question, the basket untouched.
  c.path = "error";
  c.s.low_confidence++;
  if (c.s.low_confidence >= deps.config.lowConfidenceHandoff)
    return handoff(c, "the assistant could not understand twice");
  say(c, "busy");
}

/** Server-side check of every tool input (the prompt is not a security boundary). */
export function validate(name: ToolName, input: any): boolean {
  const s = (v: unknown, max = 200) => v === null || (typeof v === "string" && v.length <= max);
  const ref = (v: unknown, p: string) =>
    typeof v === "string" && new RegExp(`^${p}\\d{1,2}$`).test(v);
  if (!input || typeof input !== "object") return false;
  switch (name) {
    case "search_vendors":
      return s(input.query, 120) && s(input.business_type, 40);
    case "show_menu":
      return ref(input.vendor_ref, "v") && s(input.query, 120);
    case "dietary_menu": {
      const arr = (v: unknown, allowed: readonly string[]) =>
        v === null ||
        (Array.isArray(v) && v.length <= 12 && v.every((x) => allowed.includes(String(x))));
      const num = (v: unknown, max: number) =>
        v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max);
      return (
        ref(input.vendor_ref, "v") &&
        arr(input.free_from, ALLERGENS) &&
        arr(input.diets, DIETS) &&
        arr(input.tags, NUTRITION_TAGS) &&
        num(input.max_kcal, 5000) &&
        num(input.min_protein_g, 300)
      );
    }
    case "add_items":
      return (
        (input.vendor_ref === null || ref(input.vendor_ref, "v")) &&
        Array.isArray(input.items) &&
        input.items.length >= 1 &&
        input.items.length <= 10 &&
        input.items.every(
          (i: any) =>
            (i.item_ref === null || ref(i.item_ref, "i")) &&
            s(i.name, 120) &&
            (i.item_ref || i.name) &&
            Number.isInteger(i.quantity) &&
            i.quantity >= 1 &&
            i.quantity <= 50 &&
            Array.isArray(i.options) &&
            i.options.length <= 6 &&
            i.options.every((o: unknown) => typeof o === "string" && o.length <= 60) &&
            s(i.note, 200),
        )
      );
    case "change_basket":
      return (
        ref(input.line_ref, "l") &&
        Number.isInteger(input.quantity) &&
        input.quantity >= 0 &&
        input.quantity <= 50
      );
    case "show_basket":
    case "track_order":
    case "cancel_order":
      return true;
    case "checkout":
      return (
        [null, "delivery", "pickup"].includes(input.fulfilment) &&
        s(input.note, 300) &&
        (input.stairs_floors === null ||
          (Number.isInteger(input.stairs_floors) &&
            input.stairs_floors >= 0 &&
            input.stairs_floors <= 30))
      );
    case "find_address":
      return typeof input.text === "string" && input.text.length > 0 && input.text.length <= 200;
    case "address_details":
      return s(input.building, 120) && s(input.floor, 20) && s(input.note, 300);
    case "note_location":
      return (
        ["landmark_name", "building_name", "street_name", "place_alias"].includes(input.kind) &&
        typeof input.text === "string" &&
        input.text.length > 1 &&
        input.text.length <= 120
      );
    case "set_preference":
      return (
        [
          "vegetarian",
          "vegan",
          "no_pork",
          "no_alcohol",
          "fasting",
          "allergy",
          "spice",
          "note",
        ].includes(input.key) &&
        typeof input.value === "string" &&
        input.value.length <= 120
      );
    case "reorder":
      return ["last", "usual"].includes(input.which);
    case "request_human":
      return typeof input.reason === "string" && input.reason.length <= 300;
    case "reply":
      return (
        typeof input.text === "string" &&
        input.text.length > 0 &&
        input.text.length <= 600 &&
        ["high", "low"].includes(input.confidence)
      );
    default:
      return false;
  }
}

function replyText(c: Ctx, raw: string, confidence: "high" | "low") {
  // The price guard: a model never states an amount (alo-ai-tool-safety "Grounding").
  const t = raw.replace(/\s+/g, " ").trim().slice(0, 600);
  if (PRICE_RE.test(t)) {
    c.deps.log?.("model text dropped by the price guard");
    say(c, "pickPlaceFirst");
  } else push(c, text(c.m.from, t));
  c.summary.push(t.slice(0, 200));
  if (confidence === "low") {
    c.s.low_confidence++;
    if (c.s.low_confidence >= c.deps.config.lowConfidenceHandoff)
      return handoff(c, "two unclear messages in a row");
  } else c.s.low_confidence = 0;
}

async function runTool(c: Ctx, name: ToolName, input: any) {
  const { deps } = c;
  const id = c.customerId;
  c.tools.push(name);
  switch (name) {
    case "search_vendors":
      return searchVendors(c, input.query, input.business_type);
    case "show_menu":
      return showMenu(c, input.vendor_ref, input.query);
    case "dietary_menu":
      return dietaryMenu(c, input);
    case "add_items": {
      const vref = input.vendor_ref ?? null;
      const vendorId = vref
        ? c.s.refs[vref]?.id
        : (c.s.focus_vendor_id ?? c.basket?.vendor_id ?? null);
      let added = 0;
      for (const it of input.items) {
        let itemId: string | null = it.item_ref ? (c.s.refs[it.item_ref]?.id ?? null) : null;
        if (!itemId && it.name) {
          if (!vendorId) {
            // No place yet: search for the dish instead of guessing a vendor.
            return searchVendors(c, it.name, null);
          }
          const rows: any[] =
            (await deps.rpc("vendor_menu", {
              p_vendor_id: vendorId,
              p_query: it.name,
              p_section_id: null,
              p_limit: 3,
              p_offset: 0,
            })) ?? [];
          const best = rows[0];
          const clear =
            best &&
            Number(best.score) >= 0.45 &&
            (!rows[1] || Number(best.score) - Number(rows[1].score) >= 0.1);
          if (!clear) {
            const vr = refFor(c, "v", vendorId, c.basket?.vendor_en ?? c.basket?.vendor ?? "");
            return showMenu(c, vr, it.name);
          }
          itemId = best.item_id;
          refFor(
            c,
            "i",
            best.item_id,
            `${best.name_en ?? best.name_ar} $${Number(best.price_usd).toFixed(2)}`,
          );
        }
        if (!itemId) continue;
        const ok = await addOne(c, itemId, it.quantity, it.options ?? [], it.note ?? null, null);
        if (!ok) return; // an option question, another vendor's basket, or unavailable: one thing at a time
        added++;
      }
      if (added) {
        c.summary.push(`[added ${added} item(s) to the basket]`);
        push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
      }
      return;
    }
    case "change_basket": {
      const line = c.s.refs[input.line_ref];
      if (!line) return push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
      const r = await deps.rpc("basket_set_quantity", {
        p_customer_id: id,
        p_line_id: line.id,
        p_quantity: input.quantity,
      });
      c.basket = r?.basket ?? c.basket;
      return push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
    }
    case "show_basket":
      return push(c, ...basketMessage(c.m.from, c.s.lang, c.basket as Basket));
    case "checkout":
      return checkout(c, {
        // Only the customer's own tap says "delivery" (§37.6): a model that guesses it must not skip the Delivery / Pickup card.
        fulfilment: input.fulfilment === "pickup" ? "pickup" : null,
        note: input.note,
        stairs: input.stairs_floors,
      });
    case "track_order":
      return track(c);
    case "cancel_order":
      return askCancel(c);
    case "find_address": {
      const pt = await deps.rpc("customer_search_point", { p_customer_id: id });
      const cands: any[] =
        (await deps.rpc("resolve_location", {
          p_text: input.text,
          p_lat: pt?.lat ?? null,
          p_lon: pt?.lon ?? null,
          p_customer_id: id,
          p_limit: 3,
        })) ?? [];
      const top = cands[0];
      c.s.pending = { kind: "await_pin" };
      c.summary.push(
        top ? `[address words matched ${top.label_en}; asked for a pin]` : "[asked for a pin]",
      );
      if (top?.place_status === "paused") return say(c, "placePaused");
      return push(
        c,
        askPin(c.m.from, c.s.lang, top ? (c.s.lang === "ar" ? top.label_ar : top.label_en) : null),
      );
    }
    case "address_details": {
      const pt = await deps.rpc("customer_search_point", { p_customer_id: id });
      if (!pt?.address_id) return push(c, askPin(c.m.from, c.s.lang));
      await deps.rpc("address_set_details", {
        p_customer_id: id,
        p_address_id: pt.address_id,
        p_building: input.building,
        p_floor: input.floor,
        p_note: input.note,
        p_label: null,
      });
      return say(c, "done");
    }
    case "note_location":
      await deps.rpc("observe_location", {
        p_customer_id: id,
        p_kind: input.kind,
        p_text: input.text,
        p_address_id: null,
        p_order_id: null,
      });
      return;
    case "set_preference":
      await deps.rpc("customer_preference_set", {
        p_customer_id: id,
        p_key: input.key,
        p_value: input.value,
      });
      return;
    case "reorder":
      return reorder(c);
    case "request_human":
      return handoff(c, input.reason);
    case "reply":
      return replyText(c, input.text, input.confidence);
  }
}
