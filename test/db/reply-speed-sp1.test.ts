// SP1 (reply speed): the burst buffer, the one round trip before the model, reply keys by content, a retried turn's card.
// Each case here was written before the change it tests, and failed on the code before it.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ConversationDO, type Env } from "../../apps/gateway/src/index";
import { processTurn, type Pending, type TurnDeps } from "../../apps/gateway/src/turn";
import { send as gatewaySend } from "@ak/wa/gateway";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

let db: TestDb;
let BAAKLINE: string, LABNEH: string, BREAD: string;

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500);
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 500;`);
  BAAKLINE = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  await db.one(`update sources set village_id = $1 where kind = 'dark_store' returning id`, [BAAKLINE]);
  LABNEH = (await db.one(`select id from products where name_en = 'Liban Lait Labneh Baladieh 900G'`)).id;
  BREAD = (await db.one(`select id from products where name_en = 'Wooden Bakery Pita White Bread Big 800G'`)).id;
}, 120_000);

let toolSeq = 0;
const use = (name: string, input: unknown): Anthropic.ToolUseBlock => ({ type: "tool_use", id: `tu_${++toolSeq}`, name, input } as Anthropic.ToolUseBlock);
const read = (intent: Record<string, unknown>) => [use("extract_order", { intent: { language: "ar_lb", ...intent } })];

/** A scripted model. `onCall` sees the database calls made before each model call. */
function scriptedModel(steps: Anthropic.ToolUseBlock[][], onCall?: () => void) {
  const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const model = { messages: { create: async (body: Anthropic.MessageCreateParamsNonStreaming) => {
    onCall?.();
    seen.push(structuredClone(body));
    const content = steps[seen.length - 1] ?? [];
    return { id: "msg", type: "message", role: "assistant", model: "test", content, stop_reason: content.length ? "tool_use" : "end_turn",
             stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 0 } } as unknown as Anthropic.Message;
  } } };
  return { model, seen };
}

function fakeState() {
  const store = new Map<string, unknown>(); let alarmAt: number | null = null;
  const storage = { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
    delete: async (k: string) => store.delete(k), setAlarm: async (t: number) => void (alarmAt = t), getAlarm: async () => alarmAt,
    deleteAlarm: async () => void (alarmAt = null) };
  return { state: { storage } as unknown as DurableObjectState, store, alarm: () => alarmAt };
}

/** Every database call the turn makes, in order: rpc by name, table calls as "from:<table>". */
function countingDb() {
  const shim = supabaseOver(db);
  const calls: string[] = [];
  const client = new Proxy(shim.client, { get(target, prop) {
    if (prop === "rpc") return (fn: string, args: Record<string, unknown>) => { calls.push(fn); return target.rpc(fn, args); };
    if (prop === "from") return (table: string) => { calls.push(`from:${table}`); return target.from(table); };
    return (target as unknown as Record<string | symbol, unknown>)[prop];
  } });
  return { client, calls };
}

let customerSeq = 0;
function setup(steps: Anthropic.ToolUseBlock[][] = []) {
  const n = ++customerSeq;
  const who = { waUserId: `bsuid-sp1-${n}`, phone: `+9617100${String(n).padStart(4, "0")}` };
  const d = countingDb();
  let beforeModel: string[][] = [];
  const m = scriptedModel(steps, () => { beforeModel.push(d.calls.splice(0)); });
  const s = fakeState();
  const env = { BUFFER_SECONDS: "6", MODEL_FAST: "fast", KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k",
                PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS", TEST_DEPS: { db: d.client, model: m.model } } as unknown as Env;
  let mid = 0;
  const inbound = (message: Record<string, unknown>) => new Request("https://do/inbound", { method: "POST", body: JSON.stringify({
    line: "customer", who,
    event: { message: { id: `wamid.sp1.${n}.${++mid}`, timestamp: "1794390000", kapso: { direction: "inbound", origin: "cloud_api" }, ...message },
             conversation: { id: `conv_${n}`, contact_name: "Test" }, phone_number_id: "PN_CUSTOMER" } }) });
  const conv = new ConversationDO(s.state, env);
  return { ...m, ...s, conv, who, calls: d.calls, beforeModel: () => beforeModel, resetCalls: () => { d.calls.splice(0); beforeModel = []; },
           inbound, text: (body: string) => inbound({ type: "text", text: { body } }),
           audio: () => inbound({ type: "audio", audio: { id: "m1" }, kapso: { direction: "inbound", origin: "cloud_api", media_data: { url: "u", byte_size: 12000 } } }),
           tap: (id: string, title = "x") => inbound({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } }) };
}

let outbound: { url: string; body: any }[];
let clock = 1_800_000_000_000;
beforeEach(() => {
  outbound = []; toolSeq = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    outbound.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.out${Math.random()}` }] }), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
