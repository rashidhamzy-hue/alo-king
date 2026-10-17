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
  isEmptyish,
  shopToken,
  siteText,
  withoutShopToken,
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
  fullMenuCard,
  sectionsPageSize,
  withFullMenuRow,
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
  clip,
  demoAddressCard,
  testerFullMenu,
  changeAsk,
  choiceAsk,
  extrasList,
  noteLinesList,
  notePrompt,
  tipAfterCard,
  tipConfirmCard,
  tipRow,
  type ChoiceGroup,
  type SummaryExtra,
  welcomeMenu,
  voiceOffCard,
  photoCard,
  closedNearCard,
  shopClosedCard,
  outsideAreaCard,
  shopLinkPin,
  whenText,
  whenShort,
  type Opening,
  otherShopCard,
  gapItemsMessage,
  problemPhotoAsk,
  shopNoteConfirm,
  type GapItem,
} from "./render.ts";
import {
  ALLERGENS,
  DIETS,
  NUTRITION_TAGS,
  PREFERENCE_KEYS,
  SYSTEM_PROMPT,
  TOOLS,
  type AfterCartToolName,
  type ToolName,
} from "./tools.ts";
import { buttons, customerStatusMessages, image, moneyLine } from "../../_shared/customer-cards.ts";
import { flowMessage, parseFlowReply, type FlowName } from "../../_shared/flows.ts";
import {
  packShopMenu,
  parseCartOrder,
  productCarouselMessage,
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
  /** A photo's caption (§3.1 #5: read as typed text). */
  caption?: string | null;
  /** Typed messages sent in a row and answered once (§3.1 #6): their texts, oldest first; `text` joins them. */
  burst?: string[] | null;
  /** A photo (spec #49: the optional photo of a problem); only its WhatsApp media id is kept, never the picture. */
  image?: { id: string; mime: string } | null;
  /**
   * A tap the server queued for the customer (session 5g: "Continue in WhatsApp" on the web menu), not a message they
   * sent: its turn is kind "web", which never counts as the customer writing (customer_turn_begin).
   */
  synthetic?: boolean;
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
    caption: type === "image" ? String(msg.image?.caption ?? "").slice(0, 1000) || null : null,
    image:
      type === "image" && /^[A-Za-z0-9._-]{1,200}$/.test(String(msg.image?.id ?? ""))
        ? { id: String(msg.image.id), mime: String(msg.image?.mime_type ?? "image/jpeg") }
        : null,
    synthetic: payload?.alo_synthetic === "web" && String(msg.id ?? "").startsWith("web."),
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
  /** The catalogue lookup in flight, so lookups made side by side share one call. */
  catalogAsk?: Promise<string | null>;
  /** What to send instead when a catalogue message is refused (a product Meta does not have yet, §39.12). */
  fallbacks?: Map<Msg, Msg | null>;
  /**
   * "Address saved: …" waiting to go out (afterPin): sent before the turn's next message, or as the first line of the
   * craving list, so a pin's turn still has room for Popular near you (MAX_MESSAGES).
   */
  savedLine?: string;
  /** This turn's shop lists leave out the "Full menu" row (its link could not be made, §39.15.13). */
  noFullMenu?: boolean;
};

const MAX_MESSAGES = 3;
/** Queue attempts that replay a stalled turn before the customer is shown the buttons instead. */
const STALL_REPLAYS = 3;
const push = (c: Ctx, ...ms: Msg[]) => {
  flushSaved(c);
  for (const x of ms) if (c.out.length < MAX_MESSAGES) c.out.push(x);
};
/** The waiting "Address saved: …" line as its own message, before anything else this turn sends. */
function flushSaved(c: Ctx) {
  if (c.savedLine === undefined) return;
  const line = c.savedLine;
  c.savedLine = undefined;
  if (c.out.length < MAX_MESSAGES) c.out.push(text(c.m.from, line));
}
/** An error reply always carries buttons (render.ts ERROR_WAYS, DECISIONS §39.15.1); anything else is plain text. */
const say = (c: Ctx, key: string, v: Record<string, unknown> = {}) =>
  push(c, sayMessage(c.m.from, c.s.lang, key, v));
/**
 * Something failed on our side (T2): the customer sees the buttons, never "I'm a bit slow" (that wording is for a
 * model that answered nothing usable). The failure itself is logged by the caller.
 */
const fail = (c: Ctx) => push(c, mainMenu(c.m.from, c.s.lang, "tapFailed"));

/**
 * Reads that never move the customer's search point: between them, customer_search_point is asked once per turn (a browse
 * turn asked it three times, §39.15.6). Any other call may change the address, so it makes the next read ask again.
 */
const POINT_KEEPERS = new Set([
  "browse_shops",
  "vendor_search",
  "vendor_search_pickup",
  "vendor_opening",
  "customer_delivery_check",
  "popular_near_you",
  "vendor_sections",
  "vendor_menu",
  "vendor_same_price",
  "menu_item_hints",
  "shop_card",
  "catalog_for_number",
  "catalog_shop_menu",
  "catalog_products",
  "shops_closed_near",
]);

export function withPointMemo(deps: CustomerDeps): CustomerDeps {
  let point: { key: string; value: Promise<any> } | null = null;
  return {
    ...deps,
    rpc: (fn, args) => {
      if (fn !== "customer_search_point") {
        if (!POINT_KEEPERS.has(fn)) point = null;
        return deps.rpc(fn, args);
      }
      const key = JSON.stringify(args);
      if (point?.key !== key) {
        const value = deps.rpc(fn, args);
        // A failed read is never kept: the next one asks again.
        value.catch(() => {
          if (point?.value === value) point = null;
        });
        point = { key, value };
      }
      return point.value;
    },
  };
}

