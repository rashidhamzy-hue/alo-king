// Integration on the real schema: an inbound customer message goes through the Durable Object buffer, the Concierge,
// the tools, the SQL functions in the migrations, and the Compliance Gateway, and comes out as a WhatsApp message.
// Only two things are replaced: the model is scripted, and Kapso's HTTP endpoint is a recorder.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ConversationDO, type Env } from "../../apps/gateway/src/index";
import { CONSENT_LINE, formatOrderCard, orderButtonId, parseOrderButton, type Quote } from "@ak/agents/order-card";
import { preflight } from "@ak/wa/gateway";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

let db: TestDb;
let LABNEH: string, BREAD: string, LABNEH_SMALL: string, HUB: string, BAAKLINE: string;

beforeAll(async () => {
  db = await openTestDb();
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
function setup(steps: Anthropic.ToolUseBlock[][]) {
  const n = ++customerSeq;
  const who = { waUserId: `bsuid-flow-${n}`, phone: `+9617000${String(n).padStart(4, "0")}` };
  const shim = supabaseOver(db), m = scriptedModel(steps), s = fakeState();
  const env = { BUFFER_SECONDS: "6", MODEL_FAST: "fast", KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k",
                PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS", TEST_DEPS: { db: shim.client, model: m.model } } as unknown as Env;
  const inbound = (message: Record<string, unknown>) => new Request("https://do/inbound", { method: "POST", body: JSON.stringify({
    line: "customer", who,
    event: { message: { id: `wamid.${n}.${Math.random()}`, timestamp: "1794390000", kapso: { direction: "inbound", origin: "cloud_api" }, ...message },
             conversation: { id: `conv_${n}`, contact_name: "Test" }, phone_number_id: "PN_CUSTOMER" } }) });
  const conv = new ConversationDO(s.state, env);
  /** The customer as the database knows them, created the way the first message would create them. */
  const customer = async () => db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: who.waUserId, p_phone: who.phone, p_name: "Test" });
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
    expect(t.alarm()! - before).toBeGreaterThanOrEqual(5900);          // waits for the burst to end
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
    expect(body).toContain("بعقلين"); expect(body).toContain("كاش عند التسليم"); expect(body).toContain("$20.00"); expect(body).toContain(CONSENT_LINE);

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
    const t = setup([
      read({ intent: "order", lines: [{ raw: "لبنة", query: "لبنة", qty: 1, confidence: 0.6 }], address: { village: "بعقلين" } }),
      [use("reply", { text: "أي لبنة بدك؟", buttons: [{ id: "a", title: "ليبان ليه ٤٥٠غ" }, { id: "b", title: "ليبان ليه ٩٠٠غ" }, { id: "c", title: "تعنايل" }] })],
    ]);
    await t.conv.fetch(t.text("بدي لبنة"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(2);
    expect(t.seen[1]!.tool_choice).toBeUndefined();
    const second = JSON.parse(t.seen[1]!.messages[0]!.content as string);
    expect(second.reading.lines[0].raw).toBe("لبنة");
    expect(second.plan.next).toBe("ask");
    expect(second.plan.lines[0].status).toBe("ambiguous");          // labneh at 0.67 and at 5.00 are not interchangeable
    expect(second.plan.lines[0].candidates).toHaveLength(3);
    expect(t.rpcCalls.filter((c) => c.fn === "search_catalog")).toHaveLength(0);   // plan_order searched, inside the database
    expect(outbound).toHaveLength(1);
    const c = await t.customer();
    expect(await db.one(`select trace->>'path' as p from agent_runs where conversation_id = $1`, [c.conversation_id])).toEqual({ p: "ask" });
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

  it("stays silent while a person is handling the chat", async () => {
    const t = setup(orderScript());
    const c = await t.customer();
    await db.pg.query(`update conversations set human_handoff = true where id = $1`, [c.conversation_id]);
    await t.conv.fetch(t.text("وينكم؟"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0); expect(outbound).toHaveLength(0);
  });

  it("stops after six model steps and hands off", async () => {
    const loop = Array.from({ length: 8 }, () => [use("search_catalog", { query: "لبنة" })]);
    const t = setup([read({ intent: "question" }), ...loop]);
    await t.conv.fetch(t.text("لبنة"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(7);                                     // the reading, then six loop steps
    const c = await t.customer();
    expect(await db.one(`select reason from handoffs where conversation_id = $1`, [c.conversation_id])).toEqual({ reason: "agent_did_not_finish" });
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

describe("order card", () => {
  const ORDER = "33333333-3333-4333-8333-333333333333";
  const quote: Quote = { ok: true, issues: [], subtotal_usd: 7.5, delivery_fee_usd: 1, total_usd: 8.5, fx_rate_lbp: 89500, total_lbp: 761000,
    eta_minutes: 20, pickup: false, village: "Baakline", village_ar: "بعقلين", village_id: null, lines: [] };
  it("keeps totals, consent line and buttons inside WhatsApp's limits for a 60-line basket", () => {
    const big: Quote = { ...quote, lines: Array.from({ length: 60 }, (_, i) => ({ name: `Product with a fairly long name number ${i}`, name_ar: null, qty: 2, unit: "Each", line_total_usd: 3.25, modifiers: ["بلا كبيس"] })) };
    const card = formatOrderCard({ orderId: ORDER, shortCode: "AK-2000", quote: big, paymentMethod: "whish" });
    const body = (card as any).interactive.body.text as string;
    expect(body.length).toBeLessThanOrEqual(1024);
    expect(body).toContain("الإجمالي"); expect(body).toContain(CONSENT_LINE); expect(body).toContain("أغراض تانية");
    expect(preflight({ line: "customer", partyId: ORDER, to: "x", category: "service", msg: card, dedupeKey: "t:0" })).toBeNull();
  });
  it("round-trips button ids", () => {
    expect(parseOrderButton(orderButtonId("cancel", ORDER))).toEqual({ action: "cancel", orderId: ORDER });
    expect(parseOrderButton("order:confirm:not-a-uuid")).toBeNull();
  });
});