/** The conversation object's clock. Each step moves it forward; the alarm must not be due before the next message arrives. */
function useClock() {
  clock += 3_600_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  return { at: () => clock, advance: (ms: number) => { clock += ms; } };
}

const ORDER = { intent: "order", fulfilment: "delivery",
  lines: [{ raw: "علبة لبنة ليبان ليه", query: "لبنة ليبان ليه", qty: 1, confidence: 0.9 }], address: {} };

describe("the burst buffer is adaptive (settings.burst)", () => {
  it("is a setting: quiet_ms 1200, max_ms 4000, media_ms 6000", async () => {
    expect(await db.one(`select value from settings where key = 'burst'`)).toEqual({ value: { quiet_ms: 1200, max_ms: 4000, media_ms: 6000 } });
  });

  it("one complete text starts its turn within 1.5 s", async () => {
    const c = useClock(); const t = setup();
    const start = c.at();
    await t.conv.fetch(t.text("بدي علبة لبنة ليبان ليه"));
    expect(t.alarm()! - start).toBeGreaterThanOrEqual(1000);
    expect(t.alarm()! - start).toBeLessThanOrEqual(1500);
  });

  it("three texts sent one second apart are read as one turn", async () => {
    const c = useClock(); const t = setup([read(ORDER)]);
    await t.conv.fetch(t.text("مرحبا"));
    c.advance(1000); expect(t.alarm()!).toBeGreaterThan(c.at());          // not due yet when the second arrives
    await t.conv.fetch(t.text("بدي علبة لبنة ليبان ليه"));
    c.advance(1000); expect(t.alarm()!).toBeGreaterThan(c.at());
    await t.conv.fetch(t.text("عبعقلين"));
    expect(t.seen).toHaveLength(0);
    c.advance(t.alarm()! - c.at());
    await t.conv.alarm();
    const readings = t.seen.filter((b) => (b.tool_choice as { name?: string } | undefined)?.name === "extract_order");
    expect(readings).toHaveLength(1);                                       // one turn: read once
    expect(JSON.parse(t.seen[0]!.messages[0]!.content as string).texts).toEqual(["مرحبا", "بدي علبة لبنة ليبان ليه", "عبعقلين"]);
  });

  it("a long burst waits at most max_ms from its first message", async () => {
    const c = useClock(); const t = setup();
    const start = c.at();
    for (let i = 0; i < 4; i++) { await t.conv.fetch(t.text(`${i}`)); c.advance(1000); }
    expect(t.alarm()! - start).toBeLessThanOrEqual(4000);
  });

  it("a burst starts again after its turn: the next message waits from its own arrival", async () => {
    const c = useClock(); const t = setup([read(ORDER), read(ORDER)]);
    await t.conv.fetch(t.text("بدي علبة لبنة ليبان ليه"));
    c.advance(t.alarm()! - c.at()); await t.conv.alarm();
    c.advance(10_000);
    const second = c.at();
    await t.conv.fetch(t.text("كمان وحدة"));
    expect(t.alarm()! - second).toBeGreaterThanOrEqual(1000);
  });

  it("a voice note keeps the longer wait; a button is instant", async () => {
    const c = useClock(); const t = setup();
    const start = c.at();
    await t.conv.fetch(t.audio());
    expect(t.alarm()! - start).toBeGreaterThanOrEqual(5900);
    const u = setup();
    const tapAt = c.at();
    await u.conv.fetch(u.tap("marketing:no"));
    expect(u.alarm()! - tapAt).toBeLessThan(100);
  });
});

