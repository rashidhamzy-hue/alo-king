// SIM1: one simulated customer talking to the real turn code, wired the way test/db/flow-kit.ts wires it: the conversation
// Durable Object (apps/gateway/src/index.ts) with an in-memory storage, the real turn code, tools and gateway over the run's
// database, and the guard (guard.ts) in place of Kapso's HTTP endpoint. The only difference from flow-kit: the Concierge is the
// real model (MODEL_FAST from wrangler.jsonc) behind the metered client, not a script. After every turn the hard checks run.
import { ConversationDO, type Env } from "../../apps/gateway/src/index";
import { turnKeyOf, type Pending } from "../../apps/gateway/src/turn";
import type { ModelClient } from "../../packages/agents/src/concierge";
import { supabaseOver } from "../../test/db/supabase-shim";
import { cardOf, HARD_SEVERITY, renderKapso, ruleProblems, totalMismatch, wrongLanguage, type BotMsg, type Option } from "./checks";
import { amountsIn, numbersIn, type Meter } from "./metered";
import { hash, rng } from "./rng";
import type { Guard } from "./guard";
import type { Scenario } from "./scenarios";
import type { World } from "./world";

export const KAPSO_ORIGIN = "https://kapso.sim.invalid";
export const MEDIA_ORIGIN = "https://media.sim.invalid";

export type Action =
  | { kind: "text"; text: string }
  | { kind: "texts"; texts: string[] }
  | { kind: "tap"; option: Option & { ref: string } }
  | { kind: "pin"; where: "home" | "outside" }
  | { kind: "voice"; said: string; transcript: string; seconds: number }
  | { kind: "done" };
export interface Failure { code: string; detail: string; turn: number; severity: 1 | 2 | 3 }
export interface TurnRecord {
  n: number; clock: string; action: Action; replies: BotMsg[]; seconds: number; modelCalls: number; usd: number;
  outcome: string | null; path: string | null; handoffs: string[]; afterHandoff: boolean; afterOptOut: boolean; failures: Failure[];
  guardRefusals: number;
}

function fakeStorage() {
  const store = new Map<string, unknown>();
  const storage = { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
    delete: async (k: string) => store.delete(k), setAlarm: async () => undefined };
  return { state: { storage } as unknown as DurableObjectState, store };
}
const discardBucket = { from: () => ({ upload: async (path: string) => ({ data: { path }, error: null }) }) };
const norm = (s: unknown) => String(s ?? "").replace(/[^A-Za-z0-9]/g, "");
const FOLLOW_UP: Record<string, string> = { ar: "في حدا؟", arabizi: "fi 7ada?", en: "Is anyone there?", fr: "Il y a quelqu'un ?", mixed: "fi 7ada? anyone?" };
export const followUpText = (lang: string) => FOLLOW_UP[lang] ?? FOLLOW_UP.ar!;

export class SimConversation {
  readonly who: { waUserId: string; phone: string };
  readonly turns: TurnRecord[] = [];
  readonly options = new Map<string, Option & { ref: string }>();
  readonly historyOrders: string[] = [];
  readonly tappedConfirm = new Set<string>();
  readonly customerNumbers = new Set<string>();
  partyId = ""; conversationId = "";
  optedOut = false;
  private seq = 0;
  private reported = new Set<string>();
  private conv: ConversationDO;
  private store: Map<string, unknown>;
  private turnKeys: string[] = [];
  private client: ReturnType<typeof supabaseOver>["client"];

