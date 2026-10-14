// The dispatch function (DECISIONS §4, §23, §30.2, §30.3.5): the second phase after webhook intake.
// One invocation drains, within a time budget:
//   1. inbound WhatsApp events from the queue: merchant button taps and commands (deterministic, zero
//      model calls; unrecognised text gets a short help reply until the merchant AI arrives in session 5);
//      customer messages are left to the customer bot (session 4)
//   2. the outbox: order cards, backups, reminders and replies, through the order_channel router
//   3. ops alerts to the operators' Telegram group
// The database decides; this code only moves messages. Dependencies are injected so it is tested without
// network or database.

import {
  cancelledText,
  deliveredCard,
  driverJobCard,
  lowStockCard,
  needDriverCard,
  orderCard,
  parseMerchantAction,
  proposalCard,
  reactivateCard,
  readyCheckCard,
  rejectReasonList,
  shiftHandoverText,
  textMessage,
  type Handover,
  type Lang,
  type OrderCardData,
} from "../_shared/merchant-cards.ts";
import { clampInteractive } from "../_shared/meta-limits.ts";
import {
  afterSunset,
  customerStatusMessages,
  parseCustomerAction,
} from "../_shared/customer-cards.ts";
import { handleCustomerTurn, readCustomerInbound, type CustomerDeps } from "./customer/turn.ts";
import { handleOnboarding, readOnboardingInbound } from "./merchant/onboarding.ts";
import { parseOnboardingTap } from "../_shared/onboarding-cards.ts";
import { handleMerchantMenu } from "./merchant/menu.ts";
import { handleMerchantFlows } from "./merchant/flows.ts";
import { orderCardImageMessage, orderCardSvg } from "../_shared/order-card-image.ts";
import { parseFlowReply } from "../_shared/flows.ts";
import type { MenuModel } from "../_shared/menu-draft.ts";
import {
  nextBeirutTime,
  parseMerchantCommand,
  type MerchantCommand,
} from "../_shared/merchant-commands.ts";

export type SendResult = { ok: true; id?: string } | { ok: false; retry: boolean; error: string };

export type DispatchDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
  /** Sends one WhatsApp payload from the given phone number id (Kapso). */
  whatsapp: (phoneNumberId: string, payload: Record<string, unknown>) => Promise<SendResult>;
  /** Places the automated cellular call (§13); null when no voice provider is configured. */
  call: ((to: string, card: OrderCardData) => Promise<SendResult>) | null;
  /** Sends an ops alert to the operators' Telegram group; null when not configured. */
  telegram: ((text: string, url?: string) => Promise<SendResult>) | null;
  adminUrl?: string;
  now?: () => Date;
  budgetMs?: number;
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void;
  /** The smart-menu model (§18.3); null without a key or API credit (§32.7). */
  menuModel?: MenuModel | null;
  /** Downloads a merchant's menu photo or PDF from WhatsApp media (sender phone number id given). */
  fetchMenuMedia?:
    | ((
        phoneNumberId: string,
        m: { id: string; url: string | null },
      ) => Promise<{ bytes: Uint8Array; mime: string } | null>)
    | null;
  /** Reads a claim code to a landline by phone call (§18.1 B); null when no voice provider is configured. */
  voiceCode?: ((to: string, script: string) => Promise<SendResult>) | null;
  /** Copies a claim document from WhatsApp into private storage (§18.1); null keeps the media reference. */
  storeDocument?:
    | ((
        phoneNumberId: string,
        media: { id: string; url: string | null; mime: string },
        claimId: string,
      ) => Promise<string | null>)
    | null;
  /** Renders the gold order card SVG and uploads it as WhatsApp media (§32.5); returns the media id. */
  orderCard?: ((phoneNumberId: string, svg: string) => Promise<string | null>) | null;
  /** The customer bot's model, transcription, media and routing (session 4); null = customers are ignored. */
  customer?: Omit<CustomerDeps, "rpc" | "send" | "now" | "log"> | null;
};

type Outbox = {
  id: number;
  order_id: string | null;
  vendor_id: string | null;
  channel: string;
  purpose: string;
  target: string | null;
  payload: Record<string, any>;
  attempts: number;
  card: (OrderCardData & Record<string, unknown>) | null;
};

const MAX_ATTEMPTS = 3;
const ORDER_CARD_MS = 6000;
const E164 = /^\+[1-9][0-9]{6,14}$/;

