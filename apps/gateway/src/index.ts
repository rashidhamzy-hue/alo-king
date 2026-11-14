// Edge entry point. One job: accept Kapso webhooks fast and safely, then hand off.
//   POST /webhooks/kapso/customer   <- the customer number
//   POST /webhooks/kapso/ops        <- the business number (drivers, merchants, staff, alerts)
//   POST /webhooks/kapso/project    <- Kapso project events: Meta enforcement on the account, numbers disconnected (4.10)
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/cloudflare";
import { fundingState, kapsoClient, KapsoReceived, numberHealth, senderKey, templateStatuses, unwrap, verifySignature, type Line, type Outbound } from "@ak/wa/kapso";
import { probeInbound, probeReply, type ProbeMessage } from "@ak/wa/probe";
import { send as gatewaySend } from "@ak/wa/gateway";
import { parseIdentityEvent, parsePreferenceEvent, parseStatusEvent } from "@ak/wa/webhook";
import type { ModelClient } from "@ak/agents/concierge";
import type { ConversationState } from "@ak/agents/concierge-tools";
import Anthropic from "@anthropic-ai/sdk";
import { runTurn, turnKeyOf, type Pending, type TurnDeps } from "./turn";
import { alertOps, dispatchAndOffer, sendToParty } from "./ops-turn";
import { cashAsk, RIDER_TEXT } from "@ak/agents/job-card";
import { customerLineCron } from "@ak/agents/cron";
import { catalogFeed } from "./catalog-feed";

export interface Env {
  CONVERSATION: DurableObjectNamespace;
  INBOUND: Queue<QueueMsg>;
  KAPSO_BASE_URL: string; KAPSO_API_KEY: string;
  KAPSO_WEBHOOK_SECRET_CUSTOMER: string; KAPSO_WEBHOOK_SECRET_OPS: string;
  /** Signs the project webhook (account enforcement, number lifecycle). Absent: the route answers 404. */
  KAPSO_WEBHOOK_SECRET_PROJECT?: string;
  /** "on" only on staging: the cron runs the probe (hourly test order, test rider). Production never sets it (4.10). */
  PROBE_MODE?: string;
  PHONE_NUMBER_ID_CUSTOMER: string; PHONE_NUMBER_ID_OPS: string;
  /** The WhatsApp Business Account of the customer line: where its templates live (4.3). Not secret. */
  WABA_ID_CUSTOMER?: string;
  SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string;
  ANTHROPIC_API_KEY: string; MODEL_FAST: string; MODEL_SMART: string; BUFFER_SECONDS: string;
  /** Only the Worker end-to-end test sets this (a scripted model on localhost, 4.5). Unset everywhere else. */
  ANTHROPIC_BASE_URL?: string;
  /** 1.21 (K1): the password Meta's scheduled feed uses for GET /catalog/feed.csv (user "meta"). Unset: the route answers 404. */
  CATALOG_FEED_PASSWORD?: string;
  /** Tests inject a scripted model and an in-memory database here. Never set in production. */
  TEST_DEPS?: { db: SupabaseClient; model: ModelClient };
}
interface QueueMsg { line: Line; event: string; key: string }

// TEST_DEPS (tests only) reaches the webhook and the queue too, not only the turn: the queue's retry path is tested (A4, item 11).
const db = (env: Env): SupabaseClient => env.TEST_DEPS?.db ?? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const MAX_TURN_ATTEMPTS = 3;
const SEEN_MAX = 300;

/** Kapso sends X-Idempotency-Key. If it is ever missing, derive the key from the message ids so a retry gets the same key. */
export async function eventKey(header: string | null, line: Line, event: string, body: unknown, raw: string): Promise<string> {
  if (header) return header;
  const ids = unwrap(body).map((i) => (i as { message?: { id?: string } }).message?.id).filter(Boolean).sort().join("+");
  const basis = ids ? `${line}|${event}|${ids}` : `${line}|${event}|${raw}`;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(basis));
  return "derived:" + [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function depsFor(env: Env): TurnDeps {
  const supa = env.TEST_DEPS?.db ?? db(env);
  // maxRetries 0: turn.ts retries capacity failures itself and tells the customer "one moment" (B1, 1.15); the SDK's own
  // silent retries would only delay that.
  const model: ModelClient = env.TEST_DEPS?.model ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) });
  const deps: TurnDeps = { db: supa, model, modelName: env.MODEL_FAST, send: (req) => gatewaySend(supa, env, req) };   // the only door out
  deps.onOrderConfirmed = (orderId) => dispatchAndOffer(deps, orderId);
  deps.notifyCustomer = (id, what) => notifyCustomer(deps, id, what);
  // 1.8 (B3's request, wired by B4): WhatsApp's typing indicator on the message being answered. Marks it read; sends nothing.
  if (!env.TEST_DEPS) deps.typing = (id) => kapsoClient(env).messages.markRead({ phoneNumberId: env.PHONE_NUMBER_ID_CUSTOMER, messageId: id, typingIndicator: { type: "text" } });
  return deps;
}

