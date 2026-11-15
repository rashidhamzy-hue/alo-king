// Integration on the real schema: an inbound customer message goes through the Durable Object buffer, the Concierge,
// the tools, the SQL functions in the migrations, and the Compliance Gateway, and comes out as a WhatsApp message.
// Only two things are replaced: the model is scripted, and Kapso's HTTP endpoint is a recorder.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ConversationDO, type Env } from "../../apps/gateway/src/index";
import { processTurn, runTurn, type Pending, type TurnDeps } from "../../apps/gateway/src/turn";
import { send as gatewaySend } from "@ak/wa/gateway";
import { formatOrderCard, orderButtonId, parseOrderButton, type Quote } from "@ak/agents/order-card";
import { ar, en, REPLY_RULE } from "@ak/agents/messages";
const CONSENT_LINE = ar.card.consent;
import { preflight } from "@ak/wa/gateway";
import { repeatButtonId } from "@ak/agents/answers";
import { KapsoReceived, senderKey } from "@ak/wa/kapso";
import { openTestDb, type TestDb } from "./harness";
import { oldPicks } from "./flow-kit";
import { supabaseOver } from "./supabase-shim";

let db: TestDb;
let LABNEH: string, BREAD: string, LABNEH_SMALL: string, HUB: string, BAAKLINE: string;

