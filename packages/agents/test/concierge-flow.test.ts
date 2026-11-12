// Integration: an inbound customer message goes through the Durable Object buffer, the Concierge loop,
// the tools, and the Compliance Gateway, and comes out as a WhatsApp order card.
// The model is scripted and the database is an in-memory stand-in for the SQL functions
// (the functions themselves are tested against Postgres in the SQL smoke tests).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ConversationDO, type Env } from "../../../apps/gateway/src/index";
import { CONSENT_LINE, formatOrderCard, orderButtonId, parseOrderButton, type Quote } from "@ak/agents/order-card";
import { preflight } from "@ak/wa/gateway";

const PARTY = "11111111-1111-4111-8111-111111111111", CONV = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333", VILLAGE = "44444444-4444-4444-8444-444444444444";
const LABNEH = "55555555-5555-4555-8555-555555555555", BREAD = "66666666-6666-4666-8666-666666666666", HUB = "77777777-7777-4777-8777-777777777777";

const okQuote: Quote = {
  ok: true, issues: [], subtotal_usd: 7.5, delivery_fee_usd: 1, total_usd: 8.5, fx_rate_lbp: 89500, total_lbp: 761000,
  eta_minutes: 20, pickup: false, village: "Baakline", village_ar: "بعقلين", village_id: VILLAGE,
  lines: [
    { name: "Leen Taanayel Labneh Premium", name_ar: null, qty: 1, unit: "By weight (pre-pack)", line_total_usd: 5.5 },
    { name: "Wooden Bakery Pita White Bread Big 800G", name_ar: null, qty: 2, unit: "Each", line_total_usd: 2 },
  ],
};

function fakeDb(overrides: Record<string, (args: any) => unknown> = {}) {
  const rpcCalls: { fn: string; args: any }[] = [];
  const writes: { table: string; op: string; row: any }[] = [];
  const handlers: Record<string, (args: any) => unknown> = {
    can_send: () => "ok",
    outbox_claim: () => true,
    outbox_mark: () => null,
    touch_conversation: () => ({ known: true, is_new: false, party_id: PARTY, conversation_id: CONV, human_handoff: false, blocked: false, role: "customer" }),
    search_catalog: ({ p_query, p_source_hint }) => p_source_hint
      ? { matches: [], reason: "merchant_not_onboarded" }
      : { reason: null, matches: [{ product_id: /خبز/.test(p_query) ? BREAD : LABNEH, source_id: HUB, name_en: p_query, name_ar: null, brand: "x", sell_unit: "Each", price_usd: 1, available: 5, source_name: "Alo King Hub", score: 1 }] },
    resolve_place: () => ({ village: { village_id: VILLAGE, name_en: "Baakline", confidence: 1 }, landmark: null, served: true, needs_pin: false, reason: null, saved_places: [] }),
    quote_order: () => okQuote,
    create_order_from_quote: () => ({ created: true, order_id: ORDER, short_code: "AK-1001", payment_method: "cod", quote: okQuote }),
    confirm_order_checked: () => ({ status: "confirmed", short_code: "AK-1001", changed: true, payment_method: "cod", total_usd: 8.5 }),
    handle_order_button: ({ p_action }) => ({ status: p_action === "confirm" ? "confirmed" : p_action === "edit" ? "draft" : "cancelled", short_code: "AK-1001", changed: true, payment_method: "cod", total_usd: 8.5 }),
    record_consent_signal: () => null,
    save_customer_pin: () => ({ place_id: "88888888-8888-4888-8888-888888888888", village_id: VILLAGE, village: "Baakline" }),
    ...overrides,
  };
  const chain = (table: string) => {
    const done = Promise.resolve({ data: { status: "sending", approved_by: "x" }, error: null });
    const q: any = { insert: (row: any) => { writes.push({ table, op: "insert", row }); return q; }, update: (row: any) => { writes.push({ table, op: "update", row }); return q; },
      select: () => q, eq: () => q, single: () => done, then: (r: any, j: any) => done.then(r, j) };
    return q;
  };
  const db: any = { rpc: async (fn: string, args: any) => { rpcCalls.push({ fn, args }); const h = handlers[fn]; if (!h) return { data: null, error: { message: `no fake for ${fn}` } };
      try { return { data: h(args), error: null }; } catch (e) { return { data: null, error: { message: String((e as Error).message) } }; } }, from: chain };
  return { db, rpcCalls, writes };
}

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