/** Hands a stored event to its conversation object and marks it processed. Safe to call any number of times. */
async function deliver(supa: SupabaseClient, env: Env, line: Line, event: string, key: string, payload: unknown): Promise<void> {
  for (const item of unwrap(payload)) await route(supa, env, line, event, item);
  await supa.rpc("mark_inbound_processed", { p_key: key, p_error: null });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/webhooks/kapso/project") return projectWebhook(req, env, ctx);
    if (req.method === "GET" && url.pathname === "/catalog/feed.csv") {
      const supa = env.TEST_DEPS?.db ?? db(env);           // the catalog feed Meta reads (1.21, K1)
      return catalogFeed(req, { db: supa, password: env.CATALOG_FEED_PASSWORD,
        sign: async (path, seconds) => (await supa.storage.from("media").createSignedUrl(path, seconds)).data?.signedUrl ?? null });
    }
    const m = url.pathname.match(/^\/webhooks\/kapso\/(customer|ops)$/);
    if (req.method !== "POST" || !m) return new Response("not found", { status: 404 });
    const line = m[1] as Line;

    const raw = await req.text();
    const secret = line === "customer" ? env.KAPSO_WEBHOOK_SECRET_CUSTOMER : env.KAPSO_WEBHOOK_SECRET_OPS;
    if (!(await verifySignature(raw, req.headers.get("X-Webhook-Signature"), secret))) return new Response("bad signature", { status: 401 });

    const event = req.headers.get("X-Webhook-Event") ?? "unknown";
    const body = JSON.parse(raw) as unknown;
    const key = await eventKey(req.headers.get("X-Idempotency-Key"), line, event, body, raw);

    // The number that received the event must be the number this route is for. A crossed wire is a hard stop.
    const expected = line === "customer" ? env.PHONE_NUMBER_ID_CUSTOMER : env.PHONE_NUMBER_ID_OPS;
    const first = unwrap(body)[0] as { phone_number_id?: string } | undefined;
    if (first?.phone_number_id && first.phone_number_id !== expected) return new Response("wrong line", { status: 400 });

    // Store first, think later.
    const supa = db(env);
    const ins = await supa.from("wa_inbound_events").insert({ idempotency_key: key, line, event, payload: body });
    if (ins.error && ins.error.code !== "23505") return new Response("store failed", { status: 500 });
    if (ins.error) {
      // A retry of an event we already stored. If the first attempt never finished the hand-off, finish it now.
      const prior = await supa.from("wa_inbound_events").select("processed_at, payload").eq("idempotency_key", key).single();
      if (prior.data && !prior.data.processed_at) ctx.waitUntil(deliver(supa, env, line, event, key, prior.data.payload).catch(() => env.INBOUND.send({ line, event, key })));
      return new Response("ok");
    }
    ctx.waitUntil(Promise.resolve(supa.rpc("beat", { p_name: `webhook:${line}`, p_detail: { event } })).catch(() => {}));
    // Fast path: straight to the conversation object (it only buffers, so this takes milliseconds).
    // The queue is the retry path, not the main road: it used to add up to five seconds to every message.
    try { await deliver(supa, env, line, event, key, body); }
    catch { await env.INBOUND.send({ line, event, key }); }
    return new Response("ok");
  },

  async queue(batch: MessageBatch<QueueMsg>, env: Env): Promise<void> {
    const supa = db(env);
    for (const msg of batch.messages) {
      try {
        const { data, error } = await supa.from("wa_inbound_events").select("payload, processed_at").eq("idempotency_key", msg.body.key).single();
        // A4 (item 11): a failed read used to be acked as "nothing to do". Only "no such row" is nothing to do; anything else retries.
        if (error && error.code !== "PGRST116") throw new Error(`wa_inbound_events read: ${error.message}`);
        if (data && !data.processed_at) await deliver(supa, env, msg.body.line, msg.body.event, msg.body.key, data.payload);
        msg.ack();
      } catch (err) {
        // best effort: the database may be the thing that failed; the retry below must happen either way
        await Promise.resolve(supa.from("wa_inbound_events").update({ error: String(err).slice(0, 500) }).eq("idempotency_key", msg.body.key)).catch(() => {});
        if (msg.attempts >= 3) Sentry.captureException(err, { tags: { where: "queue", line: msg.body.line } });   // retrying, but loudly
        msg.retry();
      }
    }
  },

  /** Every minute. Timers, lost events, and the things nobody tapped. */
  async scheduled(_c: ScheduledController, env: Env): Promise<void> {
    const deps = depsFor(env);
    const supa = deps.db;
    const bucket = Math.floor(Date.now() / 600_000);          // alerts repeat at most every ten minutes
    await supa.rpc("cron_beat");                               // 4.10: proof of life, and the gap since the last run

    // 1. events that were stored but never handed on (worker died between the insert and the hand-off)
    const stale = await supa.rpc("stale_inbound_events", { p_older_than_secs: 45, p_limit: 50 });
    for (const e of (stale.data as { idempotency_key: string; line: Line; event: string; payload: unknown }[] | null) ?? []) {
      await deliver(supa, env, e.line, e.event, e.idempotency_key, e.payload).catch((err) => supa.from("wa_inbound_events").update({ error: String(err) }).eq("idempotency_key", e.idempotency_key));
    }

    // 2. timers
    const { data: t } = await supa.rpc("run_timers");
    const timers = (t ?? {}) as { cancelled_orders?: { order_id: string; short_code: string; customer_id: string; was: string }[];
      expired_offers?: { delivery_id: string; driver_id: string; orders: string[] }[]; alerts?: { kind: string; short_code?: string; order_id?: string; delivery_id?: string }[] };
    // Cancelled orders are told through the customer notices below (4.3), with the approved template when there is one.
    for (const x of timers.expired_offers ?? []) {
      await sendToParty(deps, x.driver_id, { type: "text", text: { body: RIDER_TEXT.offerGone } }, `expired:${x.delivery_id}`);
      for (const orderId of x.orders) await dispatchAndOffer(deps, orderId);
    }
    for (const a of timers.alerts ?? []) {
      await alertOps(deps, a.kind === "door_wait_exceeded" ? `🚪 سائق ناطر عند الباب أكتر من المسموح: #${a.short_code}` : `📵 سائق مقطوع من فترة (توصيلة ${a.delivery_id?.slice(0, 8)})`,
        `${a.kind}:${a.order_id ?? a.delivery_id}:${bucket}`);
    }

    // 3. orders waiting for a rider: try again (a rider may have come on shift or dropped cash)
    const waiting = await supa.rpc("orders_waiting_for_rider");
    for (const id of (waiting.data as string[] | null) ?? []) await dispatchAndOffer(deps, id);

    // 4. handed over, cash never reported: ask the rider again, tell ops
    const unpaid = await supa.rpc("unpaid_deliveries");
    for (const u of (unpaid.data as { order_id: string; short_code: string; driver_id: string; total_usd: number }[] | null) ?? []) {
      await sendToParty(deps, u.driver_id, cashAsk(u), `cashask:${u.order_id}:${bucket}`);
      await alertOps(deps, `💵 الطلب #${u.short_code} تسلّم وما تسجّل الكاش ($${Number(u.total_usd).toFixed(2)})`, `unpaid:${u.order_id}:${bucket}`);
    }

    // 5. open exception cases (failed turns and anything else the system gave up on) and goods not yet received back
    const due = await supa.rpc("ops_exceptions_due");
    for (const x of (due.data as { id: string; kind: string; ref: string }[] | null) ?? []) await alertOps(deps, `🧯 حالة مفتوحة بحاجة لشخص: ${x.kind} (${x.ref.slice(0, 60)})`, `exc:${x.id}:${bucket}`);
    const back = await supa.rpc("returns_pending");
    for (const x of (back.data as { order_id: string; short_code: string }[] | null) ?? []) await alertOps(deps, `📦 أغراض الطلب #${x.short_code} لازم ترجع عالمركز وتنعدّ`, `return:${x.order_id}:${Math.floor(Date.now() / 1_800_000)}`);

    // 6. learn from what was delivered
    await supa.rpc("learn_from_recent_orders");

    // 7. customer notices (4.3): cancelled, rider at the door, payment received. One per order and event.
    const notices = await supa.rpc("customer_notices_due");
    for (const n of (notices.data as Notice[] | null) ?? []) await sendNotice(deps, n);
    // 8. the customer line's own jobs (lane B, packages/agents/src/cron.ts): feedback cards (2.9) and search words for new items (1.23)
    await customerLineCron(deps).catch((err) => console.error("customer_line_cron", String(err).slice(0, 200)));
    if (new Date().getUTCMinutes() === 7 && env.WABA_ID_CUSTOMER) await syncTemplates(env, supa);    // Meta's review result, hourly

    // 8. heartbeat (4.10): the probe, silence, and Kapso's view of our numbers. Each step on its own: one failing never stops the others.
    if (env.PROBE_MODE === "on") await step("probe", () => probeTick(deps, env));
    await step("heartbeat", () => heartbeatAlerts(deps));
    const now = new Date();
    if (now.getUTCHours() === 6 && now.getUTCMinutes() === 13) await step("kapso_health", () => kapsoHealth(deps, env));

    // 9. message meter (4.12): once a month per number, when free-form replies pass the warning mark
    const meter = await supa.rpc("meter_alerts");
    for (const m of (meter.data as { line: string; month: string; free_form: number; allowance: number; warn_at: number }[] | null) ?? []) {
      await alertOps(deps, `📨 رقم ${m.line === "customer" ? "الزباين" : "العمليات"}: ${m.free_form} رسالة رد هالشهر من أصل ${m.allowance} مجانية. بعدها كل رد بينحسب.`,
        `meter:${m.line}:${m.month}:${m.warn_at}`);
    }
  },
};