  constructor(readonly world: World, readonly scenario: Scenario, readonly attempt: number, private guard: Guard, readonly meter: Meter,
              concierge: ModelClient, modelName: string) {
    const tag = `${scenario.id}-${attempt}`;
    this.who = { waUserId: `sim-${tag}`, phone: `+999${String(scenario.seed).padStart(6, "0")}${attempt}` };
    const shim = supabaseOver(world.db);
    Object.assign(shim.client, { storage: discardBucket });
    this.client = shim.client;
    const s = fakeStorage();
    this.store = s.store;
    const env = { BUFFER_SECONDS: "6", MODEL_FAST: modelName, KAPSO_BASE_URL: `${KAPSO_ORIGIN}/v24.0`, KAPSO_API_KEY: "sim-not-a-key",
                  PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS", TEST_DEPS: { db: shim.client, model: concierge } } as unknown as Env;
    this.conv = new ConversationDO(s.state, env);
  }

  /** Where the customer's pin is: their village's centre moved by a seeded few hundred metres, or a served-area outsider. */
  pin(where: "home" | "outside"): { latitude: number; longitude: number } {
    const r = rng(hash(`${this.scenario.seed}:pin:${where}`));
    const jitter = () => (r() - 0.5) * 0.006;
    if (where === "home") {
      const v = this.world.villages.get(this.scenario.village.name_en);
      const base = v?.lat != null && v.lng != null ? v : [...this.world.villages.values()].find((x) => x.served && x.lat != null) ?? { lat: 33.677, lng: 35.564 };
      return { latitude: Number(base.lat) + jitter(), longitude: Number(base.lng) + jitter() };
    }
    const out = [...this.world.villages.values()].filter((x) => !x.served && x.lat != null).sort((a, b) => a.name_en.localeCompare(b.name_en));
    const base = out.length ? out[Math.floor(r() * out.length)]! : { lat: 33.563, lng: 35.369 };
    return { latitude: Number(base.lat) + jitter(), longitude: Number(base.lng) + jitter() };
  }

  private async sql<T = any>(q: string, p: unknown[] = []): Promise<T[]> { return this.world.db.all<T>(q, p); }

  /** The party, its conversation, and (for returning customers) a pinned home and a closed past order. */
  async start(): Promise<void> {
    const t = await this.world.db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: this.who.waUserId, p_phone: this.who.phone, p_name: "Sim customer" });
    this.partyId = t.party_id; this.conversationId = t.conversation_id;
    const h = this.scenario.history;
    if (!h) return;
    const v = this.world.villages.get(this.scenario.village.name_en);
    const p = this.pin("home");
    const place = (await this.world.db.rpc("save_customer_pin", { p_party: this.partyId, p_lat: p.latitude, p_lng: p.longitude, p_village: v?.id ?? null }))?.place_id ?? null;
    const lines = h.items.map((i) => ({ product_id: this.world.sku.get(i.sku), qty: i.qty })).filter((l) => l.product_id);
    if (!lines.length) return;
    const o = await this.world.db.rpc("create_order_from_quote", { p_customer: this.partyId, p_conversation: this.conversationId, p_lines: lines,
      p_village: v?.id ?? null, p_place: place, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
    if (!o?.order_id) return;
    await this.world.db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: this.partyId, p_wamid: `wamid.SIMHIST.${this.who.waUserId}` });
    // Test data in the run's own database (as test/db/recall.test.ts does): the past order was delivered and closed.
    await this.world.db.pg.query(`update orders set status = 'closed', delivered_at = now() - make_interval(days => $2) where id = $1`, [o.order_id, h.days_ago]);
    this.historyOrders.push(o.order_id);
  }

  private event(message: Record<string, unknown>) {
    const id = `wamid.SIM.${this.who.waUserId}.${++this.seq}`;
    return { message: { id, timestamp: String(Math.floor(Date.now() / 1000)), from: this.who.phone.replace("+", ""),
                        kapso: { direction: "inbound", origin: "cloud_api" }, ...message, ...(message.kapso ? { kapso: { direction: "inbound", origin: "cloud_api", ...(message.kapso as object) } } : {}) },
             conversation: { id: `conv_${this.who.waUserId}`, contact_name: "Sim customer" }, phone_number_id: "PN_CUSTOMER" };
  }
  private messagesFor(a: Action): Record<string, unknown>[] {
    switch (a.kind) {
      case "text": return [{ type: "text", text: { body: a.text } }];
      case "texts": return a.texts.map((t) => ({ type: "text", text: { body: t } }));
      case "tap": return [a.option.ref === "list"
        ? { type: "interactive", interactive: { type: "list_reply", list_reply: { id: a.option.id, title: a.option.title, ...(a.option.description ? { description: a.option.description } : {}) } } }
        : { type: "interactive", interactive: { type: "button_reply", button_reply: { id: a.option.id, title: a.option.title } } }];
      case "pin": return [{ type: "location", location: this.pin(a.where) }];
      case "voice": return [{ type: "audio", audio: { id: `media${this.seq}`, voice: true, mime_type: "audio/ogg; codecs=opus" },
        kapso: { has_media: true, transcript: { text: a.transcript },
                 media_data: { url: `${MEDIA_ORIGIN}/note-${this.who.waUserId}-${this.seq}.ogg`, content_type: "audio/ogg", byte_size: Math.round(a.seconds * 3000), duration: a.seconds },
                 media_url: `${MEDIA_ORIGIN}/note-${this.who.waUserId}-${this.seq}.ogg` } }];
      case "done": return [];
    }
  }

  private fail(out: Failure[], n: number, code: string, detail: string, once?: string) {
    if (once) { if (this.reported.has(once)) return; this.reported.add(once); }
    out.push({ code, detail: detail.slice(0, 300), turn: n, severity: HARD_SEVERITY[code] ?? 2 });
  }

  /** Sends one customer action, runs the turn as the Durable Object's alarm would, and checks what came back. */
  async act(action: Action, clock: string): Promise<TurnRecord> {
    const n = this.turns.length + 1;
    const mark = { kapso: this.guard.kapso.length, calls: this.meter.calls.length, texts: this.meter.modelTexts.length, refused: this.guard.refused.length };
    // HO1: "after a hand-off" is a case still open on the chat (0135), or the old lock (main before HO1). Either way a turn with
    // no reply after it is the silence this run measures.
    const afterHandoff = await this.handedOff();
    const afterOptOut = this.optedOut;
    const handoffsBefore = (await this.sql(`select id from handoffs where conversation_id = $1`, [this.conversationId])).length;
    const runsBefore = (await this.sql(`select id from agent_runs where conversation_id = $1`, [this.conversationId])).length;
    if (action.kind === "tap" && /^order:confirm:/.test(action.option.id)) this.tappedConfirm.add(action.option.id.split(":")[2]!);
    if (action.kind === "text") for (const x of numbersIn(action.text)) this.customerNumbers.add(x);
    if (action.kind === "texts") for (const t of action.texts) for (const x of numbersIn(t)) this.customerNumbers.add(x);
    if (action.kind === "voice") for (const x of numbersIn(action.transcript)) this.customerNumbers.add(x);

    const pending: Pending[] = [];
    for (const m of this.messagesFor(action)) {
      const p = { line: "customer" as const, who: this.who, event: this.event(m) as unknown as Pending["event"] };
      pending.push(p);
      await this.conv.fetch(new Request("https://do/inbound", { method: "POST", body: JSON.stringify(p) }));
    }
    const key = turnKeyOf(pending);
    this.turnKeys.push(key);
    const started = Date.now();
    let alarms = 0;
    for (let i = 0; i < 6; i++) {
      await this.conv.alarm(); alarms++;
      if (!this.store.has("inflight") && !(((this.store.get("pending") as unknown[]) ?? []).length)) break;
    }
    const seconds = (Date.now() - started) / 1000;
    const replies = this.guard.kapso.slice(mark.kapso).filter((k) => k.pnid === "PN_CUSTOMER" && norm(k.body?.to) === norm(this.who.phone)).map((k) => renderKapso(k.body));
    for (const r of replies) for (const o of r.options) {
      const ref = `b${this.options.size + 1}`;
      this.options.set(ref, { ...o, ref: r.kind === "list" ? "list" : "button" });
      o.key = ref;
    }
    const calls = this.meter.calls.slice(mark.calls).filter((c) => c.role === "concierge");
    const turnRow = (await this.sql<{ outcome: any; attempts: number }>(`select outcome, attempts from turns where turn_key = $1`, [key]))[0];
    const outcome = turnRow?.outcome?.outcome ?? null;
    const handoffs = (await this.sql<{ reason: string }>(`select reason from handoffs where conversation_id = $1 order by created_at`, [this.conversationId])).slice(handoffsBefore).map((h) => h.reason);
    const runs = await this.sql<{ path: string | null }>(`select trace->>'path' as path from agent_runs where conversation_id = $1 order by created_at`, [this.conversationId]);
    const path = runs.length > runsBefore ? runs[runs.length - 1]!.path : null;

    const failures: Failure[] = [];
    if (outcome === "opt_out") this.optedOut = true;
    if (action.kind !== "done") {
      if (afterOptOut) { if (replies.length) this.fail(failures, n, "sent_after_opt_out", `${replies.length} message(s) after STOP`); }
      else if (replies.length === 0) this.fail(failures, n, afterHandoff ? "silence_after_handoff" : "no_reply", `outcome ${outcome ?? "none"}`);
    }
    if (alarms > 1 || (turnRow?.attempts ?? 1) > 1 || handoffs.some((h) => /_error|^agent_error/.test(h)))
      this.fail(failures, n, "turn_error", `alarms ${alarms}; handoffs ${handoffs.join(", ") || "none"}`);
    for (const r of replies) {
      const wrong = wrongLanguage(this.scenario.lang, r.text);
      if (wrong) this.fail(failures, n, "wrong_language", `${this.scenario.lang} customer, reply read as ${wrong}: ${r.text.slice(0, 120)}`);
      const rules = ruleProblems(r);
      if (rules.length) this.fail(failures, n, "message_rules", `${rules.join("; ")} | ${r.text.slice(0, 100)}`);
      const card = cardOf(r);
      if (card) {
        const row = (await this.sql<{ total_usd: string }>(`select total_usd from orders where id = $1`, [card.orderId]))[0];
        const bad = row ? totalMismatch(card, Number(row.total_usd)) : "the card's order is not in the database";
        if (bad) this.fail(failures, n, "card_total_mismatch", bad);
      }
    }
    for (const mt of this.meter.modelTexts.slice(mark.texts)) {
      const head = mt.text.trim().slice(0, 40);
      if (!head || !replies.some((r) => r.text.includes(head))) continue;          // a draft the guard refused never reached the customer
      const allowed = new Set([...mt.amounts_in_context, ...this.customerNumbers]);
      const invented = amountsIn(mt.text).filter((a) => !allowed.has(a));
      if (invented.length) this.fail(failures, n, "invented_price", `${invented.join(", ")} in: ${mt.text.slice(0, 160)}`);
      mt.amounts_in_context = [];          // kept only for this check
    }
    const confirmed = await this.sql<{ id: string; status: string }>(`select id, status from orders where customer_id = $1
        and status not in ('draft', 'awaiting_confirmation', 'cancelled')`, [this.partyId]);
    for (const o of confirmed) {
      if (this.historyOrders.includes(o.id) || this.tappedConfirm.has(o.id)) continue;
      this.fail(failures, n, "confirmed_without_tap", `order ${o.id} is ${o.status} with no confirm tap`, `cwt:${o.id}`);
    }
    // during_picking: the hub starts picking the order the moment it is confirmed (as a picker would), so the cancel comes after.
    if (this.scenario.variant === "during_picking") {
      for (const o of confirmed.filter((x) => x.status === "confirmed" && !this.historyOrders.includes(x.id))) {
        try { await this.world.db.rpc("transition_order", { p_order: o.id, p_to: "preparing", p_actor: "picker", p_reason: "sim: picking started" }); }
        catch (e) { this.fail(failures, n, "harness_note", `could not start picking: ${String(e).slice(0, 120)}`, `pick:${o.id}`); }
      }
    }
    const rec: TurnRecord = { n, clock, action, replies, seconds, modelCalls: calls.length, usd: calls.reduce((s, c) => s + c.usd, 0), outcome, path, handoffs,
                              afterHandoff, afterOptOut, failures, guardRefusals: this.guard.refused.length - mark.refused };
    this.turns.push(rec);
    return rec;
  }

  async handedOff(): Promise<boolean> {
    const r = (await this.sql<{ locked: boolean; open: boolean }>(`select coalesce(c.human_handoff, false) as locked,
        exists (select 1 from handoffs h where h.conversation_id = c.id and h.status <> 'resolved') as open
      from conversations c where c.id = $1`, [this.conversationId]))[0];
    return !!(r?.locked || r?.open);
  }

  /** Facts for the judge and the report: orders now, the hand-offs and the ops exceptions this conversation raised. */
  async facts(): Promise<{ orders: { short_code: string; status: string; total_usd: number; items: string[] }[]; handoffs: string[]; exceptions: Record<string, number>; humanHandoff: boolean }> {
    const orders = await this.sql<any>(`select o.id, o.short_code, o.status, o.total_usd,
        coalesce((select json_agg(i.qty::float || ' x ' || i.name_snapshot order by i.name_snapshot) from order_items i where i.order_id = o.id and i.status <> 'removed'), '[]') as items
      from orders o where o.customer_id = $1 order by o.created_at`, [this.partyId]);
    const handoffs = (await this.sql<{ reason: string }>(`select reason from handoffs where conversation_id = $1 order by created_at`, [this.conversationId])).map((h) => h.reason);
    const ex = await this.sql<{ kind: string; n: number }>(`select kind, count(*)::int as n from ops_exceptions
        where detail->>'conversation_id' = $1 or ref = any($2::text[]) or ref like $3 group by kind`, [this.conversationId, `{${this.turnKeys.map((k) => `"${k}"`).join(",")}}`, `${this.partyId}%`]);
    const conv = (await this.sql<{ human_handoff: boolean }>(`select human_handoff from conversations where id = $1`, [this.conversationId]))[0];
    return { orders: orders.filter((o) => !this.historyOrders.includes(o.id)).map((o) => ({ short_code: o.short_code, status: o.status, total_usd: Number(o.total_usd), items: o.items })),
             handoffs, exceptions: Object.fromEntries(ex.map((e) => [e.kind, e.n])), humanHandoff: !!conv?.human_handoff };
  }
}