export async function runDispatch(
  deps: DispatchDeps,
): Promise<{ inbound: number; outbox: number; alerts: number }> {
  const started = Date.now();
  const budget = deps.budgetMs ?? 8000;
  const left = () => budget - (Date.now() - started);
  const out = { inbound: 0, outbox: 0, alerts: 0 };
  const senders: Record<string, string | null> = {};
  const senderFor = async (audience: "merchant" | "customer") =>
    audience in senders
      ? senders[audience]
      : (senders[audience] = (await deps.rpc("whatsapp_sender", { p_audience: audience })) ?? null);
  const sender = () => senderFor("merchant");

  // 1. Inbound.
  while (left() > 2000) {
    const events: any[] =
      // Invisible for longer than an edge function can live (150 s), so a worker that dies is never overlapped by a
      // retry; a failed event comes back in seconds through webhook_finish instead (#139).
      (await deps.rpc("webhook_claim", { p_limit: 10, p_visibility_s: 160 })) ?? [];
    if (!events.length) break;
    for (const ev of events) {
      let status: "done" | "ignored" | "failed" = "done";
      let error: string | undefined;
      try {
        status = await handleInbound(deps, ev);
      } catch (e) {
        status = "failed";
        error = e instanceof Error ? e.message : String(e);
        deps.log?.("inbound failed", { event_id: ev.event_id, error: error.slice(0, 200) });
      }
      await deps.rpc("webhook_finish", {
        p_msg_id: ev.msg_id,
        p_event_id: ev.event_id,
        p_status: status,
        p_error: error ?? null,
        p_attempt: ev.attempts ?? null,
      });
      out.inbound++;
    }
  }

  // 2. Outbox.
  while (left() > 1500) {
    const batch: Outbox[] = (await deps.rpc("outbox_claim", { p_limit: 20, p_lock_s: 30 })) ?? [];
    if (!batch.length) break;
    for (const m of batch) {
      const r =
        m.purpose === "customer_message"
          ? await deliverCustomer(deps, m, () => senderFor("customer"))
          : await deliver(deps, m, sender);
      const status =
        r.status === "retry" ? (m.attempts >= MAX_ATTEMPTS ? "failed" : "queued") : r.status;
      await deps.rpc("outbox_finish", {
        p_id: m.id,
        p_status: status,
        p_provider_ref: r.ref ?? null,
        p_error: r.error ?? null,
        p_retry_in_s: 10 * m.attempts,
      });
      out.outbox++;
    }
  }

  // 3. Ops alerts (only claimed when Telegram is configured, so attempts are not burnt).
  if (deps.telegram && left() > 1000) {
    const alerts: any[] = (await deps.rpc("ops_alerts_claim", { p_limit: 20 })) ?? [];
    for (const a of alerts) {
      const icon = a.severity === "urgent" ? "🚨" : a.severity === "warning" ? "⚠️" : "ℹ️";
      const url = deps.adminUrl ? `${deps.adminUrl}/admin?alert=${a.id}` : undefined;
      const r = await deps.telegram(`${icon} ${a.summary}`, url);
      if (r.ok) await deps.rpc("ops_alert_sent", { p_id: a.id });
      out.alerts++;
    }
  }
  return out;
}

// ---- Outbound -----------------------------------------------------------------------------------------
type Delivery = { status: "sent" | "failed" | "skipped" | "retry"; ref?: string; error?: string };

async function deliver(
  deps: DispatchDeps,
  m: Outbox,
  sender: () => Promise<string | null>,
): Promise<Delivery> {
  switch (m.channel) {
    case "portal":
      return { status: "sent" }; // the portal queue reads the order itself and rings
    case "printer":
      return { status: "sent", ref: "cloudprnt:queued" }; // the CloudPRNT poll picks it up; printed = acknowledged
    case "email":
      return { status: "skipped", error: "no email provider (copy only)" };
    case "call": {
      if (!deps.call) return { status: "skipped", error: "voice provider not configured" };
      if (!m.target || !E164.test(m.target) || !m.card)
        return { status: "skipped", error: "no owner mobile" };
      return result(await deps.call(m.target, m.card));
    }
    case "whatsapp": {
      if (!m.target || !E164.test(m.target))
        return { status: "skipped", error: "no WhatsApp number for this merchant" };
      const from = await sender();
      if (!from) return { status: "skipped", error: "no merchant WhatsApp number connected (#67)" };
      const payloads = buildWhatsApp(m, "ar");
      if (!payloads.length) return { status: "skipped", error: `nothing to send for ${m.purpose}` };
      let ref: string | undefined;
      for (const p of payloads) {
        const r = await deps.whatsapp(from, clampInteractive(p));
        if (!r.ok) return { status: r.retry ? "retry" : "failed", error: r.error };
        ref ??= r.id;
      }
      return { status: "sent", ref };
    }
    default:
      return { status: "skipped", error: `channel ${m.channel} has no adapter yet` };
  }
}