async function customerAddress(supa: SupabaseClient, partyId: string): Promise<string | null> {
  const { data } = await supa.from("party_identities").select("phone_e164, wa_user_id").eq("party_id", partyId).eq("line", "customer").limit(1);
  const row = (data as { phone_e164: string | null; wa_user_id: string | null }[] | null)?.[0];
  return row?.phone_e164 ?? row?.wa_user_id ?? null;
}

async function sendToCustomer(deps: TurnDeps, partyId: string, text: string, dedupeKey: string, orderId?: string): Promise<void> {
  const to = await customerAddress(deps.db, partyId);
  // Inside the 24-hour window this is a free service message. Outside it the gateway refuses free text, by design:
  // the approved utility templates in templates/templates.json are the only way to reach a customer then.
  if (to) await deps.send({ line: "customer", partyId, to, msg: { type: "text", text: { body: text } }, category: "service", orderId, dedupeKey });
}

/** lang (0093, A4): the customer's language, from how they last wrote. The template and the words that fill it are in it. */
interface Notice { key: string; kind: "order_cancelled" | "rider_at_door" | "payment_received"; order_id: string; short_code: string;
  customer_id: string; params: string[]; lang?: "ar" | "en" | "fr"; template: string | null; template_approved: boolean }

/** The same notice as free text, for inside the 24-hour window until Meta approves the template. */
const NOTICE_TEXT: Record<"ar" | "en" | "fr", Record<Notice["kind"], (p: string[]) => string>> = {
  ar: {
    order_cancelled: (p) => `انلغى طلبك #${p[0]}: ${p[1]}. اكتبلنا إذا بعدك بدّك ياه.`,
    rider_at_door: (p) => `السائق واصل عندك بطلب #${p[0]} وعم يستناك 🚪`,
    payment_received: (p) => `وصلنا دفعك لطلب #${p[0]}: ${p[1]}.`,
  },
  en: {
    order_cancelled: (p) => `Your order #${p[0]} was cancelled: ${p[1]}. Write to us if you still want it.`,
    rider_at_door: (p) => `The rider is at your door with order #${p[0]} and is waiting for you 🚪`,
    payment_received: (p) => `We received your payment for order #${p[0]}: ${p[1]}.`,
  },
  fr: {
    order_cancelled: (p) => `Votre commande #${p[0]} a été annulée : ${p[1]}. Écrivez-nous si vous la voulez toujours.`,
    rider_at_door: (p) => `Le livreur est à votre porte avec la commande #${p[0]} et vous attend 🚪`,
    payment_received: (p) => `Nous avons reçu votre paiement pour la commande #${p[0]} : ${p[1]}.`,
  },
};