describe("one database round trip before the model (open_turn)", () => {
  it("a typed order reaches the model after exactly one database call", async () => {
    const c = useClock(); const t = setup([read(ORDER)]);
    await t.conv.fetch(t.text("بدي علبة لبنة ليبان ليه"));
    t.resetCalls();                                                         // the buffer's setting read is not part of the turn
    c.advance(t.alarm()! - c.at()); await t.conv.alarm();
    expect(t.seen.length).toBeGreaterThanOrEqual(1);
    expect(t.beforeModel()[0]).toEqual(["open_turn"]);
  });

  it("does what the four calls did: the turn, the conversation, the first contact, the messages", async () => {
    const r = await db.rpc("open_turn", { p_key: "customer:wamid.ot1", p_line: "customer", p_wa_user_id: "bsuid-ot1", p_phone: "+96171990001",
      p_name: "Open", p_messages: [{ wa_message_id: "wamid.ot1", type: "text", body: "AK QR77 بدي خبز", body_text: "AK QR77 بدي خبز", transcript: null, referral: null }] });
    expect(r).toMatchObject({ turn: "run", known: true, blocked: false, human_handoff: false, budget: { allowed: true, used: 0 } });
    expect(r.customer_context).toMatchObject({ name: "Open", orders: 0 });
    expect(await db.one(`select status, attempts from turns where turn_key = 'customer:wamid.ot1'`)).toMatchObject({ status: "running" });
    expect(await db.one(`select last_inbound_at is not null as touched from conversations where id = $1`, [r.conversation_id])).toEqual({ touched: true });
    expect((await db.one(`select first_contact from parties where id = $1`, [r.party_id])).first_contact).toMatchObject({ source: "organic", wa_message_id: "wamid.ot1" });
    expect(await db.one(`select body, direction, status from wa_messages where wa_message_id = 'wamid.ot1'`)).toEqual({ body: "AK QR77 بدي خبز", direction: "inbound", status: "received" });

    // A retry of the same turn: begin_turn says retry, the stored message is not stored twice, and nothing fails.
    const again = await db.rpc("open_turn", { p_key: "customer:wamid.ot1", p_line: "customer", p_wa_user_id: "bsuid-ot1", p_phone: "+96171990001",
      p_name: "Open", p_messages: [{ wa_message_id: "wamid.ot1", type: "text", body: "AK QR77 بدي خبز", body_text: "AK QR77 بدي خبز" }] });
    expect(again).toMatchObject({ turn: "retry", party_id: r.party_id });
    expect(await db.one(`select count(*)::int as n from wa_messages where wa_message_id = 'wamid.ot1'`)).toEqual({ n: 1 });

    await db.rpc("finish_turn", { p_key: "customer:wamid.ot1", p_outcome: { outcome: "answered" } });
    expect(await db.rpc("open_turn", { p_key: "customer:wamid.ot1", p_line: "customer", p_wa_user_id: "bsuid-ot1", p_phone: null, p_name: null, p_messages: [] }))
      .toEqual({ turn: "done" });
  });

  it("a blocked customer: nothing is stored, as before", async () => {
    const first = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "bsuid-ot2", p_phone: "+96171990002", p_name: "B" });
    await db.pg.query(`update parties set is_blocked = true where id = $1`, [first.party_id]);
    const r = await db.rpc("open_turn", { p_key: "customer:wamid.ot2", p_line: "customer", p_wa_user_id: "bsuid-ot2", p_phone: null, p_name: null,
      p_messages: [{ wa_message_id: "wamid.ot2", type: "text", body: "x", body_text: "x" }] });
    expect(r).toMatchObject({ turn: "run", blocked: true });
    expect(await db.one(`select count(*)::int as n from wa_messages where wa_message_id = 'wamid.ot2'`)).toEqual({ n: 0 });
  });

  it("a stranger on the ops line is not created", async () => {
    expect(await db.rpc("open_turn", { p_key: "ops:wamid.ot3", p_line: "ops", p_wa_user_id: "bsuid-ot3", p_phone: null, p_name: null, p_messages: [] }))
      .toEqual({ known: false, turn: "run" });
  });
});