/** Customer status messages (§27.9): from the customer number (the sandbox until cut-over). */
async function deliverCustomer(
  deps: DispatchDeps,
  m: Outbox,
  sender: () => Promise<string | null>,
): Promise<Delivery> {
  if (!m.target || !E164.test(m.target)) return { status: "skipped", error: "no customer number" };
  const from = await sender();
  if (!from) return { status: "skipped", error: "no customer WhatsApp number connected" };
  const p = m.payload ?? {};
  let deliveryCode: string | null = null;
  if (
    m.order_id &&
    ["accepted", "on_the_way", "near_drop"].includes(String(p.kind)) &&
    p.customer_id
  ) {
    // Read now, never stored in the outbox row: shown only to the customer it belongs to.
    const t = await deps.rpc("order_track", {
      p_customer_id: p.customer_id,
      p_order_id: m.order_id,
    });
    deliveryCode = t?.delivery_code ?? null;
  }
  const payloads = customerStatusMessages(m.target, p, m.card as any, {
    deliveryCode,
    afterSunset: afterSunset(deps.now?.() ?? new Date()),
  });
  if (!payloads.length)
    return { status: "skipped", error: `nothing to send for ${String(p.kind)}` };
  // The gold order card goes before the confirmation text (§32.5); without it the text alone is sent.
  if (p.kind === "accepted" && m.order_id && deps.orderCard && m.attempts <= 1) {
    const step = async () => {
      const card = await deps.rpc("order_card_image", { p_order_id: m.order_id });
      if (!card?.code) return null;
      const media = await deps.orderCard!(
        from,
        orderCardSvg(card, p.lang === "ar" || p.lang === "arabizi" ? "ar" : "en"),
      );
      return media ? orderCardImageMessage(m.target as string, media, card.code) : null;
    };
    // The text must never wait on the image: the card gets ORDER_CARD_MS, then it is skipped.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const msg = await Promise.race([
        step(),
        new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ORDER_CARD_MS))),
      ]);
      if (msg) await deps.whatsapp(from, msg);
    } catch (e) {
      deps.log?.("order card failed", { error: String(e).slice(0, 120) });
    } finally {
      clearTimeout(timer);
    }
  }
  let ref: string | undefined;
  for (const x of payloads) {
    const r = await deps.whatsapp(from, clampInteractive(x));
    if (!r.ok) return { status: r.retry ? "retry" : "failed", error: r.error };
    ref ??= r.id;
  }
  return { status: "sent", ref };
}

const result = (r: SendResult): Delivery =>
  r.ok ? { status: "sent", ref: r.id } : { status: r.retry ? "retry" : "failed", error: r.error };

export function buildWhatsApp(m: Outbox, lang: Lang): Record<string, unknown>[] {
  const to = m.target as string;
  const code = String(m.card?.code ?? m.payload.code ?? "");
  switch (m.purpose) {
    case "new_order":
    case "copy":
      return m.card ? [orderCard(to, m.card, lang)] : [];
    case "order_cancelled":
      return [cancelledText(to, code, lang)];
    case "ready_check":
      return m.order_id ? [readyCheckCard(to, m.order_id, code, lang)] : [];
    case "need_driver":
      return m.order_id ? [needDriverCard(to, m.order_id, code, lang)] : [];
    case "reactivate":
      return m.vendor_id
        ? [reactivateCard(to, m.vendor_id, Number(m.payload.missed ?? 3), lang)]
        : [];
    case "low_stock":
      return [
        lowStockCard(
          to,
          String(m.payload.item_id),
          String(m.payload.item_name ?? ""),
          Number(m.payload.remaining ?? 0),
          lang,
        ),
      ];
    case "proposal":
      return [proposalCard(to, String(m.payload.proposal_id), String(m.payload.summary), lang)];
    case "driver_job":
      return m.card && E164.test(String(m.payload.customer_phone ?? ""))
        ? driverJobCard(
            to,
            m.card,
            String(m.payload.customer_phone),
            String(m.payload.driver_name ?? ""),
            String(m.card.vendor_name ?? ""),
            lang,
          )
        : [];
    case "reply":
      return m.payload.interactive
        ? [
            {
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: to.replace(/^\+/, ""),
              type: "interactive",
              interactive: m.payload.interactive,
            },
          ]
        : [textMessage(to, String(m.payload.text ?? ""))];
    default:
      return [];
  }
}

// ---- Inbound ------------------------------------------------------------------------------------------
type Inbound = { from: string; messageId: string; buttonId: string | null; text: string | null };

/** The sender and content of a Kapso `whatsapp.message.received` event, or null for anything else. */
export function readInbound(payload: any): Inbound | null {
  const msg = payload?.message;
  const conv = payload?.conversation;
  if (!msg || typeof msg !== "object") return null;
  if (msg.kapso?.direction && msg.kapso.direction !== "inbound") return null;
  const raw = String(conv?.phone_number ?? msg.from ?? "");
  const from = raw.startsWith("+") ? raw : raw ? `+${raw}` : "";
  if (!E164.test(from)) return null;
  const i = msg.interactive;
  const buttonId =
    msg.type === "interactive"
      ? (i?.button_reply?.id ?? i?.list_reply?.id ?? null)
      : msg.type === "button"
        ? (msg.button?.payload ?? null)
        : null;
  const text = msg.type === "text" ? String(msg.text?.body ?? "") : null;
  return { from, messageId: String(msg.id ?? ""), buttonId, text };
}