/** Exported for tests. The approved utility template when Meta has approved it (it reaches the customer at any hour);
 *  until then the same words as free text, which the gate lets out only inside the 24-hour window. Either way it is
 *  recorded once, so a refused notice is not retried every minute. A throw (outbox or Kapso down) is retried next minute. */
export async function sendNotice(deps: TurnDeps, n: Notice): Promise<void> {
  const to = await customerAddress(deps.db, n.customer_id);
  let outcome = "refused:no_address";
  if (to) {
    const lang = n.lang ?? "ar";
    const msg: Outbound = n.template && n.template_approved
      ? { type: "template", template: { name: n.template, language: { code: lang }, components: [{ type: "body", parameters: n.params.map((t) => ({ type: "text", text: t })) }] } }
      : { type: "text", text: { body: NOTICE_TEXT[lang][n.kind](n.params) } };
    const r = await deps.send({ line: "customer", partyId: n.customer_id, to, msg, category: msg.type === "template" ? "utility" : "service", orderId: n.order_id, dedupeKey: n.key });
    outcome = r.ok ? `sent:${msg.type}` : `refused:${r.refused}`;
  }
  await deps.db.rpc("customer_notice_done", { p_key: n.key, p_kind: n.kind, p_order: n.order_id, p_outcome: outcome });
}