describe("a retried turn (G1-19, G1-21)", () => {
  /** The turn code as index.ts wires it, with the real gateway and outbox. Calling it twice with one key is a crash and a retry. */
  function direct(steps: Anthropic.ToolUseBlock[][]) {
    const t = setup(steps);
    const shim = supabaseOver(db);
    const env = { KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS" };
    const deps: TurnDeps = { db: shim.client, model: t.model, modelName: "fast", send: (req) => gatewaySend(shim.client, env, req),
                             turnKey: `customer:retry-${t.who.waUserId}` };
    const pending: Pending[] = [{ line: "customer", who: t.who, event: { phone_number_id: "PN_CUSTOMER", conversation: { id: "c", contact_name: "Test" },
      message: { id: `wamid.retry.${t.who.waUserId}`, timestamp: "0", type: "text", text: { body: "بدي علبة لبنة ليبان ليه" },
                 kapso: { direction: "inbound", origin: "cloud_api" } } } as any }];
    const customer = async () => db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: t.who.waUserId, p_phone: t.who.phone, p_name: "Test" });
    return { ...t, deps, pending, customer };
  }

  it("G1-19: a retry whose model chooses another first message still sends it (keys are by content, not position)", async () => {
    const unclear = read({ intent: "order", fulfilment: "pickup", lines: [{ raw: "شي غريب", query: "zzqx غرض مش موجود", qty: 1, confidence: 0.4 }], address: {} });
    const t = direct([
      unclear, [use("reply", { text: "شو قصدك بالغرض؟" })],                                            // attempt 1: a question
      unclear, [use("quote_order", { lines: [{ product_id: LABNEH, qty: 1 }], pickup: true })], [use("send_confirmation", {})],   // attempt 2: a card
    ]);
    await processTurn(t.deps, t.pending, {});
    expect(outbound.map((o) => o.body.type)).toEqual(["text"]);
    await processTurn(t.deps, t.pending, {});                               // the worker died before finish_turn: the turn runs again
    expect(outbound.map((o) => o.body.type)).toEqual(["text", "interactive"]);   // before SP1 the card took the question's key and was dropped
  });

  // Above the minimum order: two labneh and two bread, as concierge-flow's order.
  const HERE = { intent: "order", fulfilment: "delivery", address: { village: "بعقلين", building: "بناية النسيم", floor: "3" },
    lines: [{ raw: "علبتين لبنة ليبان ليه", query: "لبنة ليبان ليه", qty: 2, confidence: 0.9 }, { raw: "ربطتين خبز", query: "خبز", qty: 2, unit: "bundle", confidence: 0.9 }] };
  it("G1-21: a retried turn reuses its draft order and card: one order, one card, nothing cancelled", async () => {
    const t = direct([read(HERE), read(HERE)]);
    const c = await t.customer();
    await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: 33.68, p_lng: 35.56, p_village: BAAKLINE });
    await db.pg.query(`update customer_places set building = 'B', floor = '1' where party_id = $1`, [c.party_id]);
    const r1 = await processTurn(t.deps, t.pending, {});
    expect(r1.outcome).toBe("card");
    const r2 = await processTurn(t.deps, t.pending, {});
    expect(r2.outcome).toBe("card");
    const orders = await db.all<{ status: string }>(`select status from orders where customer_id = $1 order by created_at`, [c.party_id]);
    expect(orders.map((o) => o.status)).toEqual(["awaiting_confirmation"]);
    expect(outbound.filter((o) => o.body.type === "interactive")).toHaveLength(1);
  });

  it("G1-21: a card for a different basket is still a new order (the old one is withdrawn, as before)", async () => {
    const two = { ...HERE, lines: [{ ...HERE.lines[0]!, raw: "تلات علب لبنة ليبان ليه", qty: 3 }, HERE.lines[1]!] };
    const t = direct([read(HERE), read(two)]);
    const c = await t.customer();
    await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: 33.68, p_lng: 35.56, p_village: BAAKLINE });
    await db.pg.query(`update customer_places set building = 'B', floor = '1' where party_id = $1`, [c.party_id]);
    await processTurn(t.deps, t.pending, {});
    await processTurn(t.deps, t.pending, {});
    const orders = await db.all<{ status: string }>(`select status from orders where customer_id = $1 order by created_at`, [c.party_id]);
    expect(orders.map((o) => o.status)).toEqual(["cancelled", "awaiting_confirmation"]);
    expect(outbound.filter((o) => o.body.type === "interactive")).toHaveLength(2);
  });
});