const inbound = (message: Record<string, unknown>) => new Request("https://do/inbound", { method: "POST", body: JSON.stringify({
  line: "customer", who: { waUserId: "bsuid-1", phone: "+96170000001" },
  event: { message: { id: `wamid.${Math.random()}`, timestamp: "1794390000", kapso: { direction: "inbound", origin: "cloud_api" }, ...message },
           conversation: { id: "conv_1", contact_name: "Test" }, phone_number_id: "PN_CUSTOMER" } }) });
const text = (body: string) => inbound({ type: "text", text: { body } });

function setup(steps: Anthropic.ToolUseBlock[][], overrides: Record<string, (a: any) => unknown> = {}) {
  const f = fakeDb(overrides), m = scriptedModel(steps), s = fakeState();
  const env = { BUFFER_SECONDS: "6", MODEL_FAST: "fast", KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k",
                PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS", TEST_DEPS: { db: f.db, model: m.model } } as unknown as Env;
  return { ...f, ...m, ...s, conv: new ConversationDO(s.state, env) };
}

let outbound: { url: string; body: any }[];
beforeEach(() => {
  outbound = []; toolSeq = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    outbound.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.out${outbound.length}` }] }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const ORDER_SCRIPT = [
  [use("extract_order", { intent: { intent: "order", language: "ar_lb", fulfilment: "delivery",
      lines: [{ raw: "لبنة تعنايل", query: "لبنة تعنايل", qty: 1, confidence: 0.9 }, { raw: "ربطتين خبز", query: "ربطة خبز", qty: 2, unit: "bundle", confidence: 0.9 }],
      address: { village: "بعقلين", building: "بناية النسيم", floor: "3" } } }),
   use("search_catalog", { query: "لبنة تعنايل" }), use("search_catalog", { query: "ربطة خبز" }),
   use("resolve_place", { village: "بعقلين", verbatim: "بعقلين بناية النسيم الطابق التالت" })],
  [use("quote_order", { lines: [{ product_id: LABNEH, source_id: HUB, qty: 1 }, { product_id: BREAD, source_id: HUB, qty: 2 }] })],
  [use("send_confirmation", { payment_method: "cod", change_for_usd: 20 })],
];

describe("text order to confirmation card", () => {
  it("buffers a burst into one turn and sends one order card through the gateway", async () => {
    const t = setup(ORDER_SCRIPT);
    const before = Date.now();
    await t.conv.fetch(text("مرحبا بدي لبنة تعنايل وربطتين خبز"));
    await t.conv.fetch(text("عبعقلين بناية النسيم الطابق التالت"));
    expect(t.alarm()! - before).toBeGreaterThanOrEqual(5900);          // waits for the burst to end
    expect(t.seen).toHaveLength(0);                                    // nothing reaches the model before the alarm
    await t.conv.alarm();

    expect(JSON.parse(t.seen[0]!.messages[0]!.content as string).texts).toHaveLength(2);   // both messages, one turn
    expect(t.seen).toHaveLength(3);                                    // three model steps, under the cap of six

    const created = t.rpcCalls.find((c) => c.fn === "create_order_from_quote")!;
    expect(created.args).toMatchObject({ p_customer: PARTY, p_conversation: CONV, p_village: VILLAGE, p_payment: "cod", p_change_for: 20, p_pickup: false });
    expect(created.args.p_notes).toContain("بناية النسيم");            // the customer's own directions travel with the order
    expect(t.rpcCalls.some((c) => c.fn === "can_send" && c.args.p_category === "service")).toBe(true);   // the compliance gate ran

    expect(outbound).toHaveLength(1);                                  // message economy: one outbound for the whole turn
    const card = outbound[0]!;
    expect(card.url).toBe("https://kapso.test/v24.0/PN_CUSTOMER/messages");
    expect(card.body).toMatchObject({ messaging_product: "whatsapp", to: "+96170000001", type: "interactive" });
    const body: string = card.body.interactive.body.text;
    expect(body).toContain("AK-1001"); expect(body).toContain("$8.50"); expect(body).toContain("761,000");
    expect(body).toContain("بعقلين"); expect(body).toContain("كاش عند التسليم"); expect(body).toContain("$20.00"); expect(body).toContain(CONSENT_LINE);
    expect(card.body.interactive.action.buttons.map((b: any) => b.reply.id)).toEqual(
      [orderButtonId("confirm", ORDER), orderButtonId("edit", ORDER), orderButtonId("cancel", ORDER)]);
    expect(card.body.interactive.action.buttons.every((b: any) => b.reply.title.length <= 20)).toBe(true);

    expect(t.writes.some((w) => w.table === "wa_messages" && w.row.direction === "outbound" && w.row.order_id === ORDER)).toBe(true);
    expect(t.writes.some((w) => w.table === "agent_runs" && w.row.agent === "concierge" && w.row.outcome === "ok")).toBe(true);
    expect((t.store.get("state") as any).lastQuote).toBeNull();        // the quote is spent once the card is out
  });

  it("confirms on a button tap without calling the model", async () => {
    const t = setup([]);
    const before = Date.now();
    await t.conv.fetch(inbound({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: orderButtonId("confirm", ORDER), title: "تأكيد الطلب" } } }));
    expect(t.alarm()! - before).toBeLessThan(500);                     // buttons are not buffered
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0);
    expect(t.rpcCalls.find((c) => c.fn === "confirm_order_checked")!.args).toMatchObject({ p_order: ORDER, p_party: PARTY });
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.text.body).toContain("AK-1001");
  });

  it("tells the customer when stock ran out between card and tap", async () => {
    const t = setup([], { confirm_order_checked: () => { throw new Error("OUT_OF_STOCK 5555"); } });
    await t.conv.fetch(inbound({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: orderButtonId("confirm", ORDER), title: "x" } } }));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0);
    expect(outbound[0]!.body.text.body).toContain("خلص");
  });
});

describe("guards around the model", () => {
  it("honours STOP with one fixed reply and no model call", async () => {
    const t = setup(ORDER_SCRIPT);
    await t.conv.fetch(text("وقف"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0);
    expect(t.rpcCalls.find((c) => c.fn === "record_consent_signal")!.args).toMatchObject({ p_action: "opt_out", p_source: "stop_keyword" });
    expect(outbound).toHaveLength(1);
  });

  it("asks for a resend when a voice transcript has collapsed into a loop", async () => {
    const t = setup(ORDER_SCRIPT);
    await t.conv.fetch(inbound({ type: "audio", audio: { id: "m1" }, kapso: { direction: "inbound", origin: "cloud_api", media_data: { url: "u", byte_size: 60000 },
      transcript: { text: "مرحبا أردت أردت أردت أردت أردت أردت أردت أردت أردت" } } }));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.text.body).toContain("التسجيل");
  });

  it("passes a usable voice transcript to the Concierge", async () => {
    const t = setup(ORDER_SCRIPT);
    await t.conv.fetch(inbound({ type: "audio", audio: { id: "m1" }, kapso: { direction: "inbound", origin: "cloud_api", media_data: { url: "u", byte_size: 20000 },
      transcript: { text: "مرحبا بدي لبنة تعنايل وربطتين خبز عبعقلين" } } }));
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
    await t.conv.fetch(text("بدي تنتين تشيز برغر من عند السناك وحدة بلا كبيس"));
    await t.conv.alarm();
    expect(t.writes.some((w) => w.table === "handoffs" && w.row.reason === "restaurant_order")).toBe(true);
    expect(t.writes.some((w) => w.table === "conversations" && w.row.human_handoff === true)).toBe(true);
    expect(outbound).toHaveLength(1);
    expect(t.rpcCalls.some((c) => c.fn === "create_order_from_quote")).toBe(false);
  });

  it("does not send a card for a quote with issues, and lets the Concierge offer the substitute", async () => {
    const bad: Quote = { ...okQuote, ok: false, issues: [{ code: "out_of_stock", name: "Labneh", substitutes: [{ product_id: BREAD, name_en: "Liban Lait Labneh" }] }] };
    const t = setup([
      [use("quote_order", { lines: [{ product_id: LABNEH, qty: 1 }] })],
      [use("send_confirmation", {})],                                   // the model tries anyway
      [use("reply", { text: "لبنة تعنايل خلصت. بتحب ليبان ليه بدالها؟", buttons: [{ id: "sub:yes", title: "إي" }, { id: "sub:no", title: "لا" }] })],
    ], { quote_order: () => bad });
    await t.conv.fetch(text("بدي لبنة تعنايل"));
    await t.conv.alarm();
    expect(t.rpcCalls.some((c) => c.fn === "create_order_from_quote")).toBe(false);
    expect(t.seen).toHaveLength(3);                                     // the refused tool did not end the turn
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.interactive.body.text).toContain("خلصت");
  });

  it("stays silent while a person is handling the chat", async () => {
    const t = setup(ORDER_SCRIPT, { touch_conversation: () => ({ known: true, party_id: PARTY, conversation_id: CONV, human_handoff: true, blocked: false }) });
    await t.conv.fetch(text("وينكم؟"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(0); expect(outbound).toHaveLength(0);
  });

  it("stops after six model steps and hands off", async () => {
    const loop = Array.from({ length: 8 }, () => [use("search_catalog", { query: "لبنة" })]);
    const t = setup(loop);
    await t.conv.fetch(text("لبنة"));
    await t.conv.alarm();
    expect(t.seen).toHaveLength(6);
    expect(t.writes.some((w) => w.table === "handoffs" && w.row.reason === "agent_did_not_finish")).toBe(true);
  });

  it("saves a location pin and continues the order with it", async () => {
    const t = setup([[use("reply", { text: "وصل الموقع. شو بتحب تطلب؟" })]]);
    await t.conv.fetch(inbound({ type: "location", location: { latitude: 33.68, longitude: 35.56 } }));
    await t.conv.alarm();
    expect(t.rpcCalls.find((c) => c.fn === "save_customer_pin")!.args).toMatchObject({ p_lat: 33.68, p_lng: 35.56 });
    expect((t.store.get("state") as any).villageId).toBe(VILLAGE);
    expect(JSON.parse(t.seen[0]!.messages[0]!.content as string).texts[0]).toContain("location pin received");
  });
});

describe("order card", () => {
  it("keeps totals, consent line and buttons inside WhatsApp's limits for a 60-line basket", () => {
    const big: Quote = { ...okQuote, lines: Array.from({ length: 60 }, (_, i) => ({ name: `Product with a fairly long name number ${i}`, name_ar: null, qty: 2, unit: "Each", line_total_usd: 3.25, modifiers: ["بلا كبيس"] })) };
    const card = formatOrderCard({ orderId: ORDER, shortCode: "AK-2000", quote: big, paymentMethod: "whish" });
    const body = (card as any).interactive.body.text as string;
    expect(body.length).toBeLessThanOrEqual(1024);
    expect(body).toContain("الإجمالي"); expect(body).toContain(CONSENT_LINE); expect(body).toContain("أغراض تانية");
    expect(preflight({ line: "customer", partyId: PARTY, to: "x", category: "service", msg: card, dedupeKey: "t:0" })).toBeNull();
  });
  it("round-trips button ids", () => {
    expect(parseOrderButton(orderButtonId("cancel", ORDER))).toEqual({ action: "cancel", orderId: ORDER });
    expect(parseOrderButton("order:confirm:not-a-uuid")).toBeNull();
  });
});