async function syncTemplates(env: Env, supa: SupabaseClient): Promise<void> {
  const { data } = await supa.from("wa_templates").select("name").eq("line", "customer");
  for (const t of await templateStatuses(env, env.WABA_ID_CUSTOMER!, ((data as { name: string }[] | null) ?? []).map((x) => x.name)).catch(() => [])) {
    await supa.rpc("set_template_status", { p_name: t.name, p_status: t.status });
  }
}

/** One cron step. A failure is reported to Sentry and does not stop the steps after it. */
async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch (err) { Sentry.captureException(err, { tags: { where: `cron:${name}` } }); console.error(JSON.stringify({ level: "error", event: "cron_step_failed", step: name, err: String(err).slice(0, 300) })); }
}

/** Something is wrong that a person must see: the exception queue (re-alerted every ten minutes until closed), ops, and Sentry. */
async function raiseAlarm(deps: TurnDeps, kind: string, ref: string, detail: Record<string, unknown>, text: string): Promise<void> {
  // Once per case: while it is open, the exception queue re-alerts ops every ten minutes, and Sentry has heard about it already.
  const open = await deps.db.from("ops_exceptions").select("id").eq("kind", kind).eq("ref", ref).neq("status", "resolved").limit(1);
  if (open.error) throw new Error(`ops_exceptions: ${open.error.message}`);
  if ((open.data as unknown[] | null)?.length) return;
  const r = await deps.db.rpc("raise_ops_exception", { p_kind: kind, p_ref: ref, p_detail: detail });
  if (r.error) throw new Error(`raise_ops_exception: ${r.error.message}`);
  // One Sentry issue per kind (an hourly ref would open a new issue, and an email, every hour the problem lasts)
  Sentry.captureMessage(`${kind}: ${ref}`, { level: "error", tags: { where: "heartbeat", kind }, extra: { ref, ...detail }, fingerprint: ["heartbeat", kind] });
  await alertOps(deps, text, `alarm:${kind}:${ref}`);
}

const ALARM_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  probe_stuck: (d) => `🧪 طلب التجربة #${d.order} واقف عند ${d.status} من ${d.minutes} دقيقة`,
  probe_silent: () => `🧪 طلب التجربة كل ساعة ما عم ينعمل. الكرون أو مسار الرسائل معطّل`,
  inbound_silent: (d) => `📭 ما وصلت ولا رسالة من الزباين من ساعات (آخر وحدة ${String(d.last).slice(0, 16)}). ممكن الويبهوك واقف`,
  cron_gap: (d) => `⏱ الكرون غاب ${d.gap_minutes} دقيقة ورجع`,
};

/**
 * What is wrong now is raised once per case (0090: a condition keeps one ref for as long as it lasts), and every heartbeat
 * case that is no longer wrong is resolved by the database with a note. Only heartbeat cases: the rest stay with a person.
 */
export async function heartbeatAlerts(deps: TurnDeps): Promise<void> {
  const { data, error } = await deps.db.rpc("heartbeat_alerts");
  if (error) throw new Error(`heartbeat_alerts: ${error.message}`);
  const active = (data as { kind: string; ref: string; detail: Record<string, unknown> }[] | null) ?? [];
  for (const a of active) {
    await raiseAlarm(deps, `heartbeat:${a.kind}`, a.ref, a.detail, (ALARM_TEXT[a.kind] ?? (() => a.kind))(a.detail));
  }
  const cleared = await deps.db.rpc("clear_heartbeat_alarms", { p_active: active });
  if (cleared.error) throw new Error(`clear_heartbeat_alarms: ${cleared.error.message}`);
}

