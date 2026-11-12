// Edge entry point. One job: accept Kapso webhooks fast and safely, then hand off.
//   POST /webhooks/kapso/customer   <- the customer number
//   POST /webhooks/kapso/ops        <- the business number (drivers, merchants, staff, alerts)
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { KapsoReceived, senderKey, unwrap, verifySignature, type Line } from "@ak/wa/kapso";
import { send as gatewaySend } from "@ak/wa/gateway";
import type { ModelClient } from "@ak/agents/concierge";
import type { ConversationState } from "@ak/agents/concierge-tools";
import Anthropic from "@anthropic-ai/sdk";
import { runTurn, turnKeyOf, type Pending, type TurnDeps } from "./turn";
import { alertOps, dispatchAndOffer, sendToParty } from "./ops-turn";
import { cashAsk, RIDER_TEXT } from "@ak/agents/job-card";

export interface Env {
  CONVERSATION: DurableObjectNamespace;
  INBOUND: Queue<QueueMsg>;
  KAPSO_BASE_URL: string; KAPSO_API_KEY: string;
  KAPSO_WEBHOOK_SECRET_CUSTOMER: string; KAPSO_WEBHOOK_SECRET_OPS: string;
  PHONE_NUMBER_ID_CUSTOMER: string; PHONE_NUMBER_ID_OPS: string;
  SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string;
  ANTHROPIC_API_KEY: string; MODEL_FAST: string; MODEL_SMART: string; BUFFER_SECONDS: string;
  /** Tests inject a scripted model and an in-memory database here. Never set in production. */
  TEST_DEPS?: { db: SupabaseClient; model: ModelClient };
}
interface QueueMsg { line: Line; event: string; key: string }

const db = (env: Env): SupabaseClient => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

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
  const model: ModelClient = env.TEST_DEPS?.model ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const deps: TurnDeps = { db: supa, model, modelName: env.MODEL_FAST, send: (req) => gatewaySend(supa, env, req) };   // the only door out
  deps.onOrderConfirmed = (orderId) => dispatchAndOffer(deps, orderId);
  deps.notifyCustomer = (id, what) => notifyCustomer(deps, id, what);
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
        const { data } = await supa.from("wa_inbound_events").select("payload, processed_at").eq("idempotency_key", msg.body.key).single();
        if (data && !data.processed_at) await deliver(supa, env, msg.body.line, msg.body.event, msg.body.key, data.payload);
        msg.ack();
      } catch (err) {
        await supa.from("wa_inbound_events").update({ error: String(err) }).eq("idempotency_key", msg.body.key);
        msg.retry();
      }
    }
  },

  /** Every minute. Timers, lost events, and the things nobody tapped. */
  async scheduled(_c: ScheduledController, env: Env): Promise<void> {
    const deps = depsFor(env);
    const supa = deps.db;
    const bucket = Math.floor(Date.now() / 600_000);          // alerts repeat at most every ten minutes

    // 1. events that were stored but never handed on (worker died between the insert and the hand-off)
    const stale = await supa.rpc("stale_inbound_events", { p_older_than_secs: 45, p_limit: 50 });
    for (const e of (stale.data as { idempotency_key: string; line: Line; event: string; payload: unknown }[] | null) ?? []) {
      await deliver(supa, env, e.line, e.event, e.idempotency_key, e.payload).catch((err) => supa.from("wa_inbound_events").update({ error: String(err) }).eq("idempotency_key", e.idempotency_key));
    }

    // 2. timers
    const { data: t } = await supa.rpc("run_timers");
    const timers = (t ?? {}) as { cancelled_orders?: { order_id: string; short_code: string; customer_id: string; was: string }[];
      expired_offers?: { delivery_id: string; driver_id: string; orders: string[] }[]; alerts?: { kind: string; short_code?: string; order_id?: string; delivery_id?: string }[] };
    for (const o of timers.cancelled_orders ?? []) {
      await sendToCustomer(deps, o.customer_id, `انلغى الطلب #${o.short_code} لأنو ${o.was === "awaiting_payment" ? "ما وصلنا الدفع" : "ما تأكّد"}. اكتبلنا إذا بعدك بدّك ياه.`, `cancel:${o.order_id}`, o.order_id);
    }
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

async function notifyCustomer(deps: TurnDeps, id: string, what: "on_the_way" | "rider_waiting"): Promise<void> {
  const q = deps.db.from("delivery_stops").select("order_id, orders(short_code, customer_id)").eq("kind", "dropoff");
  const { data } = what === "on_the_way" ? await q.eq("delivery_id", id) : await q.eq("order_id", id);
  for (const s of (data as unknown as { order_id: string; orders: { short_code: string; customer_id: string } }[] | null) ?? []) {
    const text = what === "on_the_way" ? `طلبك #${s.orders.short_code} صار عالطريق 🛵` : `السائق واصل عندك بطلب #${s.orders.short_code} وعم يستناك 🚪`;
    await sendToCustomer(deps, s.orders.customer_id, text, `${what}:${s.order_id}`, s.order_id);
  }
}

async function route(supa: SupabaseClient, env: Env, line: Line, event: string, item: unknown): Promise<void> {
  if (event === "whatsapp.contact.marketing_preference_changed") {
    // The customer changed "offers and announcements" inside WhatsApp itself. That is a consent event like any other.
    const e = item as { contact?: { wa_id?: string; phone_number?: string; business_scoped_user_id?: string }; marketing_preference?: string; preference?: string };
    const pref = String(e.marketing_preference ?? e.preference ?? "").toLowerCase();
    const id = e.contact?.business_scoped_user_id ?? e.contact?.wa_id ?? e.contact?.phone_number;
    if (!id || !pref) return;
    const { data } = await supa.rpc("touch_conversation", { p_line: line, p_wa_user_id: e.contact?.business_scoped_user_id ?? null, p_phone: e.contact?.phone_number ?? e.contact?.wa_id ?? null, p_name: null });
    const party = (data as { party_id?: string } | null)?.party_id;
    if (party) await supa.from("consent_events").insert({ party_id: party, line, kind: "marketing", action: /stop|opt.?out|off|false/.test(pref) ? "opt_out" : "opt_in", source: "meta_preference_webhook" });
    return;
  }
  if (event === "whatsapp.message.failed" || event === "whatsapp.message.delivered" || event === "whatsapp.message.read") {
    const s = item as { message?: { id?: string } };
    if (s.message?.id) await supa.from("wa_messages").update({ status: event.split(".").pop() }).eq("wa_message_id", s.message.id);
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
