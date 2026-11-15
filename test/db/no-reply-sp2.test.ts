// SP2: a customer turn never ends with nothing sent. On the real schema, through the Durable Object, the turn, the ask loop, the
// tools and the gateway, with the model scripted step by step as recorded (stop reason, tools, free text) and Kapso a recorder.
// The two causes M1 found (evals/cases/no_reply.json): a call cut at max_tokens before any tool, and extract_order then silence.
// A handoff still happens when the model truly cannot answer, and then ops is alerted and the console lists it (invariant 18).
// Invented names and addresses only.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ConversationDO, type Env } from "../../apps/gateway/src/index";
import { ar } from "@ak/agents/messages";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

let db: TestDb;

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500);
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 500;`);
  const baakline = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  await db.one(`update sources set village_id = $1 where kind = 'dark_store' returning id`, [baakline]);
}, 120_000);

type Step = { stop: "tool_use" | "end_turn" | "max_tokens"; tools?: [string, unknown][]; text?: string };
let toolSeq = 0;
/** A scripted model: each call gets the next step, shaped as the API returns it. */
function scriptedModel(steps: Step[]) {
  const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const model = { messages: { create: async (body: Anthropic.MessageCreateParamsNonStreaming) => {
    seen.push(structuredClone(body));
    const s = steps[seen.length - 1] ?? { stop: "end_turn" };
    const content = [...(s.text ? [{ type: "text", text: s.text }] : []),
                     ...(s.tools ?? []).map(([name, input]) => ({ type: "tool_use", id: `tu_${++toolSeq}`, name, input }))];
    return { id: "msg", type: "message", role: "assistant", model: "test", content, stop_reason: s.stop, stop_sequence: null,
             usage: { input_tokens: 100, output_tokens: s.stop === "max_tokens" ? 4096 : 20 } } as unknown as Anthropic.Message;
  } } };
  return { model, seen };
}

let customerSeq = 0;
function setup(steps: Step[]) {
  const n = ++customerSeq;
  const who = { waUserId: `bsuid-sp2-${n}`, phone: `+9617200${String(n).padStart(4, "0")}` };
  const shim = supabaseOver(db), m = scriptedModel(steps);
  const store = new Map<string, unknown>(); let alarmAt: number | null = null;
  const storage = { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
    delete: async (k: string) => store.delete(k), setAlarm: async (t: number) => void (alarmAt = t), getAlarm: async () => alarmAt,
    deleteAlarm: async () => void (alarmAt = null) };
  const env = { BUFFER_SECONDS: "6", MODEL_FAST: "fast", KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k",
                PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS", TEST_DEPS: { db: shim.client, model: m.model } } as unknown as Env;
  const conv = new ConversationDO({ storage } as unknown as DurableObjectState, env);
  const text = (body: string) => new Request("https://do/inbound", { method: "POST", body: JSON.stringify({
    line: "customer", who,
    event: { message: { id: `wamid.sp2.${n}.${Math.random()}`, timestamp: "1794390000", kapso: { direction: "inbound", origin: "cloud_api" }, type: "text", text: { body } },
             conversation: { id: `conv_sp2_${n}`, contact_name: "Test" }, phone_number_id: "PN_CUSTOMER" } }) });
  const customer = async () => db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: who.waUserId, p_phone: who.phone, p_name: "Test" });
  return { ...m, conv, text, customer, say: async (body: string) => { await conv.fetch(text(body)); await conv.alarm(); } };
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

const reading = (intent: Record<string, unknown>): Step => ({ stop: "tool_use", tools: [["extract_order", { intent: { language: "ar_lb", ...intent } }]] });
const bodies = () => outbound.map((o) => o.body.text?.body ?? o.body.interactive?.body?.text);
async function handoffState(t: ReturnType<typeof setup>) {
  const c = await t.customer();
  return {
    handoffs: (await db.all(`select reason from handoffs where conversation_id = $1`, [c.conversation_id])).map((r: any) => r.reason),
    exceptions: await db.all(`select kind, detail->>'reason' as reason from ops_exceptions where kind = 'agent_handoff' and detail->>'conversation_id' = $1`, [c.conversation_id]),
    runs: (await db.all(`select outcome from agent_runs where agent = 'concierge' and conversation_id = $1`, [c.conversation_id])).map((r: any) => r.outcome),
  };
}

describe("every customer turn ends in a reply (SP2)", () => {
  it("an address with no basket, the ask call cut at max_tokens: the retry asks what to order, nobody is handed the chat", async () => {
    // The staging turn of 14 Nov 08:13 Beirut, with an invented address.
    const t = setup([
      reading({ intent: "order", lines: [], address: { village: "عبعقلين", landmark: "حد الصيدلية الزرقا", verbatim: "بيت أبو فادي", floor: "تاني" } }),
      { stop: "max_tokens" },
      { stop: "tool_use", tools: [["reply", { text: "وصل العنوان. شو بتحب تطلب؟" }]] },
    ]);
    await t.say("عبعقلين، حد الصيدلية الزرقا، بيت أبو فادي، طابق تاني");
    expect(t.seen).toHaveLength(3);                                     // the reading, the cut call, the retry
    expect(t.seen[1]!.max_tokens).toBeGreaterThanOrEqual(4096);
    expect(bodies()).toEqual(["وصل العنوان. شو بتحب تطلب؟"]);
    expect(await handoffState(t)).toEqual({ handoffs: [], exceptions: [], runs: ["ok"] });
  });

  it("extract_order in the ask loop, then free text and end_turn: told to answer, the model replies; the free text is never sent", async () => {
    const t = setup([
      reading({ intent: "question", lines: [] }),
      reading({ intent: "question", lines: [] }),
      { stop: "end_turn", text: "I'll reply once I've checked the catalog." },
      { stop: "tool_use", tools: [["reply", { text: "ما عندي معلومة موثّقة عن السمسم. بسأل المطبخ قبل ما نقبل الطلب؟" }]] },
    ]);
    await t.say("عندي حساسية سمسم، بدي شاورما");
    expect(bodies()).toEqual(["ما عندي معلومة موثّقة عن السمسم. بسأل المطبخ قبل ما نقبل الطلب؟"]);
    expect(await handoffState(t)).toEqual({ handoffs: [], exceptions: [], runs: ["ok"] });
  });

  it("a model that never answers: the last call is forced to reply; then a person takes it, the customer is told, ops is alerted", async () => {
    const t = setup([reading({ intent: "question", lines: [] }), ...Array.from({ length: 6 }, (): Step => ({ stop: "end_turn", text: "thinking" }))]);
    await t.say("lal yom shu fi?");
    expect(t.seen).toHaveLength(7);
    expect(t.seen.at(-1)!.tool_choice).toEqual({ type: "tool", name: "reply" });
    expect(bodies()).toEqual([ar.fixed.handoff]);                       // never silent: the fixed handoff message
    const h = await handoffState(t);
    expect(h).toEqual({ handoffs: ["agent_did_not_finish"], exceptions: [{ kind: "agent_handoff", reason: "agent_did_not_finish" }], runs: ["handoff"] });
    // the minute cron alerts the ops line for it (index.ts, ops_exceptions_due); the console's exceptions page lists it
    expect((await db.all(`select kind from ops_exceptions_due() where kind = 'agent_handoff'`)).length).toBeGreaterThanOrEqual(1);
  });

  it("the model hands off by itself: the same alert, and the turn counts as a handoff", async () => {
    const t = setup([reading({ intent: "complaint", lines: [] }), { stop: "tool_use", tools: [["handoff_human", { reason: "complaint about a delivery" }]] }]);
    await t.say("el talabiye wosle ghalat");
    expect(bodies()).toEqual([ar.fixed.handoff]);
    expect(await handoffState(t)).toEqual({ handoffs: ["complaint about a delivery"],
      exceptions: [{ kind: "agent_handoff", reason: "complaint about a delivery" }], runs: ["handoff"] });
  });
});