export async function handleCustomerTurn(
  rawDeps: CustomerDeps,
  m: CustomerInbound,
  opts: { attempt?: number; leaseUntil?: Date } = {},
): Promise<"done" | "duplicate"> {
  const started = Date.now();
  const deps = withPointMemo(rawDeps);
  const kind = m.synthetic ? "web" : m.buttonId ? "tap" : m.type;
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
  if (m.text) c.s.lang = textLang(withoutShopToken(m.text), c.s.lang, !!begin.first_contact);

  try {
    if (!begin.bot_enabled) say(c, "off");
    else if (begin.customer.blocked) {
      /* blocked numbers get no reply */
    } else {
      // STOP or deletion on any line of a burst is honoured at once, whatever was waiting (a handoff, a typed note):
      // the lines joined are no longer the one word (#6).
      const urgent = urgentLine(c.m);
      // Replies a person sent while the customer was outside the window come with whatever they write next (any message
      // reopens the window), not only with the template's button; the handoff may have ended meanwhile.
      if (urgent) await textIntent(c, urgent);
      else {
        if (c.m.buttonId !== "c:support") await heldReplies(c);
        if (sess.handoff) await duringHandoff(c);
        else await route(c, !!begin.first_contact);
      }
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
  // A pin saved by a turn that sent nothing after it still says so.
  flushSaved(c);

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
  // A photo for a report a person is deciding (spec #49: "send a photo here") joins that report and the thread.
  if (c.m.image) await handoffPhoto(c, c.m.image.id);
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
  // A tester's invite code (§39.15.3) comes before anything else; a text that is not the code carries on below.
  if (m.text && INVITE_RE.test(m.text) && (await demoInvite(c, firstContact))) return;
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
  // A photo answers the optional-photo question of a problem report (spec #49).
  if (m.image && c.s.pending.kind === "problem_photo")
    return problemPhotoAnswer(
      c,
      `wa-media:${m.image.id}`,
      m.caption?.trim() ? m.caption.trim().slice(0, 300) : null,
    );
  if (m.type === "unsupported") {
    // Live location arrives as `unsupported` on the Cloud API (§27.1): ask for a static pin instead.
    return push(c, locationRequest(m.from, tr(c.s.lang, "liveLocation")));
  }
  if (m.audio) {
    if (c.deps.config.voice === false) {
      // §3.1 #4: no AI credit yet. The voice path below stays as it is for when config ai_voice_enabled is on.
      c.tools.push("voice_off");
      return push(c, voiceOffCard(m.from, c.s.lang));
    }
    return voice(c);
  }
  // §3.1 #1 and #5: a sticker is a hello; a photo is read by its caption, else answered with the Order button.
  if (m.type === "sticker") return greet(c, firstContact);
  if (m.type === "image") return photoTurn(c, firstContact);
  if (m.text === null || !m.text.trim()) return say(c, "unsupported");
  // The website's "Add in WhatsApp" (an item page, DECISIONS §39.15.2) sends the item's code: added deterministically.
  const code = itemCodeIn(m.text);
  if (code) return itemFromSite(c, code, itemCodeTail(m.text));
  // A note or an "Other" tip the customer was asked to type (session 5f part 7).
  if (["note", "tip_other"].includes(c.s.pending.kind) && (await awaitedText(c, m.text))) return;
  return textRoute(c, m.text, firstContact);
}

/**
 * A typed text (or a part of one: a shop link's rest, the site's text after its greeting, a burst without its greetings).
 * `inner`: called on such a part, so a burst is never read twice.
 */
async function textRoute(c: Ctx, t: string, firstContact: boolean, inner = false): Promise<void> {
  const m = c.m;
  if (await firstContactText(c, t, firstContact, inner)) return;
  const intent = deterministicIntent(t);
  // The customer's words answer a problem report's optional-photo question (spec #49): "no" skips the photo.
  if (c.s.pending.kind === "problem_photo" && (!intent || intent.kind === "no"))
    return problemPhotoAnswer(c, null, intent ? null : t);
  if (c.s.pending.kind === "problem_photo" && intent?.kind === "yes")
    return push(c, problemPhotoAsk(c.m.from, c.s.lang));
  if (intent) {
    if ((intent.kind === "yes" || intent.kind === "no") && !c.s.pending.kind) return freeText(c, t);
    if (intent.kind === "greeting") return greet(c, firstContact);
    return textIntent(c, intent.kind);
  }
  // Rules that never reach a model or a search (§38.3, §39.6).
  if (isMemoryQuestion(t)) return showMemory(c);
  if (isMedicineRequest(t)) return medicine(c);
  if (c.s.pending.kind === "recipient") return recipientText(c, t);
  if (isOffTopic(t)) return offTopic(c);
  // During an active order, typed words go to the shop as an order note (spec #45).
  if (await orderNoteRelay(c, t)) return;
  if (mentionsSomeoneElse(t)) c.s.refs.xe = { id: "someone_else", label: "someone_else" };
  if (firstContact && t.trim().length < 4) return push(c, welcomeMenu(m.from, c.s.lang));
  return freeText(c, t);
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
  // §3.1 #7: every shop near the customer's saved pin is closed (after 23:00, say): that first, with Remind me.
  if (!firstContact && !c.orders.length && (await closedNear(c))) return;
  const last = c.profile?.last_order;
  if (!firstContact && last?.order_id && Number(c.profile?.delivered_orders ?? 0) > 0)
    return push(c, welcomeBack(c.m.from, c.s.lang, last, c.profile?.name ?? null));
  return push(c, welcomeMenu(c.m.from, c.s.lang));
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
    await forgetWaits(c);
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
  // Spilled or damaged: the photo decides (§27.8 #14), so it is asked first (spec #49-50).
  if (kind === "damaged") return askProblemPhoto(c, kind, null, 1);
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
  // Which item, how many, then the optional photo (spec #49); the server decides after it.
  return askProblemPhoto(c, kind, itemId, qty ?? 1);
}

async function disputeOpen(
  c: Ctx,
  kind: string,
  itemId: string | null,
  qty = 1,
  photo: string | null = null,
  note: string | null = null,
): Promise<void> {
  const order = c.s.refs.xd;
  if (!order) return say(c, "disputeNone");
  // dispute_report: missing and wrong items as dispute_open decides them, cold, spilled and very late by the 8b rules
  // (one discount line per order), with the optional photo and the customer's words on the report.
  const r = await c.deps.rpc("dispute_report", {
    p_customer_id: c.customerId,
    p_order_id: order.id,
    p_kind: kind,
    p_order_item_id: itemId,
    p_quantity: qty,
    p_photo_ref: photo,
    p_note: note,
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
      return say(c, kind === "damaged" && !photo ? "disputeDamaged" : "disputeReview", {
        code: order.label,
      });
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
      return push(c, welcomeMenu(c.m.from, c.s.lang));
    case "menu":
      return startOrder(c);
    case "address":
      return tap(c, { a: "simple", what: "new_address" });
    case "explore":
      return exploreShops(c);
    case "yes":
      // A typed yes or no answers the Start new question only while it is fresh: an ignored card never empties a basket.
      if (c.s.pending.kind === "replace_basket" && !pendingFresh(c)) c.s.pending = {};
      if (c.s.pending.kind === "confirm")
        return confirm(c, c.s.pending.basket_id, c.s.pending.version);
      if (c.s.pending.kind === "shop_note") return shopNoteAnswer(c, "send");
      // "Start a new one from SEVEN?" answered by typing (spec #28): the same as the Start new tap.
      if (c.s.pending.kind === "replace_basket" && c.s.pending.item_id)
        return tap(c, {
          a: "replace_basket",
          itemId: String(c.s.pending.item_id),
          qty: Number(c.s.pending.qty) || 1,
        });
      if (c.s.pending.kind === "delete") return tap(c, { a: "simple", what: "delete_ok" });
      return modelTurn(c, c.m.text ?? "", false);
    case "no":
      if (c.s.pending.kind === "replace_basket" && !pendingFresh(c)) c.s.pending = {};
      if (c.s.pending.kind === "replace_basket") return tap(c, { a: "simple", what: "keep" });
      if (c.s.pending.kind === "shop_note") return shopNoteAnswer(c, "no");
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
  // A demo tester's order from before the test, at a shop that is not a demo shop (§39.15.3).
  if (r?.status === "demo_only") return say(c, "demoOnly");
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
  // Any tap moves on from a typed answer the bot was waiting for (a note, an "Other" tip).
  if (["note", "tip_other"].includes(c.s.pending.kind)) c.s.pending = {};
  switch (a.a) {
    // Session 5f part 7: after the native cart and at checkout.
    case "extra":
      return extraChosen(c, a.optionId, a.rest === true);
    case "note":
      return noteTap(c, a.lineId);
    case "change":
      return changeChosen(c, a.currency, a.amount);
    case "tip":
      return tipChosen(c, a.cents);
    case "tip_after":
      return tipAfterChosen(c, a.orderId, a.cents, a.other === true);
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
        return afterDelivered(c, a.orderId, "glad");
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
      return afterDelivered(c, a.orderId, "thanksRating");
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
      return openShop(c, a.ref);
    }
    case "category":
      return browseCategory(c, a.key);
    case "categories_page":
      return browseHome(c, a.offset);
    case "sections_page":
      return showSectionsPage(c, a.offset);
    case "full_menu":
      return fullMenu(c);
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
    case "rebuild":
      return rebuildAt(c, a.orderId, a.vendorId);
    case "gap_item": {
      // An item that closes the gap to the shop's minimum order (spec #29), then the summary again.
      const added = await addOne(c, a.itemId, 1, [], null, null, true);
      if (added) return checkout(c, {});
      return;
    }
    case "photo_skip":
      return problemPhotoAnswer(c, null, null);
    case "shop_note":
      return shopNoteAnswer(c, a.send ? "send" : "search");
    case "replace_basket": {
      if (c.s.pending.kind === "replace_basket") c.s.pending = {};
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
    case "demo_address":
      return demoAddressPick(c, a.key);
    case "remind":
      return remindMe(c, a.vendorId);
    case "open_shop":
      return shopById(c, a.vendorId);
    case "view_menu":
      return c.s.refs[a.ref] ? showMenu(c, a.ref, null) : say(c, "pickPlaceFirst");
    case "waitlist":
      return joinWaitlist(c);
    case "simple":
      switch (a.what) {
        case "support":
          return showSupportReplies(c);
        case "remember":
          return showMemory(c);
        case "new_address":
          c.s.pending = { kind: "await_pin" };
          // A demo tester or an owner (§39.15.3, session 5g part 0f) gets the demo addresses at once; a pin still works.
          if (await demoChoices(c)) return;
          return push(c, askPin(c.m.from, c.s.lang));
        case "checkout":
          return checkout(c, {});
        case "web":
          // "Continue in WhatsApp" on the web menu (spec §4): the basket is saved; the summary and checkout follow.
          c.summary.push("[basket saved on the web menu]");
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
          await forgetWaits(c);
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
          if (await demoChoices(c)) return;
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
  const r = await deps
    .rpc("order_place", {
      p_basket_id: basketId,
      p_expected_menu_version: version,
      p_idempotency_key: `wa:${basketId}:${version}`,
    })
    .catch(demoRefusal);
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
      if (nx?.saved_cart_id)
        offerSavedCart(c, nx, { vendorId: c.basket.vendor_id ?? null, pickup });
      else delete c.s.refs[AFTER];
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
          ["c:clear", tr(lang, "cancelBasket")],
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
      // A pretend order goes only to someone in the test (§39.15.3).
      if (g?.status === "demo_recipient") return say(c, "demoRecipient");
      return checkout(c, {});
    }
    case "address_unconfirmed":
      return checkout(c, {});
    // Demo testers (§39.15.3): a pretend order goes only to a demo shop; a demo address only serves during the test.
    case "demo_only":
      return say(c, "demoOnly");
    case "demo_address":
      c.s.pending = { kind: "await_pin" };
      return say(c, "demoAddressGone");
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
  // The shop menu after the pin uses the catalogue: asked alongside the save (§39.15.6).
  void catalogFor(c);
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
  if (r?.status === "demo_outside") return demoOutside(c, r);
  return afterPin(c, r);
}

/** After a pin is saved, or a demo address picked (§39.15.3): the address is read back and the order goes on. */
async function afterPin(c: Ctx, r: any) {
  // §3.2 #11: a place we do not deliver to (yet): the waitlist and pickup, never "address saved". The test shop takes any
  // pin (DECISIONS §35): while one this customer can see is orderable, the pin goes on as usual (waitlist_state: test_shop).
  const placeStatus = r?.address?.place_status;
  if (placeStatus === "paused" || placeStatus === "off") {
    const addressId = typeof r.address.address_id === "string" ? r.address.address_id : null;
    const st = await waitlistState(c, addressId);
    if (st?.status !== "test_shop" && st?.status !== "delivered")
      return outsideArea(c, addressId, st);
  }
  // Sent with the next message, or as the craving list's first line (browseHome).
  c.savedLine = tr(c.s.lang, "savedPin", { where: where(c.s.lang, r.address) });
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
  return afterAddress(c);
}

/** After the address step (a pin, a demo address, the address Flow): the basket's checkout, the shop a link chose, or browsing. */
async function afterAddress(c: Ctx) {
  if (c.basket?.lines?.length) return checkout(c, {});
  // No basket yet: the open places that deliver here (§34 step 3), or the focused place's menu.
  const focusRef = Object.entries(c.s.refs).find(
    ([k, v]) => k.startsWith("v") && v.id === c.s.focus_vendor_id,
  )?.[0];
  const browse = c.s.pending.then === "browse" || !focusRef;
  const wantsPickup = c.s.pending.then === "pickup";
  // The website's picks that came with a shop link wait for the pin with it (§3.1 #2).
  const picks = c.s.pending.then === "shop" ? c.s.pending.picks : null;
  c.s.pending = {};
  if (wantsPickup) return pickupPlaces(c);
  if (browse || !focusRef) return browseHome(c);
  await openShop(c, focusRef);
  return readSitePicks(c, picks);
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
    // The pin came while a step waited for it (a shop link's shop, browsing): it goes on (§3.1 #2).
    if (c.s.pending.kind === "await_pin" && c.s.pending.then) return afterAddress(c);
    return say(c, "addressSaved");
  }
  return say(c, "flowRetry");
}

// ---- Saved carts (§39.15.2): the same steps for a tap and for the agent's saved_cart tool --------------------------
/** The order a saved-cart offer follows (shop just ordered from, pickup or delivery): the server's, never a model ref. */
const AFTER = "_after";
/**
 * Offers the next saved cart (a split cart's other shop), as a ref the agent can name too. After an order the offer keeps
 * that order's context (the shop just ordered from, pickup or delivery) in the session, so "No thanks" offers the next
 * one by the same rules.
 */
function offerSavedCart(c: Ctx, nx: any, after?: { vendorId: string | null; pickup: boolean }) {
  if (after)
    c.s.refs[AFTER] = { id: after.vendorId ?? "", label: after.pickup ? "pickup" : "delivery" };
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
  const after = c.s.refs[AFTER];
  const nx = await c.deps
    .rpc("saved_cart_next", {
      p_customer_id: c.customerId,
      p_exclude_vendor_id: after?.id || null,
      p_pickup: after?.label === "pickup",
    })
    .catch(() => null);
  if (nx?.saved_cart_id) return offerSavedCart(c, nx);
  delete c.s.refs[AFTER];
  return say(c, "savedCartDropped");
}

/**
 * The closest shop's same dish, in place of the cart's shop that does not deliver to the pin. Only once the dish is in
 * the basket does it leave that shop's saved cart (the same dish only); the shop's other items stay kept (pickup is
 * still possible) and are named, never lost silently.
 */
async function cartAlternative(c: Ctx, savedCartId: string, itemId: string, qty: number) {
  // Asked first: a second tap on the same row, or a dish that is not the one offered for that cart, adds nothing.
  const ok = await c.deps
    .rpc("saved_cart_swap", {
      p_customer_id: c.customerId,
      p_saved_cart_id: savedCartId,
      p_item_id: itemId,
      p_message_id: c.m.messageId,
      p_check_only: true,
    })
    .catch((e) => {
      // A stalled call replays the turn (§39.13); only a real refusal reads as "no longer kept".
      if (e instanceof RpcStalled) throw e;
      return null;
    });
  if (ok?.other_basket)
    return say(c, "cartAltOtherBasket", {
      basket: c.s.lang === "ar" ? ok.basket : (ok.basket_en ?? ok.basket),
    });
  if (ok?.ok !== true) return say(c, "savedCartGone");
  const added = await addOne(c, itemId, Math.min(Math.max(qty, 1), 50), [], null, null);
  if (!added) return;
  const sw = await c.deps
    .rpc("saved_cart_swap", {
      p_customer_id: c.customerId,
      p_saved_cart_id: savedCartId,
      p_item_id: itemId,
      // Keyed by this message: a replayed turn gets the same answer (and the same cart to join), never a second swap.
      p_message_id: c.m.messageId,
    })
    .catch((e) => {
      // A stalled swap replays the turn: the check, the add and the swap all answer the same for this message.
      if (e instanceof RpcStalled) throw e;
      return null;
    });
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
  // The alternative's shop was in the cart too: the customer's own picks from it join the same basket.
  if (sw?.join_saved_cart_id) return savedCartTake(c, String(sw.join_saved_cart_id));
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
    // A shop that does not deliver to the pin is kept for pickup, never promised as a delivery after this order.
    // A paused place is temporary: the cart stays kept and is offered once deliveries there resume.
    if (sv.place_paused && !sv.pickup_enabled)
      say(c, "cartBothSavedPaused", {
        vendor: lang === "ar" ? sv.vendor : (sv.vendor_en ?? sv.vendor),
        basket: String(p.basket ?? ""),
      });
    else if (sv.delivers !== false && !sv.place_paused)
      say(c, "cartBothSaved", {
        vendor: lang === "ar" ? sv.vendor : (sv.vendor_en ?? sv.vendor),
        basket: String(p.basket ?? ""),
      });
    else if (sv.pickup_enabled)
      say(c, "cartBothSavedPickup", {
        vendor: lang === "ar" ? sv.vendor : (sv.vendor_en ?? sv.vendor),
        basket: String(p.basket ?? ""),
      });
    else {
      // It neither delivers here nor takes pickup: keeping it would promise an order that cannot happen.
      await c.deps
        .rpc("saved_cart_drop", { p_customer_id: c.customerId, p_saved_cart_id: sv.saved_cart_id })
        .catch(() => null);
      say(c, "cartBothNoWay", {
        vendor: lang === "ar" ? sv.vendor : (sv.vendor_en ?? sv.vendor),
        basket: String(p.basket ?? ""),
      });
    }
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
  opts: { messageId?: string; split?: boolean; lead?: string | null } = {},
) {
  c.tools.push("cart");
  if (!lines.length) return say(c, "unsupported");
  // The catalogue ("Goes well with" as a product) is asked alongside the cart's own calls (§39.15.6).
  void catalogFor(c);
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
      delete c.s.refs[AFTER];
      const named = (sp.shops as any[]).slice(0, 10).map((x) => {
        const shop = String(x.vendor_en ?? x.vendor);
        const verdict = x.delivers === false ? " (doesn't deliver to the customer)" : "";
        const cref = refFor(c, "c", String(x.saved_cart_id), `${shop}${verdict}`);
        const alt = x.delivers === false ? x.alternative : null;
        if (!alt) return `${cref} ${shop}${verdict}`;
        const label = `${alt.item_en ?? alt.item} x${alt.quantity ?? 1} from ${alt.vendor_en ?? alt.vendor}`;
        return `${cref} ${shop}${verdict}, instead ${refFor(c, "i", String(alt.item_id), label)} ${label}`;
      });
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
  // A demo tester's cart from a shop that is not a demo shop (§39.15.3): the way to the demo shops instead.
  if (!Number(r.added ?? 0) && skipped.some((x) => x?.status === "demo_only"))
    return say(c, "demoOnly");
  const needs: any[] = Array.isArray(r.needs_options) ? r.needs_options : [];
  const diffs: any[] = Array.isArray(r.diffs) ? r.diffs : [];
  c.summary.push(
    `[cart from the catalogue: ${lines.length} lines, ${Number(r.added ?? 0)} added, ${skipped.length} not added, ${needs.length} need choices, ${diffs.length} price changes]`,
  );
  // One message for what changed: the lines not added and the prices the server corrected (USD; the summary adds LBP).
  const notes: string[] = [];
  // What the caller says first (a rebuilt order's dishes the new shop does not have, spec #41), in the same message.
  if (opts.lead) notes.push(opts.lead);
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
  // #25: the required choices one at a time and each item's add-ons once, then checkout. Never the item_options Flow here:
  // Flows wait for Meta's business verification (#182).
  const queued = await cartChoices(c, lines, needs, skipped);
  if (queued === "asked") return;
  // Nothing of this cart went in (the old basket, if any, is as it was): say so, never check out the old basket.
  if (!(Number(r.added ?? 0) + queued) || !c.basket?.lines?.length) return say(c, "cartNothing");
  // "Goes well with" (the order's one upsell), then the normal checkout: address confirmation, the checkout Flow or the
  // cash question, then the summary to confirm.
  return cartReady(c);
}

// ---- The Meta catalogue: product messages chosen per shop (§39.12) ---------------------------------------------------
/** The catalogue a reply may use (the sending number's business account, or the simulated one), asked once per turn. */
async function catalogFor(c: Ctx): Promise<string | null> {
  if (c.catalog !== undefined) return c.catalog;
  c.catalogAsk ??= c.deps
    .rpc("catalog_for_number", { p_phone_number_id: c.deps.senderNumberId ?? null, p_to: c.m.from })
    .catch(() => null)
    .then((id) => (c.catalog = typeof id === "string" && id ? id : null));
  return c.catalogAsk;
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
  // A waiting "Address saved" goes before the cover, never into the list moved below.
  flushSaved(c);
  const before = c.out.length;
  if (query) return showMenuList(c, vendorRef, query);
  const shop = shopName(v.label);
  // The section list, the cover and the catalogue's menu are read side by side (§39.15.6); none waits for another.
  const coverAsk = shopCover(c, v.id, shop).catch((e: unknown) => {
    c.deps.log?.("shop cover failed", { error: String(e).slice(0, 120) });
    return null;
  });
  const menuAsk = catalogFor(c).then((cat) =>
    cat
      ? c.deps.rpc("catalog_shop_menu", { p_vendor_id: v.id, p_catalog_id: cat }).catch(() => null)
      : null,
  );
  await showMenuList(c, vendorRef, null);
  const list = c.out.splice(before);
  // The cover goes first only when it pushes nothing else out of this turn's messages (MAX_MESSAGES).
  const room = (n: number) => c.out.length + 1 + n <= MAX_MESSAGES;
  const [cover, menu] = await Promise.all([coverAsk, menuAsk]);
  if (!c.catalog) {
    if (cover && room(list.length)) push(c, cover);
    push(c, ...list);
    return;
  }
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
    // Items Meta cannot show (no approved photo): the shop's section list ends with "Full menu" (§39.15.13).
    push(c, ...(fullMenuOffered(c, menu) ? list.map((m) => withFullMenuRow(m, c.s.lang)) : list));
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
  if (rest.length) pushSectionsPage(c, shop, rest, 0, fullMenuOffered(c, menu));
}

/**
 * Whether a shop's section list ends with the "Full menu" row (DECISIONS §39.15.13): only when the site has an address and
 * some of the shop's items cannot be shown natively (fewer shown in product messages than it has).
 */
function fullMenuOffered(
  c: Ctx,
  menu: { total?: unknown; shown?: unknown; sections?: unknown } | null,
): boolean {
  if (!c.deps.config.siteUrl || !menu || c.noFullMenu) return false;
  const sections: ShopMenuSection[] = Array.isArray(menu.sections) ? menu.sections : [];
  const shown = Number(menu.shown ?? sections.reduce((n, x) => n + (x.products?.length ?? 0), 0));
  return Number(menu.total ?? 0) > shown;
}

/** "Full menu" tapped (§39.15.13): the signed link to the focused shop's web menu, else its menu in the chat. */
async function fullMenu(c: Ctx) {
  const vendorId = c.s.focus_vendor_id;
  if (!vendorId) return say(c, "pickPlaceFirst");
  const url = await webLink(c, "menu", vendorId);
  const vref = Object.entries(c.s.refs).find(
    ([k, v]) => k.startsWith("v") && v.id === vendorId,
  )?.[0];
  if (!url) {
    // No link (the site has no address, or the shop cannot take this customer): the shop's menu in the chat, without the
    // row, so the tap never loops.
    if (!vref) return say(c, "pickPlaceFirst");
    c.noFullMenu = true;
    return showMenu(c, vref, null);
  }
  c.tools.push("web:menu_link");
  const shop = shopName(vref ? c.s.refs[vref].label : (c.basket?.vendor_en ?? ""));
  push(c, fullMenuCard(c.m.from, c.s.lang, shop, url));
}

/**
 * A shop's cover with its one line (session 5e): its photo, name, cuisine · village · fee · hours. Native only
 * (DECISIONS §39.15.13: no Open menu button; the shop's product messages follow). Null when the shop has no cover.
 * The card and the cover's signed link and fee are read in two rounds of calls (§39.15.6).
 */
async function shopCover(c: Ctx, vendorId: string, shop: string): Promise<Msg | null> {
  const card = (await c.deps.rpc("shop_card", { p_vendor_id: vendorId }).catch(() => null)) as
    | (ShopCard & {
        cover?: {
          path?: string;
          source?: string;
          credit?: string | null;
          license?: string | null;
        } | null;
      })
    | null;
  if (!card) return null;
  const path = card.cover?.path;
  if (!(path && c.deps.photoUrl)) return null;
  const [link, chk] = await Promise.all([
    c.deps.photoUrl(path).catch(() => null),
    c.deps
      .rpc("customer_delivery_check", { p_customer_id: c.customerId, p_vendor_ids: [vendorId] })
      .catch(() => null),
  ]);
  const q = (chk?.vendors ?? []).find((x: any) => x.vendor_id === vendorId);
  const fee = q?.status === "ok" && q.fee_usd != null ? Number(q.fee_usd) : null;
  const line = shopLine(c.s.lang, card, fee);
  if (!link) return null;
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
  return image(c.m.from, link, `*${shop}*\n${line}${credit}`);
}

/**
 * A signed link to the customer's web menu of a shop (the "Full menu" row, §39.15.13), or to Explore: null until the
 * site has an address, or when the customer may not order from that shop. The site reads the chat's language (Arabic for
 * Arabizi, §2 rule 1).
 */
async function webLink(
  c: Ctx,
  kind: "menu" | "explore",
  vendorId: string | null = null,
): Promise<string | null> {
  if (!c.deps.config.siteUrl) return null;
  const url = await c.deps
    .rpc("web_link_create", {
      p_customer_id: c.customerId,
      p_kind: kind,
      p_vendor_id: vendorId,
      p_lang: c.s.lang === "en" || c.s.lang === "fr" ? c.s.lang : "ar",
    })
    .catch(() => null);
  return typeof url === "string" && /^https:\/\//.test(url) ? url : null;
}

/** The rest of a shop's sections as a list, a page at a time ("More sections" pages through them; "Full menu" last). */
function pushSectionsPage(
  c: Ctx,
  shop: string,
  rest: ShopMenuSection[],
  offset: number,
  fullMenu = false,
) {
  resetRefs(c, "s");
  const more = rest.length > offset + sectionsPageSize(fullMenu, false);
  const size = sectionsPageSize(fullMenu, more);
  const rows = rest.slice(offset, offset + size).map((r) => ({
    ref: refFor(c, "s", r.section_id ?? "", localName(c.s.lang, r.name_ar, r.name_en)),
    name_ar: r.name_ar,
    name_en: r.name_en,
    items: Number(r.total ?? 0),
  }));
  push(c, moreSectionsList(c.m.from, c.s.lang, shop, rows, more ? offset + size : null, fullMenu));
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
  pushSectionsPage(
    c,
    shop,
    rest,
    Math.min(Math.max(offset, 0), Math.max(rest.length - 1, 0)),
    fullMenuOffered(c, menu),
  );
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
      flushSaved(c);
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
  if (r.paused) return outsideArea(c);
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
    if (await demoChoices(c)) return;
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
  await labelOpenings(c, vs);
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
    // A shop the delivery check says cannot come here (beyond its radius, or the place paused while the test shop takes the
    // pin) is not listed: it would fail at checkout.
    .filter((x) => !["beyond_radius", "place_paused"].includes(by.get(x.vendor_id)?.status))
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
  if (r.paused) return outsideArea(c);
  // §3.1 #7: every shop that delivers here is closed: say when the first opens, with Remind me and See menus.
  if (r.point && r.shops.length && r.shops.every((x) => !x.is_open))
    return closedFromShops(c, r.shops);
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
  // A pin just saved says so on the list's first line: one message, so Popular near you still fits.
  const saved = c.savedLine ?? null;
  c.savedLine = undefined;
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
      saved,
    ),
  );
  // "Popular near you" after the first page of the craving list (§39.15.2). No Explore link: customers stay in WhatsApp
  // (DECISIONS §39.15.13).
  if (!offset) await popularNearYou(c, r.shops);
}

/**
 * "Explore", `/explore` or the "Explore shops near me" ice breaker, answered natively (DECISIONS §39.15.13): the shops that
 * deliver here, then Popular near you as a product carousel. No pin yet: the pin first.
 */
async function exploreShops(c: Ctx) {
  const r = await deliveringShops(c);
  if (!r.point?.address_id) return startOrder(c);
  // A place we do not deliver to (yet), or no shop delivering there: the chat's own answer (the waitlist, pickup, the
  // demo addresses), never a list of shops as if they delivered.
  if (r.paused || !r.shops.length) return browseHome(c);
  c.tools.push("browse:explore");
  c.summary.push(`[explore: ${r.shops.length} shops deliver]`);
  await listShops(
    c,
    r.shops,
    tr(c.s.lang, "nearShops", { place: r.place || tr(c.s.lang, "yourPlace") }),
  );
  // One open shop opens at once (listShops); otherwise the shops are followed by Popular near you.
  if (!(r.shops.length === 1 && r.shops[0].is_open)) await popularNearYou(c, r.shops);
}

async function listShops(c: Ctx, shops: DeliveringShop[], body: string) {
  resetRefs(c, "v");
  const rows = shops.slice(0, 10).map((x) => ({
    ...x,
    ref: refFor(c, "v", x.vendor_id, `${x.name_en ?? x.name_ar}${x.is_open ? "" : " (closed)"}`),
  }));
  if (rows.length === 1 && rows[0].is_open) return showMenu(c, rows[0].ref, null);
  // §3.3 #21: closed shops come last (deliveringShops), each saying when it opens.
  await labelOpenings(c, rows);
  const more = shops.length > 10 ? `\n${tr(c.s.lang, "nearest10", { n: shops.length })}` : "";
  push(c, shopList(c.m.from, c.s.lang, `${body}${more}`, rows));
}

/** A category: the shops that serve it and deliver here, nearest first, with fee and distance. */
async function browseCategory(c: Ctx, key: string) {
  const r = await deliveringShops(c);
  if (r.paused) return outsideArea(c);
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
  if (r.paused) return outsideArea(c);
  if (!r.point) return startOrder(c);
  if (!r.shops.length) {
    if (await demoChoices(c)) return;
    return push(c, noDeliveryCard(c.m.from, c.s.lang));
  }
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
  await labelOpenings(c, vs);
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
    await otherShop(c, itemId, qty, String(r.basket_vendor ?? ""));
    return false;
  }
  if (r?.status === "unavailable") {
    say(c, "unavailable", { item: r.item });
    return false;
  }
  if (r?.status === "demo_only") {
    say(c, "demoOnly");
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
  if (p.kind === "cart_opts") return cartOptionChosen(c, optionId);
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
    /** A change or tip tap only re-shows the summary: no live route attempt (session 5f part 7). */
    skipRoute?: boolean;
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
  // The address state, quote, substitution question and cash state in one call (basket_checkout_view, §39.15.6), each
  // asked on its own only when the view did not answer it.
  // Not while "For my mom" waits to be asked (refs.xe): the view would quote first, and a quote moves the offer the
  // order's repriced check compares with (order_place); the steps are then asked one by one, as before.
  const view = c.s.refs.xe
    ? null
    : await deps
        .rpc("basket_checkout_view", { p_customer_id: c.customerId })
        .catch((e: unknown) => {
          if (e instanceof RpcStalled) throw e;
          return null;
        });
  // The delivery address is confirmed on every order, and a new one asks who the order is for (§22.1, §39.6).
  const st =
    view?.address ?? (await deps.rpc("basket_address_state", { p_customer_id: c.customerId }));
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
  let q: Quote = view?.quote ?? (await deps.rpc("basket_quote", { p_customer_id: c.customerId }));
  // The shop → pin route is not cached yet (§39.15.1): the quote came from the shop → place distance, or from nothing.
  // One live call (2 s, within the day's budget); whatever it answers, the order goes on unless neither distance exists.
  const live = q as any;
  if (live?.origin && live?.dest && !args.skipRoute) {
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
      return outsideArea(c);
    case "no_route":
      return say(c, "noRoute");
    case "beyond_radius":
      return push(c, beyondRadius(c.m.from, lang, q));
    case "below_minimum":
      return belowMinimum(c, q);
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
      const sp =
        view?.substitution ??
        (await deps.rpc("basket_substitution_needed", { p_customer_id: c.customerId }));
      if (sp?.needed) {
        return push(c, substitutionAsk(c.m.from, lang, Number(sp.max_usd ?? 0)));
      }
      // Cash in USD or LBP (§34 step 8), asked once per basket and only if the shop takes both.
      const cs =
        view?.cash ?? (await deps.rpc("basket_cash_state", { p_customer_id: c.customerId }));
      if (cs?.status === "ok" && !cs.cash_currency && (cs.allowed?.length ?? 0) > 1)
        return push(c, cashAsk(c.m.from, lang, cs.allowed));
      // Then "Do you need change?", and the tip with the total it makes (session 5f part 7, #35 and #38).
      const ex = q.over_cod_cap ? null : await checkoutExtras(c, q);
      if (ex === "asked") return;
      const newCustomer = Number(c.profile?.delivered_orders ?? 0) === 0;
      push(c, ...summaryMessage(c.m.from, lang, q, newCustomer, cs?.cash_currency ?? null, ex));
      if (!q.over_cod_cap) {
        c.s.pending = {
          kind: "confirm",
          basket_id: q.basket.basket_id,
          version: q.basket.menu_version,
        };
        c.summary.push("[showed the order summary; waiting for the customer's Confirm tap]");
        const u = await deps.rpc("basket_upsell", { p_customer_id: c.customerId });
        if (u?.item_id) push(c, upsellMessage(c.m.from, lang, u));
        if (ex) pushTipRow(c, ex);
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
  // Spoken words answer a problem report's optional-photo question as typed ones do (spec #49).
  if (c.s.pending.kind === "problem_photo") return problemPhotoAnswer(c, null, transcript);
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
  // Keys starting with "_" are the server's own bookkeeping, never shown to the model.
  const refs = Object.fromEntries(
    Object.entries(c.s.refs)
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => [k, v.label]),
  );
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
    // Session 5f part 7: after the cart and at checkout.
    case "set_item_note":
    case "add_item_extras":
    case "set_cash_change":
    case "set_tip":
    case "tip_order":
      return validAfterCart(name, input);
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
        [undefined, null, true, false].includes(input.start_new_basket) &&
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
            s(i.note, NOTE_INPUT_MAX),
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
    case "saved_cart": {
      const none = (v: unknown) => v === null || v === undefined;
      const qtyOk =
        none(input.quantity) ||
        (Number.isInteger(input.quantity) && input.quantity >= 1 && input.quantity <= 50);
      if (input.action === "alternative")
        return ref(input.cart_ref, "c") && ref(input.item_ref, "i") && qtyOk;
      if (input.action === "take" || input.action === "drop")
        return ref(input.cart_ref, "c") && none(input.item_ref);
      return (
        ["switch", "keep", "both"].includes(input.action) &&
        none(input.cart_ref) &&
        none(input.item_ref)
      );
    }
    case "request_human":
      return typeof input.reason === "string" && input.reason.length <= 300;
    case "remind_when_open":
      return input.vendor_ref === null || ref(input.vendor_ref, "v");
    case "join_waitlist":
    case "pickup_places":
      return true;
    case "message_shop":
      return (
        typeof input.text === "string" && input.text.trim().length > 0 && input.text.length <= 300
      );
    case "rebuild_basket":
      return ref(input.vendor_ref, "v");
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
    // Session 5f part 7: after the cart and at checkout.
    case "set_item_note":
    case "add_item_extras":
    case "set_cash_change":
    case "set_tip":
    case "tip_order":
      return aiAfterCart(c, name, input);
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
        // The customer chose to empty a basket from another shop and start here (spec #28, the Start new tap's path): only
        // once the question was asked (pending replace_basket); otherwise addOne asks it. An item with options asks too.
        if (
          input.start_new_basket === true &&
          !added &&
          c.s.pending.kind === "replace_basket" &&
          pendingFresh(c) &&
          !(it.options ?? []).length
        ) {
          const opts = await deps.rpc("menu_item_options", { p_item_id: itemId });
          if (!(Array.isArray(opts) && opts.some((g: any) => Number(g?.min) > 0))) {
            const rr = await addItem(c, {
              p_customer_id: id,
              p_item_id: itemId,
              p_quantity: it.quantity,
              p_option_ids: [],
              p_note: it.note ?? null,
              p_replace: true,
            });
            if (rr?.status === "added") {
              c.basket = rr.basket ?? c.basket;
              if (c.s.pending.kind === "replace_basket") c.s.pending = {};
              added++;
              continue;
            }
          }
        }
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
      if (input.action === "alternative") {
        const sc = c.s.refs[input.cart_ref];
        const it = c.s.refs[input.item_ref];
        if (!sc || !it) return say(c, "savedCartGone");
        return cartAlternative(c, sc.id, it.id, input.quantity ?? 1);
      }
      if (input.action === "keep") {
        // Only a cart's question is answered here; any other pending step stays as it was.
        if (c.s.pending.kind === "cart") c.s.pending = {};
        return say(c, "done");
      }
      return input.action === "both" ? cartBoth(c) : cartReplace(c);
    }
    case "request_human":
      return handoff(c, input.reason);
    // Session 5f part 8a: every new button is a tool too (DECISIONS §39.14 rule 1); the customer comes from the session.
    case "remind_when_open": {
      const v = input.vendor_ref ? c.s.refs[input.vendor_ref] : null;
      if (input.vendor_ref && !v) return say(c, "pickPlaceFirst");
      return remindMe(c, v ? v.id : null);
    }
    case "join_waitlist":
      return joinWaitlist(c);
    case "pickup_places":
      return pickupPlaces(c);
    case "message_shop":
      // Spec #45: the customer's words to the shop on their active order (the order comes from the server, never the model).
      if (!(await messageShop(c, input.text))) return say(c, "trackNone");
      return;
    case "rebuild_basket": {
      // Spec #41: the order a shop could not take, rebuilt at a shop the server offered (a vendor ref from the context).
      const v = c.s.refs[input.vendor_ref];
      if (!v) return say(c, "pickPlaceFirst");
      return rebuildAt(c, null, v.id);
    }
    case "reply":
      return replyText(c, input.text, input.confidence);
  }
}

// ---- Demo testers (session 5f part 6, DECISIONS §39.15.3) ------------------------------------------------------------------
/** The invite code's shape ("ALO" and 8 hex digits, as demo_config_ensure makes it); only the server knows the code. */
const INVITE_RE = /\bALO[0-9A-F]{8}\b/i;
/** A message that is nothing but a code (the tester link's text). */
const ONLY_CODE_RE = /^\s*ALO[0-9A-F]{8}\s*$/i;

/** order_place refused a demo tester's order (the orders trigger): the status the bot answers with buttons. */
function demoRefusal(e: unknown): { status: string } {
  const msg = String(e instanceof Error ? e.message : e);
  if (/\bdemo_only\b/.test(msg)) return { status: "demo_only" };
  if (/\bdemo_address\b/.test(msg)) return { status: "demo_address" };
  throw e;
}

/**
 * The language of a typed message. An invite code says nothing about it: a tester's first message is the link's bare code,
 * so a first contact that is only a code starts in English (testers write from anywhere); later, the language is kept.
 */
function textLang(t: string, current: CLang, firstContact: boolean): CLang {
  if (!INVITE_RE.test(t)) return detectLang(t, current);
  const rest = t.replace(new RegExp(INVITE_RE.source, "gi"), " ").trim();
  if (rest) return detectLang(rest, current);
  return firstContact ? "en" : current;
}

/**
 * A message carrying something like the invite code: the server enrols the number (demo_tester_enrol). A tester first hears
 * that orders are pretend, then the normal welcome; a full test says so with the main menu. False: not the code, so the
 * message is handled as any other.
 */
async function demoInvite(c: Ctx, firstContact: boolean): Promise<boolean> {
  const r = await c.deps
    .rpc("demo_tester_enrol", { p_customer_id: c.customerId, p_text: c.m.text })
    .catch((e: unknown) => {
      c.deps.log?.("demo_tester_enrol failed", { error: String(e).slice(0, 120) });
      return null;
    });
  const status = String(r?.status ?? "");
  c.tools.push(`demo_tester:${status || "failed"}`);
  // What the customer wrote besides the code: a request, answered as usual after the code is handled.
  const rest = (c.m.text ?? "")
    .replace(new RegExp(INVITE_RE.source, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
  switch (status) {
    case "enrolled":
    case "already":
      // An active tester who writes more than the code ("ALO… burger") gets the request answered; a new one first hears
      // that orders are pretend.
      if (status === "already" && rest) {
        c.m.text = rest;
        return false;
      }
      c.summary.push("[a demo tester: told that orders are pretend]");
      say(c, "testerWelcome");
      if (rest) {
        c.m.text = rest;
        return false;
      }
      await greet(c, firstContact);
      return true;
    case "full":
      push(c, testerFullMenu(c.m.from, c.s.lang));
      return true;
    case "off":
    case "removed":
      // An old link (the message is only the code): the plain welcome, never a search for the code. Anything more than the
      // code is the customer's message, answered as usual (§39.14: every message gets its answer).
      if (!ONLY_CODE_RE.test(c.m.text ?? "")) return false;
      await greet(c, firstContact);
      return true;
    default:
      return false;
  }
}

/** A tester's (or an owner's) pin outside the delivery area, not stored by the server: the demo addresses instead. */
function demoOutside(c: Ctx, r: any) {
  const choices = Array.isArray(r?.choices) ? r.choices : [];
  if (!choices.length) return say(c, "placePaused");
  c.summary.push("[outside the delivery area: offered the demo addresses]");
  // The pending step (browse, pickup or the basket's checkout) stays: the pick continues it as a pin would.
  push(c, demoAddressCard(c.m.from, c.s.lang, choices));
}

/**
 * "Change address" for a demo tester or an owner (session 5g part 0f): the demo addresses as one card and the pin request,
 * so a friend abroad switches with one tap and nobody is told "we don't deliver to you". False for everyone else.
 */
async function demoChoices(c: Ctx): Promise<boolean> {
  const choices = await c.deps
    .rpc("demo_address_choices_for", { p_customer_id: c.customerId })
    .catch(() => null);
  if (!Array.isArray(choices) || !choices.length) return false;
  c.tools.push("demo_address_change");
  c.summary.push("[change address during the test: offered the demo addresses]");
  // A pin or a demo address answers it, then browsing goes on; a step already waiting (a basket's checkout) is kept.
  if (!c.s.pending.kind) c.s.pending = { kind: "await_pin", then: "browse" };
  push(c, demoAddressCard(c.m.from, c.s.lang, choices, "demoChange"), askPin(c.m.from, c.s.lang));
  return true;
}

/** A demo address tapped: the tester's address at that fixed point, then everything as after a pin. */
async function demoAddressPick(c: Ctx, key: string) {
  c.tools.push("demo_address_pick");
  const r = await c.deps.rpc("demo_address_pick", { p_customer_id: c.customerId, p_key: key });
  if (r?.status !== "saved") return say(c, "placePaused");
  return afterPin(c, r);
}

// ---- Session 5f part 7: the chat after the native cart and at checkout --------------------------------------------------
// #25 choices and add-ons after a native cart, #26 item notes, #35 change for cash, #38 tips, and the product carousel
// (DECISIONS §39.15.2). Every amount is the server's; a tap carries only an id or one of the amounts the server offered,
// which the server checks again against its config.

/** One item of a cart waiting on choices: its item, quantity, options chosen so far, its basket line once added. */
type CartQueueEntry = { i: string; q: number; c: string[]; l?: string; x?: 1 };

/**
 * The cart's items with required choices (cart_merge's needs_options) and the items added at once that have add-ons still
 * to offer, as one queue in the session. Returns "asked" while a question is out, else how many items it added.
 */
async function cartChoices(
  c: Ctx,
  lines: CartLine[],
  needs: any[],
  skipped: any[],
): Promise<"asked" | number> {
  const queue: CartQueueEntry[] = needs.slice(0, 30).map((n) => ({
    i: String(n.item_id),
    q: Math.min(Math.max(Number(n.quantity ?? 1) || 1, 1), 50),
    c: [],
  }));
  const held = new Set([...needs, ...skipped].map((x) => String(x.item_id)));
  const direct = [...new Set(lines.map((l) => l.itemId).filter((id) => !held.has(id)))];
  if (direct.length) {
    const ex = await c.deps
      .rpc("basket_lines_with_extras", { p_customer_id: c.customerId, p_item_ids: direct })
      .catch(() => null);
    for (const l of Array.isArray(ex) ? ex : [])
      queue.push({ i: String(l.item_id), q: 0, c: [], l: String(l.line_id) });
  }
  if (!queue.length) return 0;
  c.tools.push("cart:choices");
  c.s.pending = { kind: "cart_opts", queue };
  return cartQueueNext(c);
}

/**
 * Works through the queue: asks the head item's next required choice (buttons for three options or fewer, else a list),
 * adds the item once its required groups are chosen (basket_add_item, priced by the server), then offers its add-ons once
 * (basket_line_extras marks the line). An item that cannot be ordered as it is now is named and skipped.
 */
async function cartQueueNext(c: Ctx): Promise<"asked" | number> {
  const p = c.s.pending;
  const queue: CartQueueEntry[] = p.kind === "cart_opts" && Array.isArray(p.queue) ? p.queue : [];
  let added = 0;
  while (queue.length) {
    const h = queue[0];
    if (!h.l) {
      const it = await c.deps.rpc("item_choice_groups", { p_item_id: h.i }).catch(() => null);
      // Not one of our items any more (or unreadable): never added without its choices.
      if (!it) {
        queue.shift();
        continue;
      }
      const groups: ChoiceGroup[] = Array.isArray(it.groups) ? it.groups : [];
      const label = localName(c.s.lang, it?.name, it?.name_en);
      // Only this item's options, and never more of a group than it takes (the latest taps win).
      const chosen = (h.c ?? []).map(String);
      h.c = [];
      for (const g of groups) {
        const mine = chosen.filter((id) => g.options.some((o) => o.option_id === id));
        h.c.push(...mine.slice(-Math.max(Number(g.max ?? 1), 1)));
      }
      const count = (g: ChoiceGroup) => g.options.filter((o) => h.c.includes(o.option_id)).length;
      const missing = groups.find((g) => Number(g.min ?? 0) > count(g));
      if (missing) {
        const left = missing.options.filter((o) => !h.c.includes(o.option_id));
        const need = Number(missing.min) - count(missing);
        if (left.length >= need) {
          c.s.pending = { kind: "cart_opts", queue };
          c.summary.push(`[asked a required choice for a cart item: ${queue.length} in the queue]`);
          push(c, choiceAsk(c.m.from, c.s.lang, label, missing, left, need));
          return "asked";
        }
        if (label) say(c, "unavailable", { item: label });
        queue.shift();
        continue;
      }
      const r = await addItem(c, {
        p_customer_id: c.customerId,
        p_item_id: h.i,
        p_quantity: h.q || 1,
        p_option_ids: h.c,
        p_note: null,
        p_replace: false,
      });
      if (r?.status !== "added" || !r.line_id) {
        if (r?.status === "unavailable" || label) say(c, "unavailable", { item: r?.item ?? label });
        queue.shift();
        continue;
      }
      if (r.basket) c.basket = r.basket;
      h.l = String(r.line_id);
      added++;
    }
    if (!h.x && !p.noExtras) {
      h.x = 1;
      const e = await c.deps
        .rpc("basket_line_extras", { p_customer_id: c.customerId, p_line_id: h.l })
        .catch(() => null);
      if (e?.status === "offer" && Array.isArray(e.groups) && e.groups.length) {
        c.s.pending = { kind: "cart_opts", queue };
        c.summary.push("[offered a cart item's add-ons, once]");
        push(
          c,
          extrasList(
            c.m.from,
            c.s.lang,
            localName(c.s.lang, e.item, e.item_en),
            e.groups,
            false,
            queue.length > 1,
          ),
        );
        return "asked";
      }
    }
    queue.shift();
  }
  c.s.pending = {};
  return added;
}

/** A required choice tapped (opt:<id>) while a cart's queue is waiting. */
async function cartOptionChosen(c: Ctx, optionId: string) {
  const h: CartQueueEntry | undefined = c.s.pending.queue?.[0];
  if (h && !h.l && !h.c.includes(optionId)) h.c.push(optionId);
  return cartContinue(c);
}

/**
 * An add-on tapped (ext:<id>), or No extras / Done (ext:none), or No extras for the rest (ext:rest: no more add-on lists
 * for this cart). Another add-on may follow while the line takes more.
 */
async function extraChosen(c: Ctx, optionId: string | null, rest = false) {
  const p = c.s.pending;
  const h: CartQueueEntry | undefined =
    p.kind === "cart_opts" && Array.isArray(p.queue) ? p.queue[0] : undefined;
  // No add-on question is open any more: the basket as it is.
  if (!h?.l) return push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
  if (optionId) {
    const r = await c.deps.rpc("basket_line_add_options", {
      p_customer_id: c.customerId,
      p_line_id: h.l,
      p_option_ids: [optionId],
    });
    if (r?.basket) c.basket = r.basket;
    const more: ChoiceGroup[] = Array.isArray(r?.extras) ? r.extras : [];
    if (r?.status === "added") c.summary.push("[added an add-on at the server's price]");
    if (r?.status === "added" && more.length) {
      const line = (c.basket?.lines ?? []).find((l: any) => l.line_id === h.l);
      return push(
        c,
        extrasList(
          c.m.from,
          c.s.lang,
          localName(c.s.lang, line?.name, line?.name_en),
          more,
          true,
          p.queue.length > 1,
        ),
      );
    }
  }
  if (rest) p.noExtras = true;
  p.queue.shift();
  return cartContinue(c);
}

async function cartContinue(c: Ctx) {
  // The add-ons list the agent opened for a line already in the basket ends at the basket: no checkout, and the order's
  // one "Goes well with" is kept for a cart.
  const fromAgent = c.s.pending.kind === "cart_opts" && c.s.pending.agent === true;
  if ((await cartQueueNext(c)) === "asked") return;
  if (fromAgent) return push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
  return cartReady(c);
}

/** The cart is in the basket: its one "Goes well with" (§29.3), then checkout. */
async function cartReady(c: Ctx) {
  if (!c.basket?.lines?.length) return say(c, "cartNothing");
  await goesWellWith(c);
  return checkout(c, {});
}

/**
 * "Goes well with" after a cart arrives (§39.15.2): the shop's items bought together with the basket's, the order's one
 * upsell, never on a reorder (basket_goes_well). A product carousel while config carousel_enabled is on, else a
 * single-product message; the upsell buttons stand in if Meta refuses it. Without a catalogue the summary's upsell
 * buttons stay as they are.
 */
async function goesWellWith(c: Ctx) {
  if (!(await catalogFor(c))) return;
  const g = await c.deps
    .rpc("basket_goes_well", { p_customer_id: c.customerId, p_catalog_id: c.catalog })
    .catch(() => null);
  const products: any[] = g?.status === "ok" && Array.isArray(g.products) ? g.products : [];
  if (!products.length) return;
  const lang = c.s.lang;
  const first = products[0];
  const one = productMessage(
    c.m.from,
    c.catalog!,
    String(first.retailer_id),
    tr(lang, "goesWell"),
    tr(lang, "catalogFooter"),
  );
  c.summary.push(`[goes well with: ${products.length} item(s)]`);
  if (g.carousel === true && products.length >= 2) {
    c.tools.push("catalog:carousel");
    return pushCatalog(
      c,
      productCarouselMessage(
        c.m.from,
        c.catalog!,
        tr(lang, "goesWellMany"),
        products.map((x) => String(x.retailer_id)),
      ),
      one,
    );
  }
  c.tools.push("catalog:goes_well");
  pushCatalog(
    c,
    one,
    upsellMessage(c.m.from, lang, {
      item_id: String(first.retailer_id),
      name: first.name,
      name_en: first.name_en,
      price_usd: first.price_usd,
    }),
  );
}

/**
 * "Popular near you" after the craving list (§39.15.2): each delivering shop's best seller. A product carousel while
 * config carousel_enabled is on (the product list stands in if Meta refuses it), else the product list itself.
 */
async function popularNearYou(c: Ctx, shops: { vendor_id: string }[]) {
  if (!shops.length || !(await catalogFor(c))) return;
  const r = await c.deps
    .rpc("popular_near_you", {
      p_vendor_ids: shops.slice(0, 40).map((s) => s.vendor_id),
      p_catalog_id: c.catalog,
      p_limit: 10,
    })
    .catch(() => null);
  const products: CatalogProduct[] = Array.isArray(r?.products) ? r.products : [];
  if (!products.length) return;
  const lang = c.s.lang;
  const listMsg = productListMessage(
    c.m.from,
    c.catalog!,
    tr(lang, "popularNear"),
    tr(lang, "popularBody"),
    products,
    { lang, footer: tr(lang, "catalogFooter") },
  );
  c.summary.push(`[popular near you: ${products.length} items]`);
  if (r.carousel === true && products.length >= 2) {
    c.tools.push("catalog:carousel");
    return pushCatalog(
      c,
      productCarouselMessage(
        c.m.from,
        c.catalog!,
        tr(lang, "popularBody"),
        products.map((x) => String(x.retailer_id)),
      ),
      listMsg,
    );
  }
  c.tools.push("browse:popular");
  pushCatalog(c, listMsg, null);
}

// #26: a note per basket line ---------------------------------------------------------------------------------------------
/** "Add a note" (note:add) or a line picked from the list (note:<line>): the next text is that line's note. */
async function noteTap(c: Ctx, lineId: string | null) {
  const lines: any[] = Array.isArray(c.basket?.lines) ? c.basket.lines : [];
  if (!lines.length) return push(c, ...basketMessage(c.m.from, c.s.lang, null));
  const line = lineId
    ? lines.find((l) => l.line_id === lineId)
    : lines.length === 1
      ? lines[0]
      : null;
  if (lineId && !line) return say(c, "noteGone");
  if (!line) return push(c, noteLinesList(c.m.from, c.s.lang, lines));
  c.s.pending = {
    kind: "note",
    line_id: line.line_id,
    at: nowIso(c),
  };
  c.summary.push("[asked for the item's note]");
  const max = Number(c.basket?.note_max);
  return push(
    c,
    notePrompt(
      c.m.from,
      c.s.lang,
      localName(c.s.lang, line.name, line.name_en),
      Number.isFinite(max) && max > 0 ? max : null,
    ),
  );
}

/**
 * Text the bot asked for: a note (kept by the server, at most its configured length) or an "Other" tip. A message that is
 * one of the fixed intents (menu, basket, track, STOP…) is not taken as the answer: it is handled as usual.
 */
async function awaitedText(c: Ctx, t: string): Promise<boolean> {
  const p = c.s.pending;
  const intent = deterministicIntent(t);
  if (intent && intent.kind !== "no") {
    c.s.pending = {};
    return false;
  }
  c.s.pending = {};
  // Only text soon after the question is its answer; hours later it is a new message (never "2 shawarma" as a note).
  const at = Date.parse(String(p.at ?? ""));
  if (!Number.isFinite(at) || (c.deps.now?.() ?? new Date()).getTime() - at > TEXT_WAIT_MS)
    return false;
  if (p.kind === "note") {
    if (intent?.kind === "no") {
      push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
      return true;
    }
    // Asked again: the wait starts from this question.
    if ((await noteSave(c, String(p.line_id), t)) === "too_long")
      c.s.pending = { ...p, at: nowIso(c) };
    return true;
  }
  if (p.kind === "tip_other") {
    if (intent?.kind === "no") {
      say(c, "done");
      return true;
    }
    const amount = readTipAmount(t);
    if (amount === null) {
      // "2 shawarma w pepsi" is an order, not the tip: only a bad amount ("0", "2.555", "$50") is asked again.
      if (!looksLikeAmount(t)) return false;
      c.s.pending = { ...p, at: nowIso(c) };
      say(c, "tipOtherBad", { max: moneyUsd(p.max) });
      return true;
    }
    await tipAfterSet(c, String(p.order_id), amount, true);
    return true;
  }
  return false;
}

/** How long a typed answer (a note, an "Other" tip) is waited for. */
const TEXT_WAIT_MS = 10 * 60 * 1000;
const nowIso = (c: Ctx) => (c.deps.now?.() ?? new Date()).toISOString();

/** Text that is only a number, with or without a currency ("0", "-5", "2.555", "$50"): an answer to "how much?". */
function looksLikeAmount(t: string): boolean {
  const s = t
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\$|usd|dollars?|دولار|dolar/gi, "")
    .replace(/\s+/g, "");
  return /^[-+]?[\d.,]+$/.test(s);
}

/** "5", "$2.50", "2,5", "٢" or "3 dollars": a dollar amount with at most two decimals, else null. */
export function readTipAmount(t: string): number | null {
  const s = t
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim();
  const m = s.match(
    /^(?:\$|usd)?\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:\$|usd|dollars?|dollar|دولار|dolar)?$/i,
  );
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// #35 change for cash, #38 tips -------------------------------------------------------------------------------------------
type CheckoutExtras = SummaryExtra & { status: string; tip_amounts?: (number | string)[] };

/**
 * After the cash currency (basket_checkout_extras): "Do you need change?" until it is answered, then the tip and the total
 * with it for the summary. null when the server has nothing to add.
 */
async function checkoutExtras(c: Ctx, q: Quote): Promise<CheckoutExtras | "asked" | null> {
  // The quote checkout just made: the server does not quote the basket a second time.
  const x = await c.deps
    .rpc("basket_checkout_extras", {
      p_customer_id: c.customerId,
      p_total_usd: q.total_usd ?? null,
      p_usd_lbp_rate: q.usd_lbp_rate ?? null,
    })
    .catch(() => null);
  if (x?.status !== "ok") return null;
  if (x.change?.status === "ask" && Array.isArray(x.change.options) && x.change.options.length) {
    c.summary.push("[asked whether the customer needs change]");
    push(c, changeAsk(c.m.from, c.s.lang, x.change.currency, x.change.total, x.change.options, x));
    return "asked";
  }
  return x;
}

/** The checkout's one optional tip row (default none), after the summary. */
function pushTipRow(c: Ctx, ex: CheckoutExtras) {
  const amounts = Array.isArray(ex.tip_amounts) ? ex.tip_amounts : [];
  if (!amounts.length) return;
  push(c, tipRow(c.m.from, c.s.lang, amounts, Number(ex.tip_usd ?? 0)));
}

/** "Exact" or a note amount (chg:): kept by the server when it is one of its options, then the summary. */
async function changeChosen(c: Ctx, currency: "USD" | "LBP", amount: number | null) {
  await c.deps.rpc("basket_set_cash_change", {
    p_customer_id: c.customerId,
    p_currency: currency,
    p_amount: amount,
  });
  c.tools.push("cash_change");
  // A stale answer (another currency since) or one no longer offered: checkout asks again with what fits now.
  return checkout(c, { skipRoute: true });
}

/** A tip at checkout (tpc:<cents>, 0 = none): kept by the server when it is one of its amounts, then the summary again. */
async function tipChosen(c: Ctx, cents: number) {
  const r = await c.deps.rpc("basket_set_tip", {
    p_customer_id: c.customerId,
    p_amount: cents / 100,
  });
  c.tools.push("tip");
  if (r?.status === "not_allowed") say(c, "tipNotAllowed");
  return checkout(c, { skipRoute: true });
}

/** After delivery: the thanks, with the tip buttons when the order may still take one (asked once per order). */
async function afterDelivered(c: Ctx, orderId: string, lead: "glad" | "thanksRating") {
  const o = await c.deps
    .rpc("order_tip_offer", { p_customer_id: c.customerId, p_order_id: orderId })
    .catch(() => null);
  const amounts = Array.isArray(o?.amounts) ? o.amounts : [];
  if (o?.status === "offer" && amounts.length) {
    c.tools.push("tip:offer");
    c.summary.push("[thanked the customer and offered a tip for whoever delivered]");
    return push(c, tipAfterCard(c.m.from, c.s.lang, orderId, amounts, lead));
  }
  return say(c, lead);
}

/** A tip button after delivery (tpo:<order>:<cents>), or Other: the amount is typed next, up to the server's max. */
async function tipAfterChosen(c: Ctx, orderId: string, cents: number | null, other = false) {
  if (cents !== null) return tipAfterSet(c, orderId, cents / 100, other);
  const o = await c.deps.rpc("order_tip_offer", {
    p_customer_id: c.customerId,
    p_order_id: orderId,
    p_mark: false,
  });
  if (o?.status === "tipped") return say(c, "tipThanks", { amount: moneyUsd(o.tip_usd) });
  if (o?.status !== "offer")
    return say(c, o?.status === "too_late" ? "tipTooLate" : "tipNotAllowed");
  c.s.pending = { kind: "tip_other", order_id: orderId, max: Number(o.max_usd), at: nowIso(c) };
  return say(c, "tipOtherAsk", { max: moneyUsd(o.max_usd) });
}

/**
 * Sets the tip after delivery: the server keeps it as promised and tells whoever delivered, who books it with their
 * "Got it" once they have the cash (never on the customer's word alone).
 */
async function tipAfterSet(c: Ctx, orderId: string, amount: number, other: boolean) {
  const r = await c.deps.rpc("order_tip_set", {
    p_customer_id: c.customerId,
    p_order_id: orderId,
    p_amount: amount,
    p_other: other,
  });
  c.tools.push("tip:after_delivery");
  switch (r?.status) {
    case "promised":
    case "tipped":
    case "already_tipped":
      // Promised: whoever delivered is told and confirms they got the cash; only then is it booked.
      c.summary.push(
        `[tip ${moneyUsd(r.tip_usd)} promised${r.told === false ? "" : "; whoever delivered was told"}]`,
      );
      // Never claim we told them when no channel reached whoever delivered.
      return say(c, r.told === false ? "tipThanksQuiet" : "tipThanks", {
        amount: moneyUsd(r.tip_usd),
      });
    case "too_late":
      return say(c, "tipTooLate");
    case "not_allowed":
      if (other)
        c.s.pending = {
          kind: "tip_other",
          order_id: orderId,
          max: Number(r.max_usd),
          at: nowIso(c),
        };
      return say(c, other ? "tipOtherBad" : "tipNotAllowed", { max: moneyUsd(r.max_usd) });
    default:
      return say(c, "tipNotAllowed");
  }
}

/** Saves a line's note through the server (its length and cleaning rule) and shows the basket with it. */
async function noteSave(c: Ctx, lineId: string, note: string): Promise<string> {
  const r = await c.deps.rpc("basket_line_note", {
    p_customer_id: c.customerId,
    p_line_id: lineId,
    p_note: note.slice(0, 500),
  });
  c.tools.push("note");
  if (r?.status === "too_long") {
    say(c, "noteTooLong", { n: r.length, max: r.max });
    return "too_long";
  }
  if (r?.status !== "saved") {
    say(c, "noteGone");
    return "gone";
  }
  if (r.basket) c.basket = r.basket;
  c.summary.push("[saved the item's note]");
  push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
  return "saved";
}

// ---- Session 5f part 7: the same flows asked in words (§39.14 rule 1), through the AI's typed tools ----------------------
/** The longest note the AI may pass (the server's item_note_max_chars decides; this only refuses a runaway input). */
// A runaway guard only (the column's ceiling): the server cuts an AI note to item_note_max_chars and keeps the item, and
// answers too_long for a note the customer typed, so the agent is never refused a whole item over a long note.
const NOTE_INPUT_MAX = 200;

/** Server-side check of the after-cart tools' input (the prompt is not a security boundary). */
export function validAfterCart(name: AfterCartToolName, input: any): boolean {
  const lineRef = (v: unknown) => typeof v === "string" && /^l\d{1,2}$/.test(v);
  const money = (v: unknown, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max;
  // Only the schema's own fields: anything else (a customer id, a price) is refused, never read.
  const fields: Record<AfterCartToolName, string[]> = {
    set_item_note: ["line_ref", "note"],
    add_item_extras: ["line_ref", "options"],
    set_cash_change: ["currency", "amount"],
    set_tip: ["amount_usd"],
    tip_order: ["amount_usd"],
  };
  if (!Object.keys(input).every((k) => fields[name]?.includes(k))) return false;
  switch (name) {
    case "set_item_note":
      return (
        lineRef(input.line_ref) &&
        typeof input.note === "string" &&
        input.note.length <= NOTE_INPUT_MAX
      );
    case "add_item_extras":
      return (
        lineRef(input.line_ref) &&
        Array.isArray(input.options) &&
        input.options.length >= 1 &&
        input.options.length <= 6 &&
        input.options.every((o: unknown) => typeof o === "string" && o.length > 0 && o.length <= 60)
      );
    case "set_cash_change":
      return (
        ["USD", "LBP"].includes(input.currency) &&
        (input.amount === null || (money(input.amount, 1e10) && Number.isInteger(input.amount)))
      );
    case "set_tip":
      return input.amount_usd === null || input.amount_usd === 0 || money(input.amount_usd, 1000);
    case "tip_order":
      return money(input.amount_usd, 1000);
    default:
      return false;
  }
}

/**
 * Runs an after-cart tool as the customer's own tap would: refs resolve only within this session, every RPC carries the
 * session's customer id (never one from the model), and the reply is the same card the tap gets.
 */
async function aiAfterCart(c: Ctx, name: AfterCartToolName, input: any) {
  switch (name) {
    case "set_item_note": {
      const line = c.s.refs[input.line_ref];
      if (!line?.id) return push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
      await noteSave(c, line.id, String(input.note ?? ""));
      return;
    }
    case "add_item_extras": {
      const ref = c.s.refs[input.line_ref];
      const line = (c.basket?.lines ?? []).find((l: any) => l.line_id === ref?.id);
      if (!ref?.id || !line) return push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
      const it = await c.deps
        .rpc("item_choice_groups", { p_item_id: line.item_id })
        .catch(() => null);
      const extras: ChoiceGroup[] = (Array.isArray(it?.groups) ? it.groups : []).filter(
        (g: ChoiceGroup) => Number(g.min ?? 0) === 0,
      );
      const ids = [
        ...new Set(
          (input.options as string[]).flatMap((said) =>
            extras.flatMap((g) =>
              g.options
                .filter((o) => [o.name, o.name_en].some((x) => x && fuzzyEq(String(x), said)))
                .map((o) => o.option_id),
            ),
          ),
        ),
      ];
      const label = localName(c.s.lang, line.name, line.name_en);
      if (ids.length) {
        const r = await c.deps.rpc("basket_line_add_options", {
          p_customer_id: c.customerId,
          p_line_id: ref.id,
          p_option_ids: ids,
        });
        if (r?.status === "added") {
          if (r.basket) c.basket = r.basket;
          c.summary.push(`[added ${ids.length} extra(s) at the server's price]`);
          return push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
        }
      }
      // Nothing matched (or too many for a group): the line's extras list, as the tap path shows it.
      if (!extras.some((g) => g.options.length))
        return push(c, ...basketMessage(c.m.from, c.s.lang, c.basket));
      c.s.pending = {
        kind: "cart_opts",
        queue: [{ i: line.item_id, q: 0, c: [], l: ref.id, x: 1 }],
        agent: true,
      };
      return push(c, extrasList(c.m.from, c.s.lang, label, extras));
    }
    case "set_cash_change":
      return changeChosen(
        c,
        input.currency,
        input.amount === null ? null : Math.round(Number(input.amount)),
      );
    case "set_tip":
      return tipChosen(c, Math.round(Number(input.amount_usd ?? 0) * 100));
    case "tip_order": {
      // The model proposes; the customer's tap decides (a misread "5 stars" never becomes a promised $5).
      const last = await c.deps
        .rpc("customer_last_delivered", { p_customer_id: c.customerId })
        .catch(() => null);
      if (!last?.order_id) return say(c, "tipNotAllowed");
      const orderId = String(last.order_id);
      const o = await c.deps
        .rpc("order_tip_offer", { p_customer_id: c.customerId, p_order_id: orderId, p_mark: false })
        .catch(() => null);
      if (o?.status === "tipped") return say(c, "tipThanks", { amount: moneyUsd(o.tip_usd) });
      if (o?.status !== "offer")
        return say(c, o?.status === "too_late" ? "tipTooLate" : "tipNotAllowed");
      const cents = Math.round(Number(input.amount_usd) * 100);
      if (!(cents > 0) || cents > Math.round(Number(o.max_usd) * 100))
        return say(c, "tipOtherBad", { max: moneyUsd(o.max_usd) });
      c.summary.push(`[asked the customer to confirm a ${moneyUsd(cents / 100)} tip]`);
      return push(c, tipConfirmCard(c.m.from, c.s.lang, orderId, cents));
    }
  }
}

// ---- Session 5f part 8a: first contact (CUSTOMER-EXPERIENCE §3.1 #1-7, §3.2 #11, §3.3 #21) ------------------------------------
/** The urgent words a burst never folds away: any line saying one of them is honoured at once. */
const BURST_URGENT = ["stop", "delete_data", "forget_history", "human"] as const;

/** STOP, "delete my data" or "forget my history" on one line of a burst (checked before anything else in the turn). */
function urgentLine(m: CustomerInbound): "stop" | "delete_data" | "forget_history" | null {
  for (const line of m.burst ?? []) {
    const k = deterministicIntent(line)?.kind;
    if (k === "stop" || k === "delete_data" || k === "forget_history") return k;
  }
  return null;
}

/**
 * What only first contact needs from a typed text: a shop link (#2), a burst of messages (#6), "?" or emoji (#1), the
 * website's pre-filled texts. False: none of these, the text goes on as usual.
 */
async function firstContactText(
  c: Ctx,
  t: string,
  firstContact: boolean,
  inner: boolean,
): Promise<boolean> {
  const slug = shopToken(t);
  if (slug) {
    await shopLink(c, slug, withoutShopToken(t), firstContact);
    return true;
  }
  if (!inner && c.m.burst && c.m.burst.length > 1) {
    await burstText(c, c.m.burst, firstContact);
    return true;
  }
  // "?", "👍" or emoji alone: the welcome at first contact or between orders; with an active order or a question waiting it
  // goes its usual way (the agent reads it in context).
  if (isEmptyish(t) && (firstContact || (!c.s.pending.kind && !c.orders.length))) {
    await greet(c, firstContact);
    return true;
  }
  const site = siteText(t);
  if (!site) return false;
  c.tools.push(`site_text:${site.kind}`);
  if (site.kind === "greeting") await greet(c, firstContact);
  else if (site.kind === "order") await startOrder(c);
  else if (site.kind === "shop") await searchVendors(c, site.name, null);
  else await textRoute(c, site.text, firstContact, true);
  return true;
}

/**
 * Typed messages sent in a row, answered once (#6; dispatch folded them, customer_burst). STOP, deletion and a person are
 * honoured if any line says so; greetings, "?" and repeats drop out; the rest is read as one text (the model, when on, reads
 * all of it in one block).
 */
async function burstText(c: Ctx, lines: string[], firstContact: boolean) {
  c.tools.push(`burst:${lines.length}`);
  c.summary.push(`[${lines.length} messages in a row, answered once]`);
  const intents = lines.map((l) => deterministicIntent(l));
  for (const k of BURST_URGENT) if (intents.some((i) => i?.kind === k)) return textIntent(c, k);
  const rest: string[] = [];
  lines.forEach((l, i) => {
    const x = l.trim();
    if (!x || isEmptyish(x) || intents[i]?.kind === "greeting") return;
    if (rest.length && rest[rest.length - 1].toLowerCase() === x.toLowerCase()) return;
    rest.push(x);
  });
  if (!rest.length) return greet(c, firstContact);
  return textRoute(c, rest.join("\n"), firstContact, true);
}

/** A photo (#5): its caption is read as typed text; without one, "Tell me the dish or the shop" and the Order button. */
async function photoTurn(c: Ctx, firstContact: boolean) {
  const cap = c.m.caption?.trim() ?? "";
  if (cap && !isEmptyish(cap)) {
    c.tools.push("photo:caption");
    c.s.lang = textLang(withoutShopToken(cap), c.s.lang, firstContact);
    return textRoute(c, cap, firstContact, true);
  }
  // Photo understanding needs AI credit (§39.15.9); until then the buttons, never silence.
  c.tools.push("photo");
  c.summary.push("[a photo: asked for the dish or the shop]");
  return push(c, photoCard(c.m.from, c.s.lang));
}

// -- Shop links (#2) --------------------------------------------------------------------------------------------------------------
/** "(shop:<slug>)" in a text from the website or a QR on the shop: that shop, right after the location step. */
async function shopLink(c: Ctx, slug: string, rest: string, firstContact: boolean) {
  c.tools.push("shop_link");
  const r = await c.deps
    .rpc("shop_for_link", { p_customer_id: c.customerId, p_slug: slug, p_vendor_id: null })
    .catch(() => null);
  if (r?.status === "orderable" || r?.status === "unclaimed")
    return arriveAtShop(c, r, sitePicks(rest));
  // An old or mistyped link: the rest of the text as typed ("Hi Alo King, I'd like to order from Eatout").
  c.summary.push(`[shop link ${slug}: no such shop]`);
  return rest && !isEmptyish(rest)
    ? textRoute(c, rest, firstContact, true)
    : greet(c, firstContact);
}

/** A shop by id: the reminder's "See the menu" (the server checks it is orderable and visible to this customer). */
async function shopById(c: Ctx, vendorId: string) {
  const r = await c.deps
    .rpc("shop_for_link", { p_customer_id: c.customerId, p_slug: null, p_vendor_id: vendorId })
    .catch(() => null);
  if (r?.status === "orderable") return arriveAtShop(c, r);
  return say(c, "pickPlaceFirst");
}

/**
 * The items a customer picked on the website's menu ("… from Eatout (shop:eatout): 2× Burger, 1× Fries"): the text after
 * the link's colon, or null. They are read as if typed once the shop is open (never dropped, §39.14 rule 1).
 */
export function sitePicks(rest: string): string | null {
  const i = rest.indexOf(":");
  const picks = i >= 0 ? rest.slice(i + 1).trim() : "";
  return picks && !isEmptyish(picks) ? picks.slice(0, 500) : null;
}

/** The website's picks after the shop opened: read as the customer's own typed order (the agent, else the search). */
async function readSitePicks(c: Ctx, picks: unknown) {
  if (typeof picks !== "string" || !picks.trim()) return;
  c.summary.push(`[the website's picks, read as typed: ${picks.slice(0, 120)}]`);
  await textRoute(c, picks, false, true);
}

async function arriveAtShop(c: Ctx, r: any, picks: string | null = null) {
  if (r.status === "unclaimed") return unclaimedArrival(c, r);
  const name = String(r.name_en ?? r.name_ar ?? "");
  const ref = refFor(
    c,
    "v",
    String(r.vendor_id),
    `${name}${r.open_now === false ? " (closed)" : ""}`,
  );
  c.s.focus_vendor_id = String(r.vendor_id);
  c.summary.push(`[opened ${ref} from a link]`);
  const pt = await c.deps.rpc("customer_search_point", { p_customer_id: c.customerId });
  if (!pt?.address_id) {
    // The pin comes first; the shop stays the focused one and opens right after it (afterAddress).
    c.s.pending = { kind: "await_pin", then: "shop", ...(picks ? { picks } : {}) };
    return push(c, shopLinkPin(c.m.from, c.s.lang, localName(c.s.lang, r.name_ar, r.name_en)));
  }
  await openShop(c, ref);
  return readSitePicks(c, picks);
}

/** A link to a shop that is not on Alo King yet (§39.3): the card with "Ask them to join", then the closest shops instead. */
async function unclaimedArrival(c: Ctx, shop: any) {
  const base = c.deps.config.joinFunctionUrl;
  const ask =
    base && shop.slug
      ? joinLink(base, shop.slug, c.s.lang === "en" || c.s.lang === "fr" ? c.s.lang : "ar", "bot")
      : null;
  push(c, notOnAloKingCard(c.m.from, c.s.lang, { ...shop, ask_url: ask }));
  c.summary.push(
    `[${shop.name_en ?? shop.name_ar} is not on Alo King yet (a link): offered the ask link]`,
  );
  const pt = await c.deps.rpc("customer_search_point", { p_customer_id: c.customerId });
  if (!pt?.address_id) return push(c, welcomeMenu(c.m.from, c.s.lang));
  let rows = (await deliveringPlaces(c, pt, null, shop.business_type ?? null)).rows;
  if (!rows.length) rows = (await deliveringPlaces(c, pt, null, null)).rows;
  rows = rows.slice(0, 3);
  if (!rows.length) return;
  resetRefs(c, "v");
  const alt = rows.map((x) => ({
    ...x,
    ref: refFor(c, "v", x.vendor_id, `${x.name_en ?? x.name_ar}${x.is_open ? "" : " (closed)"}`),
  }));
  return push(c, ...vendorChoices(c.m.from, c.s.lang, alt, null, "pickInstead"));
}

// -- Closed shops (#7, #21) ---------------------------------------------------------------------------------------------------------
/** A shop opened from a list, a link or a pin: its menu, or when it is closed, when it opens with Remind me (no orders for later). */
async function openShop(c: Ctx, ref: string) {
  const v = c.s.refs[ref];
  if (!v) return say(c, "pickPlaceFirst");
  const o = await c.deps.rpc("vendor_opening", { p_vendor_ids: [v.id] }).catch(() => null);
  const x = Array.isArray(o) ? o.find((y: any) => y?.vendor_id === v.id) : null;
  if (x?.open_now !== false) return showMenu(c, ref, null);
  c.s.focus_vendor_id = v.id;
  c.tools.push("shop_closed");
  c.summary.push(`[${ref} is closed now: offered a reminder]`);
  return push(
    c,
    shopClosedCard(
      c.m.from,
      c.s.lang,
      { vendorId: v.id, ref, name: shopName(v.label) },
      whenText(c.s.lang, x.opens as Opening),
    ),
  );
}

/** Rows of closed shops say when they open ("Closed · opens 12:00"), read in one call for the rows shown. */
async function labelOpenings(
  c: Ctx,
  rows: { vendor_id: string; is_open: boolean; opens?: string | null }[],
) {
  const closed = rows.filter((r) => !r.is_open).map((r) => r.vendor_id);
  if (!closed.length) return;
  const o = await c.deps.rpc("vendor_opening", { p_vendor_ids: closed }).catch(() => null);
  const by = new Map<string, any>((Array.isArray(o) ? o : []).map((x: any) => [x.vendor_id, x]));
  for (const r of rows) if (!r.is_open) r.opens = whenShort(c.s.lang, by.get(r.vendor_id)?.opens);
}

/** A greeting when every shop near the saved pin is closed (one call); false when any is open or there is no pin. */
async function closedNear(c: Ctx): Promise<boolean> {
  const r = await c.deps
    .rpc("shops_closed_near", { p_customer_id: c.customerId })
    .catch(() => null);
  if (r?.status !== "all_closed") return false;
  const f = r.first ?? null;
  c.tools.push("closed_near");
  c.summary.push("[every shop near the customer is closed: offered a reminder]");
  push(
    c,
    closedNearCard(
      c.m.from,
      c.s.lang,
      f ? { vendor_id: f.vendor_id, name: localName(c.s.lang, f.name_ar, f.name_en) } : null,
      whenText(c.s.lang, f?.opens as Opening),
    ),
  );
  return true;
}

/** Browsing found only closed shops: the one that opens first, with Remind me and See menus. */
async function closedFromShops(c: Ctx, shops: DeliveringShop[]) {
  // The shop that opens first among every shop near the pin (shops_closed_near, no cap); the shops listed here otherwise.
  const near = await c.deps
    .rpc("shops_closed_near", { p_customer_id: c.customerId })
    .catch(() => null);
  let first: any = near?.status === "all_closed" && near.first?.opens?.opens_at ? near.first : null;
  let shop: { vendor_id: string; name_ar?: string | null; name_en?: string | null } | null = first;
  if (!first) {
    const o = await c.deps
      .rpc("vendor_opening", { p_vendor_ids: shops.slice(0, 20).map((x) => x.vendor_id) })
      .catch(() => null);
    first = (Array.isArray(o) ? o : [])
      .filter((x: any) => x?.opens?.opens_at)
      .sort((a: any, b: any) => Date.parse(a.opens.opens_at) - Date.parse(b.opens.opens_at))[0];
    shop = first ? (shops.find((x) => x.vendor_id === first.vendor_id) ?? null) : null;
  }
  c.tools.push("closed_near");
  c.summary.push(`[all ${shops.length} shops that deliver here are closed: offered a reminder]`);
  return push(
    c,
    closedNearCard(
      c.m.from,
      c.s.lang,
      shop
        ? { vendor_id: shop.vendor_id, name: localName(c.s.lang, shop.name_ar, shop.name_en) }
        : null,
      whenText(c.s.lang, first?.opens as Opening),
    ),
  );
}

/** "Remind me when it opens": the server reads the opening and keeps one reminder (sent only inside the 24-hour window). */
async function remindMe(c: Ctx, vendorId: string | null) {
  c.tools.push("shop_reminder");
  const r = await c.deps.rpc("shop_reminder_set", {
    p_customer_id: c.customerId,
    p_vendor_id: vendorId,
  });
  const lang = c.s.lang;
  const vendor = localName(lang, r?.name_ar ?? null, r?.name_en ?? null);
  const when = whenText(lang, r?.opens as Opening) ?? "";
  switch (r?.status) {
    case "set":
      c.summary.push(
        `[reminder set for ${vendorId ? "the shop" : "the first shop near"} opening ${when}]`,
      );
      return say(c, vendorId ? "remindSet" : "remindSetAny", { vendor, when });
    case "open_now":
      if (vendorId && r.vendor_id)
        return arriveAtShop(c, { ...r, status: "orderable", open_now: true });
      return browseHome(c);
    case "beyond_window":
      return say(c, "remindTooFar", { vendor, when });
    case "no_point":
      c.s.pending = { kind: "await_pin", then: "browse" };
      return push(c, askPin(c.m.from, lang));
    case "none":
      // No shop near the customer at all: the shops that deliver here (or why none does), never "this shop".
      return browseHome(c);
    default:
      // No name when the shop is unknown or gone: "this shop", never a blank.
      return say(c, "remindNoTime", { vendor: vendor || tr(lang, "thisShop") });
  }
}

// -- Outside the delivery area (§3.2 #11) ----------------------------------------------------------------------------------------------
/** "We don't deliver to <place> yet": the waitlist, pickup when a shop is in range, another address. Testers get the demo addresses. */
function waitlistState(c: Ctx, addressId: string | null) {
  return c.deps
    .rpc("waitlist_state", {
      p_customer_id: c.customerId,
      p_place_id: null,
      p_address_id: addressId,
    })
    .catch(() => null);
}

async function outsideArea(c: Ctx, addressId: string | null = null, known: any = undefined) {
  const st = known === undefined ? await waitlistState(c, addressId) : known;
  if (st?.status === "demo_outside") return demoOutside(c, st);
  if (st?.status !== "outside") return say(c, "placePaused");
  c.s.refs.xw = { id: String(st.place_id), label: String(st.place_en ?? "").slice(0, 60) };
  c.tools.push("outside_area");
  c.summary.push(
    `[outside the delivery area (${st.place_en}): offered the waitlist${st.pickup ? " and pickup" : ""}]`,
  );
  return push(c, outsideAreaCard(c.m.from, c.s.lang, placeName(c.s.lang, st), st.pickup === true));
}

/** "Tell me when you do": a dated opt-in for that place, one notice when it switches on, never marketing. */
async function joinWaitlist(c: Ctx) {
  c.tools.push("waitlist_join");
  const r = await c.deps.rpc("waitlist_join", {
    p_customer_id: c.customerId,
    p_place_id: c.s.refs.xw?.id ?? null,
  });
  switch (r?.status) {
    case "joined":
    case "already":
      c.summary.push(`[on the waitlist for ${r.place_en}]`);
      return say(c, "waitlistJoined", { place: placeName(c.s.lang, r) });
    case "delivered":
    case "test_shop":
      return startOrder(c);
    case "demo_outside":
      return demoOutside(c, r);
    case "no_point":
      c.s.pending = { kind: "await_pin", then: "browse" };
      return push(c, askPin(c.m.from, c.s.lang));
    default:
      return fail(c);
  }
}

const placeName = (lang: CLang, p: any): string =>
  String(
    (lang === "ar" || lang === "arabizi"
      ? p?.place
      : lang === "fr"
        ? (p?.place_fr ?? p?.place_en)
        : p?.place_en) ??
      p?.place ??
      "",
  );

/** "Delete my data" also removes reminders and waitlist rows (best effort: the turn goes on). */
async function forgetWaits(c: Ctx) {
  await c.deps
    .rpc("customer_waits_forget", { p_customer_id: c.customerId })
    .catch((e: unknown) =>
      c.deps.log?.("customer_waits_forget failed", { error: String(e).slice(0, 120) }),
    );
}

// ---- Session 5f part 8b: CUSTOMER-EXPERIENCE §3.5 #28-29, §3.7 #41 and #45, §3.8 #49-50 ----------------------------------------
/**
 * #28 An item from a second shop: "Your basket is from Eatout. Start a new one from SEVEN?" with Start new / Keep Eatout
 * (one shop per order, §30.4). A typed yes or no answers it too, and the agent can start the new basket with add_items.
 */
async function otherShop(c: Ctx, itemId: string, qty: number, basketVendor: string) {
  const n = await c.deps
    .rpc("basket_switch_names", { p_customer_id: c.customerId, p_item_id: itemId })
    .catch(() => null);
  const lang = c.s.lang;
  const basket =
    (lang === "ar" ? n?.basket_vendor : (n?.basket_vendor_en ?? n?.basket_vendor)) ??
    basketVendor ??
    "";
  const shop = (lang === "ar" ? n?.item_vendor : (n?.item_vendor_en ?? n?.item_vendor)) ?? "";
  c.s.pending = {
    kind: "replace_basket",
    item_id: itemId,
    qty: Math.min(Math.max(qty, 1), 50),
    at: nowIso(c),
  };
  c.summary.push(
    `[the item is from ${shop || "another shop"}: asked to start a new basket or keep ${basket}]`,
  );
  push(c, otherShopCard(c.m.from, lang, String(basket), String(shop || basket), itemId, qty));
}

/**
 * #29 Under the shop's minimum order: "Add $2.50 more to order from Eatout" and up to three of its items that close the gap
 * (server-priced), one tap each. They become item refs, so the agent can add them by asking too.
 */
async function belowMinimum(c: Ctx, q: Quote) {
  const g = await c.deps
    .rpc("basket_gap_items", { p_customer_id: c.customerId, p_limit: 2 })
    .catch(() => null);
  // Two items: the card's third button is Empty basket (session 5f part 7).
  const items: GapItem[] =
    g?.status === "below_minimum" && Array.isArray(g.items) ? g.items.slice(0, 2) : [];
  if (!items.length) return push(c, belowMinimumMessage(c.m.from, c.s.lang, q));
  for (const it of items)
    refFor(c, "i", it.item_id, `${it.name_en ?? it.name_ar} $${Number(it.price_usd).toFixed(2)}`);
  c.tools.push("gap_items");
  c.summary.push(
    `[under the shop's minimum order: offered ${items.length} items that close the gap]`,
  );
  const vendor = localName(
    c.s.lang,
    g.vendor ?? q.basket?.vendor ?? null,
    g.vendor_en ?? q.basket?.vendor_en ?? null,
  );
  return push(
    c,
    gapItemsMessage(c.m.from, c.s.lang, vendor, g.missing_usd ?? q.missing_usd, items),
  );
}

/**
 * #41 The order a shop rejected or did not answer, rebuilt at a shop with the same dish (the server re-checks that the shop
 * is open, delivers there and has the dish). Lines without a match are named before the basket; then the usual checkout.
 */
async function rebuildAt(c: Ctx, orderId: string | null, vendorId: string) {
  c.tools.push("order_rebuild");
  const r = await c.deps.rpc("order_rebuild_at", {
    p_customer_id: c.customerId,
    p_order_id: orderId,
    p_vendor_id: vendorId,
  });
  const lang = c.s.lang;
  const vendor = String((lang === "ar" ? r?.vendor : (r?.vendor_en ?? r?.vendor)) ?? "");
  if (r?.status === "nothing") return say(c, "rebuildNothing", { vendor });
  if (r?.status !== "ok" || !Array.isArray(r.lines) || !r.lines.length)
    return say(c, "rebuildGone");
  const missing: any[] = Array.isArray(r.missing) ? r.missing : [];
  const lead = missing.length
    ? tr(lang, "rebuildMissing", {
        vendor,
        items: missing
          .slice(0, 10)
          .map(
            (x) =>
              `${Number(x.quantity) || 1}× ${(lang === "ar" ? (x.name_ar ?? x.name_en) : (x.name_en ?? x.name_ar)) ?? ""}`,
          )
          .join(", "),
      })
    : null;
  c.summary.push(
    `[order ${r.code} rebuilt at ${r.vendor_en ?? r.vendor}: ${r.lines.length} line(s), ${missing.length} not there]`,
  );
  c.s.focus_vendor_id = String(r.vendor_id ?? vendorId);
  return cartOrder(
    c,
    r.lines.map((l: any) => ({
      itemId: String(l.item_id),
      quantity: Number(l.quantity) || 1,
      shownUsd: null,
    })),
    // Never replaces a newer basket without asking (§39.15.2): a rejected order leaves none, and an old rb: tap that meets
    // one gets the Switch / Keep / Do both card.
    false,
    { split: false, lead },
  );
}

const ACTIVE_ORDER = new Set([
  "placed",
  "accepted",
  "preparing",
  "ready",
  "driver_assigned",
  "heading_to_pickup",
  "at_pickup",
  "picked_up",
  "near_drop",
  "arrived",
]);

/**
 * #45 During an active order, typed words go to the shop as a note on that order (the shop's number is never shared) and
 * the customer gets a short confirmation. Not when the text answers a pending question, and not when the agent is on: the
 * agent then decides (its message_shop tool), so it is never narrowed (§39.14 rule 1).
 */
async function orderNoteRelay(c: Ctx, t: string): Promise<boolean> {
  if (c.deps.config.freeText !== false && c.deps.model) return false;
  if (c.s.pending.kind && c.s.pending.kind !== "shop_note") return false;
  const active = c.orders.find((o) => ACTIVE_ORDER.has(String(o?.status)));
  if (!active) return false;
  // Asked first (never a dish search or a "thanks" sent to the shop unasked): Send, or Search the menu with the words.
  // The order the card names is the one the note goes with (the server re-checks it is the customer's and still active).
  c.s.pending = {
    kind: "shop_note",
    text: t.slice(0, 300),
    at: nowIso(c),
    order_id: active.id ?? null,
  };
  c.summary.push(`[asked whether to pass the text to the shop on order ${active.code}]`);
  const vendor = String(
    (c.s.lang === "ar" ? active.vendor : (active.vendor_en ?? active.vendor)) ?? "",
  );
  push(c, shopNoteConfirm(c.m.from, c.s.lang, vendor, String(active.code ?? ""), t));
  return true;
}

/** A question a card asked, answered by typing: only within TEXT_WAIT_MS of asking. */
function pendingFresh(c: Ctx): boolean {
  const at = Date.parse(String(c.s.pending.at ?? ""));
  return Number.isFinite(at) && (c.deps.now?.() ?? new Date()).getTime() - at <= TEXT_WAIT_MS;
}

/**
 * The answer to "Send this to the shop?": Send passes the note (order_note_send), the Search the menu button searches with
 * the same words, and a typed no only drops the question.
 */
async function shopNoteAnswer(c: Ctx, answer: "send" | "search" | "no") {
  const fresh = pendingFresh(c);
  const p = c.s.pending;
  c.s.pending = {};
  if (p.kind !== "shop_note" || typeof p.text !== "string" || !fresh)
    return push(c, mainMenu(c.m.from, c.s.lang));
  if (answer === "no") return say(c, "noteNotSent");
  if (answer === "search") return catalogText(c, p.text, null);
  if (!(await messageShop(c, p.text, typeof p.order_id === "string" ? p.order_id : null)))
    return say(c, "trackNone");
}

/**
 * The note itself (order_note_send: the order the card named, else the customer's latest active order, rate-limited per
 * order). False: nothing to pass.
 */
async function messageShop(c: Ctx, t: string, orderId: string | null = null): Promise<boolean> {
  const r = await c.deps.rpc("order_note_send", {
    p_customer_id: c.customerId,
    p_text: t,
    p_message_id: c.m.messageId,
    p_order_id: orderId,
  });
  c.tools.push("order_note");
  const vendor = String((c.s.lang === "ar" ? r?.vendor : (r?.vendor_en ?? r?.vendor)) ?? "");
  if (r?.status === "sent") {
    c.summary.push(`[passed the customer's message to the shop on order ${r.code}]`);
    say(c, "noteSent", { vendor, code: r.code });
    return true;
  }
  if (r?.status === "limit") {
    say(c, "noteLimit", { vendor, code: r.code, max: r.max });
    return true;
  }
  if (r?.status === "no_channel") {
    // No WhatsApp number for the shop: kept on the order and an operator passes it on (never "passed" when it was not).
    c.summary.push(
      `[kept the customer's message for the shop on order ${r.code}: no channel, ops told]`,
    );
    say(c, "noteKept", { vendor, code: r.code });
    return true;
  }
  return false;
}

/** #49 Which item and how many are known: the optional photo (or words) before the server decides. */
function askProblemPhoto(c: Ctx, kind: string, itemId: string | null, qty: number) {
  if (!c.s.refs.xd) return say(c, "disputeNone");
  c.s.pending = { kind: "problem_photo", problem: kind, item_id: itemId, qty };
  c.summary.push(`[asked for an optional photo of the ${kind} problem]`);
  return push(c, problemPhotoAsk(c.m.from, c.s.lang));
}

/** The photo, the words or Skip: the report goes to the server with whatever the customer gave. */
async function problemPhotoAnswer(c: Ctx, photo: string | null, note: string | null) {
  const p = c.s.pending;
  c.s.pending = {};
  if (p.kind !== "problem_photo" || typeof p.problem !== "string")
    return problemStart(c, null, null);
  return disputeOpen(
    c,
    p.problem,
    typeof p.item_id === "string" ? p.item_id : null,
    Number(p.qty) || 1,
    photo,
    note ? note.slice(0, 300) : null,
  );
}

/** A photo sent while a person has the conversation: kept on the report they are deciding, and shown in its thread. */
async function handoffPhoto(c: Ctx, mediaId: string) {
  const ref = `wa-media:${mediaId}`;
  const r = await c.deps
    .rpc("dispute_photo_add", { p_customer_id: c.customerId, p_photo_ref: ref })
    .catch(() => null);
  if (r?.status !== "attached") return;
  c.tools.push("dispute_photo");
  await c.deps
    .rpc("support_inbound", {
      p_customer_id: c.customerId,
      p_text: `📷 Photo for order ${r.code} (${ref})`,
    })
    .catch(() => false);
  say(c, "photoAttached", { code: r.code });
}