async function handleInbound(deps: DispatchDeps, ev: any): Promise<"done" | "ignored"> {
  if (
    !/message\.received$/.test(String(ev.event_type)) &&
    !(ev.payload?.message && ev.payload?.message?.kapso?.direction === "inbound")
  ) {
    return "done"; // statuses and other events: nothing to do here (quality events are classified in the database)
  }
  const m = readInbound(ev.payload);
  const o = readOnboardingInbound(ev.payload);
  if (!m || !o) return "ignored";
  // When this number last wrote to us: a free-form notice is only deliverable inside WhatsApp's 24-hour
  // window, so claim notices to current owners check it (§18.1 I).
  await deps
    .rpc("whatsapp_seen", { p_phone_e164: m.from })
    .catch((e: unknown) => deps.log?.("whatsapp_seen failed", { error: String(e).slice(0, 120) }));
  const members: any[] =
    (await deps.rpc("merchant_members_by_phone", { p_phone_e164: m.from })) ?? [];
  // Staging only (§34): the owner's one phone plays both sides. `#merchant` and `#customer` choose which side
  // the bot treats the text as; a tap goes to whoever owns the card (a merchant card to the merchant, a
  // customer button to the customer bot). Null for every other number, so nothing changes for real people.
  const side: string | null = await deps
    .rpc("test_side_get", { p_phone_e164: m.from })
    .catch(() => null);
  if (side) {
    const sw = m.text === null ? null : /^\s*#(merchant|customer)\s*$/i.exec(m.text);
    if (sw) return switchTestSide(deps, m.from, sw[1].toLowerCase());
    const merchantTap = !!m.buttonId && parseMerchantAction(m.buttonId) !== null;
    const customerTap = !!m.buttonId && parseCustomerAction(m.buttonId) !== null;
    if (customerTap && !merchantTap) return customerInbound(deps, ev);
    if (side === "customer" && !merchantTap) return customerInbound(deps, ev);
  }
  // Claims and registration (§18.1): a non-member who asks to join or is mid-onboarding, and the answers
  // to our own claim cards (objection, lost-phone confirmation), which go to members.
  const ot = parseOnboardingTap(o.buttonId);
  if (!members.length || ot?.a === "object" || ot?.a === "recover") {
    const from = await deps.rpc("whatsapp_sender", { p_audience: "merchant" });
    if (
      from &&
      (await handleOnboarding(
        {
          rpc: deps.rpc,
          send: (p) => deps.whatsapp(from, p),
          voiceCode: deps.voiceCode ?? null,
          storeDocument: deps.storeDocument
            ? (media, claimId) => deps.storeDocument!(from, media, claimId)
            : undefined,
          log: deps.log,
        },
        o,
      ))
    )
      return "done";
  }
  if (!members.length) return customerInbound(deps, ev);
  // Shift handover (§32.5): a staff member's first message of a shift gets the open orders, items off and
  // open complaints before anything else.
  const touched = await deps
    .rpc("staff_shift_touch", { p_phone_e164: m.from })
    .catch((e: unknown) => deps.log?.("shift touch failed", { error: String(e).slice(0, 120) }));
  const handovers: Handover[] = Array.isArray(touched) ? touched : [];
  for (const h of handovers)
    await deps.rpc("app_reply", {
      p_to: m.from,
      p_payload: { text: shiftHandoverText(m.from, h).text.body },
      p_ref: `${m.messageId}:handover:${String((h as any).vendor_id ?? "")}`,
    });
  const reply = (body: string | Record<string, unknown>) =>
    deps.rpc("app_reply", {
      p_to: m.from,
      p_payload: typeof body === "string" ? { text: body } : body,
      p_ref: m.messageId,
    });

  // The smart menu (§18.3): "menu", menu photos or pasted text, and its section and nutrition taps.
  const menuSender = await deps.rpc("whatsapp_sender", { p_audience: "merchant" });
  // Merchant Flows (§12): "hours" / "profile" and the submissions of those Flows.
  if (
    menuSender &&
    (await handleMerchantFlows(
      { rpc: deps.rpc, send: (p) => deps.whatsapp(menuSender, p), log: deps.log },
      {
        from: m.from,
        text: m.text,
        buttonId: m.buttonId,
        flow: parseFlowReply(ev.payload?.message),
      },
      members,
    ))
  )
    return "done";
  if (
    menuSender &&
    (await handleMerchantMenu(
      {
        rpc: deps.rpc,
        send: (p) => deps.whatsapp(menuSender, p),
        menuModel: deps.menuModel ?? null,
        fetchMedia: deps.fetchMenuMedia ? (x) => deps.fetchMenuMedia!(menuSender, x) : null,
        log: deps.log,
      },
      { from: m.from, messageId: m.messageId, text: m.text, buttonId: m.buttonId, media: o.media },
      members,
    ))
  )
    return "done";
  if (m.buttonId) {
    await handleTap(deps, m, reply);
    return "done";
  }
  if (m.text !== null && /^\s*[0-9٠-٩]{4}\s*$/.test(m.text)) {
    // The customer's 4-digit delivery code (§27.6), typed by the merchant or its driver.
    const code = m.text.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
    const r = await deps.rpc("order_confirm_delivery_code", { p_phone_e164: m.from, p_code: code });
    await reply(
      r?.status === "delivered"
        ? `✅ تم التسليم #${r.code}`
        : r?.status === "wrong_code"
          ? "❌ الرمز غلط. تأكد من الزبون وجرّب مرة تانية."
          : r?.status === "locked"
            ? "🔒 غلط بالرمز ٥ مرات. فريق Alo King رح يتصل فيك ليأكد التسليم."
            : "ما في طلب ناطر رمز تسليم.",
    );
    return "done";
  }
  if (m.text !== null) {
    const cmd = parseMerchantCommand(m.text, deps.now?.() ?? new Date());
    if (!cmd) {
      await reply(HELP);
      return "done";
    }
    await handleCommand(deps, cmd, members[0], m, reply);
    return "done";
  }
  await reply(HELP);
  return "done";
}