/** Once a day: Meta's quality rating for our numbers, and whether Kapso has paused paid sends. Neither has a webhook. */
async function kapsoHealth(deps: TurnDeps, env: Env): Promise<void> {
  const { data: hb } = await deps.db.rpc("setting", { p_key: "heartbeat" });
  const ok = new Set(((hb as { quality_ok?: string[] } | null)?.quality_ok ?? ["GREEN"]).map((x) => x.toUpperCase()));
  const day = new Date().toISOString().slice(0, 10);
  for (const n of await numberHealth(env, [env.PHONE_NUMBER_ID_CUSTOMER, env.PHONE_NUMBER_ID_OPS])) {
    if (n.quality_rating && !ok.has(n.quality_rating.toUpperCase())) {
      await raiseAlarm(deps, "kapso:quality", `${n.id}:${day}`, { number: n.id, quality_rating: n.quality_rating, status: n.status },
        `🟡 تقييم جودة الرقم ${n.id === env.PHONE_NUMBER_ID_CUSTOMER ? "تبع الزباين" : "تبع العمليات"} صار ${n.quality_rating}`);
    }
  }
  if (env.WABA_ID_CUSTOMER) {
    const f = await fundingState(env, env.WABA_ID_CUSTOMER);
    if (f.paused) await raiseAlarm(deps, "kapso:funding_paused", `${env.WABA_ID_CUSTOMER}:${day}`, { status: f.status, reasons: f.reasons },
      `💳 Kapso وقّف الرسائل المدفوعة (${f.reasons.join(", ") || "بلا سبب"}). لازم نزيد رصيد`);
  }
}

/** The probe's move: answer what the test customer and test rider were last sent, and place the hourly test order. Staging only. */
export async function probeTick(deps: TurnDeps, env: Env): Promise<void> {
  const supa = deps.db;
  const pending = await supa.rpc("probe_pending");
  if (pending.error) throw new Error(`probe_pending: ${pending.error.message}`);
  const { data: cfg } = await supa.rpc("setting", { p_key: "probe" });
  const pin = (cfg as { pin?: { lat: number; lng: number } | null } | null)?.pin ?? null;
  for (const p of (pending.data as { key: string; line: Line; payload: Outbound; wa_user_id: string }[] | null) ?? []) {
    const r = probeReply(p.payload);
    const { data: mine } = await supa.rpc("probe_answered", { p_key: p.key, p_action: r ? (r.kind === "tap" ? r.id : "pin") : "none" });
    if (!mine || !r || !p.wa_user_id) continue;                 // another cron run took it, or there is nothing to answer
    const msg: ProbeMessage | null = r.kind === "tap" ? { type: "tap", id: r.id, title: r.title } : pin ? { type: "location", lat: pin.lat, lng: pin.lng } : null;
    if (msg) await injectProbe(supa, env, p.line, p.wa_user_id, msg);
  }
  const { data: due } = await supa.rpc("probe_due");
  const d = due as { wa_user_id: string; text: string } | null;
  if (d?.wa_user_id && d.text) await injectProbe(supa, env, "customer", d.wa_user_id, { type: "text", body: d.text });
}

/** A probe message enters exactly where a real one does: stored as an inbound event, then delivered to its conversation object. */
async function injectProbe(supa: SupabaseClient, env: Env, line: Line, waUserId: string, msg: ProbeMessage): Promise<void> {
  const body = probeInbound({ phoneNumberId: line === "customer" ? env.PHONE_NUMBER_ID_CUSTOMER : env.PHONE_NUMBER_ID_OPS, waUserId, name: "Probe", msg });
  const key = `probe:${(body.message as { id: string }).id}`;
  const ins = await supa.from("wa_inbound_events").insert({ idempotency_key: key, line, event: "whatsapp.message.received", payload: body });
  if (ins.error) throw new Error(`probe store: ${ins.error.message}`);
  await deliver(supa, env, line, "whatsapp.message.received", key, body);
}