beforeAll(async () => {
  db = await openTestDb();
  await oldPicks(db);
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500);
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 500;`);
  BAAKLINE = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  HUB = (await db.one(`update sources set village_id = $1 where kind = 'dark_store' returning id`, [BAAKLINE])).id;
  LABNEH = (await db.one(`select id from products where name_en = 'Liban Lait Labneh Baladieh 900G'`)).id;
  LABNEH_SMALL = (await db.one(`select id from products where name_en = 'Liban Lait Labneh Baladieh 450G'`)).id;
  BREAD = (await db.one(`select id from products where name_en = 'Wooden Bakery Pita White Bread Big 800G'`)).id;
}, 120_000);

let toolSeq = 0;
const use = (name: string, input: unknown): Anthropic.ToolUseBlock => ({ type: "tool_use", id: `tu_${++toolSeq}`, name, input } as Anthropic.ToolUseBlock);
function scriptedModel(steps: Anthropic.ToolUseBlock[][]) {
  const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const model = { messages: { create: async (body: Anthropic.MessageCreateParamsNonStreaming) => {
    seen.push(structuredClone(body));
    const content = steps[seen.length - 1] ?? [];
    return { id: "msg", type: "message", role: "assistant", model: "test", content, stop_reason: content.length ? "tool_use" : "end_turn",
             stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } } as unknown as Anthropic.Message;
  } } };
  return { model, seen };
}

function fakeState() {
  const store = new Map<string, unknown>(); let alarmAt: number | null = null;
  const storage = { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
    delete: async (k: string) => store.delete(k), setAlarm: async (t: number) => void (alarmAt = t) };
  return { state: { storage } as unknown as DurableObjectState, store, alarm: () => alarmAt };
}

let customerSeq = 0;
/** One fresh customer per test, so tests never see each other's orders. */
function setup(steps: Anthropic.ToolUseBlock[][], opts: { who?: { waUserId: string; phone?: string } } = {}) {
  const n = ++customerSeq;
  const who: { waUserId: string; phone?: string } = opts.who ?? { waUserId: `bsuid-flow-${n}`, phone: `+9617000${String(n).padStart(4, "0")}` };
  const shim = supabaseOver(db), m = scriptedModel(steps), s = fakeState();
  const env = { BUFFER_SECONDS: "6", MODEL_FAST: "fast", KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k",
                PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS", TEST_DEPS: { db: shim.client, model: m.model } } as unknown as Env;
  const inbound = (message: Record<string, unknown>) => new Request("https://do/inbound", { method: "POST", body: JSON.stringify({
    line: "customer", who,
    event: { message: { id: `wamid.${n}.${Math.random()}`, timestamp: "1794390000", kapso: { direction: "inbound", origin: "cloud_api" }, ...message },
             conversation: { id: `conv_${n}`, contact_name: "Test" }, phone_number_id: "PN_CUSTOMER" } }) });
  const conv = new ConversationDO(s.state, env);
  /** The customer as the database knows them, created the way the first message would create them. */
  const customer = async () => db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: who.waUserId, p_phone: who.phone ?? null, p_name: "Test" });
  return { ...m, ...s, conv, who, rpcCalls: shim.log.rpc, customer, inbound,
           text: (body: string) => inbound({ type: "text", text: { body } }),
           tap: (id: string, title = "x") => inbound({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } }) };
}

/** A customer with a pinned place in Baakline and a card waiting for their tap. */
async function customerWithCard(t: ReturnType<typeof setup>, lines = [{ product_id: LABNEH, qty: 1 }, { product_id: BREAD, qty: 2 }]) {
  const c = await t.customer();
  await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: 33.68, p_lng: 35.56, p_village: BAAKLINE });
  const place = (await db.one(`select id from customer_places where party_id = $1`, [c.party_id])).id;
  const o = await db.rpc("create_order_from_quote", { p_customer: c.party_id, p_conversation: c.conversation_id, p_lines: lines,
    p_village: BAAKLINE, p_place: place, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
  expect(o.created).toBe(true);
  return { ...c, orderId: o.order_id as string, shortCode: o.short_code as string };
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

/** The forced first call: the model's reading of the turn, and nothing else. */
const read = (intent: Record<string, unknown>) => [use("extract_order", { intent: { language: "ar_lb", ...intent } })];
const ORDER_READING = { intent: "order", fulfilment: "delivery",
  lines: [{ raw: "علبتين لبنة ليبان ليه", query: "لبنة ليبان ليه", qty: 2, confidence: 0.9 }, { raw: "ربطتين خبز", query: "خبز", qty: 2, unit: "bundle", confidence: 0.9 }],
  address: { village: "بعقلين", building: "بناية النسيم", floor: "3" }, change_for_usd: 20 };
const orderScript = () => [read(ORDER_READING)];

describe("parse once, then the database (1.1)", () => {
  it("one model call: the reading goes to plan_order, and a first-time address gets a pin request, then the card", async () => {
    const t = setup(orderScript());
    const before = Date.now();
    await t.conv.fetch(t.text("مرحبا بدي علبتين لبنة ليبان ليه وربطتين خبز"));
    await t.conv.fetch(t.text("عبعقلين بناية النسيم الطابق التالت، وبعتلي صرافة ٢٠ دولار"));
    expect(t.alarm()! - before).toBeGreaterThanOrEqual(1000);          // waits for the burst to end (settings.burst, SP1)
    expect(t.seen).toHaveLength(0);                                    // nothing reaches the model before the alarm
    await t.conv.alarm();

    expect(t.seen).toHaveLength(1);                                    // parse once
    expect(t.seen[0]!.tool_choice).toEqual({ type: "tool", name: "extract_order" });
    expect(JSON.parse(t.seen[0]!.messages[0]!.content as string).texts).toHaveLength(2);   // both messages, one turn
    expect(t.rpcCalls.some((c) => c.fn === "plan_order")).toBe(true);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.interactive.type).toBe("location_request_message");   // first delivery to Baakline: a pin first
    const c = await t.customer();
    expect(await db.one(`select count(*)::int as n from orders where customer_id = $1`, [c.party_id])).toEqual({ n: 0 });

    // The pin arrives. The card goes out from the waiting quote, re-priced by the database, with no model call.
    await t.conv.fetch(t.inbound({ type: "location", location: { latitude: 33.68, longitude: 35.56 } }));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(1);
    expect(outbound).toHaveLength(2);
    const card = outbound[1]!;
    expect(card.url).toBe("https://kapso.test/v24.0/PN_CUSTOMER/messages");
    expect(card.body).toMatchObject({ messaging_product: "whatsapp", to: t.who.phone, type: "interactive" });
    const body: string = card.body.interactive.body.text;
    // 2 x 3.00 labneh + 2 x 0.62 bread (the default-choice rule picks the best seller) + 1.00 delivery = 8.24
    expect(body).toContain("$8.24"); expect(body).toContain("737,000");
    expect(body).toContain("بعقلين"); expect(body).toContain(ar.card.payName.cod); expect(body).toContain("$20.00"); expect(body).toContain(CONSENT_LINE);

    const order = await db.one(`select * from orders where customer_id = $1`, [c.party_id]);
    expect(order).toMatchObject({ status: "awaiting_confirmation", payment_method: "cod", village_id: BAAKLINE });
    expect(order.place_id).not.toBeNull();                             // the pinned place, so the confirm tap will not ask again
    expect(Number(order.total_usd)).toBeCloseTo(8.24);
    expect(Number(order.change_for_usd)).toBe(20);
    expect(order.customer_notes).toContain("بناية النسيم");            // the customer's own directions travel with the order
    expect((await db.all(`select raw_phrase from order_items where order_id = $1 order by raw_phrase`, [order.id])).map((r: any) => r.raw_phrase))
      .toEqual(["ربطتين خبز", "علبتين لبنة ليبان ليه"]);              // what they said, for alias learning
    expect(body).toContain(order.short_code);
    expect(card.body.interactive.action.buttons.map((b: any) => b.reply.id)).toEqual(
      [orderButtonId("confirm", order.id), orderButtonId("edit", order.id), orderButtonId("cancel", order.id)]);
    expect(card.body.interactive.action.buttons.every((b: any) => b.reply.title.length <= 20)).toBe(true);

    expect(t.rpcCalls.some((c) => c.fn === "can_send" && c.args.p_category === "service")).toBe(true);   // the compliance gate ran
    expect(await db.one(`select count(*)::int as n from wa_outbox where party_id = $1 and status = 'sent'`, [c.party_id])).toEqual({ n: 2 });
    expect(await db.one(`select count(*)::int as n from wa_messages where party_id = $1 and direction = 'outbound' and order_id = $2`, [c.party_id, order.id])).toEqual({ n: 1 });
    expect(await db.one(`select count(*)::int as n from wa_messages where party_id = $1 and direction = 'inbound'`, [c.party_id])).toEqual({ n: 3 });
    expect((await db.all(`select trace->>'path' as p from agent_runs where conversation_id = $1 and agent = 'concierge' order by created_at`, [c.conversation_id])).map((r: any) => r.p))
      .toEqual(["ask_pin", "card_after_pin"]);
    expect((t.store.get("state") as any).lastQuote).toBeNull();        // the quote is spent once the card is out

    // The tap confirms it: the pinned place satisfies the location check.
    await t.conv.fetch(t.tap(orderButtonId("confirm", order.id)));
    await t.conv.alarm();
    expect((await db.one(`select status from orders where id = $1`, [order.id])).status).toBe("confirmed");
  });

  it("a customer with a pinned place gets the card in the same turn, from one model call", async () => {
    const t = setup(orderScript());
    const c = await t.customer();
    await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: 33.68, p_lng: 35.56, p_village: BAAKLINE });
    await t.conv.fetch(t.text("بدي علبتين لبنة ليبان ليه وربطتين خبز عبعقلين"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(1);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.interactive.body.text).toContain("$8.24");
  });

  it("runs the tool loop only when the plan asks, and hands it the plan instead of searching again", async () => {
    // B1c: «لبنة» alone with no house default is a question code asks itself; with a line the planner cannot find beside it, the
    // words are the loop's, and it gets the plan.
    await db.pg.query(`update products set house_default = false where sku = 'AK-0046'`);
    const t = setup([
      read({ intent: "order", lines: [{ raw: "لبنة", query: "لبنة", qty: 1, confidence: 0.6 }, { raw: "زنزلخت", query: "زنزلخت", qty: 1, confidence: 0.6 }], address: { village: "بعقلين" } }),
      [use("reply", { text: "أي لبنة بدك؟", buttons: [{ id: "a", title: "ليبان ليه ٤٥٠غ" }, { id: "b", title: "ليبان ليه ٩٠٠غ" }, { id: "c", title: "تعنايل" }] })],
    ]);
    await t.conv.fetch(t.text("بدي لبنة وزنزلخت"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(2);
    expect(t.seen[1]!.tool_choice).toBeUndefined();
    const second = JSON.parse(t.seen[1]!.messages[0]!.content as string);
    expect(second.reading.lines[0].raw).toBe("لبنة");
    expect(second.plan.next).toBe("ask");
    expect(second.plan.lines[0].status).toBe("ambiguous");          // labneh at 0.67 and at 5.00 are not interchangeable
    expect(second.plan.lines[0].candidates).toHaveLength(3);
    // M1: the length rule goes with the ask loop's input only; the reading's input is unchanged.
    expect(second.reply_rule).toBe(REPLY_RULE);
    expect(JSON.stringify(t.seen[0]!)).not.toContain(REPLY_RULE);
    expect(t.rpcCalls.filter((c) => c.fn === "search_catalog")).toHaveLength(0);   // plan_order searched, inside the database
    expect(outbound).toHaveLength(1);
    const c = await t.customer();
    expect(await db.one(`select trace->>'path' as p from agent_runs where conversation_id = $1`, [c.conversation_id])).toEqual({ p: "ask" });
    await db.pg.query(`update products set house_default = true where sku = 'AK-0046'`);
  });

  it("a reading that breaks the contract falls back to the loop rather than guessing", async () => {
    const t = setup([
      [use("extract_order", { intent: { intent: "order", lines: [{ raw: "x" }] } })],      // no language, no query, no confidence
      [use("reply", { text: "شو بتحب تطلب؟" })],
    ]);
    await t.conv.fetch(t.text("x"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(2);
    expect(JSON.parse(t.seen[1]!.messages[0]!.content as string)).toMatchObject({ reading: null, plan: null });
    expect(outbound).toHaveLength(1);
  });

  it("confirms on a button tap without calling the model, and reserves the stock", async () => {
    const t = setup([]);
    const c = await customerWithCard(t);
    const before = Date.now();
    await t.conv.fetch(t.tap(orderButtonId("confirm", c.orderId), "تأكيد الطلب"));
    expect(t.alarm()! - before).toBeLessThan(500);                     // buttons are not buffered
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0);
    expect((await db.one(`select status from orders where id = $1`, [c.orderId])).status).toBe("confirmed");
    expect(Number((await db.one(`select reserved from stock_levels where product_id = $1`, [LABNEH])).reserved)).toBeGreaterThanOrEqual(1);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.text.body).toContain(c.shortCode);
  });

  it("a tap on someone else's order changes nothing", async () => {
    const owner = setup([]); const c = await customerWithCard(owner);
    const t = setup([]);
    await t.conv.fetch(t.tap(orderButtonId("confirm", c.orderId)));
    await t.conv.alarm();
    expect((await db.one(`select status from orders where id = $1`, [c.orderId])).status).toBe("awaiting_confirmation");
    expect(outbound).toHaveLength(1);                                  // the customer still hears something
  });
});

describe("guards around the model", () => {
  it("honours STOP with one fixed reply and no model call", async () => {
    const t = setup(orderScript());
    await t.conv.fetch(t.text("وقف"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0);
    expect(outbound).toHaveLength(1);
    const c = await t.customer();
    expect(await db.one(`select action from consent_events where party_id = $1`, [c.party_id])).toEqual({ action: "opt_out" });
  });

  it("asks for a resend when a voice transcript has collapsed into a loop", async () => {
    const t = setup(orderScript());
    await t.conv.fetch(t.inbound({ type: "audio", audio: { id: "m1" }, kapso: { direction: "inbound", origin: "cloud_api", media_data: { url: "u", byte_size: 60000 },
      transcript: { text: "مرحبا أردت أردت أردت أردت أردت أردت أردت أردت أردت" } } }));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.text.body).toContain("التسجيل");
  });

  it("passes a usable voice transcript to the Concierge", async () => {
    const t = setup(orderScript());
    await t.conv.fetch(t.inbound({ type: "audio", audio: { id: "m1" }, kapso: { direction: "inbound", origin: "cloud_api", media_data: { url: "u", byte_size: 20000 },
      transcript: { text: "مرحبا بدي لبنة وربطتين خبز عبعقلين" } } }));
    await t.conv.alarm();
    expect(JSON.parse(t.seen[0]!.messages[0]!.content as string).transcripts[0].primary).toContain("لبنة");
    expect(outbound[0]!.body.type).toBe("interactive");
  });

  it("does not send a card for a quote with issues, and lets the Concierge offer the substitute", async () => {
    await db.pg.query(`update stock_levels set on_hand = reserved where product_id = $1`, [LABNEH_SMALL]);
    const t = setup([
      read({ intent: "order", lines: [{ raw: "لبنة صغيرة", query: "Liban Lait Labneh Baladieh 450G", qty: 2, confidence: 0.7 }] }),
      [use("quote_order", { lines: [{ product_id: LABNEH_SMALL, qty: 2 }] })],
      [use("send_confirmation", {})],                                   // the model tries anyway
      [use("reply", { text: "لبنة ٤٥٠ غرام خلصت. بتحب ٩٠٠ غرام بدالها؟", buttons: [{ id: "sub:yes", title: "إي" }, { id: "sub:no", title: "لا" }] })],
    ]);
    await t.conv.fetch(t.text("بدي لبنة صغيرة"));
    await t.conv.alarm();
    await db.pg.query(`update stock_levels set on_hand = reserved + 500 where product_id = $1`, [LABNEH_SMALL]);
    const c = await t.customer();
    expect(await db.one(`select count(*)::int as n from orders where customer_id = $1`, [c.party_id])).toEqual({ n: 0 });
    const toolResult = JSON.parse(((t.seen[2]!.messages.at(-1)!.content as any[])[0]).content);
    expect(toolResult.issues.map((i: any) => i.code)).toContain("out_of_stock");
    expect(toolResult.issues[0].substitutes.map((s: any) => s.product_id)).toContain(LABNEH);   // the database offers the substitute
    expect(t.seen).toHaveLength(4);                                     // reading, then the refused tool did not end the turn
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.interactive.body.text).toContain("خلصت");
  });

  it("steps back only while a person's claim or reply pauses the bot; the old human_handoff flag locks nothing (HO1)", async () => {
    const t = setup([...orderScript(), [use("reply", { text: "أهلا" })]]);
    const c = await t.customer();
    await db.pg.query(`update conversations set human_handoff = true, bot_paused_until = now() + interval '5 minutes' where id = $1`, [c.conversation_id]);
    await t.conv.fetch(t.text("وينكم؟"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0); expect(outbound).toHaveLength(0);   // a person has it right now (the 2-minute alarm watches)
    await db.pg.query(`update conversations set bot_paused_until = now() - interval '1 second' where id = $1`, [c.conversation_id]);
    await t.conv.fetch(t.text("وينكم؟ بدي لبنة"));
    await t.conv.alarm();
    expect(t.seen.length).toBeGreaterThan(0);                           // human_handoff is no longer read: the bot answers
  });

  it("stops after six model steps with one fixed question, not a case (HO1)", async () => {
    const loop = Array.from({ length: 8 }, () => [use("search_catalog", { query: "لبنة" })]);
    const t = setup([read({ intent: "question" }), ...loop]);
    await t.conv.fetch(t.text("لبنة"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(7);                                     // the reading, then six loop steps
    const c = await t.customer();
    expect(await db.all(`select reason from handoffs where conversation_id = $1`, [c.conversation_id])).toEqual([]);
    expect(outbound.map((o) => o.body.interactive?.body?.text)).toEqual([ar.support.stalled]);
  });

  it("saves a location pin to the customer's places and continues with it", async () => {
    const t = setup([read({ intent: "greeting" }), [use("reply", { text: "وصل الموقع. شو بتحب تطلب؟" })]]);
    await t.conv.fetch(t.inbound({ type: "location", location: { latitude: 33.68, longitude: 35.56 } }));
    await t.conv.alarm();
    const c = await t.customer();
    expect(await db.one(`select count(*)::int as n from customer_places where party_id = $1 and lat is not null`, [c.party_id])).toEqual({ n: 1 });
    expect(JSON.parse(t.seen[0]!.messages[0]!.content as string).texts[0]).toContain("location pin received");
  });
});

describe("unsigned restaurants (1.2)", () => {
  const BURGER = { raw: "تنتين تشيز برغر وحدة بلا كبيس", query: "cheeseburger", qty: 2, modifiers: ["one without pickles"], source_hint: "سناك أبو علي", confidence: 0.8 };

  it("a restaurant that has not signed is 'not available yet': no handoff, no order, no second model call", async () => {
    const t = setup([read({ intent: "order", language: "mixed", lines: [BURGER] })]);
    await t.conv.fetch(t.text("بدي تنتين تشيز برغر من عند سناك أبو علي وحدة بلا كبيس"));
    await t.conv.alarm();
    const c = await t.customer();
    expect(t.seen).toHaveLength(1);                                     // plan_order decided
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.text.body).toBe("سناك أبو علي مش متوفّر بعد على ألو كينغ، فما فينا ناخد طلب منو هلّق.");
    expect(c.human_handoff).toBe(false);                                // nobody phones it in
    expect(await db.one(`select count(*)::int as n from handoffs where conversation_id = $1`, [c.conversation_id])).toEqual({ n: 0 });
    expect(await db.one(`select count(*)::int as n from orders where customer_id = $1`, [c.party_id])).toEqual({ n: 0 });
    expect(await db.one(`select trace->>'path' as p from agent_runs where conversation_id = $1`, [c.conversation_id])).toEqual({ p: "not_available" });
  });

  it("a mixed message: the restaurant part is named as not available, the groceries go on the card", async () => {
    const t = setup([read({ ...ORDER_READING, lines: [...ORDER_READING.lines, BURGER] })]);
    const c = await t.customer();
    await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: 33.68, p_lng: 35.56, p_village: BAAKLINE });
    await t.conv.fetch(t.text("بدي علبتين لبنة ليبان ليه وربطتين خبز، وتنتين تشيز برغر من سناك أبو علي"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(1);
    expect(outbound).toHaveLength(2);
    expect(outbound[0]!.body.text.body).toContain("سناك أبو علي مش متوفّر بعد");   // named before the card
    expect(outbound[1]!.body.interactive.body.text).toContain("$8.24");            // the card holds only what we can deliver
    const order = await db.one(`select id from orders where customer_id = $1`, [c.party_id]);
    expect(await db.one(`select count(*)::int as n from order_items where order_id = $1`, [order.id])).toEqual({ n: 2 });
  });

  it("only approve_merchant() makes a restaurant searchable", async () => {
    const ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
    const src = (await db.one(`insert into sources(kind, name, is_open) values ('merchant', 'Snack Abou Ali', true) returning id, is_open`));
    expect(src.is_open).toBe(false);                                    // the trigger keeps it closed
    const prod = (await db.one(`insert into products(sku, owner_source_id, name_en, category, sell_unit) values ('M-TEST-1', $1, 'Cheeseburger', 'Restaurant', 'piece') returning id`, [src.id])).id;
    await db.pg.query(`insert into offers(source_id, product_id, price_usd) values ($1, $2, 6)`, [src.id, prod]);

    expect((await db.rpc("search_catalog", { p_query: "cheeseburger", p_source_hint: "Snack Abou Ali" })).reason).toBe("merchant_not_onboarded");
    expect((await db.rpc("search_catalog", { p_query: "cheeseburger" })).matches).toEqual([]);   // not even without a name

    await db.rpc("approve_merchant", { p_source: src.id, p_by: ops, p_commission_pct: 15 });
    const named = await db.rpc("search_catalog", { p_query: "cheeseburger", p_source_hint: "Snack Abou Ali" });
    expect(named.reason).toBeNull();
    expect(named.matches[0]).toMatchObject({ product_id: prod, source_id: src.id, available: 999 });
    // Approved restaurants are planned like anything else.
    const c = await setup([]).customer();
    const plan = await db.rpc("plan_order", { p_party: c.party_id, p_intent: { intent: "order", lines: [{ raw: "برغر", query: "cheeseburger", qty: 1, source_hint: "Snack Abou Ali" }] } });
    expect(plan.lines[0].status).toBe("matched");
    expect(plan.unavailable).toEqual([]);
    await db.pg.query(`update sources set is_open = false where id = $1`, [src.id]);
  });
});

describe("answers without the model (1.3)", () => {
  /** A delivered and paid order, as the fixture for "same as last time". */
  async function closedOrder(t: ReturnType<typeof setup>, lines = [{ product_id: LABNEH, qty: 1 }, { product_id: BREAD, qty: 2 }]) {
    const c = await customerWithCard(t, lines);
    await db.pg.query(`update orders set status = 'closed', delivered_at = now() where id = $1`, [c.orderId]);
    return c;
  }

  it("'where is my order' is answered from order_status_for with no model call", async () => {
    const t = setup([]);
    const c = await customerWithCard(t);
    await t.conv.fetch(t.text("وين طلبي؟"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0);
    expect(outbound[0]!.body.text.body).toBe(ar.answer.awaitingConfirmation(c.shortCode, null));

    await t.conv.fetch(t.tap(orderButtonId("confirm", c.orderId)));
    await t.conv.alarm();
    await t.conv.fetch(t.text("where is my order?"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0);
    // M1: asked in English, answered in English.
    expect(outbound.at(-1)!.body.text.body).toMatch(new RegExp(`^📦 Order ${c.shortCode}: we're preparing it\\.\\nExpected arrival in about (19|20) minutes\\.$`));
  });

  it("with no open order, says so", async () => {
    const t = setup([]);
    await t.conv.fetch(t.text("wen el talab"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0);
    expect(outbound[0]!.body.text.body).toBe("ما عندك طلب مفتوح هلّق. شو بتحب تطلب؟");
  });

  it("opening hours come from settings, typed or read from a voice note", async () => {
    const t = setup([read({ intent: "hours" })]);
    await t.conv.fetch(t.text("قديش بتسكرو؟"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0);
    expect(outbound[0]!.body.text.body).toBe(ar.answer.hours("00:00", "23:59:59", true));
    await t.conv.fetch(t.inbound({ type: "audio", audio: { id: "m1" }, kapso: { direction: "inbound", origin: "cloud_api", media_data: { url: "u", byte_size: 12000 },
      transcript: { text: "مرحبا لأيمتى بتضلكن فاتحين اليوم" } } }));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(1);                                     // the reading only
    expect(outbound.at(-1)!.body.text.body).toContain("منستقبل الطلبات كل يوم");
  });

  it("'do you deliver to X' is answered from the zones", async () => {
    const t = setup([read({ intent: "delivery_area", address: { village: "بيت الدين" } })]);
    await t.conv.fetch(t.text("بتوصلو على بيت الدين؟"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(1);
    expect(outbound[0]!.body.text.body).toBe(ar.answer.inArea("بيت الدين", 1.5, 30));
    expect(outbound[0]!.body.text.body).toContain("التوصيل: $1.50");
  });

  it("an order to a village we do not serve gets one answer listing where we do deliver, and no card", async () => {
    await db.pg.exec(`insert into villages(name_en, name_ar, is_served) values ('Test Outside', 'قرية بعيدة', false) on conflict do nothing`);
    const t = setup([read({ ...ORDER_READING, address: { village: "قرية بعيدة" } })]);
    await t.conv.fetch(t.text("بدي علبتين لبنة وربطتين خبز على قرية بعيدة"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(1);
    const body: string = outbound[0]!.body.text.body;
    expect(body.startsWith("لهلّق ما منوصّل على قرية بعيدة.\n📍 منوصّل على: ")).toBe(true);
    expect(body).toContain("بعقلين"); expect(body).toContain("بيت الدين");          // from the villages table
    const c = await t.customer();
    expect(await db.one(`select count(*)::int as n from orders where customer_id = $1`, [c.party_id])).toEqual({ n: 0 });
  });

  it("'same as last time' re-prices the last closed order and sends the card, with no model call", async () => {
    const t = setup([]);
    const last = await closedOrder(t);
    await t.conv.fetch(t.text("متل المرة الماضية"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.interactive.body.text).toContain("$8.02");
    const order = await db.one(`select * from orders where customer_id = $1 and status = 'awaiting_confirmation'`, [last.party_id]);
    expect(order.place_id).not.toBeNull();
    expect((await db.all(`select product_id, qty from order_items where order_id = $1 order by qty`, [order.id])).map((r: any) => [r.product_id, Number(r.qty)]))
      .toEqual([[LABNEH, 1], [BREAD, 2]]);
  });

  it("names what is missing from last time before the card, and leaves it off", async () => {
    const t = setup([]);
    await closedOrder(t);
    await db.pg.query(`update stock_levels set on_hand = reserved where product_id = $1`, [BREAD]);
    await t.conv.fetch(t.text("same as last time please"));
    await t.conv.alarm();
    await db.pg.query(`update stock_levels set on_hand = reserved + 500 where product_id = $1`, [BREAD]);
    expect(outbound).toHaveLength(2);
    // M1: asked in English, so the fixed words are English too.
    expect(outbound[0]!.body.text.body).toBe(en.answer.someMissing(["Wooden Bakery Pita White Bread Big 800G"]));
    expect(outbound[1]!.body.interactive.body.text).toContain("$6.00");          // 5.00 labneh + 1.00 delivery
  });

  it("a customer with no closed order never gets a repeat card", async () => {
    const t = setup([]);
    await customerWithCard(t);                                          // an order exists, but it was never delivered and paid
    await t.conv.fetch(t.text("نفس المرة الماضية"));
    await t.conv.alarm();
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.text.body).toBe("ما لقيت طلب سابق مكتمل إلك. شو بتحب تطلب؟");
  });

  it("'same as last time, and add bread' puts the new line on top of the old basket", async () => {
    // B1c: «ربطة خبز» alone is the house default now; the big Wooden Bakery loaf is said as such here
    const t = setup([read({ intent: "order", repeat_last: true, lines: [{ raw: "ربطة خبز وودن بيكري الكبير", query: "Wooden Bakery Pita White Bread Big 800G", qty: 1, confidence: 0.9 }] })]);
    await closedOrder(t, [{ product_id: LABNEH, qty: 1 }]);
    await t.conv.fetch(t.text("متل المرة الماضية بس زيدلي ربطة خبز"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(1);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.interactive.body.text).toContain("$7.01");          // 5.00 + 1.01 + 1.00 delivery
  });
});

describe("same as last time, as one button (1.20)", () => {
  async function closedOrder(t: ReturnType<typeof setup>, status = "closed") {
    const c = await customerWithCard(t);
    await db.pg.query(`update orders set status = $2, delivered_at = now() where id = $1`, [c.orderId, status]);
    return c;
  }
  const buttonsOf = (m: { body: any }) => (m.body.interactive?.action?.buttons ?? []).map((b: any) => b.reply);

  it("a returning customer who says hello is offered their last basket; the tap sends it re-priced, with no model call", async () => {
    const t = setup([read({ intent: "greeting" }), [use("reply", { text: "أهلا! شو بتحب تطلب؟" })]]);
    const last = await closedOrder(t);
    await t.conv.fetch(t.text("مرحبا"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.interactive.body.text).toContain("Liban Lait Labneh Baladieh 900G");
    expect(outbound[0]!.body.interactive.body.text).not.toMatch(/\$/);             // no price in the offer: the tap prices it
    expect(buttonsOf(outbound[0]!)).toEqual([{ id: repeatButtonId(last.orderId), title: "متل المرة الماضية" }]);

    await db.pg.query(`update offers set price_usd = 5.25 where product_id = $1`, [LABNEH]);       // today's price, not last time's
    await t.conv.fetch(t.tap(repeatButtonId(last.orderId), "متل المرة الماضية"));
    await t.conv.alarm();
    await db.pg.query(`update offers set price_usd = 5 where product_id = $1`, [LABNEH]);
    expect(t.seen).toHaveLength(0);
    expect(outbound).toHaveLength(2);
    expect(outbound[1]!.body.interactive.body.text).toContain("$8.27");            // 5.25 + 2 x 1.01 + 1.00

    // Offered once: a second hello the same day goes to the Concierge as usual.
    await t.conv.fetch(t.text("مرحبا"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(2);
    expect(outbound.at(-1)!.body.text.body).toBe("أهلا! شو بتحب تطلب؟");
  });

  it("is never shown to a customer with no closed order, even one with a delivered but unpaid order", async () => {
    const t = setup([read({ intent: "greeting" }), [use("reply", { text: "أهلا! شو بتحب تطلب؟" })]]);
    await closedOrder(t, "delivered");
    await t.conv.fetch(t.text("مرحبا"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(2);
    expect(outbound).toHaveLength(1);
    expect(buttonsOf(outbound[0]!)).toEqual([]);
  });

  it("a repeat button for someone else's order sends nothing of theirs", async () => {
    const owner = setup([]); const theirs = await closedOrder(owner);
    const t = setup([]);
    await t.conv.fetch(t.tap(repeatButtonId(theirs.orderId)));
    await t.conv.alarm();
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.text.body).toBe("ما لقيت طلب سابق مكتمل إلك. شو بتحب تطلب؟");
    const c = await t.customer();
    expect(await db.one(`select count(*)::int as n from orders where customer_id = $1`, [c.party_id])).toEqual({ n: 0 });
  });

  it("a card that went stale before the tap is rebuilt at today's prices, with no model call", async () => {
    const t = setup([]);
    const c = await customerWithCard(t);
    await db.pg.query(`update offers set price_usd = 5.5 where product_id = $1`, [LABNEH]);
    await t.conv.fetch(t.tap(orderButtonId("confirm", c.orderId)));
    await t.conv.alarm();
    await db.pg.query(`update offers set price_usd = 5 where product_id = $1`, [LABNEH]);
    expect(t.seen).toHaveLength(0);
    expect(outbound).toHaveLength(2);
    expect(outbound[0]!.body.text.body).toContain("الأسعار أو التوفّر تغيّروا");
    expect(outbound[1]!.body.interactive.body.text).toContain("$8.52");            // 5.50 + 2.02 + 1.00
    expect((await db.one(`select status from orders where id = $1`, [c.orderId])).status).toBe("cancelled");   // superseded
    expect(await db.one(`select count(*)::int as n from orders where customer_id = $1 and status = 'awaiting_confirmation'`, [c.party_id])).toEqual({ n: 1 });
  });
});

describe("no phone number in the webhook (1.19)", () => {
  // A message from a customer who uses a WhatsApp username: Kapso sends the business-scoped id and no number.
  const NO_PHONE_FIXTURE = {
    message: { id: "wamid.HBgLnophone", timestamp: "1794390000", type: "text", from_user_id: "LB.1234567890abcdef", username: "maya.k",
               text: { body: "بدي علبتين لبنة ليبان ليه وربطتين خبز عبعقلين" }, kapso: { direction: "inbound", origin: "cloud_api" } },
    conversation: { id: "conv_np", contact_name: "Maya", phone_number: null, business_scoped_user_id: "LB.1234567890abcdef", phone_number_id: "PN_CUSTOMER" },
    is_new_conversation: true, phone_number_id: "PN_CUSTOMER",
  };

  it("asks for a number the rider can call before the card, stores it, then sends the card with no model call", async () => {
    const who = senderKey(KapsoReceived.parse(NO_PHONE_FIXTURE));
    expect(who).toEqual({ waUserId: "LB.1234567890abcdef", phone: undefined });
    const t = setup([read(ORDER_READING)], { who: { waUserId: who.waUserId! } });
    const c = await t.customer();
    await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: 33.68, p_lng: 35.56, p_village: BAAKLINE });
    expect(await db.rpc("customer_contact_phone", { p_party: c.party_id })).toBeNull();

    await t.conv.fetch(t.inbound(NO_PHONE_FIXTURE.message));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(1);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.to).toBe("LB.1234567890abcdef");                       // replies go to the id, as Kapso accepts it
    expect(outbound[0]!.body.text.body).toBe(ar.fixed.askPhone);
    expect(await db.one(`select count(*)::int as n from orders where customer_id = $1`, [c.party_id])).toEqual({ n: 0 });

    await t.conv.fetch(t.text("03 12 34"));                                          // meant as a number, too short to be one
    await t.conv.alarm();
    expect(outbound.at(-1)!.body.text.body).toContain("الرقم مش واضح");

    await t.conv.fetch(t.text("رقمي 03 123 456"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(1);                                                   // no model for the number or the card
    expect(outbound.at(-1)!.body.interactive.body.text).toContain("$8.24");
    expect(await db.rpc("customer_contact_phone", { p_party: c.party_id })).toBe("+9613123456");
    // The number is for the rider to call. It never becomes a WhatsApp address.
    expect(await db.rpc("party_address", { p_party: c.party_id, p_line: "customer" })).toBe("LB.1234567890abcdef");

    // The rider's job card shows it.
    const order = await db.one(`select id from orders where customer_id = $1`, [c.party_id]);
    const driver = (await db.one(`insert into parties(role, display_name) values ('driver', 'R') returning id`)).id;
    const delivery = (await db.one(`insert into deliveries(driver_id) values ($1) returning id`, [driver])).id;
    await db.pg.query(`insert into delivery_stops(delivery_id, seq, kind, order_id) values ($1, 1, 'dropoff', $2)`, [delivery, order.id]);
    expect((await db.rpc("rider_job", { p_delivery: delivery })).stops[0].phone).toBe("+9613123456");
  });

  it("a customer whose WhatsApp number we have is never asked", async () => {
    const t = setup([read(ORDER_READING)]);
    const c = await t.customer();
    await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: 33.68, p_lng: 35.56, p_village: BAAKLINE });
    await t.conv.fetch(t.text("بدي علبتين لبنة ليبان ليه وربطتين خبز"));
    await t.conv.alarm();
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.type).toBe("interactive");
    expect(await db.rpc("customer_contact_phone", { p_party: c.party_id })).toBe(t.who.phone);
  });

  it("the database refuses a malformed number", async () => {
    const c = await setup([]).customer();
    await expect(db.rpc("set_contact_phone", { p_party: c.party_id, p_phone: "03123456" })).rejects.toThrow(/BAD_PHONE/);
  });
});

describe("model capacity (1.15)", () => {
  const overloaded = () => Object.assign(new Error("Overloaded"), { status: 529, name: "OverloadedError" });
  /** The turn code itself, wired as index.ts wires it, with the retry waits shortened. */
  function direct(steps: Anthropic.ToolUseBlock[][], failures: number) {
    const t = setup(steps);
    const shim = supabaseOver(db);
    let calls = 0;
    const model = { messages: { create: async (body: Anthropic.MessageCreateParamsNonStreaming) => {
      if (calls++ < failures) throw overloaded();
      return t.model.messages.create(body);
    } } };
    const env = { KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS" };
    const waits: number[] = [];
    const deps: TurnDeps = { db: shim.client, model, modelName: "fast", send: (req) => gatewaySend(shim.client, env, req),
                             capacity: { backoffMs: [2000, 5000, 12000], sleep: async (ms) => void waits.push(ms) } };
    const msg = (body: string): Pending[] => [{ line: "customer", who: t.who, event: { phone_number_id: "PN_CUSTOMER",
      conversation: { id: "c", contact_name: "Test" },
      message: { id: `wamid.cap.${Math.random()}`, timestamp: "0", type: "text", text: { body }, kapso: { direction: "inbound", origin: "cloud_api" } } } as any }];
    return { ...t, deps, msg, waits, calls: () => calls };
  }

  it("overloaded once: one fixed 'one moment', then the turn carries on to the card", async () => {
    const t = direct(orderScript(), 1);
    const c = await t.customer();
    await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: 33.68, p_lng: 35.56, p_village: BAAKLINE });
    const r = await runTurn(t.deps, t.msg("بدي علبتين لبنة ليبان ليه وربطتين خبز"), {});
    expect(r.outcome).toBe("card");
    expect(t.waits).toEqual([2000]);
    expect(outbound.map((o) => o.body.type)).toEqual(["text", "interactive"]);
    expect(outbound[0]!.body.text.body).toBe(ar.fixed.oneMoment);
  });

  it("still overloaded after every retry: queued again a minute later, then the fixed technical line; ops is told; no hand-off (HO1)", async () => {
    const t = direct([], 99);
    const pending = t.msg("بدي لبنة"), state = {};
    await expect(runTurn(t.deps, pending, state)).rejects.toThrow(/RETRY_TURN_LATER/);
    expect(t.calls()).toBe(4);                                          // the first try and three retries
    expect(t.waits).toEqual([2000, 5000, 12000]);
    const r = await runTurn(t.deps, pending, state);                    // a minute later
    expect(r.outcome).toBe("technical");
    expect(outbound.map((o) => o.body.text?.body ?? o.body.interactive?.body?.text)).toEqual([ar.fixed.oneMoment, ar.support.technical]);
    const c = await t.customer();
    expect(c.human_handoff).toBe(false);
    expect(await db.all(`select reason from handoffs where conversation_id = $1`, [c.conversation_id])).toEqual([]);
    expect(await db.one(`select count(*)::int as n from ops_exceptions where kind = 'technical' and detail->>'conversation_id' = $1`, [c.conversation_id])).toEqual({ n: 1 });
  });

  it("a turn retried after a crash does not say 'one moment' twice", async () => {
    const t = direct([], 99);
    const pending = t.msg("بدي لبنة");
    const deps = { ...t.deps, turnKey: "customer:crash-retry-test" };
    await processTurn(deps, pending, {}).catch(() => undefined);
    const first = outbound.length;
    await processTurn(deps, pending, {}).catch(() => undefined);
    expect(outbound.slice(first).map((o) => o.body.text.body)).not.toContain(ar.fixed.oneMoment);
  });

  it("the provider refuses for an account reason (15 Nov: usage limit): not retried, the customer gets the fixed technical line, the chat stays with the bot, and a high-priority model_account exception opens (OPS1 with HO1)", async () => {
    const t = direct([], 0);
    const refusal = Object.assign(new Error(`400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC."}}`), { status: 400, name: "BadRequestError" });
    let calls = 0;
    t.deps.model = { messages: { create: async () => { calls++; throw refusal; } } };
    const r = await runTurn(t.deps, t.msg("بدي لبنة"), {});
    expect(r.outcome).toBe("technical");                                // HO1: never silence, never a hand-off for a technical failure
    expect(calls).toBe(1);                                              // a limit does not clear in a minute: no retry, no "one moment", no queued turn
    expect(t.waits).toEqual([]);
    expect(outbound.map((o) => o.body.text?.body ?? o.body.interactive?.body?.text)).toEqual([ar.support.technical]);
    const c = await t.customer();
    expect(c.human_handoff).toBeFalsy();
    const e = await db.one(`select kind, ref, status, detail from ops_exceptions where kind = 'model_account'`);
    expect(e).toMatchObject({ kind: "model_account", ref: "usage_limit", status: "open" });
    expect(e.detail.message).toContain("regain access on 2026-12-01");
    // each chat that met it is findable: the technical exception says which reason
    expect(await db.one(`select detail->>'where' w from ops_exceptions where kind = 'technical' and detail->>'conversation_id' = $1`, [c.conversation_id])).toEqual({ w: "model_account:usage_limit" });
    expect(await db.one(`select count(*)::int as n from claim_alert_pushes() where kind = 'model_account'`)).toEqual({ n: 1 });
  });

  it("a bad request is our bug, not capacity: no 'one moment', no backoff retries; queued again once, then the fixed line (HO1)", async () => {
    const t = direct([], 0);
    t.deps.model = { messages: { create: async () => { throw Object.assign(new Error("bad"), { status: 400, name: "BadRequestError" }); } } };
    const pending = t.msg("بدي لبنة"), state = {};
    await expect(runTurn(t.deps, pending, state)).rejects.toThrow(/RETRY_TURN_LATER/);
    const r = await runTurn(t.deps, pending, state);
    expect(r.outcome).toBe("technical");
    expect(t.waits).toEqual([]);
    expect(outbound.map((o) => o.body.interactive?.body?.text)).toEqual([ar.support.technical]);
  });
});

describe("order card", () => {
  const ORDER = "33333333-3333-4333-8333-333333333333";
  const quote: Quote = { ok: true, issues: [], subtotal_usd: 7.5, delivery_fee_usd: 1, total_usd: 8.5, fx_rate_lbp: 89500, total_lbp: 761000,
    eta_minutes: 20, pickup: false, village: "Baakline", village_ar: "بعقلين", village_id: null, lines: [] };
  it("keeps totals, consent line and buttons inside WhatsApp's limits for a 60-line basket, and still shows every line (M1)", () => {
    const big: Quote = { ...quote, lines: Array.from({ length: 60 }, (_, i) => ({ name: `Product with a fairly long name number ${i}`, name_ar: null, qty: 2, unit: "Each", line_total_usd: 3.25, modifiers: ["بلا كبيس"] })) };
    const parts = formatOrderCard({ orderId: ORDER, shortCode: "AK-2000", quote: big, paymentMethod: "whish" });
    expect(parts).toHaveLength(2);                                      // every line first, as text; then the card
    const lines = (parts[0] as any).text.body as string;
    for (let i = 0; i < 60; i++) expect(lines).toContain(`Product with a fairly long name number ${i} (`);
    const card = parts[1]!;
    const body = (card as any).interactive.body.text as string;
    expect(body.length).toBeLessThanOrEqual(1024);
    expect(body).toContain(`*${ar.card.total}: $8.50*`); expect(body).toContain(CONSENT_LINE);
    for (const m of parts) expect(preflight({ line: "customer", partyId: ORDER, to: "x", category: "service", msg: m, dedupeKey: "t:0" })).toBeNull();
  });
  it("round-trips button ids", () => {
    expect(parseOrderButton(orderButtonId("cancel", ORDER))).toEqual({ action: "cancel", orderId: ORDER });
    expect(parseOrderButton("order:confirm:not-a-uuid")).toBeNull();
  });
});