/** `#merchant` / `#customer` from the owner's phone (staging only): switches the side and says so. */
async function switchTestSide(
  deps: DispatchDeps,
  phone: string,
  side: string,
): Promise<"done" | "ignored"> {
  const r = await deps.rpc("test_side_set", { p_phone_e164: phone, p_side: side });
  const from = await deps.rpc("whatsapp_sender", { p_audience: "merchant" });
  if (!from) return "ignored";
  const body =
    r?.status !== "ok"
      ? r?.status === "no_test_vendor"
        ? "The test merchant is not installed on this database yet."
        : "This switch is not available for this number."
      : side === "merchant"
        ? `🏪 You are now the merchant of ${r.vendor}. Orders placed on the customer side reach you here as cards: tap Accept, then Ready, Out for delivery and Delivered (type the 4-digit code when asked). Send #customer to be the customer again.`
        : "🛍️ You are the customer again. Send Order to start, or #merchant to switch back.";
  await deps.whatsapp(from, textMessage(phone, body));
  return "done";
}

/** Everyone who is not an active merchant member is a customer (the sandbox serves both until cut-over, §3). */
async function customerInbound(deps: DispatchDeps, ev: any): Promise<"done" | "ignored"> {
  if (!deps.customer) return "ignored";
  const m = readCustomerInbound(ev.payload);
  if (!m || !m.messageId) return "ignored";
  const from = (await deps.rpc("whatsapp_sender", { p_audience: "customer" })) ?? null;
  if (!from) return "ignored";
  await handleCustomerTurn(
    {
      ...deps.customer,
      rpc: deps.rpc,
      send: (p) => deps.whatsapp(from, p),
      now: deps.now,
      log: deps.log,
    },
    m,
    // The queue's attempt number: a retry of a turn that never finished is replayed, not dropped (#139).
    { attempt: Number(ev.attempts ?? 1) },
  );
  return "done";
}

export const HELP = [
  "ما فهمت عليك 🙏 جرّب:",
  "• «مسكّر نص ساعة» / «Mrakad 30 mins»",
  "• «فتحنا» / «open»",
  "• «خلصت الكنافة» / «knefe back»",
  "• «سعر الكنافة 3.5»",
  "• «رصيدي» / «balance»",
  "• «ما في كهربا» / «power back»",
  "• «capacity 8» · «same price»",
  "• «add Ali as kitchen +961…» / «remove Ali»",
].join("\n");

