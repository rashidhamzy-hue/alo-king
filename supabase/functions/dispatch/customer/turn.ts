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
import { RpcStalled, TurnBusy } from "../../_shared/rest-rpc.ts";
import { clampInteractive } from "../../_shared/meta-limits.ts";
import {
  deterministicIntent,
  detectLang,
  FACT_RE,
  isMedicineRequest,
  isMemoryQuestion,
  isOffTopic,
  looksLikeComplaint,
  mentionsSomeoneElse,
  PRICE_RE,
} from "./intents.ts";
import { readQuantity, readRecipient } from "../../_shared/lexicon.ts";
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
  notOnAloKingCard,
  qtyList,
  sectionList,
  substitutionAsk,
  dietaryList,
  optionList,
  summaryMessage,
  trackMessage,
  tr,
  belowMinimumMessage,
  upsellMessage,
  vendorChoices,
  where,
  addressConfirmCard,
  catalogList,
  consentAsk,
  forWhomCard,
  memoryCard,
  problemLinesList,
  problemQtyList,
  problemList,
  welcomeBack,
  cravingList,
  shopList,
  shopLine,
  moreSectionsList,
  sectionNextButton,
  type BrowseCategory,
  type BrowseShop,
  type ShopCard,
  type CatalogItem,
  type Basket,
  type MenuRow,
  type Quote,
  type Track,
  sayMessage,
  splitCartList,
  otherVendorCard,
  savedCartOfferCard,
} from "./render.ts";
import {
  ALLERGENS,
  DIETS,
  NUTRITION_TAGS,
  PREFERENCE_KEYS,
  SYSTEM_PROMPT,
  TOOLS,
  type ToolName,
} from "./tools.ts";
import { buttons, customerStatusMessages, image, moneyLine } from "../../_shared/customer-cards.ts";
import { flowMessage, parseFlowReply, type FlowName } from "../../_shared/flows.ts";
import {
  packShopMenu,
  parseCartOrder,
  productListMessage,
  productMessage,
  type CartLine,
  type CatalogProduct,
  type ShopMenuSection,
} from "../../_shared/catalog.ts";
import { joinLink } from "../../_shared/site-claim.ts";

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
  /** The business number replies go out from: the Meta catalogue is per business account (§39.12). */
  senderNumberId?: string | null;
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
  /** A short-lived link to a private photo (bucket menu-item-photos), for a shop's cover; null without storage. */
  photoUrl?: ((path: string) => Promise<string | null>) | null;
  /**
   * The one live road route at checkout, shop → customer pin (DECISIONS §39.15.1): the route cache, then OpenRouteService
   * within the server's daily budget (a simulator number reads recorded routes); null when unknown. `force`: the customer
   * tapped Try again. Browse never calls it: it reads the shop → place distances.
   */
  route: (
    origin: { lat: number; lon: number },
    dest: { lat: number; lon: number },
    opts?: { phone?: string; force?: boolean },
  ) => Promise<unknown | null>;
  config: {
    customerModel: string;
    escalationModel: string;
    transcriptionModel: string;
    maxCalls: number;
    turnMs: number;
    lowConfidenceHandoff: number;
    voiceMaxBytes: number;
    /** The site-claim edge function's public URL, for the "Ask them to join" link (§39.3); null without one. */
    joinFunctionUrl?: string | null;
    /**
     * Model turns for typed text (config ai_free_text_enabled) and voice notes (ai_voice_enabled): off until the evals
     * pass (DECISIONS §32.4, §39.6). Off, typed text goes to the catalogue search and the rules, never to a model, and a
     * voice note gets the buttons. Undefined counts as on (unit tests of the model path); dispatch always sets both.
     */
    freeText?: boolean;
    voice?: boolean;
    /** "What are you craving?" shows when at least this many shops deliver (config browse_categories_min_shops). */
    browseMinShops?: number;
    /** Items per section in a shop's first product message (config browse_first_section_items). */
    firstSectionItems?: number;
    /**
     * A shop with fewer Meta-approved photo items than this opens with the list menu, not a thin product message (config
     * browse_min_catalog_items, DECISIONS §39.15.2).
     */
    browseMinCatalogItems?: number;
    /** The public site's address (config public_site_url); null until it answers (§39.15.7). */
    siteUrl?: string | null;
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
  /** A cart sent from the Meta catalogue (§39.12): item ids and quantities; the catalogue's price only to report a difference. */
  cart?: { lines: CartLine[] } | null;
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
  /** basket adds in this turn (each keyed by message id + this number). */
  adds: number;
  calls: number;
  cost: number;
  path: "deterministic" | "model" | "voice" | "handoff" | "budget" | "error";
  summary: string[];
  /** Held support replies in this turn's messages, marked shown once they are sent. */
  shownReplies?: number[];
  /** The catalogue replies may use (§39.12): undefined until asked, null when there is none. */
  catalog?: string | null;
  /** What to send instead when a catalogue message is refused (a product Meta does not have yet, §39.12). */
  fallbacks?: Map<Msg, Msg | null>;
};

const MAX_MESSAGES = 3;
/** Queue attempts that replay a stalled turn before the customer is shown the buttons instead. */
const STALL_REPLAYS = 3;
const push = (c: Ctx, ...ms: Msg[]) => {
  for (const x of ms) if (c.out.length < MAX_MESSAGES) c.out.push(x);
};
/** An error reply always carries buttons (render.ts ERROR_WAYS, DECISIONS §39.15.1); anything else is plain text. */
const say = (c: Ctx, key: string, v: Record<string, unknown> = {}) =>
  push(c, sayMessage(c.m.from, c.s.lang, key, v));
/**
 * Something failed on our side (T2): the customer sees the buttons, never "I'm a bit slow" (that wording is for a
 * model that answered nothing usable). The failure itself is logged by the caller.
 */
const fail = (c: Ctx) => push(c, mainMenu(c.m.from, c.s.lang, "tapFailed"));

export async function handleCustomerTurn(
  deps: CustomerDeps,
  m: CustomerInbound,
  opts: { attempt?: number; leaseUntil?: Date } = {},
): Promise<"done" | "duplicate"> {
  const started = Date.now();
  const kind = m.buttonId ? "tap" : m.type;
  // A queue retry (attempt 2+) of a turn whose first attempt died before customer_turn_end replays it from the
  // session the customer saw; a finished turn or a second delivery of the same message is a duplicate (#139).
  // This attempt's own lease on the turn: only it can give the turn back.
  const leaseId = crypto.randomUUID();
  const release = () =>
    deps
      .rpc("customer_turn_release", { p_message_id: m.messageId, p_lease_id: leaseId })
      .catch((x: unknown) => deps.log?.("turn release failed", { error: String(x).slice(0, 120) }));
  const begin = await deps
    .rpc("customer_turn_begin", {
      p_phone_e164: m.from,
      p_message_id: m.messageId,
      p_kind: kind.replace(/[^a-z_]/g, "_").slice(0, 40) || "unknown",
      p_display_name: m.name,
      p_attempt: Math.max(1, Math.trunc(opts.attempt ?? 1)),
      p_lease_id: leaseId,
      p_lease_until: opts.leaseUntil?.toISOString() ?? null,
    })
    .catch(async (e: unknown) => {
      // It may have begun the turn and taken its lease before the answer was lost: give it back, then fail.
      if (e instanceof RpcStalled) await release();
      throw e;
    });
  if (begin?.duplicate) return "duplicate";
  // Busy: this message's turn is held by another attempt, or the customer's previous turn is still running (its
  // session may not be saved yet). The event fails and the queue tries again within seconds.
  if (begin?.busy) throw new TurnBusy(m.messageId);
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
    adds: 0,
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
    } else {
      // Replies a person sent while the customer was outside the window come with whatever they write next (any message
      // reopens the window), not only with the template's button; the handoff may have ended meanwhile.
      if (c.m.buttonId !== "c:support") await heldReplies(c);
      if (sess.handoff) await duringHandoff(c);
      else await route(c, !!begin.first_contact);
    }
  } catch (e) {
    // A stalled request (#139): nothing has been sent and the session is untouched, so the event fails and the
    // queue replays the whole turn within seconds. After STALL_REPLAYS attempts the customer gets the buttons.
    if (e instanceof RpcStalled && (opts.attempt ?? 1) < STALL_REPLAYS) {
      // Give the turn back so the queue's retry can replay it (best effort: the lease also expires by itself).
      await release();
      throw e;
    }
    c.path = "error";
    deps.log?.("customer turn failed", { error: String(e).slice(0, 200) });
    if (!c.out.length) fail(c);
  }

  for (const p of c.out) {
    let r = await deps.send(clampInteractive(p));
    if (!r.ok && r.retry) r = await deps.send(clampInteractive(p)); // Kapso 409 (one in flight) or 5xx: once more
    // A catalogue message Meta refused (a product not in the catalogue yet, a catalogue not connected): the list instead.
    const fb = c.fallbacks?.get(p);
    if (!r.ok && fb) {
      deps.log?.("catalogue message refused, list sent", { error: r.error.slice(0, 120) });
      r = await deps.send(clampInteractive(fb));
    }
    if (!r.ok) deps.log?.("customer send failed", { error: r.error.slice(0, 120) });
  }
  // Held support replies count as shown only once the turn's messages went out (a replayed turn finds them again).
  if (c.shownReplies?.length)
    await deps
      .rpc("support_shown", { p_customer_id: c.customerId, p_ids: c.shownReplies })
      .catch((e: unknown) =>
        deps.log?.("support_shown failed", { error: String(e).slice(0, 120) }),
      );
  if (m.text) c.s.history.push({ r: "u", t: m.text.slice(0, 300) });
  if (c.summary.length) c.s.history.push({ r: "a", t: c.summary.join(" ").slice(0, 300) });
  // The session row has no fulfil column, so the choice travels in refs (prefix "fx", never used by the lists).
  delete c.s.refs.fx;
  if (c.s.fulfil) c.s.refs.fx = { id: c.s.fulfil, label: c.s.fulfil };
  // The replies are out: from here nothing may fail the event, or the queue would replay a turn the customer has
  // already been answered for (#139). A session that could not be saved keeps the previous one.
  try {
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
  } catch (e) {
    deps.log?.("customer turn end failed", { error: String(e).slice(0, 200) });
  }
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
  // "Read the reply" on the support template: the person's held replies, and the conversation stays with them.
  if (c.m.buttonId === "c:support") return showSupportReplies(c);
  const leaves = !!c.m.buttonId || intent?.kind === "greeting" || intent?.kind === "menu";
  if (leaves) {
    await c.deps.rpc("customer_handoff_end", { p_customer_id: c.customerId });
    c.s.pending = {};
    c.tools.push("handoff_end");
    return route(c, false);
  }
  c.path = "handoff";
  // The message joins the support case's Slack thread, where Rasheed answers (§32.1).
  if (c.m.text) {
    const joined = await c.deps
      .rpc("support_inbound", { p_customer_id: c.customerId, p_text: c.m.text })
      .catch(() => false);
    if (joined === true) c.tools.push("support_inbound");
  }
  // Never silent (§34): every message during the handoff gets the waiting card with its Menu button.
  push(c, handoffWaitCard(c.m.from, c.s.lang));
}

