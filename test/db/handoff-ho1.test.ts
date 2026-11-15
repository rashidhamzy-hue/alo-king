// HO1: the never-stranded hand-off (docs/strategy/05-console-website-design-handoff.md section D, "Done when").
// On the real schema: the turn code, the tools, the gateway and the SQL functions of 0135-0137, with the model scripted step
// by step and Kapso a recorder. A person is added to a conversation; the bot is never removed from it. A technical failure is
// not a hand-off. Invented names and numbers only.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RetryTurnLater, runTurn, type Pending, type TurnDeps } from "../../apps/gateway/src/turn";
import { caseTimers, ConversationDO, unansweredAlarm, type Env } from "../../apps/gateway/src/index";
import { send as gatewaySend } from "@ak/wa/gateway";
import { ar, en, fr } from "@ak/agents/messages";
import { orderButtonId } from "@ak/agents/order-card";
import { CASE_KEEP, MENU_PERSON, callbackButtonId, retryButtonId } from "@ak/agents/support";
import type { ConversationState } from "@ak/agents/concierge-tools";
import { openTestDb, type TestDb } from "./harness";
import { expectBooksBalanced, openHub, placeOrder } from "./hub-kit";
import { supabaseOver } from "./supabase-shim";

let db: TestDb;
let OPS: string;
const OPEN_ALL_DAY = `update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours'`;

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500); ${OPEN_ALL_DAY}; update stock_levels set on_hand = 500;`);
  const baakline = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  await db.one(`update sources set village_id = $1 where kind = 'dark_store' returning id`, [baakline]);
  OPS = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops Test') returning id`)).id;
}, 120_000);

type Step = { stop?: "tool_use" | "end_turn"; tools?: [string, unknown][]; throws?: unknown };
let toolSeq = 0;
function scriptedModel(steps: Step[]) {
  const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const model = { messages: { create: async (body: Anthropic.MessageCreateParamsNonStreaming) => {
    seen.push(structuredClone(body));
    const s = steps[seen.length - 1] ?? { stop: "end_turn" };
    if (s.throws) throw s.throws;
    const content = (s.tools ?? []).map(([name, input]) => ({ type: "tool_use", id: `tu_${++toolSeq}`, name, input }));
    return { id: "msg", type: "message", role: "assistant", model: "test", content, stop_reason: content.length ? "tool_use" : "end_turn",
             stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } } as unknown as Anthropic.Message;
  } } };
  return { model, seen };
}
const reading = (intent: Record<string, unknown>, language = "ar_lb"): Step => ({ tools: [["extract_order", { intent: { language, lines: [], ...intent } }]] });
const reply = (text: string): Step => ({ tools: [["reply", { text }]] });
const overloaded = () => Object.assign(new Error("Overloaded"), { status: 529, name: "OverloadedError" });
const badRequest = () => Object.assign(new Error("bad"), { status: 400, name: "BadRequestError" });

