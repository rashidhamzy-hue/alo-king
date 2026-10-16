// The dispatch function (DECISIONS §4, §23, §30.2, §30.3.5): the second phase after webhook intake.
// One invocation drains, within a time budget:
//   1. inbound WhatsApp events from the queue: merchant button taps and commands (deterministic, zero
//      model calls; unrecognised text gets a short help reply until the merchant AI arrives in session 5);
//      customer messages are left to the customer bot (session 4)
//   2. the outbox: order cards, backups, reminders and replies, through the order_channel router
//   3. ops alerts and support threads to the operators' Slack (slack_claim / slack_finish, §32.1)
// The database decides; this code only moves messages. Dependencies are injected so it is tested without
// network or database.

import { catalogStatusStep, catalogSyncStep, type CatalogApi } from "./catalog-sync.ts";
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
  tipCard,
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
import type { ItemPhotoStore } from "./merchant/photo.ts";
import { lookupProduct, normalizeGtin, productCardText } from "../_shared/open-food-facts.ts";
import { handleMerchantFlows } from "./merchant/flows.ts";
import { orderCardImageMessage, orderCardSvg } from "../_shared/order-card-image.ts";
import { parseFlowReply } from "../_shared/flows.ts";
import type { MenuModel } from "../_shared/menu-draft.ts";
import {
  beirutClock,
  nextBeirutTime,
  parseMerchantCommand,
  type MerchantCommand,
} from "../_shared/merchant-commands.ts";
import { runCopilot, writesIn } from "./merchant/copilot.ts";
import { copilotModelCommand, type CopilotModel } from "./merchant/copilot-model.ts";
import { templateKey, templatePayload, type TemplateChoice } from "./templates.ts";
import { templateByName, templateLang, templateMessage } from "../_shared/whatsapp-templates.ts";
import { isSimNumber } from "../_shared/sim-sink.ts";
import type { SlackPost } from "../_shared/ops-notifier.ts";
import { adminTap, handleAdmin, parseAdminCommand } from "./admin.ts";
import { parseTesterRemove } from "../_shared/demo-testers.ts";

export type SendResult = { ok: true; id?: string } | { ok: false; retry: boolean; error: string };

export type DispatchDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
  /** Sends one WhatsApp payload from the given phone number id (Kapso). */
  whatsapp: (phoneNumberId: string, payload: Record<string, unknown>) => Promise<SendResult>;
  /** Places the automated cellular call (§13); null when no voice provider is configured. */
  call: ((to: string, card: OrderCardData) => Promise<SendResult>) | null;
  /** Posts one queued Slack message (the ops_notifier adapter, §32.1); null until SLACK_BOT_TOKEN is set. */
  slack?: SlackPost | null;
  now?: () => Date;
  budgetMs?: number;
  /** When this worker is certainly gone (its start + 152 s): a customer turn's lease never outlives it. */
  workerDeadline?: Date;
  /** Waits inside a run (tests inject an instant one). */
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void;
  /**
   * The smart-menu model (§18.3); null without a key or API credit (§32.7). Every call is reserved against the daily AI
   * budget first (ai_quota_take, purpose "menu") and booked after with its real usage (5c leftover, §32.6).
   */
  menuModelCall?: MenuModelCall | null;
  /** Kapso's broadcast API (§39.8); null leaves approved broadcasts waiting. */
  kapsoBroadcast?: KapsoBroadcast | null;
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
  /** The fetch used for Open Food Facts (§39.5); tests inject one. */
  offFetch?: typeof fetch | null;
  /** The merchant copilot's model (§39.7); null while ai_merchant_text_enabled is off or there is no credit. */
  merchantCopilot?: CopilotModel | null;
  /** Fetches a menu link a merchant sends during an import (https only, size and time capped). */
  fetchLink?: ((url: string) => Promise<{ bytes: Uint8Array; mime: string } | null>) | null;
  /** The customer bot's model, transcription, media and routing (session 4); null = customers are ignored. */
  customer?: Omit<CustomerDeps, "rpc" | "send" | "now" | "log"> | null;
  /** The Meta catalogue (§39.12): items batch, product sets, product images; null leaves the sync queue waiting. */
  catalog?: CatalogApi | null;
  /** Stores a merchant's own item photo once the catalogue validator passed it (§39.15.4); null: not wired. */
  itemPhotos?: ItemPhotoStore | null;
};