/** The replies a person sent while the customer was outside the 24-hour window (held behind the template). */
async function heldReplies(c: Ctx): Promise<number> {
  const replies: { id: number; name: string | null; text: string }[] =
    (await c.deps.rpc("support_pending", { p_customer_id: c.customerId }).catch(() => [])) ?? [];
  if (!Array.isArray(replies) || !replies.length) return 0;
  c.tools.push("support_pending");
  c.shownReplies = replies.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
  for (const r of replies)
    push(
      c,
      ...customerStatusMessages(
        c.m.from,
        { kind: "support_reply", lang: c.s.lang, name: r.name, text: r.text },
        null,
      ),
    );
  return replies.length;
}

/** "Read the reply" on the support template. */
async function showSupportReplies(c: Ctx) {
  c.path = "handoff";
  if (!(await heldReplies(c))) push(c, handoffWaitCard(c.m.from, c.s.lang));
}

async function route(c: Ctx, firstContact: boolean) {
  const m = c.m;
  // A marketing template's "Stop promotions" button is STOP (§18.3, §39.8): honoured at once, like the typed word.
  if (m.buttonId === "mkt:stop") return textIntent(c, "stop");
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
  if (m.audio) {
    if (c.deps.config.voice === false) {
      c.tools.push("voice_off");
      return push(c, mainMenu(m.from, c.s.lang, "voiceOff"));
    }
    return voice(c);
  }
  if (m.text === null || !m.text.trim()) return say(c, "unsupported");
  // The website's "Add in WhatsApp" (an item page, DECISIONS §39.15.2) sends the item's code: added deterministically.
  const code = itemCodeIn(m.text);
  if (code) return itemFromSite(c, code, itemCodeTail(m.text));
  const intent = deterministicIntent(m.text);
  if (intent) {
    if ((intent.kind === "yes" || intent.kind === "no") && !c.s.pending.kind)
      return freeText(c, m.text);
    if (intent.kind === "greeting") return greet(c, firstContact);
    return textIntent(c, intent.kind);
  }
  // Rules that never reach a model or a search (§38.3, §39.6).
  if (isMemoryQuestion(m.text)) return showMemory(c);
  if (isMedicineRequest(m.text)) return medicine(c);
  if (c.s.pending.kind === "recipient") return recipientText(c, m.text);
  if (isOffTopic(m.text)) return offTopic(c);
  if (mentionsSomeoneElse(m.text)) c.s.refs.xe = { id: "someone_else", label: "someone_else" };
  if (firstContact && m.text.trim().length < 4) return push(c, mainMenu(m.from, c.s.lang));
  return freeText(c, m.text);
}

/** The item code an item page puts in its WhatsApp text: i-<item id>. */
export function itemCodeIn(t: string): string | null {
  const m = ITEM_CODE_RE.exec(t);
  return m ? m[1].toLowerCase() : null;
}
const ITEM_CODE_RE =
  /(?:^|[^0-9a-z-])i-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-z-])/i;

/**
 * What the customer typed after the code in the pre-filled text ("… (i-…) x2, no garlic"): a quantity, only when the
 * first word after the code is one ("x2", "2", "deux"), and the rest, unchanged, as the note the shop reads ("cut in 4"
 * stays a note, never 4 items). The pre-filled words before the code (a name with digits, "un", "deux") are never read.
 */
export function itemCodeTail(t: string): { qty: number; note: string | null } {
  const m = ITEM_CODE_RE.exec(t);
  const tail = (m ? t.slice(m.index + m[0].length) : "")
    .replace(/^\s*\)/, "")
    .replace(/^[\s,.;:،-]+/, "");
  const first = /^\S+/.exec(tail)?.[0] ?? "";
  const word = first.toLowerCase().replace(/[.,!?؟،]+$/g, "");
  const qty = first && !["un", "une"].includes(word) ? readQuantity(first).qty : null;
  const note = (qty !== null ? tail.slice(first.length) : tail)
    .replace(/^[\s,.;:،-]+|[\s,.;:،-]+$/g, "")
    .trim();
  return { qty: qty ?? 1, note: note ? Array.from(note).slice(0, 80).join("") : null };
}

/** "Add in WhatsApp" from the item's web page: the item into the basket, its choices asked as for any item. */
async function itemFromSite(c: Ctx, itemId: string, extra: { qty: number; note: string | null }) {
  c.tools.push("site_item");
  const added = await addOne(c, itemId, extra.qty, [], extra.note, null);
  if (added) push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
}

/** Typed text: the model when free text is on and a model exists; otherwise the catalogue search (§32.4, §39.6). */
async function freeText(c: Ctx, t: string) {
  if (c.deps.config.freeText !== false && c.deps.model) return modelTurn(c, t, false);
  return catalogText(c, t, null);
}

/** A greeting: the 2-tap "same again / new order" for a returning customer (§38.3), the main menu otherwise. */
async function greet(c: Ctx, firstContact: boolean) {
  c.tools.push("intent:greeting");
  const last = c.profile?.last_order;
  if (!firstContact && last?.order_id && Number(c.profile?.delivered_orders ?? 0) > 0)
    return push(c, welcomeBack(c.m.from, c.s.lang, last, c.profile?.name ?? null));
  return push(c, mainMenu(c.m.from, c.s.lang));
}

/** Medicines are never ordered through Alo King (§38.3, Order of Pharmacists, 2 June 2026). */
function medicine(c: Ctx) {
  c.tools.push("refuse:medicine");
  c.summary.push("[refused a medicine request and pointed to a pharmacy]");
  return push(c, mainMenu(c.m.from, c.s.lang, "medicine"));
}

function offTopic(c: Ctx) {
  c.tools.push("refuse:off_topic");
  return push(c, mainMenu(c.m.from, c.s.lang, "offTopic"));
}

// ---- The catalogue search (§39.6): one index across every orderable menu in the customer's area ----------------------
async function catalogText(c: Ctx, raw: string, qtyArg: number | null) {
  const { qty, rest } = readQuantity(raw);
  const quantity = qtyArg ?? qty;
  const q = (rest || raw).trim().slice(0, 120);
  c.tools.push("catalog_search");
  const r = await c.deps.rpc("catalog_search", {
    p_customer_id: c.customerId,
    p_query: q,
    p_limit: 10,
  });
  const items: any[] = r?.status === "ok" && Array.isArray(r.items) ? r.items : [];
  if (items.length) {
    resetRefs(c, "i");
    const hints =
      (await c.deps.rpc("menu_item_hints", { p_item_ids: items.map((x) => x.item_id) })) ?? {};
    const rows: CatalogItem[] = items.map((x) => ({
      ...x,
      ref: refFor(
        c,
        "i",
        x.item_id,
        `${x.name_en ?? x.name_ar} $${Number(x.price_usd).toFixed(2)}`,
      ),
      hint: hints?.[x.item_id]?.may_contain ?? [],
    }));
    c.s.pending = quantity ? { kind: "qty_hint", qty: Math.min(Math.max(quantity, 1), 50) } : {};
    c.summary.push(
      `[catalogue: ${rows.length} items for "${q}"${quantity ? `, quantity ${quantity}` : ""}]`,
    );
    const listMsg = catalogList(c.m.from, c.s.lang, q, rows, quantity);
    // No quantity typed and the catalogue on: the results as product messages (§39.12, session 5e), one item as a
    // single-product message, several as one multi-product message grouped by shop; the list stands in if Meta refuses.
    if (!quantity && (await catalogFor(c))) {
      const ids = items.map((x) => String(x.item_id));
      const got = await c.deps
        .rpc("catalog_products_for", { p_item_ids: ids, p_catalog_id: c.catalog })
        .catch(() => null);
      // A thin shop's results go in the list, as its menu does (§39.15.2: search uses the same rule per shop).
      const products: (CatalogProduct & { vendor_id?: string; shop_shown?: number })[] = (
        Array.isArray(got) ? got : []
      ).filter(
        (p: { shop_shown?: number }) =>
          Number(p.shop_shown ?? 999) >= (c.deps.config.browseMinCatalogItems ?? 6),
      );
      // The results Meta shows go in the product message; the others follow as a list (§39.15.2), so none is lost.
      if (products.length) {
        c.tools.push("catalog:search");
        const oneShop = new Set(products.map((x) => x.vendor_id)).size === 1;
        const body = tr(
          c.s.lang,
          products.length === 1 ? "catalogOne" : oneShop ? "catalogSearch" : "searchShops",
          { q: q.slice(0, 40) },
        );
        const inMessage = new Set(products.map((p) => String(p.retailer_id)));
        const others = rows.filter((r) => !inMessage.has(String(r.item_id)));
        // If Meta refuses the product message, a list of the same items stands in; the others follow either way.
        pushCatalog(
          c,
          products.length === 1
            ? productMessage(
                c.m.from,
                c.catalog!,
                products[0].retailer_id,
                body,
                tr(c.s.lang, "catalogFooter"),
              )
            : productListMessage(
                c.m.from,
                c.catalog!,
                oneShop
                  ? localName(c.s.lang, products[0].section ?? null, products[0].section_en ?? null)
                  : tr(c.s.lang, "searchHeader", { q: q.slice(0, 40) }),
                body,
                products,
                { lang: c.s.lang, footer: tr(c.s.lang, "catalogFooter") },
              ),
          others.length
            ? catalogList(
                c.m.from,
                c.s.lang,
                q,
                rows.filter((r) => inMessage.has(String(r.item_id))),
                quantity,
              )
            : listMsg,
        );
        if (others.length) push(c, catalogList(c.m.from, c.s.lang, q, others, quantity, true));
        return;
      }
    }
    return push(c, listMsg);
  }
  // A shop's name (on Alo King, or not yet: §39.3) is answered by the place search.
  const named: any[] =
    q.length >= 3
      ? ((await c.deps.rpc("vendor_search", {
          p_query: q,
          p_lat: null,
          p_lon: null,
          p_business_type: null,
          p_cuisine: null,
          p_limit: 3,
          p_customer_id: c.customerId,
        })) ?? [])
      : [];
  if (named.some((x) => x.matched === "name")) return searchVendors(c, q, null);
  const unclaimed: any[] =
    q.length >= 3
      ? ((await c.deps.rpc("vendor_search_unclaimed", { p_query: q, p_limit: 1 })) ?? [])
      : [];
  if (unclaimed.length) return searchVendors(c, q, null);
  c.summary.push(`[catalogue: nothing for "${q}"]`);
  return push(c, mainMenu(c.m.from, c.s.lang, "catalogNone", { q: q.slice(0, 40) }));
}