describe("the ask path: what needs no second model call (SP1)", () => {
  function direct(steps: Anthropic.ToolUseBlock[][], text: string) {
    const t = setup(steps);
    const shim = supabaseOver(db);
    const env = { KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS" };
    const deps: TurnDeps = { db: shim.client, model: t.model, modelName: "fast", send: (req) => gatewaySend(shim.client, env, req), turnKey: `customer:ask-${t.who.waUserId}` };
    const pending: Pending[] = [{ line: "customer", who: t.who, event: { phone_number_id: "PN_CUSTOMER", conversation: { id: "c", contact_name: "Test" },
      message: { id: `wamid.ask.${t.who.waUserId}`, timestamp: "0", type: "text", text: { body: text }, kapso: { direction: "inbound", origin: "cloud_api" } } } as any }];
    return { ...t, deps, pending };
  }

  it("14 Nov, «مشيلي الطلب» with the basket kept overnight: the card goes out by code after the one reading (it went to a person)", async () => {
    const t = direct([read({ intent: "order", fulfilment: "unknown", lines: [], address: {} })], "مشيلي الطلب");
    const lines = [{ product_id: LABNEH, qty: 2 }, { product_id: BREAD, qty: 2 }];
    const quote = await db.rpc("quote_order", { p_lines: lines, p_village: null, p_pickup: true });
    const state = { awaiting: "opening" as const, lastQuote: { lines, villageId: null, pickup: true, quote }, pending: { payment: "cod" as const, changeForUsd: null, notes: null } };
    const r = await processTurn(t.deps, t.pending, state);
    expect(t.seen).toHaveLength(1);                                         // the reading only
    expect(r.outcome).toBe("answered");                                     // by code; not a handoff
    expect(outbound.map((o) => o.body.interactive?.type)).toEqual(["button"]);   // the card
    const runs = await db.all(`select r.trace->>'path' as path from agent_runs r join conversations c on c.id = r.conversation_id
                                 join party_identities i on i.party_id = c.party_id where i.wa_user_id = $1`, [t.who.waUserId]);
    expect(runs).toEqual([{ path: "kept_go_ahead" }]);
  });

  it("the same words with nothing waiting still go to the Concierge", async () => {
    const t = direct([read({ intent: "order", fulfilment: "unknown", lines: [], address: {} }), [use("reply", { text: "شو بدك تطلب؟" })]], "مشيلي الطلب");
    await processTurn(t.deps, t.pending, {});
    expect(t.seen).toHaveLength(2);
  });
});

describe("what a turn's model calls cost and take (SP1)", () => {
  it("the reading runs at effort low; each call's time and cached tokens are in agent_runs.trace", async () => {
    const c = useClock(); const t = setup([read({ intent: "off_topic", lines: [], address: {} })]);
    await t.conv.fetch(t.text("شو رأيك بالطقس؟"));
    c.advance(t.alarm()! - c.at()); await t.conv.alarm();
    expect(t.seen[0]!.output_config).toEqual({ effort: "low" });
    const runs = await db.all(`select r.trace from agent_runs r join conversations cv on cv.id = r.conversation_id
                                 join party_identities i on i.party_id = cv.party_id where i.wa_user_id = $1`, [t.who.waUserId]);
    expect(runs).toHaveLength(1);
    expect(runs[0].trace).toMatchObject({ path: "off_topic", cache_read_input_tokens: 40, cache_creation_input_tokens: 0,
      calls: [{ kind: "reading", input: 100, output: 20, cache_read: 40, cache_write: 0 }] });
    expect(typeof runs[0].trace.calls[0].ms).toBe("number");
  });

  it("agent_run_costs prices cached input at the cache price, and agent_call_timings lists each call", async () => {
    const conv = (await db.one(`select id from conversations limit 1`)).id;
    const run = (await db.one(`insert into agent_runs(agent, conversation_id, model, input_tokens, output_tokens, latency_ms, outcome, created_at, trace)
      values ('concierge', $1, 'claude-haiku-5-5', 10000, 0, 4000, 'ok', '2026-11-15T08:00:00Z',
              '{"path":"card","cache_read_input_tokens":10000,"cache_creation_input_tokens":10000,
                "calls":[{"kind":"reading","ms":2500,"input":10000,"output":0,"cache_read":10000,"cache_write":10000}]}') returning id`, [conv])).id;
    const cost = await db.one(`select usd::text, cache_read_tokens, cache_write_tokens from agent_run_costs where run_id = $1`, [run]);
    // Haiku 5.5, per million: 10K uncached at 0.10, 10K cache reads at 0.01, 10K cache writes at 0.125 (model_prices, 0102)
    expect(Number(cost.usd)).toBeCloseTo(0.00235, 10);
    expect(cost).toMatchObject({ cache_read_tokens: 10000, cache_write_tokens: 10000 });
    expect(await db.all(`select kind, ms, cache_read from agent_call_timings where run_id = $1`, [run])).toEqual([{ kind: "reading", ms: 2500, cache_read: 10000 }]);
  });
});