export type MenuModelCall = (
  req: Parameters<MenuModel>[0] & { model: string },
) => Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } | null }>;

/** Kapso's broadcast API: create a draft for one approved template, add recipients (≤ 1000 a call), send. */
export type KapsoBroadcast = {
  create: (name: string, phoneNumberId: string, templateId: string) => Promise<string>;
  addRecipients: (
    id: string,
    recipients: { phone_number: string; components: Record<string, unknown>[] }[],
  ) => Promise<void>;
  send: (id: string) => Promise<void>;
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
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
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

  // 2. Outbox (also drained before the inbound step waits for a held message, so an order card is never held back).
  // `once` takes one small batch even when the budget is spent: a turn that ends past the budget (a confirm handled at the
  // end of a long run) must not leave its order card for the next 30-second tick (smoke run 3, session 5e).
  const drainOutbox = async (once = false) => {
    while (once || left() > 1500) {
      const limit = once && left() <= 1500 ? 5 : 20;
      once = false;
      const batch: Outbox[] =
        (await deps.rpc("outbox_claim", { p_limit: limit, p_lock_s: 30 })) ?? [];
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
  };

  // 1. Inbound.
  while (left() > 2000) {
    const events: any[] =
      // Invisible for longer than an edge function can live (150 s), so a worker that dies is never overlapped by a
      // retry; a failed event comes back in seconds through webhook_finish instead (#139).
      (await deps.rpc("webhook_claim", { p_limit: 10, p_visibility_s: 160 })) ?? [];
    if (!events.length) {
      // A message held back as `busy` (its customer's previous turn was still running) or retried after a failure comes
      // back a few seconds later; wait for it here instead of for the next 30-second tick (staging load, session 5e).
      const due = await deps.rpc("webhook_next_due", {}).catch(() => null);
      const waitMs = typeof due === "number" || typeof due === "string" ? Number(due) * 1000 : NaN;
      if (!Number.isFinite(waitMs) || waitMs > left() - 2500) break;
      const dueAt = Date.now() + waitMs;
      await drainOutbox();
      const rest = dueAt - Date.now();
      if (rest > left() - 2500) break;
      await (deps.sleep ?? sleep)(Math.max(250, rest + 100));
      continue;
    }
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

  await drainOutbox(true);

  // 3. Broadcasts (§39.8): one approved broadcast per run while config broadcasts_enabled is on; the database fixes the
  // audience (opted in at this second) and the daily cap, Kapso paces the sends.
  if (deps.kapsoBroadcast != null && left() > 4000) {
    const b = await deps.rpc("broadcast_claim", {}).catch((e: unknown) => {
      deps.log?.("broadcast claim failed", { error: String(e).slice(0, 120) });
      return null;
    });
    if (b?.id) await sendBroadcast(deps, b, () => senderFor("customer"));
  }

  // 4. The Slack queue (§32.1): ops alerts, #orders-live lines and support threads, oldest first; a thread reply waits for
  // its root. Only claimed when Slack is installed, so attempts are not burnt.
  if (deps.slack && left() > 1000) {
    const rows: any[] = (await deps.rpc("slack_claim", { p_limit: 20 })) ?? [];
    for (const r of rows) {
      const res = await deps.slack({
        channel: String(r.channel_id),
        threadTs: r.thread_ts ?? null,
        text: String(r.text ?? ""),
        actions: Array.isArray(r.actions) ? r.actions : [],
      });
      await deps.rpc("slack_finish", {
        p_id: r.id,
        p_ok: res.ok,
        p_channel_id: r.channel_id,
        p_ts: res.ok ? res.ts : null,
        p_error: res.ok ? null : res.error,
        // An error Slack will repeat (a bad channel, a revoked token) fails at once instead of five times.
        p_retry: res.ok ? true : res.retry,
      });
      out.alerts++;
    }
  }
  // 5. The catalogue sync (§39.12): shops queued by a menu, price, availability, stock or shop change, the reconcile and
  // the nightly full sync. Last, so it never delays a reply.
  if (deps.catalog) {
    // The sync runs after the replies, on the time left before this worker must be gone (not the reply budget).
    const wallLeft = () =>
      deps.workerDeadline ? deps.workerDeadline.getTime() - Date.now() - 5_000 : left();
    await catalogSyncStep(deps.rpc, deps.catalog, deps.log, wallLeft).catch((e: unknown) =>
      deps.log?.("catalogue sync step failed", { error: String(e).slice(0, 160) }),
    );
    // Meta's review status (§39.15.2): one page of the paced sweep when one is due and the worker has time for it.
    if (wallLeft() > 25_000)
      await catalogStatusStep(deps.rpc, deps.catalog, deps.log).catch((e: unknown) =>
        deps.log?.("catalogue status step failed", { error: String(e).slice(0, 160) }),
      );
  }
  return out;
}

// ---- Outbound -----------------------------------------------------------------------------------------
type Delivery = {
  status: "sent" | "failed" | "skipped" | "retry";
  ref?: string;
  error?: string;
  /** Sent as a template (outside the window). */
  template?: boolean;
};

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
      const from = await senderFor(deps, "merchant", m.target, sender);
      if (!from) return { status: "skipped", error: "no merchant WhatsApp number connected (#67)" };
      const outside = await outsideWindow(deps, m, from, "merchant");
      if (outside) return outside;
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
  const from = await senderFor(deps, "customer", m.target, sender);
  if (!from) return { status: "skipped", error: "no customer WhatsApp number connected" };
  const outside = await outsideWindow(deps, m, from, "customer");
  if (outside) {
    // A person's reply behind the template is held until the customer taps "Read the reply" (§32.1).
    if (outside.status === "sent" && m.payload?.kind === "support_reply")
      await deps.rpc("support_message_status", {
        p_message_id: m.payload.message_id,
        p_status: "held",
      });
    return outside;
  }
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
  if (p.kind === "support_reply")
    await deps.rpc("support_message_status", { p_message_id: p.message_id, p_status: "sent" });
  return { status: "sent", ref };
}

/**
 * Outside the 24-hour window on the sending number (§3, §39.8): the approved template that carries this row, or a dry run
 * for a simulator number. Null = inside the window (or a row no template covers): send the free-form message as before.
 * A customer message no template can carry is skipped (Meta would refuse it); a merchant card is still tried, because
 * the escalation's backup channels take over when it fails.
 */
async function outsideWindow(
  deps: DispatchDeps,
  m: Outbox,
  from: string,
  audience: "customer" | "merchant",
): Promise<Delivery | null> {
  const key = templateKey(m);
  if (!key || !m.target) return null;
  const open = await deps.rpc("whatsapp_window_open", {
    p_phone_e164: m.target,
    p_phone_number_id: from,
  });
  if (open !== false) return null;
  const choice: TemplateChoice | null = await deps.rpc("whatsapp_template_for", {
    p_key: key,
    p_lang: String(m.payload?.lang ?? "ar"),
    p_target: m.target,
    p_audience: audience,
  });
  if (!choice)
    return audience === "customer"
      ? { status: "skipped", error: `outside the 24-hour window: no approved template for ${key}` }
      : null;
  const payload = templatePayload(choice, key, m);
  if (!payload) return { status: "skipped", error: `template ${choice.name} could not be filled` };
  const r = await deps.whatsapp(from, payload);
  if (!r.ok) return { status: r.retry ? "retry" : "failed", error: r.error };
  return {
    status: "sent",
    ref: r.id ?? (choice.dry_run ? `dry-run:${choice.name}` : undefined),
    template: true,
  };
}

/**
 * The number to send an outbox row from: the one where this person's 24-hour window is open, else the default sender
 * for the audience (whatsapp_sender_for). An older database without the function keeps the default.
 */
async function senderFor(
  deps: DispatchDeps,
  audience: "customer" | "merchant",
  target: string,
  fallback: () => Promise<string | null>,
): Promise<string | null> {
  const n = await deps
    .rpc("whatsapp_sender_for", { p_audience: audience, p_target: target })
    .catch(() => null);
  return typeof n === "string" && n ? n : fallback();
}

/** The number to answer an inbound message from: the one it arrived on when it is ours, else the default sender. */
async function replySender(deps: DispatchDeps, ev: any, audience: "customer" | "merchant") {
  const n = ev?.phone_number_id
    ? await deps
        .rpc("whatsapp_reply_number", {
          p_phone_number_id: String(ev.phone_number_id),
          p_audience: audience,
        })
        .catch(() => null)
    : null;
  return typeof n === "string" && n
    ? n
    : ((await deps.rpc("whatsapp_sender", { p_audience: audience })) as string | null);
}

const MARKETING_PAYLOADS = ["c:order", "mkt:stop"];

/**
 * One claimed broadcast (§39.8, reference: gokapso/whatsapp-broadcasts-example): per template language, the simulator
 * numbers are recorded through the sink (a dry run; never sent), and the rest go to one Kapso broadcast of the approved
 * template in that language. Kapso paces the sends and suppresses anyone who stopped marketing inside WhatsApp.
 */
async function sendBroadcast(
  deps: DispatchDeps,
  b: {
    id: string;
    name: string;
    template: string;
    values: Record<string, unknown>;
    groups: Record<string, string[]> | null;
  },
  sender: () => Promise<string | null>,
) {
  const errors: string[] = [];
  const ids: string[] = [];
  const dry: string[] = [];
  const sent: string[] = [];
  const from = await sender();
  const def = templateByName(String(b.template));
  if (!from || !def || def.category !== "MARKETING") {
    await deps.rpc("broadcast_finish", {
      p_id: b.id,
      p_ok: false,
      p_kapso_ids: [],
      p_error: !from ? "no customer number" : "not a marketing template",
      p_dry_run_phones: [],
      p_sent_phones: [],
    });
    return;
  }
  for (const [code, phones] of Object.entries(b.groups ?? {})) {
    const lang = templateLang(code);
    let message: Record<string, unknown>;
    try {
      message = templateMessage("+0", def, lang, b.values ?? {}, MARKETING_PAYLOADS);
    } catch (e) {
      errors.push(`${lang}: ${String(e instanceof Error ? e.message : e).slice(0, 100)}`);
      continue;
    }
    const components = (message.template as { components: Record<string, unknown>[] }).components;
    const sim = phones.filter((p) => isSimNumber(p));
    const real = phones.filter((p) => !isSimNumber(p));
    for (const ph of sim) {
      const r = await deps.whatsapp(from, { ...message, to: ph.replace(/^\+/, "") });
      if (r.ok) dry.push(ph);
      else errors.push(`${lang}: dry run refused`);
    }
    if (!real.length) continue;
    if (!deps.kapsoBroadcast) {
      errors.push(`${lang}: no Kapso key`);
      continue;
    }
    const templateId = await deps.rpc("broadcast_template_id", {
      p_template: def.name,
      p_lang: lang,
    });
    if (!templateId) {
      errors.push(`${lang}: ${def.name} is not approved on the sending number`);
      continue;
    }
    try {
      const id = await deps.kapsoBroadcast.create(
        `${b.name} (${lang})`.slice(0, 120),
        from,
        templateId,
      );
      for (let i = 0; i < real.length; i += 1000)
        await deps.kapsoBroadcast.addRecipients(
          id,
          real.slice(i, i + 1000).map((phone_number) => ({ phone_number, components })),
        );
      await deps.kapsoBroadcast.send(id);
      ids.push(id);
      sent.push(...real);
    } catch (e) {
      errors.push(`${lang}: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`);
    }
  }
  await deps.rpc("broadcast_finish", {
    p_id: b.id,
    p_ok: errors.length === 0,
    p_kapso_ids: ids,
    p_error: errors.length ? errors.join("; ").slice(0, 500) : null,
    p_dry_run_phones: dry,
    p_sent_phones: sent,
  });
}

/** The menu model inside the daily AI budget: reserve, call, book the real usage (§32.6; 5c leftover). */
export function budgetedMenuModel(deps: DispatchDeps): MenuModel | null {
  const call = deps.menuModelCall;
  if (!call) return null;
  return async (req) => {
    const [model, est] = await Promise.all([
      deps.rpc("config_value", { p_key: "ai_menu_model" }),
      deps.rpc("config_value", { p_key: "ai_menu_est_usd" }),
    ]);
    if (!model) throw new Error("ai_menu_model is not configured");
    const q = await deps.rpc("ai_quota_take", {
      p_customer_id: null,
      p_purpose: "menu",
      p_model: String(model),
      p_est_usd: Number(est ?? 0.05),
    });
    if (!q?.ok) throw new Error(`menu model: daily AI budget (${String(q?.reason ?? "refused")})`);
    const t0 = Date.now();
    let error: string | null = null;
    let out: Awaited<ReturnType<MenuModelCall>> | null = null;
    try {
      out = await call({ ...req, model: String(model) });
    } catch (e) {
      error = String(e).slice(0, 200);
    }
    await deps
      .rpc("ai_call_finish", {
        p_call_id: q.call_id,
        p_input_tokens: out?.usage?.input_tokens ?? null,
        p_output_tokens: out?.usage?.output_tokens ?? null,
        p_audio_seconds: null,
        p_latency_ms: Date.now() - t0,
        p_ok: !error,
        p_error: error,
      })
      .catch(() => null);
    if (error || !out) throw new Error(error ?? "menu model: no answer");
    return out.text;
  };
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
    case "tip":
      // A promised tip to whoever delivered (session 5f part 7): only their "Got it" books it.
      return m.order_id && Number(m.payload.tip_usd) > 0
        ? [tipCard(to, m.order_id, code, m.payload.tip_usd, String(m.payload.source ?? ""), lang)]
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
  // A contact stopped marketing inside WhatsApp itself (Meta's opt-out, §18.3): the same as typing STOP.
  if (/marketing_preference_changed$/.test(String(ev.event_type))) {
    const wa = String(ev.payload?.contact?.wa_id ?? "").replace(/^\+/, "");
    const stopped = ev.payload?.marketing_preference?.status === "stopped";
    if (
      !/^[1-9][0-9]{6,14}$/.test(wa) ||
      !["stopped", "resumed"].includes(String(ev.payload?.marketing_preference?.status))
    ) {
      // A shape we do not recognise is never silently "done": logged and kept as ignored for a look.
      deps.log?.("marketing preference event not recognised", {
        event_id: Number(ev.event_id ?? 0),
      });
      return "ignored";
    }
    await deps.rpc("customer_marketing_stop_by_phone", {
      p_phone_e164: `+${wa}`,
      p_stopped: stopped,
    });
    return "done";
  }
  if (
    !/message\.received$/.test(String(ev.event_type)) &&
    !(ev.payload?.message && ev.payload?.message?.kapso?.direction === "inbound")
  ) {
    return "done"; // statuses and other events: nothing to do here (quality events are classified in the database)
  }
  const m = readInbound(ev.payload);
  const o = readOnboardingInbound(ev.payload);
  if (!m || !o) return "ignored";
  // When this number last wrote to which of our numbers: a free-form message is only deliverable inside WhatsApp's
  // 24-hour window on that number (§3, §18.1 I); outside it a template carries the message (§39.8).
  await deps
    .rpc(
      "whatsapp_seen",
      ev.phone_number_id
        ? { p_phone_e164: m.from, p_phone_number_id: String(ev.phone_number_id) }
        : { p_phone_e164: m.from },
    )
    .catch((e: unknown) => deps.log?.("whatsapp_seen failed", { error: String(e).slice(0, 120) }));
  // WhatsApp admin commands (§32.1): only from an operator's own number on the Merchant side; anything else carries on.
  const adminTapped = adminTap(m.buttonId);
  const adminCmd = adminTapped ? null : parseAdminCommand(m.text);
  if (adminTapped || adminCmd) {
    const op = await deps
      .rpc("ops_operator", {
        p_slack_user_id: null,
        p_phone_e164: m.from,
        p_phone_number_id: ev.phone_number_id ? String(ev.phone_number_id) : null,
      })
      .catch(() => null);
    if (op?.user_id) {
      await handleAdmin(deps, m, op, adminTapped, adminCmd);
      return "done";
    }
  }
  // Demo testers (§39.15.3): `tester remove +…` from an owner's phone, on either side of the test switch. The server checks
  // the owner; from anyone else the message carries on as a normal one.
  const testerCmd = parseTesterRemove(m.text);
  if (testerCmd) {
    const r = await deps
      .rpc("demo_tester_remove_by_owner", {
        p_owner_phone: m.from,
        p_phone_e164: testerCmd.phone ?? "",
      })
      .catch((e: unknown) => {
        deps.log?.("tester remove failed", { error: String(e).slice(0, 120) });
        return null;
      });
    if (r?.status && r.status !== "not_owner") {
      await deps.rpc("app_reply", {
        p_to: m.from,
        p_payload: { text: testerRemoveReply(r) },
        p_ref: m.messageId,
      });
      return "done";
    }
  }
  const members: any[] =
    (await deps.rpc("merchant_members_by_phone", { p_phone_e164: m.from })) ?? [];
  // "Stop promotions" on a marketing template is STOP for anyone, a merchant member who is also a customer included
  // (§18.3: honoured at once); the customer bot handles it for everyone else.
  if (m.buttonId === "mkt:stop" && members.length) {
    await deps.rpc("customer_marketing_stop_by_phone", { p_phone_e164: m.from, p_stopped: true });
    await deps.rpc("app_reply", {
      p_to: m.from,
      p_payload: { text: "✅ وقّفنا العروض. / Promotions stopped. / Promotions arrêtées." },
      p_ref: m.messageId,
    });
    return "done";
  }
  // Staging only (§34): the owner's one phone plays both sides. `#merchant` and `#customer` choose which side
  // the bot treats the text as; a tap goes to whoever owns the card (a merchant card to the merchant, a
  // customer button to the customer bot). Null for every other number, so nothing changes for real people.
  const side: string | null = await deps
    .rpc("test_side_get", { p_phone_e164: m.from })
    .catch(() => null);
  if (side) {
    const sw = m.text === null ? null : /^\s*#(merchant|customer)\s*$/i.exec(m.text);
    if (sw) return switchTestSide(deps, ev, m.from, sw[1].toLowerCase());
    const merchantTap = !!m.buttonId && parseMerchantAction(m.buttonId) !== null;
    const customerTap = !!m.buttonId && parseCustomerAction(m.buttonId) !== null;
    if (customerTap && !merchantTap) return customerInbound(deps, ev);
    if (side === "customer" && !merchantTap) return customerInbound(deps, ev);
  }
  // Claims and registration (§18.1): a non-member who asks to join or is mid-onboarding, and the answers
  // to our own claim cards (objection, lost-phone confirmation), which go to members.
  const ot = parseOnboardingTap(o.buttonId);
  if (!members.length || ot?.a === "object" || ot?.a === "recover") {
    const from = await replySender(deps, ev, "merchant");
    if (
      from &&
      (await handleOnboarding(
        {
          rpc: deps.rpc,
          send: (p) => deps.whatsapp(from, p),
          sendFrom: (n, p) => deps.whatsapp(n, p),
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
  // A merchant template's button that stands for a typed command (the weekly summary's "Details").
  if (m.buttonId && Object.hasOwn(TEMPLATE_COMMANDS, m.buttonId)) {
    m.text = TEMPLATE_COMMANDS[m.buttonId];
    m.buttonId = null;
  }
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
  const menuSender = await replySender(deps, ev, "merchant");
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
        menuModel: budgetedMenuModel(deps),
        fetchMedia: deps.fetchMenuMedia ? (x) => deps.fetchMenuMedia!(menuSender, x) : null,
        log: deps.log,
        fetchLink: deps.fetchLink ?? null,
        itemPhotos: deps.itemPhotos ?? null,
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
  const gtin = m.text !== null ? normalizeGtin(m.text.trim()) : null;
  if (gtin) {
    // §39.5: a scanned or typed barcode → what Open Food Facts says about the product, cached, marked estimated.
    const p = await lookupProduct(gtin, { rpc: deps.rpc, fetch: deps.offFetch ?? undefined }).catch(
      () => null,
    );
    await reply(productCardText(p, gtin));
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
    let cmd = parseMerchantCommand(m.text, deps.now?.() ?? new Date());
    // What the rules do not read goes to the copilot's model, behind ai_merchant_text_enabled (§32.4, §39.7). It
    // answers with the same typed commands, so every change still waits for the merchant's tap.
    if (!cmd && deps.merchantCopilot)
      cmd = await merchantModelCommand(deps, deps.merchantCopilot, m.text).catch((e: unknown) => {
        deps.log?.("merchant model failed", { error: String(e).slice(0, 120) });
        return null;
      });
    if (!cmd) {
      await reply(HELP);
      return "done";
    }
    // Merchant memory (§39.7): the language the shop's people write in.
    await deps
      .rpc("merchant_fact_writes_in", {
        p_vendor_id: members[0].vendor_id,
        p_lang: writesIn(m.text),
      })
      .catch(() => null);
    await handleCommand(deps, cmd, members[0], m, reply);
    return "done";
  }
  await reply(HELP);
  return "done";
}

/** `#merchant` / `#customer` from the owner's phone (staging only): switches the side and says so. */
async function switchTestSide(
  deps: DispatchDeps,
  ev: any,
  phone: string,
  side: string,
): Promise<"done" | "ignored"> {
  const r = await deps.rpc("test_side_set", { p_phone_e164: phone, p_side: side });
  const from = await replySender(deps, ev, "merchant");
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
  const from = (await replySender(deps, ev, "customer")) ?? null;
  if (!from) return "ignored";
  await handleCustomerTurn(
    {
      ...deps.customer,
      rpc: deps.rpc,
      send: (p) => deps.whatsapp(from, p),
      senderNumberId: from,
      now: deps.now,
      log: deps.log,
    },
    m,
    // The queue's attempt number: a retry of a turn that never finished is replayed, not dropped (#139). The turn's
    // lease ends when this worker must be gone (an edge function lives at most 150 s from its start).
    { attempt: Number(ev.attempts ?? 1), leaseUntil: deps.workerDeadline },
  );
  return "done";
}

// A tap on a merchant template's button runs the same words the merchant could type.
const TEMPLATE_COMMANDS: Record<string, string> = {
  "mcmd:week": "weekly report",
  "mcmd:help": "help",
  "mcmd:open": "open",
};

export const HELP = [
  "ما فهمت عليك 🙏 جرّب («help» للائحة كاملة / for everything):",
  "• «مسكّر نص ساعة» / «Mrakad 30 mins»",
  "• «فتحنا» / «open»",
  "• «خلصت الكنافة» / «knefe back»",
  "• «سعر الكنافة 3.5»",
  "• «رصيدي» / «balance»",
  "• «ما في كهربا» / «power back»",
  "• «capacity 8» · «same price»",
  "• «add Ali as kitchen +961…» / «remove Ali»",
  "• باركود المنتج / a product barcode: 5281234567896",
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
    case "tip_got": {
      // "✅ Got it" on a promised tip: the server checks this number is the shop's or the order's driver, then books it.
      const r = await safe("order_tip_confirm", {
        p_order_id: action.orderId,
        p_phone_e164: m.from,
      });
      const tip = `$${Number(r?.tip_usd ?? 0).toFixed(2)}`;
      return reply(
        r?.status === "collected" || r?.status === "already"
          ? `🙏 تمام، سجّلنا البخشيش ${tip} إلك على الطلب #${r.code}. / Noted: the ${tip} tip on #${r.code} is yours.`
          : r?.status === "not_delivered"
            ? "⚠️ الطلب بعدو ما وصل. / The order is not delivered yet."
            : "⚠️ ما فيك تأكّد هالبخشيش. / You can't confirm this tip.",
      );
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
      const done = copilotDoneText(r);
      if (done) return reply(done);
      if (r.status === "confirmed" && r.kind === "resume") {
        // Open outside the set hours: the hours check closes the shop again within a minute, so say so (session 5).
        const h = await deps
          .rpc("vendor_hours_after_resume", { p_proposal_id: action.proposalId })
          .catch(() => null);
        if (h?.has_hours && h.open_now === false)
          return reply(
            "🟢 فتحنا، بس الدوام المسجّل بيقول مسكّر هلق: فحص الدوام رح يسكّر المحل من جديد خلال دقيقة. غيّر الدوام بـ «دوام». / Open, but your set hours say closed now: the hours check will close you again within a minute. Change them with “hours”.",
          );
      }
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
      // The server's checks (§39.7): say what it refused, nothing is changed.
      const check =
        /check_violation|within the configured|no items|percent off|runs 1-|on this menu|no running offer|weekdays|opening and a closing|next 60 days|minimum order|delivery radius|Boost needs|removed from the menu|new item needs|an edit changes|unknown station|unknown offer/.exec(
          msg,
        );
      if (check)
        return reply(
          `⚠️ ما فينا نعمل هالتغيير: ${msg.replace(/^.*?(?:ERROR:\s*)?/, "").slice(0, 160)} / Not possible as asked.`,
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
  // The copilot's commands (§39.7): availability, stock, items, offers, hours, minimum, radius, Boost, reports.
  if (
    await runCopilot(
      { rpc: deps.rpc, member, now, reply, propose, item: (q: string) => item(q) },
      cmd,
    )
  )
    return;
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

/** The reply after a copilot proposal is confirmed (§39.7), or null for the older kinds. */
export function copilotDoneText(r: any): string | null {
  if (r?.status !== "confirmed") return null;
  switch (r.kind) {
    case "availability_off":
      return r.until
        ? `⏸ وقّفنا ${Number(r.hidden ?? 0)} صنف لحد ${beirutHhmm(new Date(r.until))}، وبيرجعوا لحالن. / ${Number(r.hidden ?? 0)} items off until ${beirutHhmm(new Date(r.until))}; they come back on their own.`
        : `⏸ وقّفنا ${Number(r.hidden ?? 0)} صنف. ابعت «… رجع» لترجّعن. / ${Number(r.hidden ?? 0)} items off; send “… back” to restore them.`;
    case "availability_on":
      return `▶️ رجّعنا ${Number(r.restored ?? 0)} صنف. / ${Number(r.restored ?? 0)} items are back.`;
    case "offer_create":
      return "🏷️ العرض شغّال. الزباين بيشوفوه بالسلة والسعر النهائي. «stop offer» لتوقفه. / The offer is live; customers see it in the basket total.";
    case "boost_start":
      return "🚀 حفظنا ميزانية البوست. ما منسحب شي قبل ما يبلّش الإعلان المدفوع، ومنخبرك. / Boost budget saved; nothing is charged until sponsored placement starts.";
    case "item_add":
      return "➕ انزاد الصنف عالمنيو. / The item is on your menu.";
    case "item_remove":
      return "🗑️ انشال من المنيو. / Removed from the menu.";
    default:
      return null;
  }
}

const beirutHhmm = (d: Date) => {
  const c = beirutClock(d);
  return `${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;
};

/** One copilot model call inside the AI budget, logged in ai_calls like the customer's (§6 cost model, §32.6). */
async function merchantModelCommand(
  deps: DispatchDeps,
  m: CopilotModel,
  text: string,
): Promise<MerchantCommand | null> {
  const q = await deps.rpc("ai_quota_take", {
    p_customer_id: null,
    p_purpose: "merchant",
    p_model: m.model,
    p_est_usd: 0.003,
  });
  if (!q?.ok) return null; // the daily budget is spent: the rules' help answers
  const t0 = Date.now();
  let usage: { input_tokens: number; output_tokens: number } | null = null;
  let error: string | null = null;
  let cmd: MerchantCommand | null = null;
  try {
    cmd = await copilotModelCommand(
      {
        model: m.model,
        call: async (req) => {
          const r = await m.call(req);
          usage = r.usage;
          return r;
        },
      },
      text,
      deps.now?.() ?? new Date(),
    );
  } catch (e) {
    error = String(e).slice(0, 200);
  }
  const u = usage as { input_tokens: number; output_tokens: number } | null;
  await deps
    .rpc("ai_call_finish", {
      p_call_id: q.call_id,
      p_input_tokens: u?.input_tokens ?? null,
      p_output_tokens: u?.output_tokens ?? null,
      p_audio_seconds: null,
      p_latency_ms: Date.now() - t0,
      p_ok: !error,
      p_error: error,
    })
    .catch(() => null);
  if (error) throw new Error(error);
  return cmd;
}

/** The owner's answer to `tester remove +…` (§39.15.3). */
export function testerRemoveReply(r: { status?: string; phone?: string }): string {
  switch (r.status) {
    case "removed":
      return `🧪 ${r.phone} is no longer a demo tester.`;
    case "not_found":
      return `No demo tester has the number ${r.phone}. Send /ak testers in Slack for the list.`;
    default:
      return "Send the number with its country code: tester remove +961…";
  }
}