// ---- Memory (§39.6) ------------------------------------------------------------------------------------------------
async function showMemory(c: Ctx) {
  c.tools.push("show_memory");
  const mem = await c.deps.rpc("customer_memory", { p_customer_id: c.customerId });
  resetRefs(c, "a");
  const refs = ((mem?.addresses ?? []) as any[]).map((a) =>
    refFor(c, "a", a.address_id, String(a.label ?? a.place_en ?? "")),
  );
  c.summary.push("[showed what Alo King remembers, with delete buttons]");
  return push(c, ...memoryCard(c.m.from, c.s.lang, mem ?? {}, refs));
}

const MEMORY_PART: Record<string, string> = {
  all: "all",
  name: "name",
  lang: "language",
  orders: "orders",
  addrs: "addresses",
  facts: "facts",
  address: "address",
  fact: "fact",
};
async function forgetPart(c: Ctx, part: string, ref?: string) {
  const target = part === "address" ? c.s.refs[ref ?? ""]?.id : ref;
  if (part === "address" && !target) return showMemory(c);
  await c.deps.rpc("customer_memory_forget", {
    p_customer_id: c.customerId,
    p_part: MEMORY_PART[part],
    p_ref: target ?? null,
  });
  c.tools.push(`forget:${part}`);
  if (part === "all") {
    c.s = { ...c.s, history: [], refs: {}, pending: {}, focus_vendor_id: null, fulfil: null };
    return say(c, "deletedData");
  }
  if (part === "orders") c.s.history = [];
  say(c, "memDeleted");
  return showMemory(c);
}

/** What the customer says about themselves; health information waits for the consent tap (§39.6, Law 81/2018). */
async function rememberFact(c: Ctx, key: string, value: string) {
  const r = await c.deps.rpc("customer_fact_set", {
    p_customer_id: c.customerId,
    p_key: key,
    p_value: value,
    p_source: "said",
    p_consent: false,
  });
  if (r?.status === "needs_consent") {
    c.s.refs.xm = { id: key, label: String(r.value ?? value).slice(0, 60) };
    push(c, consentAsk(c.m.from, c.s.lang, key, String(r.value ?? value)));
  }
}

// ---- The address on every order and who the order is for (§22.1, §39.6) --------------------------------------------
async function recipientText(c: Ctx, t: string) {
  const addressId = c.s.pending.address_id;
  const { name, phone } = readRecipient(t);
  if (!addressId) {
    c.s.pending = {};
    return checkout(c, {});
  }
  if (!name || !phone) return say(c, "recipientBad");
  const r = await c.deps.rpc("address_set_recipient", {
    p_customer_id: c.customerId,
    p_address_id: addressId,
    p_name: name,
    p_phone: phone,
  });
  if (r?.status === "own_number") return say(c, "recipientOwn");
  if (r?.status !== "saved") return say(c, "recipientBad");
  c.s.pending = {};
  c.tools.push("gift_recipient");
  say(c, "recipientSaved", { name: r.name });
  return checkout(c, {});
}

// ---- Problems with a delivered order (§20.1, §38.3): the server decides ------------------------------------------------
async function problemStart(c: Ctx, orderId: string | null, kind: string | null): Promise<void> {
  let order = orderId ? { order_id: orderId, code: c.s.refs.xd?.label ?? "" } : null;
  if (orderId && !order?.code) {
    const t = await c.deps.rpc("order_track", { p_customer_id: c.customerId, p_order_id: orderId });
    order = { order_id: orderId, code: t?.code ?? "" };
  }
  if (!order) {
    const last = await c.deps.rpc("customer_last_delivered", { p_customer_id: c.customerId });
    if (!last?.order_id) return say(c, "disputeNone");
    order = { order_id: last.order_id, code: last.code };
  }
  c.s.refs.xd = { id: order.order_id, label: order.code };
  if (!kind) return push(c, problemList(c.m.from, c.s.lang, order.code));
  return problemKind(c, kind as any);
}

async function problemKind(c: Ctx, kind: string): Promise<void> {
  const order = c.s.refs.xd;
  if (!order) return problemStart(c, null, kind);
  if (kind === "missing_item" || kind === "wrong_item") {
    const lines: any[] =
      (await c.deps.rpc("order_lines_for_customer", {
        p_customer_id: c.customerId,
        p_order_id: order.id,
      })) ?? [];
    if (lines.length === 1) return problemLine(c, lines[0].order_item_id, kind, undefined, lines);
    return push(c, problemLinesList(c.m.from, c.s.lang, kind, lines));
  }
  return disputeOpen(c, kind, null);
}

/** A line of more than one asks how many first: the credit is per unit (§38.3). */
async function problemLine(
  c: Ctx,
  itemId: string,
  kind: "missing_item" | "wrong_item",
  qty?: number,
  known?: any[],
): Promise<void> {
  if (qty === undefined) {
    const order = c.s.refs.xd;
    const lines: any[] =
      known ??
      (order
        ? ((await c.deps.rpc("order_lines_for_customer", {
            p_customer_id: c.customerId,
            p_order_id: order.id,
          })) ?? [])
        : []);
    const line = lines.find((l) => l.order_item_id === itemId);
    if (line && Number(line.quantity) > 1)
      return push(
        c,
        problemQtyList(c.m.from, c.s.lang, kind, { ...line, quantity: Number(line.quantity) }),
      );
  }
  return disputeOpen(c, kind, itemId, qty ?? 1);
}

