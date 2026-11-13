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

const orderScript = () => [
  [use("extract_order", { intent: { intent: "order", language: "ar_lb", fulfilment: "delivery",
      lines: [{ raw: "لبنة", query: "لبنة ليبان ليه", qty: 1, confidence: 0.9 }, { raw: "ربطتين خبز", query: "ربطة خبز", qty: 2, unit: "bundle", confidence: 0.9 }],
      address: { village: "بعقلين", building: "بناية النسيم", floor: "3" } } }),
   use("search_catalog", { query: "لبنة ليبان ليه" }), use("search_catalog", { query: "ربطة خبز" }),
   use("resolve_place", { village: "بعقلين", verbatim: "بعقلين بناية النسيم الطابق التالت" })],
  [use("quote_order", { lines: [{ product_id: LABNEH, source_id: HUB, qty: 1 }, { product_id: BREAD, source_id: HUB, qty: 2 }] })],
  [use("send_confirmation", { payment_method: "cod", change_for_usd: 20 })],
];

describe("text order to confirmation card, on the real schema", () => {
  it("buffers a burst into one turn and sends one order card priced by the database", async () => {
    const t = setup(orderScript());
    const before = Date.now();
    await t.conv.fetch(t.text("مرحبا بدي لبنة وربطتين خبز"));
    await t.conv.fetch(t.text("عبعقلين بناية النسيم الطابق التالت"));
    expect(t.alarm()! - before).toBeGreaterThanOrEqual(5900);          // waits for the burst to end
    expect(t.seen).toHaveLength(0);                                    // nothing reaches the model before the alarm
    await t.conv.alarm();

    expect(JSON.parse(t.seen[0]!.messages[0]!.content as string).texts).toHaveLength(2);   // both messages, one turn
    expect(outbound).toHaveLength(1);                                  // message economy: one outbound for the whole turn
    const card = outbound[0]!;
    expect(card.url).toBe("https://kapso.test/v24.0/PN_CUSTOMER/messages");
    expect(card.body).toMatchObject({ messaging_product: "whatsapp", to: t.who.phone, type: "interactive" });
    const body: string = card.body.interactive.body.text;
    // 5.00 + 2 x 1.01 + 1.00 delivery (core zone) = 8.02; 8.02 x 89,500 rounded to the thousand
    expect(body).toContain("$8.02"); expect(body).toContain("718,000");
    expect(body).toContain("بعقلين"); expect(body).toContain("كاش عند التسليم"); expect(body).toContain("$20.00"); expect(body).toContain(CONSENT_LINE);

    const c = await t.customer();
    const order = await db.one(`select * from orders where customer_id = $1`, [c.party_id]);
    expect(order).toMatchObject({ status: "awaiting_confirmation", payment_method: "cod", village_id: BAAKLINE });
    expect(Number(order.total_usd)).toBeCloseTo(8.02);
    expect(order.customer_notes).toContain("بناية النسيم");            // the customer's own directions travel with the order
    expect(body).toContain(order.short_code);
    expect(card.body.interactive.action.buttons.map((b: any) => b.reply.id)).toEqual(
      [orderButtonId("confirm", order.id), orderButtonId("edit", order.id), orderButtonId("cancel", order.id)]);
    expect(card.body.interactive.action.buttons.every((b: any) => b.reply.title.length <= 20)).toBe(true);

    expect(t.rpcCalls.some((c) => c.fn === "can_send" && c.args.p_category === "service")).toBe(true);   // the compliance gate ran
    expect(await db.one(`select count(*)::int as n from wa_outbox where party_id = $1 and status = 'sent'`, [c.party_id])).toEqual({ n: 1 });
    expect(await db.one(`select count(*)::int as n from wa_messages where party_id = $1 and direction = 'outbound' and order_id = $2`, [c.party_id, order.id])).toEqual({ n: 1 });
    expect(await db.one(`select count(*)::int as n from wa_messages where party_id = $1 and direction = 'inbound'`, [c.party_id])).toEqual({ n: 2 });
    expect(await db.one(`select outcome from agent_runs where conversation_id = $1 and agent = 'concierge'`, [c.conversation_id])).toEqual({ outcome: "ok" });
    expect((t.store.get("state") as any).lastQuote).toBeNull();        // the quote is spent once the card is out
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

  it("hands a restaurant order to a person instead of guessing", async () => {
    const t = setup([
      [use("extract_order", { intent: { intent: "order", language: "mixed", lines: [{ raw: "تنتين تشيز برغر وحدة بلا كبيس", query: "cheeseburger", qty: 2, modifiers: ["one without pickles"], source_hint: "سناك", confidence: 0.8 }] } }),
       use("search_catalog", { query: "cheeseburger", source_hint: "سناك" })],
      [use("handoff_human", { reason: "restaurant_order" })],
    ]);
    await t.conv.fetch(t.text("بدي تنتين تشيز برغر من عند السناك وحدة بلا كبيس"));
    await t.conv.alarm();
    const c = await t.customer();
    expect(c.human_handoff).toBe(true);
    expect(await db.one(`select reason from handoffs where conversation_id = $1`, [c.conversation_id])).toEqual({ reason: "restaurant_order" });
    expect(outbound).toHaveLength(1);
    expect(await db.one(`select count(*)::int as n from orders where customer_id = $1`, [c.party_id])).toEqual({ n: 0 });
  });

  it("does not send a card for a quote with issues, and lets the Concierge offer the substitute", async () => {
    await db.pg.query(`update stock_levels set on_hand = 0 where product_id = $1`, [LABNEH_SMALL]);
    const t = setup([
      [use("quote_order", { lines: [{ product_id: LABNEH_SMALL, qty: 2 }] })],
      [use("send_confirmation", {})],                                   // the model tries anyway
      [use("reply", { text: "لبنة ٤٥٠ غرام خلصت. بتحب ٩٠٠ غرام بدالها؟", buttons: [{ id: "sub:yes", title: "إي" }, { id: "sub:no", title: "لا" }] })],
    ]);
    await t.conv.fetch(t.text("بدي لبنة صغيرة"));
    await t.conv.alarm();
    await db.pg.query(`update stock_levels set on_hand = 500 where product_id = $1`, [LABNEH_SMALL]);
    const c = await t.customer();
    expect(await db.one(`select count(*)::int as n from orders where customer_id = $1`, [c.party_id])).toEqual({ n: 0 });
    const toolResult = JSON.parse(((t.seen[1]!.messages.at(-1)!.content as any[])[0]).content);
    expect(toolResult.issues.map((i: any) => i.code)).toContain("out_of_stock");
    expect(toolResult.issues[0].substitutes.map((s: any) => s.product_id)).toContain(LABNEH);   // the database offers the substitute
    expect(t.seen).toHaveLength(3);                                     // the refused tool did not end the turn
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
    const t = setup(loop);
    await t.conv.fetch(t.text("لبنة"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(6);
    const c = await t.customer();
    expect(await db.one(`select reason from handoffs where conversation_id = $1`, [c.conversation_id])).toEqual({ reason: "agent_did_not_finish" });
  });

  it("saves a location pin to the customer's places and continues with it", async () => {
    const t = setup([[use("reply", { text: "وصل الموقع. شو بتحب تطلب؟" })]]);
    await t.conv.fetch(t.inbound({ type: "location", location: { latitude: 33.68, longitude: 35.56 } }));
    await t.conv.alarm();
    const c = await t.customer();
    expect(await db.one(`select count(*)::int as n from customer_places where party_id = $1 and lat is not null`, [c.party_id])).toEqual({ n: 1 });
    expect(JSON.parse(t.seen[0]!.messages[0]!.content as string).texts[0]).toContain("location pin received");
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
