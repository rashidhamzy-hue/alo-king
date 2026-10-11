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
  driverJobCard,
  lowStockCard,
  needDriverCard,
  orderCard,
  parseMerchantAction,
  proposalCard,
  reactivateCard,
  readyCheckCard,
  rejectReasonList,
  textMessage,
  type Lang,
  type OrderCardData,
} from "../_shared/merchant-cards.ts";
import { clampInteractive } from "../_shared/meta-limits.ts";
import { afterSunset, customerStatusMessages } from "../_shared/customer-cards.ts";
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
      (await deps.rpc("webhook_claim", { p_limit: 10, p_visibility_s: 30 })) ?? [];
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
  if (!m) return "ignored";
  const members: any[] =
    (await deps.rpc("merchant_members_by_phone", { p_phone_e164: m.from })) ?? [];
  if (!members.length) return "ignored"; // a customer: the customer bot (session 4) handles it
  const reply = (body: string | Record<string, unknown>) =>
    deps.rpc("app_reply", {
      p_to: m.from,
      p_payload: typeof body === "string" ? { text: body } : body,
      p_ref: m.messageId,
    });

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

export const HELP = [
  "ما فهمت عليك 🙏 جرّب:",
  "• «مسكّر نص ساعة» / «Mrakad 30 mins»",
  "• «فتحنا» / «open»",
  "• «خلصت الكنافة» / «knefe back»",
  "• «سعر الكنافة 3.5»",
  "• «رصيدي» / «balance»",
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
  switch (action.a) {
    case "accept": {
      const member = await memberFor({ p_order_id: action.orderId });
      const r = await safe("order_accept", {
        p_order_id: action.orderId,
        p_prep_minutes: action.prep,
        p_member_id: member,
        p_channel: "whatsapp",
      });
      return reply(
        r.status === "accepted"
          ? `✅ تم القبول، جاهز خلال ${action.prep} د`
          : r.status === "already_accepted"
            ? "✅ مقبول من قبل"
            : "⚠️ ما عاد فيك تقبل هالطلب (انلغى أو انرفض)",
      );
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
      return reply(
        r.status === "needs_code"
          ? "🔐 هالطلب بدو رمز التسليم. اطلب من الزبون الرمز (٤ أرقام) وابعتو هون."
          : r.status === "not_allowed" || r.status === "too_late"
            ? "⚠️ ما فيك تغيّر حالة هالطلب"
            : "👍",
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
      const r = await safe("merchant_proposal_decide", {
        p_proposal_id: action.proposalId,
        p_confirm: action.confirm,
        p_member_id: member,
      });
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
    const id = await deps.rpc("merchant_proposal_create", {
      p_vendor_id: member.vendor_id,
      p_kind: kind,
      p_payload: payload,
      p_source: "rules",
      p_member_id: member.member_id,
    });
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
  }
}