async function handleTap(
  deps: DispatchDeps,
  m: Inbound,
  reply: (b: string | Record<string, unknown>) => Promise<any>,
) {
  const action = parseMerchantAction(m.buttonId as string);
  if (!action) return reply(HELP);
  const memberFor = (ids: Record<string, string>) =>
    deps.rpc("merchant_member_for", { p_phone_e164: m.from, ...ids });
  const safe = async (fn: string, args: Record<string, unknown>) => {
    try {
      return await deps.rpc(fn, args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/stale_status/.test(msg)) return { status: "too_late" };
      if (/delivery_code_required/.test(msg)) return { status: "needs_code" };
      if (/not allowed|not assigned/.test(msg)) return { status: "not_allowed" };
      throw e;
    }
  };
  /** After a step succeeds, the card for the following one: ready -> out for delivery -> delivered. */
  const nextStep = async (orderId: string, done: string) => {
    const b = await deps.rpc("order_brief", { p_order_id: orderId }).catch(() => null);
    // Only the staging test merchant gets the chained cards; real merchants keep the timer cards (§34 scope).
    if (!b?.code || !b.is_test) return;
    const card =
      done === "accepted"
        ? readyCheckCard(m.from, orderId, b.code, "ar")
        : done === "ready"
          ? b.fulfilment === "pickup"
            ? deliveredCard(m.from, orderId, b.code, "ar")
            : needDriverCard(m.from, orderId, b.code, "ar")
          : done === "picked_up"
            ? deliveredCard(m.from, orderId, b.code, "ar")
            : null;
    if (card) await reply({ type: "interactive", interactive: (card as any).interactive });
  };
  switch (action.a) {
    case "accept": {
      const member = await memberFor({ p_order_id: action.orderId });
      const r = await safe("order_accept", {
        p_order_id: action.orderId,
        p_prep_minutes: action.prep,
        p_member_id: member,
        p_channel: "whatsapp",
      });
      await reply(
        r.status === "accepted"
          ? `✅ تم القبول، جاهز خلال ${action.prep} د`
          : r.status === "already_accepted"
            ? "✅ مقبول من قبل"
            : "⚠️ ما عاد فيك تقبل هالطلب (انلغى أو انرفض)",
      );
      // The next step is one tap away, so the order never waits on a timer (§34 step 10).
      if (r.status === "accepted") await nextStep(action.orderId, "accepted");
      return;
    }
    case "reject_ask": {
      const member = await memberFor({ p_order_id: action.orderId });
      await safe("order_acknowledge", {
        p_order_id: action.orderId,
        p_channel: "whatsapp",
        p_member_id: member,
        p_provider_ref: m.messageId,
      });
      return reply({
        type: "interactive",
        interactive: rejectReasonList(m.from, action.orderId, "", "ar").interactive,
      });
    }
    case "reject": {
      const member = await memberFor({ p_order_id: action.orderId });
      const r = await safe("order_reject", {
        p_order_id: action.orderId,
        p_reason: action.reason,
        p_note: action.reason === "other" ? "WhatsApp: other" : null,
        p_member_id: member,
        p_channel: "whatsapp",
      });
      return reply(
        r.status === "rejected" || r.status === "already_rejected"
          ? "❌ تم رفض الطلب"
          : "⚠️ ما عاد فيك ترفض هالطلب",
      );
    }
    case "ready":
    case "out":
    case "picked_up":
    case "delivered": {
      const to =
        action.a === "ready" ? "ready" : action.a === "delivered" ? "delivered" : "picked_up";
      const member = await memberFor({ p_order_id: action.orderId });
      const r = await safe("order_progress", {
        p_order_id: action.orderId,
        p_to: to,
        p_member_id: member,
        p_channel: "whatsapp",
      });
      await reply(
        r.status === "needs_code"
          ? "🔐 هالطلب بدو رمز التسليم. اطلب من الزبون الرمز (٤ أرقام) وابعتو هون."
          : r.status === "not_allowed" || r.status === "too_late"
            ? "⚠️ ما فيك تغيّر حالة هالطلب"
            : "👍",
      );
      if (r.status === to || r.status === "unchanged") await nextStep(action.orderId, to);
      return;
    }
    case "ready_in": {
      const member = await memberFor({ p_order_id: action.orderId });
      await safe("order_set_ready_eta", {
        p_order_id: action.orderId,
        p_minutes: action.minutes,
        p_member_id: member,
      });
      return reply(`⏱ تمام، جاهز خلال ${action.minutes} د`);
    }
    case "need_driver": {
      const member = await memberFor({ p_order_id: action.orderId });
      await safe("order_request_driver", { p_order_id: action.orderId, p_member_id: member });
      return reply("🙋 بلّغنا الفريق، رح نرجعلك");
    }
    case "stock_add":
    case "sold_out": {
      // The tap on our own card is the merchant's confirmation.
      const member = await memberFor({ p_item_id: action.itemId });
      const vendor = await deps.rpc("menu_item_vendor", { p_item_id: action.itemId });
      const kind = action.a === "stock_add" ? "stock_add" : "sold_out";
      const id = await deps.rpc("merchant_proposal_create", {
        p_vendor_id: vendor,
        p_kind: kind,
        p_payload:
          action.a === "stock_add"
            ? { item_id: action.itemId, add: action.add }
            : { item_id: action.itemId },
        p_source: "button",
        p_member_id: member,
      });
      await deps.rpc("merchant_proposal_decide", {
        p_proposal_id: id,
        p_confirm: true,
        p_member_id: member,
      });
      return reply(action.a === "stock_add" ? `➕ زدنا ${action.add}` : "🚫 صار خالص");
    }
    case "reactivate": {
      const member = await memberFor({ p_vendor_id: action.vendorId });
      const r = await safe("vendor_reactivate", {
        p_vendor_id: action.vendorId,
        p_member_id: member,
      });
      return reply(
        r.status === "active"
          ? "🟢 رجعت تستقبل طلبات"
          : "⚠️ بس المالك أو المدير أو الكاشير بيقدروا يرجعوا الطلبات",
      );
    }
    case "proposal": {
      const member = await memberFor({ p_proposal_id: action.proposalId });
      // A tap from a phone that is no longer a member of that branch is never applied as the system.
      if (!member) return reply("⚠️ ما فيك تأكد هالتغيير");
      const r = await safe("merchant_proposal_decide", {
        p_proposal_id: action.proposalId,
        p_confirm: action.confirm,
        p_member_id: member,
      });
      if (r.status === "confirmed" && r.kind === "power_off")
        return reply(
          Number(r.hidden) > 0
            ? `🔌 خبّينا ${r.hidden} صنف لحد ما ترجع الكهربا. ابعت «رجعت الكهربا» لترجّعهن. / ${r.hidden} items hidden; send “power back” to restore them.`
            : "🔌 ما في أصناف معلّمة إنها بدها كهربا. علّمها: «<الصنف> بدو كهربا». / No items are tagged as needing power; send “<item> needs power”.",
        );
      if (r.status === "confirmed" && r.kind === "power_on")
        return reply(
          `💡 رجّعنا ${Number(r.restored ?? 0)} صنف. / ${Number(r.restored ?? 0)} items are back.`,
        );
      return reply(
        r.status === "confirmed"
          ? "✅ تم"
          : r.status === "rejected"
            ? "تمام، ما غيّرنا شي"
            : r.status === "expired"
              ? "⌛ انتهت صلاحية الطلب، ابعت من جديد"
              : "⚠️ ما فيك تأكد هالتغيير",
      );
    }
  }
}