let n = 0;
/** One customer, the turn code wired as index.ts wires it (retry waits shortened), and a conversation state that persists. */
function customer(steps: Step[]) {
  const k = ++n;
  const who = { waUserId: `bsuid-ho1-${k}`, phone: `+9617300${String(k).padStart(4, "0")}` };
  const shim = supabaseOver(db), m = scriptedModel(steps);
  const env = { KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS" };
  const deps: TurnDeps = { db: shim.client, model: m.model, modelName: "fast", send: (req) => gatewaySend(shim.client, env, req),
                           capacity: { backoffMs: [1, 1, 1], sleep: async () => undefined } };
  const state: ConversationState = {};
  const event = (message: Record<string, unknown>): Pending[] => [{ line: "customer", who, event: { phone_number_id: "PN_CUSTOMER",
    conversation: { id: `c${k}`, contact_name: "Test" },
    message: { id: `wamid.ho1.${k}.${Math.random()}`, timestamp: "0", kapso: { direction: "inbound", origin: "cloud_api" }, ...message } } as any }];
  const text = (body: string) => event({ type: "text", text: { body } });
  const tap = (id: string, title = "x") => event({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
  const conv = async () => db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: who.waUserId, p_phone: who.phone, p_name: "Test" });
  return { ...m, deps, state, who, text, tap, conv, turn: (p: Pending[]) => runTurn(deps, p, state) };
}

let outbound: { url: string; body: any }[];
beforeEach(() => {
  outbound = []; toolSeq = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    outbound.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.out${Math.random()}` }] }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const bodyOf = (b: any): string => b.text?.body ?? b.interactive?.body?.text ?? "";
const bodies = () => outbound.map((o) => bodyOf(o.body));
const buttonsOf = (b: any): string[] => (b.interactive?.action?.buttons ?? []).map((x: any) => x.reply.id);
async function cases(convId: string) {
  return db.all(`select kind, state, topic, source, after_hours from handoffs where conversation_id = $1 order by created_at`, [convId]);
}
const locked = async (convId: string) => (await db.one(`select human_handoff, bot_paused_until from conversations where id = $1`, [convId]));

describe("a technical failure is not a hand-off: the chat answers the next message", () => {
  it("a forced model error: queued again once a minute later; the second failure gets the fixed line with Browse and a person; the next message is answered", async () => {
    const t = customer([{ throws: badRequest() }, { throws: badRequest() }, reading({ intent: "question" }), reply("اللبنة موجودة.")]);
    const first = t.text("بدي لبنة");
    const err = await t.turn(first).catch((e) => e);
    expect(err).toBeInstanceOf(RetryTurnLater);
    expect((err as RetryTurnLater).ms).toBe(60_000);
    expect(outbound).toHaveLength(0);                                   // nothing sent yet: the turn runs again in a minute
    const r = await t.turn(first);                                       // the retry (the Durable Object's alarm, a minute later)
    expect(r.outcome).toBe("technical");
    expect(bodies()).toEqual([ar.support.technical]);
    expect(buttonsOf(outbound[0]!.body)).toEqual(["menu:browse", "menu:person"]);
    const c = await t.conv();
    expect(await cases(c.conversation_id)).toEqual([]);                  // no case: a failure is ours, not a request
    expect(await locked(c.conversation_id)).toEqual({ human_handoff: false, bot_paused_until: null });
    expect(await db.all(`select detail->>'where' as w from ops_exceptions where kind = 'technical' and detail->>'conversation_id' = $1`, [c.conversation_id])).toEqual([{ w: "agent_error" }]);
    const next = await t.turn(t.text("عندكن لبنة؟"));
    expect(next.outcome).toBe("agent_ok");
    expect(bodies().at(-1)).toBe("اللبنة موجودة.");
  });

  it("a capacity error through every retry: 'one moment' once, queued again, then the fixed line; the next message is answered", async () => {
    const t = customer([...Array(4).fill({ throws: overloaded() }), ...Array(4).fill({ throws: overloaded() }), reading({ intent: "question" }), reply("Yes, we have it.")]);
    const first = t.text("do you have labneh?");
    await expect(t.turn(first)).rejects.toBeInstanceOf(RetryTurnLater);
    const r = await t.turn(first);
    expect(r.outcome).toBe("technical");
    expect(bodies()).toEqual([en.fixed.oneMoment, en.support.technical]);   // "one moment" is keyed on the turn: said once
    const c = await t.conv();
    expect(await db.all(`select detail->>'where' as w from ops_exceptions where kind = 'technical' and detail->>'conversation_id' = $1`, [c.conversation_id])).toEqual([{ w: "model_capacity" }]);
    expect((await t.turn(t.text("do you have labneh?"))).outcome).toBe("agent_ok");
    expect(bodies().at(-1)).toBe("Yes, we have it.");
  });

  it("the Durable Object queues the turn again a minute later, and does not count it as a give-up", async () => {
    const k = ++n;
    const who = { waUserId: `bsuid-ho1-do-${k}`, phone: `+9617399${String(k).padStart(4, "0")}` };
    const shim = supabaseOver(db), m = scriptedModel([{ throws: badRequest() }, reading({ intent: "question" }), reply("تفضّل.")]);
    const store = new Map<string, unknown>(); let alarmAt: number | null = null;
    const storage = { get: async (x: string) => store.get(x), put: async (x: string, v: unknown) => void store.set(x, structuredClone(v)),
      delete: async (x: string) => store.delete(x), setAlarm: async (at: number) => void (alarmAt = at) };
    const env = { BUFFER_SECONDS: "6", MODEL_FAST: "fast", KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k",
                  PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS", TEST_DEPS: { db: shim.client, model: m.model } } as unknown as Env;
    const conv = new ConversationDO({ storage } as unknown as DurableObjectState, env);
    await conv.fetch(new Request("https://do/inbound", { method: "POST", body: JSON.stringify({ line: "customer", who, event: {
      message: { id: `wamid.do.${k}`, timestamp: "0", kapso: { direction: "inbound", origin: "cloud_api" }, type: "text", text: { body: "مرحبا" } },
      conversation: { id: "c", contact_name: "Test" }, phone_number_id: "PN_CUSTOMER" } }) }));
    const before = Date.now();
    await conv.alarm();
    expect(alarmAt! - before).toBeGreaterThanOrEqual(59_000);           // a minute, not the 2-second crash retry
    expect(store.get("inflight")).toBeTruthy();
    expect(outbound).toHaveLength(0);
    await conv.alarm();
    expect(store.get("inflight")).toBeUndefined();
    expect(bodies()).toEqual(["تفضّل."]);                                 // the second try worked: the customer got the answer
  });

  it("the hourly model cap: no model call, a fixed menu (browse, my order, a person), an ops exception; never a lock", async () => {
    const t = customer([]);
    const c = await t.conv();
    await db.pg.query(`update settings set value = jsonb_set(value, '{per_customer_per_hour}', '0') where key = 'model_turns'`);
    try {
      const r = await t.turn(t.text("بدي لبنة"));
      expect(r.outcome).toBe("menu");
      expect(t.seen).toHaveLength(0);
      expect(bodies()).toEqual([ar.support.capMenu]);
      expect(buttonsOf(outbound[0]!.body)).toEqual(["menu:browse", "menu:order", "menu:person"]);
      expect(await locked(c.conversation_id)).toEqual({ human_handoff: false, bot_paused_until: null });
      expect(await cases(c.conversation_id)).toEqual([]);
      expect(await db.all(`select 1 from ops_exceptions where kind = 'model_turn_cap' and ref like $1`, [`${c.party_id}:%`])).toHaveLength(1);
      expect((await t.turn(t.text("وين طلبي؟"))).outcome).toBe("answered");   // the next message is answered (by code)
    } finally {
      await db.pg.query(`update settings set value = jsonb_set(value, '{per_customer_per_hour}', '20') where key = 'model_turns'`);
    }
  });

  it("a button error: the error line with a retry button and an ops exception; the retry repeats the tap; the chat keeps answering", async () => {
    const t = customer([reading({ intent: "question" }), reply("تفضّل، شو بتحب؟")]);
    const c = await t.conv();
    const ghost = "33333333-3333-4333-8333-333333333333";                  // an order that does not exist: the handler throws
    const tapId = orderButtonId("cancel", ghost);
    const r = await t.turn(t.tap(tapId));
    expect(r.outcome).toBe("buttons");
    expect(bodies()).toEqual([ar.support.buttonError]);
    expect(buttonsOf(outbound[0]!.body)).toEqual([retryButtonId(tapId)]);
    expect(await db.all(`select detail->>'where' as w from ops_exceptions where kind = 'technical' and detail->>'conversation_id' = $1`, [c.conversation_id])).toEqual([{ w: "button" }]);
    expect(await cases(c.conversation_id)).toEqual([]);
    await t.turn(t.tap(retryButtonId(tapId)));                           // the retry runs the same handler again
    expect(bodies()).toEqual([ar.support.buttonError, ar.support.buttonError]);
    expect((await t.turn(t.text("شو عندكن؟"))).outcome).toBe("agent_ok");
    expect(bodies().at(-1)).toBe("تفضّل، شو بتحب؟");
  });
});

describe("'I want a person', recognised by code before any model, opens a case; the bot keeps answering", () => {
  it.each([
    ["بدي احكي مع حدا", ar],
    ["baddi e7ki ma3 7ada", ar],
    ["I want to talk to a real person please", en],
    ["Je voudrais parler à une personne", fr],
  ] as const)("%s", async (said, L) => {
    const t = customer([reading({ intent: "question", lines: [{ raw: "لبنة", query: "لبنة", qty: 1, confidence: 0.9 }] }),
                        { tools: [["reply", { text: "Labneh 900G:", price_of: [] }]] }]);
    const r = await t.turn(t.text(said));
    expect(r.outcome).toBe("case");
    expect(t.seen).toHaveLength(0);                                      // no model call
    const c = await t.conv();
    const opened = (await cases(c.conversation_id))[0];
    expect(opened).toMatchObject({ kind: "person_requested", state: "open", source: "customer_words", after_hours: false });
    expect(bodies()).toEqual([L.support.opened]);
    const caseId = (await db.one(`select id from handoffs where conversation_id = $1`, [c.conversation_id])).id;
    expect(buttonsOf(outbound[0]!.body)).toEqual([callbackButtonId(caseId)]);
    expect(await locked(c.conversation_id)).toEqual({ human_handoff: false, bot_paused_until: null });
    // ops is alerted: the case's exception (the staff line within a minute, a push)
    expect(await db.all(`select kind from ops_exceptions where ref = $1`, [caseId])).toEqual([{ kind: "support_case" }]);
    // the bot then answers a price question
    const q = await t.turn(t.text("قديش اللبنة؟"));
    expect(q.outcome).toBe("agent_ok");
    expect(t.seen).toHaveLength(2);
    expect(JSON.stringify(t.seen[0]!.messages[0]!.content)).toContain("open_requests_with_a_person");
  });

  it("call me back: the customer's own tap marks the case; asking again recalls the open case, never opens a second", async () => {
    const t = customer([]);
    await t.turn(t.text("بدي احكي مع حدا"));
    const c = await t.conv();
    const caseId = (await db.one(`select id from handoffs where conversation_id = $1`, [c.conversation_id])).id;
    await t.turn(t.tap(callbackButtonId(caseId)));
    expect(bodies().at(-1)).toBe(ar.support.callbackNoted);
    expect((await db.one(`select callback_requested from handoffs where id = $1`, [caseId])).callback_requested).toBe(true);
    await t.turn(t.text("بدي احكي مع حدا لو سمحت"));
    expect(bodies().at(-1)).toBe(ar.support.reminder);
    await t.turn(t.tap(MENU_PERSON));
    expect(bodies().at(-1)).toBe(ar.support.reminder);
    expect(await cases(c.conversation_id)).toHaveLength(1);
  });

  it("a customer chasing the open request gets 'your request is open' once per 10 minutes; in between, the Concierge answers", async () => {
    const t = customer([reading({ intent: "question" }), reply("طلبك عند الفريق. بتحب تطلب شي هلّق؟")]);
    await t.turn(t.text("بدي احكي مع حدا"));
    const r1 = await t.turn(t.text("أيمتى رح يتصل فيي حدا؟"));
    expect(r1.outcome).toBe("answered");
    expect(bodies().at(-1)).toBe(ar.support.reminder);
    expect(t.seen).toHaveLength(0);
    const r2 = await t.turn(t.text("في حدا؟"));
    expect(r2.outcome).toBe("agent_ok");                                 // within 10 minutes: answered, by the Concierge
    expect(bodies().at(-1)).toBe("طلبك عند الفريق. بتحب تطلب شي هلّق؟");
  });
});

describe("the model and the planner add a person; a food fact not on record is not a case", () => {
  it("handoff_human for a complaint opens a complaint case; a second hand-off is refused to the model, which then answers", async () => {
    const t = customer([reading({ intent: "complaint" }), { tools: [["handoff_human", { reason: "complaint: the milk arrived spoiled" }]] },
                        reading({ intent: "complaint" }), { tools: [["handoff_human", { reason: "complaint: spoiled milk again" }]] },
                        { tools: [["reply", { text: "طلبك عند الفريق، رح يجاوبوك." }]] }]);
    const r = await t.turn(t.text("الحليب وصل خربان"));
    expect(r.outcome).toBe("case");
    expect(bodies()).toEqual([ar.support.opened]);
    const c = await t.conv();
    expect(await cases(c.conversation_id)).toMatchObject([{ kind: "complaint", source: "model", state: "open" }]);
    const caseId = (await db.one(`select id from handoffs where conversation_id = $1`, [c.conversation_id])).id;
    await db.pg.query(`update handoffs set topic_reminded_at = now() where id = $1`, [caseId]);   // reminded a moment ago
    const r2 = await t.turn(t.text("وكمان الجبنة كانت خربانة"));
    expect(r2.outcome).toBe("agent_ok");
    const toolResult = JSON.parse(((t.seen[4]!.messages.at(-1)!.content as any[])[0]).content);
    expect(toolResult).toMatchObject({ ok: false, error: "request_already_open" });
    expect(bodies().at(-1)).toBe("طلبك عند الفريق، رح يجاوبوك.");
    expect(await cases(c.conversation_id)).toHaveLength(1);
    expect(await locked(c.conversation_id)).toEqual({ human_handoff: false, bot_paused_until: null });
  });

  it("handoff_human about a food fact the records do not hold: the fixed 'not confirmed' line, no case, the bot keeps serving", async () => {
    const t = customer([reading({ intent: "question" }, "en"), { tools: [["handoff_human", { reason: "halal status not on record for this product" }]] }]);
    const r = await t.turn(t.text("is the salami halal?"));
    expect(r.outcome).toBe("agent_ok");
    expect(bodies()).toEqual([en.support.notOnRecord]);
    const c = await t.conv();
    expect(await cases(c.conversation_id)).toEqual([]);
  });

  it("the ask loop that never answers ends with one fixed question with buttons, not a case", async () => {
    const t = customer([reading({ intent: "question" }), ...Array.from({ length: 6 }, (): Step => ({ stop: "end_turn" }))]);
    const r = await t.turn(t.text("lal yom shu fi?"));
    expect(r.outcome).toBe("answered");
    expect(bodies()).toEqual([ar.support.stalled]);
    expect(buttonsOf(outbound[0]!.body)).toEqual(["menu:browse", "menu:order", "menu:person"]);
    expect(await cases((await t.conv()).conversation_id)).toEqual([]);
  });
});

describe("a person claims: the bot steps back for 10 minutes; 10 quiet minutes give it back", () => {
  it("claim pauses the bot (buttons still answered); the pause runs out, the bot resumes and says so, the case returns to the ladder", async () => {
    const t = customer([reading({ intent: "question" }), reply("تفضّل، شو بتحب تطلب؟")]);
    await t.turn(t.text("بدي احكي مع حدا"));
    const c = await t.conv();
    const caseId = (await db.one(`select id from handoffs where conversation_id = $1`, [c.conversation_id])).id;
    const claim = await db.rpc("claim_case", { p_case: caseId, p_by: OPS });
    expect(claim.ok).toBe(true);
    expect(await db.all(`select kind from ops_exceptions where ref = $1 and status <> 'resolved'`, [caseId])).toEqual([]);
    const paused = await t.turn(t.text("مرحبا؟"));
    expect(paused.outcome).toBe("paused");
    expect(t.seen).toHaveLength(0);
    await t.turn(t.tap(CASE_KEEP));                                       // code still answers buttons during the pause
    expect(bodies().at(-1)).toBe(ar.support.keepOrdering);
    // a staff reply renews the pause
    expect((await db.rpc("staff_replied", { p_case: caseId, p_by: OPS })).ok).toBe(true);
    expect((await db.one(`select first_staff_reply_at is not null as r from handoffs where id = $1`, [caseId])).r).toBe(true);
    // 10 quiet minutes
    await db.pg.query(`update handoffs set pause_until = now() - interval '1 second' where id = $1`, [caseId]);
    const before = outbound.length;
    await caseTimers(t.deps);
    expect(bodies().slice(before)).toEqual([ar.support.resumed]);
    expect(await db.one(`select state, rounds, alert_step from handoffs where id = $1`, [caseId])).toEqual({ state: "open", rounds: 1, alert_step: 0 });
    expect(await locked(c.conversation_id)).toEqual({ human_handoff: false, bot_paused_until: null });
    expect(await db.all(`select kind from ops_exceptions where ref = $1 and status <> 'resolved'`, [caseId])).toEqual([{ kind: "support_case" }]);
    const back = await t.turn(t.text("بدي لبنة"));
    expect(back.outcome).toBe("agent_ok");
    await caseTimers(t.deps);                                             // the same round is never said twice
    expect(bodies().filter((b) => b === ar.support.resumed)).toHaveLength(1);
  });

  it("only staff can claim, reply or resolve; resolving says the closing line's language and releases the pause", async () => {
    const t = customer([]);
    await t.turn(t.text("I want to talk to a person"));
    const c = await t.conv();
    const caseId = (await db.one(`select id from handoffs where conversation_id = $1`, [c.conversation_id])).id;
    await expect(db.rpc("claim_case", { p_case: caseId, p_by: c.party_id })).rejects.toThrow(/NOT_AUTHORISED/);
    await db.rpc("claim_case", { p_case: caseId, p_by: OPS });
    await expect(db.rpc("resolve_case", { p_case: caseId, p_by: OPS, p_outcome: "" })).rejects.toThrow(/OUTCOME_REQUIRED/);
    const r = await db.rpc("resolve_case", { p_case: caseId, p_by: OPS, p_outcome: "answered the question about the order" });
    expect(r).toMatchObject({ ok: true, already: false, party_id: c.party_id });
    expect(await locked(c.conversation_id)).toEqual({ human_handoff: false, bot_paused_until: null });
    expect(await db.one(`select state, status from handoffs where id = $1`, [caseId])).toEqual({ state: "resolved", status: "resolved" });
  });
});

describe("the alert ladder", () => {
  it("3 minutes unclaimed: a second push; 5: the founder's push and 'still on it' to the customer; 15: late", async () => {
    const t = customer([]);
    await t.turn(t.text("بدي احكي مع حدا"));
    const c = await t.conv();
    const caseId = (await db.one(`select id from handoffs where conversation_id = $1`, [c.conversation_id])).id;
    const open = async () => (await db.all(`select kind from ops_exceptions where ref = $1 and status <> 'resolved'`, [caseId])).map((x: any) => x.kind);
    expect(await open()).toEqual(["support_case"]);
    await db.pg.query(`update handoffs set ladder_from = now() - interval '3 minutes 5 seconds' where id = $1`, [caseId]);
    await caseTimers(t.deps);
    expect(await open()).toEqual(["support_case_unclaimed"]);
    const before = outbound.length;
    await db.pg.query(`update handoffs set ladder_from = now() - interval '5 minutes 5 seconds' where id = $1`, [caseId]);
    await caseTimers(t.deps);
    expect(await open()).toEqual(["support_case_founder"]);
    expect(bodies().slice(before)).toEqual([ar.support.stillOnIt]);
    expect(buttonsOf(outbound.at(-1)!.body)).toEqual([CASE_KEEP, callbackButtonId(caseId), "case:voice"]);
    await caseTimers(t.deps);
    expect(bodies().filter((b) => b === ar.support.stillOnIt)).toHaveLength(1);
    await db.pg.query(`update handoffs set ladder_from = now() - interval '16 minutes' where id = $1`, [caseId]);
    await caseTimers(t.deps);
    expect((await db.one(`select late from handoffs where id = $1`, [caseId])).late).toBe(true);
    // these kinds are pushed (high priority), as is the 2-minute alarm
    const kinds = (await db.one(`select value->'high_priority_kinds' as k from settings where key = 'push_alerts'`)).k;
    expect(kinds).toEqual(expect.arrayContaining(["support_case", "support_case_unclaimed", "support_case_founder", "customer_unanswered", "turn_failed"]));
  });

  it("outside open hours: the honest opening time, the case recorded, no timer and no alert until opening", async () => {
    await db.pg.exec(`update settings set value = '{"open":"08:00","close":"08:00:01","tz":"Asia/Beirut"}' where key = 'hours'`);
    try {
      const t = customer([]);
      const r = await t.turn(t.text("Je voudrais parler à une personne"));
      expect(r.outcome).toBe("case");
      expect(bodies()).toEqual([fr.support.afterHours("08:00")]);
      const c = await t.conv();
      const caseId = (await db.one(`select id from handoffs where conversation_id = $1`, [c.conversation_id])).id;
      expect(await cases(c.conversation_id)).toMatchObject([{ kind: "person_requested", after_hours: true }]);
      expect(await db.all(`select 1 from ops_exceptions where ref = $1`, [caseId])).toEqual([]);
      expect(await db.rpc("case_timers_due")).toEqual([]);
      const day = await db.rpc("day_open_checklist");
      expect(day.support_cases.map((x: any) => x.id)).toContain(caseId);
    } finally { await db.pg.exec(OPEN_ALL_DAY); }
  });
});

describe("the 2-minute alarm: any customer message with no reply of any kind, in open hours", () => {
  it("raises one high-priority exception per message, once; a message we answered is not flagged", async () => {
    const t = customer([]);
    await t.turn(t.text("بدي احكي مع حدا"));                             // answered
    const c = await t.conv();
    await db.pg.query(`insert into wa_messages(line, direction, party_id, conversation_id, wa_message_id, type, body, created_at)
      values ('customer', 'inbound', $1, $2, $3, 'text', 'hello?', now() - interval '3 minutes')`, [c.party_id, c.conversation_id, `wamid.lost.${c.party_id}`]);
    await db.pg.query(`update wa_messages set created_at = now() - interval '4 minutes' where party_id = $1 and wa_message_id <> $2`, [c.party_id, `wamid.lost.${c.party_id}`]);
    const due = (await db.rpc("customer_unanswered", { p_minutes: 2 })).filter((x: any) => x.party_id === c.party_id);
    expect(due.map((x: any) => x.wa_message_id)).toEqual([`wamid.lost.${c.party_id}`]);
    await unansweredAlarm(t.deps);
    await unansweredAlarm(t.deps);
    expect(await db.all(`select ref from ops_exceptions where kind = 'customer_unanswered' and detail->>'party_id' = $1`, [c.party_id])).toEqual([{ ref: `wamid.lost.${c.party_id}` }]);
  });
});

describe("safe automatic credit: a missing item on a prepaid order, within three limits", () => {
  it("credits within the limits, sends anything over a limit to a person, logs each decision with the picker, moves no money over a limit", async () => {
    const h = await openHub();
    const COFFEE = await h.product("Najjar Cafe Classic Normal 180G"), BREAD = await h.product("Wooden Bakery Pita White Bread Big 800G");
    const price = Number((await h.db.one(`select price_usd from offers where product_id = $1 order by price_usd limit 1`, [COFFEE])).price_usd);
    // Limits set around the item's own price, so the test reads the rule, not the catalog: one unit fits, two do not;
    // two units' worth in a month fits, three do not.
    await h.db.pg.query(`update settings set value = jsonb_set(value, '{auto_credit}', $1::jsonb) where key = 'support'`,
      [JSON.stringify({ max_usd: price * 1.5, per_customer_month_usd: price * 2.5, per_customer_month_count: 2 })]);
    let who: { party: string; conversation: string } | undefined;
    const shortOn = async (missingUnits: number, payment: "whish" | "cod" = "whish") => {
      const o = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }, { product_id: BREAD, qty: 1 }], payment, who);
      who = { party: o.customer, conversation: o.conversation };
      await h.db.rpc("start_pick", { p_order: o.orderId, p_by: h.picker });
      const item = (await h.db.one(`select id from order_items where order_id = $1 and product_id = $2`, [o.orderId, COFFEE])).id;
      const r = await h.db.rpc("pick_item_missing", { p_item: item, p_by: h.picker, p_found: 2 - missingUnits });
      await h.db.rpc("finish_pick", { p_order: o.orderId, p_by: h.picker });
      return r;
    };
    const cash = await shortOn(1, "cod");
    expect(Number(cash.credit_usd)).toBe(0);                              // cash: the total simply dropped
    expect(Number((await shortOn(2)).credit_usd)).toBe(0);                 // over max_usd: a person decides
    expect(Number((await shortOn(1)).credit_usd)).toBeCloseTo(price, 2);   // credited
    expect(Number((await shortOn(1)).credit_usd)).toBeCloseTo(price, 2);   // credited: 2 units' worth, 2 credits this month
    expect(Number((await shortOn(1)).credit_usd)).toBe(0);                 // over per_customer_month_usd
    await h.db.pg.query(`update settings set value = jsonb_set(value, '{auto_credit,per_customer_month_usd}', '1000') where key = 'support'`);
    expect(Number((await shortOn(1)).credit_usd)).toBe(0);                 // a third automatic credit this month
    const log = await h.db.all(`select decision, why, picker_id from auto_credits where customer_id = $1 order by created_at`, [who!.party]);
    expect(log.map((x: any) => [x.decision, x.why])).toEqual([["to_person", "over_max_usd"], ["credited", null], ["credited", null],
                                                              ["to_person", "over_month_usd"], ["to_person", "over_month_count"]]);
    expect(new Set(log.map((x: any) => x.picker_id))).toEqual(new Set([h.picker]));
    expect((await h.db.all(`select 1 from refunds where customer_id = $1`, [who!.party])).length).toBe(2);
    expect(Number(await h.db.rpc("customer_credit_usd", { p_party: who!.party }))).toBeCloseTo(price * 2, 2);
    // over a limit: one refund case on the customer's chat, for a person
    expect(await h.db.all(`select kind, source, state from handoffs where conversation_id = $1`, [who!.conversation]))
      .toEqual([{ kind: "refund", source: "auto_credit", state: "open" }]);
    const m = await h.db.rpc("case_metrics", { p_from: new Date(Date.now() - 3600_000).toISOString(), p_to: new Date(Date.now() + 60_000).toISOString() });
    expect(m.auto_credits).toMatchObject({ credited: 2, to_person: 3 });
    await expectBooksBalanced(h);
  }, 120_000);
});

describe("the migration clears every existing lock (0135)", () => {
  it("a chat locked before 0135 answers after it; its open hand-off becomes a case a person still sees", async () => {
    const root = fileURLToPath(new URL("../../supabase/", import.meta.url));
    const pg = new PGlite({ extensions: { pg_trgm, pgcrypto } });
    const files = readdirSync(root + "migrations").sort();
    for (const f of files.filter((x) => x < "0135")) await pg.exec(readFileSync(root + "migrations/" + f, "utf8"));
    const party = (await pg.query<{ id: string }>(`insert into parties(role) values ('customer') returning id`)).rows[0]!.id;
    const conv = (await pg.query<{ id: string }>(`insert into conversations(line, party_id, human_handoff) values ('customer', $1, true) returning id`, [party])).rows[0]!.id;
    await pg.query(`insert into handoffs(conversation_id, reason, created_at) values ($1, 'model_capacity', now() - interval '2 hours'), ($1, 'agent_error: x', now() - interval '1 hour')`, [conv]);
    await pg.query(`insert into handoffs(conversation_id, reason, status, resolved_at) values ($1, 'old', 'resolved', now())`, [conv]);
    for (const f of files.filter((x) => x >= "0135")) await pg.exec(readFileSync(root + "migrations/" + f, "utf8"));
    expect((await pg.query(`select count(*)::int as n from conversations where human_handoff`)).rows).toEqual([{ n: 0 }]);
    const rows = (await pg.query(`select reason, state, late from handoffs where conversation_id = $1 order by created_at`, [conv])).rows;
    expect(rows).toEqual([
      { reason: "model_capacity", state: "resolved", late: true },          // merged into the newer one
      { reason: "agent_error: x", state: "open", late: true },              // still owed an answer: in the Inbox, flagged late
      { reason: "old", state: "resolved", late: false },
    ]);
    await pg.close();
  }, 120_000);
});