async function disputeOpen(c: Ctx, kind: string, itemId: string | null, qty = 1): Promise<void> {
  const order = c.s.refs.xd;
  if (!order) return say(c, "disputeNone");
  const r = await c.deps.rpc("dispute_open", {
    p_customer_id: c.customerId,
    p_order_id: order.id,
    p_kind: kind,
    p_order_item_id: itemId,
    p_quantity: qty,
  });
  c.tools.push(`dispute:${kind}`);
  c.summary.push(`[problem ${kind} on order ${order.label}: ${r?.status}]`);
  switch (r?.status) {
    case "auto_credit":
      return say(c, "disputeCredit", {
        amount: moneyUsd(r.amount_usd),
        lbp: Math.round(Number(r.amount_lbp ?? 0)).toLocaleString("en-US"),
        days: r.credit_days,
      });
    case "review":
    case "owner_review":
      // A person takes it from here (§30.6): the conversation is handed over with the dispute's summary.
      await c.deps.rpc("customer_handoff", {
        p_customer_id: c.customerId,
        p_reason: `problem with order ${order.label}: ${kind}`.slice(0, 300),
        p_summary: String(r.rule ?? "").slice(0, 300),
      });
      c.path = "handoff";
      return say(c, kind === "damaged" ? "disputeDamaged" : "disputeReview", { code: order.label });
    case "rejected":
      return say(c, "disputeRejected", { code: order.label });
    case "already_reported":
      return say(c, "disputeAlready");
    case "too_late":
      return say(c, "disputeTooLate", { days: r.days });
    case "pick_line":
      return problemKind(c, kind);
    default:
      return say(c, "disputeNone");
  }
}
const moneyUsd = (v: unknown) => `$${Number(v ?? 0).toFixed(2)}`;

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
      // "Problem" on the delivered message opens the problem list (§38.3); the server decides any credit.
      if (!a.ok) {
        await deps
          .rpc("order_customer_feedback", { p_customer_id: id, p_order_id: a.orderId, p_ok: false })
          .catch(() => null);
        return problemStart(c, a.orderId, null);
      }
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
      // The rating is on the delivered message (§38.3): rating it also says it arrived.
      await deps
        .rpc("order_customer_feedback", { p_customer_id: id, p_order_id: a.orderId, p_ok: true })
        .catch(() => null);
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
    case "category":
      return browseCategory(c, a.key);
    case "categories_page":
      return browseHome(c, a.offset);
    case "sections_page":
      return showSectionsPage(c, a.offset);
    case "pick_item": {
      // How many? (§34 step 5); the quantity tap adds it. A quantity the customer already typed adds it at once.
      const it = c.s.refs[a.ref];
      if (!it) return say(c, "pickPlaceFirst");
      if (c.s.pending.kind === "qty_hint") {
        const qty = Number(c.s.pending.qty ?? 1);
        c.s.pending = {};
        const added = await addOne(c, it.id, qty, [], null, null, true);
        if (added) push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
        return;
      }
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
    case "more_rest":
      return showSectionRest(c, a.ref, a.offset);
    case "cash": {
      await deps.rpc("basket_set_cash_currency", { p_customer_id: id, p_currency: a.currency });
      return checkout(c, {});
    }
    case "option":
      return optionChosen(c, a.optionId);
    case "saved_cart":
      return a.take ? savedCartTake(c, a.savedCartId) : savedCartDrop(c, a.savedCartId);
    case "alternative":
      return cartAlternative(c, a.savedCartId, a.itemId, a.qty);
    case "add_upsell": {
      await addItem(c, {
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
      const r = await addItem(c, {
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
    case "gift": {
      // The recipient's answer (§22.2 scenario 7): only the number the gift was sent to can answer.
      const r = await deps.rpc("gift_respond", {
        p_phone_e164: c.m.from,
        p_gift_id: a.giftId,
        p_accept: a.accept,
      });
      c.tools.push("gift_respond");
      if (r?.status === "placed")
        return say(c, "giftThanks", { code: r.code, sender: r.sender || tr(c.s.lang, "someone") });
      if (r?.status === "declined") return say(c, "giftNoThanks");
      return say(c, "giftGone");
    }
    case "memory_delete":
      return forgetPart(c, a.part, a.ref);
    case "consent": {
      const f = c.s.refs.xm;
      delete c.s.refs.xm;
      if (!a.ok || !f || f.id !== a.key) return say(c, "consentDeclined");
      await deps.rpc("customer_fact_set", {
        p_customer_id: id,
        p_key: f.id,
        p_value: f.label,
        p_source: "said",
        p_consent: true,
      });
      return say(c, "consentSaved");
    }
    case "address": {
      const ad = c.s.refs[a.ref];
      if (!ad) return checkout(c, {});
      await deps.rpc("basket_confirm_address", { p_customer_id: id, p_address_id: ad.id });
      c.s.pending = {};
      return checkout(c, {});
    }
    case "for_whom": {
      const addressId = c.s.pending.address_id;
      if (!addressId) return checkout(c, {});
      await deps.rpc("address_set_for_whom", {
        p_customer_id: id,
        p_address_id: addressId,
        p_for_whom: a.what === "other" ? "other" : "self",
        p_save: a.what === "self_save",
      });
      delete c.s.refs.xe;
      if (a.what === "other") {
        c.s.pending = { kind: "recipient", address_id: addressId };
        return say(c, "recipientAsk");
      }
      c.s.pending = {};
      return checkout(c, {});
    }
    case "problem_kind":
      return problemKind(c, a.kind);
    case "problem_line":
      return problemLine(c, a.itemId, a.kind, a.qty);
    case "simple":
      switch (a.what) {
        case "support":
          return showSupportReplies(c);
        case "remember":
          return showMemory(c);
        case "new_address":
          c.s.pending = { kind: "await_pin" };
          return push(c, askPin(c.m.from, c.s.lang));
        case "checkout":
          return checkout(c, {});
        case "retry":
          return checkout(c, { retryRoute: true });
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
        case "cart_both":
          return cartBoth(c);
        case "cart_replace":
          return cartReplace(c);
        case "usual":
          return reorder(c);
        case "no_upsell":
          return say(c, "done");
        case "address_list":
          return push(c, askPin(c.m.from, c.s.lang));
        case "order":
          return startOrder(c);
        case "near":
          return browseNear(c);
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
      const pickup = c.s.fulfil === "pickup";
      c.s.fulfil = null;
      c.summary.push(`[order ${r.code} placed by the customer's tap]`);
      // The summary and this reply count against the order's message budget (§38.3).
      // The other shops of a split cart, one at a time (§39.15.2), never the shop just ordered from; after a pickup
      // order the shops the customer could collect from too.
      const nx = await deps
        .rpc("saved_cart_next", {
          p_customer_id: c.customerId,
          p_exclude_vendor_id: c.basket.vendor_id ?? null,
          p_pickup: pickup,
        })
        .catch(() => null);
      if (r.order_id)
        await deps
          .rpc("order_messages_add", { p_order_id: r.order_id, p_n: nx?.saved_cart_id ? 3 : 2 })
          .catch(() => null);
      say(c, "placed", {
        code: r.code,
        vendor: lang === "ar" ? c.basket.vendor : (c.basket.vendor_en ?? c.basket.vendor),
      });
      if (nx?.saved_cart_id) offerSavedCart(c, nx);
      return;
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
    case "below_minimum":
      return checkout(c, {});
    case "fulfilment_unavailable":
      c.s.fulfil = null; // the shop does not take that way: ask again
      return checkout(c, {});
    case "gift_needs_recipient": {
      // A gift is placed only when the recipient accepts and agrees to pay cash (§22.2 scenario 7).
      const g = await deps.rpc("gift_request_create", {
        p_customer_id: c.customerId,
        p_basket_id: basketId,
        p_menu_version: version,
      });
      c.tools.push("gift_request");
      if (g?.status === "asked")
        return say(c, "giftAsked", { name: g.recipient_name, min: g.minutes });
      if (g?.status === "unreachable") return say(c, "giftUnreachable", { name: g.recipient_name });
      if (g?.status === "blocked")
        return say(c, "giftBlocked", { name: c.basket?.recipient_name ?? "" });
      if (g?.status === "too_many") return say(c, "giftTooMany", { name: g.recipient_name });
      return checkout(c, {});
    }
    case "address_unconfirmed":
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
  if (browse || !focusRef) return browseHome(c);
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
  return browseHome(c);
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
  if (r?.flow === "checkout") {
    if (r.status !== "saved") return say(c, "flowRetry");
    c.summary.push("[checkout choices saved from the Flow]");
    // The rest of checkout as usual (address, quote, summary); only the Confirm tap places the order.
    return checkout(c, { fulfilment: r.fulfilment === "pickup" ? "pickup" : "delivery" });
  }
  if (r?.flow === "address_capture") {
    if (r.status === "rejected") return say(c, "flowRetry");
    c.summary.push("[address details saved from the Flow]");
    if (c.basket?.lines?.length) return checkout(c, {});
    return say(c, "addressSaved");
  }
  return say(c, "flowRetry");
}

// ---- Saved carts (§39.15.2): the same steps for a tap and for the agent's saved_cart tool --------------------------
/** Offers the next saved cart (a split cart's other shop), as a ref the agent can name too. */
function offerSavedCart(c: Ctx, nx: any) {
  const label = String(nx.vendor_en ?? nx.vendor ?? "");
  const ref = refFor(c, "c", String(nx.saved_cart_id), label);
  c.summary.push(
    `[offered the saved cart ${ref} (${label}, ${nx.items ?? 1} item(s)): order now or no thanks]`,
  );
  push(c, savedCartOfferCard(c.m.from, c.s.lang, nx));
}

/** Order that shop's saved cart now: its lines, taken once per message, merged as a cart (never split again). */
async function savedCartTake(c: Ctx, savedCartId: string) {
  // Keyed by this message: a replayed turn gets the same lines back, and cart_merge adds them once.
  const t = await c.deps.rpc("saved_cart_take", {
    p_customer_id: c.customerId,
    p_saved_cart_id: savedCartId,
    p_message_id: c.m.messageId,
  });
  if (t?.status !== "ok" || !Array.isArray(t.lines)) return say(c, "savedCartGone");
  return cartOrder(
    c,
    t.lines.map((l: any) => ({
      itemId: String(l.item_id),
      quantity: Number(l.quantity) || 1,
      shownUsd: typeof l.shown_usd === "number" ? l.shown_usd : null,
    })),
    false,
    { messageId: `sc:${savedCartId}`, split: false },
  );
}

/** No thanks: this one is dropped, and the next shop of the split cart (if any) is offered in its place. */
async function savedCartDrop(c: Ctx, savedCartId: string) {
  await c.deps.rpc("saved_cart_drop", {
    p_customer_id: c.customerId,
    p_saved_cart_id: savedCartId,
  });
  const nx = await c.deps.rpc("saved_cart_next", { p_customer_id: c.customerId }).catch(() => null);
  if (nx?.saved_cart_id) return offerSavedCart(c, nx);
  return say(c, "savedCartDropped");
}

/**
 * The closest shop's same dish, in place of the cart's shop that does not deliver to the pin. Only once the dish is in
 * the basket does it leave that shop's saved cart (the same dish only); the shop's other items stay kept (pickup is
 * still possible) and are named, never lost silently.
 */
async function cartAlternative(c: Ctx, savedCartId: string, itemId: string, qty: number) {
  const added = await addOne(c, itemId, Math.min(Math.max(qty, 1), 50), [], null, null);
  if (!added) return;
  const sw = await c.deps
    .rpc("saved_cart_swap", {
      p_customer_id: c.customerId,
      p_saved_cart_id: savedCartId,
      p_item_id: itemId,
    })
    .catch(() => null);
  const lang = c.s.lang;
  const rest = (lang === "ar" ? sw?.names : (sw?.names_en ?? sw?.names)) ?? [];
  if (Array.isArray(rest) && rest.length)
    push(
      c,
      text(
        c.m.from,
        tr(lang, "cartAltRest", {
          vendor: lang === "ar" ? sw.vendor : (sw.vendor_en ?? sw.vendor),
          items: rest.slice(0, 10).join(", "),
        }),
      ),
    );
  push(c, ...basketMessage(c.m.from, lang, c.basket));
}

/** Do both: the open basket first, the cart kept as a saved cart and offered after this order (§39.15.2). */
async function cartBoth(c: Ctx) {
  const p = c.s.pending;
  c.s.pending = {};
  if (p.kind !== "cart" || !Array.isArray(p.lines)) return say(c, "done");
  const lang = c.s.lang;
  const sv = await c.deps.rpc("saved_cart_save", {
    p_customer_id: c.customerId,
    p_message_id: `both:${c.m.messageId}`,
    p_lines: p.lines.map((l: any) => ({ item_id: l.i, quantity: l.q, shown_usd: l.p ?? null })),
  });
  if (sv?.status === "saved")
    say(c, "cartBothSaved", {
      vendor: lang === "ar" ? sv.vendor : (sv.vendor_en ?? sv.vendor),
      basket: String(p.basket ?? ""),
    });
  else {
    // The cart's shop stopped taking orders meanwhile: its items are named, never dropped silently.
    const gone = (lang === "ar" ? sv?.unavailable : (sv?.unavailable_en ?? sv?.unavailable)) ?? [];
    if (Array.isArray(gone) && gone.length)
      push(c, text(c.m.from, tr(lang, "cartUnavailable", { items: gone.slice(0, 10).join(", ") })));
  }
  return checkout(c, {});
}

/** Switch: the catalogue cart replaces the open basket of another shop. */
async function cartReplace(c: Ctx) {
  const p = c.s.pending;
  c.s.pending = {};
  if (p.kind !== "cart" || !Array.isArray(p.lines)) return say(c, "done");
  return cartOrder(
    c,
    p.lines.map((l: any) => ({
      itemId: String(l.i),
      quantity: Number(l.q) || 1,
      shownUsd: l.p ?? null,
    })),
    true,
  );
}

/**
 * A cart sent from the Meta catalogue (§39.12): mapped to our menu and added to the one basket the customer also builds
 * with taps (cart_merge, keyed by this message so a replayed turn never adds twice). Every line is re-priced by the
 * server; a line whose catalogue price differs is shown before checkout; lines that need choices are asked one at a time;
 * then the normal checkout runs (address confirmation, the checkout Flow, payment choice). A cart from another shop than
 * the open basket asks first.
 */
async function cartOrder(
  c: Ctx,
  lines: CartLine[],
  replace = false,
  opts: { messageId?: string; split?: boolean } = {},
) {
  c.tools.push("cart");
  if (!lines.length) return say(c, "unsupported");
  const lang = c.s.lang;
  const messageId = opts.messageId ?? c.m.messageId;
  let splitGone: string[] = [];
  // A cart from several shops (the header catalogue is one flat list) is split, never dropped (§39.15.2): the customer
  // picks which shop first, and the others are kept as saved carts, offered once the first order is confirmed.
  if (!replace && opts.split !== false) {
    const sp = await c.deps.rpc("cart_split", {
      p_customer_id: c.customerId,
      p_message_id: messageId,
      p_lines: lines.map((l) => ({
        item_id: l.itemId,
        quantity: l.quantity,
        shown_usd: l.shownUsd,
      })),
    });
    // A shop that stopped taking orders is named, never saved (§39.15.2: only items truly unavailable, by name).
    const gone = (lang === "ar" ? sp?.unavailable : (sp?.unavailable_en ?? sp?.unavailable)) ?? [];
    const goneNote =
      Array.isArray(gone) && gone.length
        ? tr(lang, "cartUnavailable", { items: gone.slice(0, 10).join(", ") })
        : null;
    if (sp?.status === "split" && Array.isArray(sp.shops) && sp.shops.length > 1) {
      // Each shop is a ref, so a typed "Deli Dough first" reaches the same saved cart as the tap (§39.14 rule 1).
      resetRefs(c, "c");
      const named = (sp.shops as any[])
        .slice(0, 10)
        .map(
          (x) =>
            `${refFor(c, "c", String(x.saved_cart_id), String(x.vendor_en ?? x.vendor))} ${x.vendor_en ?? x.vendor}`,
        );
      c.summary.push(
        `[cart from ${sp.shops.length} shops (${named.join(", ")}): the customer picks which one first; the others are kept as saved carts]`,
      );
      if (goneNote) push(c, text(c.m.from, goneNote));
      return push(
        c,
        splitCartList(
          c.m.from,
          lang,
          sp.shops,
          (lang === "ar" ? sp.place : (sp.place_en ?? sp.place)) ?? null,
          sp.place_paused === true,
        ),
      );
    }
    if (sp?.status === "unavailable") {
      if (goneNote) push(c, text(c.m.from, goneNote));
      return say(c, "cartNothing");
    }
    if (sp?.status === "single" && Array.isArray(sp.lines) && sp.lines.length) {
      // Only the orderable shop's lines go on; the others are named with the merge's own notes, in one message.
      if (Array.isArray(gone)) splitGone = gone;
      lines = sp.lines.map((l: any) => ({
        itemId: String(l.item_id),
        quantity: Number(l.quantity) || 1,
        shownUsd: typeof l.shown_usd === "number" ? l.shown_usd : null,
      }));
    }
  }
  const r = await c.deps.rpc("cart_merge", {
    p_customer_id: c.customerId,
    p_message_id: messageId,
    p_lines: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, shown_usd: l.shownUsd })),
    p_replace: replace,
  });
  if (r?.status === "other_vendor") {
    const basket = lang === "ar" ? r.basket_vendor : (r.basket_vendor_en ?? r.basket_vendor);
    const cart = lang === "ar" ? r.cart_vendor : (r.cart_vendor_en ?? r.cart_vendor);
    c.s.pending = {
      kind: "cart",
      lines: lines.slice(0, 30).map((l) => ({ i: l.itemId, q: l.quantity, p: l.shownUsd })),
      basket,
      cart,
    };
    // Switch to B, Keep A, or Do both (A first, B saved): never a cart dropped without asking (§39.15.2).
    c.summary.push(`[a cart from ${cart} met the open ${basket} basket: switch, keep or both]`);
    return push(c, otherVendorCard(c.m.from, lang, String(basket ?? ""), String(cart ?? "")));
  }
  if (r?.status !== "ok") return say(c, "cartUnknown");
  if (r.basket) c.basket = r.basket;
  const skipped: any[] = Array.isArray(r.skipped) ? r.skipped : [];
  const needs: any[] = Array.isArray(r.needs_options) ? r.needs_options : [];
  const diffs: any[] = Array.isArray(r.diffs) ? r.diffs : [];
  c.summary.push(
    `[cart from the catalogue: ${lines.length} lines, ${Number(r.added ?? 0)} added, ${skipped.length} not added, ${needs.length} need choices, ${diffs.length} price changes]`,
  );
  // One message for what changed: the lines not added and the prices the server corrected (USD; the summary adds LBP).
  const notes: string[] = [];
  // Only items truly unavailable are named, by name (§39.15.2); never a bare "couldn't be added".
  // (A line that is not one of our items has no name; it is left out, and "nothing could be added" covers it.)
  // (Another shop's line is not unavailable: a split cart keeps it as a saved cart.)
  const unavailable = [
    ...splitGone,
    ...skipped
      .filter((x) => x.status !== "other_branch")
      .map((x) => (lang === "ar" ? x.item : (x.item_en ?? x.item))),
  ].filter((x): x is string => typeof x === "string" && x.length > 0);
  if (unavailable.length)
    notes.push(tr(lang, "cartUnavailable", { items: unavailable.slice(0, 10).join(", ") }));
  if (diffs.length)
    notes.push(
      tr(lang, "cartDiffs", {
        lines: diffs
          .slice(0, 10)
          .map((d) =>
            tr(lang, "cartDiffLine", {
              item: lang === "ar" ? d.item : (d.item_en ?? d.item),
              was: Number(d.shown_usd).toFixed(2),
              now: Number(d.now_usd).toFixed(2),
            }),
          )
          .join("\n"),
      }),
    );
  if (notes.length) push(c, text(c.m.from, notes.join("\n\n")));
  if (needs.length) {
    const flows = c.tools.length;
    const added = await addOne(c, needs[0].item_id, Number(needs[0].quantity ?? 1), [], null, null);
    if (needs.length > 1) say(c, "cartMoreOptions", { n: needs.length - 1 });
    // Waiting on choices (an option list or the item_options Flow): checkout comes after them.
    if (!added && (c.s.pending.kind === "options" || c.tools.length > flows)) return;
  }
  // Nothing of this cart went in (the old basket, if any, is as it was): say so, never check out the old basket.
  if (!Number(r.added ?? 0) || !c.basket?.lines?.length) return say(c, "cartNothing");
  // The normal checkout: address confirmation, the checkout Flow or the cash question, then the summary to confirm.
  return checkout(c, {});
}

// ---- The Meta catalogue: product messages chosen per shop (§39.12) ---------------------------------------------------
/** The catalogue a reply may use (the sending number's business account, or the simulated one), asked once per turn. */
async function catalogFor(c: Ctx): Promise<string | null> {
  if (c.catalog !== undefined) return c.catalog;
  const id = await c.deps
    .rpc("catalog_for_number", { p_phone_number_id: c.deps.senderNumberId ?? null, p_to: c.m.from })
    .catch(() => null);
  c.catalog = typeof id === "string" && id ? id : null;
  return c.catalog;
}

async function catalogProducts(
  c: Ctx,
  vendorId: string,
  opts: { section?: string | null; items?: string[] | null; limit?: number } = {},
): Promise<{ total: number; section_total: number; products: CatalogProduct[] }> {
  const r = await c.deps
    .rpc("catalog_products", {
      p_vendor_id: vendorId,
      p_catalog_id: c.catalog,
      p_section_id: opts.section ?? null,
      p_item_ids: opts.items ?? null,
      p_limit: opts.limit ?? 30,
    })
    .catch(() => null);
  return {
    total: Number(r?.total ?? 0),
    section_total: Number(r?.section_total ?? 0),
    products: Array.isArray(r?.products) ? r.products : [],
  };
}

/** A catalogue message, with what to send instead if Meta refuses it (null: nothing). */
function pushCatalog(c: Ctx, msg: Msg, fallback: Msg | null) {
  if (c.out.length >= MAX_MESSAGES) return;
  push(c, msg);
  (c.fallbacks ??= new Map()).set(msg, fallback);
}

const shopName = (label: string) => label.replace(/ \(.*\)$/, "");

// ---- Baskets and checkout -----------------------------------------------------------------------------------------
function refFor(
  c: Ctx,
  prefix: "v" | "i" | "l" | "s" | "a" | "c",
  id: string,
  label: string,
): string {
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

/**
 * A shop's menu (§39.12 smart menu, session 5e): with the catalogue, the shop's cover and one line (cuisine, village,
 * delivery fee, hours), then one multi-product message of its best sections (a few items of each, best sellers first),
 * then a list that opens the rest of its sections. Without the catalogue the list messages run as before (with the cover
 * when the shop has one). A catalogue message that Meta refuses is replaced by the section list.
 */
async function showMenu(c: Ctx, vendorRef: string, query: string | null) {
  const v = c.s.refs[vendorRef];
  if (!v) return say(c, "pickPlaceFirst");
  const before = c.out.length;
  await showMenuList(c, vendorRef, query);
  if (query) return;
  const list = c.out.splice(before);
  const shop = shopName(v.label);
  // The cover goes first only when it pushes nothing else out of this turn's messages (MAX_MESSAGES).
  const room = (n: number) => c.out.length + 1 + n <= MAX_MESSAGES;
  const cover = await shopCover(c, v.id, shop);
  if (!(await catalogFor(c))) {
    if (cover && room(list.length)) push(c, cover);
    push(c, ...list);
    return;
  }
  const menu = await c.deps
    .rpc("catalog_shop_menu", { p_vendor_id: v.id, p_catalog_id: c.catalog })
    .catch(() => null);
  const sections: ShopMenuSection[] = Array.isArray(menu?.sections) ? menu.sections : [];
  // Items outside any section have no row to open them by, so such a shop keeps the list menu (its flat list). So does a
  // shop with only a few items Meta approved (§39.15.2): a thin product message would hide the rest of its menu.
  const shown = Number(menu?.shown ?? sections.reduce((n, x) => n + (x.products?.length ?? 0), 0));
  if (
    !sections.length ||
    sections.some((x) => !x.section_id) ||
    shown < (c.deps.config.browseMinCatalogItems ?? 6)
  ) {
    if (cover && room(list.length)) push(c, cover);
    push(c, ...list);
    return;
  }
  const { products, rest } = packShopMenu(sections, {
    perSection: c.deps.config.firstSectionItems ?? 6,
  });
  if (cover && room(rest.length ? 2 : 1)) push(c, cover);
  c.tools.push("catalog:menu");
  c.summary.push(
    `[showed ${products.length} items of ${vendorRef} as a catalogue message, ${rest.length} more sections as a list]`,
  );
  pushCatalog(
    c,
    productListMessage(c.m.from, c.catalog!, shop, tr(c.s.lang, "catalogBrowse"), products, {
      lang: c.s.lang,
      footer: tr(c.s.lang, "catalogFooter"),
    }),
    // The section list's refs are reused by "More sections" below, so it stands in only when there is no such list.
    rest.length ? null : (list[0] ?? null),
  );
  if (rest.length) pushSectionsPage(c, shop, rest, 0);
}

/** A shop's cover with its one line (session 5e); null when the shop has no cover or no link can be made. */
async function shopCover(c: Ctx, vendorId: string, shop: string): Promise<Msg | null> {
  if (!c.deps.photoUrl) return null;
  const card:
    | (ShopCard & {
        cover?: {
          path?: string;
          source?: string;
          credit?: string | null;
          license?: string | null;
        } | null;
      })
    | null = await c.deps.rpc("shop_card", { p_vendor_id: vendorId }).catch(() => null);
  const path = card?.cover?.path;
  if (!card || !path) return null;
  const link = await c.deps.photoUrl(path).catch(() => null);
  if (!link) return null;
  const chk = await c.deps
    .rpc("customer_delivery_check", { p_customer_id: c.customerId, p_vendor_ids: [vendorId] })
    .catch(() => null);
  const q = (chk?.vendors ?? []).find((x: any) => x.vendor_id === vendorId);
  const fee = q?.status === "ok" && q.fee_usd != null ? Number(q.fee_usd) : null;
  // No photo credit in a caption once the site credits every photo on /credits (§39.15.2); until the site has an
  // address, an illustrative cover under CC BY or CC BY-SA carries its credit here (§39.13). CC0 and public domain need none.
  const cv = card.cover!;
  const credit =
    !c.deps.config.siteUrl &&
    cv.source === "illustrative" &&
    cv.credit &&
    !/^(cc0|pdm|public domain)/i.test(cv.license ?? "")
      ? `\n📷 ${[Array.from(cv.credit.replace(/\s+/g, " ").trim()).slice(0, 80).join(""), cv.license].filter(Boolean).join(" · ")}`
      : "";
  return image(c.m.from, link, `*${shop}*\n${shopLine(c.s.lang, card, fee)}${credit}`);
}

/** The rest of a shop's sections as a list, 9 at a time ("More sections" pages through them). */
function pushSectionsPage(c: Ctx, shop: string, rest: ShopMenuSection[], offset: number) {
  resetRefs(c, "s");
  const page = rest.slice(offset, offset + 10);
  const more = rest.length > offset + 10;
  const rows = page.slice(0, more ? 9 : 10).map((r) => ({
    ref: refFor(c, "s", r.section_id ?? "", localName(c.s.lang, r.name_ar, r.name_en)),
    name_ar: r.name_ar,
    name_en: r.name_en,
    items: Number(r.total ?? 0),
  }));
  push(c, moreSectionsList(c.m.from, c.s.lang, shop, rows, more ? offset + 9 : null));
}

async function showSectionsPage(c: Ctx, offset: number) {
  const vendorId = c.s.focus_vendor_id;
  if (!vendorId || !(await catalogFor(c))) return say(c, "pickPlaceFirst");
  const menu = await c.deps
    .rpc("catalog_shop_menu", { p_vendor_id: vendorId, p_catalog_id: c.catalog })
    .catch(() => null);
  const sections: ShopMenuSection[] = Array.isArray(menu?.sections) ? menu.sections : [];
  const { rest } = packShopMenu(
    sections.filter((x) => x.section_id),
    { perSection: c.deps.config.firstSectionItems ?? 6 },
  );
  const vref = Object.entries(c.s.refs).find(
    ([k, v]) => k.startsWith("v") && v.id === vendorId,
  )?.[0];
  const shop = shopName(vref ? c.s.refs[vref].label : (c.basket?.vendor_en ?? ""));
  if (!rest.length) return say(c, "pickPlaceFirst");
  pushSectionsPage(c, shop, rest, Math.min(Math.max(offset, 0), Math.max(rest.length - 1, 0)));
}

async function showMenuList(c: Ctx, vendorRef: string, query: string | null) {
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
  const hints = await itemHints(c, rows);
  const menu: MenuRow[] = rows.map((r) => ({
    ...r,
    ref: refFor(c, "i", r.item_id, `${r.name_en ?? r.name_ar} $${Number(r.price_usd).toFixed(2)}`),
    hint: hints[r.item_id] ?? [],
  }));
  const samePrice = (await c.deps.rpc("vendor_same_price", { p_vendor_id: v.id })) === true;
  push(c, ...menuList(c.m.from, c.s.lang, v.label.replace(/ \(.*\)$/, ""), menu, query, samePrice));
  c.summary.push(`[showed ${menu.length} items from ${vendorRef}]`);
}

/**
 * One section: with the catalogue, a multi-product message of 30 of its items at a time (best sellers first) and a
 * "Next items" button when there are more; else the list, nine items and "More" at a time.
 */
async function showSection(c: Ctx, sectionRef: string, offset: number) {
  const sec = c.s.refs[sectionRef];
  const vendorId = c.s.focus_vendor_id;
  if (sec && vendorId && (await catalogFor(c))) {
    const menu = await c.deps
      .rpc("catalog_shop_menu", { p_vendor_id: vendorId, p_catalog_id: c.catalog })
      .catch(() => null);
    const s = ((Array.isArray(menu?.sections) ? menu.sections : []) as ShopMenuSection[]).find(
      (x) => (x.section_id ?? "") === sec.id,
    );
    const page = s ? s.products.slice(offset, offset + 30) : [];
    if (s && page.length) {
      const before = c.out.length;
      await showSectionList(c, sectionRef, offset);
      const list = c.out.splice(before);
      c.tools.push("catalog:section");
      c.summary.push(
        `[showed items ${offset + 1}-${offset + page.length} of section ${sectionRef} as a catalogue message]`,
      );
      pushCatalog(
        c,
        productListMessage(
          c.m.from,
          c.catalog!,
          sec.label,
          tr(c.s.lang, "catalogBrowse"),
          page.map((p) => ({ ...p, section: s.name_ar, section_en: s.name_en })),
          { lang: c.s.lang, footer: tr(c.s.lang, "catalogFooter") },
        ),
        list[0] ?? null,
      );
      if (s.products.length > offset + page.length)
        push(
          c,
          sectionNextButton(
            c.m.from,
            c.s.lang,
            sec.label,
            sectionRef,
            offset,
            page.length,
            s.products.length,
          ),
        );
      // The section's other items (no approved photo yet) follow as a list: the count on its row is what opens (§39.15.2).
      else if (Number(s.total ?? 0) > s.products.length)
        await showSectionRest(c, sectionRef, 0, true);
      return;
    }
  }
  return showSectionList(c, sectionRef, offset);
}

/**
 * The items of a section that are not in WhatsApp's catalogue (not approved by Meta, or no photo), as a list after the
 * section's product message: "More Burgers (8)", nine at a time (DECISIONS §39.15.2: no item is ever unreachable).
 */
async function showSectionRest(c: Ctx, sectionRef: string, offset: number, keepRefs = false) {
  const sec = c.s.refs[sectionRef];
  const vendorId = c.s.focus_vendor_id;
  if (!sec || !vendorId) return say(c, "pickPlaceFirst");
  if (!(await catalogFor(c))) return showSectionList(c, sectionRef, 0);
  const rows: any[] =
    (await c.deps
      .rpc("catalog_section_rest", {
        p_vendor_id: vendorId,
        p_catalog_id: c.catalog,
        p_section_id: sec.id,
        p_limit: 10,
        p_offset: Math.max(0, offset),
      })
      .catch(() => null)) ?? [];
  if (!rows.length) return showSectionList(c, sectionRef, 0);
  // After a section's product message, the stand-in list built for it keeps its rows' refs (refFor reuses a ref for the
  // same item, and 10 + 9 fit its 40).
  if (!keepRefs) resetRefs(c, "i");
  const total = Number(rows[0]?.total_count ?? rows.length);
  const more = rows.length === 10 && total > offset + 10;
  const page = rows.slice(0, more ? 9 : 10);
  const hints = await itemHints(c, page);
  const menu: MenuRow[] = page.map((r) => ({
    ...r,
    ref: refFor(c, "i", r.item_id, `${r.name_en ?? r.name_ar} $${Number(r.price_usd).toFixed(2)}`),
    hint: hints[r.item_id] ?? [],
  }));
  const vref = Object.entries(c.s.refs).find(
    ([k, v]) => k.startsWith("v") && v.id === vendorId,
  )?.[0];
  const vendor = shopName(vref ? c.s.refs[vref].label : (c.basket?.vendor_en ?? ""));
  push(
    c,
    ...menuList(c.m.from, c.s.lang, vendor, menu, null, false, {
      title: tr(c.s.lang, "moreOfSection", { section: sec.label, n: total }),
      more: more ? { ref: sectionRef, offset: offset + 9 } : null,
      moreId: more ? `mr:${sectionRef}:${offset + 9}` : undefined,
    }),
  );
  c.summary.push(`[showed ${menu.length} more items of section ${sectionRef} as a list]`);
}

/** One section of the focused place's menu, nine items and a "More" row at a time. */
async function showSectionList(c: Ctx, sectionRef: string, offset: number) {
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
  const page = rows.slice(0, more ? 9 : 10);
  const hints = await itemHints(c, page);
  const menu: MenuRow[] = page.map((r) => ({
    ...r,
    ref: refFor(c, "i", r.item_id, `${r.name_en ?? r.name_ar} $${Number(r.price_usd).toFixed(2)}`),
    hint: hints[r.item_id] ?? [],
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

/** Allergens the dish library suggests for these items and the merchant has not declared (§38.3); {} when unknown. */
async function itemHints(c: Ctx, rows: any[]): Promise<Record<string, string[]>> {
  if (!rows.length) return {};
  const h = await c.deps
    .rpc("menu_item_hints", { p_item_ids: rows.map((r) => r.item_id) })
    .catch(() => null);
  const out: Record<string, string[]> = {};
  for (const [id, v] of Object.entries((h ?? {}) as Record<string, any>))
    if (Array.isArray(v?.may_contain)) out[id] = v.may_contain;
  return out;
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
  const r = await deliveringPlaces(c, pt, query, businessType);
  if (r.paused) return say(c, "placePaused");
  let rows = r.rows;
  const found = r.found;
  // DECISIONS §39.3: the customer named a shop that is not on Alo King yet (and no orderable place matched that
  // name): say so, offer the counted "Ask them to join" link and the closest places that deliver instead.
  // A typed or spoken query only: the zero-model button path never searches by name.
  if (query && query.trim().length >= 3 && !rows.some((x) => x.matched === "name")) {
    const shop = (
      ((await c.deps.rpc("vendor_search_unclaimed", {
        p_query: query,
        p_limit: 1,
      })) ?? []) as any[]
    )[0];
    if (shop) {
      // The counted "Ask them to join" link: the site-claim edge function, opened in the customer's browser (§39.3).
      const base = c.deps.config.joinFunctionUrl;
      const ask =
        base && shop.slug
          ? joinLink(
              base,
              shop.slug,
              c.s.lang === "en" || c.s.lang === "fr" ? c.s.lang : "ar",
              "bot",
            )
          : null;
      push(c, notOnAloKingCard(c.m.from, c.s.lang, { ...shop, ask_url: ask }));
      if (!rows.length) {
        rows = (await deliveringPlaces(c, pt, null, shop.business_type ?? null)).rows;
        if (!rows.length) rows = (await deliveringPlaces(c, pt, null, null)).rows;
      }
      rows = rows.slice(0, 3);
      c.summary.push(
        `[${shop.name_en ?? shop.name_ar} is not on Alo King yet: offered the ask link and ${rows.length} places instead]`,
      );
      if (!rows.length) return;
      resetRefs(c, "v");
      const alt = rows.map((x) => ({
        ...x,
        ref: refFor(
          c,
          "v",
          x.vendor_id,
          `${x.name_en ?? x.name_ar}${x.is_open ? "" : " (closed)"}`,
        ),
      }));
      return push(c, ...vendorChoices(c.m.from, c.s.lang, alt, null, "pickInstead"));
    }
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

/** Orderable places for a query that deliver to the customer's saved pin (when there is one). */
async function deliveringPlaces(
  c: Ctx,
  pt: any,
  query: string | null,
  businessType: string | null,
): Promise<{ rows: any[]; found: number; paused: boolean }> {
  let rows: any[] =
    (await c.deps.rpc("vendor_search", {
      p_query: query,
      p_lat: pt?.lat ?? null,
      p_lon: pt?.lon ?? null,
      p_business_type: businessType,
      p_cuisine: null,
      p_limit: 10,
      p_customer_id: c.customerId,
    })) ?? [];
  // Right after the pin (§34 step 3): only places whose road route reaches the pin, before any basket exists.
  const found = rows.length;
  if (pt?.address_id && found) {
    const ids = rows.map((r) => r.vendor_id);
    // Zero routing calls (§39.15.1): the exact cached route, else the shop → place distance.
    const chk = await c.deps.rpc("customer_delivery_check", {
      p_customer_id: c.customerId,
      p_vendor_ids: ids,
    });
    if (chk?.status === "place_paused") return { rows: [], found, paused: true };
    // A shop with no distance at all yet is not a "no": the checkout checks it again with one live call.
    const beyond = new Set(
      (chk?.vendors ?? [])
        .filter((v: any) => v.status === "beyond_radius")
        .map((v: any) => v.vendor_id),
    );
    rows = rows.filter((r) => !beyond.has(r.vendor_id));
  }
  return { rows, found, paused: false };
}

// ---- Browsing through the bot (session 5e) ----------------------------------------------------------------------------
type DeliveringShop = BrowseShop & { vendor_id: string; categories: string[] };

/**
 * Every orderable shop that delivers to the customer's saved pin: the straight-line candidates (browse_shops), then the
 * road check with the delivery fee (customer_delivery_check: the exact cached route, else the shop → place distance; no
 * routing call). A shop with no distance at all is kept, the checkout checks it again. Nearest open shops first.
 */
async function deliveringShops(c: Ctx): Promise<{
  shops: DeliveringShop[];
  categories: { key: string; emoji: string; name_ar: string; name_en: string; name_fr: string }[];
  paused: boolean;
  point: any;
  place: string | null;
}> {
  const pt = await c.deps.rpc("customer_search_point", { p_customer_id: c.customerId });
  if (!pt?.address_id)
    return { shops: [], categories: [], paused: false, point: null, place: null };
  const r = await c.deps.rpc("browse_shops", {
    p_customer_id: c.customerId,
    p_lat: pt.lat,
    p_lon: pt.lon,
    p_limit: 40,
  });
  const raw: any[] = Array.isArray(r?.shops) ? r.shops : [];
  const categories = Array.isArray(r?.categories) ? r.categories : [];
  const place = localName(c.s.lang, r?.place?.name_ar ?? null, r?.place?.name_en ?? null) || null;
  if (!raw.length) return { shops: [], categories, paused: false, point: pt, place };
  const ids = raw.map((x) => x.vendor_id);
  // Zero routing calls (§39.15.1): customer_delivery_check reads the shop → place distances.
  const chk = await c.deps.rpc("customer_delivery_check", {
    p_customer_id: c.customerId,
    p_vendor_ids: ids,
  });
  if (chk?.status === "place_paused")
    return { shops: [], categories, paused: true, point: pt, place };
  const by = new Map<string, any>((chk?.vendors ?? []).map((v: any) => [v.vendor_id, v]));
  const shops = raw
    .filter((x) => by.get(x.vendor_id)?.status !== "beyond_radius")
    .map((x) => {
      const q = by.get(x.vendor_id);
      return {
        ...x,
        ref: "",
        km: q?.road_km != null ? Number(q.road_km) : Number(x.km),
        fee_usd: q?.status === "ok" && q.fee_usd != null ? Number(q.fee_usd) : null,
        categories: Array.isArray(x.categories) ? x.categories : [],
      } as DeliveringShop;
    })
    .sort(
      (a, b) => Number(b.is_open) - Number(a.is_open) || Number(a.km ?? 99) - Number(b.km ?? 99),
    );
  return { shops, categories, paused: false, point: pt, place };
}

/**
 * "What are you craving?" (session 5e): the categories with shops that deliver here and "Shops near you". A few shops
 * (fewer than browse_categories_min_shops) are listed directly, one open shop opens at once, none offers pickup.
 */
async function browseHome(c: Ctx, offset = 0) {
  const r = await deliveringShops(c);
  if (r.paused) return say(c, "placePaused");
  // No pin, nothing that delivers, or only a few shops: the shop list as before (it also offers pickup when none deliver).
  if (!r.point || r.shops.length < (c.deps.config.browseMinShops ?? 4))
    return searchVendors(c, null, null);
  const cats: BrowseCategory[] = r.categories
    .map((k) => ({
      key: k.key,
      emoji: k.emoji,
      name: c.s.lang === "fr" ? k.name_fr : localName(c.s.lang, k.name_ar, k.name_en),
      shops: r.shops.filter((x) => x.categories.includes(k.key)).length,
    }))
    .filter((k) => k.shops > 0)
    // The categories most shops here serve come first (the table's order breaks ties).
    .sort((a, b) => b.shops - a.shops);
  c.tools.push("browse:home");
  c.summary.push(
    `[asked what they are craving: ${cats.length} categories, ${r.shops.length} shops deliver]`,
  );
  push(
    c,
    cravingList(
      c.m.from,
      c.s.lang,
      cats,
      r.shops.length,
      r.place,
      // An old "More categories" tap past the end (fewer categories deliver now) starts again from the first page.
      offset > 0 && offset < cats.length ? offset : 0,
    ),
  );
}

function listShops(c: Ctx, shops: DeliveringShop[], body: string) {
  resetRefs(c, "v");
  const rows = shops.slice(0, 10).map((x) => ({
    ...x,
    ref: refFor(c, "v", x.vendor_id, `${x.name_en ?? x.name_ar}${x.is_open ? "" : " (closed)"}`),
  }));
  if (rows.length === 1 && rows[0].is_open) return showMenu(c, rows[0].ref, null);
  const more = shops.length > 10 ? `\n${tr(c.s.lang, "nearest10", { n: shops.length })}` : "";
  push(c, shopList(c.m.from, c.s.lang, `${body}${more}`, rows));
}

/** A category: the shops that serve it and deliver here, nearest first, with fee and distance. */
async function browseCategory(c: Ctx, key: string) {
  const r = await deliveringShops(c);
  if (r.paused) return say(c, "placePaused");
  if (!r.point) return startOrder(c);
  const cat = r.categories.find((k) => k.key === key);
  const shops = r.shops.filter((x) => x.categories.includes(key));
  if (!cat || !shops.length) return browseHome(c);
  c.tools.push(`browse:category:${key}`);
  c.summary.push(`[category ${key}: ${shops.length} shops]`);
  const nameOf = c.s.lang === "fr" ? cat.name_fr : localName(c.s.lang, cat.name_ar, cat.name_en);
  return listShops(c, shops, tr(c.s.lang, "categoryShops", { emoji: cat.emoji, name: nameOf }));
}

/** "Shops near you": every shop that delivers here, nearest first. */
async function browseNear(c: Ctx) {
  const r = await deliveringShops(c);
  if (r.paused) return say(c, "placePaused");
  if (!r.point) return startOrder(c);
  if (!r.shops.length) return push(c, noDeliveryCard(c.m.from, c.s.lang));
  c.tools.push("browse:near");
  c.summary.push(`[shops near you: ${r.shops.length}]`);
  return listShops(
    c,
    r.shops,
    tr(c.s.lang, "nearShops", { place: r.place || tr(c.s.lang, "yourPlace") }),
  );
}

/** The pickup choice (T2): open places near the pin that take pickup, when nothing delivers or the customer prefers it. */
async function pickupPlaces(c: Ctx) {
  const pt = await c.deps.rpc("customer_search_point", { p_customer_id: c.customerId });
  if (!pt?.address_id) {
    c.s.pending = { kind: "await_pin", then: "pickup" };
    return push(c, askPin(c.m.from, c.s.lang));
  }
  const rows: any[] =
    (await c.deps.rpc("vendor_search_pickup", {
      p_lat: pt.lat,
      p_lon: pt.lon,
      p_limit: 10,
      p_customer_id: c.customerId,
    })) ?? [];
  if (!rows.length) return say(c, "noPickup");
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

/**
 * basket_add_item keyed by the message, the add's number in this turn and the item, so a replayed turn (#139) never
 * adds the same thing twice, and a replay that adds something else (a model turn can) adds it.
 */
const addItem = (c: Ctx, args: Record<string, unknown>) =>
  c.deps.rpc("basket_add_item", {
    ...args,
    p_op_key: `${c.m.messageId}#${c.adds++}:${String(args.p_item_id)}`,
  });

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
    // The item's name as the list the customer tapped showed it; an item that came another way (its code from the
    // website, a catalogue cart) is named by the group itself (menu_item_options' item / item_en).
    const label =
      c.s.refs[Object.keys(c.s.refs).find((k) => c.s.refs[k].id === itemId) ?? ""]?.label?.replace(
        / \$.*$/,
        "",
      ) || localName(c.s.lang, missing.item ?? null, missing.item_en ?? null);
    push(c, optionList(c.m.from, c.s.lang, label, missing));
    return false;
  }
  const r = await addItem(c, {
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
  args: {
    fulfilment?: string | null;
    note?: string | null;
    stairs?: number | null;
    /** The customer tapped Try again on "couldn't work out the road": the live call is made even if tried a moment ago. */
    retryRoute?: boolean;
  },
) {
  const { deps } = c;
  if (args.fulfilment) c.s.fulfil = args.fulfilment === "pickup" ? "pickup" : "delivery";
  // Delivery / Pickup (§37.6): a shop that takes both is asked once per basket, before the pin or the quote. A choice kept in the
  // session from an earlier basket or shop is checked against what this shop takes, and dropped when it does not apply.
  const o = await deps.rpc("basket_fulfilment_options", { p_customer_id: c.customerId });
  if (o?.status === "ok") {
    if ((c.s.fulfil === "delivery" && !o.delivery) || (c.s.fulfil === "pickup" && !o.pickup))
      c.s.fulfil = null;
    if (!c.s.fulfil) {
      if (o.pickup && o.delivery) {
        // One screen (the checkout Flow, once published): delivery or pickup, the cash currency, a note (§39.8).
        if (await openFlow(c, "checkout", {})) {
          c.summary.push("[checkout form sent]");
          return;
        }
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
  // The delivery address is confirmed on every order, and a new one asks who the order is for (§22.1, §39.6).
  const st = await deps.rpc("basket_address_state", { p_customer_id: c.customerId });
  if (st?.status === "confirm") {
    resetRefs(c, "a");
    const cur = {
      ref: refFor(c, "a", st.address_id, "current"),
      where: addrLabel(c.s.lang, st.label, st.recipient_name, st.address),
    };
    const others = ((st.others ?? []) as any[]).map((o) => ({
      ref: refFor(c, "a", o.address_id, "saved"),
      where: addrLabel(c.s.lang, o.label, o.recipient_name, o.card),
    }));
    c.summary.push("[asked to confirm the delivery address]");
    return push(c, addressConfirmCard(c.m.from, c.s.lang, cur, others));
  }
  if (st?.status === "for_whom") {
    c.s.pending = { kind: "for_whom", address_id: st.address_id };
    c.summary.push("[asked whether the order is for the customer or someone else]");
    return push(c, forWhomCard(c.m.from, c.s.lang, where(c.s.lang, st.address)));
  }
  if (st?.status === "recipient") {
    c.s.pending = { kind: "recipient", address_id: st.address_id };
    return say(c, "recipientAsk");
  }
  // "For my mom" said earlier, on an address of the customer's own: ask once (§22.1).
  if (st?.status === "ok" && !st.gift && c.s.refs.xe && st.address_id) {
    delete c.s.refs.xe;
    c.s.pending = { kind: "for_whom", address_id: st.address_id };
    return push(c, forWhomCard(c.m.from, c.s.lang, where(c.s.lang, st.address)));
  }
  // A consented allergy note reaches the kitchen on every own order: basket_quote and the order copy it from memory on
  // the server (never on a gift for someone else, §39.6).
  let q: Quote = await deps.rpc("basket_quote", { p_customer_id: c.customerId });
  // The shop → pin route is not cached yet (§39.15.1): the quote came from the shop → place distance, or from nothing.
  // One live call (2 s, within the day's budget); whatever it answers, the order goes on unless neither distance exists.
  const live = q as any;
  if (live?.origin && live?.dest) {
    const r = await deps
      .route(live.origin, live.dest, { phone: c.m.from, force: args.retryRoute === true })
      .catch((e: unknown) => {
        deps.log?.("route failed", { error: String(e).slice(0, 120) });
        return null;
      });
    if (r) q = await deps.rpc("basket_quote", { p_customer_id: c.customerId });
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
    case "below_minimum":
      return push(c, belowMinimumMessage(c.m.from, lang, q));
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

/** "Home – Baakline (Building X)": a saved address as the customer named it, then the place. */
function addrLabel(lang: CLang, label: string | null, recipient: string | null, card: any): string {
  const w = where(lang, card);
  const n = label ?? recipient;
  return n ? `${n} – ${w}` : w;
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
  if (isMedicineRequest(transcript)) return medicine(c);
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
    case "search_items":
      return (
        typeof input.query === "string" &&
        input.query.trim().length > 0 &&
        input.query.length <= 120 &&
        (input.quantity === null ||
          (Number.isInteger(input.quantity) && input.quantity >= 1 && input.quantity <= 50))
      );
    case "report_problem":
      return ["missing_item", "wrong_item", "cold_food", "late", "damaged", "other"].includes(
        input.kind,
      );
    case "show_memory":
    case "decline_off_topic":
      return true;
    case "set_preference":
      return (
        (PREFERENCE_KEYS as readonly string[]).includes(input.key) &&
        typeof input.value === "string" &&
        input.value.length <= 120
      );
    case "reorder":
      return ["last", "usual"].includes(input.which);
    case "saved_cart":
      return (
        ["take", "drop", "switch", "keep", "both"].includes(input.action) &&
        (["take", "drop"].includes(input.action)
          ? ref(input.cart_ref, "c")
          : input.cart_ref === null || input.cart_ref === undefined)
      );
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
  } else if (FACT_RE.test(t)) {
    // Zero invented facts (§39.6): times, distances, fees and policies come only from tool results.
    c.deps.log?.("model text dropped by the fact guard");
    say(c, "busy");
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
      return rememberFact(c, input.key, input.value);
    case "search_items":
      return catalogText(c, input.query, input.quantity ?? null);
    case "report_problem":
      // The model never opens a dispute: the customer taps the problem on the list (AI proposes, server decides).
      return problemStart(c, null, null);
    case "show_memory":
      return showMemory(c);
    case "decline_off_topic":
      return offTopic(c);
    case "reorder":
      return reorder(c);
    case "saved_cart": {
      // The model names the choice; the customer and the saved cart come from this session (never from the model).
      if (input.action === "take" || input.action === "drop") {
        const sc = c.s.refs[input.cart_ref];
        if (!sc) return say(c, "savedCartGone");
        return input.action === "take" ? savedCartTake(c, sc.id) : savedCartDrop(c, sc.id);
      }
      if (input.action === "keep") {
        c.s.pending = {};
        return say(c, "done");
      }
      return input.action === "both" ? cartBoth(c) : cartReplace(c);
    }
    case "request_human":
      return handoff(c, input.reason);
    case "reply":
      return replyText(c, input.text, input.confidence);
  }
}