async function handleCommand(
  deps: DispatchDeps,
  cmd: MerchantCommand,
  member: any,
  m: Inbound,
  reply: (b: string | Record<string, unknown>) => Promise<any>,
) {
  const now = deps.now?.() ?? new Date();
  const propose = async (kind: string, payload: Record<string, unknown>, summary: string) => {
    let id: string;
    try {
      id = await deps.rpc("merchant_proposal_create", {
        p_vendor_id: member.vendor_id,
        p_kind: kind,
        p_payload: payload,
        p_source: "rules",
        p_member_id: member.member_id,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not allowed/.test(msg))
        return reply(
          kind.startsWith("staff")
            ? "👤 الموظفين بيزيدهن ويشيلهن صاحب المحل بس. / Only the owner adds or removes staff."
            : "⚠️ هيدا التغيير لصاحب المحل أو المدير. / This change is for the owner or a manager.",
        );
      if (/owner of this branch|unknown staff|an owner is not removed/.test(msg))
        return reply(
          "⚠️ ما فينا نغيّر صاحب المحل من هون. / The owner can't be changed by message.",
        );
      throw e;
    }
    return reply({
      type: "interactive",
      interactive: proposalCard(m.from, id, summary, "ar").interactive,
    });
  };
  const item = async (q: string) => {
    const rows: any[] =
      (await deps.rpc("menu_item_match", {
        p_vendor_id: member.vendor_id,
        p_query: q,
        p_limit: 3,
      })) ?? [];
    const best = rows[0];
    // A clear winner only; otherwise ask instead of guessing.
    return best && best.score >= 0.3 && (!rows[1] || best.score - rows[1].score >= 0.1)
      ? best
      : null;
  };
  switch (cmd.kind) {
    case "pause": {
      const until = new Date(now.getTime() + cmd.minutes * 60_000);
      return propose(
        "pause",
        { until: until.toISOString() },
        `⏸ توقيف الطلبات ${cmd.minutes} دقيقة؟`,
      );
    }
    case "pause_until": {
      const until = nextBeirutTime(cmd.hour, cmd.minute, now);
      const hh = `${String(cmd.hour).padStart(2, "0")}:${String(cmd.minute).padStart(2, "0")}`;
      return propose("pause", { until: until.toISOString() }, `⏸ توقيف الطلبات لحد ${hh}؟`);
    }
    case "open":
      return propose("resume", {}, "🟢 رجوع استقبال الطلبات هلق؟");
    case "sold_out":
    case "back_in_stock":
    case "price": {
      const it = await item(cmd.item);
      if (!it) return reply(`ما لقيت «${cmd.item}» بالمنيو. اكتب الاسم متل ما هو بالمنيو.`);
      if (cmd.kind === "price")
        return propose(
          "price",
          { item_id: it.item_id, price_usd: cmd.priceUsd },
          `💲 سعر «${it.name}» يصير $${cmd.priceUsd.toFixed(2)}؟`,
        );
      return propose(
        cmd.kind,
        { item_id: it.item_id },
        cmd.kind === "sold_out" ? `🚫 «${it.name}» خلص؟` : `✅ «${it.name}» رجع متوفر؟`,
      );
    }
    case "balance": {
      try {
        const b = await deps.rpc("merchant_balance", {
          p_vendor_id: member.vendor_id,
          p_member_id: member.member_id,
        });
        return reply(`💳 رصيد Alo King Credit: $${Number(b.credit_usd).toFixed(2)}`);
      } catch {
        return reply("💳 الرصيد بيشوفه المالك أو المدير بس");
      }
    }
    case "top_up":
      return reply("💳 شحن الرصيد بـ Whish رح يكون متوفر قريباً. رح نبعتلك رابط الدفع هون.");
    // Merchant WhatsApp extras (§32.5): each is a proposal the merchant confirms with a tap.
    case "power_off":
      return propose(
        "power_off",
        {},
        "🔌 ما في كهربا: نخبّي الأصناف اللي بدها كهربا لحد ما ترجع؟ / No power: hide the items that need power until it's back?",
      );
    case "power_on":
      return propose(
        "power_on",
        {},
        "💡 رجعت الكهربا: نرجّع الأصناف؟ / Power back: show those items again?",
      );
    case "needs_power": {
      const it = await item(cmd.item);
      if (!it) return reply(`ما لقيت «${cmd.item}» بالمنيو. اكتب الاسم متل ما هو بالمنيو.`);
      return propose(
        "needs_power",
        { item_id: it.item_id, on: cmd.on },
        cmd.on
          ? `🔌 «${it.name}» بدو كهربا (بيتخبّى وقت تنقطع)؟ / “${it.name}” needs power (hidden in a power cut)?`
          : `«${it.name}» بيمشي بلا كهربا؟ / “${it.name}” works without power?`,
      );
    }
    case "capacity":
      return propose(
        "capacity",
        { max: cmd.max },
        cmd.max
          ? `👨‍🍳 المطبخ بياخد ${cmd.max} طلبات سوا؟ فوقها منطوّل الوقت، وعلى ${cmd.max * 2} منوقّف الطلبات الجديدة لحد ما يخفّ. / Kitchen handles ${cmd.max} orders at once? Above that ETAs grow; at ${cmd.max * 2} new orders pause until it eases.`
          : "👨‍🍳 نلغي حد الطلبات؟ / Remove the kitchen limit?",
      );
    case "staff_add":
      return propose(
        "staff_add",
        { name: cmd.name, role: cmd.role, phone: cmd.phone },
        `👤 نزيد «${cmd.name}» (${STAFF_ROLE_AR[cmd.role]} · ${cmd.role}) على ${cmd.phone}؟ / Add ${cmd.name} as ${cmd.role}?`,
      );
    case "staff_remove": {
      const rows: any[] =
        (await deps.rpc("vendor_staff_find", {
          p_vendor_id: member.vendor_id,
          p_name: cmd.name,
        })) ?? [];
      const best = rows[0];
      if (!best || best.score < 0.3 || (rows[1] && best.score - rows[1].score < 0.1))
        return reply(`ما لقيت موظف اسمو «${cmd.name}». / No staff member called “${cmd.name}”.`);
      return propose(
        "staff_remove",
        { member_id: best.member_id },
        `👤 نشيل «${best.display_name}» (${best.role})؟ ما عاد توصلو الطلبات. / Remove ${best.display_name}? They stop getting orders.`,
      );
    }
    case "same_price":
      return propose(
        "same_price",
        { on: cmd.on },
        cmd.on
          ? "🏷️ أسعارك على Alo King نفس أسعار المحل؟ منحط «نفس سعر المحل» للزبون. / Your Alo King prices match the shop? Customers see “Same price as in the shop”."
          : "🏷️ نشيل «نفس سعر المحل»؟ / Remove the “Same price as in the shop” badge?",
      );
    case "substitute": {
      const it = await item(cmd.substitute);
      if (!it)
        return reply(
          `ما لقيت «${cmd.substitute}» بالمنيو. / “${cmd.substitute}” isn't on your menu.`,
        );
      let r: any;
      try {
        r = await deps.rpc("order_substitution_offer", {
          p_vendor_id: member.vendor_id,
          p_code: cmd.code,
          p_missing: cmd.missing,
          p_substitute_item_id: it.item_id,
          p_member_id: member.member_id,
        });
      } catch (e) {
        if (/not allowed/.test(e instanceof Error ? e.message : String(e)))
          return reply(
            "⚠️ ما فيك تعرض بديل على هالطلب. / You can't offer a substitute on this order.",
          );
        throw e;
      }
      return reply(substitutionReply(cmd, r));
    }
  }
}

const STAFF_ROLE_AR: Record<string, string> = {
  manager: "مدير",
  cashier: "كاشير",
  kitchen: "مطبخ",
  driver: "سائق",
};

/** The merchant's answer after offering a substitute; the customer decides with a tap. */
export function substitutionReply(cmd: { code: string; missing: string }, r: any): string {
  const pref =
    r?.pref === "call"
      ? "\n📞 الزبون طالب تتصل فيه قبل أي بديل. / The customer asked to be called first."
      : r?.pref === "remove"
        ? "\n🚫 الزبون طالب تشيل الناقص بلا بديل. / The customer asked to remove missing items."
        : r?.pref === "replace" && r?.max_usd != null
          ? `\n✅ الزبون قابل ببديل لحد $${Number(r.max_usd).toFixed(2)} زيادة. / The customer accepts substitutes up to $${Number(r.max_usd).toFixed(2)} more.`
          : "";
  switch (r?.status) {
    case "offered": {
      const d = Number(r.diff_usd);
      const diff =
        d === 0 ? "نفس السعر / same price" : `${d > 0 ? "+" : "-"}$${Math.abs(d).toFixed(2)}`;
      return `↔️ #${r.code}: «${r.line}» ← «${r.substitute}» (${diff}). سألنا الزبون. / We asked the customer.${pref}`;
    }
    case "unknown_order":
      return `ما لقيت طلب #${cmd.code}. / No order #${cmd.code}.`;
    case "unknown_line":
      return `ما لقيت «${cmd.missing}» بالطلب #${r.code}. / “${cmd.missing}” isn't in order #${r.code}.`;
    case "too_late":
      return `⚠️ الطلب #${r.code} طلع، ما فينا نبدّل. / Order #${r.code} has left the kitchen.`;
    case "not_cod":
      return `⚠️ الطلب #${r.code} مدفوع أونلاين: اتصل بالزبون، أو رشيد بيساعدك. / #${r.code} was paid online: call the customer.`;
    case "cod_cap":
      return `⚠️ البديل بيطلّع الطلب #${r.code} فوق حد الكاش. / The substitute takes #${r.code} over the cash limit.`;
    case "substitute_unavailable":
      return "⚠️ البديل مش متوفر. / The substitute isn't available.";
    case "same_item":
      return "هيدا نفس الصنف. / That's the same item.";
    case "deposit_item":
      return "⚠️ أصناف الكفالة (غالونات، غاز) ما منبدّلها بالرسالة: اتصل بالزبون. / Items with a container deposit aren't substituted by message: call the customer.";
    default:
      return "⚠️ ما قدرنا نعرض البديل. / Couldn't offer the substitute.";
  }
}