/** Kapso project webhook: Meta enforcement on the WhatsApp account, numbers offboarded or disconnected. Each opens an ops exception. */
async function projectWebhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.KAPSO_WEBHOOK_SECRET_PROJECT) return new Response("not found", { status: 404 });
  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get("X-Webhook-Signature"), env.KAPSO_WEBHOOK_SECRET_PROJECT))) return new Response("bad signature", { status: 401 });
  const event = req.headers.get("X-Webhook-Event") ?? "unknown";
  const body = JSON.parse(raw) as Record<string, unknown>;
  const key = await eventKey(req.headers.get("X-Idempotency-Key"), "ops", event, body, raw);
  const supa = db(env);
  const ins = await supa.from("wa_inbound_events").insert({ idempotency_key: key, line: "ops", event, payload: body });
  if (ins.error && ins.error.code !== "23505") return new Response("store failed", { status: 500 });
  if (ins.error) return new Response("ok");                    // a redelivery: the first one already raised it
  ctx.waitUntil(projectEvent(depsFor(env), event, body).then(() => supa.rpc("mark_inbound_processed", { p_key: key, p_error: null }))
    .catch((err) => supa.rpc("mark_inbound_processed", { p_key: key, p_error: String(err).slice(0, 300) })));
  return new Response("ok");
}

const ENFORCEMENT = /^whatsapp\.(account\.(disabled|restricted|reinstated|violation)|phone_number\.(offboarded|disconnected|reconnected|deleted))$/;

/** Exported for tests. */
export async function projectEvent(deps: TurnDeps, event: string, body: Record<string, unknown>): Promise<void> {
  if (!ENFORCEMENT.test(event)) return;                        // smoke tests and events we do not subscribe to
  const numbers = ((body.phone_numbers as { id?: string; display_phone_number?: string }[] | undefined) ?? []).map((n) => n.display_phone_number ?? n.id).join(", ");
  const what = event.replace("whatsapp.", "");
  const detail = { event, id: body.id, occurred_at: body.occurred_at, numbers, restrictions: body.restrictions, violation: body.violation, ban: body.ban, source: body.source };
  await raiseAlarm(deps, "kapso:" + what, String(body.id ?? `${what}:${body.occurred_at}`), detail,
    `🚨 ميتا/Kapso: ${what}${numbers ? ` على ${numbers}` : ""}. لازم حدا يفتح الحساب ويشوف شو صار`);
}

async function notifyCustomer(deps: TurnDeps, id: string, what: "on_the_way" | "rider_waiting"): Promise<void> {
  const q = deps.db.from("delivery_stops").select("order_id, orders(short_code, customer_id)").eq("kind", "dropoff");
  const { data } = what === "on_the_way" ? await q.eq("delivery_id", id) : await q.eq("order_id", id);
  for (const s of (data as unknown as { order_id: string; orders: { short_code: string; customer_id: string } }[] | null) ?? []) {
    const text = what === "on_the_way" ? `طلبك #${s.orders.short_code} صار عالطريق 🛵` : `السائق واصل عندك بطلب #${s.orders.short_code} وعم يستناك 🚪`;
    await sendToCustomer(deps, s.orders.customer_id, text, `${what}:${s.order_id}`, s.order_id);
  }
}

/** Exported for tests. Non-message events are applied through SQL; messages go to their conversation object. */
export async function route(supa: SupabaseClient, env: Env, line: Line, event: string, item: unknown): Promise<void> {
  if (event === "whatsapp.contact.marketing_preference_changed") {
    // The customer changed "offers and announcements" inside WhatsApp itself. A consent event like any other,
    // but never a sign of life: it does not create a customer and does not open the reply window (0060).
    const p = parsePreferenceEvent(item);
    if (!p) throw new Error("unreadable marketing_preference_changed payload");   // stored with the error; never silently dropped
    const { error } = await supa.rpc("apply_marketing_preference", { p_line: line, p_wa_user_id: p.waUserId, p_phone: p.phone, p_status: p.status, p_sequence: p.sequence });
    if (error) throw new Error(`apply_marketing_preference: ${error.message}`);
    return;
  }
  if (event === "whatsapp.contact.identity_changed") {
    const c = parseIdentityEvent(item);
    if (!c) return;
    const { error } = await supa.rpc("rekey_identity", { p_line: line, p_old: c.oldId, p_new: c.newId, p_phone: c.phone });
    if (error) throw new Error(`rekey_identity: ${error.message}`);
    return;
  }
  if (event === "whatsapp.message.sent" || event === "whatsapp.message.failed" || event === "whatsapp.message.delivered" || event === "whatsapp.message.read") {
    // Status, and what Meta says it bills for the message: the message meter's ground truth (4.12, 0061).
    const s = parseStatusEvent(event, item);
    if (!s) return;
    const { error } = await supa.rpc("record_message_status", { p_wamid: s.wamid, p_status: s.status, p_billable: s.pricing?.billable ?? null,
      p_category: s.pricing?.category ?? null, p_type: s.pricing?.type ?? null, p_error_code: s.error?.code ?? null });
    if (error) throw new Error(`record_message_status: ${error.message}`);
    return;
  }
  if (event !== "whatsapp.message.received") return;

  const e = KapsoReceived.parse(item);
  if (e.message.kapso.origin && e.message.kapso.origin !== "cloud_api") return;   // ignore history sync and app echoes
  const who = senderKey(e);
  const id = who.waUserId ?? who.phone;
  if (!id) return;

  // One Durable Object per (line, sender): serialises the conversation and buffers bursts
  // ("voice note, then a photo, then the address") into a single agent turn.
  const stub = env.CONVERSATION.get(env.CONVERSATION.idFromName(`${line}:${id}`));
  const res = await stub.fetch("https://do/inbound", { method: "POST", body: JSON.stringify({ line, who, event: e } satisfies Pending) });
  if (!res.ok) throw new Error(`conversation object refused: ${res.status}`);
}

export class ConversationDO implements DurableObject {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const incoming = (await req.json()) as Pending;
    // The same WhatsApp message can arrive twice (provider retry, queue retry, reconciler). It is buffered once.
    const seen = (await this.state.storage.get<string[]>("seen")) ?? [];
    if (seen.includes(incoming.event.message.id)) return new Response("duplicate");
    await this.state.storage.put("seen", seen.concat([incoming.event.message.id]).slice(-SEEN_MAX));

    const pending = ((await this.state.storage.get<Pending[]>("pending")) ?? []).concat([incoming]);
    await this.state.storage.put("pending", pending);
    // Buttons and location pins are answers: process at once. Text, audio and images wait for the burst to end.
    // Riders never wait: nobody on a motorbike should watch a typing indicator.
    const type = incoming.event.message.type;
    const instant = incoming.line === "ops" || type === "interactive" || type === "location";
    const delayMs = instant ? 0 : Number(this.env.BUFFER_SECONDS) * 1000;
    if (!(await this.state.storage.get("inflight"))) await this.state.storage.setAlarm(Date.now() + delayMs);
    return new Response("queued");
  }

  /**
   * Fires when the burst is over. A Durable Object runs one alarm at a time, so turns for one person never overlap.
   * The messages being answered stay in storage ("inflight") until the turn has finished. If the worker dies or the
   * turn throws, the alarm fires again with the same messages, and runTurn's turn key makes the retry safe.
   */
  async alarm(): Promise<void> {
    let inflight = await this.state.storage.get<{ msgs: Pending[]; attempts: number }>("inflight");
    if (!inflight) {
      const pending = (await this.state.storage.get<Pending[]>("pending")) ?? [];
      if (pending.length === 0) return;
      inflight = { msgs: pending, attempts: 0 };
      await this.state.storage.put("inflight", inflight);
      await this.state.storage.delete("pending");
    }
    inflight.attempts++;
    await this.state.storage.put("inflight", inflight);

    const convState = (await this.state.storage.get<ConversationState>("state")) ?? {};
    const deps = depsFor(this.env);
    try {
      await runTurn(deps, inflight.msgs, convState);
      await this.state.storage.delete("inflight");
    } catch (err) {
      if (inflight.attempts >= MAX_TURN_ATTEMPTS) {
        // Give up loudly: a person takes over, and the customer is never left in silence.
        // The case is written to the database first. If the alert below fails too, it is still in the exception queue,
        // and the cron keeps raising it every ten minutes until a person closes it.
        const first = inflight.msgs[0]!;
        await deps.db.rpc("raise_ops_exception", { p_kind: "turn_failed", p_ref: turnKeyOf(inflight.msgs),
          p_detail: { line: first.line, who: first.who, messages: inflight.msgs.map((m) => m.event.message.id), error: String(err).slice(0, 300) } });
        await this.state.storage.delete("inflight");
        Sentry.captureException(err, { tags: { where: "turn_gave_up", line: first.line } });
        await alertOps(deps, `⚠️ رسالة ما قدرنا نعالجها بعد ${MAX_TURN_ATTEMPTS} محاولات: ${String(err).slice(0, 140)}`, `giveup:${turnKeyOf(inflight.msgs)}`).catch(() => {});
      } else {
        await this.state.storage.setAlarm(Date.now() + 2000 * inflight.attempts);
        return;
      }
    } finally {
      await this.state.storage.put("state", convState);     // keep what the turn learned even if it failed part-way
    }
    // anything that arrived while this turn was running
    if (((await this.state.storage.get<Pending[]>("pending")) ?? []).length > 0) await this.state.storage.setAlarm(Date.now() + 500);
  }
}
